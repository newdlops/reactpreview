/** Identifies eligible runtime hook bindings and exact authored call candidates. */
import ts from 'typescript';
import { createPreviewRuntimeCallableFallbackExpression } from './previewRuntimeCallableFallback';
import { applyPreviewRuntimeHookArrayLengthConstraints } from './previewRuntimeHookArrayLengthConstraints';
import { createPreviewRuntimeHookCallResultFallback } from './previewRuntimeHookCallResult';
import { readPreviewRuntimeHookDirectChildPropUsages } from './previewRuntimeHookChildPropDemand';
import {
  createPreviewRuntimeHookCallbackIdentityFallback,
  isPreviewRuntimeDirectHookWrapperReturn,
} from './previewRuntimeHookFallbackSupport';
import { readPreviewRuntimeHookInitialStateExpression } from './previewRuntimeHookInitialState';
import {
  collectPreviewRuntimeStoreFactoryNames,
  readPreviewRuntimeLocalHookDeclaration,
} from './previewRuntimeHookLocalStore';
import {
  childPropDemandsBySourceFile,
  CUSTOM_HOOK_PATTERN,
  DATA_HOOK_FACADE_METHODS,
  EXCLUDED_MODULES,
  LAZY_QUERY_HOOK_PATTERN,
  MAX_METADATA_TEXT_LENGTH,
  QUERY_PARAM_MODULE,
  REACT_CONTEXT_HOOK,
  REACT_MODULE,
  STORE_HOOK_PATTERN,
  type PreviewRuntimeHookBinding,
  type PreviewRuntimeHookCandidate,
  type PreviewRuntimeHookFallback,
  type PreviewRuntimeHookInventory,
  type PreviewRuntimeHookNamespace,
} from './previewRuntimeHookModel';
import { isPreviewRuntimeHookResultReturnedToPackage } from './previewRuntimeHookPackageRoundTrip';
import {
  readPreviewRuntimeQueryParamDefaultExpression,
  readPreviewRuntimeQueryStatesDefaults,
} from './previewRuntimeHookQueryDefaults';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import {
  findNearestPreviewRuntimeFunction as findNearestRuntimeFunction,
  unwrapPreviewRuntimeExpression as unwrapExpression,
  unwrapPreviewRuntimeParentExpression as unwrapParentExpression,
} from './previewRuntimeHookSyntax';
import {
  PREVIEW_RUNTIME_HOOK_TYPED_ONLY_FALLBACK,
  createPreviewRuntimeCallOccurrenceCounter,
  type PreviewRuntimeHookTypedCallResolver,
} from './previewRuntimeHookTypedFallback';
import { createBindingFallback } from './previewRuntimeHookUsageFallback';
import { createPreviewRuntimeHookUsageTreeFallback } from './previewRuntimeHookUsageTree';
import { readPreviewRuntimeStorageReadBinding } from './previewRuntimeStorageRead';

/** Collects eligible imported bindings, namespace bindings, and top-level local custom hooks. */
export function collectRuntimeHookInventory(
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookInventory {
  const direct = new Map<string, PreviewRuntimeHookBinding>();
  const namespaces = new Map<string, PreviewRuntimeHookNamespace>();
  const storeFactoryNames = collectPreviewRuntimeStoreFactoryNames(sourceFile);
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
    const localHook = readPreviewRuntimeLocalHookDeclaration(
      statement,
      storeFactoryNames,
      CUSTOM_HOOK_PATTERN,
    );
    if (localHook !== undefined) direct.set(localHook.hookName, localHook);
  }
  return { direct, namespaces };
}

/** Visits hook calls in source order and retains only calls with a bounded inferred fallback. */
export function collectRuntimeHookCandidates(
  sourceFile: ts.SourceFile,
  sourceText: string,
  inventory: PreviewRuntimeHookInventory,
  resolveTypedCall?: PreviewRuntimeHookTypedCallResolver,
): readonly PreviewRuntimeHookCandidate[] {
  const candidates: PreviewRuntimeHookCandidate[] = [];
  const readOccurrence = createPreviewRuntimeCallOccurrenceCounter();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.questionDotToken === undefined) {
      // A storage parse in render code is a render input like a hook result.
      const hook =
        readRuntimeHookBinding(node.expression, inventory) ??
        readPreviewRuntimeStorageReadBinding(node);
      // Every identical eligible text has the same binding, including top-level and skipped calls.
      const occurrence =
        hook === undefined || resolveTypedCall === undefined
          ? undefined
          : readOccurrence(node.getText(sourceFile));
      if (
        hook !== undefined &&
        !isPreviewRuntimeLazyQueryHook(hook.hookName) &&
        findNearestRuntimeFunction(node) !== undefined
      ) {
        const fallback = inferRuntimeHookFallback(node, hook, sourceFile, sourceText);
        // A declared type must not turn the value that takes the target branch truthy again.
        const typed =
          fallback?.targetExit === true
            ? undefined
            : resolveTypedCall?.(node, sourceFile, fallback?.requiredPaths ?? [], occurrence);
        if (fallback !== undefined || typed !== undefined) {
          candidates.push({
            call: node,
            fallback:
              fallback === undefined
                ? PREVIEW_RUNTIME_HOOK_TYPED_ONLY_FALLBACK
                : applyPreviewRuntimeHookArrayLengthConstraints(node, fallback),
            hook,
            ...(typed === undefined ? {} : { typed, typedOnly: fallback === undefined }),
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
export function isPreviewRuntimeLazyQueryHook(hookName: string): boolean {
  return LAZY_QUERY_HOOK_PATTERN.test(hookName);
}

/** Resolves a direct or namespace hook call back to its statically eligible binding. */
export function readRuntimeHookBinding(
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
export function inferRuntimeHookFallback(
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
        ...(bindingFallback.preserveNullish === true ||
        isPreviewRuntimeHookResultReturnedToPackage(parent.name, hook.moduleSpecifier, sourceFile)
          ? { preserveNullish: true }
          : {}),
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

/** Builds one nested object for a direct non-optional `useHook().field` access. */
export function createDirectPropertyFallback(
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

/**
 * Admits imported hooks independently of package names while retaining explicit React exclusions.
 * Every admitted hook still needs bounded local fallback evidence before any rewrite is emitted.
 */
export function isEligibleHookModule(moduleSpecifier: string): boolean {
  if (EXCLUDED_MODULES.has(moduleSpecifier)) return false;
  return moduleSpecifier.length > 0;
}

/** Bounds diagnostics retained inside one pinned local webview. */
export function boundMetadataText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length <= MAX_METADATA_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_METADATA_TEXT_LENGTH - 1)}…`;
}
