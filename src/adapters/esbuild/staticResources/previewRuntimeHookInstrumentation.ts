/**
 * Instruments render-critical project hooks with a visual-only runtime circuit breaker.
 *
 * The analyzer never executes a hook or imports application code in the extension host. It admits
 * only project-like module imports, local custom hooks, and the explicitly state-only
 * `use-query-params` surface. Calls are rewritten only when local syntax can synthesize a bounded
 * fallback from destructuring, a compared literal, a required property, or a semantic name.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import { createPreviewRuntimeHookDirectUsageFallback } from './previewRuntimeHookDirectUsage';
import { readPreviewRuntimeHookDestructuredPaths } from './previewRuntimeHookDestructuring';
import { readPreviewRuntimeHookGraphqlArguments } from './previewRuntimeHookGraphqlArguments';
import {
  findNearestPreviewRuntimeFunction as findNearestRuntimeFunction,
  hasPreviewRuntimeParseDiagnostics as hasParseDiagnostics,
  isPreviewRuntimeFunction as isRuntimeFunction,
  isPreviewRuntimeJavaScriptLikeSource as isJavaScriptLikeSource,
  readPreviewRuntimeCalleePropertyName as readCalleePropertyName,
  readPreviewRuntimeFunctionName,
  selectPreviewRuntimeScriptKind as selectScriptKind,
  unwrapPreviewRuntimeExpression as unwrapExpression,
  unwrapPreviewRuntimeParentExpression as unwrapParentExpression,
} from './previewRuntimeHookSyntax';
import type { PreviewRuntimeFunction as RuntimeFunction } from './previewRuntimeHookSyntax';

const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const MAX_HOOKS_PER_MODULE = 96;
const MAX_METADATA_TEXT_LENGTH = 180;
const CUSTOM_HOOK_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*$/u;
const QUERY_PARAM_MODULE = 'use-query-params';
const REACT_CONTEXT_HOOK = 'useContext';
const REACT_MODULE = 'react';
const EXCLUDED_MODULES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'styled-components',
]);
const ARRAY_USAGE_PROPERTIES = new Set([
  'at',
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'length',
  'map',
  'reduce',
  'some',
]);

/** Import or local-declaration evidence for one callable custom hook binding. */
interface PreviewRuntimeHookBinding {
  /** Authored hook name shown in Inspector diagnostics. */
  readonly hookName: string;
  /** Static module specifier, or `local` for a same-module hook declaration. */
  readonly moduleSpecifier: string;
}

/** Namespace import whose property calls may expose eligible custom hooks. */
interface PreviewRuntimeHookNamespace {
  /** Static module specifier used to decide whether hook failures may be isolated. */
  readonly moduleSpecifier: string;
}

/** Direct and namespace hook bindings proven by one parsed source module. */
interface PreviewRuntimeHookInventory {
  /** Local call identifiers mapped to their authored hook identities. */
  readonly direct: ReadonlyMap<string, PreviewRuntimeHookBinding>;
  /** Namespace import identifiers mapped to their source modules. */
  readonly namespaces: ReadonlyMap<string, PreviewRuntimeHookNamespace>;
}

/** Bounded static fallback emitted beside one hook call. */
interface PreviewRuntimeHookFallback {
  /** Human-readable inference description exposed to the user. */
  readonly evidence: string;
  /** TypeScript expression evaluated lazily only after a nullish value or failure. */
  readonly expression: string;
  /** Concise generated-value description that does not execute the expression. */
  readonly label: string;
  /** Keeps an authored nullish sentinel when every proven local use is guarded by optional access. */
  readonly preserveNullish?: boolean;
  /** Property paths whose absence would stop rendering at this exact hook edge. */
  readonly requiredPaths?: readonly string[];
}

/** Shared scalar/container fallback shape used while recursively walking one binding pattern. */
interface PreviewRuntimeHookValueFallback {
  /** Side-effect-free expression evaluated only inside the preview runtime boundary. */
  readonly expression: string;
  /** Human-readable generated-value family. */
  readonly label: string;
  /** Keeps an authored nullish sentinel when every proven local use is guarded by optional access. */
  readonly preserveNullish?: boolean;
  /** Paths relative to this value that local syntax proves are required. */
  readonly requiredPaths?: readonly string[];
}

/** Mutable property tree used only while serializing one identifier's required local usage. */
interface PreviewRuntimeHookUsageNode {
  /** Nested required properties for an object container. */
  readonly children: Map<string, PreviewRuntimeHookUsageNode>;
  /** Static leaf expression, omitted while the node remains an object container. */
  expression?: string;
}

/** Parsed hook call and inferred fallback before a stable identity is serialized. */
interface PreviewRuntimeHookCandidate {
  /** Exact call expression replaced without changing its arguments. */
  readonly call: ts.CallExpression;
  /** Proven binding metadata for diagnostics and package policy. */
  readonly hook: PreviewRuntimeHookBinding;
  /** Static fallback selected from local syntax. */
  readonly fallback: PreviewRuntimeHookFallback;
}

/**
 * Creates Page Inspector replacements for render-critical project and query-parameter hooks.
 *
 * Replacements call the Inspector API through a global Symbol installed before project modules are
 * evaluated. Normal non-nullish values retain exact identity. A caught non-thenable exception or
 * required nullish value is replaced only while the user-controlled Auto values boundary is on.
 *
 * @param sourcePath Absolute workspace source identity retained in local Inspector diagnostics.
 * @param sourceText Original module source used for parser offsets and generated expressions.
 * @returns Non-overlapping source replacements ordered by their original offsets.
 */
export function createPreviewRuntimeHookReplacements(
  sourcePath: string,
  sourceText: string,
): readonly PreviewSourceReplacement[] {
  if (!isJavaScriptLikeSource(sourcePath) || !sourceText.includes('use')) {
    return [];
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return [];
  }
  const inventory = collectRuntimeHookInventory(sourceFile);
  if (inventory.direct.size === 0 && inventory.namespaces.size === 0) {
    return [];
  }
  const candidates = collectRuntimeHookCandidates(sourceFile, sourceText, inventory).slice(
    0,
    MAX_HOOKS_PER_MODULE,
  );
  return selectNonOverlappingHookReplacements(
    candidates.map((candidate, occurrence) =>
      createRuntimeHookReplacement(sourceFile, sourcePath, sourceText, candidate, occurrence),
    ),
  );
}

/** Collects eligible imported bindings, namespace bindings, and top-level local custom hooks. */
function collectRuntimeHookInventory(sourceFile: ts.SourceFile): PreviewRuntimeHookInventory {
  const direct = new Map<string, PreviewRuntimeHookBinding>();
  const namespaces = new Map<string, PreviewRuntimeHookNamespace>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleSpecifier = statement.moduleSpecifier.text;
      const readsRawReactContext = moduleSpecifier === REACT_MODULE;
      if (!isEligibleHookModule(moduleSpecifier) && !readsRawReactContext) continue;
      const importClause = statement.importClause;
      if (
        !readsRawReactContext &&
        importClause?.name !== undefined &&
        CUSTOM_HOOK_PATTERN.test(importClause.name.text)
      ) {
        direct.set(importClause.name.text, {
          hookName: importClause.name.text,
          moduleSpecifier,
        });
      }
      if (readsRawReactContext && importClause?.name !== undefined) {
        namespaces.set(importClause.name.text, { moduleSpecifier });
      }
      const namedBindings = importClause?.namedBindings;
      if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
        namespaces.set(namedBindings.name.text, { moduleSpecifier });
      } else if (namedBindings !== undefined) {
        for (const element of namedBindings.elements) {
          const hookName = element.propertyName?.text ?? element.name.text;
          if (!CUSTOM_HOOK_PATTERN.test(hookName)) continue;
          if (readsRawReactContext && hookName !== REACT_CONTEXT_HOOK) continue;
          direct.set(element.name.text, { hookName, moduleSpecifier });
        }
      }
      continue;
    }
    const localName = readTopLevelHookDeclarationName(statement);
    if (localName !== undefined) {
      direct.set(localName, { hookName: localName, moduleSpecifier: 'local' });
    }
  }
  return { direct, namespaces };
}

/** Reads a conventional top-level local hook declaration without following assigned expressions. */
function readTopLevelHookDeclarationName(statement: ts.Statement): string | undefined {
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name !== undefined &&
    CUSTOM_HOOK_PATTERN.test(statement.name.text)
  ) {
    return statement.name.text;
  }
  if (!ts.isVariableStatement(statement)) return undefined;
  for (const declaration of statement.declarationList.declarations) {
    if (
      ts.isIdentifier(declaration.name) &&
      CUSTOM_HOOK_PATTERN.test(declaration.name.text) &&
      declaration.initializer !== undefined &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      return declaration.name.text;
    }
  }
  return undefined;
}

/** Visits hook calls in source order and retains only calls with a bounded inferred fallback. */
function collectRuntimeHookCandidates(
  sourceFile: ts.SourceFile,
  sourceText: string,
  inventory: PreviewRuntimeHookInventory,
): readonly PreviewRuntimeHookCandidate[] {
  const candidates: PreviewRuntimeHookCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.questionDotToken === undefined) {
      const hook = readRuntimeHookBinding(node.expression, inventory);
      if (hook !== undefined && findNearestRuntimeFunction(node) !== undefined) {
        const fallback = inferRuntimeHookFallback(node, hook, sourceFile, sourceText);
        if (fallback !== undefined) candidates.push({ call: node, fallback, hook });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

/** Resolves a direct or namespace hook call back to its statically eligible binding. */
function readRuntimeHookBinding(
  expression: ts.LeftHandSideExpression,
  inventory: PreviewRuntimeHookInventory,
): PreviewRuntimeHookBinding | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return inventory.direct.get(unwrapped.text);
  }
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    CUSTOM_HOOK_PATTERN.test(unwrapped.name.text)
  ) {
    const namespace = inventory.namespaces.get(unwrapped.expression.text);
    if (namespace?.moduleSpecifier === REACT_MODULE && unwrapped.name.text !== REACT_CONTEXT_HOOK) {
      return undefined;
    }
    return namespace === undefined
      ? undefined
      : { hookName: unwrapped.name.text, moduleSpecifier: namespace.moduleSpecifier };
  }
  return undefined;
}

/** Selects a specialized tuple fallback before applying general local-use inference. */
function inferRuntimeHookFallback(
  call: ts.CallExpression,
  hook: PreviewRuntimeHookBinding,
  sourceFile: ts.SourceFile,
  sourceText: string,
): PreviewRuntimeHookFallback | undefined {
  if (
    hook.moduleSpecifier === QUERY_PARAM_MODULE &&
    (hook.hookName === 'useQueryParam' || hook.hookName === 'useQueryParams')
  ) {
    const defaultExpression =
      hook.hookName === 'useQueryParam'
        ? readQueryParamDefaultExpression(call, sourceFile, sourceText)
        : 'Object.freeze({})';
    return {
      evidence: 'query parameter default plus an inert local setter',
      expression: `Object.freeze([${defaultExpression}, Object.freeze(() => undefined)])`,
      label: 'static query value + no-op setter',
      requiredPaths: ['0', '1()'],
    };
  }
  const expression = unwrapParentExpression(call);
  const parent = expression.parent;
  if (ts.isExpressionStatement(parent)) {
    return {
      evidence: 'hook return value is intentionally ignored',
      expression: 'undefined',
      label: 'generated ignored hook result',
    };
  }
  if (
    (ts.isJsxExpression(parent) && parent.expression === expression) ||
    (ts.isReturnStatement(parent) && parent.expression === expression)
  ) {
    return {
      evidence: 'hook result is rendered directly',
      expression: 'null',
      label: 'generated empty render value',
    };
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === expression) {
    const bindingFallback = createBindingFallback(parent.name, sourceFile);
    if (bindingFallback !== undefined) {
      return {
        evidence: 'hook result binding and semantic field names',
        expression: bindingFallback.expression,
        label: bindingFallback.label,
        ...(bindingFallback.preserveNullish === true ? { preserveNullish: true } : {}),
        ...(bindingFallback.requiredPaths === undefined
          ? {}
          : { requiredPaths: bindingFallback.requiredPaths }),
      };
    }
  }
  const propertyFallback = createDirectPropertyFallback(expression);
  if (propertyFallback !== undefined) {
    return propertyFallback;
  }
  const semanticFallback = inferSemanticFallback(hook.hookName);
  return semanticFallback === undefined
    ? undefined
    : {
        evidence: 'custom hook name semantics',
        expression: semanticFallback.expression,
        label: semanticFallback.label,
        requiredPaths: ['<root>'],
      };
}

/** Reads `withDefault(codec, value)` from a query-param hook or uses a neutral object. */
function readQueryParamDefaultExpression(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string {
  const codec = call.arguments[1];
  if (codec !== undefined) {
    const unwrapped = unwrapExpression(codec);
    if (
      ts.isCallExpression(unwrapped) &&
      readCalleePropertyName(unwrapped.expression) === 'withDefault' &&
      unwrapped.arguments[1] !== undefined
    ) {
      const fallback = unwrapped.arguments[1];
      return sourceText.slice(fallback.getStart(sourceFile), fallback.end);
    }
  }
  return 'Object.freeze({})';
}

/** Creates an array, object, or semantic scalar from one destructuring/identifier binding. */
function createBindingFallback(
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookValueFallback | undefined {
  if (ts.isIdentifier(binding)) {
    const usageShape = createIdentifierUsageFallback(binding);
    if (usageShape !== undefined) return usageShape;
    const compared = findComparedLiteralFallback(binding, sourceFile);
    if (compared !== undefined) return { ...compared, requiredPaths: ['<root>'] };
    const directUsage = createPreviewRuntimeHookDirectUsageFallback(binding);
    if (directUsage?.callable === true) {
      return { ...directUsage, requiredPaths: ['<root>()'] };
    }
    const semantic = inferSemanticFallback(binding.text);
    if (semantic !== undefined) return { ...semantic, requiredPaths: ['<root>'] };
    if (directUsage !== undefined) {
      return {
        ...directUsage,
        requiredPaths: ['<root>'],
      };
    }
    return undefined;
  }
  if (ts.isArrayBindingPattern(binding)) {
    const values: string[] = [];
    const requiredPaths: string[] = [];
    for (const [index, element] of binding.elements.entries()) {
      if (ts.isOmittedExpression(element)) {
        values.push('undefined');
        continue;
      }
      if (element.dotDotDotToken !== undefined) return undefined;
      const child = createBindingFallback(element.name, sourceFile);
      values.push(child?.expression ?? 'undefined');
      requiredPaths.push(...prefixPreviewRuntimeHookPaths(child?.requiredPaths, String(index)));
    }
    return {
      expression: `Object.freeze([${values.join(', ')}])`,
      label: 'generated tuple',
      requiredPaths,
    };
  }
  const properties: string[] = [];
  const requiredPaths: string[] = [];
  for (const element of binding.elements) {
    if (element.dotDotDotToken !== undefined) return undefined;
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined) return undefined;
    const child = createBindingFallback(element.name, sourceFile) ?? {
      expression: 'Object.freeze({})',
      label: 'static object',
    };
    properties.push(`${JSON.stringify(propertyName)}: ${child.expression}`);
    requiredPaths.push(...prefixPreviewRuntimeHookPaths(child.requiredPaths, propertyName));
  }
  return {
    expression: `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`,
    label: 'generated object fields',
    requiredPaths,
  };
}

/** Prefixes child demand paths while keeping a root requirement readable in Inspector diagnostics. */
function prefixPreviewRuntimeHookPaths(
  paths: readonly string[] | undefined,
  propertyName: string,
): readonly string[] {
  if (paths === undefined || paths.length === 0) return [propertyName];
  return paths.map((path_) => {
    if (path_ === '<root>') return propertyName;
    if (path_ === '<root>()') return `${propertyName}()`;
    return `${propertyName}.${path_}`;
  });
}

/** Reads a safe static key from one object-binding element. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const propertyName = element.propertyName;
  if (propertyName === undefined && ts.isIdentifier(element.name)) return element.name.text;
  if (
    propertyName !== undefined &&
    (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName))
  ) {
    return propertyName.text;
  }
  return undefined;
}

/** Infers a static scalar, collection, object, or no-op function from a semantic local name. */
function inferSemanticFallback(
  rawName: string,
): { readonly expression: string; readonly label: string } | undefined {
  const name = rawName.replace(/^use/u, '');
  const semanticName = name.length === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1);
  const normalized = name.toLowerCase();
  if (/^(?:is|matches)(?:large|wide|desktop)/u.test(normalized)) {
    return {
      expression: `(typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) >= 1024)`,
      label: 'generated viewport match',
    };
  }
  if (/^(?:is|matches)(?:small|narrow|mobile)/u.test(normalized)) {
    return {
      expression: `(typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) < 768)`,
      label: 'generated viewport match',
    };
  }
  if (
    /^(?:is|has|can|should|will|did|does|was|were)(?=[A-Z0-9_$]|$)/u.test(semanticName) ||
    /(?:enabled|disabled|visible|loading|valid|active|selected|checked|suspended|touched|dirty|pristine|pending|matches)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'false', label: 'generated boolean false' };
  }
  if (
    /^(?:set|on|handle|toggle|open|close|submit|refetch|refresh|mutate|dispatch|navigate|reset|update|remove|add)(?=[A-Z0-9_$]|$)/u.test(
      semanticName,
    ) ||
    /(?:handler|callback)$/u.test(normalized)
  ) {
    return { expression: 'Object.freeze(() => undefined)', label: 'generated no-op function' };
  }
  if (
    /(?:items|rows|list|options|results|nodes|edges|records|files|users|companies)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'Object.freeze([])', label: 'generated empty list' };
  }
  if (/(?:count|total|index|length|size|page|amount|rate|percent|number)$/u.test(normalized)) {
    return { expression: '0', label: 'generated number 0' };
  }
  if (
    /(?:props|context|form|data|filter|params|state|values|config|settings|location|router|navigation|user|company|fragment)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'Object.freeze({})', label: 'generated object' };
  }
  if (/(?:fallback|element|component|children|content)$/u.test(normalized)) {
    return { expression: 'null', label: 'generated empty render value' };
  }
  if (/(?:error|exception)$/u.test(normalized)) {
    return { expression: 'null', label: 'generated empty error value' };
  }
  if (/(?:search|query)$/u.test(normalized)) {
    return { expression: JSON.stringify('Preview search'), label: 'generated preview text' };
  }
  if (
    /(?:value|id|name|title|status|type|kind|code|message|description|text|slug|url|path|email)$/u.test(
      normalized,
    )
  ) {
    return {
      expression: JSON.stringify(createSemanticString(normalized)),
      label: 'generated preview text',
    };
  }
  return undefined;
}

/**
 * Builds a deep object from required property reads rooted at one bound hook result.
 * Array operations synthesize one callback-shaped item so list layouts become visible, while called
 * leaves become inert functions and semantic scalar leaves reuse the deterministic naming policy.
 */
function createIdentifierUsageFallback(
  identifier: ts.Identifier,
): PreviewRuntimeHookValueFallback | undefined {
  const owner = findNearestRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const paths: { readonly called: boolean; readonly names: readonly string[] }[] = [];
  const optionalPaths: { readonly called: boolean; readonly names: readonly string[] }[] = [];
  const arrayRootEvidence: string[] = [];
  const arrayItemFallbacks: PreviewRuntimeHookValueFallback[] = [];
  let optionalReferences = 0;
  let unsafeReferences = 0;
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node) && functionShadowsName(node, identifier.text)) {
      return;
    }
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const usagePath = readIdentifierPropertyUsagePath(node, identifier.text);
      if (usagePath !== undefined && usagePath.names.length > 0) {
        if (!usagePath.optional && isArrayUsageProperty(usagePath.names[0])) {
          arrayRootEvidence.push(usagePath.names[0] ?? 'array operation');
          const itemFallback = inferPreviewRuntimeArrayItemFallback(
            node,
            identifier.getSourceFile(),
          );
          if (itemFallback !== undefined) arrayItemFallbacks.push(itemFallback);
        } else if (paths.length + optionalPaths.length < 64 && usagePath.names.length <= 12) {
          const target = usagePath.optional ? optionalPaths : paths;
          target.push({
            called: ts.isCallExpression(node.parent) && node.parent.expression === node,
            names: usagePath.names,
          });
        }
      }
    }
    if (ts.isIdentifier(node) && node.text === identifier.text && node !== identifier) {
      const parent = node.parent;
      const optionalPropertyRoot =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.questionDotToken !== undefined;
      const optionalElementRoot =
        ts.isElementAccessExpression(parent) &&
        parent.expression === node &&
        parent.questionDotToken !== undefined;
      const optionalCallRoot =
        ts.isCallExpression(parent) &&
        parent.expression === node &&
        parent.questionDotToken !== undefined;
      const passiveDependency = ts.isArrayLiteralExpression(parent);
      const passiveObjectProperty =
        ts.isShorthandPropertyAssignment(parent) ||
        (ts.isPropertyAssignment(parent) && parent.initializer === node);
      if (optionalPropertyRoot || optionalElementRoot || optionalCallRoot) {
        optionalReferences += 1;
      } else if (!passiveDependency && !passiveObjectProperty) {
        unsafeReferences += 1;
      }
    }
    if (ts.isVariableDeclaration(node)) {
      for (const names of readPreviewRuntimeHookDestructuredPaths(node, identifier.text)) {
        if (paths.length >= 64) break;
        paths.push({ called: false, names });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (arrayRootEvidence.length > 0) {
    const item = [...arrayItemFallbacks].sort(
      (left, right) => (right.requiredPaths?.length ?? 0) - (left.requiredPaths?.length ?? 0),
    )[0] ?? {
      expression: 'Object.freeze({ id: "preview-id", name: "Preview name" })',
      label: 'generated generic preview item',
      requiredPaths: ['id', 'name'],
    };
    return {
      expression: `Object.freeze([${item.expression}])`,
      label: 'generated one-item list from local usage',
      requiredPaths: prefixPreviewRuntimeHookPaths(item.requiredPaths, '[]'),
    };
  }
  if (paths.length === 0) {
    return optionalReferences > 0 && unsafeReferences === 0
      ? {
          expression: 'undefined',
          label: 'preserved optional hook result',
          preserveNullish: true,
          requiredPaths: [],
        }
      : undefined;
  }
  const completedPaths = deduplicatePreviewRuntimeHookUsagePaths([...paths, ...optionalPaths]);
  const root: PreviewRuntimeHookUsageNode = { children: new Map() };
  for (const path_ of completedPaths) addUsagePath(root, path_);
  return {
    expression: serializeUsageNode(root),
    label: 'generated required property shape',
    requiredPaths: completedPaths.map(
      (path_) => path_.names.join('.') + (path_.called ? '()' : ''),
    ),
  };
}

/** Keeps one deterministic occurrence of every demanded hook-result path. */
function deduplicatePreviewRuntimeHookUsagePaths(
  paths: readonly { readonly called: boolean; readonly names: readonly string[] }[],
): readonly { readonly called: boolean; readonly names: readonly string[] }[] {
  const retained = new Map<
    string,
    { readonly called: boolean; readonly names: readonly string[] }
  >();
  for (const path_ of paths) {
    const key = `${path_.names.join('.')}\u0000${path_.called ? 'call' : 'value'}`;
    if (!retained.has(key)) retained.set(key, path_);
  }
  return [...retained.values()];
}

/** Infers the first array-callback parameter from the fields actually read inside that callback. */
function inferPreviewRuntimeArrayItemFallback(
  propertyAccess: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookValueFallback | undefined {
  const call = propertyAccess.parent;
  if (!ts.isCallExpression(call) || call.expression !== propertyAccess) return undefined;
  const callbackArgument = call.arguments[0];
  if (callbackArgument === undefined) return undefined;
  const callback = unwrapExpression(callbackArgument);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  const itemParameter = callback.parameters[0];
  if (itemParameter === undefined || itemParameter.dotDotDotToken !== undefined) return undefined;
  return createBindingFallback(itemParameter.name, sourceFile);
}

/** Adds one property path into a bounded shape while preserving existing deeper evidence. */
function addUsagePath(
  root: PreviewRuntimeHookUsageNode,
  path_: { readonly called: boolean; readonly names: readonly string[] },
): void {
  let current = root;
  for (const [index, propertyName] of path_.names.entries()) {
    let child = current.children.get(propertyName);
    if (child === undefined) {
      child = { children: new Map() };
      current.children.set(propertyName, child);
    }
    current = child;
    if (index === path_.names.length - 1) {
      current.expression = path_.called
        ? 'Object.freeze(() => undefined)'
        : (inferSemanticFallback(propertyName)?.expression ?? 'Object.freeze({})');
    }
  }
}

/** Serializes one usage tree into deeply frozen plain containers and inferred leaves. */
function serializeUsageNode(node: PreviewRuntimeHookUsageNode): string {
  if (node.children.size === 0) return node.expression ?? 'Object.freeze({})';
  const properties = [...node.children]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([propertyName, child]) => `${JSON.stringify(propertyName)}: ${serializeUsageNode(child)}`,
    );
  return `Object.freeze({ ${properties.join(', ')} })`;
}

/** Reads one property path and remembers whether any link used nullish-safe optional access. */
function readIdentifierPropertyUsagePath(
  expression: ts.PropertyAccessExpression,
  identifierName: string,
): { readonly names: readonly string[]; readonly optional: boolean } | undefined {
  const names: string[] = [];
  let optional = false;
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    optional = optional || current.questionDotToken !== undefined;
    names.unshift(current.name.text);
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) && current.text === identifierName
    ? { names, optional }
    : undefined;
}

/** Recognizes array-oriented operations whose safest visual fallback is an empty collection. */
function isArrayUsageProperty(propertyName: string | undefined): boolean {
  return propertyName !== undefined && ARRAY_USAGE_PROPERTIES.has(propertyName);
}

/** Detects a nested function parameter that would shadow the analyzed hook-result identifier. */
function functionShadowsName(scope: RuntimeFunction, identifierName: string): boolean {
  return scope.parameters.some((parameter) => bindingContainsName(parameter.name, identifierName));
}

/** Recursively checks one parameter binding without inspecting default-value expressions. */
function bindingContainsName(binding: ts.BindingName, identifierName: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === identifierName;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, identifierName),
  );
}

/** Produces recognizable preview text without impersonating application or backend truth. */
function createSemanticString(normalizedName: string): string {
  if (normalizedName.endsWith('id')) return 'preview-id';
  if (normalizedName.endsWith('name')) return 'Preview name';
  if (normalizedName.endsWith('title')) return 'Preview title';
  if (normalizedName.endsWith('status')) return 'PREVIEW';
  if (normalizedName.endsWith('email')) return 'preview@example.invalid';
  return 'Preview value';
}

/** Uses a literal comparison near one identifier when semantic naming alone is inconclusive. */
function findComparedLiteralFallback(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): { readonly expression: string; readonly label: string } | undefined {
  const owner = findNearestRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  let result: { readonly expression: string; readonly label: string } | undefined;
  const visit = (node: ts.Node): void => {
    if (result !== undefined || (node !== owner && isRuntimeFunction(node))) return;
    if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) {
      const other = readComparedExpression(node, identifier.text);
      if (other !== undefined && isStaticComparableExpression(other)) {
        result = {
          expression: other.getText(sourceFile),
          label: 'generated compared value',
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return result;
}

/** Returns the opposite side of an equality when one side is the requested local identifier. */
function readComparedExpression(
  expression: ts.BinaryExpression,
  identifierName: string,
): ts.Expression | undefined {
  const left = unwrapExpression(expression.left);
  const right = unwrapExpression(expression.right);
  if (ts.isIdentifier(left) && left.text === identifierName) return right;
  if (ts.isIdentifier(right) && right.text === identifierName) return left;
  return undefined;
}

/** Admits only literals and enum-like property accesses that cannot call project code. */
function isStaticComparableExpression(expression: ts.Expression): boolean {
  return (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.questionDotToken === undefined &&
      ts.isIdentifier(expression.expression) &&
      /^[A-Z]/u.test(expression.expression.text))
  );
}

/** Recognizes equality operators suitable for a deterministic compared-value fallback. */
function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

/** Builds one nested object for a direct non-optional `useHook().field` access. */
function createDirectPropertyFallback(
  expression: ts.Expression,
): PreviewRuntimeHookFallback | undefined {
  const properties: string[] = [];
  let current: ts.Node = expression;
  while (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) {
    if (current.parent.questionDotToken !== undefined) return undefined;
    properties.push(current.parent.name.text);
    current = current.parent;
  }
  if (properties.length === 0) return undefined;
  const called = ts.isCallExpression(current.parent) && current.parent.expression === current;
  let child = called
    ? 'Object.freeze(() => undefined)'
    : (inferSemanticFallback(properties.at(-1) ?? '')?.expression ?? 'Object.freeze({})');
  for (const propertyName of [...properties].reverse()) {
    child = `Object.freeze({ ${JSON.stringify(propertyName)}: ${child} })`;
  }
  return {
    evidence: `required property access ${properties.map((item) => `.${item}`).join('')}`,
    expression: child,
    label: called ? 'generated callable property' : 'generated property shape',
    requiredPaths: [properties.join('.') + (called ? '()' : '')],
  };
}

/** Creates one stable global resolver call while preserving the original hook invocation once. */
function createRuntimeHookReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  sourceText: string,
  candidate: PreviewRuntimeHookCandidate,
  occurrence: number,
): PreviewSourceReplacement {
  const start = candidate.call.getStart(sourceFile);
  const end = candidate.call.end;
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const originalCall = sourceText.slice(start, end);
  const graphqlArguments = readPreviewRuntimeHookGraphqlArguments(
    candidate.hook.hookName,
    candidate.call,
    sourceFile,
    sourceText,
  );
  const ownerName = readPreviewRuntimeFunctionName(findNearestRuntimeFunction(candidate.call));
  const metadata = {
    column: location.character + 1,
    evidence: boundMetadataText(candidate.fallback.evidence),
    fallbackLabel: candidate.fallback.label,
    hookName: candidate.hook.hookName,
    id: createRuntimeHookIdentity(sourcePath, candidate, occurrence),
    line: location.line + 1,
    moduleSpecifier: candidate.hook.moduleSpecifier,
    ...(ownerName === undefined ? {} : { ownerName }),
    ...(candidate.fallback.preserveNullish === true ? { preserveNullish: true } : {}),
    requiredPaths: candidate.fallback.requiredPaths ?? ['<root>'],
    sourcePath: path.normalize(sourcePath),
  };
  const api = `globalThis[Symbol.for(${JSON.stringify(INSPECTOR_API_SYMBOL)})]`;
  return {
    end,
    ...(candidate.hook.hookName.endsWith('Context') ? { priority: 1 } : {}),
    replacement: `${api}.resolveRuntimeHook(() => (${originalCall}), () => (${candidate.fallback.expression}), ${JSON.stringify(metadata)}${graphqlArguments === undefined ? '' : `, () => (${graphqlArguments.documentExpression})${graphqlArguments.optionsExpression === undefined ? '' : `, () => (${graphqlArguments.optionsExpression})`}`})`,
    start,
  };
}

/** Keeps outer hook calls when nested hook arguments would otherwise create overlapping edits. */
function selectNonOverlappingHookReplacements(
  replacements: readonly PreviewSourceReplacement[],
): readonly PreviewSourceReplacement[] {
  const selected: PreviewSourceReplacement[] = [];
  for (const replacement of [...replacements].sort(
    (left, right) => right.end - right.start - (left.end - left.start),
  )) {
    if (selected.some((item) => replacement.start < item.end && replacement.end > item.start)) {
      continue;
    }
    selected.push(replacement);
  }
  return selected.sort((left, right) => left.start - right.start);
}

/** Creates a hot-reload-stable identity from source semantics and bounded occurrence order. */
function createRuntimeHookIdentity(
  sourcePath: string,
  candidate: PreviewRuntimeHookCandidate,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        path.normalize(sourcePath),
        candidate.hook.moduleSpecifier,
        candidate.hook.hookName,
        candidate.fallback.evidence,
        candidate.fallback.expression,
        candidate.fallback.preserveNullish === true,
        candidate.fallback.requiredPaths ?? ['<root>'],
        occurrence,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}

/**
 * Admits imported hooks independently of package names while retaining explicit React exclusions.
 * Every admitted hook still needs bounded local fallback evidence before any rewrite is emitted.
 */
function isEligibleHookModule(moduleSpecifier: string): boolean {
  if (EXCLUDED_MODULES.has(moduleSpecifier)) return false;
  return moduleSpecifier.length > 0;
}

/** Bounds diagnostics retained inside one pinned local webview. */
function boundMetadataText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length <= MAX_METADATA_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_METADATA_TEXT_LENGTH - 1)}…`;
}
