/** Bounded syntax metadata shared by direct Route collection and location inference. */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';
import { collectPreviewInspectorRouteFactoryEvidence } from './previewInspectorRouteFactory';

const ROUTE_REGISTRY_SOURCE_PATTERN =
  /^(?:(?:page|route|router|routing)s?|(?:page|route)[-_.](?:map|paths?|config|registry))(?:[-_.](?:map|paths?|config|registry))?\.[cm]?[jt]sx?$/iu;

/** Exact component-bound static parts surrounding one `.basePath` reference. */
export interface PreviewInspectorRouteBasePathReference {
  readonly exportName: string;
  readonly prefix: string;
  readonly sourcePath: string;
  readonly suffix: string;
  /** Route-owner module that authored this reference. */
  readonly ownerSourcePath?: string;
}

/** Reads literal JSX attributes through bounded one-argument route normalizers. */
export function readStaticJsxStringAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): string | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  if (attribute?.initializer === undefined) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  return ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression !== undefined
    ? readPreviewInspectorNormalizedRouteString(attribute.initializer.expression)
    : undefined;
}

/** Reads a static route string below inert one-argument normalization calls. */
export function readPreviewInspectorNormalizedRouteString(
  expression: ts.Expression,
): string | undefined {
  let current = unwrap(expression);
  while (
    ts.isCallExpression(current) &&
    current.arguments.length === 1 &&
    current.arguments[0] !== undefined
  ) {
    current = unwrap(current.arguments[0]);
  }
  return readStaticString(current);
}

/** Reads `<Route index>` and exact boolean JSX expressions. */
export function readStaticJsxBooleanAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): boolean | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  if (attribute === undefined) return undefined;
  if (attribute.initializer === undefined) return true;
  const expression = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  if (expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Retains only an exact same-rendered-component `.basePath` path expression. */
export function readPreviewInspectorRouteBasePathReference(
  expression: ts.Expression | undefined,
  component: { readonly exportName: string; readonly sourcePath: string },
  componentLocalName: string,
  ownerSourcePath?: string,
): PreviewInspectorRouteBasePathReference | undefined {
  if (expression === undefined) return undefined;
  const parts = readStaticParts(unwrapRootWrapper(expression));
  if (parts?.binding !== componentLocalName) return undefined;
  if (parts.exportName !== undefined && parts.exportName !== component.exportName) return undefined;
  return Object.freeze({
    exportName: component.exportName,
    prefix: parts.prefix,
    sourcePath: path.normalize(component.sourcePath),
    suffix: parts.suffix,
    ...(ownerSourcePath === undefined ? {} : { ownerSourcePath: path.normalize(ownerSourcePath) }),
  });
}

/** Resolves the direct conventional registry imports of one already-authorized source module. */
export function collectPreviewInspectorDirectRouteRegistrySources(
  sourcePath: string,
  sourceText: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): readonly string[] {
  if (resolveModule === undefined) return Object.freeze([]);
  const sources = collectPreviewRenderModuleFacts(sourcePath, sourceText).imports.flatMap(
    (item) => {
      const resolved = resolveModule(item.moduleSpecifier, sourcePath);
      return resolved !== undefined && isPreviewInspectorRouteRegistrySource(resolved)
        ? [path.normalize(resolved)]
        : [];
    },
  );
  return Object.freeze([...new Set(sources)].sort());
}

/** Classifies only conventional route registry module basenames. */
export function isPreviewInspectorRouteRegistrySource(sourcePath: string): boolean {
  return ROUTE_REGISTRY_SOURCE_PATTERN.test(path.basename(sourcePath));
}

/** Materializes a unique conventional route-factory base without executing its module. */
export async function materializePreviewInspectorRouteBasePath(
  reference: PreviewInspectorRouteBasePathReference,
  readSource: (sourcePath: string) => Promise<string | undefined>,
  ownerSourcePath?: string,
): Promise<string | undefined> {
  const sourceText = await readSource(reference.sourcePath);
  if (sourceText === undefined) return undefined;
  const sourceFile = ts.createSourceFile(
    reference.sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    reference.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length
  )
    return undefined;
  const facts = collectPreviewRenderModuleFacts(reference.sourcePath, sourceText);
  const evidence = collectPreviewInspectorRouteFactoryEvidence(sourceFile);
  const exportMatches = facts.exports.filter((item) => item.exportName === reference.exportName);
  const localName = exportMatches.length === 1 ? exportMatches[0]?.localName : undefined;
  const sameFileOwner =
    (ownerSourcePath ?? reference.ownerSourcePath) !== undefined &&
    path.normalize(ownerSourcePath ?? reference.ownerSourcePath ?? '') ===
      path.normalize(reference.sourcePath);
  const matches =
    localName === '@default'
      ? evidence.filter((item) => item.componentName === 'default')
      : localName !== undefined
        ? evidence.filter((item) => item.componentName === localName)
        : sameFileOwner
          ? evidence.filter((item) => item.componentName === reference.exportName)
          : [];
  if (matches.length !== 1) return undefined;
  const basePath = matches[0]?.basePath;
  return basePath === undefined ? undefined : `${reference.prefix}${basePath}${reference.suffix}`;
}

/** Reads one permitted static string composition containing exactly one `.basePath` receiver. */
function readStaticParts(
  expression: ts.Expression,
): { binding: string; exportName?: string; prefix: string; suffix: string } | undefined {
  if (ts.isCallExpression(expression)) return undefined;
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'basePath') {
    if (ts.isIdentifier(expression.expression))
      return { binding: expression.expression.text, prefix: '', suffix: '' };
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression)
    )
      return {
        binding: expression.expression.expression.text,
        exportName: expression.expression.name.text,
        prefix: '',
        suffix: '',
      };
  }
  if (ts.isTemplateExpression(expression)) {
    if (expression.templateSpans.length !== 1) return undefined;
    const span = expression.templateSpans[0];
    if (span === undefined) return undefined;
    const inner = readStaticParts(unwrap(span.expression));
    return inner === undefined
      ? undefined
      : {
          ...inner,
          prefix: expression.head.text + inner.prefix,
          suffix: inner.suffix + span.literal.text,
        };
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = readStaticParts(unwrap(expression.left));
    const right = readStaticParts(unwrap(expression.right));
    const leftExpression = unwrap(expression.left);
    const rightExpression = unwrap(expression.right);
    if (left !== undefined && right !== undefined) return undefined;
    const leftStatic = readStaticString(leftExpression);
    const rightStatic = readStaticString(rightExpression);
    if (left !== undefined && rightStatic !== undefined)
      return { ...left, suffix: left.suffix + rightStatic };
    if (right !== undefined && leftStatic !== undefined)
      return { ...right, prefix: leftStatic + right.prefix };
  }
  return undefined;
}

/** Reads arbitrarily grouped literal-only concatenations without evaluating expressions. */
function readStaticString(expression: ts.Expression): string | undefined {
  const current = unwrap(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = readStaticString(current.left);
    const right = readStaticString(current.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/** Permits inert one-argument normalizers only around the complete authored expression. */
function unwrapRootWrapper(expression: ts.Expression): ts.Expression {
  let current = unwrap(expression);
  while (
    ts.isCallExpression(current) &&
    current.arguments.length === 1 &&
    current.arguments[0] !== undefined
  )
    current = unwrap(current.arguments[0]);
  return current;
}

/** Removes only inert TypeScript expression wrappers. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}
