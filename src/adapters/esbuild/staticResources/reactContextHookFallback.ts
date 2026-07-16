/**
 * Derives demand-shaped fallbacks for statically imported custom React Context hooks.
 *
 * The analyzer never imports or executes application modules. It follows only local `const`
 * aliases and direct object destructuring, then materializes the plain object containers and
 * no-op callable leaves that non-optional JavaScript operations prove are required. The generated
 * replacement preserves every real Provider value through `hookCall ?? stableFallback`.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  collectLocalFunctionSummaries,
  isGlobalObjectShadowed,
  isObjectInspectionCall,
  readLocalFunctionSummary,
  type LocalFunctionSummary,
} from './reactContextLocalFunctionSummary';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const CONTEXT_HOOK_NAME_PATTERN = /^use[A-Za-z0-9_$]*Context$/u;
const MAX_ALIASES_PER_SCOPE = 256;
const MAX_CANDIDATES_PER_MODULE = 64;
const MAX_FALLBACK_PATHS = 128;
const MAX_GENERATED_FALLBACK_LENGTH = 8_192;
const MAX_PATH_DEPTH = 16;
const MAX_PROPERTY_NAME_LENGTH = 128;
const MAX_SCOPES_PER_CANDIDATE = 512;

/** One original hook-call replacement suitable for a shared right-to-left source rewrite pass. */
export interface ReactContextHookFallbackReplacement {
  /** Exclusive source offset immediately after the original hook call. */
  readonly end: number;
  /** Module binding that owns the stable deeply frozen fallback. */
  readonly fallbackBinding: string;
  /** Parenthesized nullish fallback expression containing the unchanged original hook call. */
  readonly replacement: string;
  /** Inclusive source offset at the beginning of the original hook call. */
  readonly start: number;
}

/** One runtime-safe hook/fallback pair used by the exact Context identity bridge. */
export interface ReactContextHookFallbackRegistration {
  /** Module binding that owns the stable deeply frozen fallback shape. */
  readonly fallbackBinding: string;
  /** Original import-proven hook callee expression, such as `useAppContext`. */
  readonly hookExpression: string;
}

/** Complete source additions derived for one project module. */
export interface ReactContextHookFallbackTransform {
  /** Module-level `const` declarations appended once and evaluated before React renders. */
  readonly declarations: readonly string[];
  /** Hook identities and shapes that an automatic outer Context boundary may compose. */
  readonly registrations: readonly ReactContextHookFallbackRegistration[];
  /** Ordered, non-overlapping replacements addressing the original source text. */
  readonly replacements: readonly ReactContextHookFallbackReplacement[];
}

/** Direct and namespace imports proven to expose conventionally named Context hooks. */
interface ContextHookImports {
  /** Local bindings for named, aliased, or default hook imports. */
  readonly direct: ReadonlySet<string>;
  /** Namespace bindings admitted only through a `use*Context` property. */
  readonly namespaces: ReadonlySet<string>;
}

/** One hook call and the nearest function whose lexical descendants may consume its result. */
interface HookCandidate {
  /** Original imported-hook call expression replaced after successful inference. */
  readonly call: ts.CallExpression;
  /** Nearest runtime function that owns the hook call. */
  readonly owner: RuntimeFunction;
}

/** Mutable fallback evidence accumulated independently for one hook call. */
interface HookFallbackPlan {
  /** Candidate whose result aliases are being followed. */
  readonly candidate: HookCandidate;
  /** Whether an unsupported or conflicting operation invalidated the entire candidate. */
  invalid: boolean;
  /** Optional-chain receivers that must remain absent for authored short-circuit semantics. */
  readonly optionalBasePaths: Map<string, readonly string[]>;
  /** Number of lexical function scopes traversed under the per-candidate bound. */
  scopeCount: number;
  /** Whether JavaScript proves a non-nullish root is required. */
  required: boolean;
  /** Root plain-object shape serialized only after all evidence is collected. */
  readonly shape: FallbackShape;
  /** Unique materialized paths used to enforce the inference budget. */
  readonly shapePaths: Set<string>;
}

/** A context-derived local value represented by its property path from one hook result. */
interface HookBoundValue {
  /** Static path relative to the custom hook's returned value. */
  readonly path: readonly string[];
}

/** Recursive plain fallback node; callable nodes deliberately cannot own child properties. */
interface FallbackShape {
  /** Deterministically keyed object children, unused for callable leaves. */
  readonly children: Map<string, FallbackShape>;
  /** Plain object container or frozen no-op function leaf. */
  kind: 'callable' | 'object';
}

/** Runtime functions whose bodies can legally contain a React hook call. */
type RuntimeFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

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
  const usedBindings = collectIdentifierTexts(sourceFile);
  const declarationByShape = new Map<
    string,
    { readonly binding: string; readonly source: string }
  >();
  const declarations: string[] = [];
  const registrations: ReactContextHookFallbackRegistration[] = [];
  const replacements: ReactContextHookFallbackReplacement[] = [];

  for (const candidate of candidates) {
    const plan = createFallbackPlan(candidate);
    analyzeCandidateScope(
      candidate.owner,
      new Map(),
      plan,
      localFunctionSummaries,
      isGlobalObjectShadowed(sourceFile),
    );
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
    replacements.push({
      end,
      fallbackBinding: declaration.binding,
      replacement: `(${originalCall} ?? ${declaration.binding})`,
      start,
    });
    const calleeStart = candidate.call.expression.getStart(sourceFile);
    registrations.push({
      fallbackBinding: declaration.binding,
      hookExpression: sourceText.slice(calleeStart, candidate.call.expression.end),
    });
  }

  return {
    declarations: Object.freeze([...declarations]),
    registrations: Object.freeze(registrations.map((registration) => Object.freeze(registration))),
    replacements: Object.freeze(replacements.sort((left, right) => left.start - right.start)),
  };
}

/** Shared immutable empty result returned for unsupported or irrelevant modules. */
const EMPTY_TRANSFORM: ReactContextHookFallbackTransform = Object.freeze({
  declarations: Object.freeze([]),
  registrations: Object.freeze([]),
  replacements: Object.freeze([]),
});

/** Selects TypeScript parser grammar without loading or evaluating a project configuration. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Rejects declarations, dependencies, and non-runtime source extensions. */
function isProjectRuntimeSource(sourcePath: string): boolean {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  return (
    !normalizedPath.includes('/node_modules/') &&
    !normalizedPath.endsWith('.d.ts') &&
    /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(normalizedPath)
  );
}

/** Reads parser recovery diagnostics without invoking the TypeScript type checker. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Collects value-capable direct and namespace imports with conventional Context-hook names. */
function collectContextHookImports(sourceFile: ts.SourceFile): ContextHookImports {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier !== undefined
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (
      importClause?.name !== undefined &&
      CONTEXT_HOOK_NAME_PATTERN.test(importClause.name.text)
    ) {
      direct.add(importClause.name.text);
    }
    const bindings = importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (CONTEXT_HOOK_NAME_PATTERN.test(importedName)) {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/**
 * Removes an imported binding when any non-import declaration shadows it in the module.
 * This intentionally accepts false negatives instead of implementing a complete lexical binder.
 */
function removeShadowedHookImports(
  sourceFile: ts.SourceFile,
  imports: ContextHookImports,
): ContextHookImports {
  const candidates = new Set([...imports.direct, ...imports.namespaces]);
  const shadowed = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingNames(node.name, shadowed, candidates);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)
    ) {
      if (node.name !== undefined && candidates.has(node.name.text)) {
        shadowed.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    direct: new Set([...imports.direct].filter((name) => !shadowed.has(name))),
    namespaces: new Set([...imports.namespaces].filter((name) => !shadowed.has(name))),
  };
}

/** Recursively records identifiers from one binding pattern, optionally filtering candidates. */
function collectBindingNames(
  name: ts.BindingName,
  destination: Set<string>,
  candidates?: ReadonlySet<string>,
): void {
  if (ts.isIdentifier(name)) {
    if (candidates === undefined || candidates.has(name.text)) destination.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, destination, candidates);
    }
  }
}

/** Finds imported hook calls nested inside runtime functions while rejecting optional invocation. */
function collectHookCandidates(
  sourceFile: ts.SourceFile,
  imports: ContextHookImports,
): readonly HookCandidate[] {
  const candidates: HookCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (
      candidates.length < MAX_CANDIDATES_PER_MODULE &&
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      isImportedContextHookCallee(node.expression, imports)
    ) {
      const owner = findNearestRuntimeFunction(node);
      if (owner !== undefined) candidates.push({ call: node, owner });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

/** Recognizes a direct imported hook or one conventional property of an imported namespace. */
function isImportedContextHookCallee(
  expression: ts.Expression,
  imports: ContextHookImports,
): boolean {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) return imports.direct.has(callee.text);
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    CONTEXT_HOOK_NAME_PATTERN.test(callee.name.text)
  ) {
    const owner = unwrapExpression(callee.expression);
    return ts.isIdentifier(owner) && imports.namespaces.has(owner.text);
  }
  return false;
}

/** Locates the closest arrow or function body that safely defers fallback access until invocation. */
function findNearestRuntimeFunction(node: ts.Node): RuntimeFunction | undefined {
  let current: ts.Node = node.parent;
  for (;;) {
    if (isRuntimeFunction(current)) return current;
    if (ts.isSourceFile(current)) return undefined;
    current = current.parent;
  }
}

/** Narrows TypeScript function-like nodes to runtime functions analyzed by this adapter. */
function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  );
}

/** Creates the mutable bounded evidence state for one candidate hook call. */
function createFallbackPlan(candidate: HookCandidate): HookFallbackPlan {
  return {
    candidate,
    invalid: false,
    optionalBasePaths: new Map(),
    required: false,
    scopeCount: 0,
    shape: { children: new Map(), kind: 'object' },
    shapePaths: new Set(),
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
  globalObjectShadowed: boolean,
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

  inferCandidateAliases(declarations, bindings, plan);
  inspectScopeOperations(scope, bindings, plan, localFunctions, globalObjectShadowed);
  for (const nestedFunction of collectDirectNestedFunctions(scope)) {
    analyzeCandidateScope(nestedFunction, bindings, plan, localFunctions, globalObjectShadowed);
  }
}

/** Collects `const` declarations owned by a scope while excluding nested function bodies. */
function collectDirectConstDeclarations(scope: RuntimeFunction): readonly ts.VariableDeclaration[] {
  const declarations: ts.VariableDeclaration[] = [];
  visitDirectScopeNodes(scope, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer !== undefined
    ) {
      declarations.push(node);
    }
  });
  return declarations;
}

/** Resolves direct aliases and object binding patterns in bounded fixed-point passes. */
function inferCandidateAliases(
  declarations: readonly ts.VariableDeclaration[],
  bindings: Map<string, HookBoundValue>,
  plan: HookFallbackPlan,
): void {
  const unresolved = new Set(declarations);
  for (let pass = 0; pass < declarations.length && unresolved.size > 0; pass += 1) {
    let changed = false;
    for (const declaration of [...unresolved]) {
      const initializer = declaration.initializer;
      if (initializer === undefined) continue;
      const resolved = readHookBoundValue(initializer, bindings, plan.candidate.call);
      if (resolved === undefined) continue;
      recordExpressionContainerPrefixes(initializer, resolved.path, plan);
      if (!bindCandidatePattern(declaration.name, resolved.path, bindings, plan)) {
        plan.invalid = true;
        return;
      }
      unresolved.delete(declaration);
      changed = true;
    }
    if (!changed) return;
  }
}

/** Binds an identifier or recursively supported object pattern to one context-result path. */
function bindCandidatePattern(
  name: ts.BindingName,
  valuePath: readonly string[],
  bindings: Map<string, HookBoundValue>,
  plan: HookFallbackPlan,
): boolean {
  if (ts.isIdentifier(name)) {
    bindings.set(name.text, { path: valuePath });
    return true;
  }
  if (!ts.isObjectBindingPattern(name)) return false;
  if (!addObjectContainer(valuePath, plan)) return false;

  for (const element of name.elements) {
    if (element.dotDotDotToken !== undefined || element.initializer !== undefined) return false;
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined) return false;
    const propertyPath = [...valuePath, propertyName];
    if (ts.isIdentifier(element.name)) {
      bindings.set(element.name.text, { path: propertyPath });
    } else if (ts.isObjectBindingPattern(element.name)) {
      if (!addObjectContainer(propertyPath, plan)) return false;
      if (!bindCandidatePattern(element.name, propertyPath, bindings, plan)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** Reads one simple object-binding property name and rejects computed or prototype-sensitive keys. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const propertyNode = element.propertyName;
  const propertyName =
    propertyNode === undefined && ts.isIdentifier(element.name)
      ? element.name.text
      : propertyNode !== undefined &&
          (ts.isIdentifier(propertyNode) ||
            ts.isStringLiteral(propertyNode) ||
            ts.isNumericLiteral(propertyNode))
        ? propertyNode.text
        : undefined;
  return isSafePropertyName(propertyName) ? propertyName : undefined;
}

/**
 * Inspects direct scope operations and records only immediate JavaScript shape requirements.
 * Unknown function arguments and leaf reads remain value-free; unsupported access rooted at the
 * candidate invalidates the rewrite rather than introducing a Proxy or guessed application value.
 */
function inspectScopeOperations(
  scope: RuntimeFunction,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localFunctions: ReadonlyMap<string, LocalFunctionSummary>,
  globalObjectShadowed: boolean,
): void {
  visitDirectScopeNodes(scope, (node) => {
    if (plan.invalid) return;
    if (
      ts.isElementAccessExpression(node) &&
      isRootedAtCandidate(node.expression, bindings, plan)
    ) {
      plan.invalid = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      inspectPropertyAccess(node, bindings, plan);
      return;
    }
    if (ts.isCallExpression(node) && node !== plan.candidate.call) {
      inspectCallExpression(node, bindings, plan, localFunctions, globalObjectShadowed);
    }
  });
}

/** Records object prefixes for a non-optional property read and a callable terminal when invoked. */
function inspectPropertyAccess(
  expression: ts.PropertyAccessExpression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
): void {
  if (expression.questionDotToken !== undefined) {
    // An optional segment does not itself require a fallback. Record its receiver so a fallback
    // already required elsewhere is admitted only when that receiver stays absent and therefore
    // preserves the authored short circuit. Outer operations remain unresolved through this
    // segment instead of inventing work that the original application would never execute.
    if (
      isRootedAtCandidate(expression.expression, bindings, plan) &&
      !recordOptionalBase(expression.expression, bindings, plan)
    ) {
      plan.invalid = true;
    }
    return;
  }
  const resolved = readHookBoundValue(expression, bindings, plan.candidate.call);
  if (resolved === undefined) return;
  if (isWriteTarget(expression)) {
    plan.invalid = true;
    return;
  }
  plan.required = true;
  if (!addProperObjectPrefixes(resolved.path, plan)) {
    plan.invalid = true;
    return;
  }
  if (ts.isCallExpression(expression.parent) && expression.parent.expression === expression) {
    if (!addCallableLeaf(resolved.path, plan)) plan.invalid = true;
  }
}

/** Handles calls through derived context properties plus bounded local object-inspection evidence. */
function inspectCallExpression(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localFunctions: ReadonlyMap<string, LocalFunctionSummary>,
  globalObjectShadowed: boolean,
): void {
  if (call.questionDotToken !== undefined && isRootedAtCandidate(call.expression, bindings, plan)) {
    if (!recordOptionalBase(call.expression, bindings, plan)) plan.invalid = true;
    return;
  }
  const callee = readHookBoundValue(call.expression, bindings, plan.candidate.call);
  if (callee !== undefined) {
    plan.required = true;
    if (
      callee.path.length === 0 ||
      !addProperObjectPrefixes(callee.path, plan) ||
      !addCallableLeaf(callee.path, plan) ||
      isAmbiguousCallResultUse(call)
    ) {
      plan.invalid = true;
    }
    return;
  }

  if (!globalObjectShadowed && isObjectInspectionCall(call)) {
    const argument = call.arguments[0];
    const resolved =
      argument === undefined
        ? undefined
        : readHookBoundValue(argument, bindings, plan.candidate.call);
    if (resolved !== undefined && !addObjectContainer(resolved.path, plan)) plan.invalid = true;
    return;
  }

  const localSummary = readLocalFunctionSummary(call.expression, localFunctions);
  if (localSummary === undefined) return;
  for (const [parameterIndex, relativePaths] of localSummary.objectPathsByParameter) {
    const argument = call.arguments[parameterIndex];
    const resolved =
      argument === undefined
        ? undefined
        : readHookBoundValue(argument, bindings, plan.candidate.call);
    if (resolved === undefined) continue;
    for (const relativePath of relativePaths) {
      if (!addObjectContainer([...resolved.path, ...relativePath], plan)) {
        plan.invalid = true;
        return;
      }
    }
  }
}

/** Accepts only ignored/returned no-op results and rejects chained or awaited method semantics. */
function isAmbiguousCallResultUse(call: ts.CallExpression): boolean {
  const parent = call.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.expression === call) ||
    (ts.isElementAccessExpression(parent) && parent.expression === call) ||
    (ts.isCallExpression(parent) && parent.expression === call) ||
    (ts.isNewExpression(parent) && parent.expression === call) ||
    ts.isAwaitExpression(parent) ||
    (ts.isTaggedTemplateExpression(parent) && parent.tag === call)
  );
}

/** Detects assignment, mutation, or deletion against a derived frozen fallback property. */
function isWriteTarget(expression: ts.PropertyAccessExpression): boolean {
  const parent = expression.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === expression &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true;
  }
  return (
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent) ||
    (ts.isDeleteExpression(parent) && parent.expression === expression)
  );
}

/** Resolves an identifier, the exact candidate call, or a direct property chain to a hook path. */
function readHookBoundValue(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  candidateCall: ts.CallExpression,
): HookBoundValue | undefined {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped === candidateCall) return { path: [] };
  if (ts.isIdentifier(unwrapped)) return bindings.get(unwrapped.text);
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.questionDotToken === undefined &&
    isSafePropertyName(unwrapped.name.text)
  ) {
    const owner = readHookBoundValue(unwrapped.expression, bindings, candidateCall);
    if (owner === undefined || owner.path.length >= MAX_PATH_DEPTH) return undefined;
    return { path: [...owner.path, unwrapped.name.text] };
  }
  return undefined;
}

/**
 * Retains one resolvable optional receiver without requiring it to exist in the fallback.
 * A path is keyed with NUL separators because validated property names cannot contain NUL in
 * generated object syntax, and the original segment array remains available for shape lookup.
 */
function recordOptionalBase(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
): boolean {
  const resolved = readHookBoundValue(expression, bindings, plan.candidate.call);
  if (resolved === undefined || !isSafePath(resolved.path)) return false;
  plan.optionalBasePaths.set(resolved.path.join('\0'), resolved.path);
  return true;
}

/**
 * Rejects a fallback only when it would make an authored optional receiver non-nullish.
 * The root fallback is necessarily present; nested receivers stay safely undefined unless some
 * independently proven non-optional operation materialized that exact path as an object/function.
 */
function wouldBreakOptionalShortCircuit(plan: HookFallbackPlan): boolean {
  for (const path_ of plan.optionalBasePaths.values()) {
    if (path_.length === 0 || hasMaterializedShapePath(plan.shape, path_)) return true;
  }
  return false;
}

/** Reports whether one exact fallback path has already become a concrete object or callable. */
function hasMaterializedShapePath(shape: FallbackShape, path_: readonly string[]): boolean {
  let node = shape;
  for (const propertyName of path_) {
    const child = node.children.get(propertyName);
    if (child === undefined) return false;
    node = child;
  }
  return true;
}

/** Reports whether an unsupported expression still originates from the candidate hook result. */
function isRootedAtCandidate(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped === plan.candidate.call) return true;
  if (ts.isIdentifier(unwrapped)) return bindings.has(unwrapped.text);
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return isRootedAtCandidate(unwrapped.expression, bindings, plan);
  }
  if (ts.isCallExpression(unwrapped)) {
    return isRootedAtCandidate(unwrapped.expression, bindings, plan);
  }
  return false;
}

/** Records initializer evaluation prefixes when a derived alias starts below the hook root. */
function recordExpressionContainerPrefixes(
  initializer: ts.Expression,
  path_: readonly string[],
  plan: HookFallbackPlan,
): void {
  const unwrapped = unwrapExpression(initializer);
  if (!ts.isPropertyAccessExpression(unwrapped)) return;
  plan.required = true;
  if (!addProperObjectPrefixes(path_, plan)) plan.invalid = true;
}

/** Adds every non-leaf prefix because JavaScript must dereference each as an object. */
function addProperObjectPrefixes(path_: readonly string[], plan: HookFallbackPlan): boolean {
  for (let length = 1; length < path_.length; length += 1) {
    if (!addObjectContainer(path_.slice(0, length), plan)) return false;
  }
  return true;
}

/** Adds or verifies one prototype-safe plain object path in the candidate fallback tree. */
function addObjectContainer(path_: readonly string[], plan: HookFallbackPlan): boolean {
  plan.required = true;
  if (!isSafePath(path_) || !reserveShapePath(path_, 'object', plan)) return false;
  let node = plan.shape;
  for (const propertyName of path_) {
    if (node.kind !== 'object') return false;
    let child = node.children.get(propertyName);
    if (child === undefined) {
      child = { children: new Map(), kind: 'object' };
      node.children.set(propertyName, child);
    } else if (child.kind !== 'object') {
      return false;
    }
    node = child;
  }
  return true;
}

/** Adds one frozen no-op function leaf while rejecting object/callable shape conflicts. */
function addCallableLeaf(path_: readonly string[], plan: HookFallbackPlan): boolean {
  if (path_.length === 0 || !isSafePath(path_) || !reserveShapePath(path_, 'callable', plan)) {
    return false;
  }
  let node = plan.shape;
  for (let index = 0; index < path_.length; index += 1) {
    const propertyName = path_[index];
    if (propertyName === undefined || node.kind !== 'object') return false;
    const terminal = index === path_.length - 1;
    let child = node.children.get(propertyName);
    if (terminal) {
      if (child === undefined) {
        child = { children: new Map(), kind: 'callable' };
        node.children.set(propertyName, child);
      }
      return child.kind === 'callable' && child.children.size === 0;
    }
    if (child === undefined) {
      child = { children: new Map(), kind: 'object' };
      node.children.set(propertyName, child);
    } else if (child.kind !== 'object') {
      return false;
    }
    node = child;
  }
  return false;
}

/** Enforces a shared path budget while detecting object/callable evidence conflicts. */
function reserveShapePath(
  path_: readonly string[],
  kind: FallbackShape['kind'],
  plan: HookFallbackPlan,
): boolean {
  const identity = `${path_.join('\0')}\0${kind}`;
  const conflictingIdentity = `${path_.join('\0')}\0${kind === 'object' ? 'callable' : 'object'}`;
  if (plan.shapePaths.has(conflictingIdentity)) return false;
  if (plan.shapePaths.has(identity)) return true;
  if (plan.shapePaths.size >= MAX_FALLBACK_PATHS) return false;
  plan.shapePaths.add(identity);
  return true;
}

/** Validates path depth, segment length, and prototype-pollution sensitive names. */
function isSafePath(path_: readonly string[]): boolean {
  return path_.length <= MAX_PATH_DEPTH && path_.every(isSafePropertyName);
}

/** Narrows an unknown property name to the bounded safe key contract. */
function isSafePropertyName(propertyName: string | undefined): propertyName is string {
  return (
    propertyName !== undefined &&
    propertyName.length > 0 &&
    propertyName.length <= MAX_PROPERTY_NAME_LENGTH &&
    !BLOCKED_PROPERTY_NAMES.has(propertyName)
  );
}

/** Serializes a deterministic deeply frozen plain object and frozen no-op callable leaves. */
function serializeFallbackShape(shape: FallbackShape): string {
  if (shape.kind === 'callable') return 'Object.freeze(() => undefined)';
  const properties = [...shape.children]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([propertyName, child]) =>
        `${JSON.stringify(propertyName)}: ${serializeFallbackShape(child)}`,
    );
  return `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`;
}

/** Allocates a collision-free, human-readable binding retained in generated diagnostics. */
function allocateFallbackBinding(usedBindings: Set<string>): string {
  for (let index = 0; ; index += 1) {
    const candidate = `__reactPreviewContextHookFallback${index.toString()}`;
    if (!usedBindings.has(candidate)) {
      usedBindings.add(candidate);
      return candidate;
    }
  }
}

/** Collects every authored identifier so generated declarations never shadow project code. */
function collectIdentifierTexts(sourceFile: ts.SourceFile): Set<string> {
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifiers;
}

/** Visits nodes owned by one scope and deliberately stops before nested runtime functions. */
function visitDirectScopeNodes(scope: RuntimeFunction, visitor: (node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) return;
    if (node !== scope) visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Returns direct nested runtime functions so inherited aliases can be analyzed with shadowing. */
function collectDirectNestedFunctions(scope: RuntimeFunction): readonly RuntimeFunction[] {
  const functions: RuntimeFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) {
      functions.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return functions;
}

/** Removes syntax-only wrappers without evaluating or simplifying application expressions. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
