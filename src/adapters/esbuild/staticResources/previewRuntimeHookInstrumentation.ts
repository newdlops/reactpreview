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
  isPreviewRuntimeHookEmptyRenderableJsxValue,
  isPreviewRuntimeHookCallableJsxValue,
  isPreviewRuntimeHookMutableRefJsxValue,
  isPreviewRuntimeHookRenderedJsxValue,
} from './previewRuntimeHookDirectUsage';
import {
  inferPreviewRuntimeHookExpressionThrowGuardPassFallback,
  inferPreviewRuntimeHookGuardPassFallback,
} from './previewRuntimeHookGuardValue';
import {
  readPreviewRuntimeHookAliasUsagePaths,
  type ResolvePreviewRuntimeHookImportedHelperItemFallback,
  type ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
  type PreviewRuntimeHookAliasUsagePath as PreviewRuntimeHookUsagePath,
} from './previewRuntimeHookAliasUsage';
import {
  inferPreviewRuntimeHookJsxCollectionItemFallback,
  type PreviewRuntimeHookLocalTypeFallback,
  readPreviewRuntimeHookChildPropUsages,
  readPreviewRuntimeHookDirectChildPropUsages,
  type PreviewRuntimeHookChildPropDemandCatalog,
} from './previewRuntimeHookChildPropDemand';
import { applyPreviewRuntimeHookArrayLengthConstraints } from './previewRuntimeHookArrayLengthConstraints';
import type { PreviewRuntimeHookArrayLengthConstraintMetadata } from './previewRuntimeHookArrayLengthConstraints';
import { readPreviewRuntimeHookDestructuredPaths } from './previewRuntimeHookDestructuring';
import { inferPreviewRuntimeHookDynamicElementFallback } from './previewRuntimeHookDynamicElementDemand';
import { readPreviewRuntimeHookGraphqlArguments } from './previewRuntimeHookGraphqlArguments';
import { readPreviewRuntimeHookIdentityAliasCollectionUsages } from './previewRuntimeHookIdentityAliases';
import { readPreviewRuntimeHookInitialStateExpression } from './previewRuntimeHookInitialState';
import { inferPreviewRuntimeHookJsxComponentFallback } from './previewRuntimeHookJsxComponent';
import {
  inferPreviewRuntimeLocalHelperArrayItemFallback,
  type PreviewRuntimeLocalHelperItemFallback,
} from './previewRuntimeHookLocalHelperItem';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import { inferPreviewRuntimeHookLayoutDimensionDemand } from './previewRuntimeHookLayoutDimensionDemand';
import { inferPreviewRuntimeHookMembershipItemFallback } from './previewRuntimeHookMembershipItem';
import { inferPreviewRuntimeHookOverlayStateDemand } from './previewRuntimeHookOverlayStateDemand';
import { inferPreviewRuntimeHookRenderableStateDemand } from './previewRuntimeHookRenderableStateDemand';
import {
  readPreviewRuntimeQueryParamDefaultExpression,
  readPreviewRuntimeQueryStatesDefaults,
} from './previewRuntimeHookQueryDefaults';
import {
  isPreviewRuntimeHookArrayUsageProperty,
  isPreviewRuntimeHookStringUsageProperty,
  readPreviewRuntimeHookLiteralElementUsage,
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
import {
  createPreviewGeneratedListExpression,
  createPreviewRuntimeHookUsageTreeFallback,
} from './previewRuntimeHookUsageTree';
const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const MAX_HOOKS_PER_MODULE = 96;
const MAX_METADATA_TEXT_LENGTH = 180;
const CUSTOM_HOOK_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*$/u;
const STORE_HOOK_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*Store$/u;
const LAZY_QUERY_HOOK_PATTERN = /^use(?:[A-Z0-9_$][A-Za-z0-9_$]*)?LazyQuery$/u;
const QUERY_PARAM_MODULE = 'use-query-params';
const REACT_CONTEXT_HOOK = 'useContext';
const REACT_MODULE = 'react';
const INDEXED_ITEM_ALIAS_DYNAMIC_KEYS = new Set(['0']);
const REDUCE_IDENTITY_CARRIER_METHODS = new Set(['filter', 'slice', 'toReversed', 'toSorted']);
const DATA_HOOK_FACADE_METHODS = new Set([
  'delete',
  'get',
  'mutation',
  'patch',
  'post',
  'put',
  'query',
]);
const EXCLUDED_MODULES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'styled-components',
  'use-immer',
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
/** Direct imported-helper parameter contracts available only during the current transformation. */
const importedHelperItemFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  ResolvePreviewRuntimeHookImportedHelperItemFallback
>();
/** Imported helper object-property contracts available only during the current transformation. */
const importedHelperPropertyFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  ResolvePreviewRuntimeHookImportedHelperPropertyFallback
>();
/** Imported Array-callback parameter contracts available only during the current transformation. */
const importedCollectionCallbackItemFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  ResolvePreviewRuntimeHookImportedHelperItemFallback
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
  /** Keeps a compiler-serialized authored value intact during minimum-path convergence. */
  readonly preserveSmartValue?: true;
  /** Prevents replacing the hook module when its result also crosses an opaque value-flow edge. */
  readonly projectionUnsafe?: true;
  /** Relative scalar paths whose compiler-proven value is required to pass an early render guard. */
  readonly renderGuardPaths?: readonly string[];
  /** Compiler-proven target-only Smart values, kept separate from the dormant Auto fallback. */
  readonly smartPathValueExpressions?: readonly PreviewRuntimeHookSmartPathValueExpression[];
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
  /** True when the fallback covers local reads but not every opaque consumer of this value. */
  readonly projectionUnsafe?: true;
  /** Keeps a generated collection empty when it is passed to a syntax-opaque helper call. */
  readonly neutralCollectionOnOpaqueCall?: true;
  /** Relative scalar paths whose compiler-proven value is required to pass an early render guard. */
  readonly renderGuardPaths?: readonly string[];
  /** Compiler-proven target-only Smart values, kept separate from the dormant Auto fallback. */
  readonly smartPathValueExpressions?: readonly PreviewRuntimeHookSmartPathValueExpression[];
  /** Paths relative to this value that local syntax proves are required. */
  readonly requiredPaths?: readonly string[];
}
/** One side-effect-free authored scalar keyed by its hook-result-relative property path. */
interface PreviewRuntimeHookSmartPathValueExpression {
  readonly expression: string;
  readonly path: string;
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
  importedHelperItemFallback?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  importedHelperPropertyFallback?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
  importedCollectionCallbackItemFallback?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
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
  if (importedHelperItemFallback !== undefined) {
    importedHelperItemFallbackBySourceFile.set(sourceFile, importedHelperItemFallback);
  }
  if (importedHelperPropertyFallback !== undefined) {
    importedHelperPropertyFallbackBySourceFile.set(sourceFile, importedHelperPropertyFallback);
  }
  if (importedCollectionCallbackItemFallback !== undefined) {
    importedCollectionCallbackItemFallbackBySourceFile.set(
      sourceFile,
      importedCollectionCallbackItemFallback,
    );
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
    .filter((candidate) => candidate.fallback.projectionUnsafe !== true)
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
      if (
        hook !== undefined &&
        !isPreviewRuntimeLazyQueryHook(hook.hookName) &&
        findNearestRuntimeFunction(node) !== undefined
      ) {
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

/**
 * Lazy queries return a deferred execute/result tuple, not an ordinary query result.
 * Keeping their authentic lifecycle intact avoids collapsing the tuple into a shallow fallback.
 */
function isPreviewRuntimeLazyQueryHook(hookName: string): boolean {
  return LAZY_QUERY_HOOK_PATTERN.test(hookName);
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
  if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
    const directFacade = inventory.direct.get(unwrapped.expression.text);
    if (
      directFacade !== undefined &&
      (DATA_HOOK_FACADE_METHODS.has(unwrapped.name.text) ||
        (unwrapped.name.text === 'getState' && STORE_HOOK_PATTERN.test(directFacade.hookName)))
    ) {
      return {
        hookName: directFacade.hookName + '.' + unwrapped.name.text,
        moduleSpecifier: directFacade.moduleSpecifier,
      };
    }
    if (!CUSTOM_HOOK_PATTERN.test(unwrapped.name.text)) return undefined;
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
  const initialStateExpression = readPreviewRuntimeHookInitialStateExpression(
    call,
    hook.hookName,
    sourceFile,
  );
  if (initialStateExpression !== undefined) {
    return {
      evidence: 'authored static initial state plus an inert merge setter',
      expression: `Object.freeze([${initialStateExpression}, Object.freeze(() => undefined)])`,
      label: 'authored initial state + no-op setter',
      preserveSmartValue: true,
      requiredPaths: ['0', '1()'],
    };
  }
  const callbackIdentity = createPreviewRuntimeHookCallbackIdentityFallback(
    call,
    hook,
    sourceFile,
    sourceText,
  );
  if (callbackIdentity !== undefined) return callbackIdentity;
  const expression = unwrapParentExpression(call);
  const parent = expression.parent;
  if (isPreviewRuntimeDirectHookWrapperReturn(expression)) {
    return {
      evidence: 'direct hook-wrapper return delegated to its caller contract',
      expression: 'undefined',
      label: 'preserved hook-wrapper result',
      passive: true,
      preserveNullish: true,
      requiredPaths: [],
    };
  }
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
    if (ts.isJsxExpression(parent)) {
      const childUsages = readPreviewRuntimeHookDirectChildPropUsages(
        expression,
        childPropDemandsBySourceFile.get(sourceFile),
      );
      if (childUsages.length > 0) {
        const childFallback = createPreviewRuntimeHookUsageTreeFallback(childUsages);
        return {
          evidence: 'direct child prop and reached component contract',
          expression: childFallback.expression,
          label: 'generated direct child prop shape',
          ...(childFallback.renderGuardPaths.length === 0
            ? {}
            : { renderGuardPaths: childFallback.renderGuardPaths }),
          requiredPaths: childFallback.requiredPaths,
        };
      }
    }
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
        ...(bindingFallback.projectionUnsafe === true ? { projectionUnsafe: true } : {}),
        ...(bindingFallback.renderGuardPaths === undefined
          ? {}
          : { renderGuardPaths: bindingFallback.renderGuardPaths }),
        ...(bindingFallback.smartPathValueExpressions === undefined
          ? {}
          : { smartPathValueExpressions: bindingFallback.smartPathValueExpressions }),
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

/**
 * Preserves a lower-case hook/facade wrapper's return so its instrumented caller can supply shape.
 * React components conventionally begin with an uppercase name; their direct rendered hook result
 * continues through the existing empty-render branch instead of being classified as delegation.
 */
function isPreviewRuntimeDirectHookWrapperReturn(expression: ts.Expression): boolean {
  const owner = findNearestRuntimeFunction(expression);
  const ownerName = readPreviewRuntimeFunctionName(owner);
  if (owner === undefined || ownerName === undefined || /^[A-Z]/u.test(ownerName)) return false;
  if (ts.isArrowFunction(owner) && !ts.isBlock(owner.body)) {
    return unwrapExpression(owner.body) === expression;
  }
  const parent = expression.parent;
  return ts.isReturnStatement(parent) && parent.expression === expression;
}

/**
 * Preserves an authored callback when a callback-wrapper hook is unavailable in a projected module.
 *
 * Hooks such as `useEventCallback(() => ++key.current)` return a stable callable rather than a
 * no-op. Losing its return value can corrupt registration identities before any UI mounts. Returning
 * the callback itself retains the exact closure and defers execution to the same consumer call site;
 * no project code is invoked while the fallback is created.
 */
function createPreviewRuntimeHookCallbackIdentityFallback(
  call: ts.CallExpression,
  hook: PreviewRuntimeHookBinding,
  sourceFile: ts.SourceFile,
  sourceText: string,
): PreviewRuntimeHookFallback | undefined {
  if (!/(?:Callback|EventHandler)$/u.test(hook.hookName)) return undefined;
  const argument = call.arguments[0];
  if (argument === undefined || ts.isSpreadElement(argument)) return undefined;
  const callback = unwrapExpression(argument);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  const originalCallback = sourceText.slice(argument.getStart(sourceFile), argument.end);
  return {
    evidence: 'authored callback passed to a callback-preserving hook',
    expression: `Object.freeze(${originalCallback})`,
    label: 'authored callback identity',
    requiredPaths: ['<root>()'],
  };
}

/** Creates a binding fallback while leaving defaulted fields absent for authored JS initializers. */
function createBindingFallback(
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
  callResultDepth = 0,
): PreviewRuntimeHookValueFallback | undefined {
  if (ts.isIdentifier(binding)) {
    const layoutDimensionDemand = inferPreviewRuntimeHookLayoutDimensionDemand(binding);
    const overlayStateDemand = inferPreviewRuntimeHookOverlayStateDemand(binding, sourceFile);
    const renderableStateDemand = inferPreviewRuntimeHookRenderableStateDemand(binding, sourceFile);
    const withOverlayStateDemand = (
      fallback: PreviewRuntimeHookValueFallback,
    ): PreviewRuntimeHookValueFallback => {
      const safeFallback = createPreviewRuntimeHookProjectionSafeFallback(fallback);
      const smartPathValueExpressions = [
        ...(safeFallback.smartPathValueExpressions ?? []),
        ...(layoutDimensionDemand === undefined
          ? []
          : [
              Object.freeze({
                expression: layoutDimensionDemand.expression,
                path: layoutDimensionDemand.path,
              }),
            ]),
        ...(overlayStateDemand === undefined
          ? []
          : [Object.freeze({ expression: overlayStateDemand.expression, path: '<root>' })]),
        ...(renderableStateDemand === undefined
          ? []
          : [
              Object.freeze({
                expression: renderableStateDemand.expression,
                path: renderableStateDemand.path,
              }),
            ]),
      ];
      return smartPathValueExpressions.length === 0
        ? safeFallback
        : {
            ...safeFallback,
            smartPathValueExpressions: Object.freeze(smartPathValueExpressions),
          };
    };
    const jsxComponent = inferPreviewRuntimeHookJsxComponentFallback(
      binding,
      sourceFile,
      callResultDepth,
      createBindingFallback,
    );
    if (jsxComponent !== undefined) return withOverlayStateDemand(jsxComponent);
    const usageShape = createIdentifierUsageFallback(binding, sourceFile, callResultDepth);
    if (usageShape !== undefined) return withOverlayStateDemand(usageShape);
    const semantic = inferPreviewRuntimeSemanticFallback(binding.text);
    const guardPass =
      semantic?.kind === 'boolean' ? inferPreviewRuntimeHookGuardPassFallback(binding) : undefined;
    if (guardPass !== undefined) {
      return withOverlayStateDemand({
        ...guardPass,
        renderGuardPaths: ['<root>'],
        requiredPaths: ['<root>'],
      });
    }
    const compared = inferPreviewRuntimeHookLocalScalarFallback(binding, sourceFile);
    if (compared !== undefined) {
      return withOverlayStateDemand({
        ...compared,
        ...(compared.renderGuard === true ? { renderGuardPaths: ['<root>'] } : {}),
        requiredPaths: ['<root>'],
      });
    }
    const directUsage = createPreviewRuntimeHookDirectUsageFallback(binding);
    if (directUsage?.callable === true) {
      return withOverlayStateDemand(
        createPreviewRuntimeHookCallableFallback(
          directUsage,
          sourceFile,
          callResultDepth,
          createBindingFallback,
        ),
      );
    }
    if (semantic !== undefined)
      return withOverlayStateDemand({ ...semantic, requiredPaths: ['<root>'] });
    if (directUsage !== undefined) {
      const guardPass =
        directUsage.label === 'generated boolean from local condition'
          ? inferPreviewRuntimeHookGuardPassFallback(binding)
          : undefined;
      if (guardPass !== undefined) {
        return withOverlayStateDemand({
          ...guardPass,
          renderGuardPaths: ['<root>'],
          requiredPaths: ['<root>'],
        });
      }
      return withOverlayStateDemand({
        ...directUsage,
        requiredPaths: ['<root>'],
      });
    }
    if (layoutDimensionDemand !== undefined) {
      return withOverlayStateDemand({
        expression: '0',
        label: 'generated zero layout dimension',
        requiredPaths: ['<root>'],
      });
    }
    return undefined;
  }
  if (ts.isArrayBindingPattern(binding)) {
    const values: string[] = [];
    const failurePaths: string[] = [];
    const renderGuardPaths: string[] = [];
    const smartPathValueExpressions: PreviewRuntimeHookSmartPathValueExpression[] = [];
    const requiredPaths: string[] = [];
    let projectionUnsafe = false;
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
      if (child?.projectionUnsafe === true) projectionUnsafe = true;
      const propertyName = String(index);
      values.push(readNestedPreviewRuntimeHookExpression(child, propertyName));
      if (
        child?.failurePaths !== undefined &&
        shouldMaterializePreviewRuntimeHookNestedFallback(child, propertyName)
      ) {
        failurePaths.push(...prefixPreviewRuntimeHookPaths(child.failurePaths, String(index)));
      }
      renderGuardPaths.push(
        ...prefixPreviewRuntimeHookPaths(child?.renderGuardPaths ?? [], String(index)),
      );
      smartPathValueExpressions.push(
        ...prefixPreviewRuntimeHookSmartPathValues(
          child?.smartPathValueExpressions ?? [],
          String(index),
        ),
      );
      requiredPaths.push(...prefixPreviewRuntimeHookPaths(child?.requiredPaths, String(index)));
    }
    return {
      expression: `Object.freeze([${values.join(', ')}])`,
      ...(failurePaths.length === 0 ? {} : { failurePaths }),
      label: 'generated tuple',
      ...(projectionUnsafe ? { projectionUnsafe: true } : {}),
      ...(renderGuardPaths.length === 0 ? {} : { renderGuardPaths }),
      ...(smartPathValueExpressions.length === 0 ? {} : { smartPathValueExpressions }),
      requiredPaths,
    };
  }
  const properties: string[] = [];
  const failurePaths: string[] = [];
  const renderGuardPaths: string[] = [];
  const smartPathValueExpressions: PreviewRuntimeHookSmartPathValueExpression[] = [];
  const requiredPaths: string[] = [];
  let projectionUnsafe = false;
  for (const element of binding.elements) {
    if (element.dotDotDotToken !== undefined) {
      const rest = createPreviewRuntimeHookObjectRestFallback(
        createBindingFallback(element.name, sourceFile, callResultDepth),
      );
      if (rest.expression !== undefined) properties.push(rest.expression);
      if (rest.projectionUnsafe === true) projectionUnsafe = true;
      requiredPaths.push(...rest.requiredPaths);
      continue;
    }
    if (element.initializer !== undefined) continue;
    const propertyName = readPreviewRuntimeHookBindingPropertyName(element);
    if (propertyName === undefined) return undefined;
    const child: PreviewRuntimeHookValueFallback = createBindingFallback(
      element.name,
      sourceFile,
      callResultDepth,
    ) ?? {
      expression: 'Object.freeze({})',
      label: 'static object',
    };
    if (child.projectionUnsafe === true) projectionUnsafe = true;
    properties.push(
      `${JSON.stringify(propertyName)}: ${readNestedPreviewRuntimeHookExpression(child, propertyName)}`,
    );
    if (
      child.failurePaths !== undefined &&
      shouldMaterializePreviewRuntimeHookNestedFallback(child, propertyName)
    ) {
      failurePaths.push(...prefixPreviewRuntimeHookPaths(child.failurePaths, propertyName));
    }
    renderGuardPaths.push(
      ...prefixPreviewRuntimeHookPaths(child.renderGuardPaths ?? [], propertyName),
    );
    smartPathValueExpressions.push(
      ...prefixPreviewRuntimeHookSmartPathValues(
        child.smartPathValueExpressions ?? [],
        propertyName,
      ),
    );
    requiredPaths.push(...prefixPreviewRuntimeHookPaths(child.requiredPaths, propertyName));
  }
  return {
    expression: `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`,
    ...(failurePaths.length === 0 ? {} : { failurePaths }),
    label: 'generated object fields',
    ...(projectionUnsafe ? { projectionUnsafe: true } : {}),
    ...(renderGuardPaths.length === 0 ? {} : { renderGuardPaths }),
    ...(smartPathValueExpressions.length === 0 ? {} : { smartPathValueExpressions }),
    requiredPaths,
  };
}

/**
 * Keeps an authored empty collection neutral when the same hook value crosses an opaque helper.
 *
 * Local JSX evidence can prove an item shape such as `{ id, role }`, but a package helper may
 * require additional fields that syntax-only analysis cannot see. Populating that collection would
 * replace a valid empty branch with an invalid synthetic item. The empty Array still satisfies the
 * destructuring/container contract and lets the opaque helper observe the hook's safest value.
 */
function createPreviewRuntimeHookProjectionSafeFallback(
  fallback: PreviewRuntimeHookValueFallback,
): PreviewRuntimeHookValueFallback {
  if (fallback.neutralCollectionOnOpaqueCall !== true) {
    return fallback;
  }
  return {
    ...fallback,
    expression: 'Object.freeze([])',
    failurePaths: [],
    renderGuardPaths: [],
    requiredPaths: ['<root>'],
    smartPathValueExpressions: [],
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

/** Prefixes target-only Smart values through one tuple/object destructuring segment. */
function prefixPreviewRuntimeHookSmartPathValues(
  values: readonly PreviewRuntimeHookSmartPathValueExpression[],
  propertyName: string,
): readonly PreviewRuntimeHookSmartPathValueExpression[] {
  return values.map((value) =>
    Object.freeze({
      expression: value.expression,
      path: value.path === '<root>' ? propertyName : `${propertyName}.${value.path}`,
    }),
  );
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
  const indexedItemAliasUsages = readPreviewRuntimeHookIndexedItemAliasUsages(
    identifier,
    owner,
    sourceFile,
    callResultDepth,
  );
  const dynamicElementFallback = inferPreviewRuntimeHookDynamicElementFallback(
    identifier,
    sourceFile,
    indexedItemAliasUsages.length === 0 ? undefined : INDEXED_ITEM_ALIAS_DYNAMIC_KEYS,
  );
  const paths: PreviewRuntimeHookUsagePath[] = [];
  const optionalPaths: PreviewRuntimeHookUsagePath[] = [];
  const arrayRootEvidence: string[] = [];
  const arrayItemFallbacks: PreviewRuntimeHookValueFallback[] = [];
  let optionalReferences = 0;
  let opaqueReferences = 0;
  let opaqueCallArgumentReferences = 0;
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
        const membershipItemFallback = inferPreviewRuntimeHookMembershipItemFallback(
          node,
          usagePath.names.at(-2) ?? identifier.text,
          sourceFile,
        );
        const collection =
          spreadCollection ||
          isPreviewRuntimeHookArrayUsageProperty(collectionProperty) ||
          membershipItemFallback !== undefined;
        const terminalCalled = ts.isCallExpression(node.parent) && node.parent.expression === node;
        const terminalCallable = terminalCalled || isPreviewRuntimeHookCallableJsxValue(node);
        const terminalMutableRef = isPreviewRuntimeHookMutableRefJsxValue(node);
        const terminalEmptyRenderable = isPreviewRuntimeHookEmptyRenderableJsxValue(node);
        const terminalRendered = isPreviewRuntimeHookRenderedJsxValue(node);
        const renderedFallback = terminalRendered
          ? inferPreviewRuntimeSemanticFallback(usagePath.names.at(-1) ?? '')
          : undefined;
        const renderedExpression = terminalRendered
          ? renderedFallback?.kind === 'string' || renderedFallback?.kind === 'number'
            ? renderedFallback.expression
            : JSON.stringify(usagePath.names.at(-1) ?? 'value')
          : undefined;
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
          membershipItemFallback ??
          (usagePath.collectionItemType === undefined
            ? spreadCollection
              ? inferPreviewRuntimeHookSpreadItemFallback(node)
              : terminalCalled
                ? inferPreviewRuntimeArrayItemFallback(node, identifier.getSourceFile())
                : undefined
            : localTypeFallbackBySourceFile
                .get(identifier.getSourceFile())
                ?.call(undefined, usagePath.collectionItemType));
        const stringReceiver =
          terminalCalled &&
          isPreviewRuntimeHookStringUsageProperty(collectionProperty) &&
          inferPreviewRuntimeSemanticFallback(usagePath.names.at(-2) ?? identifier.text)?.label !==
            'generated object';
        const guardPass =
          !terminalCalled && !collection && !stringReceiver
            ? inferPreviewRuntimeHookExpressionThrowGuardPassFallback(node)
            : undefined;
        const guardSemantic = inferPreviewRuntimeSemanticFallback(
          usagePath.names.at(-1) ?? identifier.text,
        );
        const guardValueExpression =
          guardPass === undefined
            ? undefined
            : guardPass.kind === 'boolean' && guardSemantic?.kind !== 'boolean'
              ? guardSemantic?.expression
              : guardPass.expression;
        const valueExpression = terminalMutableRef
          ? '({ current: null })'
          : terminalEmptyRenderable
            ? 'null'
            : (guardValueExpression ?? renderedExpression);
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
            ...(guardPass === undefined ? {} : { renderGuard: true as const }),
            ...(stringReceiver ? { stringProperty: collectionProperty ?? '' } : {}),
            /* Rendering `rows.length` consumes a scalar result, not a numeric rows receiver. */
            ...(valueExpression === undefined || collection ? {} : { valueExpression }),
          });
        }
      }
    }
    if (ts.isElementAccessExpression(node) && paths.length + optionalPaths.length < 64) {
      const elementUsage = readPreviewRuntimeHookLiteralElementUsage(node, identifier.text);
      if (elementUsage !== undefined) {
        const itemFallback = createPreviewRuntimeHookUsageTreeFallback([
          {
            called: elementUsage.itemCalled,
            names: elementUsage.itemNames,
            ...(elementUsage.itemValueExpression === undefined
              ? {}
              : { valueExpression: elementUsage.itemValueExpression }),
          },
        ]);
        paths.push({
          called: false,
          collectionItemExpression: itemFallback.expression,
          collectionItemRequiredPaths: itemFallback.requiredPaths,
          collectionProperty: '[]',
          names: elementUsage.receiverNames,
        });
      }
    }
    if (ts.isIdentifier(node) && node.text === identifier.text && node !== identifier) {
      const parent = node.parent;
      const argumentExpression = unwrapParentExpression(node);
      const argument =
        ts.isSpreadElement(argumentExpression.parent) &&
        argumentExpression.parent.expression === argumentExpression
          ? argumentExpression.parent
          : argumentExpression;
      const opaqueCallArgument =
        ts.isCallExpression(argument.parent) &&
        argument.parent.arguments.some((candidate) => candidate === argument);
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
      const handledPropertyRoot =
        ts.isPropertyAccessExpression(parent) && parent.expression === node;
      const handledCallRoot = ts.isCallExpression(parent) && parent.expression === node;
      const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (optionalPropertyRoot || optionalElementRoot || optionalCallRoot) {
        optionalReferences += 1;
      } else if (!passiveDependency && !passiveObjectProperty) {
        unsafeReferences += 1;
        if (!handledPropertyRoot && !handledCallRoot && !propertyName) {
          opaqueReferences += 1;
          if (opaqueCallArgument) opaqueCallArgumentReferences += 1;
        }
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
  paths.push(...indexedItemAliasUsages);
  for (const usage of readPreviewRuntimeHookIdentityAliasCollectionUsages(identifier, owner))
    (usage.optional ? optionalPaths : paths).push({ called: false, ...usage });
  const childPropUsages = readPreviewRuntimeHookChildPropUsages(
    identifier,
    childPropDemandsBySourceFile.get(identifier.getSourceFile()),
  );
  const childProvenCollectionPaths = new Set(
    childPropUsages
      .filter((usage) => usage.collectionProperty !== undefined)
      .map((usage) => usage.names.join('.')),
  );
  paths.push(
    ...readPreviewRuntimeHookAliasUsagePaths(
      identifier,
      owner,
      importedHelperItemFallbackBySourceFile.get(identifier.getSourceFile()),
      importedHelperPropertyFallbackBySourceFile.get(identifier.getSourceFile()),
      importedCollectionCallbackItemFallbackBySourceFile.get(identifier.getSourceFile()),
      childProvenCollectionPaths,
    ),
  );
  /*
   * A hook array may reach a child through an identity-preserving transform such as
   * `items.filter(... )`. Such a carrier has no property-name prefix, so retain its inferred child
   * item beside callback-derived candidates instead of trying to serialize it as an object path.
   */
  for (const usage of childPropUsages) {
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
  const jsxCollectionItemFallback = inferPreviewRuntimeHookJsxCollectionItemFallback(identifier);
  if (jsxCollectionItemFallback !== undefined) {
    arrayRootEvidence.push('JSX collection configuration');
    arrayItemFallbacks.push(jsxCollectionItemFallback);
  }
  if (arrayRootEvidence.length > 0) {
    const item = [...arrayItemFallbacks].sort(
      (left, right) => (right.requiredPaths?.length ?? 0) - (left.requiredPaths?.length ?? 0),
    )[0] ?? {
      expression: 'Object.freeze({ id: "preview-id", name: "name" })',
      label: 'generated generic preview item',
      requiredPaths: ['id', 'name'],
    };
    const exactMembership = item.label === 'authored collection membership item';
    return {
      expression: exactMembership
        ? `Object.freeze([${item.expression}])`
        : createPreviewGeneratedListExpression(item.expression),
      label: exactMembership
        ? 'generated one-item list from local usage'
        : 'generated sample list from local usage',
      ...(opaqueCallArgumentReferences > 0 ? { neutralCollectionOnOpaqueCall: true } : {}),
      ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
      requiredPaths: prefixPreviewRuntimeHookPaths(item.requiredPaths, '[]'),
    };
  }
  if (paths.length === 0 && dynamicElementFallback !== undefined) {
    return opaqueReferences === 0
      ? dynamicElementFallback
      : { ...dynamicElementFallback, projectionUnsafe: true };
  }
  if (paths.length === 0 && unsafeReferences === 0) {
    if (optionalReferences === 0) return undefined;
    const optionalFallback = createPreviewRuntimeHookUsageTreeFallback(optionalPaths);
    return {
      expression: optionalFallback.expression,
      failurePaths: optionalFallback.requiredPaths,
      label: 'generated optional failure shape',
      preserveNullish: true,
      ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
      requiredPaths: [],
    };
  }
  if (paths.length === 0 && optionalPaths.length === 0) return undefined;
  const fallback = createPreviewRuntimeHookUsageTreeFallback([...paths, ...optionalPaths]);
  if (dynamicElementFallback !== undefined) {
    return {
      expression: `Object.freeze(Object.assign({}, ${fallback.expression}, ${dynamicElementFallback.expression}))`,
      label: 'generated required and computed property shape',
      ...(fallback.renderGuardPaths.length === 0
        ? {}
        : { renderGuardPaths: fallback.renderGuardPaths }),
      ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
      requiredPaths: Object.freeze([
        ...new Set([...fallback.requiredPaths, ...dynamicElementFallback.requiredPaths]),
      ]),
    };
  }
  return {
    expression: fallback.expression,
    label: 'generated required property shape',
    ...(opaqueReferences > 0 ? { projectionUnsafe: true } : {}),
    ...(fallback.renderGuardPaths.length === 0
      ? {}
      : { renderGuardPaths: fallback.renderGuardPaths }),
    requiredPaths: fallback.requiredPaths,
  };
}

/**
 * Carries item demand through one exact immutable `const item = collection[0]` local alias.
 *
 * This deliberately stays narrower than general identity aliases: only a unique same-function
 * binding from the literal zero index is admitted, and nested scopes that reuse either local make
 * the proof ambiguous. The item fallback is still derived entirely from syntax; no authored code
 * is evaluated.
 */
function readPreviewRuntimeHookIndexedItemAliasUsages(
  identifier: ts.Identifier,
  owner: ReturnType<typeof findNearestRuntimeFunction>,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
): readonly PreviewRuntimeHookUsagePath[] {
  if (owner === undefined) return [];
  const declarations: ts.VariableDeclaration[] = [];
  const bindingCounts = new Map<string, number>();
  const nestedBindingCounts = new Map<string, number>();
  const appendBindings = (binding: ts.BindingName, counts: Map<string, number>): void => {
    if (ts.isIdentifier(binding)) {
      counts.set(binding.text, (counts.get(binding.text) ?? 0) + 1);
      return;
    }
    for (const element of binding.elements) {
      if (!ts.isOmittedExpression(element)) appendBindings(element.name, counts);
    }
  };
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node)) {
      forEachBindingInRuntimeFunction(node, (binding) => appendBindings(binding, nestedBindingCounts));
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      declarations.push(node);
      appendBindings(node.name, bindingCounts);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (bindingCounts.get(identifier.text) !== 1) return [];
  const usages: PreviewRuntimeHookUsagePath[] = [];
  for (const declaration of declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
    const alias = declaration.name;
    if (bindingCounts.get(alias.text) !== 1 || nestedBindingCounts.has(alias.text)) continue;
    const initializer = unwrapExpression(declaration.initializer);
    const collectionExpression = ts.isElementAccessExpression(initializer)
      ? unwrapExpression(initializer.expression)
      : undefined;
    const indexExpression =
      ts.isElementAccessExpression(initializer) && initializer.argumentExpression !== undefined
        ? unwrapExpression(initializer.argumentExpression)
        : undefined;
    if (
      !ts.isElementAccessExpression(initializer) ||
      initializer.questionDotToken !== undefined ||
      collectionExpression === undefined ||
      !ts.isIdentifier(collectionExpression) ||
      collectionExpression.text !== identifier.text ||
      indexExpression === undefined ||
      !ts.isNumericLiteral(indexExpression) ||
      indexExpression.text !== '0'
    ) {
      continue;
    }
    const item = createIdentifierUsageFallback(alias, sourceFile, callResultDepth);
    if (item === undefined || item.projectionUnsafe === true) continue;
    usages.push({
      called: false,
      collectionItemExpression: item.expression,
      ...(item.requiredPaths === undefined
        ? {}
        : { collectionItemRequiredPaths: item.requiredPaths }),
      collectionProperty: '[]',
      names: [],
    });
  }
  return usages;
}

/** Counts parameter and local names below one nested function without traversing another scope. */
function forEachBindingInRuntimeFunction(
  scope: ReturnType<typeof findNearestRuntimeFunction>,
  consume: (binding: ts.BindingName) => void,
): void {
  if (scope === undefined) return;
  for (const parameter of scope.parameters) consume(parameter.name);
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) return;
    if (ts.isVariableDeclaration(node)) consume(node.name);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Infers the first array-callback parameter from the fields actually read inside that callback. */
export const inferPreviewRuntimeArrayItemFallback = (
  propertyAccess: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
): PreviewRuntimeLocalHelperItemFallback | undefined => {
  const primary = inferPreviewRuntimeLocalHelperArrayItemFallback(
    propertyAccess,
    sourceFile,
    createBindingFallback,
  );
  const reducePropertyAccess = findPreviewRuntimeIdentityChainedReduce(propertyAccess);
  if (reducePropertyAccess === undefined) return primary;
  const call = reducePropertyAccess.parent;
  const callbackArgument =
    ts.isCallExpression(call) && call.expression === reducePropertyAccess
      ? call.arguments[0]
      : undefined;
  const callback = callbackArgument === undefined ? undefined : unwrapExpression(callbackArgument);
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return primary;
  }
  const itemParameter = callback.parameters[1];
  if (itemParameter === undefined || itemParameter.dotDotDotToken !== undefined) return primary;
  const item = createBindingFallback(itemParameter.name, sourceFile);
  if (item === undefined) return primary;
  if (primary === undefined) return item;
  if (
    !primary.expression.startsWith('Object.freeze({') ||
    !item.expression.startsWith('Object.freeze({')
  ) {
    return primary;
  }
  return {
    expression: `Object.freeze(Object.assign({}, ${primary.expression}, ${item.expression}))`,
    label: 'generated reduce collection item',
    requiredPaths: Object.freeze([
      ...new Set([...(primary.requiredPaths ?? []), ...(item.requiredPaths ?? [])]),
    ]),
  };
};

/** Follows only identity-preserving Array operations from one reached receiver into `reduce`. */
function findPreviewRuntimeIdentityChainedReduce(
  propertyAccess: ts.PropertyAccessExpression,
): ts.PropertyAccessExpression | undefined {
  let current = propertyAccess;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current.name.text === 'reduce') return current;
    if (!REDUCE_IDENTITY_CARRIER_METHODS.has(current.name.text)) return undefined;
    const call = current.parent;
    if (!ts.isCallExpression(call) || call.expression !== current) return undefined;
    const callValue = unwrapParentExpression(call);
    const next = callValue.parent;
    if (!ts.isPropertyAccessExpression(next) || next.expression !== callValue) return undefined;
    current = next;
  }
  return undefined;
}

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
  const hookIdentityExpression = sourceText.slice(
    candidate.call.expression.getStart(sourceFile),
    candidate.call.expression.end,
  );
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
    ...(candidate.fallback.preserveSmartValue === true ? { preserveSmartValue: true } : {}),
    ...(candidate.fallback.renderGuardPaths === undefined
      ? {}
      : { renderGuardPaths: candidate.fallback.renderGuardPaths }),
    ...(candidate.fallback.nonNegativeNumberPaths === undefined
      ? {}
      : { nonNegativeNumberPaths: candidate.fallback.nonNegativeNumberPaths }),
    requiredPaths: candidate.fallback.requiredPaths ?? ['<root>'],
    sourcePath: path.normalize(sourcePath),
  };
  const api = `globalThis[Symbol.for(${JSON.stringify(INSPECTOR_API_SYMBOL)})]`;
  const metadataExpression =
    candidate.fallback.smartPathValueExpressions === undefined ||
    candidate.fallback.smartPathValueExpressions.length === 0
      ? JSON.stringify(metadata)
      : `Object.assign(${JSON.stringify(metadata)}, { smartPathValues: Object.freeze([${candidate.fallback.smartPathValueExpressions
          .map(
            (value) =>
              `Object.freeze({ path: ${JSON.stringify(value.path)}, value: (${value.expression}) })`,
          )
          .join(', ')}]) })`;
  const graphqlRuntimeArguments =
    graphqlArguments === undefined
      ? ', undefined, undefined'
      : `, () => (${graphqlArguments.documentExpression})${
          graphqlArguments.optionsExpression === undefined
            ? ', undefined'
            : `, () => (${graphqlArguments.optionsExpression})`
        }`;
  return {
    end,
    ...(candidate.hook.hookName.endsWith('Context') ? { priority: 1 } : {}),
    replacement: `${api}.resolveRuntimeHook(() => (${originalCall}), () => (${candidate.fallback.expression}), ${metadataExpression}${graphqlRuntimeArguments}, () => (${hookIdentityExpression}))`,
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
