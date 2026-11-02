/**
 * Keeps alias and const-carrier proof in each nested callback reference's lexical scope.
 * Immutable binding-name facts are weakly owned by syntax; query-specific masks are never shared.
 * Parameters, hoisted vars and block bindings mask only their own names. Object properties are
 * read in their declaration scope, not a caller's shadow, and genuine captures remain visible.
 * No inferred callback/catalog result, checker state, or disk fact is retained across queries.
 */
import ts from 'typescript';
import type { PreviewRuntimeHookAliasPathCatalog } from './previewRuntimeHookAliasModel';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

/** Query-local binding mask plus the remaining hook-relative aliases in one lexical scope. */
interface AliasScopeRecord {
  /** Current query's origins not replaced by bindings on the path to this scope. */
  readonly aliases: PreviewRuntimeHookAliasPathCatalog;
  /** Alias/carrier spellings replaced by nested callback, block, catch or loop bindings. */
  readonly shadowed: ReadonlySet<string>;
}

/** Visibility reader shared by the alias-use and JSX-child walkers of one immutable owner. */
export interface PreviewRuntimeHookAliasScope {
  /** Resolves aliases where the syntax was authored, including captured outer object properties. */
  readonly readAliases: (node: ts.Node) => PreviewRuntimeHookAliasPathCatalog;
  /** Rejects a named owner const when a nested local binding supplies a different object. */
  readonly isShadowedCarrier: (expression: ts.Expression) => boolean;
}

/** Distinguishes parameter origins from aliases discovered in the owner's body. */
export interface PreviewRuntimeHookAliasScopeOptions {
  /** Masks body declarations even when their nearest function is the owner. */
  readonly ownerParameterOrigins?: true;
}

/**
 * Creates current-query visibility using exact lexical binding-name facts, without a type binder.
 *
 * @param owner Function that declared the original hook binding and immutable carriers.
 * @param aliases Current query's complete hook-relative origins before nested binding masking.
 * @param trackedNames Alias and carrier names whose replacement matters to this query.
 * @param options Optional visibility rule for origins declared in the owner's parameter list.
 * @returns Query-owned reader; inferred values and callback results are never stored here.
 */
export function createPreviewRuntimeHookAliasScope(
  owner: PreviewRuntimeFunction,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  trackedNames: ReadonlySet<string>,
  options?: PreviewRuntimeHookAliasScopeOptions,
): PreviewRuntimeHookAliasScope {
  const tracked = new Set(trackedNames);
  const root: AliasScopeRecord = { aliases, shadowed: new Set() };
  const scopes = new Map<ts.Node, AliasScopeRecord>();
  const readScope = (scope: ts.Node | undefined): AliasScopeRecord => {
    if (scope === undefined || scope === owner) return root;
    const retained = scopes.get(scope);
    if (retained !== undefined) return retained;
    const parent = readScope(findScope(scope.parent));
    const shadowed = new Set(parent.shadowed);
    // Preserve owner-level alias discovery; only nested bindings can replace those proven names.
    if (
      options?.ownerParameterOrigins === true ||
      isPreviewRuntimeFunction(scope) ||
      ts.isClassExpression(scope) ||
      ts.isClassStaticBlockDeclaration(scope) ||
      findNearestPreviewRuntimeFunction(scope) !== owner
    ) {
      for (const name of readScopeNames(scope)) if (tracked.has(name)) shadowed.add(name);
    }
    const result =
      shadowed.size === parent.shadowed.size
        ? parent
        : {
            aliases: new Map([...parent.aliases].filter(([name]) => !shadowed.has(name))),
            shadowed,
          };
    scopes.set(scope, result);
    return result;
  };
  return {
    readAliases: (node) => readScope(findScope(node)).aliases,
    isShadowedCarrier: (expression) => {
      const value = unwrapPreviewRuntimeExpression(expression);
      return ts.isIdentifier(value) && readScope(findScope(value)).shadowed.has(value.text);
    },
  };
}

/** Syntax facts contain no alias paths or inference decisions and expire with their parser tree. */
const namesByScope = new WeakMap<ts.Node, ReadonlySet<string>>();

/** Identifies lexical boundaries whose masks must be restored when the source-order walk exits. */
export function isPreviewRuntimeHookAliasScopeNode(node: ts.Node): boolean {
  return (
    isPreviewRuntimeFunction(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isClassExpression(node) ||
    ts.isClassStaticBlockDeclaration(node)
  );
}

/** Finds the reference's own lexical boundary, including a boundary node on entry. */
function findScope(node: ts.Node | undefined): ts.Node | undefined {
  let current = node;
  while (current !== undefined) {
    if (isPreviewRuntimeHookAliasScopeNode(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Collects direct lexical bindings and function-owned hoisted vars once per immutable scope. */
function readScopeNames(scope: ts.Node): ReadonlySet<string> {
  const cached = namesByScope.get(scope);
  if (cached !== undefined) return cached;
  const names = new Set<string>();
  if (isPreviewRuntimeFunction(scope)) {
    for (const parameter of scope.parameters) appendBindingNames(parameter.name, names);
    if (
      (ts.isFunctionExpression(scope) || ts.isFunctionDeclaration(scope)) &&
      scope.name !== undefined
    )
      names.add(scope.name.text);
  } else if (ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseBlock(scope)) {
    // Non-simple parameter defaults have an outer environment: body vars start at body entry.
    if (ts.isBlock(scope) && isPreviewRuntimeFunction(scope.parent) && scope.parent.body === scope)
      collectHoistedVars(scope, names);
    const statements = ts.isCaseBlock(scope)
      ? scope.clauses.flatMap((clause) => [...clause.statements])
      : scope.statements;
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
          appendBindingNames(declaration.name, names);
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) &&
        statement.name !== undefined &&
        ts.isIdentifier(statement.name)
      ) {
        names.add(statement.name.text);
      }
    }
  } else if (ts.isCatchClause(scope)) {
    if (scope.variableDeclaration !== undefined)
      appendBindingNames(scope.variableDeclaration.name, names);
  } else if (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) {
    if (scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer))
      for (const declaration of scope.initializer.declarations)
        appendBindingNames(declaration.name, names);
  } else if (ts.isClassExpression(scope)) {
    if (scope.name !== undefined) names.add(scope.name.text);
  } else if (ts.isClassStaticBlockDeclaration(scope)) {
    collectHoistedVars(scope.body, names);
  }
  namesByScope.set(scope, names);
  return names;
}

/** A var belongs to its function/static block even when its declaration is below another branch. */
function collectHoistedVars(root: ts.Node, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (
      node !== root &&
      (ts.isFunctionLike(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isClassStaticBlockDeclaration(node) ||
        ts.isModuleDeclaration(node))
    )
      return;
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0)
      for (const declaration of node.declarations) appendBindingNames(declaration.name, names);
    ts.forEachChild(node, visit);
  };
  visit(root);
}

/** Reads binding leaves only; property keys and authored defaults never introduce local names. */
function appendBindingNames(binding: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(binding)) {
    names.add(binding.text);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNames(element.name, names);
  }
}
