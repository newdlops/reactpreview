/**
 * Validates that a JSX-owning export is itself safe to mount as a React value in Page Inspector.
 * Parent-slice analysis may associate JSX with any surrounding variable declaration; this stricter
 * Inspector-only gate prevents route arrays, router objects, and story metadata from becoming roots.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewParentSliceOwner } from '../parentSlice';

const MAX_COMPONENT_FACTORY_DEPTH = 8;

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
  return isComponentOwnerDeclaration(declaration, options.occurrenceStart);
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
  return expression !== undefined && isComponentValueExpression(expression, occurrenceStart, 0);
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
  if (!ts.isCallExpression(current)) {
    return false;
  }

  return current.arguments.some(
    (argument) =>
      containsPosition(argument, occurrenceStart) &&
      isComponentValueExpression(argument, occurrenceStart, depth + 1),
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
