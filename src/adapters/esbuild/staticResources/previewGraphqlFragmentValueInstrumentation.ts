/**
 * Instruments GraphQL Code Generator fragment-unmasking helpers for static Page Inspector data.
 *
 * Generated `getFragmentData(document, carrier)` helpers intentionally return the carrier as-is.
 * In the real application that carrier arrives from a backend query and contains the selected
 * fragment fields. A static preview often has only an empty Context/prop placeholder, so the helper
 * succeeds but its immediately destructured result still throws. This analyzer wraps only proven
 * imports from GraphQL/fragment modules and lets the browser runtime complete the carrier from the
 * authored fragment selection. Project modules are never imported or evaluated by this analyzer.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { hasPreviewRuntimeParseDiagnostics } from './previewRuntimeHookSyntax';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const FRAGMENT_HELPER_EXPORT = 'getFragmentData';
const FRAGMENT_MODULE_PATTERN = /(?:fragment|graphql|gql)/iu;
const MAX_FRAGMENT_HELPERS_PER_MODULE = 64;

/** Imported local binding and its authored module identity for one generated fragment helper. */
interface PreviewGraphqlFragmentHelperBinding {
  /** Local identifier used at the callsite, including import aliases. */
  readonly localName: string;
  /** Static module specifier retained only for Inspector diagnostics. */
  readonly moduleSpecifier: string;
}

/**
 * Creates bounded runtime wrappers for generated fragment-unmasking calls.
 *
 * @param sourcePath Absolute authored module path used for stable blocker identity and diagnostics.
 * @param sourceText Original JavaScript/TypeScript source whose offsets remain authoritative.
 * @returns Non-overlapping call-expression replacements in source order.
 */
export function createPreviewGraphqlFragmentValueReplacements(
  sourcePath: string,
  sourceText: string,
): readonly PreviewSourceReplacement[] {
  if (!isGraphqlFragmentSource(sourcePath, sourceText)) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasPreviewRuntimeParseDiagnostics(sourceFile)) return [];
  const bindings = collectPreviewGraphqlFragmentHelperBindings(sourceFile);
  if (bindings.size === 0) return [];

  const replacements: PreviewSourceReplacement[] = [];
  const visit = (node: ts.Node): void => {
    if (replacements.length >= MAX_FRAGMENT_HELPERS_PER_MODULE) return;
    if (
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      ts.isIdentifier(node.expression) &&
      node.arguments.length >= 2
    ) {
      const binding = bindings.get(node.expression.text);
      if (binding !== undefined) {
        replacements.push(
          createPreviewGraphqlFragmentValueReplacement(
            sourceFile,
            sourcePath,
            sourceText,
            node,
            binding,
            replacements.length,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return replacements;
}

/** Admits only JavaScript-like modules that contain both an import and the exact helper name. */
function isGraphqlFragmentSource(sourcePath: string, sourceText: string): boolean {
  return (
    /\.[cm]?[jt]sx?$/iu.test(sourcePath) &&
    sourceText.includes('import') &&
    sourceText.includes(FRAGMENT_HELPER_EXPORT)
  );
}

/** Collects named imports while rejecting same-named application functions and object methods. */
function collectPreviewGraphqlFragmentHelperBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewGraphqlFragmentHelperBinding> {
  const bindings = new Map<string, PreviewGraphqlFragmentHelperBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!FRAGMENT_MODULE_PATTERN.test(moduleSpecifier)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) !== FRAGMENT_HELPER_EXPORT) continue;
      bindings.set(element.name.text, { localName: element.name.text, moduleSpecifier });
    }
  }
  return bindings;
}

/** Serializes one wrapper without evaluating either the helper result or DocumentNode twice. */
function createPreviewGraphqlFragmentValueReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  sourceText: string,
  call: ts.CallExpression,
  binding: PreviewGraphqlFragmentHelperBinding,
  occurrence: number,
): PreviewSourceReplacement {
  const start = call.getStart(sourceFile);
  const end = call.end;
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const originalCall = sourceText.slice(start, end);
  const documentArgument = call.arguments[0];
  const documentExpression = sourceText.slice(
    documentArgument?.getStart(sourceFile) ?? start,
    documentArgument?.end ?? start,
  );
  const requiredPaths = collectPreviewGraphqlFragmentRequiredPaths(call);
  const metadata = {
    column: location.character + 1,
    evidence: 'authored GraphQL fragment selection and immediate result usage',
    fallbackLabel: 'selection-shaped static fragment data',
    hookName: binding.localName,
    id: createPreviewGraphqlFragmentValueIdentity(sourcePath, binding, location.line, occurrence),
    line: location.line + 1,
    moduleSpecifier: binding.moduleSpecifier,
    ownerName: readContainingFunctionName(call),
    requiredPaths: requiredPaths.length === 0 ? ['<root>'] : requiredPaths,
    sourcePath: path.normalize(sourcePath),
  };
  const api = `globalThis[Symbol.for(${JSON.stringify(INSPECTOR_API_SYMBOL)})]`;
  return {
    end,
    priority: 2,
    replacement: `${api}.resolveGraphqlFragment(() => (${originalCall}), () => (${documentExpression}), () => Object.freeze({}), ${JSON.stringify(metadata)})`,
    start,
  };
}

/** Reads direct object/array destructuring so unknown documents still receive a useful minimum. */
function collectPreviewGraphqlFragmentRequiredPaths(call: ts.CallExpression): readonly string[] {
  const expression = unwrapParentExpression(call);
  const parent = expression.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === expression) {
    return collectBindingPaths(parent.name);
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === expression) {
    return [parent.name.text];
  }
  return [];
}

/** Recursively converts one binding pattern into stable dot/index paths. */
function collectBindingPaths(binding: ts.BindingName, prefix = ''): readonly string[] {
  if (ts.isIdentifier(binding)) return prefix.length === 0 ? [] : [prefix];
  const paths: string[] = [];
  for (const [index, element] of binding.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
    const propertyName = ts.isObjectBindingPattern(binding)
      ? readBindingPropertyName(element)
      : String(index);
    if (propertyName === undefined) continue;
    const childPrefix = prefix.length === 0 ? propertyName : `${prefix}.${propertyName}`;
    const childPaths = collectBindingPaths(element.name, childPrefix);
    paths.push(...(childPaths.length === 0 ? [childPrefix] : childPaths));
  }
  return paths;
}

/** Returns the static property selected by one object-binding element. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName === undefined && ts.isIdentifier(element.name)) {
    return element.name.text;
  }
  const propertyName = element.propertyName;
  return propertyName !== undefined &&
    (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName))
    ? propertyName.text
    : undefined;
}

/** Walks transparent parentheses/assertions so replacement metadata follows the real consumer. */
function unwrapParentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent) ||
      ts.isNonNullExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

/** Finds a readable function/component owner without following inter-module value flow. */
function readContainingFunctionName(node: ts.Node): string {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return '';
}

/** Creates a hot-reload-stable identity without retaining GraphQL source or project values. */
function createPreviewGraphqlFragmentValueIdentity(
  sourcePath: string,
  binding: PreviewGraphqlFragmentHelperBinding,
  zeroBasedLine: number,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        path.normalize(sourcePath),
        binding.moduleSpecifier,
        binding.localName,
        zeroBasedLine,
        occurrence,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}

/** Maps file extension to TypeScript's inert parser mode. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
