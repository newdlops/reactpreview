/**
 * Proves same-module identities between custom React Context hooks and local Context objects.
 *
 * The analyzer is intentionally syntax-only. It recognizes React APIs only through value imports
 * from the exact `react` specifier, accepts only immutable top-level Context declarations, and
 * requires a conventionally named hook to return `useContext(localContext)` directly. It never
 * resolves another module, evaluates a default value, or assumes that a name containing
 * "Context" belongs to React. These narrow facts can later drive preview-only runtime registration
 * without importing an application bootstrap or confusing unrelated custom hooks.
 */
import path from 'node:path';
import ts from 'typescript';

const CONTEXT_HOOK_NAME_PATTERN = /^use[A-Za-z0-9_$]*Context$/u;
const MAX_CONTEXT_CANDIDATES = 64;
const MAX_HOOK_CANDIDATES = 64;
const MAX_IDENTITY_PAIRS = 64;
const MAX_SOURCE_CHARACTERS = 4 * 1024 * 1024;
const MAX_TOP_LEVEL_STATEMENTS = 4_096;

/** One proven local hook and the exact local Context binding read by that hook. */
export interface ReactContextIdentityPair {
  /** Identifier bound to a top-level immutable React Context object. */
  readonly contextBinding: string;
  /** Identifier bound to the top-level custom hook that directly reads the Context. */
  readonly hookBinding: string;
}

/** Complete bounded identity result for one project-owned runtime source module. */
export interface ReactContextIdentityInventory {
  /** Safe local hook/Context pairs in hook declaration order. */
  readonly pairs: readonly ReactContextIdentityPair[];
  /** Whether a source or candidate budget prevented complete analysis. */
  readonly truncated: boolean;
}

/** React value-import bindings that can identify the two supported Context APIs. */
interface ReactImportBindings {
  /** Direct named bindings imported as React `createContext`. */
  readonly createContext: ReadonlySet<string>;
  /** Default or namespace bindings used as `React.createContext` and `React.useContext`. */
  readonly objects: ReadonlySet<string>;
  /** Direct named bindings imported as React `useContext`. */
  readonly useContext: ReadonlySet<string>;
}

/** One recognized React import registration before ambiguity and shadow filtering. */
interface ReactImportRegistration {
  /** Which supported React access form owns the local binding. */
  readonly kind: keyof ReactImportBindings;
  /** Number of import declarations that attempted to create this local binding. */
  readonly occurrences: number;
}

/** Immutable local Context declaration retained only for identity matching. */
interface LocalContextDeclaration {
  /** Local identifier referenced by a direct `useContext` argument. */
  readonly binding: string;
}

/** Top-level hook implementation and its stable authored source order. */
interface LocalHookDeclaration {
  /** Local identifier used by generated runtime registration. */
  readonly binding: string;
  /** Arrow or function implementation whose direct return is inspected. */
  readonly implementation: RuntimeFunction;
  /** Source offset used to return deterministic declaration order. */
  readonly start: number;
}

/** Runtime function forms admitted for direct custom Context hook declarations. */
type RuntimeFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Shared immutable result for irrelevant, malformed, or unsupported source. */
const EMPTY_INVENTORY: ReactContextIdentityInventory = Object.freeze({
  pairs: Object.freeze([]),
  truncated: false,
});

/** Shared immutable result used when a safety budget prevents complete identity proof. */
const TRUNCATED_INVENTORY: ReactContextIdentityInventory = Object.freeze({
  pairs: Object.freeze([]),
  truncated: true,
});

/**
 * Collects safe local custom-hook/Context identities from one project runtime module.
 *
 * Supported Contexts have the form `const C = createContext(...)` or
 * `const C = React.createContext(...)`. Supported hooks are top-level function declarations or
 * immutable arrow/function expressions named `use*Context`; their expression body or sole block
 * statement must return `useContext(C)` directly. Named aliases, React default imports, and React
 * namespace imports are supported. Type-only imports, shadowing, reassignable declarations,
 * indirect aliases, optional calls, nested hooks, and ambiguous declarations fail closed.
 *
 * @param sourcePath Absolute or project-relative path used to select runtime parser grammar.
 * @param sourceText Current editor or filesystem source text; it is parsed but never executed.
 * @returns Frozen identity pairs, plus a truncation flag suitable for future diagnostics.
 */
export function collectReactContextIdentityPairs(
  sourcePath: string,
  sourceText: string,
): ReactContextIdentityInventory {
  if (!isProjectRuntimeSource(sourcePath)) {
    return EMPTY_INVENTORY;
  }
  if (sourceText.length > MAX_SOURCE_CHARACTERS) {
    return TRUNCATED_INVENTORY;
  }

  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return EMPTY_INVENTORY;
  }
  if (sourceFile.statements.length > MAX_TOP_LEVEL_STATEMENTS) {
    return TRUNCATED_INVENTORY;
  }

  const topLevelBindingCounts = collectTopLevelBindingCounts(sourceFile);
  const reactBindings = collectReactImportBindings(sourceFile, topLevelBindingCounts);
  if (
    reactBindings.createContext.size + reactBindings.objects.size === 0 ||
    reactBindings.useContext.size + reactBindings.objects.size === 0
  ) {
    return EMPTY_INVENTORY;
  }

  const contextResult = collectLocalContexts(sourceFile, reactBindings, topLevelBindingCounts);
  if (contextResult.truncated) {
    return TRUNCATED_INVENTORY;
  }
  if (contextResult.contexts.size === 0) {
    return EMPTY_INVENTORY;
  }

  const hookResult = collectLocalHooks(sourceFile, topLevelBindingCounts);
  if (hookResult.truncated) {
    return TRUNCATED_INVENTORY;
  }

  const pairs: ReactContextIdentityPair[] = [];
  for (const hook of hookResult.hooks.sort((left, right) => left.start - right.start)) {
    const contextBinding = readDirectHookContextBinding(
      hook.implementation,
      reactBindings,
      contextResult.contexts,
    );
    if (contextBinding === undefined) {
      continue;
    }
    pairs.push(
      Object.freeze({
        contextBinding,
        hookBinding: hook.binding,
      }),
    );
    if (pairs.length > MAX_IDENTITY_PAIRS) {
      return TRUNCATED_INVENTORY;
    }
  }

  return Object.freeze({
    pairs: Object.freeze(pairs),
    truncated: false,
  });
}

/** Selects JavaScript, JSX, TypeScript, or TSX grammar without loading project configuration. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Rejects declarations, dependencies, and files that cannot contain project runtime hooks. */
function isProjectRuntimeSource(sourcePath: string): boolean {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  return (
    !normalizedPath.split('/').includes('node_modules') &&
    !normalizedPath.endsWith('.d.ts') &&
    /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(normalizedPath)
  );
}

/** Treats parser recovery as insufficient evidence for generated runtime registration. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/**
 * Counts runtime-capable top-level declarations without descending into their bodies.
 * The counts reject duplicate local Contexts/hooks and filter React imports shadowed by authored
 * declarations even when TypeScript's syntax-only parser does not report a binder diagnostic.
 */
function collectTopLevelBindingCounts(sourceFile: ts.SourceFile): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNameCounts(declaration.name, counts);
      }
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) incrementBindingCount(statement.name.text, counts);
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      incrementBindingCount(statement.name.text, counts);
      continue;
    }
    if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
      incrementBindingCount(statement.name.text, counts);
    }
  }
  return counts;
}

/** Recursively counts every identifier introduced by one top-level variable binding pattern. */
function collectBindingNameCounts(name: ts.BindingName, counts: Map<string, number>): void {
  if (ts.isIdentifier(name)) {
    incrementBindingCount(name.text, counts);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNameCounts(element.name, counts);
    }
  }
}

/** Increments one declaration count while retaining a compact immutable-facing map contract. */
function incrementBindingCount(binding: string, counts: Map<string, number>): void {
  counts.set(binding, (counts.get(binding) ?? 0) + 1);
}

/**
 * Collects recognized React API imports and removes ambiguous or top-level-shadowed bindings.
 * A local name registered by multiple imports is discarded even when every import names the same
 * API; accepting invalid duplicate imports would make later lexical identity dependent on binder
 * recovery rather than syntax proven by this adapter.
 */
function collectReactImportBindings(
  sourceFile: ts.SourceFile,
  topLevelBindingCounts: ReadonlyMap<string, number>,
): ReactImportBindings {
  const registrations = new Map<string, ReactImportRegistration>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) {
      continue;
    }
    if (clause.name !== undefined) {
      registerReactImport(registrations, clause.name.text, 'objects');
    }
    const namedBindings = clause.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      registerReactImport(registrations, namedBindings.name.text, 'objects');
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'createContext') {
        registerReactImport(registrations, element.name.text, 'createContext');
      } else if (importedName === 'useContext') {
        registerReactImport(registrations, element.name.text, 'useContext');
      } else if (importedName === 'default') {
        registerReactImport(registrations, element.name.text, 'objects');
      }
    }
  }

  const createContext = new Set<string>();
  const objects = new Set<string>();
  const useContext = new Set<string>();
  const destinations: Record<keyof ReactImportBindings, Set<string>> = {
    createContext,
    objects,
    useContext,
  };
  for (const [binding, registration] of registrations) {
    if (registration.occurrences !== 1 || topLevelBindingCounts.has(binding)) {
      continue;
    }
    destinations[registration.kind].add(binding);
  }
  return { createContext, objects, useContext };
}

/** Records one React import while marking duplicate or cross-kind local names as ambiguous. */
function registerReactImport(
  registrations: Map<string, ReactImportRegistration>,
  binding: string,
  kind: keyof ReactImportBindings,
): void {
  const current = registrations.get(binding);
  registrations.set(binding, {
    kind: current?.kind ?? kind,
    occurrences: (current?.occurrences ?? 0) + 1,
  });
}

/** Finds immutable top-level local bindings initialized by a proven React `createContext` call. */
function collectLocalContexts(
  sourceFile: ts.SourceFile,
  reactBindings: ReactImportBindings,
  topLevelBindingCounts: ReadonlyMap<string, number>,
): {
  readonly contexts: ReadonlyMap<string, LocalContextDeclaration>;
  readonly truncated: boolean;
} {
  const contexts = new Map<string, LocalContextDeclaration>();
  let candidateCount = 0;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
        continue;
      }
      const initializer = unwrapExpression(declaration.initializer);
      const contextDefault = ts.isCallExpression(initializer)
        ? initializer.arguments[0]
        : undefined;
      if (
        !ts.isCallExpression(initializer) ||
        initializer.questionDotToken !== undefined ||
        initializer.arguments.length !== 1 ||
        contextDefault === undefined ||
        ts.isSpreadElement(contextDefault) ||
        readReactApiBinding(initializer.expression, 'createContext', reactBindings) === undefined
      ) {
        continue;
      }
      candidateCount += 1;
      if (candidateCount > MAX_CONTEXT_CANDIDATES) {
        return { contexts: new Map(), truncated: true };
      }
      const binding = declaration.name.text;
      if (topLevelBindingCounts.get(binding) === 1) {
        contexts.set(binding, { binding });
      }
    }
  }
  return { contexts, truncated: false };
}

/** Collects unique top-level `use*Context` function and immutable function-value declarations. */
function collectLocalHooks(
  sourceFile: ts.SourceFile,
  topLevelBindingCounts: ReadonlyMap<string, number>,
): { readonly hooks: LocalHookDeclaration[]; readonly truncated: boolean } {
  const hooks: LocalHookDeclaration[] = [];
  let candidateCount = 0;
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      CONTEXT_HOOK_NAME_PATTERN.test(statement.name.text)
    ) {
      candidateCount += 1;
      if (candidateCount > MAX_HOOK_CANDIDATES) {
        return { hooks: [], truncated: true };
      }
      if (statement.body !== undefined && topLevelBindingCounts.get(statement.name.text) === 1) {
        hooks.push({
          binding: statement.name.text,
          implementation: statement,
          start: statement.getStart(sourceFile),
        });
      }
      continue;
    }
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !CONTEXT_HOOK_NAME_PATTERN.test(declaration.name.text) ||
        declaration.initializer === undefined
      ) {
        continue;
      }
      candidateCount += 1;
      if (candidateCount > MAX_HOOK_CANDIDATES) {
        return { hooks: [], truncated: true };
      }
      const initializer = unwrapExpression(declaration.initializer);
      if (
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        topLevelBindingCounts.get(declaration.name.text) === 1
      ) {
        hooks.push({
          binding: declaration.name.text,
          implementation: initializer,
          start: declaration.getStart(sourceFile),
        });
      }
    }
  }
  return { hooks, truncated: false };
}

/**
 * Proves that one hook directly returns `useContext` of a recognized local Context binding.
 * Parameter and named-function bindings are checked because they may lexically shadow either the
 * React import or the Context identifier even when the returned call looks identical in text.
 */
function readDirectHookContextBinding(
  hook: RuntimeFunction,
  reactBindings: ReactImportBindings,
  contexts: ReadonlyMap<string, LocalContextDeclaration>,
): string | undefined {
  if (hasAsyncModifier(hook) || (!ts.isArrowFunction(hook) && hook.asteriskToken !== undefined)) {
    return undefined;
  }
  const returnedExpression = readDirectReturnExpression(hook);
  if (returnedExpression === undefined) {
    return undefined;
  }
  const returnedCall = unwrapExpression(returnedExpression);
  const contextArgumentNode = ts.isCallExpression(returnedCall)
    ? returnedCall.arguments[0]
    : undefined;
  if (
    !ts.isCallExpression(returnedCall) ||
    returnedCall.questionDotToken !== undefined ||
    returnedCall.arguments.length !== 1 ||
    contextArgumentNode === undefined ||
    ts.isSpreadElement(contextArgumentNode)
  ) {
    return undefined;
  }
  const reactBinding = readReactApiBinding(returnedCall.expression, 'useContext', reactBindings);
  const contextArgument = unwrapExpression(contextArgumentNode);
  if (reactBinding === undefined || !ts.isIdentifier(contextArgument)) {
    return undefined;
  }
  const context = contexts.get(contextArgument.text);
  if (context === undefined) {
    return undefined;
  }

  const lexicalBindings = new Set<string>();
  for (const parameter of hook.parameters) {
    collectBindingNames(parameter.name, lexicalBindings);
  }
  if (ts.isFunctionExpression(hook) && hook.name !== undefined) {
    lexicalBindings.add(hook.name.text);
  }
  return lexicalBindings.has(reactBinding) || lexicalBindings.has(context.binding)
    ? undefined
    : context.binding;
}

/** Accepts an arrow expression body or a block containing exactly one direct return statement. */
function readDirectReturnExpression(hook: RuntimeFunction): ts.Expression | undefined {
  const body = hook.body;
  if (body === undefined) {
    return undefined;
  }
  if (!ts.isBlock(body)) {
    return body;
  }
  const statement = body.statements[0];
  return body.statements.length === 1 && statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/** Reports whether one runtime hook implementation changes its return contract to a Promise. */
function hasAsyncModifier(hook: RuntimeFunction): boolean {
  return hook.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

/**
 * Returns the exact imported local binding used for one supported React API call.
 * Direct identifiers and non-optional default/namespace property access are admitted; computed
 * properties and deeper member chains remain intentionally unsupported.
 */
function readReactApiBinding(
  expression: ts.Expression,
  api: 'createContext' | 'useContext',
  bindings: ReactImportBindings,
): string | undefined {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee) && bindings[api].has(callee.text)) {
    return callee.text;
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    callee.name.text === api
  ) {
    const owner = unwrapExpression(callee.expression);
    return ts.isIdentifier(owner) && bindings.objects.has(owner.text) ? owner.text : undefined;
  }
  return undefined;
}

/** Recursively records identifiers introduced by parameters and named function expressions. */
function collectBindingNames(name: ts.BindingName, destination: Set<string>): void {
  if (ts.isIdentifier(name)) {
    destination.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, destination);
    }
  }
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
