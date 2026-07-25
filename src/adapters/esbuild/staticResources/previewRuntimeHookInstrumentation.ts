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
import {
  createPreviewRuntimeHookObjectRestFallback,
  readPreviewRuntimeHookBindingPropertyName,
} from './previewRuntimeHookBindingPattern';
import {
  createPreviewRuntimeHookCallableFallback,
  createPreviewRuntimeHookCallResultFallback,
} from './previewRuntimeHookCallResult';
import { createPreviewRuntimeCallableFallbackExpression } from './previewRuntimeCallableFallback';
import {
  createPreviewRuntimeHookDirectUsageFallback,
  isPreviewRuntimeHookCallableJsxValue,
} from './previewRuntimeHookDirectUsage';
import { inferPreviewRuntimeHookGuardPassFallback } from './previewRuntimeHookGuardValue';
import {
  readPreviewRuntimeHookAliasUsagePaths,
  type PreviewRuntimeHookAliasUsagePath as PreviewRuntimeHookUsagePath,
} from './previewRuntimeHookAliasUsage';
import {
  type PreviewRuntimeHookLocalTypeFallback,
  readPreviewRuntimeHookChildPropUsages,
  type PreviewRuntimeHookChildPropDemandCatalog,
} from './previewRuntimeHookChildPropDemand';
import { applyPreviewRuntimeHookArrayLengthConstraints } from './previewRuntimeHookArrayLengthConstraints';
import type { PreviewRuntimeHookArrayLengthConstraintMetadata } from './previewRuntimeHookArrayLengthConstraints';
import { readPreviewRuntimeHookDestructuredPaths } from './previewRuntimeHookDestructuring';
import { readPreviewRuntimeHookGraphqlArguments } from './previewRuntimeHookGraphqlArguments';
import { readPreviewRuntimeHookIdentityAliasCollectionUsages } from './previewRuntimeHookIdentityAliases';
import { inferPreviewRuntimeLocalHelperArrayItemFallback } from './previewRuntimeHookLocalHelperItem';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import {
  readPreviewRuntimeQueryParamDefaultExpression,
  readPreviewRuntimeQueryStatesDefaults,
} from './previewRuntimeHookQueryDefaults';
import {
  isPreviewRuntimeHookArrayUsageProperty,
  isPreviewRuntimeHookStringUsageProperty,
  readPreviewRuntimeHookPropertyUsage,
  shouldMaterializePreviewRuntimeHookNestedFallback,
} from './previewRuntimeHookPropertyUsage';
import {
  findNearestPreviewRuntimeFunction as findNearestRuntimeFunction,
  hasPreviewRuntimeParseDiagnostics as hasParseDiagnostics,
  isPreviewRuntimeFunction as isRuntimeFunction,
  isPreviewRuntimeJavaScriptLikeSource as isJavaScriptLikeSource,
  readPreviewRuntimeFunctionName,
  selectPreviewRuntimeScriptKind as selectScriptKind,
  unwrapPreviewRuntimeExpression as unwrapExpression,
  unwrapPreviewRuntimeParentExpression as unwrapParentExpression,
  previewRuntimeFunctionShadowsName as functionShadowsName,
} from './previewRuntimeHookSyntax';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import { inferPreviewRuntimeHookSpreadItemFallback } from './previewRuntimeHookSpreadItem';
import { createPreviewRuntimeHookUsageTreeFallback } from './previewRuntimeHookUsageTree';
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
/** Cross-module JSX demand is scoped to its parser tree and released after compilation. */
const childPropDemandsBySourceFile = new WeakMap<
  ts.SourceFile,
  PreviewRuntimeHookChildPropDemandCatalog
>();
/** Imported/local type expansion available only during the current source transformation. */
const localTypeFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  (typeNode: ts.TypeNode) => PreviewRuntimeHookLocalTypeFallback | undefined
>();
/** Import or local-declaration evidence for one callable custom hook binding. */
interface PreviewRuntimeHookBinding {
  /** Authored hook name shown in Inspector diagnostics. */
  readonly hookName: string;
  /** Static module specifier, or `local` for a same-module hook declaration. */
  readonly moduleSpecifier: string;
}
/** Namespace import and its static module specifier used by hook isolation policy. */
type PreviewRuntimeHookNamespace = Readonly<{ moduleSpecifier: string }>;
interface PreviewRuntimeHookInventory {
  /** Local call identifiers mapped to their authored hook identities. */
  readonly direct: ReadonlyMap<string, PreviewRuntimeHookBinding>;
  /** Namespace import identifiers mapped to their source modules. */
  readonly namespaces: ReadonlyMap<string, PreviewRuntimeHookNamespace>;
}
/** Bounded static fallback emitted beside one hook call. */
interface PreviewRuntimeHookFallback extends PreviewRuntimeHookArrayLengthConstraintMetadata {
  /** Human-readable inference description exposed to the user. */
  readonly evidence: string;
  /** TypeScript expression evaluated lazily only after a nullish value or failure. */
  readonly expression: string;
  /** Concise generated-value description that does not execute the expression. */
  readonly label: string;
  /** Optional-only reads materialized after a thrown hook, never over a real nullish sentinel. */
  readonly failurePaths?: readonly string[];
  /** Marks an ignored result as an isolated side effect instead of a visible render blocker. */
  readonly passive?: boolean;
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
  /** Optional-only paths used to shape a caught failure without completing a real object. */
  readonly failurePaths?: readonly string[];
  /** Keeps an authored nullish sentinel when every proven local use is guarded by optional access. */
  readonly preserveNullish?: boolean;
  /** Paths relative to this value that local syntax proves are required. */
  readonly requiredPaths?: readonly string[];
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
 * Identifies one direct imported hook call that the runtime fallback transformer can safely cut.
 *
 * The shallow Page Inspector corridor consumes this syntax-only evidence before bundling. Matching
 * by both local name and source offset prevents an unrelated call in the same module from
 * authorizing projection of a hook reference used by the selected page shell.
 */
export interface PreviewRuntimeHookProjectionEvidence {
  /** Consumer-local import binding used as the direct call target. */
  readonly localName: string;
  /** Source offset of the exact hook identifier admitted by fallback inference. */
  readonly occurrenceStart: number;
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
  childPropDemands?: PreviewRuntimeHookChildPropDemandCatalog,
  localTypeFallback?: (typeNode: ts.TypeNode) => PreviewRuntimeHookLocalTypeFallback | undefined,
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
  if (childPropDemands !== undefined && childPropDemands.size > 0) {
    childPropDemandsBySourceFile.set(sourceFile, childPropDemands);
  }
  if (localTypeFallback !== undefined) {
    localTypeFallbackBySourceFile.set(sourceFile, localTypeFallback);
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

/**
 * Reports imported hook calls that have the same bounded fallback proof as runtime rewriting.
 *
 * Returning evidence only for direct identifiers deliberately excludes namespace calls and local
 * hook declarations: the corridor can replace one imported ESM surface without changing the
 * selected shell's own declarations. Parse failures and unshaped hook results fail open.
 */
export function collectPreviewRuntimeHookProjectionEvidence(
  sourcePath: string,
  sourceText: string,
): readonly PreviewRuntimeHookProjectionEvidence[] {
  if (!isJavaScriptLikeSource(sourcePath) || !sourceText.includes('use')) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return [];
  const inventory = collectRuntimeHookInventory(sourceFile);
  if (inventory.direct.size === 0) return [];
  const evidence = collectRuntimeHookCandidates(sourceFile, sourceText, inventory)
    .slice(0, MAX_HOOKS_PER_MODULE)
    .flatMap((candidate) => {
      const expression = unwrapExpression(candidate.call.expression);
      return ts.isIdentifier(expression)
        ? [
            Object.freeze({
              localName: expression.text,
              occurrenceStart: expression.getStart(sourceFile),
            }),
          ]
        : [];
    });
  return Object.freeze(evidence);
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
        if (fallback !== undefined) {
          candidates.push({
            call: node,
            fallback: applyPreviewRuntimeHookArrayLengthConstraints(node, fallback),
            hook,
          });
        }
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
  const queryStatesDefaults = readPreviewRuntimeQueryStatesDefaults(
    call,
    hook.moduleSpecifier,
    hook.hookName,
    sourceFile,
    sourceText,
  );
  if (queryStatesDefaults !== undefined) {
    return { evidence: 'authored query-state parser defaults', ...queryStatesDefaults };
  }
  if (
    hook.moduleSpecifier === QUERY_PARAM_MODULE &&
    (hook.hookName === 'useQueryParam' || hook.hookName === 'useQueryParams')
  ) {
    const defaultExpression =
      hook.hookName === 'useQueryParam'
        ? readPreviewRuntimeQueryParamDefaultExpression(call, sourceFile, sourceText)
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
      passive: true,
      requiredPaths: [],
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
        ...(bindingFallback.failurePaths === undefined
          ? {}
          : { failurePaths: bindingFallback.failurePaths }),
        ...(bindingFallback.preserveNullish === true ? { preserveNullish: true } : {}),
        ...(bindingFallback.requiredPaths === undefined
          ? {}
          : { requiredPaths: bindingFallback.requiredPaths }),
      };
    }
  }
  const propertyFallback = createDirectPropertyFallback(expression, sourceFile);
  if (propertyFallback !== undefined) {
    return propertyFallback;
  }
  const semanticFallback = inferPreviewRuntimeSemanticFallback(hook.hookName);
  return semanticFallback === undefined
    ? undefined
    : {
        evidence: 'custom hook name semantics',
        expression: semanticFallback.expression,
        label: semanticFallback.label,
        requiredPaths: ['<root>'],
      };
}

/** Creates a binding fallback while leaving defaulted fields absent for authored JS initializers. */
function createBindingFallback(
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
  callResultDepth = 0,
): PreviewRuntimeHookValueFallback | undefined {
  if (ts.isIdentifier(binding)) {
    const usageShape = createIdentifierUsageFallback(binding, sourceFile, callResultDepth);
    if (usageShape !== undefined) return usageShape;
    const semantic = inferPreviewRuntimeSemanticFallback(binding.text);
    const guardPass =
      semantic?.label === 'generated boolean false'
        ? inferPreviewRuntimeHookGuardPassFallback(binding)
        : undefined;
    if (guardPass !== undefined) return { ...guardPass, requiredPaths: ['<root>'] };
    const compared = inferPreviewRuntimeHookLocalScalarFallback(binding, sourceFile);
    if (compared !== undefined) return { ...compared, requiredPaths: ['<root>'] };
    const directUsage = createPreviewRuntimeHookDirectUsageFallback(binding);
    if (directUsage?.callable === true) {
      return createPreviewRuntimeHookCallableFallback(
        directUsage,
        sourceFile,
        callResultDepth,
        createBindingFallback,
      );
    }
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
    const failurePaths: string[] = [];
    const requiredPaths: string[] = [];
    for (const [index, element] of binding.elements.entries()) {
      if (ts.isOmittedExpression(element)) {
        values.push('undefined');
        continue;
      }
      if (element.dotDotDotToken !== undefined) return undefined;
      if (element.initializer !== undefined) {
        values.push('undefined');
        continue;
      }
      const child = createBindingFallback(element.name, sourceFile, callResultDepth);
      const propertyName = String(index);
      values.push(readNestedPreviewRuntimeHookExpression(child, propertyName));
      if (
        child?.failurePaths !== undefined &&
        shouldMaterializePreviewRuntimeHookNestedFallback(child, propertyName)
      ) {
        failurePaths.push(...prefixPreviewRuntimeHookPaths(child.failurePaths, String(index)));
      }
      requiredPaths.push(...prefixPreviewRuntimeHookPaths(child?.requiredPaths, String(index)));
    }
    return {
      expression: `Object.freeze([${values.join(', ')}])`,
      ...(failurePaths.length === 0 ? {} : { failurePaths }),
      label: 'generated tuple',
      requiredPaths,
    };
  }
  const properties: string[] = [];
  const failurePaths: string[] = [];
  const requiredPaths: string[] = [];
  for (const element of binding.elements) {
    if (element.dotDotDotToken !== undefined) {
      const rest = createPreviewRuntimeHookObjectRestFallback(
        createBindingFallback(element.name, sourceFile, callResultDepth),
      );
      if (rest.expression !== undefined) properties.push(rest.expression);
      requiredPaths.push(...rest.requiredPaths);
      continue;
    }
    if (element.initializer !== undefined) continue;
    const propertyName = readPreviewRuntimeHookBindingPropertyName(element);
    if (propertyName === undefined) return undefined;
    const child = createBindingFallback(element.name, sourceFile, callResultDepth) ?? {
      expression: 'Object.freeze({})',
      label: 'static object',
    };
    properties.push(
      `${JSON.stringify(propertyName)}: ${readNestedPreviewRuntimeHookExpression(child, propertyName)}`,
    );
    if (
      child.failurePaths !== undefined &&
      shouldMaterializePreviewRuntimeHookNestedFallback(child, propertyName)
    ) {
      failurePaths.push(...prefixPreviewRuntimeHookPaths(child.failurePaths, propertyName));
    }
    requiredPaths.push(...prefixPreviewRuntimeHookPaths(child.requiredPaths, propertyName));
  }
  return {
    expression: `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`,
    ...(failurePaths.length === 0 ? {} : { failurePaths }),
    label: 'generated object fields',
    requiredPaths,
  };
}

/** Keeps a child's failure shape available when its containing hook result must be synthesized. */
function readNestedPreviewRuntimeHookExpression(
  fallback: PreviewRuntimeHookValueFallback | undefined,
  propertyName: string,
): string {
  return shouldMaterializePreviewRuntimeHookNestedFallback(fallback, propertyName)
    ? (fallback?.expression ?? 'undefined')
    : 'undefined';
}

/** Prefixes child demand paths while keeping a root requirement readable in Inspector diagnostics. */
function prefixPreviewRuntimeHookPaths(
  paths: readonly string[] | undefined,
  propertyName: string,
): readonly string[] {
  /*
   * `undefined` means the child supplied no usage analysis, so destructuring itself is the only
   * proof that the property must exist. An empty array is different: the child was analyzed and
   * every downstream read was optional. Reintroducing the property in that case turns safe code
   * such as `data?.pages` into `{ data: {} }`, bypasses the authored short circuit, and lets a later
   * collection call fail. Keep the child absent until a non-optional descendant proves demand.
   */
  if (paths === undefined) return [propertyName];
  if (paths.length === 0) return [];
  return paths.map((path_) => {
    if (path_ === '<root>') return propertyName;
    if (path_ === '<root>()') return `${propertyName}()`;
    return `${propertyName}.${path_}`;
  });
}

/**
 * Builds a deep object from required property reads rooted at one bound hook result.
 * Array operations synthesize one callback-shaped item so list layouts become visible, while called
 * leaves become inert functions and semantic scalar leaves reuse the deterministic naming policy.
 */
function createIdentifierUsageFallback(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
): PreviewRuntimeHookValueFallback | undefined {
  const owner = findNearestRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const paths: PreviewRuntimeHookUsagePath[] = [];
  const optionalPaths: PreviewRuntimeHookUsagePath[] = [];
  const arrayRootEvidence: string[] = [];
  const arrayItemFallbacks: PreviewRuntimeHookValueFallback[] = [];
  let optionalReferences = 0;
  let unsafeReferences = 0;
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node) && functionShadowsName(node, identifier.text)) {
      return;
    }
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const usagePath = readPreviewRuntimeHookPropertyUsage(node, identifier.text);
      if (usagePath !== undefined && usagePath.names.length > 0) {
        const collectionProperty = usagePath.names.at(-1);
        const spreadCollection = ts.isSpreadElement(node.parent);
        const collection =
          spreadCollection || isPreviewRuntimeHookArrayUsageProperty(collectionProperty);
        const terminalCalled = ts.isCallExpression(node.parent) && node.parent.expression === node;
        const terminalCallable = terminalCalled || isPreviewRuntimeHookCallableJsxValue(node);
        const callResultFallback =
          terminalCalled && !collection && ts.isCallExpression(node.parent)
            ? createPreviewRuntimeHookCallResultFallback(
                node.parent,
                sourceFile,
                callResultDepth + 1,
                createBindingFallback,
              )
            : undefined;
        const collectionItemFallback =
          usagePath.collectionItemType === undefined
            ? spreadCollection
              ? inferPreviewRuntimeHookSpreadItemFallback(node)
              : terminalCalled
                ? inferPreviewRuntimeArrayItemFallback(node, identifier.getSourceFile())
                : undefined
            : localTypeFallbackBySourceFile
                .get(identifier.getSourceFile())
                ?.call(undefined, usagePath.collectionItemType);
        const stringReceiver =
          terminalCalled &&
          isPreviewRuntimeHookStringUsageProperty(collectionProperty) &&
          inferPreviewRuntimeSemanticFallback(usagePath.names.at(-2) ?? identifier.text)?.label !==
            'generated object';
        if (
          !usagePath.optional &&
          collection &&
          !spreadCollection &&
          usagePath.names.length === 1
        ) {
          arrayRootEvidence.push(usagePath.names[0] ?? 'array operation');
          if (collectionItemFallback !== undefined) {
            arrayItemFallbacks.push(collectionItemFallback);
          }
        } else if (paths.length + optionalPaths.length < 64 && usagePath.names.length <= 12) {
          const target = usagePath.optional ? optionalPaths : paths;
          target.push({
            called: !collection && !stringReceiver && terminalCallable,
            ...(callResultFallback === undefined
              ? {}
              : { callResultExpression: callResultFallback.expression }),
            ...(collectionItemFallback?.expression === undefined
              ? {}
              : { collectionItemExpression: collectionItemFallback.expression }),
            ...(collectionItemFallback?.requiredPaths === undefined
              ? {}
              : {
                  collectionItemRequiredPaths: Object.freeze([
                    ...collectionItemFallback.requiredPaths,
                  ]),
                }),
            ...(collection
              ? { collectionProperty: spreadCollection ? 'spread' : (collectionProperty ?? '') }
              : {}),
            names:
              (collection && !spreadCollection) || stringReceiver
                ? usagePath.names.slice(0, -1)
                : usagePath.names,
            ...(stringReceiver ? { stringProperty: collectionProperty ?? '' } : {}),
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
  for (const usage of readPreviewRuntimeHookIdentityAliasCollectionUsages(identifier, owner))
    (usage.optional ? optionalPaths : paths).push({ called: false, ...usage });
  paths.push(...readPreviewRuntimeHookAliasUsagePaths(identifier, owner));
  /*
   * A hook array may reach a child through an identity-preserving transform such as
   * `items.filter(... )`. Such a carrier has no property-name prefix, so retain its inferred child
   * item beside callback-derived candidates instead of trying to serialize it as an object path.
   */
  for (const usage of readPreviewRuntimeHookChildPropUsages(
    identifier,
    childPropDemandsBySourceFile.get(identifier.getSourceFile()),
  )) {
    if (usage.names.length === 0 && usage.collectionProperty !== undefined) {
      arrayRootEvidence.push('child component collection prop');
      if (usage.collectionItemExpression !== undefined) {
        arrayItemFallbacks.push({
          expression: usage.collectionItemExpression,
          label: 'generated child component collection item',
          requiredPaths: usage.collectionItemRequiredPaths ?? [],
        });
      }
    } else {
      paths.push(usage);
    }
  }
  if (arrayRootEvidence.length > 0) {
    const item = [...arrayItemFallbacks].sort(
      (left, right) => (right.requiredPaths?.length ?? 0) - (left.requiredPaths?.length ?? 0),
    )[0] ?? {
      expression: 'Object.freeze({ id: "preview-id", name: "name" })',
      label: 'generated generic preview item',
      requiredPaths: ['id', 'name'],
    };
    return {
      expression: `Object.freeze([${item.expression}])`,
      label: 'generated one-item list from local usage',
      requiredPaths: prefixPreviewRuntimeHookPaths(item.requiredPaths, '[]'),
    };
  }
  if (paths.length === 0 && unsafeReferences === 0) {
    if (optionalReferences === 0) return undefined;
    const optionalFallback = createPreviewRuntimeHookUsageTreeFallback(optionalPaths);
    return {
      expression: optionalFallback.expression,
      failurePaths: optionalFallback.requiredPaths,
      label: 'generated optional failure shape',
      preserveNullish: true,
      requiredPaths: [],
    };
  }
  if (paths.length === 0 && optionalPaths.length === 0) return undefined;
  const fallback = createPreviewRuntimeHookUsageTreeFallback([...paths, ...optionalPaths]);
  return {
    expression: fallback.expression,
    label: 'generated required property shape',
    requiredPaths: fallback.requiredPaths,
  };
}

/** Infers the first array-callback parameter from the fields actually read inside that callback. */
const inferPreviewRuntimeArrayItemFallback = (
  propertyAccess: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookValueFallback | undefined =>
  inferPreviewRuntimeLocalHelperArrayItemFallback(
    propertyAccess,
    sourceFile,
    createBindingFallback,
  );

/** Builds one nested object for a direct non-optional `useHook().field` access. */
function createDirectPropertyFallback(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
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
  const callResult =
    called && ts.isCallExpression(current.parent)
      ? createPreviewRuntimeHookCallResultFallback(
          current.parent,
          sourceFile,
          1,
          createBindingFallback,
        )
      : undefined;
  let child = called
    ? createPreviewRuntimeCallableFallbackExpression(callResult?.expression)
    : (inferPreviewRuntimeSemanticFallback(properties.at(-1) ?? '')?.expression ??
      'Object.freeze({})');
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
    ...(candidate.fallback.failurePaths === undefined
      ? {}
      : { failurePaths: candidate.fallback.failurePaths }),
    ...(candidate.fallback.passive === true ? { passive: true } : {}),
    ...(candidate.fallback.preserveNullish === true ? { preserveNullish: true } : {}),
    ...(candidate.fallback.nonNegativeNumberPaths === undefined
      ? {}
      : { nonNegativeNumberPaths: candidate.fallback.nonNegativeNumberPaths }),
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
        candidate.fallback.nonNegativeNumberPaths ?? [],
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
