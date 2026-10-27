/** Constructs Inspector page candidates from authored usage and render chains. */
import path from 'node:path';
import { createPreviewJsxOccurrenceId } from '../previewJsxOccurrenceIdentity';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { type PreviewParentSliceStaticProps } from '../parentSlice';
import {
  createPreviewRenderChainPlan,
  type PreviewRenderChainCandidate,
  type PreviewRenderChainPlansByExport,
} from '../renderGraph';
import { freezePreviewInspectorPageCandidate } from './previewInspectorAncestorFreezing';
import {
  createReferenceKey,
  freezeReference,
  type CreatePreviewInspectorAncestorPlanOptions,
  type InspectorUsagePlanningContext,
} from './previewInspectorAncestorModel';
import type {
  PreviewInspectorAncestorEdge,
  PreviewInspectorAncestorStopReason,
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import { findInspectorUsage, promoteInspectorOwner } from './previewInspectorAncestorUsage';
import { collectPreviewInspectorFrameworkPageShell } from './previewInspectorFrameworkPageShell';
import { createLexicalInspectorModuleResolver } from './previewInspectorLexicalResolver';
import {
  readPreviewInspectorRenderPathRootAutomaticProps,
  readPreviewInspectorRootInference,
  readPreviewInspectorRootOwnsRouter,
  type PreviewInspectorRenderPathRoot,
} from './previewInspectorRenderPathRoots';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';
import {
  matchesPreviewInspectorRenderPathUsage,
  readPreviewInspectorRenderPathUsage,
} from './previewInspectorRenderPathUsage';

/** Climbs one preferred render path while sharing all expensive syntax indexes with its siblings. */
export async function createInspectorPageCandidate(arguments_: {
  readonly options: CreatePreviewInspectorAncestorPlanOptions;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly renderPath: PreviewRenderChainCandidate | undefined;
  readonly sourcePaths: readonly string[];
  readonly target: PreviewInspectorComponentReference;
  readonly routeLocation: PreviewInspectorRouteLocation | undefined;
}): Promise<PreviewInspectorPageCandidate> {
  const { options, planningContext, renderPath, routeLocation, sourcePaths, target } = arguments_;
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
  let renderPathCursor = 0;
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
      options.resolveModule,
    );
    const rootOwnsRouter = await readPreviewInspectorRootOwnsRouter({
      ownershipCache: planningContext.routerOwnershipBySource,
      readSource: options.readSource,
      reference: currentRoot,
      renderPath,
      rootStepIndex: undefined,
      sourceCache: planningContext.sourceTextByPath,
    });
    const frameworkShell = await collectPreviewInspectorFrameworkPageShell({
      exportName: currentRoot.exportName,
      nextPagesShellRefiner: planningContext.nextPagesShellRefiner,
      pagePath: currentRoot.sourcePath,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      sourcePaths,
      targetPath: target.sourcePath,
    });
    for (const dependencyPath of frameworkShell.dependencyPaths) dependencies.add(dependencyPath);
    const { nextAppShell, nextPagesShell } = frameworkShell;
    const candidateRouteLocation = frameworkShell.routeLocation ?? routeLocation;
    return freezePreviewInspectorPageCandidate({
      complete: nextAppShell === undefined && nextPagesShell === undefined ? complete : true,
      dependencies,
      edges,
      id: renderPath?.id ?? 'nearest-authored-owner',
      renderPath,
      root: currentRoot,
      rootAutomaticProps,
      ...(rootInference === undefined ? {} : { rootInference }),
      ...(nextAppShell === undefined ? {} : { nextAppLayoutChain: nextAppShell.layouts }),
      ...(nextPagesShell === undefined ? {} : { nextPagesShell }),
      rootOwnsRouter,
      ...(candidateRouteLocation === undefined ? {} : { routeLocation: candidateRouteLocation }),
      stopReason:
        nextAppShell === undefined && nextPagesShell === undefined ? stopReason : 'root-reached',
      targetAutomaticProps,
    });
  };

  // Inventory and reference-cycle checks bound traversal without truncating deep authored owners.
  for (;;) {
    throwIfPreviewBuildCancelled(options.signal);
    const preferredUsage = readPreviewInspectorRenderPathUsage(
      renderPath,
      currentRoot,
      currentAliases,
      renderPathCursor,
    );
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
      ...(preferredUsage === undefined ? {} : { preferredUsage }),
    });
    if (candidate === undefined) {
      return finish(true, 'root-reached');
    }
    if (
      preferredUsage !== undefined &&
      matchesPreviewInspectorRenderPathUsage(candidate, preferredUsage)
    ) {
      renderPathCursor = preferredUsage.nextStepIndex;
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
        occurrenceId: createPreviewJsxOccurrenceId(
          candidate.slice.consumerPath,
          candidate.slice.occurrenceStart,
        ),
        owner: promotion.root,
      }),
    );
    currentAliases = promotion.exportNames;
    currentRoot = promotion.root;
    rootAutomaticProps = Object.freeze({});
  }
}

/** Creates a selectable mount root from one component export proven by the full render graph. */
export async function createRenderPathPageCandidate(arguments_: {
  readonly base: PreviewInspectorPageCandidate;
  readonly options: CreatePreviewInspectorAncestorPlanOptions;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly renderPathRoot: PreviewInspectorRenderPathRoot;
  readonly routeLocation: PreviewInspectorRouteLocation | undefined;
}): Promise<PreviewInspectorPageCandidate> {
  const { base, options, planningContext, renderPathRoot, routeLocation } = arguments_;
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
    options.resolveModule,
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
  const frameworkShell = await collectPreviewInspectorFrameworkPageShell({
    exportName: root.exportName,
    nextPagesShellRefiner: planningContext.nextPagesShellRefiner,
    pagePath: root.sourcePath,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePaths: options.sourcePaths,
    targetPath: options.documentPath,
  });
  for (const dependencyPath of frameworkShell.dependencyPaths) dependencies.add(dependencyPath);
  const { nextAppShell, nextPagesShell } = frameworkShell;
  const candidateRouteLocation = frameworkShell.routeLocation ?? routeLocation;
  const complete =
    nextAppShell !== undefined ||
    nextPagesShell !== undefined ||
    (renderPath.entryPoint !== undefined && renderPathRoot.outermost);
  return freezePreviewInspectorPageCandidate({
    complete,
    dependencies,
    edges: base.edges,
    id: `${renderPath.id}:root:${renderPathRoot.stepIndex.toString()}`,
    renderPath,
    root,
    rootAutomaticProps,
    ...(rootInference === undefined ? {} : { rootInference }),
    ...(nextAppShell === undefined ? {} : { nextAppLayoutChain: nextAppShell.layouts }),
    ...(nextPagesShell === undefined ? {} : { nextPagesShell }),
    rootOwnsRouter,
    rootStepIndex: renderPathRoot.stepIndex,
    ...(candidateRouteLocation === undefined ? {} : { routeLocation: candidateRouteLocation }),
    stopReason: complete ? 'root-reached' : 'render-path-checkpoint',
    targetAutomaticProps: base.targetAutomaticProps,
  });
}

/** Reuses an all-export graph or discovers only the standalone selected target. */
export async function readInspectorRenderChains(
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
    ...(options.analyzeSource === undefined ? {} : { analyzeSource: options.analyzeSource }),
    ...(options.collectModuleSpecifiers === undefined
      ? {}
      : { collectModuleSpecifiers: options.collectModuleSpecifiers }),
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
