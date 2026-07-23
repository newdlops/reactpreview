/**
 * Connects resolved imports to the exact shallow render outcome containing a selected child.
 *
 * Existing render-outcome analysis already separates authored returns/branches and expands safe
 * component props and local JSX helpers. Existing render-graph facts already prove React.lazy and
 * local memo/styled/HOC transports. This adapter joins those two inert fact sets, retaining only
 * wrappers and direct visual siblings of the selected corridor child. No project value is loaded
 * or evaluated.
 */
import path from 'node:path';
import { analyzePreviewRenderSource } from '../renderGraph/previewRenderSourceAnalysis';
import type {
  PreviewRenderInvocationMode,
  ResolvePreviewRenderGraphModule,
} from '../renderGraph/previewRenderGraphTypes';
import {
  analyzePreviewReactRenderOutcomes,
  PREVIEW_REACT_RENDER_OUTCOME_LIMITS,
} from '../staticResources/previewReactRenderOutcomes';
import type { PreviewReactRenderComponentNode } from '../staticResources/previewReactRenderOutcomeTypes';
import type {
  PreviewInspectorOneHopVisualPath,
  PreviewInspectorShallowVisualLocalEdge,
  PreviewInspectorShallowVisualLocalEdgeKind,
  PreviewInspectorShallowVisualRelation,
} from './previewInspectorShallowVisualTypes';

const MAXIMUM_LOCAL_TRANSPORT_DEPTH = 6;
const MAXIMUM_RAW_VISUAL_PATHS = 512;
const COMPONENT_NAME_PATTERN = /^\p{Lu}[\p{L}\p{N}_$]*$/u;

/** Inputs for resolving one corridor owner's exact selected render outcome. */
export interface CollectPreviewInspectorShallowVisualEvidenceOptions {
  /**
   * Optional caller-owned trust/route filter applied before the raw evidence cap.
   *
   * Keeping this boundary injectable lets workspace policy reject packages and inactive routes
   * without allowing hundreds of rejected occurrences to starve a later authored sibling.
   */
  readonly admitVisualPath?: (visualPath: PreviewInspectorOneHopVisualPath) => boolean;
  /** Corridor owner whose authored render output is being inspected. */
  readonly importerPath: string;
  /** Export by which the preceding corridor module reaches this owner, when statically known. */
  readonly ownerExportName?: string;
  /** Alias-aware resolver shared with the fast graph and eventual bundle. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Next proven module on the selected entry-to-target path. */
  readonly selectedChildPath: string;
  /** Current editor-or-disk source snapshot. */
  readonly sourceText: string;
}

/** Internal output before workspace admission and fair per-step file caps. */
export interface PreviewInspectorShallowVisualEvidence {
  /** Candidate paths may still resolve to packages or workspace-external modules. */
  readonly paths: readonly PreviewInspectorOneHopVisualPath[];
  /** True when local transport, render-outcome, or raw evidence budgets omitted facts. */
  readonly truncated: boolean;
}

/** One static/lazy module origin before it is connected to a rendered local alias. */
interface VisualOrigin {
  readonly exportName: string;
  readonly importKind: PreviewInspectorOneHopVisualPath['importKind'];
  readonly localEdges: readonly PreviewInspectorShallowVisualLocalEdge[];
  readonly moduleSpecifier: string;
  readonly resolvedPath?: string;
}

/** One candidate component occurrence projected from a render-outcome component tree. */
interface VisualOccurrence {
  readonly ancestors: readonly number[];
  readonly id: number;
  readonly localName: string;
  readonly node: PreviewReactRenderComponentNode;
  readonly parentId: number;
}

/** One local component transport from an inner binding to an outer rendered alias. */
interface LocalTransport {
  readonly edge: PreviewInspectorShallowVisualLocalEdge;
  readonly innerLocalName: string;
}

/**
 * Finds shallow visual paths sharing the selected child's exact exported render outcome.
 *
 * A fallback to one render-graph owner is used only when route/configuration JSX is not reachable
 * from a returned component outcome. That fallback remains narrower than the old file-wide merge:
 * unrelated functions and declarations never share an owner id.
 */
export function collectPreviewInspectorShallowVisualEvidence(
  options: CollectPreviewInspectorShallowVisualEvidenceOptions,
): PreviewInspectorShallowVisualEvidence {
  const importerPath = path.normalize(options.importerPath);
  const selectedChildPath = path.normalize(options.selectedChildPath);
  const analysis = analyzePreviewRenderSource(importerPath, options.sourceText);
  const facts = analysis.moduleFacts;
  const valueById = new Map(facts.values.map((value) => [value.id, value]));
  const localEdgesByOwner = new Map<string, typeof facts.localEdges>();
  for (const edge of facts.localEdges) {
    const current = localEdgesByOwner.get(edge.ownerId) ?? [];
    localEdgesByOwner.set(edge.ownerId, [...current, edge]);
  }

  const directOriginsByLocalName = new Map<string, VisualOrigin[]>();
  const resolvedPathBySpecifier = new Map<string, string | undefined>();
  /** Resolves each authored spelling once; package/external filtering belongs to the caller. */
  const resolveSpecifier = (moduleSpecifier: string): string | undefined => {
    if (resolvedPathBySpecifier.has(moduleSpecifier)) {
      return resolvedPathBySpecifier.get(moduleSpecifier);
    }
    const resolvedPath = options.resolveModule(moduleSpecifier, importerPath);
    const normalizedPath = resolvedPath === undefined ? undefined : path.normalize(resolvedPath);
    resolvedPathBySpecifier.set(moduleSpecifier, normalizedPath);
    return normalizedPath;
  };
  for (const imported of facts.imports) {
    const resolvedPath = resolveSpecifier(imported.moduleSpecifier);
    addOrigin(directOriginsByLocalName, imported.localName, {
      exportName: imported.importedName,
      importKind: 'static',
      localEdges: Object.freeze([]),
      moduleSpecifier: imported.moduleSpecifier,
      ...(resolvedPath === undefined ? {} : { resolvedPath }),
    });
  }
  for (const lazyImport of facts.lazyImports) {
    const owner = valueById.get(lazyImport.ownerId);
    if (owner === undefined) continue;
    const resolvedPath = resolveSpecifier(lazyImport.moduleSpecifier);
    addOrigin(directOriginsByLocalName, owner.localName, {
      exportName: lazyImport.importedName,
      importKind: 'react-lazy',
      localEdges: Object.freeze([]),
      moduleSpecifier: lazyImport.moduleSpecifier,
      ...(resolvedPath === undefined ? {} : { resolvedPath }),
    });
  }

  const transportsByOuterName = collectLocalTransports(
    facts.localEdges,
    localEdgesByOwner,
    valueById,
  );
  let truncated = false;
  const originCache = new Map<string, readonly VisualOrigin[]>();
  /** Resolves static/lazy origins through a bounded current-module alias/HOC chain. */
  const resolveOrigins = (
    localName: string,
    visiting = new Set<string>(),
    depth = 0,
  ): readonly VisualOrigin[] => {
    const cached = originCache.get(localName);
    if (cached !== undefined) return cached;
    if (depth >= MAXIMUM_LOCAL_TRANSPORT_DEPTH || visiting.has(localName)) {
      truncated = true;
      return Object.freeze([]);
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(localName);
    const origins = [...(directOriginsByLocalName.get(readRootLocalName(localName)) ?? [])];
    for (const transport of transportsByOuterName.get(localName) ?? []) {
      for (const origin of resolveOrigins(transport.innerLocalName, nextVisiting, depth + 1)) {
        origins.push({
          ...origin,
          localEdges: Object.freeze([...origin.localEdges, transport.edge]),
        });
      }
    }
    const frozen = Object.freeze(deduplicateOrigins(origins));
    originCache.set(localName, frozen);
    return frozen;
  };

  const componentPropNames = new Set(
    facts.localEdges
      .filter((edge) => isComponentPropMode(edge.invocation?.mode))
      .map((edge) => edge.childLocalName),
  );
  const outcomes = analyzePreviewReactRenderOutcomes(importerPath, options.sourceText).filter(
    (plan) => options.ownerExportName === undefined || plan.exportName === options.ownerExportName,
  );
  const outcomeEvidenceTruncated = outcomes.some(
    (plan) =>
      plan.truncated ||
      plan.outcomes.some(
        (outcome) =>
          outcome.componentNames.length >= PREVIEW_REACT_RENDER_OUTCOME_LIMITS.componentsPerOutcome,
      ),
  );
  truncated ||= outcomeEvidenceTruncated;
  const candidatePaths: PreviewInspectorOneHopVisualPath[] = [];
  let selectedOutcomeFound = false;

  for (const plan of outcomes) {
    for (const outcome of plan.outcomes) {
      const occurrences = flattenVisualOccurrences(outcome.componentTree);
      const selectedOccurrences = occurrences.filter((occurrence) =>
        resolveOrigins(occurrence.localName).some(
          (origin) => origin.resolvedPath === selectedChildPath,
        ),
      );
      if (selectedOccurrences.length === 0) continue;
      selectedOutcomeFound = true;
      const renderBoundaryStart = offsetFromLineColumn(
        options.sourceText,
        outcome.line,
        outcome.column,
      );
      for (const selected of selectedOccurrences) {
        const visualParentIds = new Set([selected.parentId, ...selected.ancestors]);
        for (const occurrence of occurrences) {
          if (occurrence.id === selected.id) continue;
          const relation = classifyVisualRelation(
            occurrence,
            selected,
            visualParentIds,
            componentPropNames,
          );
          if (relation === undefined) continue;
          appendOccurrencePaths(
            candidatePaths,
            occurrence,
            relation,
            resolveOrigins(occurrence.localName),
            importerPath,
            selectedChildPath,
            renderBoundaryStart,
            options.sourceText,
          );
        }
      }
    }
  }

  appendOwnerFallbackPaths({
    candidatePaths,
    componentPropNames,
    componentPropsOnly: selectedOutcomeFound && !outcomeEvidenceTruncated,
    facts,
    importerPath,
    ...(options.ownerExportName === undefined ? {} : { ownerExportName: options.ownerExportName }),
    resolveOrigins,
    selectedChildPath,
  });
  const admittedCandidatePaths = deduplicateVisualPaths(
    options.admitVisualPath === undefined
      ? candidatePaths
      : candidatePaths.filter(options.admitVisualPath),
  );
  if (admittedCandidatePaths.length > MAXIMUM_RAW_VISUAL_PATHS) truncated = true;
  return Object.freeze({
    paths: Object.freeze(admittedCandidatePaths.slice(0, MAXIMUM_RAW_VISUAL_PATHS)),
    truncated,
  });
}

/** Adds one direct origin without mutating any origin object after publication. */
function addOrigin(
  originsByLocalName: Map<string, VisualOrigin[]>,
  localName: string,
  origin: VisualOrigin,
): void {
  const origins = originsByLocalName.get(localName) ?? [];
  origins.push(Object.freeze(origin));
  originsByLocalName.set(localName, origins);
}

/** Builds only component-shaped alias/HOC edges; ordinary function body reads are excluded. */
function collectLocalTransports(
  localEdges: readonly ReturnType<
    typeof analyzePreviewRenderSource
  >['moduleFacts']['localEdges'][number][],
  localEdgesByOwner: ReadonlyMap<
    string,
    readonly ReturnType<typeof analyzePreviewRenderSource>['moduleFacts']['localEdges'][number][]
  >,
  valueById: ReadonlyMap<
    string,
    ReturnType<typeof analyzePreviewRenderSource>['moduleFacts']['values'][number]
  >,
): ReadonlyMap<string, readonly LocalTransport[]> {
  const transports = new Map<string, LocalTransport[]>();
  for (const edge of localEdges) {
    const owner = valueById.get(edge.ownerId);
    if (owner === undefined || !COMPONENT_NAME_PATTERN.test(owner.localName)) continue;
    const kind = classifyLocalTransport(edge.invocation?.mode);
    const simpleAlias =
      kind === undefined &&
      edge.kind === 'value-flow' &&
      edge.invocation === undefined &&
      (localEdgesByOwner.get(edge.ownerId)?.length ?? 0) === 1 &&
      COMPONENT_NAME_PATTERN.test(edge.childLocalName);
    if (kind === undefined && !simpleAlias) continue;
    const transport: LocalTransport = Object.freeze({
      edge: Object.freeze({
        fromLocalName: edge.childLocalName,
        kind: kind ?? 'alias',
        occurrenceStart: edge.occurrenceStart,
        toLocalName: owner.localName,
      }),
      innerLocalName: edge.childLocalName,
    });
    const current = transports.get(owner.localName) ?? [];
    current.push(transport);
    transports.set(owner.localName, current);
  }
  return transports;
}

/** Maps render-graph invocation modes onto the intentionally smaller shallow metadata vocabulary. */
function classifyLocalTransport(
  mode: PreviewRenderInvocationMode | undefined,
): PreviewInspectorShallowVisualLocalEdgeKind | undefined {
  if (mode === 'memo') return 'memo';
  if (mode === 'styled') return 'styled';
  return mode === 'hoc' || mode === 'forward-ref' ? 'hoc' : undefined;
}

/** Recursively projects component trees to numeric parent/ancestor identities. */
function flattenVisualOccurrences(
  componentTree: readonly PreviewReactRenderComponentNode[],
): readonly VisualOccurrence[] {
  const occurrences: VisualOccurrence[] = [];
  let nextId = 0;
  /** Visits a forest while retaining only component ancestry, as host nodes are already skipped. */
  const visit = (
    nodes: readonly PreviewReactRenderComponentNode[],
    parentId: number,
    ancestors: readonly number[],
  ): void => {
    for (const node of nodes) {
      const id = nextId;
      nextId += 1;
      occurrences.push({
        ancestors: Object.freeze(ancestors),
        id,
        localName: node.name,
        node,
        parentId,
      });
      visit(node.children, id, Object.freeze([id, ...ancestors]));
    }
  };
  visit(componentTree, -1, Object.freeze([]));
  return Object.freeze(occurrences);
}

/** Selects wrappers and direct sibling branches, excluding descendants inside unrelated siblings. */
function classifyVisualRelation(
  candidate: VisualOccurrence,
  selected: VisualOccurrence,
  visualParentIds: ReadonlySet<number>,
  componentPropNames: ReadonlySet<string>,
): PreviewInspectorShallowVisualRelation | undefined {
  if (selected.ancestors.includes(candidate.id)) return 'wrapper';
  if (!visualParentIds.has(candidate.parentId)) return undefined;
  return componentPropNames.has(readRootLocalName(candidate.localName))
    ? 'component-prop'
    : 'sibling';
}

/** Converts one candidate occurrence and each of its static/lazy origins to public path metadata. */
function appendOccurrencePaths(
  paths: PreviewInspectorOneHopVisualPath[],
  occurrence: VisualOccurrence,
  relation: PreviewInspectorShallowVisualRelation,
  origins: readonly VisualOrigin[],
  importerPath: string,
  selectedChildPath: string,
  renderBoundaryStart: number,
  sourceText: string,
): void {
  const occurrenceStart = offsetFromLineColumn(
    sourceText,
    occurrence.node.line,
    occurrence.node.column,
  );
  for (const origin of origins) {
    if (origin.resolvedPath === undefined) continue;
    paths.push(
      Object.freeze({
        exportName: origin.exportName,
        importerPath,
        importKind: origin.importKind,
        localEdges: origin.localEdges,
        moduleSpecifier: origin.moduleSpecifier,
        occurrenceStart,
        relation,
        renderedLocalName: occurrence.localName,
        renderBoundaryStart,
        selectedChildPath,
        sourcePath: origin.resolvedPath,
      }),
    );
  }
}

/** Route/config fallback groups only references owned by the selected child's exact declaration. */
function appendOwnerFallbackPaths(options: {
  readonly candidatePaths: PreviewInspectorOneHopVisualPath[];
  readonly componentPropNames: ReadonlySet<string>;
  /** Exact outcomes already cover JSX; only component-slot metadata needs fallback then. */
  readonly componentPropsOnly: boolean;
  readonly facts: ReturnType<typeof analyzePreviewRenderSource>['moduleFacts'];
  readonly importerPath: string;
  readonly ownerExportName?: string;
  readonly resolveOrigins: (localName: string) => readonly VisualOrigin[];
  readonly selectedChildPath: string;
}): void {
  const reachableOwnerIds = collectReachableOwnerIds(options.facts, options.ownerExportName);
  const selectedEdges = options.facts.localEdges.filter(
    (edge) =>
      isVisualRenderEdge(edge.kind, edge.invocation?.mode, edge.childLocalName) &&
      (reachableOwnerIds.size === 0 || reachableOwnerIds.has(edge.ownerId)) &&
      options
        .resolveOrigins(edge.childLocalName)
        .some((origin) => origin.resolvedPath === options.selectedChildPath),
  );
  for (const selectedEdge of selectedEdges) {
    for (const edge of options.facts.localEdges) {
      if (
        edge.ownerId !== selectedEdge.ownerId ||
        edge === selectedEdge ||
        !isVisualRenderEdge(edge.kind, edge.invocation?.mode, edge.childLocalName) ||
        (options.componentPropsOnly && !isComponentPropMode(edge.invocation?.mode))
      ) {
        continue;
      }
      const relation: PreviewInspectorShallowVisualRelation = options.componentPropNames.has(
        edge.childLocalName,
      )
        ? 'component-prop'
        : selectedEdge.wrapperNames.includes(edge.childLocalName)
          ? 'wrapper'
          : 'sibling';
      for (const origin of options.resolveOrigins(edge.childLocalName)) {
        if (origin.resolvedPath === undefined) continue;
        options.candidatePaths.push(
          Object.freeze({
            exportName: origin.exportName,
            importerPath: options.importerPath,
            importKind: origin.importKind,
            localEdges: origin.localEdges,
            moduleSpecifier: origin.moduleSpecifier,
            occurrenceStart: edge.occurrenceStart,
            relation,
            renderedLocalName: edge.childLocalName,
            renderBoundaryStart: selectedEdge.occurrenceStart,
            selectedChildPath: options.selectedChildPath,
            sourcePath: origin.resolvedPath,
          }),
        );
      }
    }
  }
}

/** Restricts owner fallback to render-bearing graph edges, never ordinary configuration reads. */
function isVisualRenderEdge(
  kind: ReturnType<typeof analyzePreviewRenderSource>['moduleFacts']['localEdges'][number]['kind'],
  mode: PreviewRenderInvocationMode | undefined,
  childLocalName: string,
): boolean {
  /*
   * Route factories place path builders and component elements under one configuration owner.
   * `route-branch` alone therefore proves shared control flow, not a visual React value. A route
   * child must additionally look like a component binding; lowercase path/map helpers remain exact
   * executable dependencies so their string/object contracts cannot become placeholder elements.
   */
  if (kind === 'route-branch') {
    return isComponentShapedLocalName(childLocalName) || isComponentPropMode(mode);
  }
  return (
    kind === 'component-render' ||
    kind === 'create-element' ||
    mode === 'jsx' ||
    mode === 'create-element' ||
    isComponentPropMode(mode)
  );
}

/**
 * Follows local value-flow outward from the imported owner export to route/config declarations.
 *
 * This prevents a second exported story in the same file from contributing siblings while still
 * allowing `App -> router -> selected route` configuration owned by local constants.
 */
function collectReachableOwnerIds(
  facts: ReturnType<typeof analyzePreviewRenderSource>['moduleFacts'],
  ownerExportName: string | undefined,
): ReadonlySet<string> {
  if (ownerExportName === undefined) return new Set();
  const exportedLocalNames = new Set(
    facts.exports
      .filter((exported) => exported.exportName === ownerExportName)
      .flatMap((exported) => exported.localName ?? []),
  );
  const valueByLocalName = new Map(facts.values.map((value) => [value.localName, value]));
  const reachableOwnerIds = new Set<string>();
  const pending = [...exportedLocalNames];
  let depth = 0;
  while (pending.length > 0 && depth < MAXIMUM_LOCAL_TRANSPORT_DEPTH) {
    const levelSize = pending.length;
    for (let index = 0; index < levelSize; index += 1) {
      const localName = pending.shift();
      const value = localName === undefined ? undefined : valueByLocalName.get(localName);
      if (value === undefined || reachableOwnerIds.has(value.id)) continue;
      reachableOwnerIds.add(value.id);
      for (const edge of facts.localEdges) {
        if (edge.ownerId === value.id && valueByLocalName.has(edge.childLocalName)) {
          pending.push(edge.childLocalName);
        }
      }
    }
    depth += 1;
  }
  return reachableOwnerIds;
}

/** Component/member names resolve through the imported namespace or local root binding. */
function readRootLocalName(localName: string): string {
  return localName.split('.', 1)[0] ?? localName;
}

/** Accepts a local component or a PascalCase member reached through an imported namespace. */
function isComponentShapedLocalName(localName: string): boolean {
  const segments = localName.split('.');
  return COMPONENT_NAME_PATTERN.test(segments.at(-1) ?? localName);
}

/** Recognizes component-valued JSX slots already proven by the render-graph invocation analyzer. */
function isComponentPropMode(mode: PreviewRenderInvocationMode | undefined): boolean {
  return mode === 'component-prop' || mode === 'polymorphic-prop' || mode === 'render-prop';
}

/** Converts one-based analyzer locations to stable zero-based source offsets. */
function offsetFromLineColumn(sourceText: string, line: number, column: number): number {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line && offset < sourceText.length) {
    const nextLine = sourceText.indexOf('\n', offset);
    if (nextLine < 0) return sourceText.length;
    offset = nextLine + 1;
    currentLine += 1;
  }
  return Math.min(sourceText.length, offset + Math.max(0, column - 1));
}

/** Removes duplicate local-origin paths created by repeated equivalent value-flow facts. */
function deduplicateOrigins(origins: readonly VisualOrigin[]): readonly VisualOrigin[] {
  const seen = new Set<string>();
  return origins.filter((origin) => {
    const key = [
      origin.importKind,
      origin.moduleSpecifier,
      origin.exportName,
      ...origin.localEdges.map(
        (edge) =>
          `${edge.kind}:${edge.fromLocalName}:${edge.toLocalName}:${edge.occurrenceStart.toString()}`,
      ),
    ].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Removes duplicate occurrence/origin evidence while preserving deterministic authored order. */
function deduplicateVisualPaths(
  paths: readonly PreviewInspectorOneHopVisualPath[],
): readonly PreviewInspectorOneHopVisualPath[] {
  const seen = new Set<string>();
  return paths.filter((visualPath) => {
    const key = [
      visualPath.importerPath,
      visualPath.sourcePath,
      visualPath.moduleSpecifier,
      visualPath.exportName,
      visualPath.renderedLocalName,
      visualPath.relation,
      visualPath.renderBoundaryStart,
      visualPath.occurrenceStart,
    ].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
