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
import { readPreviewRuntimeHookAliasUsagePaths } from './previewRuntimeHookAliasUsage';
import {
  findNearestPreviewRuntimeFunction,
  hasPreviewRuntimeParseDiagnostics,
  isPreviewRuntimeFunction,
  type PreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import { createPreviewRuntimeHookUsageTreeFallback } from './previewRuntimeHookUsageTree';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const FRAGMENT_HELPER_EXPORT = 'getFragmentData';
const FRAGMENT_MODULE_PATTERN = /(?:fragment|graphql|gql)/iu;
const MAX_FRAGMENT_HELPERS_PER_MODULE = 64;
const MAX_FRAGMENT_LITERAL_DEMANDS = 32;
const MAX_FRAGMENT_LITERAL_PATH_DEPTH = 12;
const BLOCKED_FRAGMENT_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const COLLECTION_CALLBACK_ITEM_PARAMETER = new Map<string, number>([
  ['every', 0],
  ['filter', 0],
  ['find', 0],
  ['findIndex', 0],
  ['findLast', 0],
  ['findLastIndex', 0],
  ['flatMap', 0],
  ['forEach', 0],
  ['map', 0],
  ['reduce', 1],
  ['reduceRight', 1],
  ['some', 0],
  ['sort', 0],
]);

type PreviewGraphqlFragmentLiteral = boolean | number | string;

/** One fragment-relative scalar that must belong to an authored closed control-flow domain. */
interface PreviewGraphqlFragmentLiteralDemand {
  readonly path: string;
  readonly value: PreviewGraphqlFragmentLiteral;
}

/** Unambiguous same-file helper inspected without executing or resolving its imports. */
interface PreviewGraphqlFragmentLocalFunction {
  readonly node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
}

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
  const literalDemands = collectPreviewGraphqlFragmentLiteralDemands(call);
  const metadata = {
    column: location.character + 1,
    evidence: 'authored GraphQL fragment selection and immediate result usage',
    fallbackLabel: 'selection-shaped static fragment data',
    hookName: binding.localName,
    id: createPreviewGraphqlFragmentValueIdentity(sourcePath, binding, location.line, occurrence),
    line: location.line + 1,
    moduleSpecifier: binding.moduleSpecifier,
    ownerName: readContainingFunctionName(call),
    ...(literalDemands.length === 0 ? {} : { literalDemands }),
    ...(literalDemands.length === 0
      ? {}
      : {
          renderGuardPaths: literalDemands.map((demand) =>
            demand.path
              .split('.')
              .map((segment) => (segment === '[]' ? '0' : segment))
              .join('.'),
          ),
        }),
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

/**
 * Carries fragment-relative enum/literal evidence from switches and local helpers into the browser
 * completion boundary. GraphQL selections do not contain response enum members, so a schema-less
 * generator otherwise emits a readable but invalid generic string that reaches an exhaustive
 * `never` throw. The scan stays inside the function that owns the fragment call plus uniquely named
 * same-file helpers reached by a direct call.
 */
function collectPreviewGraphqlFragmentLiteralDemands(
  call: ts.CallExpression,
): readonly PreviewGraphqlFragmentLiteralDemand[] {
  const expression = unwrapParentExpression(call);
  const declaration = expression.parent;
  const owner = findNearestPreviewRuntimeFunction(call);
  if (
    owner === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== expression
  ) {
    return [];
  }
  const bindings = new Map<string, readonly string[]>();
  appendPreviewGraphqlFragmentBindingPaths(declaration.name, [], bindings);
  propagatePreviewGraphqlFragmentOwnerBindings(owner, bindings);
  const functions = collectPreviewGraphqlFragmentLocalFunctions(call.getSourceFile());
  const demands = new Map<string, PreviewGraphqlFragmentLiteralDemand>();
  visitPreviewGraphqlFragmentUsage(owner, owner, bindings, functions, demands);
  return Object.freeze([...demands.values()].slice(0, MAX_FRAGMENT_LITERAL_DEMANDS));
}

/** Adds immutable aliases/destructuring rooted at the fragment result to a bounded fixed point. */
function propagatePreviewGraphqlFragmentOwnerBindings(
  owner: PreviewRuntimeFunction,
  bindings: Map<string, readonly string[]>,
): void {
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  for (let pass = 0; pass < 8 && bindings.size < 64; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (declaration.initializer === undefined) continue;
      const path = readPreviewGraphqlFragmentExpressionPath(declaration.initializer, bindings);
      if (path === undefined) continue;
      changed = appendPreviewGraphqlFragmentBindingPaths(declaration.name, path, bindings) || changed;
    }
    if (!changed) break;
  }
}

/** Maps one identifier or static binding pattern to its fragment-relative property path. */
function appendPreviewGraphqlFragmentBindingPaths(
  binding: ts.BindingName,
  prefix: readonly string[],
  bindings: Map<string, readonly string[]>,
): boolean {
  if (ts.isIdentifier(binding)) {
    const previous = bindings.get(binding.text);
    if (previous !== undefined) return false;
    bindings.set(binding.text, Object.freeze([...prefix]));
    return true;
  }
  let changed = false;
  for (const [index, element] of binding.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
    const propertyName = ts.isObjectBindingPattern(binding)
      ? readBindingPropertyName(element)
      : String(index);
    if (propertyName === undefined || BLOCKED_FRAGMENT_PROPERTY_NAMES.has(propertyName)) continue;
    changed =
      appendPreviewGraphqlFragmentBindingPaths(
        element.name,
        [...prefix, propertyName],
        bindings,
      ) || changed;
  }
  return changed;
}

/** Resolves a prototype-safe direct/optional property chain back to a known fragment binding. */
function readPreviewGraphqlFragmentExpressionPath(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isIdentifier(value)) return bindings.get(value.text);
  if (ts.isPropertyAccessExpression(value)) {
    if (BLOCKED_FRAGMENT_PROPERTY_NAMES.has(value.name.text)) return undefined;
    const owner = readPreviewGraphqlFragmentExpressionPath(value.expression, bindings);
    return owner === undefined ? undefined : [...owner, value.name.text];
  }
  if (ts.isElementAccessExpression(value) && value.argumentExpression !== undefined) {
    const argument = unwrapPreviewRuntimeExpression(value.argumentExpression);
    const propertyName =
      ts.isStringLiteral(argument) || ts.isNumericLiteral(argument) ? argument.text : undefined;
    if (propertyName === undefined || BLOCKED_FRAGMENT_PROPERTY_NAMES.has(propertyName)) {
      return undefined;
    }
    const owner = readPreviewGraphqlFragmentExpressionPath(value.expression, bindings);
    return owner === undefined ? undefined : [...owner, propertyName];
  }
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    const left = readPreviewGraphqlFragmentExpressionPath(value.left, bindings);
    const right = readPreviewGraphqlFragmentExpressionPath(value.right, bindings);
    if (left === undefined) return right;
    if (right === undefined) return left;
    return samePreviewGraphqlFragmentPath(left, right) ? left : undefined;
  }
  return undefined;
}

/** Traverses relevant direct uses and explicitly enters only callbacks over a proven collection. */
function visitPreviewGraphqlFragmentUsage(
  node: ts.Node,
  scope: PreviewRuntimeFunction,
  bindings: ReadonlyMap<string, readonly string[]>,
  functions: ReadonlyMap<string, PreviewGraphqlFragmentLocalFunction>,
  demands: Map<string, PreviewGraphqlFragmentLiteralDemand>,
): void {
  if (demands.size >= MAX_FRAGMENT_LITERAL_DEMANDS) return;
  if (node !== scope && isPreviewRuntimeFunction(node)) return;
  if (ts.isSwitchStatement(node)) {
    const path = readPreviewGraphqlFragmentExpressionPath(node.expression, bindings);
    if (path !== undefined) {
      const literal = node.caseBlock.clauses.flatMap((clause) =>
        ts.isCaseClause(clause)
          ? readPreviewGraphqlFragmentLiteral(clause.expression) ?? []
          : [],
      )[0];
      if (literal !== undefined) appendPreviewGraphqlFragmentLiteralDemand(path, literal, demands);
    }
  }
  if (ts.isCallExpression(node) && node.questionDotToken === undefined) {
    appendPreviewGraphqlFragmentHelperCallDemands(node, bindings, functions, demands);
    visitPreviewGraphqlFragmentCollectionCallback(node, bindings, functions, demands);
  }
  ts.forEachChild(node, (child) => {
    visitPreviewGraphqlFragmentUsage(child, scope, bindings, functions, demands);
  });
}

/** Follows one fragment-derived direct argument into a uniquely named local helper's switch. */
function appendPreviewGraphqlFragmentHelperCallDemands(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, readonly string[]>,
  functions: ReadonlyMap<string, PreviewGraphqlFragmentLocalFunction>,
  demands: Map<string, PreviewGraphqlFragmentLiteralDemand>,
): void {
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (!ts.isIdentifier(callee)) return;
  const helper = functions.get(callee.text);
  if (helper === undefined) return;
  for (const [index, argument] of call.arguments.entries()) {
    if (ts.isSpreadElement(argument)) continue;
    const path = readPreviewGraphqlFragmentExpressionPath(argument, bindings);
    if (path === undefined) continue;
    const literal = readPreviewGraphqlFragmentHelperLiteral(helper.node, index);
    if (literal !== undefined) appendPreviewGraphqlFragmentLiteralDemand(path, literal, demands);
  }
}

/** Enters the item callback of a collection whose receiver is fragment-derived. */
function visitPreviewGraphqlFragmentCollectionCallback(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, readonly string[]>,
  functions: ReadonlyMap<string, PreviewGraphqlFragmentLocalFunction>,
  demands: Map<string, PreviewGraphqlFragmentLiteralDemand>,
): void {
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken !== undefined) return;
  const itemParameterIndex = COLLECTION_CALLBACK_ITEM_PARAMETER.get(callee.name.text);
  if (itemParameterIndex === undefined) return;
  const collectionPath = readPreviewGraphqlFragmentExpressionPath(callee.expression, bindings);
  const callbackExpression = call.arguments[0];
  if (collectionPath === undefined || callbackExpression === undefined) return;
  const callback = unwrapPreviewRuntimeExpression(callbackExpression);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return;
  const parameter = callback.parameters[itemParameterIndex];
  if (parameter === undefined) return;
  const callbackBindings = new Map(bindings);
  appendPreviewGraphqlFragmentBindingPaths(
    parameter.name,
    [...collectionPath, '[]'],
    callbackBindings,
  );
  visitPreviewGraphqlFragmentUsage(
    callback.body,
    callback,
    callbackBindings,
    functions,
    demands,
  );
}

/** Reads the first finite switch member accepted for one exact local helper parameter. */
function readPreviewGraphqlFragmentHelperLiteral(
  helper: PreviewGraphqlFragmentLocalFunction['node'],
  parameterIndex: number,
): PreviewGraphqlFragmentLiteral | undefined {
  const parameter = helper.parameters[parameterIndex];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
  const aliases = new Set([parameter.name.text]);
  let changed = true;
  while (changed && aliases.size < 16) {
    changed = false;
    const collectAlias = (node: ts.Node): void => {
      if (node !== helper && isPreviewRuntimeFunction(node)) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        const initializer = unwrapPreviewRuntimeExpression(node.initializer);
        if (ts.isIdentifier(initializer) && aliases.has(initializer.text) && !aliases.has(node.name.text)) {
          aliases.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, collectAlias);
    };
    collectAlias(helper);
  }
  let literal: PreviewGraphqlFragmentLiteral | undefined;
  const visit = (node: ts.Node): void => {
    if (literal !== undefined || (node !== helper && isPreviewRuntimeFunction(node))) return;
    if (ts.isSwitchStatement(node)) {
      const expression = unwrapPreviewRuntimeExpression(node.expression);
      if (ts.isIdentifier(expression) && aliases.has(expression.text)) {
        for (const clause of node.caseBlock.clauses) {
          if (!ts.isCaseClause(clause)) continue;
          literal = readPreviewGraphqlFragmentLiteral(clause.expression);
          if (literal !== undefined) return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(helper);
  return literal;
}

/** Indexes same-file functions while rejecting ambiguous names. */
function collectPreviewGraphqlFragmentLocalFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewGraphqlFragmentLocalFunction> {
  const candidates = new Map<string, PreviewGraphqlFragmentLocalFunction | null>();
  const add = (
    name: string,
    node: PreviewGraphqlFragmentLocalFunction['node'],
  ): void => {
    candidates.set(name, candidates.has(name) ? null : { node });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      add(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        add(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return new Map(
    [...candidates].filter(
      (entry): entry is [string, PreviewGraphqlFragmentLocalFunction] => entry[1] !== null,
    ),
  );
}

/** Stores one safe, bounded fragment-relative demand in authored discovery order. */
function appendPreviewGraphqlFragmentLiteralDemand(
  path: readonly string[],
  value: PreviewGraphqlFragmentLiteral,
  demands: Map<string, PreviewGraphqlFragmentLiteralDemand>,
): void {
  if (
    path.length === 0 ||
    path.length > MAX_FRAGMENT_LITERAL_PATH_DEPTH ||
    path.some(
      (segment) =>
        segment !== '[]' &&
        (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment) ||
          BLOCKED_FRAGMENT_PROPERTY_NAMES.has(segment)),
    ) ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    return;
  }
  const key = path.join('.');
  if (!demands.has(key)) demands.set(key, Object.freeze({ path: key, value }));
}

/** Accepts only self-contained finite primitive syntax. */
function readPreviewGraphqlFragmentLiteral(
  expression: ts.Expression,
): PreviewGraphqlFragmentLiteral | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) {
    const number = Number(value.text);
    return Number.isFinite(number) ? number : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function samePreviewGraphqlFragmentPath(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

/** Reads direct object/array destructuring so unknown documents still receive a useful minimum. */
function collectPreviewGraphqlFragmentRequiredPaths(call: ts.CallExpression): readonly string[] {
  const expression = unwrapParentExpression(call);
  const parent = expression.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === expression) {
    const directPaths = collectBindingPaths(parent.name);
    const owner = findNearestPreviewRuntimeFunction(parent);
    const aliasPaths =
      owner !== undefined && ts.isIdentifier(parent.name)
        ? createPreviewRuntimeHookUsageTreeFallback(
            readPreviewRuntimeHookAliasUsagePaths(parent.name, owner),
          ).requiredPaths
        : [];
    return Object.freeze([...new Set([...directPaths, ...aliasPaths])].slice(0, 64));
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
