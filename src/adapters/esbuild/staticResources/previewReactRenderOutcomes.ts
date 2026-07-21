/**
 * Builds a bounded, syntax-only inventory of the render outcomes exported by one React module.
 *
 * The analyzer deliberately stays below module resolution and never evaluates workspace code. It
 * follows local component wrappers, component-local control flow, and JSX child structure only far
 * enough to explain which authored condition selects each possible render result. The immutable,
 * JSON-safe result can therefore cross the extension/webview boundary without retaining TypeScript
 * AST nodes or project runtime values.
 */
import ts from 'typescript';
import { expandPreviewReactLogicalAndExpression } from './previewReactLogicalAnd';
import { createPreviewReactLogicalAndEdges } from './previewReactRenderLogicalAnd';
import type {
  PreviewReactRenderComponentNode,
  PreviewReactRenderConditionBranch,
  PreviewReactRenderConditionEdge,
  PreviewReactRenderConditionKind,
  PreviewReactRenderOutcome,
  PreviewReactRenderOutcomeKind,
  PreviewReactRenderOutcomePlan,
  PreviewReactRenderSwitchValue,
} from './previewReactRenderOutcomeTypes';
import {
  boundedPreviewRenderText as boundedText,
  createPreviewRenderExpressionFingerprint as expressionFingerprint,
  createPreviewRenderStableId as stableId,
  hasPreviewDefaultModifier as hasDefaultModifier,
  hasPreviewExportModifier as hasExportModifier,
  hasPreviewRenderParseDiagnostics as hasParseDiagnostics,
  isPreviewComponentName as isComponentName,
  isPreviewEmptyRenderExpression as isEmptyRenderExpression,
  isPreviewJavaScriptLikeSource as isJavaScriptLikeSource,
  isPreviewRenderFunction as isRenderFunction,
  readPreviewRenderLocation as readLocation,
  readPreviewSwitchLiteral as readSwitchLiteral,
  selectPreviewRenderScriptKind as selectScriptKind,
  unwrapPreviewRenderExpression as unwrapExpression,
} from './previewReactRenderOutcomeSyntax';
import type { PreviewRenderFunction as RenderFunction } from './previewReactRenderOutcomeSyntax';
import {
  collectPreviewComponentNames,
  collectPreviewJsxNestedRenderExpressions,
  collectPreviewStaticComponentForest,
  readPreviewComponentReferenceIdentity,
  readPreviewJsxComponentIdentity,
  readPreviewRenderFunctionReturnExpression,
} from './previewReactRenderOutcomeComponents';
import {
  collectPreviewComponentRenderBindings,
  collectPreviewModuleRenderBindings,
  readPreviewSafeLocalRenderCall,
} from './previewReactLocalRenderCalls';
import type { PreviewLocalRenderBinding as LocalRenderBinding } from './previewReactLocalRenderCalls';

export type {
  PreviewReactRenderComponentNode,
  PreviewReactRenderConditionBranch,
  PreviewReactRenderConditionEdge,
  PreviewReactRenderConditionKind,
  PreviewReactRenderOutcome,
  PreviewReactRenderOutcomeKind,
  PreviewReactRenderOutcomePlan,
  PreviewReactRenderSwitchValue,
} from './previewReactRenderOutcomeTypes';

const MAX_COMPONENT_EXPORTS = 32;
const DEFERRED_HOST_OUTPUT_NAME = '#deferred-host-output';
const MAX_OUTCOMES_PER_EXPORT = 32;
const MAX_CONTROL_FLOW_DEPTH = 12;
const MAX_LOCAL_RESOLUTION_DEPTH = 12;
const MAX_COMPONENTS_PER_OUTCOME = 32;

/** Public syntax budgets that keep malformed or generated source from expanding without bound. */
export const PREVIEW_REACT_RENDER_OUTCOME_LIMITS = Object.freeze({
  componentDepth: MAX_CONTROL_FLOW_DEPTH,
  componentsPerOutcome: MAX_COMPONENTS_PER_OUTCOME,
  exports: MAX_COMPONENT_EXPORTS,
  outcomesPerExport: MAX_OUTCOMES_PER_EXPORT,
  resolutionDepth: MAX_LOCAL_RESOLUTION_DEPTH,
});

/** One exported runtime name paired with the locally resolved function React invokes. */
interface ExportedRenderFunction {
  readonly exportName: string;
  readonly functionLike: RenderFunction;
}

/** Mutable analysis path used only while walking a single exported function. */
interface RenderPath {
  readonly conditions: readonly PreviewReactRenderConditionEdge[];
}

/** Internal result before stable identity, labels, and deep immutability are applied. */
interface MutableRenderOutcome {
  readonly componentTree: readonly PreviewReactRenderComponentNode[];
  readonly conditions: readonly PreviewReactRenderConditionEdge[];
  readonly kind: PreviewReactRenderOutcomeKind;
  readonly node: ts.Block | ts.Expression | ts.ReturnStatement;
}

/** Branch-local JSX component forest plus the nested conditions that select it. */
interface NestedRenderVariant {
  readonly componentTree: readonly PreviewReactRenderComponentNode[];
  readonly conditions: readonly PreviewReactRenderConditionEdge[];
  readonly hasHostOutput?: boolean;
}

/** Per-export safety state shared by control-flow and nested-JSX expansion. */
interface OutcomeAnalysisState {
  readonly bindings: ReadonlyMap<string, LocalRenderBinding>;
  readonly outcomes: MutableRenderOutcome[];
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
  truncated: boolean;
}

/** Result of one statement sequence: terminal outcomes are stored in state, paths can continue. */
interface StatementFlow {
  readonly continuations: readonly RenderPath[];
}

/** Optional exact-value evidence carried only by switch condition edges. */
type ConditionSelection =
  | { readonly selectable: false }
  | { readonly selectable: true; readonly value?: PreviewReactRenderSwitchValue };

/**
 * Parses and analyzes one JavaScript/TypeScript React source snapshot.
 *
 * Parse diagnostics fail closed. The returned top-level array, plans, outcomes, condition arrays,
 * and component trees are recursively frozen and contain only JSON-compatible primitives.
 *
 * @param sourcePath Source identity and parser-grammar hint.
 * @param sourceText Current source snapshot; imported modules are never read here.
 * @returns An immutable array in authored export order, or an empty frozen array on parse failure.
 */
export function analyzePreviewReactRenderOutcomes(
  sourcePath: string,
  sourceText: string,
): readonly PreviewReactRenderOutcomePlan[] {
  if (!isJavaScriptLikeSource(sourcePath)) return Object.freeze([]);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return Object.freeze([]);
  return analyzePreviewReactRenderOutcomesFromSourceFile(sourceFile, sourcePath);
}

/**
 * Analyzes an already parsed source file so callers that also instrument JSX can reuse one AST.
 *
 * @param sourceFile Successfully parsed TypeScript source file.
 * @param sourcePath Stable source identity; defaults to `sourceFile.fileName`.
 * @returns Immutable export plans, or an empty frozen array when the supplied AST has diagnostics.
 */
export function analyzePreviewReactRenderOutcomesFromSourceFile(
  sourceFile: ts.SourceFile,
  sourcePath = sourceFile.fileName,
): readonly PreviewReactRenderOutcomePlan[] {
  if (hasParseDiagnostics(sourceFile)) return Object.freeze([]);
  const bindings = collectPreviewModuleRenderBindings(sourceFile);
  const plans = collectExportedRenderFunctions(sourceFile, bindings)
    .slice(0, MAX_COMPONENT_EXPORTS)
    .map((component) => analyzeExportedRenderFunction(component, sourceFile, sourcePath, bindings));
  return Object.freeze(plans);
}

/** Finds direct exports and resolves local wrapper chains to the function React will invoke. */
function collectExportedRenderFunctions(
  sourceFile: ts.SourceFile,
  bindings: ReadonlyMap<string, LocalRenderBinding>,
): readonly ExportedRenderFunction[] {
  const exports = new Map<string, ExportedRenderFunction>();
  /** Adds only component-shaped named exports and the conventional default export. */
  const addExport = (exportName: string, expression: ts.Expression | RenderFunction): void => {
    if (exportName !== 'default' && !isComponentName(exportName)) return;
    const functionLike = resolveRenderFunction(expression, bindings, new Set(), 0);
    if (functionLike !== undefined && !exports.has(exportName)) {
      exports.set(exportName, { exportName, functionLike });
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      addExport(
        hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''),
        statement,
      );
    } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          addExport(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      addExport('default', statement.expression);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const localName = (element.propertyName ?? element.name).text;
        const exportedName = element.name.text;
        addExport(exportedName, ts.factory.createIdentifier(localName));
      }
    }
  }
  return [...exports.values()];
}

/** Resolves memo/forwardRef/styled/general HOC wrappers without crossing the current module. */
function resolveRenderFunction(
  value: ts.Expression | RenderFunction,
  bindings: ReadonlyMap<string, LocalRenderBinding>,
  visited: ReadonlySet<string>,
  depth: number,
): RenderFunction | undefined {
  if (depth > MAX_LOCAL_RESOLUTION_DEPTH) return undefined;
  if (isRenderFunction(value)) return value;
  const expression = unwrapExpression(value);
  if (isRenderFunction(expression)) return expression;
  if (ts.isIdentifier(expression)) {
    if (visited.has(expression.text)) return undefined;
    const binding = bindings.get(expression.text);
    if (binding === undefined) return undefined;
    const nextVisited = new Set(visited);
    nextVisited.add(expression.text);
    if (binding.functionLike !== undefined) return binding.functionLike;
    return binding.expression === undefined
      ? undefined
      : resolveRenderFunction(binding.expression, bindings, nextVisited, depth + 1);
  }
  if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) {
      const resolved = resolveRenderFunction(argument, bindings, visited, depth + 1);
      if (resolved !== undefined) return resolved;
    }
    if (ts.isCallExpression(expression.expression)) {
      for (const argument of expression.expression.arguments) {
        const resolved = resolveRenderFunction(argument, bindings, visited, depth + 1);
        if (resolved !== undefined) return resolved;
      }
    }
  } else if (ts.isTaggedTemplateExpression(expression)) {
    return resolveRenderFunction(expression.tag, bindings, visited, depth + 1);
  }
  return undefined;
}

/** Creates and freezes one export plan after exploring its component-local paths. */
function analyzeExportedRenderFunction(
  component: ExportedRenderFunction,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  bindings: ReadonlyMap<string, LocalRenderBinding>,
): PreviewReactRenderOutcomePlan {
  const state: OutcomeAnalysisState = {
    bindings: collectPreviewComponentRenderBindings(component.functionLike, bindings),
    outcomes: [],
    sourceFile,
    sourcePath,
    truncated: false,
  };
  const initialPath: RenderPath = { conditions: [] };
  if (ts.isArrowFunction(component.functionLike) && !ts.isBlock(component.functionLike.body)) {
    addExpressionOutcomes(component.functionLike.body, initialPath, state, 0, new Set());
  } else {
    const body = component.functionLike.body;
    if (body !== undefined && ts.isBlock(body)) {
      const flow = analyzeStatementSequence(body.statements, [initialPath], state, 0);
      for (const path of flow.continuations) addImplicitEmptyOutcome(body, path, state);
    }
  }
  const outcomes = state.outcomes
    .slice(0, MAX_OUTCOMES_PER_EXPORT)
    .map((outcome) => freezeRenderOutcome(component.exportName, outcome, sourceFile, sourcePath));
  return Object.freeze({
    exportName: component.exportName,
    outcomes: Object.freeze(outcomes),
    sourcePath,
    truncated: state.truncated || state.outcomes.length > MAX_OUTCOMES_PER_EXPORT,
  });
}

/** Walks sequential statements while carrying only paths that have not returned yet. */
function analyzeStatementSequence(
  statements: readonly ts.Statement[],
  incoming: readonly RenderPath[],
  state: OutcomeAnalysisState,
  depth: number,
): StatementFlow {
  if (depth > MAX_CONTROL_FLOW_DEPTH) {
    state.truncated = true;
    return { continuations: incoming };
  }
  let continuations = [...incoming];
  for (const statement of statements) {
    if (continuations.length === 0 || state.outcomes.length >= MAX_OUTCOMES_PER_EXPORT) break;
    const next: RenderPath[] = [];
    for (const path of continuations) {
      const flow = analyzeStatement(statement, path, state, depth);
      next.push(...flow.continuations);
      if (next.length > MAX_OUTCOMES_PER_EXPORT) {
        state.truncated = true;
        next.length = MAX_OUTCOMES_PER_EXPORT;
      }
    }
    continuations = next;
  }
  return { continuations };
}

/** Interprets only return-selecting statements and leaves unrelated JavaScript untouched. */
function analyzeStatement(
  statement: ts.Statement,
  path: RenderPath,
  state: OutcomeAnalysisState,
  depth: number,
): StatementFlow {
  if (ts.isReturnStatement(statement)) {
    if (statement.expression === undefined) addImplicitEmptyOutcome(statement, path, state);
    else addExpressionOutcomes(statement.expression, path, state, depth + 1, new Set());
    return { continuations: [] };
  }
  if (ts.isBlock(statement)) {
    return analyzeStatementSequence(statement.statements, [path], state, depth + 1);
  }
  if (ts.isIfStatement(statement)) {
    const truthy = appendCondition(
      path,
      createConditionEdge(statement.expression, 'truthy', 'if', 'truthy', state),
    );
    const falsy = appendCondition(
      path,
      createConditionEdge(statement.expression, 'falsy', 'if', 'falsy', state),
    );
    const truthyFlow = analyzeStatement(statement.thenStatement, truthy, state, depth + 1);
    const falsyFlow =
      statement.elseStatement === undefined
        ? { continuations: [falsy] }
        : analyzeStatement(statement.elseStatement, falsy, state, depth + 1);
    return { continuations: [...truthyFlow.continuations, ...falsyFlow.continuations] };
  }
  if (ts.isSwitchStatement(statement)) {
    return analyzeSwitchStatement(statement, path, state, depth + 1);
  }
  return { continuations: [path] };
}

/** Expands direct switch clauses into case/default graph edges and their returned outcomes. */
function analyzeSwitchStatement(
  statement: ts.SwitchStatement,
  path: RenderPath,
  state: OutcomeAnalysisState,
  depth: number,
): StatementFlow {
  const continuations: RenderPath[] = [];
  let hasDefault = false;
  for (const clause of statement.caseBlock.clauses) {
    if (state.outcomes.length >= MAX_OUTCOMES_PER_EXPORT) {
      state.truncated = true;
      break;
    }
    const isDefault = ts.isDefaultClause(clause);
    hasDefault ||= isDefault;
    const label = isDefault
      ? 'default'
      : `case ${boundedText(clause.expression.getText(state.sourceFile))}`;
    const literal = isDefault ? undefined : readSwitchLiteral(clause.expression);
    const selection: ConditionSelection = isDefault
      ? { selectable: true }
      : literal?.supported === true
        ? { selectable: true, value: literal.value }
        : { selectable: false };
    const edge = createConditionEdge(
      statement.expression,
      isDefault ? 'default' : 'case',
      'switch',
      label,
      state,
      selection,
    );
    const flow = analyzeStatementSequence(
      clause.statements,
      [appendCondition(path, edge)],
      state,
      depth,
    );
    continuations.push(...flow.continuations);
  }
  if (!hasDefault) {
    continuations.push(
      appendCondition(
        path,
        createConditionEdge(statement.expression, 'default', 'switch', 'no matching case', state, {
          selectable: true,
        }),
      ),
    );
  }
  return { continuations };
}

/** Converts a render expression and its nested JSX choices into terminal outcomes. */
function addExpressionOutcomes(
  expression_: ts.Expression,
  path: RenderPath,
  state: OutcomeAnalysisState,
  depth: number,
  visitedBindings: ReadonlySet<string>,
): void {
  if (state.outcomes.length >= MAX_OUTCOMES_PER_EXPORT) {
    state.truncated = true;
    return;
  }
  if (depth > MAX_CONTROL_FLOW_DEPTH) {
    state.truncated = true;
    addUnknownOutcome(expression_, path, state);
    return;
  }
  const expression = unwrapExpression(expression_);
  if (ts.isConditionalExpression(expression)) {
    addExpressionOutcomes(
      expression.whenTrue,
      appendCondition(
        path,
        createConditionEdge(expression.condition, 'truthy', 'ternary', 'truthy', state),
      ),
      state,
      depth + 1,
      visitedBindings,
    );
    addExpressionOutcomes(
      expression.whenFalse,
      appendCondition(
        path,
        createConditionEdge(expression.condition, 'falsy', 'ternary', 'falsy', state),
      ),
      state,
      depth + 1,
      visitedBindings,
    );
    return;
  }
  const logicalAnd = expandPreviewReactLogicalAndExpression(expression);
  if (logicalAnd !== undefined) {
    state.truncated ||= logicalAnd.truncated;
    const logicalEdges = createPreviewReactLogicalAndEdges(
      expression,
      logicalAnd.guards,
      state.sourceFile,
      state.sourcePath,
    );
    const hiddenPaths: RenderPath[] = [];
    let visiblePath = path;
    for (const edges of logicalEdges) {
      hiddenPaths.push(appendCondition(visiblePath, edges.falsy));
      visiblePath = appendCondition(visiblePath, edges.truthy);
    }
    addExpressionOutcomes(logicalAnd.terminal, visiblePath, state, depth + 1, visitedBindings);
    for (const hiddenPath of hiddenPaths) addEmptyOutcome(expression, hiddenPath, state);
    return;
  }
  if (ts.isIdentifier(expression)) {
    const binding = state.bindings.get(expression.text);
    if (
      binding?.expression !== undefined &&
      !visitedBindings.has(expression.text) &&
      visitedBindings.size < MAX_LOCAL_RESOLUTION_DEPTH
    ) {
      const nextVisited = new Set(visitedBindings);
      nextVisited.add(expression.text);
      addExpressionOutcomes(binding.expression, path, state, depth + 1, nextVisited);
      return;
    }
  }
  if (isEmptyRenderExpression(expression)) {
    addEmptyOutcome(expression, path, state);
    return;
  }
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  ) {
    const variants = expandNestedJsxNode(expression, state, depth + 1, visitedBindings);
    for (const variant of variants) {
      pushMutableOutcome(
        {
          componentTree: variant.componentTree,
          conditions: [...path.conditions, ...variant.conditions],
          kind: 'jsx',
          node: expression,
        },
        state,
      );
    }
    return;
  }
  if (isReactCreateElementCall(expression)) {
    const componentTree = collectCreateElementComponentTree(expression, state.sourceFile);
    pushMutableOutcome(
      { componentTree, conditions: path.conditions, kind: 'jsx', node: expression },
      state,
    );
    return;
  }
  addUnknownOutcome(expression, path, state);
}

/** Enumerates JSX-child ternaries and logical guards while preserving component nesting. */
function expandNestedJsxNode(
  node: ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement,
  state: OutcomeAnalysisState,
  depth: number,
  visitedBindings: ReadonlySet<string>,
): readonly NestedRenderVariant[] {
  if (depth > MAX_CONTROL_FLOW_DEPTH) {
    state.truncated = true;
    return [{ componentTree: collectStaticComponentForest(node, state), conditions: [] }];
  }
  const component = readPreviewJsxComponentIdentity(node, state.sourceFile);
  const directText =
    (ts.isJsxElement(node) || ts.isJsxFragment(node)) &&
    node.children.some((child) => ts.isJsxText(child) && child.text.trim().length > 0);
  const children = collectPreviewJsxNestedRenderExpressions(node, state.bindings).expressions;
  let variants: readonly NestedRenderVariant[] = [
    {
      componentTree: [],
      conditions: [],
      hasHostOutput: component === undefined && (!ts.isJsxFragment(node) || directText),
    },
  ];
  for (const child of children) {
    const childVariants = expandNestedExpression(
      child.expression,
      state,
      depth + 1,
      visitedBindings,
      child.allowComponentReference,
    ).map((variant) => ({
      ...variant,
      componentTree: child.deferred
        ? variant.componentTree.length === 0 && variant.hasHostOutput === true
          ? [
              {
                children: [],
                ...readLocation(state.sourceFile, child.expression),
                name: DEFERRED_HOST_OUTPUT_NAME,
                renderMode: 'deferred-callback' as const,
              },
            ]
          : variant.componentTree.map((component) => ({
              ...component,
              renderMode: 'deferred-callback' as const,
            }))
        : variant.componentTree,
    }));
    variants = combineNestedVariants(variants, childVariants, state);
  }
  if (component === undefined) return variants;
  return variants.map((variant) => ({
    componentTree: [
      {
        children: variant.componentTree,
        column: component.column,
        line: component.line,
        name: component.name,
      },
    ],
    conditions: variant.conditions,
  }));
}

/** Expands one JSX child/render-slot expression into branch-specific component forests. */
function expandNestedExpression(
  expression_: ts.Expression,
  state: OutcomeAnalysisState,
  depth: number,
  visitedBindings: ReadonlySet<string>,
  allowComponentReference = false,
): readonly NestedRenderVariant[] {
  if (depth > MAX_CONTROL_FLOW_DEPTH) {
    state.truncated = true;
    return [
      {
        componentTree: collectStaticComponentForest(expression_, state, allowComponentReference),
        conditions: [],
      },
    ];
  }
  const expression = unwrapExpression(expression_);
  if (allowComponentReference) {
    const component = readPreviewComponentReferenceIdentity(expression, state.sourceFile);
    if (component !== undefined) {
      return [{ componentTree: [{ ...component, children: [] }], conditions: [] }];
    }
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...prependNestedCondition(
        expandNestedExpression(
          expression.whenTrue,
          state,
          depth + 1,
          visitedBindings,
          allowComponentReference,
        ),
        createConditionEdge(expression.condition, 'truthy', 'ternary', 'truthy', state),
      ),
      ...prependNestedCondition(
        expandNestedExpression(
          expression.whenFalse,
          state,
          depth + 1,
          visitedBindings,
          allowComponentReference,
        ),
        createConditionEdge(expression.condition, 'falsy', 'ternary', 'falsy', state),
      ),
    ].slice(0, MAX_OUTCOMES_PER_EXPORT);
  }
  const logicalAnd = expandPreviewReactLogicalAndExpression(expression);
  if (logicalAnd !== undefined) {
    state.truncated ||= logicalAnd.truncated;
    const logicalEdges = createPreviewReactLogicalAndEdges(
      expression,
      logicalAnd.guards,
      state.sourceFile,
      state.sourcePath,
    );
    const truthyConditions = logicalEdges.map((edges) => edges.truthy);
    const visible = expandNestedExpression(
      logicalAnd.terminal,
      state,
      depth + 1,
      visitedBindings,
      allowComponentReference,
    ).map((variant) => ({
      ...variant,
      conditions: [...truthyConditions, ...variant.conditions],
    }));
    const hidden = logicalEdges.map((edges, index) => ({
      componentTree: [],
      conditions: [...truthyConditions.slice(0, index), edges.falsy],
    }));
    return [...visible, ...hidden].slice(0, MAX_OUTCOMES_PER_EXPORT);
  }
  if (ts.isIdentifier(expression)) {
    const binding = state.bindings.get(expression.text);
    if (
      binding !== undefined &&
      !visitedBindings.has(expression.text) &&
      visitedBindings.size < MAX_LOCAL_RESOLUTION_DEPTH
    ) {
      const nextVisited = new Set(visitedBindings);
      nextVisited.add(expression.text);
      if (binding.expression !== undefined) {
        return expandNestedExpression(
          binding.expression,
          state,
          depth + 1,
          nextVisited,
          allowComponentReference,
        );
      }
      if (allowComponentReference && binding.functionLike?.body !== undefined) {
        const returned = readPreviewRenderFunctionReturnExpression(binding.functionLike);
        return returned === undefined
          ? [
              {
                componentTree: collectStaticComponentForest(binding.functionLike.body, state),
                conditions: [],
              },
            ]
          : expandNestedExpression(returned, state, depth + 1, nextVisited, true);
      }
    }
  }
  if (isRenderFunction(expression)) {
    const returned = readPreviewRenderFunctionReturnExpression(expression);
    return returned === undefined
      ? [{ componentTree: collectStaticComponentForest(expression.body, state), conditions: [] }]
      : expandNestedExpression(returned, state, depth + 1, visitedBindings, true);
  }
  if (ts.isCallExpression(expression)) {
    const localRenderCall = readPreviewSafeLocalRenderCall(
      expression,
      state.bindings,
      visitedBindings,
      depth,
      MAX_LOCAL_RESOLUTION_DEPTH,
    );
    if (localRenderCall.kind === 'bounded') state.truncated = true;
    if (localRenderCall.kind === 'resolved') {
      return expandNestedExpression(
        localRenderCall.expression,
        state,
        depth + 1,
        localRenderCall.visitedBindings,
        allowComponentReference,
      );
    }
  }
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  ) {
    return expandNestedJsxNode(expression, state, depth + 1, visitedBindings);
  }
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
    return [{ componentTree: [], conditions: [], hasHostOutput: true }];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    let variants: readonly NestedRenderVariant[] = [{ componentTree: [], conditions: [] }];
    for (const element of expression.elements) {
      if (!ts.isSpreadElement(element)) {
        variants = combineNestedVariants(
          variants,
          expandNestedExpression(
            element,
            state,
            depth + 1,
            visitedBindings,
            allowComponentReference,
          ),
          state,
        );
      }
    }
    return variants;
  }
  return [
    {
      componentTree: collectStaticComponentForest(expression, state, allowComponentReference),
      conditions: [],
    },
  ];
}

/** Forms a bounded Cartesian product of independent JSX child choices. */
function combineNestedVariants(
  left: readonly NestedRenderVariant[],
  right: readonly NestedRenderVariant[],
  state: OutcomeAnalysisState,
): readonly NestedRenderVariant[] {
  const combined: NestedRenderVariant[] = [];
  for (const leftVariant of left) {
    for (const rightVariant of right) {
      if (combined.length >= MAX_OUTCOMES_PER_EXPORT) {
        state.truncated = true;
        return combined;
      }
      combined.push({
        componentTree: [...leftVariant.componentTree, ...rightVariant.componentTree],
        conditions: [...leftVariant.conditions, ...rightVariant.conditions],
        hasHostOutput: leftVariant.hasHostOutput === true || rightVariant.hasHostOutput === true,
      });
    }
  }
  return combined;
}

/** Adds one condition before every nested variant without mutating shared branch arrays. */
function prependNestedCondition(
  variants: readonly NestedRenderVariant[],
  condition: PreviewReactRenderConditionEdge,
): readonly NestedRenderVariant[] {
  return variants.map((variant) => ({
    ...variant,
    conditions: [condition, ...variant.conditions],
  }));
}

/** Adds one bounded terminal result and marks overflow instead of growing the graph indefinitely. */
function pushMutableOutcome(outcome: MutableRenderOutcome, state: OutcomeAnalysisState): void {
  if (state.outcomes.length >= MAX_OUTCOMES_PER_EXPORT) {
    state.truncated = true;
    return;
  }
  state.outcomes.push(outcome);
}

/** Adds a direct or implicit React-empty return result. */
function addEmptyOutcome(
  node: ts.Block | ts.Expression | ts.ReturnStatement,
  path: RenderPath,
  state: OutcomeAnalysisState,
): void {
  pushMutableOutcome(
    { componentTree: [], conditions: path.conditions, kind: 'empty', node },
    state,
  );
}

/** Adds a fallthrough/`return;` result without inventing a JSX component. */
function addImplicitEmptyOutcome(
  node: ts.ReturnStatement | ts.Block,
  path: RenderPath,
  state: OutcomeAnalysisState,
): void {
  addEmptyOutcome(node, path, state);
}

/** Adds an expression whose React render semantics cannot be proven by local syntax. */
function addUnknownOutcome(
  node: ts.Expression,
  path: RenderPath,
  state: OutcomeAnalysisState,
): void {
  pushMutableOutcome(
    {
      componentTree: collectStaticComponentForest(node, state),
      conditions: path.conditions,
      kind: 'unknown',
      node,
    },
    state,
  );
}

/** Creates a frozen condition edge with source-stable identity. */
function createConditionEdge(
  expression: ts.Expression,
  branch: PreviewReactRenderConditionBranch,
  kind: PreviewReactRenderConditionKind,
  label: string,
  state: OutcomeAnalysisState,
  selection: ConditionSelection = { selectable: true },
): PreviewReactRenderConditionEdge {
  const location = readLocation(state.sourceFile, expression);
  const authoredExpression = expression.getText(state.sourceFile);
  const expressionText = boundedText(authoredExpression);
  const fingerprint = expressionFingerprint(authoredExpression);
  return Object.freeze({
    branch,
    column: location.column,
    expression: expressionText,
    expressionFingerprint: fingerprint,
    id: stableId(
      'condition',
      state.sourcePath,
      String(location.line),
      String(location.column),
      kind,
      branch,
      fingerprint,
      expressionText,
      label,
    ),
    kind,
    label: boundedText(label),
    line: location.line,
    selectable: selection.selectable,
    sourcePath: state.sourcePath,
    ...('value' in selection ? { value: selection.value } : {}),
  });
}

/** Appends one immutable condition edge to a render path. */
function appendCondition(path: RenderPath, condition: PreviewReactRenderConditionEdge): RenderPath {
  return { conditions: [...path.conditions, condition] };
}

/** Finalizes one outcome, including a bounded deep-frozen component tree and DFS projection. */
function freezeRenderOutcome(
  exportName: string,
  outcome: MutableRenderOutcome,
  sourceFile: ts.SourceFile,
  sourcePath: string,
): PreviewReactRenderOutcome {
  const componentTree = freezeComponentForest(outcome.componentTree, {
    remaining: MAX_COMPONENTS_PER_OUTCOME,
  });
  const componentNames = collectPreviewComponentNames(componentTree, DEFERRED_HOST_OUTPUT_NAME);
  const location = readLocation(sourceFile, outcome.node);
  const label = describeOutcome(outcome, componentNames, sourceFile);
  const conditions = Object.freeze([...outcome.conditions]);
  return Object.freeze({
    column: location.column,
    componentNames,
    componentTree,
    conditions,
    exportName,
    id: stableId(
      'outcome',
      sourcePath,
      exportName,
      String(location.line),
      String(location.column),
      outcome.kind,
      expressionFingerprint(outcome.node.getText(sourceFile)),
      label,
      conditions.map((condition) => condition.id).join('|'),
      componentNames.join('|'),
    ),
    kind: outcome.kind,
    label,
    line: location.line,
    sourcePath,
  });
}

/** Deep-freezes and prunes a component forest while preserving ancestor relationships. */
function freezeComponentForest(
  nodes: readonly PreviewReactRenderComponentNode[],
  budget: { remaining: number },
): readonly PreviewReactRenderComponentNode[] {
  const frozen: PreviewReactRenderComponentNode[] = [];
  for (const node of nodes) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    const children = freezeComponentForest(node.children, budget);
    frozen.push(
      Object.freeze({
        children,
        column: node.column,
        line: node.line,
        name: node.name,
        ...(node.renderMode === undefined ? {} : { renderMode: node.renderMode }),
      }),
    );
  }
  return Object.freeze(frozen);
}

/** Provides a compact label that distinguishes nested conditional component variants. */
function describeOutcome(
  outcome: MutableRenderOutcome,
  componentNames: readonly string[],
  sourceFile: ts.SourceFile,
): string {
  if (outcome.kind === 'empty') return 'render nothing';
  const sourceLabel = boundedText(outcome.node.getText(sourceFile));
  if (outcome.kind === 'unknown')
    return sourceLabel.length === 0 ? 'unknown render value' : sourceLabel;
  if (componentNames.length === 0) return sourceLabel;
  return boundedText(`${sourceLabel} → ${componentNames.join(', ')}`);
}

/** Collects bounded fallback component evidence and propagates traversal truncation to the plan. */
function collectStaticComponentForest(
  node: ts.Node,
  state: OutcomeAnalysisState,
  allowRootComponentReference = false,
): readonly PreviewReactRenderComponentNode[] {
  const result = collectPreviewStaticComponentForest(
    node,
    state.sourceFile,
    state.bindings,
    allowRootComponentReference,
  );
  state.truncated ||= result.truncated;
  return result.componentTree;
}

/** Creates one shallow component tree for a conventional `React.createElement` call. */
function collectCreateElementComponentTree(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): readonly PreviewReactRenderComponentNode[] {
  const typeArgument = call.arguments[0];
  if (typeArgument === undefined) return [];
  const name =
    ts.isIdentifier(typeArgument) || ts.isPropertyAccessExpression(typeArgument)
      ? typeArgument.getText(sourceFile)
      : undefined;
  if (name === undefined || (!isComponentName(name) && !name.includes('.'))) return [];
  const location = readLocation(sourceFile, typeArgument);
  return [{ children: [], column: location.column, line: location.line, name }];
}

/** Reports whether an expression is a conventional React element factory call. */
function isReactCreateElementCall(expression: ts.Expression): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  return (
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'createElement' &&
      callee.expression.getText().endsWith('React')) ||
    (ts.isIdentifier(callee) && callee.text === 'createElement')
  );
}
