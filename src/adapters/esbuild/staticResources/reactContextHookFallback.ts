/** Coordinates bounded authored-source analysis for reactContextHookFallback. */
import ts from 'typescript';
import type {
  ResolvePreviewRuntimeHookImportedHelperItemFallback,
  ResolvePreviewRuntimeHookImportedHelperParameterFallback,
  ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
} from './previewRuntimeHookAliasUsage';
import type { PreviewRuntimeHookTypedCallResolver } from './previewRuntimeHookTypedFallback';
import { registerPreviewSelectedTargetNames } from './previewSelectedTargetExit';
import {
  collectDirectConstDeclarations,
  collectUniqueLocalRuntimeFunctions,
  inferCandidateAliases,
  wouldBreakOptionalShortCircuit,
} from './reactContextFallbackBindings';
import {
  collectBindingNames,
  collectContextHookImports,
  collectHookCandidates,
  hasParseDiagnostics,
  isProjectRuntimeSource,
  removeShadowedHookImports,
  selectScriptKind,
} from './reactContextFallbackDiscovery';
import {
  EMPTY_TRANSFORM,
  MAX_ALIASES_PER_SCOPE,
  MAX_CANDIDATES_PER_MODULE,
  MAX_GENERATED_FALLBACK_LENGTH,
  MAX_SCOPES_PER_CANDIDATE,
  type HookBoundValue,
  type HookCandidate,
  type HookFallbackPlan,
  type ReactContextHookFallbackRegistration,
  type ReactContextHookFallbackReplacement,
  type ReactContextHookFallbackTransform,
  type RuntimeFunction,
} from './reactContextFallbackModel';
import { addTemplateTextLeaf, inspectScopeOperations } from './reactContextFallbackOperations';
import { collectFallbackRequiredPaths, serializeFallbackShape } from './reactContextFallbackShape';
import {
  allocateFallbackBinding,
  collectDirectNestedFunctions,
  collectIdentifierTexts,
  unwrapExpression,
} from './reactContextFallbackSyntax';
import { createReactContextHookRuntimeReplacement } from './reactContextHookRuntimeReplacement';
import {
  collectLocalFunctionSummaries,
  isGlobalObjectShadowed,
  type LocalFunctionSummary,
} from './reactContextLocalFunctionSummary';

/**
 * Creates hook-call rewrites and stable fallback declarations for one application module.
 *
 * Only value imports whose imported or local name follows `use*Context` are candidates. A hook
 * call is rewritten only when direct object destructuring, a non-optional property read, or a call
 * through a derived property proves that `null`/`undefined` would throw. Optional chains remain
 * admissible only when their receiver stays absent in the generated shape, preserving the authored
 * short circuit. Element access, writes, array binding, and callable/object conflicts invalidate
 * that candidate.
 *
 * @param sourcePath Project JavaScript or TypeScript path used to choose parser grammar.
 * @param sourceText Original source contents used for offsets and unchanged hook-call text.
 * @returns Frozen declaration and replacement arrays, or empty arrays when evidence is unsafe.
 */
export function createReactContextHookFallbackTransform(
  sourcePath: string,
  sourceText: string,
  resolveImportedCollectionCallbackItem?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  resolveImportedHelperParameter?: ResolvePreviewRuntimeHookImportedHelperParameterFallback,
  resolveImportedHelperProperty?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
  resolveTypedCall?: PreviewRuntimeHookTypedCallResolver,
  selectedTargetNames?: ReadonlySet<string>,
): ReactContextHookFallbackTransform {
  if (!isProjectRuntimeSource(sourcePath) || !sourceText.includes('Context')) {
    return EMPTY_TRANSFORM;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return EMPTY_TRANSFORM;
  }
  registerPreviewSelectedTargetNames(sourceFile, selectedTargetNames);

  const importedHooks = collectContextHookImports(sourceFile);
  if (importedHooks.direct.size === 0 && importedHooks.namespaces.size === 0) {
    return EMPTY_TRANSFORM;
  }
  const safeHooks = removeShadowedHookImports(sourceFile, importedHooks);
  const candidates = collectHookCandidates(sourceFile, safeHooks).slice(
    0,
    MAX_CANDIDATES_PER_MODULE,
  );
  if (candidates.length === 0) {
    return EMPTY_TRANSFORM;
  }

  const localFunctionSummaries = collectLocalFunctionSummaries(sourceFile);
  const localReturnFunctions = collectUniqueLocalRuntimeFunctions(sourceFile);
  const usedBindings = collectIdentifierTexts(sourceFile);
  const declarationByShape = new Map<
    string,
    { readonly binding: string; readonly source: string }
  >();
  const declarations: string[] = [];
  const registrations: ReactContextHookFallbackRegistration[] = [];
  const replacements: ReactContextHookFallbackReplacement[] = [];

  for (const candidate of candidates) {
    const plan = createFallbackPlan(candidate, resolveImportedHelperProperty);
    analyzeCandidateScope(
      candidate.owner,
      new Map(),
      plan,
      localFunctionSummaries,
      localReturnFunctions,
      isGlobalObjectShadowed(sourceFile),
      resolveImportedCollectionCallbackItem,
      resolveImportedHelperParameter,
    );
    for (const textPath of plan.templateTextPaths.values()) addTemplateTextLeaf(textPath, plan);
    if (!plan.invalid && plan.required && wouldBreakOptionalShortCircuit(plan)) {
      plan.invalid = true;
    }
    if (plan.invalid || !plan.required) {
      continue;
    }
    const serializedShape = serializeFallbackShape(plan.shape);
    if (serializedShape.length > MAX_GENERATED_FALLBACK_LENGTH) {
      continue;
    }

    let declaration = declarationByShape.get(serializedShape);
    if (declaration === undefined) {
      const binding = allocateFallbackBinding(usedBindings);
      declaration = {
        binding,
        source: `const ${binding} = ${serializedShape};`,
      };
      declarationByShape.set(serializedShape, declaration);
      declarations.push(declaration.source);
    }

    const start = candidate.call.getStart(sourceFile);
    const end = candidate.call.end;
    const originalCall = sourceText.slice(start, end);
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    const calleeStart = candidate.call.expression.getStart(sourceFile);
    const hookExpression = sourceText.slice(calleeStart, candidate.call.expression.end);
    const hookIdentityExpression = readDirectContextIdentityExpression(
      candidate.call,
      sourceFile,
      sourceText,
    );
    const requiredPaths = collectFallbackRequiredPaths(plan.shape);
    const typed = resolveTypedCall?.(candidate.call, sourceFile, requiredPaths);
    replacements.push({
      end,
      fallbackBinding: declaration.binding,
      priority: 2,
      replacement: createReactContextHookRuntimeReplacement({
        column: location.character + 1,
        fallbackBinding: declaration.binding,
        hookName: hookExpression,
        ...(hookIdentityExpression === undefined ? {} : { hookIdentityExpression }),
        line: location.line + 1,
        originalCall,
        renderGuardPaths: [...plan.renderGuardPaths],
        requiredPaths,
        sourcePath,
        start,
        ...(typed === undefined ? {} : { typed }),
      }),
      start,
    });
    registrations.push({
      fallbackBinding: declaration.binding,
      hookExpression,
    });
  }

  return {
    declarations: Object.freeze([...declarations]),
    registrations: Object.freeze(registrations.map((registration) => Object.freeze(registration))),
    replacements: Object.freeze(replacements.sort((left, right) => left.start - right.start)),
  };
}

/**
 * Returns the raw Context identifier from a direct React `useContext(Context)` call.
 * Only an identifier is repeated in the lazy identity thunk, so authored argument evaluation is
 * never duplicated for calls, getters, element access, or other effectful expressions.
 */
function readDirectContextIdentityExpression(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string | undefined {
  const callee = unwrapExpression(call.expression);
  const hookName = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && callee.questionDotToken === undefined
      ? callee.name.text
      : '';
  const contextArgument = call.arguments[0];
  if (hookName !== 'useContext' || call.arguments.length !== 1 || contextArgument === undefined)
    return undefined;
  const identity = unwrapExpression(contextArgument);
  return ts.isIdentifier(identity)
    ? sourceText.slice(contextArgument.getStart(sourceFile), contextArgument.end)
    : undefined;
}

/** Creates the mutable bounded evidence state for one candidate hook call. */
function createFallbackPlan(
  candidate: HookCandidate,
  resolveImportedHelperProperty?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
): HookFallbackPlan {
  return {
    candidate,
    ...(resolveImportedHelperProperty === undefined ? {} : { resolveImportedHelperProperty }),
    invalid: false,
    optionalBasePaths: new Map(),
    required: false,
    renderGuardPaths: new Set(),
    scopeCount: 0,
    shape: { children: new Map(), kind: 'object' },
    shapePaths: new Set(),
    templateTextPaths: new Map(),
  };
}

/**
 * Follows candidate aliases through one lexical function scope and every nested runtime closure.
 * Locals shadow inherited aliases before fixed-point `const` inference, preventing same-name values
 * in callbacks from contributing unrelated requirements to the candidate fallback.
 */
function analyzeCandidateScope(
  scope: RuntimeFunction,
  inheritedBindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localFunctions: ReadonlyMap<string, LocalFunctionSummary>,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
  globalObjectShadowed: boolean,
  resolveImportedCollectionCallbackItem:
    ResolvePreviewRuntimeHookImportedHelperItemFallback | undefined,
  resolveImportedHelperParameter:
    ResolvePreviewRuntimeHookImportedHelperParameterFallback | undefined,
): void {
  plan.scopeCount += 1;
  if (plan.scopeCount > MAX_SCOPES_PER_CANDIDATE || plan.invalid) {
    plan.invalid = true;
    return;
  }
  const declarations = collectDirectConstDeclarations(scope).slice(0, MAX_ALIASES_PER_SCOPE);
  const localNames = new Set<string>();
  for (const parameter of scope.parameters) collectBindingNames(parameter.name, localNames);
  for (const declaration of declarations) collectBindingNames(declaration.name, localNames);
  const bindings = new Map(inheritedBindings);
  for (const localName of localNames) bindings.delete(localName);

  inferCandidateAliases(declarations, bindings, plan, localReturnFunctions);
  inspectScopeOperations(
    scope,
    bindings,
    plan,
    localFunctions,
    localReturnFunctions,
    globalObjectShadowed,
    resolveImportedCollectionCallbackItem,
    resolveImportedHelperParameter,
  );
  for (const nestedFunction of collectDirectNestedFunctions(scope)) {
    analyzeCandidateScope(
      nestedFunction,
      bindings,
      plan,
      localFunctions,
      localReturnFunctions,
      globalObjectShadowed,
      resolveImportedCollectionCallbackItem,
      resolveImportedHelperParameter,
    );
  }
}
export type {
  ReactContextHookFallbackRegistration,
  ReactContextHookFallbackReplacement,
  ReactContextHookFallbackTransform,
} from './reactContextFallbackModel';
