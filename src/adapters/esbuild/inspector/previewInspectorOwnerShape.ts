/**
 * Validates that a JSX-owning export is itself safe to mount as a React value in Page Inspector.
 * Parent-slice analysis may associate JSX with any surrounding variable declaration; this stricter
 * Inspector-only gate prevents route arrays, router objects, and story metadata from becoming roots.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewParentSliceOwner } from '../parentSlice';
import { isPreviewRenderHocFactoryCall } from '../renderGraph/previewRenderInvocation';

const MAX_COMPONENT_FACTORY_DEPTH = 8;

/** Imported styled-components factory identities admitted by the tagged-template owner check. */
interface StyledComponentFactoryBindings {
  /** Default or named `styled` imports callable directly in the consumer module. */
  readonly direct: ReadonlySet<string>;
  /** Namespace imports whose `.default` or `.styled` member owns the factory call. */
  readonly namespaces: ReadonlySet<string>;
}

/** Source identity and occurrence needed to recover the exact owner declaration from syntax. */
export interface PreviewInspectorOwnerShapeOptions {
  /** JSX opening-element offset reported by the existing parent-slice analyzer. */
  readonly occurrenceStart: number;
  /** Owner names reported from that same parsed occurrence. */
  readonly owner: PreviewParentSliceOwner;
  /** Absolute source path used to select the correct TypeScript JSX grammar. */
  readonly sourcePath: string;
  /** Current editor-or-disk source text; application code is never evaluated. */
  readonly sourceText: string;
}

/** Public export identity used when render-graph evidence has no direct JSX occurrence metadata. */
export interface PreviewInspectorComponentExportShapeOptions {
  /** Public runtime spelling selected as a candidate page root. */
  readonly exportName: string;
  /** Top-level value supplying the export, when render facts resolved it. */
  readonly localName?: string;
  /** Absolute authored path used to select TSX parser grammar. */
  readonly sourcePath: string;
  /** Current inert source snapshot. */
  readonly sourceText: string;
}

/**
 * Reports whether the occurrence owner is an importable component or React element export.
 *
 * Accepted declarations are component-named functions, React-style classes with a render method,
 * function/class expressions assigned to component exports, direct JSX element values, and bounded
 * HOC calls whose active argument is itself one of those component expressions. Arrays, object
 * literals, and arbitrary factory calls such as `createBrowserRouter([...])` fail closed.
 *
 * @param options Exact JSX occurrence, owner metadata, path, and inert source text.
 * @returns `true` only when mounting the owner's selected export is structurally justified.
 */
export function isPreviewInspectorComponentShapedOwner(
  options: PreviewInspectorOwnerShapeOptions,
): boolean {
  if (!hasComponentShapedExportName(options.owner.exportNames)) {
    return false;
  }
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(options.sourcePath),
  );
  const occurrenceNode = findDeepestContainingNode(sourceFile, options.occurrenceStart);
  const declaration = findMatchingOwnerDeclaration(occurrenceNode, options.owner, sourceFile);
  if (declaration === undefined) {
    return false;
  }
  return isComponentOwnerDeclaration(
    declaration,
    options.occurrenceStart,
    collectStyledComponentFactoryBindings(sourceFile),
  );
}

/**
 * Reports whether one render-path export is structurally mountable as a React value.
 * This export-oriented variant recovers an evidence position inside the declaration itself, then
 * delegates to the same HOC/styled/factory classifier used by direct JSX ancestry. It therefore
 * admits lazy and component-factory callbacks while continuing to reject arbitrary tagged metadata.
 */
export function isPreviewInspectorComponentShapedExport(
  options: PreviewInspectorComponentExportShapeOptions,
): boolean {
  if (options.exportName !== 'default' && !/^\p{Lu}/u.test(options.exportName)) return false;
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(options.sourcePath),
  );
  const declaration = findExportValueDeclaration(sourceFile, options);
  if (declaration === undefined) return false;
  if (ts.isFunctionDeclaration(declaration)) return true;
  if (ts.isClassDeclaration(declaration)) return isReactStyleClass(declaration);
  const expression = ts.isExportAssignment(declaration)
    ? declaration.expression
    : declaration.initializer;
  if (expression === undefined) return false;
  return isComponentExportValueExpression(
    expression,
    sourceFile,
    collectStyledComponentFactoryBindings(sourceFile),
    0,
    new Set(),
  );
}

/**
 * Resolves bounded same-file/imported component identifiers used by HOC exports.
 * The occurrence-oriented owner check cannot follow `memo(LocalComponent)` because the selected JSX
 * lives in another declaration. Export discovery can safely do so from syntax: only PascalCase
 * runtime imports and component-shaped local declarations are admitted, with cycle/depth guards.
 */
function isComponentExportValueExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  styledBindings: StyledComponentFactoryBindings,
  depth: number,
  visitedNames: Set<string>,
): boolean {
  if (depth >= MAX_COMPONENT_FACTORY_DEPTH) return false;
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    if (!/^\p{Lu}/u.test(current.text) || visitedNames.has(current.text)) return false;
    const nextVisited = new Set(visitedNames).add(current.text);
    const declaration = findTopLevelRuntimeDeclaration(sourceFile, current.text);
    if (declaration === undefined) return isRuntimeImportedIdentifier(sourceFile, current.text);
    if (ts.isFunctionDeclaration(declaration)) return true;
    if (ts.isClassDeclaration(declaration)) return isReactStyleClass(declaration);
    return (
      declaration.initializer !== undefined &&
      isComponentExportValueExpression(
        declaration.initializer,
        sourceFile,
        styledBindings,
        depth + 1,
        nextVisited,
      )
    );
  }
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return true;
  if (ts.isClassExpression(current)) return isReactStyleClass(current);
  if (
    ts.isJsxElement(current) ||
    ts.isJsxSelfClosingElement(current) ||
    ts.isJsxFragment(current)
  ) {
    return true;
  }
  if (ts.isTaggedTemplateExpression(current)) {
    const tag = unwrapExpression(current.tag);
    return (
      ts.isCallExpression(tag) &&
      isStyledComponentFactoryCallee(tag.expression, styledBindings) &&
      tag.arguments.some((argument) =>
        isComponentExportValueExpression(
          argument,
          sourceFile,
          styledBindings,
          depth + 1,
          visitedNames,
        ),
      )
    );
  }
  if (!ts.isCallExpression(current)) return false;
  const provenHoc = isPreviewRenderHocFactoryCall(current);
  return current.arguments.some((argument) => {
    const unwrappedArgument = unwrapExpression(argument);
    if (ts.isIdentifier(unwrappedArgument) && !provenHoc) return false;
    return isComponentExportValueExpression(
      argument,
      sourceFile,
      styledBindings,
      depth + 1,
      visitedNames,
    );
  });
}

/** Finds a same-file component declaration without descending into nested runtime scopes. */
function findTopLevelRuntimeDeclaration(
  sourceFile: ts.SourceFile,
  localName: string,
): ts.ClassDeclaration | ts.FunctionDeclaration | ts.VariableDeclaration | undefined {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === localName
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === localName,
      );
      if (declaration !== undefined) return declaration;
    }
  }
  return undefined;
}

/** Reports a non-type runtime import whose local binding has the requested component name. */
function isRuntimeImportedIdentifier(sourceFile: ts.SourceFile, localName: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      return false;
    }
    const clause = statement.importClause;
    if (clause?.name?.text === localName) return true;
    const bindings = clause?.namedBindings;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some(
        (element) => !isTypeOnlyImportSpecifier(element) && element.name.text === localName,
      )
    );
  });
}

/** Reads the authored `type` token without using TypeScript's deprecated compatibility property. */
function isTypeOnlyImportSpecifier(specifier: ts.ImportSpecifier): boolean {
  return specifier.getChildren().some((child) => child.kind === ts.SyntaxKind.TypeKeyword);
}

/** Finds the top-level declaration supplying a resolved local/default export. */
function findExportValueDeclaration(
  sourceFile: ts.SourceFile,
  options: PreviewInspectorComponentExportShapeOptions,
): InspectorOwnerDeclaration | undefined {
  const localName = options.localName;
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (
        statement.name?.text === localName ||
        (options.exportName === 'default' && hasDefaultExportModifier(statement))
      ) {
        return statement;
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === localName,
      );
      if (declaration !== undefined) return declaration;
      continue;
    }
    if (ts.isExportAssignment(statement) && options.exportName === 'default') return statement;
  }
  return undefined;
}

/** Detects `export default` without retaining modifier-array representation details. */
function hasDefaultExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ===
      true
  );
}

/** Requires a conventional component export name, while always admitting an explicit default. */
function hasComponentShapedExportName(exportNames: readonly string[]): boolean {
  return exportNames.some((exportName) => exportName === 'default' || /^\p{Lu}/u.test(exportName));
}

/** Finds the narrowest parsed node enclosing the analyzer's JSX opening-element offset. */
function findDeepestContainingNode(sourceFile: ts.SourceFile, position: number): ts.Node {
  let selected: ts.Node = sourceFile;

  /** Descends only through nodes whose full source range still contains the occurrence. */
  function visit(node: ts.Node): void {
    if (position < node.getFullStart() || position >= node.end) {
      return;
    }
    selected = node;
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return selected;
}

/** Declaration kinds used by the component-shape classifier. */
type InspectorOwnerDeclaration =
  ts.ClassDeclaration | ts.ExportAssignment | ts.FunctionDeclaration | ts.VariableDeclaration;

/**
 * Repeats the parent analyzer's nearest-owner walk while verifying the expected owner identity.
 */
function findMatchingOwnerDeclaration(
  occurrenceNode: ts.Node,
  owner: PreviewParentSliceOwner,
  sourceFile: ts.SourceFile,
): InspectorOwnerDeclaration | undefined {
  let current: ts.Node = occurrenceNode;
  while (current !== sourceFile) {
    if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) {
      if ((current.name?.text ?? null) === owner.localName) {
        return current;
      }
    } else if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.name.text === owner.localName
    ) {
      return current;
    } else if (
      ts.isExportAssignment(current) &&
      owner.localName === null &&
      owner.exportNames.includes('default')
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/** Applies declaration-specific React value checks without resolving or invoking identifiers. */
function isComponentOwnerDeclaration(
  declaration: InspectorOwnerDeclaration,
  occurrenceStart: number,
  styledBindings: StyledComponentFactoryBindings,
): boolean {
  if (ts.isFunctionDeclaration(declaration)) {
    return true;
  }
  if (ts.isClassDeclaration(declaration)) {
    return isReactStyleClass(declaration);
  }
  const expression = ts.isExportAssignment(declaration)
    ? declaration.expression
    : declaration.initializer;
  return (
    expression !== undefined &&
    isComponentValueExpression(expression, occurrenceStart, 0, styledBindings)
  );
}

/** Requires both inheritance and an authored render member for class-component mounting. */
function isReactStyleClass(declaration: ts.ClassLikeDeclaration): boolean {
  const extendsSomething =
    declaration.heritageClauses?.some(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0,
    ) === true;
  const hasRenderMember = declaration.members.some((member) => {
    if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member)) {
      return false;
    }
    return readPropertyName(member.name) === 'render';
  });
  return extendsSomething && hasRenderMember;
}

/** Reads ordinary identifier/string property names without evaluating computed expressions. */
function readPropertyName(name: ts.PropertyName | undefined): string | undefined {
  return name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
    ? name.text
    : undefined;
}

/**
 * Recognizes component-valued expressions and bounded HOC calls on the active JSX branch.
 */
function isComponentValueExpression(
  expression: ts.Expression,
  occurrenceStart: number,
  depth: number,
  styledBindings: StyledComponentFactoryBindings,
): boolean {
  if (depth >= MAX_COMPONENT_FACTORY_DEPTH) {
    return false;
  }
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return containsPosition(current, occurrenceStart);
  }
  if (ts.isClassExpression(current)) {
    return containsPosition(current, occurrenceStart) && isReactStyleClass(current);
  }
  if (
    ts.isJsxElement(current) ||
    ts.isJsxSelfClosingElement(current) ||
    ts.isJsxFragment(current)
  ) {
    return containsPosition(current, occurrenceStart);
  }
  if (ts.isTaggedTemplateExpression(current)) {
    return isStyledComponentTaggedOwner(current, occurrenceStart, depth, styledBindings);
  }
  if (!ts.isCallExpression(current)) {
    return false;
  }

  return current.arguments.some(
    (argument) =>
      containsPosition(argument, occurrenceStart) &&
      isComponentValueExpression(argument, occurrenceStart, depth + 1, styledBindings),
  );
}

/**
 * Recognizes the component-valued tagged-template form emitted by styled-components.
 *
 * A plain tagged template may contain arbitrary JSX interpolation while evaluating to metadata,
 * CSS, or another non-React value. Promotion is therefore restricted to a call of a statically
 * proven styled-components import whose inline component argument owns the selected occurrence.
 * The source remains inert: neither the tag nor its template substitutions are evaluated.
 */
function isStyledComponentTaggedOwner(
  expression: ts.TaggedTemplateExpression,
  occurrenceStart: number,
  depth: number,
  styledBindings: StyledComponentFactoryBindings,
): boolean {
  const tag = unwrapExpression(expression.tag);
  if (
    !ts.isCallExpression(tag) ||
    !isStyledComponentFactoryCallee(tag.expression, styledBindings)
  ) {
    return false;
  }
  return tag.arguments.some(
    (argument) =>
      containsPosition(argument, occurrenceStart) &&
      isComponentValueExpression(argument, occurrenceStart, depth + 1, styledBindings),
  );
}

/** Collects only runtime imports that can identify the styled-components component factory. */
function collectStyledComponentFactoryBindings(
  sourceFile: ts.SourceFile,
): StyledComponentFactoryBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'styled-components'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) {
      continue;
    }
    if (clause.name !== undefined) {
      direct.add(clause.name.text);
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (
        !isTypeOnlyImportSpecifier(element) &&
        (importedName === 'styled' || importedName === 'default')
      ) {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/** Proves that one call expression invokes a collected direct or namespace styled factory. */
function isStyledComponentFactoryCallee(
  expression: ts.Expression,
  bindings: StyledComponentFactoryBindings,
): boolean {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) {
    return bindings.direct.has(callee.text);
  }
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }
  const namespace = unwrapExpression(callee.expression);
  return (
    ts.isIdentifier(namespace) &&
    bindings.namespaces.has(namespace.text) &&
    (callee.name.text === 'default' || callee.name.text === 'styled')
  );
}

/** Removes syntax-only wrappers while preserving the expression's runtime value identity. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Reports whether one AST range contains the selected JSX opening-element offset. */
function containsPosition(node: ts.Node, position: number): boolean {
  return position >= node.getFullStart() && position < node.end;
}

/** Selects TypeScript's JSX-aware parser grammar from one supported source suffix. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    return ts.ScriptKind.TS;
  }
  return extension === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}
