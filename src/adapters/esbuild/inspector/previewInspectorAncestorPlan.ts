/** Coordinates AncestorPlan using bounded authored-source evidence. */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { createPreviewStaticModuleResolutionMemo } from '../previewStaticModuleResolver';
import { type PreviewRenderChainCandidate } from '../renderGraph';
import {
  createInspectorPageCandidate,
  createRenderPathPageCandidate,
  readInspectorRenderChains,
} from './previewInspectorAncestorCandidates';
import { freezePreviewInspectorAncestorPlan } from './previewInspectorAncestorFreezing';
import {
  createInspectorUsagePlanningContext,
  type CreatePreviewInspectorAncestorPlanOptions,
  createReferenceKey,
  freezeReference,
  type PreviewInspectorAncestorCandidateTemplates,
  type PreviewInspectorAncestorPrelude,
} from './previewInspectorAncestorModel';
import { finalizePreviewInspectorRouteJsxOwners } from './previewInspectorAncestorPromotion';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import { collectPreviewInspectorNextAppDescendantPages } from './previewInspectorNextAppDescendantPages';
import { collectPreviewInspectorNextPagesDescendantPages } from './previewInspectorNextPagesDescendantPages';
import { rankPreviewInspectorPageCandidates } from './previewInspectorPageCandidateRanking';
import { collectPreviewInspectorRenderOutcomes } from './previewInspectorRenderOutcomeExpansion';
import { collectPreviewInspectorRenderPathRoots } from './previewInspectorRenderPathRoots';
import {
  collectPreviewInspectorRouteBranchPlan,
  createPreviewInspectorRouteOwnerLocationInventoryMemo,
  type CollectPreviewInspectorRouteBranchPlanOptions,
  type PreviewInspectorRouteBranchPlan,
} from './previewInspectorRouteBranchPlan';
import { expandPreviewInspectorRouteChoiceCandidates } from './previewInspectorRouteChoiceCandidates';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';

export type {
  CreatePreviewInspectorAncestorPlanOptions,
  PreviewInspectorAncestorCandidateTemplates,
  PreviewInspectorAncestorPrelude,
  PreviewInspectorAncestorUsageContext,
} from './previewInspectorAncestorModel';
export type {
  PreviewInspectorAncestorEdge,
  PreviewInspectorAncestorPlan,
  PreviewInspectorAncestorStopReason,
  PreviewInspectorComponentReference,
  PreviewInspectorModuleContextReference,
  PreviewInspectorPageCandidate,
  ReadPreviewInspectorAcceptedSpecifiers,
  ReadPreviewInspectorSource,
} from './previewInspectorAncestorTypes';

/** Finds the outermost bounded exported owner reproducing the target's authored page branch. */
export async function createPreviewInspectorAncestorPlan(
  options: CreatePreviewInspectorAncestorPlanOptions,
): Promise<PreviewInspectorAncestorPlan> {
  const resolveModule = options.resolveModule;
  if (resolveModule === undefined) return buildPreviewInspectorAncestorPlan(options);
  const resolutionMemo = createPreviewStaticModuleResolutionMemo();
  try {
    return await buildPreviewInspectorAncestorPlan({
      ...options,
      resolveModule: (specifier, consumerPath) =>
        resolutionMemo.resolve(specifier, consumerPath, () =>
          resolveModule(specifier, consumerPath),
        ),
    });
  } finally {
    resolutionMemo.release();
  }
}

/** Builds the complete plan using one immutable request's exact import-resolution results. */
async function buildPreviewInspectorAncestorPlan(
  options: CreatePreviewInspectorAncestorPlanOptions,
): Promise<PreviewInspectorAncestorPlan> {
  throwIfPreviewBuildCancelled(options.signal);
  assertInspectorTarget(options.documentPath, options.exportName);
  const sourcePaths = Object.freeze(
    [...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath)))].sort(),
  );
  const target = freezeReference(options.documentPath, options.exportName);
  const computePrelude = (): Promise<PreviewInspectorAncestorPrelude> =>
    createPreviewInspectorAncestorPrelude(options, target, sourcePaths);
  const prelude =
    options.usageContext === undefined
      ? await computePrelude()
      : await options.usageContext.getAncestorPrelude(computePrelude);
  assertPreviewInspectorAncestorPrelude(prelude, target);
  const computeTemplates = (): Promise<PreviewInspectorAncestorCandidateTemplates> =>
    createPreviewInspectorAncestorCandidateTemplates(options, prelude);
  const readTemplates = (): Promise<PreviewInspectorAncestorCandidateTemplates> =>
    options.usageContext === undefined
      ? computeTemplates()
      : options.usageContext.getCandidateTemplates(computeTemplates);
  const { templates, routeBranchPlan } = await prepareInspectorCandidateRouting(
    {
      documentPath: target.sourcePath,
      exportName: target.exportName,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      renderChain: prelude.renderChain,
      ...(options.routeSelection === undefined ? {} : { selection: options.routeSelection }),
      ...(options.usageContext?.selectionPrefixProvider === undefined
        ? {}
        : { selectionPrefixProvider: options.usageContext.selectionPrefixProvider }),
      sourcePaths: prelude.sourcePaths,
    },
    readTemplates,
  );
  const routeLocation = routeBranchPlan.activeLocation ?? routeBranchPlan.primary;
  throwIfPreviewBuildCancelled(options.signal);
  const discoveredCandidates = templates.candidates.map((candidate) =>
    attachPreviewInspectorSelectedRouteFallback(candidate, routeLocation),
  );
  const finalizedCandidates = await finalizePreviewInspectorRouteJsxOwners(
    discoveredCandidates,
    options,
    sourcePaths,
    target,
  );
  const pageCandidates = rankPreviewInspectorPageCandidates(
    expandPreviewInspectorRouteChoiceCandidates(
      finalizedCandidates,
      routeBranchPlan.activeLocation === undefined ? [] : [routeBranchPlan.activeLocation],
    ),
  );

  const primary = pageCandidates[0];
  if (primary === undefined) {
    throw new Error(`Missing Inspector page candidate for export: ${target.exportName}`);
  }
  const sharedDependencies = new Set<string>([
    ...prelude.dependencyPaths,
    ...routeBranchPlan.dependencyPaths,
  ]);
  for (const candidate of pageCandidates) {
    for (const dependencyPath of candidate.dependencyPaths) {
      sharedDependencies.add(dependencyPath);
    }
  }
  return freezePreviewInspectorAncestorPlan({
    complete: primary.complete,
    dependencies: sharedDependencies,
    edges: primary.edges,
    pageCandidates,
    root: primary.root,
    rootAutomaticProps: primary.rootAutomaticProps,
    renderChain: prelude.renderChain,
    renderChainsByExport: prelude.renderChainsByExport,
    renderOutcomesByExport: prelude.renderOutcomesByExport,
    routeBranches: routeBranchPlan.branches,
    ...(routeBranchPlan.selectionResolution === undefined
      ? {}
      : { routeSelectionResolution: routeBranchPlan.selectionResolution }),
    ...(routeBranchPlan.selectedBranchId === undefined
      ? {}
      : { selectedRouteBranchId: routeBranchPlan.selectedBranchId }),
    stopReason: primary.stopReason,
    target,
    targetAutomaticProps: primary.targetAutomaticProps,
  });
}

/** Reads route evidence first and aligns ambiguous automatic choices without repeating discovery. */
async function prepareInspectorCandidateRouting(
  options: CollectPreviewInspectorRouteBranchPlanOptions,
  readTemplates: () => Promise<PreviewInspectorAncestorCandidateTemplates>,
): Promise<{
  readonly routeBranchPlan: PreviewInspectorRouteBranchPlan;
  readonly templates: PreviewInspectorAncestorCandidateTemplates;
}> {
  if ((options.selection?.length ?? 0) > 0) {
    const routeBranchPlan = await collectPreviewInspectorRouteBranchPlan(options);
    return { routeBranchPlan, templates: await readTemplates() };
  }
  const inventoryMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo(options);
  try {
    const sharedOptions = { ...options, ownerLocationInventoryMemo: inventoryMemo };
    const initialBranchPlan = await collectPreviewInspectorRouteBranchPlan(sharedOptions);
    const inventory = await inventoryMemo.collect(options.documentPath, options.exportName);
    const templates = await readTemplates();
    if (inventory.choices.length <= 1) return { routeBranchPlan: initialBranchPlan, templates };
    const preferredRenderPath = rankPreviewInspectorPageCandidates(
      templates.candidates.map((candidate) =>
        attachPreviewInspectorSelectedRouteFallback(
          candidate,
          initialBranchPlan.activeLocation ?? inventory.primary,
        ),
      ),
    )[0]?.renderPath;
    if (preferredRenderPath === undefined) return { routeBranchPlan: initialBranchPlan, templates };
    const routeBranchPlan = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      preferredRenderPath,
    });
    return { routeBranchPlan, templates };
  } finally {
    inventoryMemo.release();
  }
}

/** Computes the immutable render evidence shared by every route selection in one request. */
async function createPreviewInspectorAncestorPrelude(
  options: CreatePreviewInspectorAncestorPlanOptions,
  target: PreviewInspectorComponentReference,
  sourcePaths: readonly string[],
): Promise<PreviewInspectorAncestorPrelude> {
  const renderChainsByExport = await readInspectorRenderChains(options, target, sourcePaths);
  const renderChain = renderChainsByExport[target.exportName];
  if (renderChain === undefined) {
    throw new Error(`Missing Inspector render chain for export: ${target.exportName}`);
  }
  const renderOutcomeAnalysis = await collectPreviewInspectorRenderOutcomes({
    acceptedExportNames: Object.keys(renderChainsByExport),
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePath: target.sourcePath,
    sourcePaths,
  });
  return Object.freeze({
    dependencyPaths: Object.freeze(
      [
        ...new Set([
          target.sourcePath,
          ...Object.values(renderChainsByExport).flatMap((plan) => plan.dependencyPaths),
          ...renderOutcomeAnalysis.dependencyPaths,
        ]),
      ].sort(),
    ),
    renderChain,
    renderChainsByExport,
    renderOutcomesByExport: renderOutcomeAnalysis.plansByExport,
    sourcePaths: Object.freeze([...sourcePaths]),
    target,
  });
}

/** Computes unexpanded candidates without retaining a selected route's fallback location. */
async function createPreviewInspectorAncestorCandidateTemplates(
  options: CreatePreviewInspectorAncestorPlanOptions,
  prelude: PreviewInspectorAncestorPrelude,
): Promise<PreviewInspectorAncestorCandidateTemplates> {
  const { sourcePaths, target } = prelude;
  const planningContext = createInspectorUsagePlanningContext(options, sourcePaths);
  // Preserve every entry-connected path that survived the render graph's bounded traversal.
  const renderPaths = prelude.renderChain.paths;
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

  /** Applies implicit framework descendants to every candidate source, including path checkpoints. */
  const addCandidateWithFrameworkDescendants = async (
    candidate: PreviewInspectorPageCandidate,
  ): Promise<void> => {
    const nextPagesDescendants = await collectPreviewInspectorNextPagesDescendantPages({
      base: candidate,
      nextPagesShellRefiner: planningContext.nextPagesShellRefiner,
      readSource: options.readSource,
      sourcePaths,
    });
    if (nextPagesDescendants.length === 0) addCandidate(candidate);
    else for (const descendant of nextPagesDescendants) addCandidate(descendant);
    for (const descendant of await collectPreviewInspectorNextAppDescendantPages({
      base: candidate,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      sourcePaths,
    }))
      addCandidate(descendant);
  };

  for (const renderPath of candidatePaths) {
    throwIfPreviewBuildCancelled(options.signal);
    const candidate = await createInspectorPageCandidate({
      options,
      planningContext,
      renderPath,
      sourcePaths,
      target,
      routeLocation: undefined,
    });
    baseCandidates.push({ candidate, renderPath });
    await addCandidateWithFrameworkDescendants(candidate);
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
      await addCandidateWithFrameworkDescendants(
        await createRenderPathPageCandidate({
          base: candidate,
          options,
          planningContext,
          renderPathRoot,
          routeLocation: undefined,
        }),
      );
    }
  }
  return Object.freeze({ candidates: Object.freeze(discoveredCandidates) });
}

/** Rejects a stage supplied for a different target or source inventory before route finalization. */
function assertPreviewInspectorAncestorPrelude(
  prelude: PreviewInspectorAncestorPrelude,
  target: PreviewInspectorComponentReference,
): void {
  if (
    path.normalize(prelude.target.sourcePath) !== target.sourcePath ||
    prelude.target.exportName !== target.exportName ||
    prelude.renderChainsByExport[target.exportName] !== prelude.renderChain ||
    path.normalize(prelude.renderChain.target.sourcePath) !== target.sourcePath ||
    prelude.renderChain.target.exportName !== target.exportName
  ) {
    throw new TypeError('Preview Inspector ancestor context does not match the selected target.');
  }
}

/** Copies a template only when it lacks a stronger framework-owned route location. */
function attachPreviewInspectorSelectedRouteFallback(
  candidate: PreviewInspectorPageCandidate,
  routeLocation: PreviewInspectorRouteLocation | undefined,
): PreviewInspectorPageCandidate {
  if (candidate.routeLocation !== undefined || routeLocation === undefined) return candidate;
  const { stopReason, targetAutomaticProps, ...prefix } = candidate;
  return Object.freeze({
    ...prefix,
    routeLocation,
    stopReason,
    targetAutomaticProps,
  });
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

/** Deduplicates render-graph alternatives that ultimately mount the same authored owner chain. */
function createInspectorPageCandidateKey(candidate: PreviewInspectorPageCandidate): string {
  return JSON.stringify([
    createReferenceKey(candidate.root),
    candidate.renderPath?.id,
    candidate.edges.map((edge) => [
      createReferenceKey(edge.child),
      createReferenceKey(edge.owner),
      edge.occurrenceStart,
      edge.localOwnerNames,
    ]),
  ]);
}
