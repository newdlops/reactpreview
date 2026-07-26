/* eslint-disable jsdoc/require-jsdoc */
/** Resolves a same-file React component hidden behind a bounded export/HOC expression. */
import ts from 'typescript';

const MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH = 12;

export interface PreviewReactLocalComponentSurface {
  readonly bypassedWrapperNames: readonly string[];
  readonly functionRange: { readonly end: number; readonly start: number };
  readonly localName?: string;
  readonly preservedWrapperKinds: readonly ('forward-ref' | 'memo' | 'styled')[];
}

export interface ResolvePreviewReactLocalComponentSurfaceOptions {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly sourceText: string;
}

/**
 * Resolves only unique, same-file component declarations. Unknown calls fail closed rather than
 * being guessed as HOCs. Project HOC names are retained solely for a sliced-preview diagnostic.
 */
export function resolvePreviewReactLocalComponentSurface(
  options: ResolvePreviewReactLocalComponentSurfaceOptions,
): PreviewReactLocalComponentSurface | undefined {
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    options.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (
    ((sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0
  )
    return undefined;
  const declarations = collectLocalDeclarations(sourceFile);
  const expression = findExportExpression(sourceFile, options.exportName, declarations);
  return expression === undefined
    ? undefined
    : resolveExpression(expression, declarations, sourceFile, new Set(), [], [], 0);
}

type LocalDeclaration = ts.Expression | ts.FunctionDeclaration;

function collectLocalDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalDeclaration> {
  const declarations = new Map<string, LocalDeclaration>();
  const ambiguous = new Set<string>();
  const add = (name: string, value: LocalDeclaration): void => {
    if (ambiguous.has(name)) return;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else declarations.set(name, value);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined)
      add(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined)
        add(declaration.name.text, declaration.initializer);
    }
  }
  return declarations;
}

function findExportExpression(
  sourceFile: ts.SourceFile,
  exportName: string,
  declarations: ReadonlyMap<string, LocalDeclaration>,
): ts.Expression | ts.FunctionDeclaration | undefined {
  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported =
      modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
    const defaultExport =
      modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true;
    if (exportName === 'default' && ts.isExportAssignment(statement)) return statement.expression;
    if (
      ts.isFunctionDeclaration(statement) &&
      exported &&
      (defaultExport || statement.name?.text === exportName)
    )
      return statement;
    if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === exportName &&
          declaration.initializer !== undefined
        )
          return declaration.initializer;
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const element = statement.exportClause.elements.find((item) => item.name.text === exportName);
      if (element !== undefined)
        return declarations.get((element.propertyName ?? element.name).text);
    }
  }
  return exportName === 'default' ? declarations.get('default') : declarations.get(exportName);
}

function resolveExpression(
  expression: ts.Expression | ts.FunctionDeclaration,
  declarations: ReadonlyMap<string, LocalDeclaration>,
  sourceFile: ts.SourceFile,
  active: Set<string>,
  bypassed: string[],
  preserved: ('forward-ref' | 'memo' | 'styled')[],
  depth: number,
): PreviewReactLocalComponentSurface | undefined {
  if (depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH) return undefined;
  const current = unwrapExpression(expression);
  if (
    ts.isFunctionDeclaration(current) ||
    ts.isArrowFunction(current) ||
    ts.isFunctionExpression(current)
  ) {
    const localName = readLocalName(current);
    return Object.freeze({
      bypassedWrapperNames: Object.freeze([...bypassed]),
      functionRange: Object.freeze({ end: current.end, start: current.getStart(sourceFile) }),
      ...(localName === undefined ? {} : { localName }),
      preservedWrapperKinds: Object.freeze([...preserved]),
    });
  }
  if (ts.isIdentifier(current)) {
    if (active.has(current.text)) return undefined;
    const declaration = declarations.get(current.text);
    if (declaration === undefined) return undefined;
    active.add(current.text);
    const resolved = resolveExpression(
      declaration,
      declarations,
      sourceFile,
      active,
      bypassed,
      preserved,
      depth + 1,
    );
    active.delete(current.text);
    return resolved;
  }
  if (!ts.isCallExpression(current) || current.arguments.length === 0) return undefined;
  const wrapper = readCalleeName(current.expression);
  if (wrapper === undefined) return undefined;
  const nextPreserved = [...preserved];
  const nextBypassed = [...bypassed];
  if (wrapper === 'memo') nextPreserved.push('memo');
  else if (wrapper === 'forwardRef') nextPreserved.push('forward-ref');
  else if (wrapper === 'styled' || wrapper.startsWith('styled.')) nextPreserved.push('styled');
  else nextBypassed.push(wrapper);
  for (const argument of current.arguments) {
    const resolved = resolveExpression(
      argument,
      declarations,
      sourceFile,
      active,
      nextBypassed,
      nextPreserved,
      depth + 1,
    );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function unwrapExpression<T extends ts.Expression | ts.FunctionDeclaration>(expression: T): T {
  let current: ts.Expression | ts.FunctionDeclaration = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current as T;
}

function readLocalName(
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): string | undefined {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    ? node.name?.text
    : undefined;
}

function readCalleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.getText();
  return undefined;
}
