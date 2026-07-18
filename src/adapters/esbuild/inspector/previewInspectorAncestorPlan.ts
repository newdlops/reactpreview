/**
 * Discovers an importable ancestor component for the Page Inspector preview mode.
 * Unlike a pinpoint parent slice, this plan intentionally mounts an authored owner export so its
 * real descendants, siblings, hooks, and event-driven UI are present in the browser React tree.
 */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
  type MatchesPreviewParentSliceTargetImport,
  type PreviewParentSlice,
  type PreviewParentSliceStaticProps,
} from '../parentSlice';
import {
  collectPreviewRenderModuleSpecifiers,
  createPreviewRenderChainPlan,
  type PreviewRenderChainCandidate,
  type PreviewRenderChainPlan,
  type PreviewRenderChainPlansByExport,
  type ResolvePreviewRenderGraphModule,
} from '../renderGraph';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import { isPreviewInspectorComponentShapedOwner } from './previewInspectorOwnerShape';
import { createLexicalInspectorModuleResolver } from './previewInspectorLexicalResolver';
import {
  collectPreviewInspectorModuleFrontiers,
  type PreviewInspectorModuleFrontier,
} from './previewInspectorModuleFrontiers';
import {
  collectPreviewInspectorRenderPathRoots,
  readPreviewInspectorRenderPathRootAutomaticProps,
  readPreviewInspectorRootInference,
  readPreviewInspectorRootOwnsRouter,
  type PreviewInspectorRenderPathRoot,
  type PreviewInspectorSourcePromiseCache,
} from './previewInspectorRenderPathRoots';
import { rankPreviewInspectorPageCandidates } from './previewInspectorPageCandidateRanking';
const MAX_PROJECT_ANCESTOR_DEPTH = 8;
const MAX_LOCAL_OWNER_DEPTH = 12;
const LARGE_PROJECT_SOURCE_THRESHOLD = 512;
const MAX_LARGE_PROJECT_DIRECT_ANCESTOR_DEPTH = 2;
const MAX_CONCURRENT_SOURCE_READS = 64;
const MAX_INSPECTOR_PAGE_CANDIDATES = 6;
const MAX_LARGE_PROJECT_PAGE_CANDIDATES = 2;

/** Importable component identity retained without loading its module in the extension host. */
export interface PreviewInspectorComponentReference {
  /** Runtime export name, including the string `default`. */
  readonly exportName: string;
  /** Absolute authored source path containing the export. */
  readonly sourcePath: string;
}

/**
 * One proven child-to-owner relationship in the selected inspector ancestry.
 * Mounting the `owner` executes the complete authored component, including JSX siblings that the
 * pinpoint preview deliberately omits.
 */
export interface PreviewInspectorAncestorEdge {
  /** Import spelling used at this exact occurrence; aliases still identify the same child value. */
  readonly child: PreviewInspectorComponentReference;
  /** Primitive props statically visible on the child occurrence. */
  readonly childAutomaticProps: PreviewParentSliceStaticProps;
  /** Number of source-private component owners crossed before reaching `owner`. */
  readonly localOwnerDepth: number;
  /** Private owner names crossed in inner-to-outer order for diagnostics. */
  readonly localOwnerNames: readonly string[];
  /** Source offset of the selected imported child JSX occurrence. */
  readonly occurrenceStart: number;
  /** Nearest importable authored owner containing the child occurrence. */
  readonly owner: PreviewInspectorComponentReference;
}

/** Why reverse owner discovery stopped at the returned importable root. */
export type PreviewInspectorAncestorStopReason =
  | 'cycle'
  | 'depth-limit'
  | 'non-component-owner'
  | 'private-owner'
  | 'render-path-checkpoint'
  | 'root-reached';

/**
 * One independently mountable caller path offered by Page Inspector.
 * The candidate contains only inert source evidence; its root module is imported lazily in the
 * webview after the user selects this path.
 */
export interface PreviewInspectorPageCandidate {
  /** `true` when reverse owner discovery naturally reached the outermost package-local usage. */
  readonly complete: boolean;
  /** Files that prove this candidate and should invalidate it during hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Child-to-owner relationships specific to this caller path. */
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  /** Stable render-graph identity used to persist user selection across rebuilds. */
  readonly id: string;
  /** Exact static target-to-entry path that guided this candidate, when one was proven. */
  readonly renderPath?: PreviewRenderChainCandidate;
  /** Importable authored component mounted as this candidate's page root. */
  readonly root: PreviewInspectorComponentReference;
  /** Primitive root props observed at the selected caller occurrence. */
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  /** Neutral root props inferred from the root component's own local type and usage evidence. */
  readonly rootInference?: PreviewInferredExportProps;
  /** Whether this independently mounted root's target-facing branch creates its own Router. */
  readonly rootOwnsRouter: boolean;
  /** Render-step index used to explain path-derived roots in the browser selector. */
  readonly rootStepIndex?: number;
  /** Honest reason an incomplete candidate could not be promoted farther. */
  readonly stopReason: PreviewInspectorAncestorStopReason;
  /** Primitive target props observed within this exact caller path. */
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/**
 * Immutable build-time recipe for mounting one real ancestor and instrumenting its nested target.
 */
export interface PreviewInspectorAncestorPlan {
  /** `true` only when the scan naturally reached an export with no further package-local usage. */
  readonly complete: boolean;
  /** Files selected by the ancestry and therefore relevant to inspector hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Proven import relationships ordered from the selected target out toward the mounted root. */
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  /** Ranked, independently selectable authored page contexts; the first candidate is the default. */
  readonly pageCandidates: readonly PreviewInspectorPageCandidate[];
  /** Actual authored export imported by the Page Inspector entry. */
  readonly root: PreviewInspectorComponentReference;
  /** Props usable when a private owner prevents mounting the next outer component. */
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  /** Static application structure discovered independently from the conservative mount root. */
  readonly renderChain: PreviewRenderChainPlan;
  /** Entry-to-target plans for every explicit component export in the selected source file. */
  readonly renderChainsByExport: PreviewRenderChainPlansByExport;
  /** Stable explanation shown when the ancestry is necessarily partial. */
  readonly stopReason: PreviewInspectorAncestorStopReason;
  /** Original selected export that nested instrumentation must intercept. */
  readonly target: PreviewInspectorComponentReference;
  /** Primitive props observed at the first selected target occurrence, if any. */
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/** Lazily supplies current editor-or-disk source under caller-owned package and byte budgets. */
export type ReadPreviewInspectorSource = (sourcePath: string) => Promise<string | undefined>;

/** Resolves tsconfig/package aliases that cannot be proven by lexical suffix matching alone. */
export type ReadPreviewInspectorAcceptedSpecifiers = (
  target: PreviewInspectorComponentReference,
) => readonly string[];

/** Inputs for one bounded package-local reverse JSX owner traversal. */
export interface CreatePreviewInspectorAncestorPlanOptions {
  /** Optional project-aware aliases for each changing reverse-graph frontier. */
  readonly acceptedImportSpecifiers?: ReadPreviewInspectorAcceptedSpecifiers;
  /** Absolute source path selected by the editor command. */
  readonly documentPath: string;
  /** Exact selected runtime export within `documentPath`. */
  readonly exportName: string;
  /** Optional tsconfig/jsconfig-aware import identity check for every reverse frontier. */
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  /** Current source reader; dirty editor snapshots should take precedence in the caller. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Project-aware resolver used by lazy, barrel, route-value, and entry graph discovery. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Optional shared-index result for all current-file exports; avoids rebuilding the graph here. */
  readonly renderChainsByExport?: PreviewRenderChainPlansByExport;
  /** Cancels stale ancestor and render-chain discovery between bounded source batches. */
  readonly signal?: AbortSignal;
  /** Bounded nearest-package or monorepo-package inventory in any order. */
  readonly sourcePaths: readonly string[];
}

/** Successful exported-owner result after crossing private declarations in one file. */
interface SuccessfulOwnerPromotion {
  readonly exportNames: readonly string[];
  readonly kind: 'promoted';
  readonly localOwnerNames: readonly string[];
  readonly root: PreviewInspectorComponentReference;
}

/** Fail-closed result when no outer declaration can become an actual React mount root. */
interface StoppedOwnerPromotion {
  readonly kind: 'stopped';
  readonly stopReason: Extract<
    PreviewInspectorAncestorStopReason,
    'non-component-owner' | 'private-owner'
  >;
}

/** Result of crossing private owners toward the nearest component-shaped exported declaration. */
type OwnerPromotionResult = SuccessfulOwnerPromotion | StoppedOwnerPromotion;

/** One selected JSX occurrence plus its already parsed consumer text. */
interface InspectorUsageCandidate {
  readonly frontier: PreviewInspectorModuleFrontier;
  readonly reexportPaths: readonly string[];
  readonly slice: PreviewParentSlice;
  readonly sourceText: string;
}

/** One already-read source retained only for the duration of a bounded planner call. */
interface InspectorCandidateSource {
  readonly sourcePath: string;
  readonly sourceText: string;
}

/** Reused source and candidate indexes prevent each alternative caller path from reparsing a repo. */
interface InspectorUsagePlanningContext {
  readonly inferenceByReference: Map<string, Promise<PreviewInferredExportProps | undefined>>;
  readonly routerOwnershipBySource: Map<string, Promise<boolean>>;
  readonly rankedCandidatesByFrontier: Map<
    string,
    Promise<readonly RankedInspectorUsageCandidate[]>
  >;
  readonly sourceFileByPath: Map<string, ts.SourceFile>;
  readonly sourceTextByPath: PreviewInspectorSourcePromiseCache;
  sources?: Promise<readonly InspectorCandidateSource[]>;
}

/** A path-independent structural score cached before one render path adds its preference bonus. */
interface RankedInspectorUsageCandidate {
  readonly candidate: InspectorUsageCandidate;
  readonly score: number;
}

/**
 * Finds the outermost bounded exported owner that can reproduce the target's authored page branch.
 *
 * Dynamic props and wrapper components do not block this inspector-only traversal: they will be
 * evaluated by React when the real owner export is mounted. The algorithm still fails closed on
 * private terminal owners, cycles, and fixed depth limits, and never imports application code in
 * the extension host.
 *
 * @param options Selected target, package inventory, source reader, and optional alias resolver.
 * @returns Frozen ancestor plan suitable for a generated browser entry.
 */
export async function createPreviewInspectorAncestorPlan(
  options: CreatePreviewInspectorAncestorPlanOptions,
): Promise<PreviewInspectorAncestorPlan> {
  throwIfPreviewBuildCancelled(options.signal);
  assertInspectorTarget(options.documentPath, options.exportName);
  const sourcePaths = [
    ...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath))),
  ].sort();
  const target = freezeReference(options.documentPath, options.exportName);
  const renderChainsByExport = await readInspectorRenderChains(options, target, sourcePaths);
  const renderChain = renderChainsByExport[target.exportName];
  if (renderChain === undefined) {
    throw new Error(`Missing Inspector render chain for export: ${target.exportName}`);
  }
  const sharedDependencies = new Set<string>([
    target.sourcePath,
    ...Object.values(renderChainsByExport).flatMap((plan) => plan.dependencyPaths),
  ]);
  const planningContext: InspectorUsagePlanningContext = {
    inferenceByReference: new Map(),
    rankedCandidatesByFrontier: new Map(),
    routerOwnershipBySource: new Map(),
    sourceFileByPath: new Map(),
    sourceTextByPath: new Map(),
  };
  const pageCandidateLimit =
    sourcePaths.length > LARGE_PROJECT_SOURCE_THRESHOLD
      ? MAX_LARGE_PROJECT_PAGE_CANDIDATES
      : MAX_INSPECTOR_PAGE_CANDIDATES;
  const renderPaths = renderChain.paths.slice(0, pageCandidateLimit);
  const candidatePaths: readonly (PreviewRenderChainCandidate | undefined)[] =
    renderPaths.length > 0 ? renderPaths : [undefined];
  const discoveredCandidates: PreviewInspectorPageCandidate[] = [];
  const baseCandidates: {
    readonly candidate: PreviewInspectorPageCandidate;
    readonly renderPath: PreviewRenderChainCandidate | undefined;
  }[] = [];
  const candidateKeys = new Set<string>();

  /** Adds one root once while preserving deterministic discovery order for equal scores. */
  const addCandidate = (candidate: PreviewInspectorPageCandidate): void => {
    const candidateKey = createInspectorPageCandidateKey(candidate);
    if (candidateKeys.has(candidateKey)) return;
    candidateKeys.add(candidateKey);
    discoveredCandidates.push(candidate);
  };

  for (const renderPath of candidatePaths) {
    throwIfPreviewBuildCancelled(options.signal);
    const candidate = await createInspectorPageCandidate({
      options,
      planningContext,
      renderPath,
      sourcePaths,
      target,
    });
    baseCandidates.push({ candidate, renderPath });
    addCandidate(candidate);
  }

  for (const { candidate, renderPath } of baseCandidates) {
    if (renderPath === undefined) continue;
    const renderPathRoots = await collectPreviewInspectorRenderPathRoots({
      readSource: options.readSource,
      renderPath,
      sourceCache: planningContext.sourceTextByPath,
      target,
    });
    for (const renderPathRoot of renderPathRoots) {
      addCandidate(
        await createRenderPathPageCandidate({
          base: candidate,
          options,
          planningContext,
          renderPathRoot,
        }),
      );
    }
  }

  const pageCandidates = rankPreviewInspectorPageCandidates(
    discoveredCandidates,
    pageCandidateLimit,
  );

  const primary = pageCandidates[0];
  if (primary === undefined) {
    throw new Error(`Missing Inspector page candidate for export: ${target.exportName}`);
  }
  for (const candidate of pageCandidates) {
    for (const dependencyPath of candidate.dependencyPaths) {
      sharedDependencies.add(dependencyPath);
    }
  }
  return freezePlan({
    complete: primary.complete,
    dependencies: sharedDependencies,
    edges: primary.edges,
    pageCandidates,
    root: primary.root,
    rootAutomaticProps: primary.rootAutomaticProps,
    renderChain,
    renderChainsByExport,
    stopReason: primary.stopReason,
    target,
    targetAutomaticProps: primary.targetAutomaticProps,
  });
}

/** Climbs one preferred render path while sharing all expensive syntax indexes with its siblings. */
async function createInspectorPageCandidate(arguments_: {
  readonly options: CreatePreviewInspectorAncestorPlanOptions;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly renderPath: PreviewRenderChainCandidate | undefined;
  readonly sourcePaths: readonly string[];
  readonly target: PreviewInspectorComponentReference;
}): Promise<PreviewInspectorPageCandidate> {
  const { options, planningContext, renderPath, sourcePaths, target } = arguments_;
  const dependencies = new Set<string>([
    target.sourcePath,
    ...(renderPath?.steps.map((step) => step.sourcePath) ?? []),
    ...(renderPath?.entryPoint === undefined ? [] : [renderPath.entryPoint.sourcePath]),
  ]);
  const preferredSourcePaths = new Set(
    renderPath?.steps.map((step) => path.normalize(step.sourcePath)) ?? [],
  );
  const edges: PreviewInspectorAncestorEdge[] = [];
  const visitedReferences = new Set<string>([createReferenceKey(target)]);
  let currentAliases: readonly string[] = [target.exportName];
  let currentRoot = target;
  let rootAutomaticProps: PreviewParentSliceStaticProps = Object.freeze({});
  let targetAutomaticProps: PreviewParentSliceStaticProps = Object.freeze({});

  /** Freezes the current traversal state without retaining parser nodes or source text. */
  const finish = async (
    complete: boolean,
    stopReason: PreviewInspectorAncestorStopReason,
  ): Promise<PreviewInspectorPageCandidate> => {
    const rootInference = await readPreviewInspectorRootInference(
      currentRoot,
      options.readSource,
      planningContext.sourceTextByPath,
      planningContext.inferenceByReference,
    );
    const rootOwnsRouter = await readPreviewInspectorRootOwnsRouter({
      ownershipCache: planningContext.routerOwnershipBySource,
      readSource: options.readSource,
      reference: currentRoot,
      renderPath,
      rootStepIndex: undefined,
      sourceCache: planningContext.sourceTextByPath,
    });
    return freezePageCandidate({
      complete,
      dependencies,
      edges,
      id: renderPath?.id ?? 'nearest-authored-owner',
      renderPath,
      root: currentRoot,
      rootAutomaticProps,
      ...(rootInference === undefined ? {} : { rootInference }),
      rootOwnsRouter,
      stopReason,
      targetAutomaticProps,
    });
  };

  const directAncestorDepth =
    sourcePaths.length > LARGE_PROJECT_SOURCE_THRESHOLD && (renderPath?.steps.length ?? 0) > 2
      ? MAX_LARGE_PROJECT_DIRECT_ANCESTOR_DEPTH
      : MAX_PROJECT_ANCESTOR_DEPTH;
  for (let depth = 0; depth < directAncestorDepth; depth += 1) {
    throwIfPreviewBuildCancelled(options.signal);
    const candidate = await findInspectorUsage({
      acceptedImportSpecifiers: options.acceptedImportSpecifiers?.(currentRoot) ?? [],
      ...(options.matchesTargetImport === undefined
        ? {}
        : { matchesTargetImport: options.matchesTargetImport }),
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      planningContext,
      sourcePaths,
      targetExportNames: currentAliases,
      targetPath: currentRoot.sourcePath,
      preferredSourcePaths,
    });
    if (candidate === undefined) {
      return finish(true, 'root-reached');
    }

    for (const reexportPath of candidate.reexportPaths) {
      dependencies.add(reexportPath);
    }

    if (edges.length === 0) {
      targetAutomaticProps = candidate.slice.targetProps;
    }
    if (candidate.slice.owner === null) {
      rootAutomaticProps = candidate.slice.targetProps;
      dependencies.add(candidate.slice.consumerPath);
      return finish(true, 'root-reached');
    }
    const promotion = promoteInspectorOwner(candidate);
    if (promotion.kind === 'stopped') {
      rootAutomaticProps = candidate.slice.targetProps;
      dependencies.add(candidate.slice.consumerPath);
      return finish(false, promotion.stopReason);
    }

    const promotedKey = createReferenceKey(promotion.root);
    if (visitedReferences.has(promotedKey)) {
      rootAutomaticProps = candidate.slice.targetProps;
      dependencies.add(candidate.slice.consumerPath);
      return finish(false, 'cycle');
    }

    visitedReferences.add(promotedKey);
    dependencies.add(candidate.slice.consumerPath);
    edges.push(
      Object.freeze({
        child: freezeReference(candidate.frontier.sourcePath, candidate.slice.targetExportName),
        childAutomaticProps: candidate.slice.targetProps,
        localOwnerDepth: promotion.localOwnerNames.length,
        localOwnerNames: Object.freeze([...promotion.localOwnerNames]),
        occurrenceStart: candidate.slice.occurrenceStart,
        owner: promotion.root,
      }),
    );
    currentAliases = promotion.exportNames;
    currentRoot = promotion.root;
    rootAutomaticProps = Object.freeze({});
  }

  return finish(false, 'depth-limit');
}

/** Creates a selectable mount root from one component export proven by the full render graph. */
async function createRenderPathPageCandidate(arguments_: {
  readonly base: PreviewInspectorPageCandidate;
  readonly options: CreatePreviewInspectorAncestorPlanOptions;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly renderPathRoot: PreviewInspectorRenderPathRoot;
}): Promise<PreviewInspectorPageCandidate> {
  const { base, options, planningContext, renderPathRoot } = arguments_;
  const renderPath = base.renderPath;
  if (renderPath === undefined) return base;
  const root = freezeReference(
    renderPathRoot.reference.sourcePath,
    renderPathRoot.reference.exportName,
  );
  const rootInference = await readPreviewInspectorRootInference(
    root,
    options.readSource,
    planningContext.sourceTextByPath,
    planningContext.inferenceByReference,
  );
  const rootOwnsRouter = await readPreviewInspectorRootOwnsRouter({
    ownershipCache: planningContext.routerOwnershipBySource,
    readSource: options.readSource,
    reference: root,
    renderPath,
    rootStepIndex: renderPathRoot.stepIndex,
    sourceCache: planningContext.sourceTextByPath,
  });
  const rootAutomaticProps = await readPreviewInspectorRenderPathRootAutomaticProps({
    acceptedImportSpecifiers: options.acceptedImportSpecifiers?.(root) ?? [],
    ...(options.matchesTargetImport === undefined
      ? {}
      : { matchesTargetImport: options.matchesTargetImport }),
    readSource: options.readSource,
    renderPath,
    root: renderPathRoot,
    sourceCache: planningContext.sourceTextByPath,
  });
  const dependencies = new Set(base.dependencyPaths);
  dependencies.add(root.sourcePath);
  const complete = renderPath.entryPoint !== undefined && renderPathRoot.outermost;
  return freezePageCandidate({
    complete,
    dependencies,
    edges: base.edges,
    id: `${renderPath.id}:root:${renderPathRoot.stepIndex.toString()}`,
    renderPath,
    root,
    rootAutomaticProps,
    ...(rootInference === undefined ? {} : { rootInference }),
    rootOwnsRouter,
    rootStepIndex: renderPathRoot.stepIndex,
    stopReason: complete ? 'root-reached' : 'render-path-checkpoint',
    targetAutomaticProps: base.targetAutomaticProps,
  });
}

/**
 * Reuses a caller-provided all-export graph when available, otherwise preserves the standalone
 * ancestor-planner API by discovering only its selected target export.
 */
async function readInspectorRenderChains(
  options: CreatePreviewInspectorAncestorPlanOptions,
  target: PreviewInspectorComponentReference,
  sourcePaths: readonly string[],
): Promise<PreviewRenderChainPlansByExport> {
  if (options.renderChainsByExport !== undefined) {
    const plans = Object.freeze({ ...options.renderChainsByExport });
    const selectedPlan = plans[target.exportName];
    if (
      selectedPlan === undefined ||
      path.normalize(selectedPlan.target.sourcePath) !== path.normalize(target.sourcePath) ||
      selectedPlan.target.exportName !== target.exportName
    ) {
      throw new TypeError(
        'Precomputed Inspector render chains do not contain the selected target.',
      );
    }
    return plans;
  }
  const selectedPlan = await createPreviewRenderChainPlan({
    documentPath: target.sourcePath,
    exportName: target.exportName,
    readSource: options.readSource,
    resolveModule:
      options.resolveModule ?? createLexicalInspectorModuleResolver(options.sourcePaths),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths,
  });
  return Object.freeze({ [target.exportName]: selectedPlan });
}

/** Selects the strongest page-like JSX usage across direct imports and bounded barrel chains. */
async function findInspectorUsage(options: {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly planningContext: InspectorUsagePlanningContext;
  /** Source modules selected by the best entry-connected graph path. */
  readonly preferredSourcePaths: ReadonlySet<string>;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}): Promise<InspectorUsageCandidate | undefined> {
  const frontierKey = JSON.stringify([
    path.normalize(options.targetPath),
    [...options.targetExportNames].sort(),
    [...options.acceptedImportSpecifiers].sort(),
  ]);
  let rankedPromise = options.planningContext.rankedCandidatesByFrontier.get(frontierKey);
  if (rankedPromise === undefined) {
    rankedPromise = collectRankedInspectorUsageCandidates(options);
    options.planningContext.rankedCandidatesByFrontier.set(frontierKey, rankedPromise);
  }
  const rankedCandidates = (await rankedPromise).map((ranked) => ({
    candidate: ranked.candidate,
    score:
      ranked.score +
      (options.preferredSourcePaths.has(path.normalize(ranked.candidate.slice.consumerPath))
        ? 2_000
        : 0),
  }));
  rankedCandidates.sort(compareRankedInspectorUsageCandidates);
  return rankedCandidates[0]?.candidate;
}

/** Reads the bounded inventory once, then reuses it for every candidate path and owner frontier. */
async function readInspectorCandidateSources(options: {
  readonly planningContext: InspectorUsagePlanningContext;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
}): Promise<readonly InspectorCandidateSource[]> {
  if (options.planningContext.sources !== undefined) {
    return options.planningContext.sources;
  }
  const sourcePromise = (async (): Promise<readonly InspectorCandidateSource[]> => {
    const sources: InspectorCandidateSource[] = [];
    for (
      let batchStart = 0;
      batchStart < options.sourcePaths.length;
      batchStart += MAX_CONCURRENT_SOURCE_READS
    ) {
      throwIfPreviewBuildCancelled(options.signal);
      const batchPaths = options.sourcePaths.slice(
        batchStart,
        batchStart + MAX_CONCURRENT_SOURCE_READS,
      );
      const batch = await Promise.all(
        batchPaths.map(async (sourcePath) => ({
          sourcePath,
          sourceText: await options.readSource(sourcePath),
        })),
      );
      throwIfPreviewBuildCancelled(options.signal);
      for (const source of batch) {
        if (
          source.sourceText === undefined ||
          (!source.sourceText.includes('import') && !source.sourceText.includes('export'))
        ) {
          continue;
        }
        sources.push({ sourcePath: source.sourcePath, sourceText: source.sourceText });
      }
    }
    return Object.freeze(sources);
  })();
  options.planningContext.sources = sourcePromise;
  return sourcePromise;
}

/** Computes path-independent usage scores once for a changing imported component frontier. */
async function collectRankedInspectorUsageCandidates(options: {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}): Promise<readonly RankedInspectorUsageCandidate[]> {
  const sources = await readInspectorCandidateSources(options);
  const candidates: InspectorUsageCandidate[] = [];
  const frontiers = collectPreviewInspectorModuleFrontiers(
    {
      acceptedImportSpecifiers: options.acceptedImportSpecifiers,
      ...(options.matchesTargetImport === undefined
        ? {}
        : { matchesTargetImport: options.matchesTargetImport }),
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      targetExportNames: options.targetExportNames,
      targetPath: options.targetPath,
    },
    sources,
    options.planningContext.sourceFileByPath,
  );
  const moduleSpecifiersBySource = new Map<string, readonly string[]>();
  for (const source of sources) {
    if (!source.sourceText.includes('<')) {
      continue;
    }
    for (const frontier of frontiers) {
      if (path.normalize(source.sourcePath) === path.normalize(frontier.sourcePath)) {
        continue;
      }
      let moduleSpecifiers = moduleSpecifiersBySource.get(source.sourcePath);
      if (moduleSpecifiers === undefined) {
        moduleSpecifiers = collectPreviewRenderModuleSpecifiers(
          source.sourcePath,
          source.sourceText,
        );
        moduleSpecifiersBySource.set(source.sourcePath, moduleSpecifiers);
      }
      if (!mayContainInspectorUsage(options, source, frontier, moduleSpecifiers)) {
        continue;
      }
      const initialFrontier =
        path.normalize(frontier.sourcePath) === path.normalize(options.targetPath);
      const analysis = analyzePreviewParentSlices({
        ...(initialFrontier
          ? { acceptedTargetImportSpecifiers: options.acceptedImportSpecifiers }
          : {}),
        consumerPath: source.sourcePath,
        ...(options.matchesTargetImport === undefined
          ? {}
          : { matchesTargetImport: options.matchesTargetImport }),
        sourceText: source.sourceText,
        targetExportNames: frontier.exportNames,
        targetPath: frontier.sourcePath,
      });
      for (const slice of analysis.slices) {
        candidates.push({
          frontier,
          reexportPaths: frontier.dependencyPaths,
          slice,
          sourceText: source.sourceText,
        });
      }
    }
  }
  const rankedCandidates = candidates.map((candidate) => ({
    candidate,
    score: scoreInspectorUsageCandidate(candidate),
  }));
  rankedCandidates.sort(compareRankedInspectorUsageCandidates);
  return Object.freeze(rankedCandidates);
}
/**
 * Proves a plausible import before the parent-slice analyzer allocates a TypeScript AST.
 * Component/file names cover ordinary imports; configured aliases use the exact project resolver,
 * keeping this gate conservative while avoiding thousands of irrelevant JSX parses.
 */
function mayContainInspectorUsage(
  options: Parameters<typeof collectRankedInspectorUsageCandidates>[0],
  source: InspectorCandidateSource,
  frontier: PreviewInspectorModuleFrontier,
  moduleSpecifiers: readonly string[],
): boolean {
  const basename = path.basename(frontier.sourcePath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
  const directoryName = path.basename(path.dirname(frontier.sourcePath));
  if (
    (basename.length > 1 && source.sourceText.includes(basename)) ||
    (basename === 'index' &&
      directoryName.length > 1 &&
      source.sourceText.includes(directoryName)) ||
    frontier.exportNames.some(
      (exportName) => exportName !== 'default' && source.sourceText.includes(exportName),
    ) ||
    options.acceptedImportSpecifiers.some((specifier) => source.sourceText.includes(specifier))
  ) {
    return true;
  }
  return moduleSpecifiers.some((specifier) => {
    const resolvedPath = options.resolveModule?.(specifier, source.sourcePath);
    return (
      (resolvedPath !== undefined &&
        path.normalize(resolvedPath) === path.normalize(frontier.sourcePath)) ||
      (options.resolveModule === undefined &&
        options.matchesTargetImport?.(specifier, source.sourcePath, frontier.sourcePath) === true)
    );
  });
}
/**
 * Climbs private same-module component usages until an importable owner export is reached.
 */
function promoteInspectorOwner(candidate: InspectorUsageCandidate): OwnerPromotionResult {
  const visitedLocalOwners = new Set<string>();
  const localOwnerNames: string[] = [];
  let currentSlice = candidate.slice;
  for (let depth = 0; depth <= MAX_LOCAL_OWNER_DEPTH; depth += 1) {
    const owner = currentSlice.owner;
    if (owner === null) {
      return { kind: 'stopped', stopReason: 'private-owner' };
    }
    if (owner.exportNames.length > 0) {
      if (
        !isPreviewInspectorComponentShapedOwner({
          occurrenceStart: currentSlice.occurrenceStart,
          owner,
          sourcePath: currentSlice.consumerPath,
          sourceText: candidate.sourceText,
        })
      ) {
        return { kind: 'stopped', stopReason: 'non-component-owner' };
      }
      const exportName = selectPreferredExportName(owner.exportNames);
      return {
        exportNames: Object.freeze([...owner.exportNames]),
        kind: 'promoted',
        localOwnerNames: Object.freeze(localOwnerNames),
        root: freezeReference(currentSlice.consumerPath, exportName),
      };
    }
    if (
      owner.localName === null ||
      depth >= MAX_LOCAL_OWNER_DEPTH ||
      visitedLocalOwners.has(owner.localName)
    ) {
      return { kind: 'stopped', stopReason: 'private-owner' };
    }

    visitedLocalOwners.add(owner.localName);
    localOwnerNames.push(owner.localName);
    const localAnalysis = analyzePreviewLocalParentSlices({
      consumerPath: currentSlice.consumerPath,
      localComponentName: owner.localName,
      sourceText: candidate.sourceText,
    });
    const nextSlice = localAnalysis.slices[0];
    if (nextSlice === undefined) {
      return { kind: 'stopped', stopReason: 'private-owner' };
    }
    currentSlice = nextSlice;
  }
  return { kind: 'stopped', stopReason: 'private-owner' };
}

/**
 * Orders candidates by mountability and generic application source conventions before path order.
 * Stories, tests, examples, fixtures, demos, and mocks remain eligible fallbacks, but application
 * pages/layouts/routes and entry modules win when both branches are structurally renderable.
 */
function compareRankedInspectorUsageCandidates(
  left: { readonly candidate: InspectorUsageCandidate; readonly score: number },
  right: { readonly candidate: InspectorUsageCandidate; readonly score: number },
): number {
  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const leftPath = left.candidate.slice.consumerPath;
  const rightPath = right.candidate.slice.consumerPath;
  const pathDifference = leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  return pathDifference !== 0
    ? pathDifference
    : left.candidate.slice.occurrenceStart - right.candidate.slice.occurrenceStart;
}

/** Assigns one bounded deterministic score without importing or evaluating candidate modules. */
function scoreInspectorUsageCandidate(candidate: InspectorUsageCandidate): number {
  const promotion = candidate.slice.owner === null ? undefined : promoteInspectorOwner(candidate);
  const mountabilityScore =
    candidate.slice.owner === null
      ? 800
      : promotion?.kind === 'promoted'
        ? 1_000 + Math.min(promotion.localOwnerNames.length, 12) * 3
        : 0;
  return (
    mountabilityScore +
    scoreInspectorSourcePath(candidate.slice.consumerPath) +
    scoreInspectorOwnerName(promotion)
  );
}

/** Applies framework-neutral filename conventions and strongly demotes non-application sources. */
function scoreInspectorSourcePath(sourcePath: string): number {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  const fileName = path.basename(normalizedPath).replace(/\.[^.]+$/u, '');
  let score = 0;

  if (
    /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)/u.test(normalizedPath) ||
    /(?:\.test|\.spec)$/u.test(fileName)
  ) {
    score -= 500;
  }
  if (
    /(?:^|\/)(?:stories|storybook)(?:\/|$)/u.test(normalizedPath) ||
    /\.stories?$/u.test(fileName)
  ) {
    score -= 420;
  }
  if (/(?:^|\/)(?:examples?|demos?|fixtures?|mocks?|playgrounds?)(?:\/|$)/u.test(normalizedPath)) {
    score -= 260;
  }

  if (/(?:^|\/)(?:pages?|layouts?|routes?|screens?|views?)(?:\/|$)/u.test(normalizedPath)) {
    score += 150;
  }
  if (/(?:page|layout|route|screen|view)$/u.test(fileName)) {
    score += 90;
  }
  if (/^(?:app|bootstrap|entry|main|root)$/u.test(fileName)) {
    score += 130;
  }
  return score;
}

/** Gives conventional page-root export names a small tie-break advantage over generic wrappers. */
function scoreInspectorOwnerName(promotion: OwnerPromotionResult | undefined): number {
  if (promotion?.kind !== 'promoted') {
    return 0;
  }
  const exportName = promotion.root.exportName;
  if (/^(?:App|Root)$/u.test(exportName)) {
    return 80;
  }
  if (/(?:Page|Layout|Route|Screen|View)$/u.test(exportName)) {
    return 60;
  }
  return exportName === 'default' ? 20 : 0;
}

/** Prefers a conventional default export while retaining deterministic named-export fallback. */
function selectPreferredExportName(exportNames: readonly string[]): string {
  return exportNames.includes('default') ? 'default' : (exportNames[0] ?? 'default');
}

/** Validates the public planner boundary before any package source is read. */
function assertInspectorTarget(documentPath: string, exportName: string): void {
  if (!path.isAbsolute(documentPath)) {
    throw new RangeError('Preview inspector target path must be absolute.');
  }
  if (exportName.length === 0 || exportName === '*') {
    throw new TypeError('Preview inspector target export must be explicit.');
  }
}

/** Creates a normalized, immutable component reference. */
function freezeReference(
  sourcePath: string,
  exportName: string,
): PreviewInspectorComponentReference {
  return Object.freeze({ exportName, sourcePath: path.normalize(sourcePath) });
}

/** Produces a cycle identity stable across path separator and alias spelling differences. */
function createReferenceKey(reference: PreviewInspectorComponentReference): string {
  return `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
}

/** Deduplicates render-graph alternatives that ultimately mount the same authored owner chain. */
function createInspectorPageCandidateKey(candidate: PreviewInspectorPageCandidate): string {
  return [
    createReferenceKey(candidate.root),
    ...candidate.edges.map(
      (edge) => `${createReferenceKey(edge.child)}>${createReferenceKey(edge.owner)}`,
    ),
  ].join('\0');
}

/** Freezes one selectable page candidate without retaining mutable traversal collections. */
function freezePageCandidate(options: {
  readonly complete: boolean;
  readonly dependencies: ReadonlySet<string>;
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  readonly id: string;
  readonly renderPath: PreviewRenderChainCandidate | undefined;
  readonly root: PreviewInspectorComponentReference;
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  readonly rootInference?: PreviewInferredExportProps;
  readonly rootOwnsRouter: boolean;
  readonly rootStepIndex?: number;
  readonly stopReason: PreviewInspectorAncestorStopReason;
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}): PreviewInspectorPageCandidate {
  return Object.freeze({
    complete: options.complete,
    dependencyPaths: Object.freeze([...options.dependencies].sort()),
    edges: Object.freeze([...options.edges]),
    id: options.id,
    ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
    root: options.root,
    rootAutomaticProps: options.rootAutomaticProps,
    ...(options.rootInference === undefined ? {} : { rootInference: options.rootInference }),
    rootOwnsRouter: options.rootOwnsRouter,
    ...(options.rootStepIndex === undefined ? {} : { rootStepIndex: options.rootStepIndex }),
    stopReason: options.stopReason,
    targetAutomaticProps: options.targetAutomaticProps,
  });
}

/** Freezes one successful or safely partial plan without retaining parser nodes/source text. */
function freezePlan(options: {
  readonly complete: boolean;
  readonly dependencies: ReadonlySet<string>;
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  readonly pageCandidates: readonly PreviewInspectorPageCandidate[];
  readonly root: PreviewInspectorComponentReference;
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  readonly renderChain: PreviewRenderChainPlan;
  readonly renderChainsByExport: PreviewRenderChainPlansByExport;
  readonly stopReason: PreviewInspectorAncestorStopReason;
  readonly target: PreviewInspectorComponentReference;
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}): PreviewInspectorAncestorPlan {
  return Object.freeze({
    complete: options.complete,
    dependencyPaths: Object.freeze([...options.dependencies].sort()),
    edges: Object.freeze([...options.edges]),
    pageCandidates: Object.freeze([...options.pageCandidates]),
    root: options.root,
    rootAutomaticProps: options.rootAutomaticProps,
    renderChain: options.renderChain,
    renderChainsByExport: options.renderChainsByExport,
    stopReason: options.stopReason,
    target: options.target,
    targetAutomaticProps: options.targetAutomaticProps,
  });
}
