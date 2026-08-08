/**
 * Infers scalar hook fallbacks from a bounded, same-file helper call graph.
 *
 * Render data is frequently destructured in a component and immediately passed to a local helper.
 * The consuming `switch`, equality guard, or literal-union annotation then lives outside the
 * component function, so a function-local usage scan cannot see the value domain. This analyzer
 * follows only direct calls to uniquely named local functions. It never resolves imports, executes
 * project code, or evaluates arbitrary expressions.
 */
import ts from 'typescript';
import { createPreviewComparisonFalseExpression } from './previewRuntimeHookComparison';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  type PreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import {
  createPreviewRuntimeSemanticString,
  inferPreviewRuntimeSemanticFallback,
} from './previewRuntimeHookSemantics';

/** Maximum helper-call distance inspected from the component that owns a hook binding. */
const MAX_LOCAL_CALL_DEPTH = 3;
/** Maximum unique helper/parameter states followed from one hook binding. */
const MAX_LOCAL_FUNCTION_VISITS = 16;
/** Maximum evidence candidates retained from one binding's reachable local corridor. */
const MAX_CANDIDATES = 48;
/** Maximum immutable identity aliases followed inside one function scope. */
const MAX_ALIASES = 12;
/** Maximum same-file type-alias expansion distance used for literal unions. */
const MAX_TYPE_ALIAS_DEPTH = 3;
/** Shared empty name set used by hot-path scalar reads that permit semantic fallback. */
const NO_BLOCKED_SEMANTIC_NAMES: ReadonlySet<string> = new Set();

/** Side-effect-free scalar expression selected from authored local syntax. */
export interface PreviewRuntimeHookLocalScalarFallback {
  /** Static expression evaluated only by the preview fallback boundary. */
  readonly expression: string;
  /** Concise reason displayed in generated-value diagnostics. */
  readonly label: string;
  /** The literal is required to avoid an authored closed fallthrough that blocks rendering. */
  readonly renderGuard?: true;
}

/** Directly callable same-file function with an unambiguous authored name. */
interface LocalFunction {
  /** Function body and parameter declarations used by the bounded analysis. */
  readonly node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
}

/** Source-scoped declaration catalogs reused across multiple hook fields in one transformation. */
interface LocalAnalysisCatalog {
  /** Same-file functions with one unambiguous directly callable name. */
  readonly functions: ReadonlyMap<string, LocalFunction>;
  /** Same-file literal type aliases available without checker or module resolution. */
  readonly typeAliases: ReadonlyMap<string, ts.TypeNode>;
}

/** Avoids rescanning a source AST for every property in a destructured hook result. */
const localAnalysisCatalogBySourceFile = new WeakMap<ts.SourceFile, LocalAnalysisCatalog>();

/** Static scalar transported between direct helper arguments and parameters. */
type KnownScalar = boolean | number | string | null;

/** One possible scalar fallback discovered along the reachable local call corridor. */
interface ScalarCandidate extends PreviewRuntimeHookLocalScalarFallback {
  /** Stable scalar identity used to reject equality-exit values and count branch coverage. */
  readonly key?: string;
  /** Authored discovery order used as the final deterministic tie breaker. */
  readonly order: number;
  /** Evidence strength; helper cases outrank type-only and generic comparison fallbacks. */
  readonly rank: number;
}

/** Mutable state shared by the bounded recursive analysis of one hook binding. */
interface AnalysisState {
  /** Whether root naming permits a helper truthiness test to replace the value with a Boolean. */
  readonly allowBooleanConditionFallback: boolean;
  /** Candidate values collected from comparisons, cases, conditions, and type annotations. */
  readonly candidates: ScalarCandidate[];
  /** Same-file local functions that have exactly one statically callable declaration. */
  readonly functions: ReadonlyMap<string, LocalFunction>;
  /** Equality values that should not be chosen when another authored domain value exists. */
  readonly forbiddenKeys: Set<string>;
  /** Incrementing authored-order marker shared across recursive helper visits. */
  nextOrder: number;
  /** Source file that owns every admitted helper and emitted expression. */
  readonly sourceFile: ts.SourceFile;
  /** Same-file literal type aliases available without compiler type resolution. */
  readonly typeAliases: ReadonlyMap<string, ts.TypeNode>;
  /** Function/parameter states already traversed, preventing recursive helper loops. */
  readonly visited: Set<string>;
}

/**
 * Finds a deterministic scalar accepted by a binding's reachable local helper corridor.
 *
 * Direct comparisons retain the previous comparison-safe behavior. Direct helper calls additionally
 * map the tracked argument to its identifier parameter, follow at most three unique local calls, and
 * inspect `switch` cases, Boolean branch conditions, and same-file literal unions. Ambiguous callees
 * and dynamic arguments are ignored rather than guessed.
 *
 * @param identifier Hook-result binding declared inside a render-time function.
 * @param sourceFile Parsed source file containing both the binding and admitted local helpers.
 * @returns A bounded scalar fallback, or `undefined` when local syntax proves no safe scalar.
 */
export function inferPreviewRuntimeHookLocalScalarFallback(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookLocalScalarFallback | undefined {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const catalog = readLocalAnalysisCatalog(sourceFile);
  const rootSemantic = inferPreviewRuntimeSemanticFallback(identifier.text);
  const state: AnalysisState = {
    allowBooleanConditionFallback: rootSemantic === undefined || rootSemantic.kind === 'boolean',
    candidates: [],
    forbiddenKeys: new Set(),
    functions: catalog.functions,
    nextOrder: 0,
    sourceFile,
    typeAliases: catalog.typeAliases,
    visited: new Set(),
  };
  analyzeFunctionScope(owner, identifier.text, new Map(), 0, state);
  return selectScalarCandidate(state);
}

/** Builds declaration catalogs once for all hook bindings parsed from the same source file. */
function readLocalAnalysisCatalog(sourceFile: ts.SourceFile): LocalAnalysisCatalog {
  const existing = localAnalysisCatalogBySourceFile.get(sourceFile);
  if (existing !== undefined) return existing;
  const catalog = {
    functions: collectLocalFunctions(sourceFile),
    typeAliases: collectLiteralTypeAliases(sourceFile),
  };
  localAnalysisCatalogBySourceFile.set(sourceFile, catalog);
  return catalog;
}

/**
 * Traverses one function while treating only the requested local name as the transported value.
 *
 * Nested functions are not entered implicitly. They become reachable only through an unambiguous
 * direct call, which keeps the scan independent of unrelated helpers and prevents whole-file graph
 * expansion.
 */
function analyzeFunctionScope(
  scope: PreviewRuntimeFunction,
  trackedName: string,
  parameterValues: ReadonlyMap<string, KnownScalar>,
  depth: number,
  state: AnalysisState,
): void {
  if (depth > MAX_LOCAL_CALL_DEPTH || state.candidates.length >= MAX_CANDIDATES) return;
  const aliases = collectIdentityAliases(scope, trackedName);
  const knownValues = collectKnownLocalValues(scope, parameterValues);
  collectParameterTypeCandidates(scope, trackedName, aliases, state);
  collectClosedFallthroughCandidates(scope, trackedName, aliases, state);
  visitReachableNode(scope, scope, trackedName, aliases, knownValues, depth, state);
}

/**
 * Selects a literal branch when every value that misses the authored equality corridor reaches a
 * terminal throw. Generic comparison-safe text is actively harmful in this shape: it skips every
 * accepted state and lands in the exhaustive `never` assertion. Only a direct equality whose
 * branch exits before the final throw is admitted, and the latest such branch wins so nested
 * prerequisite guards remain undisturbed.
 */
function collectClosedFallthroughCandidates(
  scope: PreviewRuntimeFunction,
  trackedName: string,
  aliases: ReadonlySet<string>,
  state: AnalysisState,
): void {
  const body = scope.body;
  if (body === undefined || !ts.isBlock(body) || body.statements.length < 2) return;
  const terminal = body.statements.at(-1);
  if (terminal === undefined || !statementAlwaysThrows(terminal)) return;
  let selected:
    | { readonly expression: string; readonly key: string }
    | undefined;
  for (const statement of body.statements.slice(0, -1)) {
    if (
      !ts.isIfStatement(statement) ||
      statement.elseStatement !== undefined ||
      !statementAlwaysExits(statement.thenStatement)
    ) {
      continue;
    }
    const literals = readTruthyTrackedEqualityLiterals(
      statement.expression,
      trackedName,
      aliases,
      state.sourceFile,
    );
    const literal = literals.at(-1);
    if (literal !== undefined) {
      selected = { expression: literal.expression, key: scalarKey(literal.value) };
    }
  }
  if (selected === undefined) return;
  addScalarCandidate(state, {
    expression: selected.expression,
    key: selected.key,
    label: 'generated accepted literal before exhaustive throw',
    rank: 320,
    renderGuard: true,
  });
}

/** Reads equality literals that alone make a direct or disjunctive condition true. */
function readTruthyTrackedEqualityLiterals(
  expression: ts.Expression,
  trackedName: string,
  aliases: ReadonlySet<string>,
  sourceFile: ts.SourceFile,
): readonly { readonly expression: string; readonly value: KnownScalar }[] {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (
    ts.isBinaryExpression(value) &&
    value.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return [
      ...readTruthyTrackedEqualityLiterals(value.left, trackedName, aliases, sourceFile),
      ...readTruthyTrackedEqualityLiterals(value.right, trackedName, aliases, sourceFile),
    ];
  }
  if (
    !ts.isBinaryExpression(value) ||
    (value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
      value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)
  ) {
    return [];
  }
  const compared = readComparedExpression(value, trackedName, aliases);
  if (compared === undefined) return [];
  const literal = readStaticScalarExpression(compared, sourceFile);
  return literal === undefined ? [] : [literal];
}

/**
 * Visits syntax reachable under statically known Boolean branches.
 *
 * Unknown branches remain inspectable on both sides. A companion Boolean parameter used directly
 * by `if` defaults to the neutral false branch, except when a proven early exit requires the other
 * value. This lets the scalar case agree with the separately generated Boolean field.
 */
function visitReachableNode(
  node: ts.Node,
  scope: PreviewRuntimeFunction,
  trackedName: string,
  aliases: ReadonlySet<string>,
  knownValues: ReadonlyMap<string, KnownScalar>,
  depth: number,
  state: AnalysisState,
): void {
  if (state.candidates.length >= MAX_CANDIDATES) return;
  if (node !== scope && isPreviewRuntimeFunction(node)) return;
  if (ts.isIfStatement(node)) {
    collectComparisonCandidate(node.expression, trackedName, aliases, state);
    const condition = evaluateBooleanExpression(node.expression, knownValues, aliases);
    if (condition === true) {
      visitReachableNode(
        node.thenStatement,
        scope,
        trackedName,
        aliases,
        knownValues,
        depth,
        state,
      );
      return;
    }
    if (condition === false) {
      if (node.elseStatement !== undefined) {
        visitReachableNode(
          node.elseStatement,
          scope,
          trackedName,
          aliases,
          knownValues,
          depth,
          state,
        );
      }
      return;
    }
    /*
     * A tracked Boolean tested without a known value gets the same neutral `false` used by direct
     * hook-condition instrumentation. This also makes a sibling Boolean argument and the scalar
     * selected from the corresponding helper branch deterministic as a pair.
     */
    const trackedBoolean = inferBooleanConditionFallback(node, aliases);
    if (depth > 0 && trackedBoolean !== undefined && state.allowBooleanConditionFallback) {
      addScalarCandidate(state, {
        expression: String(trackedBoolean),
        key: scalarKey(trackedBoolean),
        label: 'generated Boolean from reachable local helper condition',
        rank: 90,
      });
    }
    visitReachableNode(node.thenStatement, scope, trackedName, aliases, knownValues, depth, state);
    if (node.elseStatement !== undefined) {
      visitReachableNode(
        node.elseStatement,
        scope,
        trackedName,
        aliases,
        knownValues,
        depth,
        state,
      );
    }
    return;
  }
  if (ts.isSwitchStatement(node) && isTrackedExpression(node.expression, trackedName, aliases)) {
    const closedSwitch = node.caseBlock.clauses.some(
      (clause) => ts.isDefaultClause(clause) && clause.statements.some(statementAlwaysThrows),
    );
    for (const clause of node.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) {
        const literal = readStaticScalarExpression(clause.expression, state.sourceFile);
        if (literal !== undefined) {
          addScalarCandidate(state, {
            expression: literal.expression,
            key: scalarKey(literal.value),
            label: closedSwitch
              ? 'generated accepted literal before exhaustive switch throw'
              : 'generated literal from reachable local helper switch',
            rank: closedSwitch ? 300 : 220,
            ...(closedSwitch ? { renderGuard: true as const } : {}),
          });
        }
      }
      for (const statement of clause.statements) {
        visitReachableNode(statement, scope, trackedName, aliases, knownValues, depth, state);
      }
    }
    return;
  }
  if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) {
    collectComparisonCandidate(node, trackedName, aliases, state);
  }
  if (ts.isCallExpression(node)) {
    followDirectLocalCall(node, trackedName, aliases, knownValues, depth, state);
  }
  ts.forEachChild(node, (child) => {
    visitReachableNode(child, scope, trackedName, aliases, knownValues, depth, state);
  });
}

/**
 * Follows a tracked argument into a unique, directly named same-file helper.
 *
 * Other arguments are mapped to literal or syntax-proven Boolean parameter values. An otherwise
 * unknown argument mapped to a plain condition receives a neutral or early-exit-avoiding Boolean,
 * so a scalar `switch` nested under that condition selects a compatible reachable branch.
 */
function followDirectLocalCall(
  call: ts.CallExpression,
  trackedName: string,
  aliases: ReadonlySet<string>,
  knownValues: ReadonlyMap<string, KnownScalar>,
  depth: number,
  state: AnalysisState,
): void {
  if (depth >= MAX_LOCAL_CALL_DEPTH) return;
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (!ts.isIdentifier(callee)) return;
  const localFunction = state.functions.get(callee.text);
  if (localFunction === undefined) return;
  for (const [argumentIndex, argument] of call.arguments.entries()) {
    if (ts.isSpreadElement(argument)) continue;
    if (!isTrackedExpression(argument, trackedName, aliases)) continue;
    const trackedParameter = localFunction.node.parameters[argumentIndex];
    if (trackedParameter === undefined || !ts.isIdentifier(trackedParameter.name)) continue;
    const parameterValues = new Map<string, KnownScalar>();
    for (const [parameterIndex, parameter] of localFunction.node.parameters.entries()) {
      if (!ts.isIdentifier(parameter.name) || parameterIndex === argumentIndex) continue;
      const actual = call.arguments[parameterIndex];
      const explicitKnown =
        actual === undefined || ts.isSpreadElement(actual)
          ? undefined
          : readKnownScalarExpression(actual, knownValues, NO_BLOCKED_SEMANTIC_NAMES, false);
      if (explicitKnown !== undefined) {
        parameterValues.set(parameter.name.text, explicitKnown);
      } else {
        const booleanFallback = inferParameterBooleanFallback(
          localFunction.node,
          parameter.name.text,
        );
        const actualSemantic =
          actual === undefined || ts.isSpreadElement(actual)
            ? undefined
            : readIdentifierSemanticFallback(actual);
        if (
          booleanFallback !== undefined &&
          (actualSemantic === undefined || actualSemantic.kind === 'boolean')
        ) {
          parameterValues.set(parameter.name.text, booleanFallback);
        } else if (
          actualSemantic?.kind === 'boolean' &&
          typeof actualSemantic.value === 'boolean'
        ) {
          parameterValues.set(parameter.name.text, actualSemantic.value);
        }
      }
    }
    const companionState = [...parameterValues.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${scalarKey(value)}`)
      .join(',');
    const visitKey = `${String(localFunction.node.pos)}:${String(argumentIndex)}:${companionState}`;
    if (state.visited.has(visitKey) || state.visited.size >= MAX_LOCAL_FUNCTION_VISITS) continue;
    state.visited.add(visitKey);
    analyzeFunctionScope(
      localFunction.node,
      trackedParameter.name.text,
      parameterValues,
      depth + 1,
      state,
    );
  }
}

/**
 * Collects direct comparisons involving the tracked value.
 *
 * Inequality guards receive the compared value so the condition becomes false. Equality guards mark
 * their literal as undesirable and retain the previous neutral false-branch expression as a
 * fallback when no switch or type-domain alternative exists.
 */
function collectComparisonCandidate(
  expression: ts.Expression,
  trackedName: string,
  aliases: ReadonlySet<string>,
  state: AnalysisState,
): void {
  const unwrapped = unwrapPreviewRuntimeExpression(expression);
  if (!ts.isBinaryExpression(unwrapped) || !isEqualityOperator(unwrapped.operatorToken.kind))
    return;
  const compared = readComparedExpression(unwrapped, trackedName, aliases);
  if (compared === undefined || !isStaticComparableExpression(compared)) return;
  const literal = readStaticScalarExpression(compared, state.sourceFile);
  const inequality =
    unwrapped.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    unwrapped.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
  if (!inequality && literal !== undefined) state.forbiddenKeys.add(scalarKey(literal.value));
  addScalarCandidate(state, {
    expression: createPreviewComparisonFalseExpression(
      createPreviewRuntimeSemanticString(trackedName),
      compared,
      unwrapped.operatorToken.kind,
      state.sourceFile,
    ),
    ...(inequality && literal !== undefined ? { key: scalarKey(literal.value) } : {}),
    label: inequality
      ? 'generated value accepted by reachable local inequality guard'
      : 'generated comparison-safe value',
    rank: inequality ? 260 : 70,
  });
}

/** Adds literal candidates from an identifier parameter's direct or same-file aliased type. */
function collectParameterTypeCandidates(
  scope: PreviewRuntimeFunction,
  trackedName: string,
  aliases: ReadonlySet<string>,
  state: AnalysisState,
): void {
  for (const parameter of scope.parameters) {
    if (!ts.isIdentifier(parameter.name) || !aliases.has(parameter.name.text)) continue;
    for (const literal of readLiteralTypeValues(parameter.type, state.typeAliases, new Set(), 0)) {
      addScalarCandidate(state, {
        expression: literal.expression,
        key: scalarKey(literal.value),
        label: 'generated literal from reachable local helper type',
        rank: 140,
      });
    }
  }
}

/** Selects the strongest non-conflicting candidate, favoring values shared by branch case sets. */
function selectScalarCandidate(
  state: AnalysisState,
): PreviewRuntimeHookLocalScalarFallback | undefined {
  const frequencies = new Map<string, number>();
  for (const candidate of state.candidates) {
    if (candidate.key !== undefined) {
      frequencies.set(candidate.key, (frequencies.get(candidate.key) ?? 0) + 1);
    }
  }
  const selected = state.candidates
    .filter(
      (candidate) =>
        candidate.key === undefined ||
        !state.forbiddenKeys.has(candidate.key) ||
        candidate.rank >= 250,
    )
    .sort((left, right) => {
      const leftScore = left.rank + (left.key === undefined ? 0 : (frequencies.get(left.key) ?? 0));
      const rightScore =
        right.rank + (right.key === undefined ? 0 : (frequencies.get(right.key) ?? 0));
      return rightScore - leftScore || left.order - right.order;
    })[0];
  return selected === undefined
    ? undefined
    : {
        expression: selected.expression,
        label: selected.label,
        ...(selected.renderGuard === true ? { renderGuard: true as const } : {}),
      };
}

/** Retains one bounded evidence candidate and assigns deterministic source discovery order. */
function addScalarCandidate(state: AnalysisState, candidate: Omit<ScalarCandidate, 'order'>): void {
  if (state.candidates.length >= MAX_CANDIDATES) return;
  state.candidates.push({ ...candidate, order: state.nextOrder++ });
}

/** Collects immutable direct aliases such as `const nextPhase = phase` to a bounded fixed point. */
function collectIdentityAliases(
  scope: PreviewRuntimeFunction,
  trackedName: string,
): ReadonlySet<string> {
  const aliases = new Set([trackedName]);
  let changed = true;
  while (changed && aliases.size < MAX_ALIASES) {
    changed = false;
    visitScopeChildren(scope, scope, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !ts.isIdentifier(node.name) ||
        node.initializer === undefined ||
        !isConstVariableDeclaration(node)
      ) {
        return;
      }
      const initializer = unwrapPreviewRuntimeExpression(node.initializer);
      if (
        ts.isIdentifier(initializer) &&
        aliases.has(initializer.text) &&
        !aliases.has(node.name.text)
      ) {
        aliases.add(node.name.text);
        changed = true;
      }
    });
  }
  return aliases;
}

/** Extends parameter values with immutable literal and Boolean-negation aliases in one scope. */
function collectKnownLocalValues(
  scope: PreviewRuntimeFunction,
  parameterValues: ReadonlyMap<string, KnownScalar>,
): ReadonlyMap<string, KnownScalar> {
  const values = new Map(parameterValues);
  let changed = true;
  while (changed && values.size < MAX_ALIASES) {
    changed = false;
    visitScopeChildren(scope, scope, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !ts.isIdentifier(node.name) ||
        node.initializer === undefined ||
        !isConstVariableDeclaration(node) ||
        values.has(node.name.text)
      ) {
        return;
      }
      const value = readKnownScalarExpression(node.initializer, values);
      if (value !== undefined) {
        values.set(node.name.text, value);
        changed = true;
      }
    });
  }
  return values;
}

/** Visits a function body without implicitly entering a nested function-like scope. */
function visitScopeChildren(
  node: ts.Node,
  scope: PreviewRuntimeFunction,
  visit: (node: ts.Node) => void,
): void {
  if (node !== scope && isPreviewRuntimeFunction(node)) return;
  visit(node);
  ts.forEachChild(node, (child) => {
    visitScopeChildren(child, scope, visit);
  });
}

/** Proves that a local variable declaration belongs to an authored `const` declaration list. */
function isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

/** Collects unique directly named local function declarations and const function expressions. */
function collectLocalFunctions(sourceFile: ts.SourceFile): ReadonlyMap<string, LocalFunction> {
  const candidates = new Map<string, LocalFunction | null>();
  const add = (
    name: string,
    node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
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
    [...candidates.entries()].filter(
      (entry): entry is [string, LocalFunction] => entry[1] !== null,
    ),
  );
}

/** Collects unique same-file type aliases without asking the TypeScript checker to resolve imports. */
function collectLiteralTypeAliases(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode | null>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node)) {
      aliases.set(node.name.text, aliases.has(node.name.text) ? null : node.type);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return new Map(
    [...aliases.entries()].filter((entry): entry is [string, ts.TypeNode] => entry[1] !== null),
  );
}

/** Reads literal members from a direct union or bounded same-file type-alias reference. */
function readLiteralTypeValues(
  typeNode: ts.TypeNode | undefined,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  visited: Set<string>,
  depth: number,
): readonly { readonly expression: string; readonly value: KnownScalar }[] {
  if (typeNode === undefined || depth > MAX_TYPE_ALIAS_DEPTH) return [];
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return readLiteralTypeValues(typeNode.type, aliases, visited, depth);
  }
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.flatMap((item) => readLiteralTypeValues(item, aliases, visited, depth));
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    const literal = readStaticScalarExpression(typeNode.literal, typeNode.getSourceFile());
    return literal === undefined ? [] : [literal];
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const name = typeNode.typeName.text;
    const target = aliases.get(name);
    if (target === undefined || visited.has(name)) return [];
    visited.add(name);
    const values = readLiteralTypeValues(target, aliases, visited, depth + 1);
    visited.delete(name);
    return values;
  }
  return [];
}

/** Returns the non-tracked side of an equality comparison after transparent syntax unwrapping. */
function readComparedExpression(
  expression: ts.BinaryExpression,
  trackedName: string,
  aliases: ReadonlySet<string>,
): ts.Expression | undefined {
  if (isTrackedExpression(expression.left, trackedName, aliases)) {
    return unwrapPreviewRuntimeExpression(expression.right);
  }
  if (isTrackedExpression(expression.right, trackedName, aliases)) {
    return unwrapPreviewRuntimeExpression(expression.left);
  }
  return undefined;
}

/** Recognizes equality operators whose false branch can be generated without project execution. */
function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

/** Admits self-contained literals plus the enum-like expressions supported by prior instrumentation. */
function isStaticComparableExpression(expression: ts.Expression): boolean {
  return (
    readStaticScalarExpression(expression, expression.getSourceFile()) !== undefined ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.questionDotToken === undefined &&
      ts.isIdentifier(expression.expression) &&
      /^[A-Z]/u.test(expression.expression.text))
  );
}

/** Checks whether an expression is the transported identifier or one of its immutable aliases. */
function isTrackedExpression(
  expression: ts.Expression,
  trackedName: string,
  aliases: ReadonlySet<string>,
): boolean {
  const value = unwrapPreviewRuntimeExpression(expression);
  return ts.isIdentifier(value) && (value.text === trackedName || aliases.has(value.text));
}

/** Reads a literal or already known identifier value without evaluating calls or property access. */
function readKnownScalarExpression(
  expression: ts.Expression,
  knownValues: ReadonlyMap<string, KnownScalar>,
  blockedSemanticNames: ReadonlySet<string> = NO_BLOCKED_SEMANTIC_NAMES,
  allowSemanticFallback = true,
): KnownScalar | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  const literal = readStaticScalarExpression(value, value.getSourceFile());
  if (literal !== undefined) return literal.value;
  if (ts.isIdentifier(value)) {
    const known = knownValues.get(value.text);
    if (known !== undefined) return known;
    if (blockedSemanticNames.has(value.text) || !allowSemanticFallback) return undefined;
    const semantic = inferPreviewRuntimeSemanticFallback(value.text);
    return semantic?.kind === 'boolean' && typeof semantic.value === 'boolean'
      ? semantic.value
      : undefined;
  }
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = readKnownScalarExpression(
      value.operand,
      knownValues,
      blockedSemanticNames,
      allowSemanticFallback,
    );
    return typeof operand === 'boolean' ? !operand : undefined;
  }
  return undefined;
}

/** Reads only name-semantic evidence for one direct identifier argument. */
function readIdentifierSemanticFallback(
  expression: ts.Expression,
): ReturnType<typeof inferPreviewRuntimeSemanticFallback> {
  const value = unwrapPreviewRuntimeExpression(expression);
  return ts.isIdentifier(value) ? inferPreviewRuntimeSemanticFallback(value.text) : undefined;
}

/** Evaluates only literal/known Boolean identifiers and direct Boolean equality expressions. */
function evaluateBooleanExpression(
  expression: ts.Expression,
  knownValues: ReadonlyMap<string, KnownScalar>,
  trackedNames: ReadonlySet<string>,
): boolean | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  const scalar = readKnownScalarExpression(value, knownValues, trackedNames);
  if (typeof scalar === 'boolean') return scalar;
  if (ts.isBinaryExpression(value) && isEqualityOperator(value.operatorToken.kind)) {
    const left = readKnownScalarExpression(value.left, knownValues, trackedNames);
    const right = readKnownScalarExpression(value.right, knownValues, trackedNames);
    if (left === undefined || right === undefined) return undefined;
    const equal = left === right;
    return value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      ? equal
      : !equal;
  }
  return undefined;
}

/** Reads the tracked identifier value that makes a direct or negated Boolean condition true. */
function readBooleanIdentifierCondition(
  expression: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean | undefined {
  let value = unwrapPreviewRuntimeExpression(expression);
  let conditionTrueValue = true;
  while (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    conditionTrueValue = !conditionTrueValue;
    value = unwrapPreviewRuntimeExpression(value.operand);
  }
  return ts.isIdentifier(value) && aliases.has(value.text) ? conditionTrueValue : undefined;
}

/**
 * Infers a helper parameter's neutral or pass-through Boolean from its direct branch conditions.
 *
 * An authored throw or explicitly empty return receives the value that avoids it. Otherwise `false`
 * remains the deterministic neutral branch, matching direct hook-condition fallback policy.
 */
function inferParameterBooleanFallback(
  scope: PreviewRuntimeFunction,
  parameterName: string,
): boolean | undefined {
  let fallback: boolean | undefined;
  visitScopeChildren(scope, scope, (node) => {
    if (fallback !== undefined || !ts.isIfStatement(node)) return;
    const names = new Set([parameterName]);
    fallback = inferBooleanConditionFallback(node, names);
  });
  return fallback;
}

/** Chooses a Boolean for one direct identifier condition, avoiding a proven exiting branch. */
function inferBooleanConditionFallback(
  statement: ts.IfStatement,
  aliases: ReadonlySet<string>,
): boolean | undefined {
  const conditionTrueValue = readBooleanIdentifierCondition(statement.expression, aliases);
  if (conditionTrueValue === undefined) return undefined;
  if (statementBlocksPreview(statement.thenStatement) && statement.elseStatement === undefined) {
    return !conditionTrueValue;
  }
  if (
    statement.elseStatement !== undefined &&
    statementBlocksPreview(statement.elseStatement) &&
    !statementBlocksPreview(statement.thenStatement)
  ) {
    return conditionTrueValue;
  }
  return false;
}

/** Proves that one branch ends in a thrown or explicitly empty preview result. */
function statementBlocksPreview(statement: ts.Statement): boolean {
  if (ts.isThrowStatement(statement)) return true;
  if (ts.isReturnStatement(statement)) {
    const expression =
      statement.expression === undefined
        ? undefined
        : unwrapPreviewRuntimeExpression(statement.expression);
    return (
      expression === undefined ||
      expression.kind === ts.SyntaxKind.NullKeyword ||
      expression.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(expression) && expression.text === 'undefined')
    );
  }
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && statementBlocksPreview(last);
  }
  return (
    ts.isIfStatement(statement) &&
    statement.elseStatement !== undefined &&
    statementBlocksPreview(statement.thenStatement) &&
    statementBlocksPreview(statement.elseStatement)
  );
}

/** Proves that normal control cannot continue after one statement. */
function statementAlwaysExits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && statementAlwaysExits(last);
  }
  return (
    ts.isIfStatement(statement) &&
    statement.elseStatement !== undefined &&
    statementAlwaysExits(statement.thenStatement) &&
    statementAlwaysExits(statement.elseStatement)
  );
}

/** Keeps the closed-domain proof specific to an authored unconditional throw. */
function statementAlwaysThrows(statement: ts.Statement): boolean {
  if (ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && statementAlwaysThrows(last);
  }
  return (
    ts.isIfStatement(statement) &&
    statement.elseStatement !== undefined &&
    statementAlwaysThrows(statement.thenStatement) &&
    statementAlwaysThrows(statement.elseStatement)
  );
}

/** Converts an authored literal expression to a self-contained generated scalar expression. */
function readStaticScalarExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): { readonly expression: string; readonly value: KnownScalar } | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { expression: JSON.stringify(value.text), value: value.text };
  }
  if (ts.isNumericLiteral(value)) {
    const numeric = Number(value.text);
    return Number.isFinite(numeric) ? { expression: String(numeric), value: numeric } : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(value) &&
    (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(value.operand)
  ) {
    const numeric = Number(value.getText(sourceFile));
    return Number.isFinite(numeric) ? { expression: String(numeric), value: numeric } : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return { expression: 'true', value: true };
  if (value.kind === ts.SyntaxKind.FalseKeyword) return { expression: 'false', value: false };
  if (value.kind === ts.SyntaxKind.NullKeyword) return { expression: 'null', value: null };
  return undefined;
}

/** Produces a collision-free identity for branch-frequency and forbidden-value comparison. */
function scalarKey(value: KnownScalar): string {
  return `${value === null ? 'null' : typeof value}:${String(value)}`;
}
