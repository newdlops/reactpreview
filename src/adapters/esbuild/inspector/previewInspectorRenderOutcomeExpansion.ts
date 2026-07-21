/**
 * Expands target-local JSX outcomes through the implementations of referenced React components.
 *
 * The base outcome analyzer intentionally stays inside one file. Page composition needs one more
 * layer: a returned `<PageLayout><Body /></PageLayout>` should expose the layout's Header/Sidebar
 * and the authored Body below the same node. This module performs that work as a bounded,
 * syntax-only DFS. It never evaluates application code, never scans unrelated exports, and stops
 * safely on unresolved imports, parse failures, cycles, or explicit depth/node/source budgets.
 */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  analyzePreviewReactRenderOutcomes,
  type PreviewReactRenderComponentNode,
  type PreviewReactRenderOutcome,
  type PreviewReactRenderOutcomePlan,
} from '../staticResources/previewReactRenderOutcomes';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import { createLexicalInspectorModuleResolver } from './previewInspectorLexicalResolver';

const MAX_EXPANSION_DEPTH = 7;
const MAX_COMPONENT_NODES_PER_OUTCOME = 96;
const MAX_IMPLEMENTATION_OUTCOMES = 8;
const MAX_SOURCE_MODULES = 24;

/** Public limits make truncation behavior testable and keep large monorepos predictable. */
export const PREVIEW_INSPECTOR_RENDER_OUTCOME_EXPANSION_LIMITS = Object.freeze({
  componentNodesPerOutcome: MAX_COMPONENT_NODES_PER_OUTCOME,
  depth: MAX_EXPANSION_DEPTH,
  implementationOutcomes: MAX_IMPLEMENTATION_OUTCOMES,
  sourceModules: MAX_SOURCE_MODULES,
});

/** Inputs required to expand only the selected module's already-proven export outcomes. */
export interface ExpandPreviewInspectorRenderOutcomesOptions {
  /** Base target-local plans produced by the syntax-only outcome analyzer. */
  readonly plans: readonly PreviewReactRenderOutcomePlan[];
  /** Snapshot-aware source reader; dirty editor content remains authoritative. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Optional project-aware resolver for aliases, workspaces, and package export maps. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Stops stale DFS work between module reads and target outcomes. */
  readonly signal?: AbortSignal;
  /** Absolute selected module path. */
  readonly sourcePath: string;
  /** Current selected source snapshot, avoiding a duplicate first read. */
  readonly sourceText: string;
  /** Bounded project inventory used only by the relative-import fallback resolver. */
  readonly sourcePaths: readonly string[];
}

/** Expanded descriptor fragment plus every child source that must participate in preview HMR. */
export interface ExpandedPreviewInspectorRenderOutcomes {
  /** Source paths actually read while resolving the selected outcomes, sorted deterministically. */
  readonly dependencyPaths: readonly string[];
  /** Expanded target plans in the same authored export order as the input. */
  readonly plans: readonly PreviewReactRenderOutcomePlan[];
}

/** Inputs for the target-only analyze-and-expand operation used by the ancestor planner. */
export interface CollectPreviewInspectorRenderOutcomesOptions {
  /** Export keys admitted by the independently built application render graph. */
  readonly acceptedExportNames: readonly string[];
  /** Snapshot-aware project source reader. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Optional project-aware module resolver. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Cancels stale source reads. */
  readonly signal?: AbortSignal;
  /** Selected editor module. */
  readonly sourcePath: string;
  /** Bounded source inventory for relative-resolution fallback. */
  readonly sourcePaths: readonly string[];
}

/** Final planner fragment with immutable export lookup and child HMR dependencies. */
export interface CollectedPreviewInspectorRenderOutcomes {
  readonly dependencyPaths: readonly string[];
  readonly plansByExport: Readonly<Record<string, PreviewReactRenderOutcomePlan>>;
}

/** One source/export identity followed by cycle detection and re-export traversal. */
interface ComponentReference {
  readonly exportName: string;
  readonly sourcePath: string;
}

/** A named export either forwards a local binding or points directly at another module. */
type ExportBinding =
  | { readonly kind: 'local'; readonly localName: string }
  | { readonly kind: 'reference'; readonly reference: ComponentReference };

/** Parsed, immutable-enough module index retained only for one expansion call. */
interface ComponentModuleRecord {
  readonly aliases: ReadonlyMap<string, string>;
  readonly exportBindings: ReadonlyMap<string, ExportBinding>;
  readonly imports: ReadonlyMap<string, ComponentReference>;
  readonly localComponentNames: ReadonlySet<string>;
  readonly namespaceImports: ReadonlyMap<string, string>;
  readonly plansByExport: ReadonlyMap<string, PreviewReactRenderOutcomePlan>;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
  readonly starExportSources: readonly string[];
}

/** Shared caches and source budget prevent repeated parsing across sibling target outcomes. */
interface ExpansionContext {
  readonly dependencyPaths: Set<string>;
  readonly modulePromises: Map<string, Promise<ComponentModuleRecord | undefined>>;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  sourceReservations: number;
}

/** Per-outcome graph budget ensures one branch cannot consume an unbounded descriptor. */
interface ExpansionBudget {
  remainingNodes: number;
  truncated: boolean;
}

/** A renderable source/export after chasing local aliases and barrel re-exports. */
interface ResolvedComponentPlan {
  readonly plan: PreviewReactRenderOutcomePlan;
  readonly record: ComponentModuleRecord;
  readonly reference: ComponentReference;
}

/**
 * Reads and analyzes only the selected module, then expands its admitted export outcomes by DFS.
 * Missing target source returns an empty immutable fragment rather than weakening preview safety.
 */
export async function collectPreviewInspectorRenderOutcomes(
  options: CollectPreviewInspectorRenderOutcomesOptions,
): Promise<CollectedPreviewInspectorRenderOutcomes> {
  throwIfPreviewBuildCancelled(options.signal);
  const sourceText = await options.readSource(options.sourcePath);
  throwIfPreviewBuildCancelled(options.signal);
  if (sourceText === undefined) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), plansByExport: Object.freeze({}) });
  }
  const acceptedExportNames = new Set(options.acceptedExportNames);
  const plans = analyzePreviewReactRenderOutcomes(options.sourcePath, sourceText).filter((plan) =>
    acceptedExportNames.has(plan.exportName),
  );
  const expanded = await expandPreviewInspectorRenderOutcomes({
    plans,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePath: options.sourcePath,
    sourcePaths: options.sourcePaths,
    sourceText,
  });
  return Object.freeze({
    dependencyPaths: expanded.dependencyPaths,
    plansByExport: Object.freeze(
      Object.fromEntries(expanded.plans.map((plan) => [plan.exportName, plan])),
    ),
  });
}

/**
 * Expands every admitted target export plan while preserving the public outcome transport shape.
 *
 * Each component occurrence retains its authored call-site source. Its implementation children are
 * inserted first, followed by children passed at the call site, with deterministic sibling
 * de-duplication. Consequently a layout's shell and the selected body stay under one layout node.
 */
export async function expandPreviewInspectorRenderOutcomes(
  options: ExpandPreviewInspectorRenderOutcomesOptions,
): Promise<ExpandedPreviewInspectorRenderOutcomes> {
  throwIfPreviewBuildCancelled(options.signal);
  const normalizedSourcePath = path.normalize(options.sourcePath);
  const context: ExpansionContext = {
    dependencyPaths: new Set([normalizedSourcePath]),
    modulePromises: new Map(),
    readSource: options.readSource,
    resolveModule:
      options.resolveModule ?? createLexicalInspectorModuleResolver(options.sourcePaths),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourceReservations: 1,
  };
  context.modulePromises.set(
    normalizedSourcePath,
    Promise.resolve(createComponentModuleRecord(normalizedSourcePath, options.sourceText, context)),
  );

  const expandedPlans: PreviewReactRenderOutcomePlan[] = [];
  for (const plan of options.plans) {
    throwIfPreviewBuildCancelled(options.signal);
    expandedPlans.push(await expandTargetPlan(plan, context));
  }
  return Object.freeze({
    dependencyPaths: Object.freeze([...context.dependencyPaths].sort()),
    plans: Object.freeze(expandedPlans),
  });
}

/** Expands each return independently so its node budget and truncation status remain local. */
async function expandTargetPlan(
  plan: PreviewReactRenderOutcomePlan,
  context: ExpansionContext,
): Promise<PreviewReactRenderOutcomePlan> {
  const outcomes: PreviewReactRenderOutcome[] = [];
  let truncated = plan.truncated;
  for (const outcome of plan.outcomes) {
    throwIfPreviewBuildCancelled(context.signal);
    const budget: ExpansionBudget = {
      remainingNodes: MAX_COMPONENT_NODES_PER_OUTCOME,
      truncated: false,
    };
    const componentTree = await expandComponentForest(
      outcome.componentTree,
      plan.sourcePath,
      context,
      budget,
      new Set([createReferenceKey({ exportName: plan.exportName, sourcePath: plan.sourcePath })]),
      0,
    );
    const componentNames = collectExpandedComponentNames(componentTree);
    outcomes.push(
      Object.freeze({
        ...outcome,
        componentNames,
        componentTree,
      }),
    );
    truncated ||= budget.truncated;
  }
  return Object.freeze({
    ...plan,
    outcomes: Object.freeze(outcomes),
    truncated,
  });
}

/** Recursively expands a sibling forest in authored order under the caller's shared budget. */
async function expandComponentForest(
  nodes: readonly PreviewReactRenderComponentNode[],
  ownerSourcePath: string,
  context: ExpansionContext,
  budget: ExpansionBudget,
  visitedReferences: ReadonlySet<string>,
  depth: number,
): Promise<readonly PreviewReactRenderComponentNode[]> {
  const expanded: PreviewReactRenderComponentNode[] = [];
  for (const node of nodes) {
    if (budget.remainingNodes <= 0) {
      budget.truncated = true;
      break;
    }
    expanded.push(
      await expandComponentNode(node, ownerSourcePath, context, budget, visitedReferences, depth),
    );
  }
  return Object.freeze(expanded);
}

/**
 * Resolves one JSX tag, DFS-expands all bounded implementation outcomes, then retains call children.
 * A depth/cycle stop still publishes the occurrence itself; it merely omits speculative descendants.
 */
async function expandComponentNode(
  node: PreviewReactRenderComponentNode,
  ownerSourcePath: string,
  context: ExpansionContext,
  budget: ExpansionBudget,
  visitedReferences: ReadonlySet<string>,
  depth: number,
): Promise<PreviewReactRenderComponentNode> {
  budget.remainingNodes -= 1;
  const sourcePath = path.normalize(node.sourcePath ?? ownerSourcePath);
  if (depth >= MAX_EXPANSION_DEPTH) {
    // The node itself is retained, but its implementation has intentionally not been inspected.
    // Mark the public plan conservatively even when authored JSX children are empty: a leaf-shaped
    // call site can still render an arbitrarily deep imported implementation.
    budget.truncated = true;
    return freezeExpandedComponentNode(node, sourcePath, []);
  }

  // Reserve the caller-authored subtree first. It contains the selected-file body passed through a
  // layout's `children` slot and must survive even when a very large shell consumes the remaining
  // descriptor budget. Final visual order still places implementation shell pieces before it.
  const authoredChildren = await expandComponentForest(
    node.children,
    sourcePath,
    context,
    budget,
    visitedReferences,
    depth + 1,
  );
  const implementationChildren: PreviewReactRenderComponentNode[] = [];
  const ownerRecord = await readComponentModuleRecord(sourcePath, context, budget);
  const reference =
    ownerRecord === undefined
      ? undefined
      : resolveJsxComponentReference(node.name, ownerRecord, new Set());
  if (reference !== undefined && !visitedReferences.has(createReferenceKey(reference))) {
    const resolved = await resolveComponentPlan(reference, context, budget, new Set());
    if (resolved !== undefined) {
      const nextVisited = new Set(visitedReferences);
      nextVisited.add(createReferenceKey(resolved.reference));
      const implementationOutcomes = resolved.plan.outcomes.slice(0, MAX_IMPLEMENTATION_OUTCOMES);
      if (
        resolved.plan.outcomes.length > implementationOutcomes.length ||
        resolved.plan.truncated
      ) {
        budget.truncated = true;
      }
      for (const outcome of implementationOutcomes) {
        implementationChildren.push(
          ...(await expandComponentForest(
            outcome.componentTree,
            resolved.record.sourcePath,
            context,
            budget,
            nextVisited,
            depth + 1,
          )),
        );
      }
    }
  }

  const children = deduplicateExpandedSiblings([...implementationChildren, ...authoredChildren]);
  return freezeExpandedComponentNode(node, sourcePath, children);
}

/** Loads and indexes one source once, reserving budget before asynchronous I/O for determinism. */
async function readComponentModuleRecord(
  sourcePath_: string,
  context: ExpansionContext,
  budget: ExpansionBudget,
): Promise<ComponentModuleRecord | undefined> {
  const sourcePath = path.normalize(sourcePath_);
  const cached = context.modulePromises.get(sourcePath);
  if (cached !== undefined) return cached;
  if (context.sourceReservations >= MAX_SOURCE_MODULES) {
    budget.truncated = true;
    return undefined;
  }
  context.sourceReservations += 1;
  const pending = (async (): Promise<ComponentModuleRecord | undefined> => {
    throwIfPreviewBuildCancelled(context.signal);
    const sourceText = await context.readSource(sourcePath);
    throwIfPreviewBuildCancelled(context.signal);
    if (sourceText === undefined) return undefined;
    context.dependencyPaths.add(sourcePath);
    return createComponentModuleRecord(sourcePath, sourceText, context);
  })();
  context.modulePromises.set(sourcePath, pending);
  return pending;
}

/** Parses one module and builds only the import/export/local indexes needed by component DFS. */
function createComponentModuleRecord(
  sourcePath: string,
  sourceText: string,
  context: ExpansionContext,
): ComponentModuleRecord | undefined {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectExpansionScriptKind(sourcePath),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return undefined;
  const localComponentNames = collectLocalComponentNames(sourceFile);
  const augmentedSource = appendLocalComponentExports(sourceText, localComponentNames);
  const plans = analyzePreviewReactRenderOutcomes(sourcePath, augmentedSource);
  const imports = new Map<string, ComponentReference>();
  const namespaceImports = new Map<string, string>();
  const aliases = new Map<string, string>();
  const exportBindings = new Map<string, ExportBinding>();
  const starExportSources: string[] = [];
  collectModuleBindings({
    aliases,
    context,
    exportBindings,
    imports,
    namespaceImports,
    sourceFile,
    sourcePath,
    starExportSources,
  });
  return {
    aliases,
    exportBindings,
    imports,
    localComponentNames,
    namespaceImports,
    plansByExport: new Map(plans.map((plan) => [plan.exportName, plan])),
    sourceFile,
    sourcePath,
    starExportSources: Object.freeze(starExportSources),
  };
}

/** Mutable collector arguments kept explicit to make each syntax boundary independently testable. */
interface CollectModuleBindingsOptions {
  readonly aliases: Map<string, string>;
  readonly context: ExpansionContext;
  readonly exportBindings: Map<string, ExportBinding>;
  readonly imports: Map<string, ComponentReference>;
  readonly namespaceImports: Map<string, string>;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
  readonly starExportSources: string[];
}

/** Collects ES imports, aliases/lazy references, and barrel exports without type evaluation. */
function collectModuleBindings(options: CollectModuleBindingsOptions): void {
  for (const statement of options.sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) collectImportDeclaration(statement, options);
    else if (ts.isVariableStatement(statement)) collectVariableAliases(statement, options);
    else if (ts.isExportDeclaration(statement)) collectExportDeclaration(statement, options);
    else if (ts.isExportAssignment(statement)) collectExportAssignment(statement, options);
  }
}

/** Records value imports only when the project resolver proves a concrete authored module. */
function collectImportDeclaration(
  statement: ts.ImportDeclaration,
  options: CollectModuleBindingsOptions,
): void {
  if (
    !ts.isStringLiteralLike(statement.moduleSpecifier) ||
    statement.importClause === undefined ||
    statement.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword
  ) {
    return;
  }
  const resolved = resolveExpansionModule(
    statement.moduleSpecifier.text,
    options.sourcePath,
    options.context.resolveModule,
  );
  if (resolved === undefined) return;
  const clause = statement.importClause;
  if (clause.name !== undefined) {
    options.imports.set(clause.name.text, { exportName: 'default', sourcePath: resolved });
  }
  if (clause.namedBindings === undefined) return;
  if (ts.isNamespaceImport(clause.namedBindings)) {
    options.namespaceImports.set(clause.namedBindings.name.text, resolved);
    return;
  }
  for (const element of clause.namedBindings.elements) {
    if (element.isTypeOnly) continue;
    options.imports.set(element.name.text, {
      exportName: (element.propertyName ?? element.name).text,
      sourcePath: resolved,
    });
  }
}

/** Connects local aliases and common lazy/dynamic wrappers to their referenced component value. */
function collectVariableAliases(
  statement: ts.VariableStatement,
  options: CollectModuleBindingsOptions,
): void {
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
    const dynamicReference = readDynamicComponentReference(
      declaration.initializer,
      options.sourcePath,
      options.context.resolveModule,
    );
    if (dynamicReference !== undefined) {
      options.imports.set(declaration.name.text, dynamicReference);
      continue;
    }
    const aliasName = readWrappedComponentIdentifier(declaration.initializer);
    if (aliasName !== undefined && aliasName !== declaration.name.text) {
      options.aliases.set(declaration.name.text, aliasName);
    }
  }
}

/** Records direct and wildcard re-exports so component barrels remain transparent to DFS. */
function collectExportDeclaration(
  statement: ts.ExportDeclaration,
  options: CollectModuleBindingsOptions,
): void {
  const moduleSpecifier =
    statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  const resolved =
    moduleSpecifier === undefined
      ? undefined
      : resolveExpansionModule(moduleSpecifier, options.sourcePath, options.context.resolveModule);
  if (statement.exportClause === undefined) {
    if (resolved !== undefined) options.starExportSources.push(resolved);
    return;
  }
  if (!ts.isNamedExports(statement.exportClause)) return;
  for (const element of statement.exportClause.elements) {
    if (element.isTypeOnly) continue;
    const exportedName = element.name.text;
    const localOrImportedName = (element.propertyName ?? element.name).text;
    if (resolved === undefined) {
      options.exportBindings.set(exportedName, {
        kind: 'local',
        localName: localOrImportedName,
      });
    } else {
      options.exportBindings.set(exportedName, {
        kind: 'reference',
        reference: { exportName: localOrImportedName, sourcePath: resolved },
      });
    }
  }
}

/** Preserves `export default ImportedOrLazyComponent` when no local function plan exists. */
function collectExportAssignment(
  statement: ts.ExportAssignment,
  options: CollectModuleBindingsOptions,
): void {
  if (statement.isExportEquals) return;
  const dynamicReference = readDynamicComponentReference(
    statement.expression,
    options.sourcePath,
    options.context.resolveModule,
  );
  if (dynamicReference !== undefined) {
    options.exportBindings.set('default', { kind: 'reference', reference: dynamicReference });
    return;
  }
  const localName = readWrappedComponentIdentifier(statement.expression);
  if (localName !== undefined) {
    options.exportBindings.set('default', { kind: 'local', localName });
  }
}

/** Resolves a JSX identifier/member name against imports, namespaces, aliases, and local functions. */
function resolveJsxComponentReference(
  componentName: string,
  record: ComponentModuleRecord,
  visitedAliases: ReadonlySet<string>,
): ComponentReference | undefined {
  const memberParts = componentName.split('.');
  if (memberParts.length === 2) {
    const namespaceSource = record.namespaceImports.get(memberParts[0] ?? '');
    const exportName = memberParts[1];
    return namespaceSource === undefined || exportName === undefined
      ? undefined
      : { exportName, sourcePath: namespaceSource };
  }
  if (memberParts.length !== 1) return undefined;
  const localName = memberParts[0];
  if (localName === undefined || visitedAliases.has(localName)) return undefined;
  const imported = record.imports.get(localName);
  if (imported !== undefined) return imported;
  const alias = record.aliases.get(localName);
  if (alias !== undefined) {
    const nextVisited = new Set(visitedAliases);
    nextVisited.add(localName);
    return resolveJsxComponentReference(alias, record, nextVisited);
  }
  return record.localComponentNames.has(localName)
    ? { exportName: localName, sourcePath: record.sourcePath }
    : undefined;
}

/** Chases a component reference through direct plans, local export aliases, and wildcard barrels. */
async function resolveComponentPlan(
  reference: ComponentReference,
  context: ExpansionContext,
  budget: ExpansionBudget,
  visited: ReadonlySet<string>,
): Promise<ResolvedComponentPlan | undefined> {
  const normalizedReference = freezeReference(reference.sourcePath, reference.exportName);
  const key = createReferenceKey(normalizedReference);
  if (visited.has(key)) return undefined;
  const nextVisited = new Set(visited);
  nextVisited.add(key);
  const record = await readComponentModuleRecord(normalizedReference.sourcePath, context, budget);
  if (record === undefined) return undefined;
  const plan = record.plansByExport.get(normalizedReference.exportName);
  if (plan !== undefined) return { plan, record, reference: normalizedReference };

  const binding = record.exportBindings.get(normalizedReference.exportName);
  if (binding?.kind === 'reference') {
    return resolveComponentPlan(binding.reference, context, budget, nextVisited);
  }
  if (binding?.kind === 'local') {
    const localReference = resolveJsxComponentReference(binding.localName, record, new Set());
    if (localReference !== undefined) {
      return resolveComponentPlan(localReference, context, budget, nextVisited);
    }
  }
  if (normalizedReference.exportName !== 'default') {
    for (const sourcePath of record.starExportSources) {
      const resolved = await resolveComponentPlan(
        { exportName: normalizedReference.exportName, sourcePath },
        context,
        budget,
        nextVisited,
      );
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

/** Finds PascalCase local declarations eligible for the analyzer's synthetic named exports. */
function collectLocalComponentNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      if (isExpansionComponentName(statement.name.text)) names.add(statement.name.text);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && isExpansionComponentName(declaration.name.text)) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

/** Adds local aliases only to the analysis snapshot; authored source and offsets remain untouched. */
function appendLocalComponentExports(sourceText: string, names: ReadonlySet<string>): string {
  if (names.size === 0) return sourceText;
  return `${sourceText}\nexport { ${[...names].sort().join(', ')} };`;
}

/** Reads a component identifier through transparent parentheses/assertions and wrapper calls. */
function readWrappedComponentIdentifier(expression_: ts.Expression): string | undefined {
  const expression = unwrapExpansionExpression(expression_);
  if (ts.isIdentifier(expression) && isExpansionComponentName(expression.text)) {
    return expression.text;
  }
  if (!ts.isCallExpression(expression)) return undefined;
  for (const argument of expression.arguments) {
    if (ts.isSpreadElement(argument)) continue;
    const identifier = readWrappedComponentIdentifier(argument);
    if (identifier !== undefined) return identifier;
  }
  return undefined;
}

/** Recognizes common lazy/dynamic import factories without depending on a framework package name. */
function readDynamicComponentReference(
  expression: ts.Expression,
  consumerPath: string,
  resolveModule: ResolvePreviewRenderGraphModule,
): ComponentReference | undefined {
  const discovery: {
    hasUnresolvedProjection: boolean;
    moduleSpecifier?: string;
    selectedExport?: string;
  } = { hasUnresolvedProjection: false };
  const visit = (node: ts.Node): void => {
    if (discovery.moduleSpecifier !== undefined && discovery.selectedExport !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      discovery.moduleSpecifier = node.arguments[0].text;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      (ts.isIdentifier(node.expression) || ts.isAwaitExpression(node.expression)) &&
      isExpansionComponentName(node.name.text)
    ) {
      discovery.selectedExport = node.name.text;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'then') {
      discovery.hasUnresolvedProjection = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  if (
    discovery.moduleSpecifier === undefined ||
    (discovery.hasUnresolvedProjection && discovery.selectedExport === undefined)
  ) {
    return undefined;
  }
  const resolved = resolveExpansionModule(discovery.moduleSpecifier, consumerPath, resolveModule);
  return resolved === undefined
    ? undefined
    : { exportName: discovery.selectedExport ?? 'default', sourcePath: resolved };
}

/** Removes syntax-only wrappers while retaining the underlying component expression. */
function unwrapExpansionExpression(expression: ts.Expression): ts.Expression {
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

/** Normalizes resolver output and rejects unresolved/external package identities fail-closed. */
function resolveExpansionModule(
  moduleSpecifier: string,
  consumerPath: string,
  resolveModule: ResolvePreviewRenderGraphModule,
): string | undefined {
  const resolved = resolveModule(moduleSpecifier, consumerPath);
  return resolved === undefined ? undefined : path.normalize(resolved);
}

/** Deep-freezes one expanded occurrence and records its call-site module for UI navigation. */
function freezeExpandedComponentNode(
  node: PreviewReactRenderComponentNode,
  sourcePath: string,
  children: readonly PreviewReactRenderComponentNode[],
): PreviewReactRenderComponentNode {
  return Object.freeze({
    children: Object.freeze([...children]),
    column: node.column,
    line: node.line,
    name: node.name,
    sourcePath,
  });
}

/** Removes repeated branch components without conflating equal locations from different modules. */
function deduplicateExpandedSiblings(
  nodes: readonly PreviewReactRenderComponentNode[],
): readonly PreviewReactRenderComponentNode[] {
  const unique: PreviewReactRenderComponentNode[] = [];
  const keys = new Set<string>();
  for (const node of nodes) {
    const key = [node.sourcePath ?? '', String(node.line), String(node.column), node.name].join(
      ':',
    );
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(node);
  }
  return Object.freeze(unique);
}

/** Projects expanded component names in stable first-seen DFS order. */
function collectExpandedComponentNames(
  nodes: readonly PreviewReactRenderComponentNode[],
): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const visit = (children: readonly PreviewReactRenderComponentNode[]): void => {
    for (const child of children) {
      if (!seen.has(child.name)) {
        seen.add(child.name);
        names.push(child.name);
      }
      visit(child.children);
    }
  };
  visit(nodes);
  return Object.freeze(names);
}

/** Produces a path-normalized reference for cache and cycle identity. */
function freezeReference(sourcePath: string, exportName: string): ComponentReference {
  return Object.freeze({ exportName, sourcePath: path.normalize(sourcePath) });
}

/** Stable cycle key for one exact module export. */
function createReferenceKey(reference: ComponentReference): string {
  return `${path.normalize(reference.sourcePath)}\u0000${reference.exportName}`;
}

/** Restricts synthetic local exports to conventional component-shaped identifiers. */
function isExpansionComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/u.test(name);
}

/** Selects TS parser grammar without importing private analyzer helpers. */
function selectExpansionScriptKind(sourcePath: string): ts.ScriptKind {
  if (/\.tsx$/iu.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/iu.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.mts$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  if (/\.cts$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  if (/\.ts$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}
