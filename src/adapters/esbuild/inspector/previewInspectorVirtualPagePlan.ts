/** Coordinates VirtualPagePlan using bounded authored-source evidence. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PreviewInspectorTargetMode } from '../../../domain/preview';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';
import type { PreviewInspectorVirtualPageCandidate } from './previewInspectorVirtualPageModel';
import {
  createVirtualPageRootKey,
  createVirtualPageRecipe,
  readPreviewInspectorGenericRouteLocation,
} from './previewInspectorVirtualPageRecipe';
import {
  createVirtualPageEmissionKey,
  isFrameworkComposedCandidate,
  scoreVirtualPageContent,
} from './previewInspectorVirtualPageScoring';

/**
 * Converts authored candidates into VirtualPage recipes before the fast first-paint cap.
 *
 * Candidates on the same render path collapse to one page recipe. This is the critical ordering:
 * fast mode may publish one candidate, but it must choose the concrete page before truncating the
 * list, rather than truncating to an application root and losing every usable checkpoint.
 */
export function createPreviewInspectorVirtualPageCandidates(
  candidates: readonly PreviewInspectorPageCandidate[],
  maximumCount = candidates.length,
  shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[] = [],
  targetMode?: PreviewInspectorTargetMode,
): readonly PreviewInspectorVirtualPageCandidate[] {
  const boundedMaximum = Math.max(1, Math.floor(maximumCount));
  const emissions: {
    readonly authoredCandidate: PreviewInspectorPageCandidate;
    readonly contentCandidate: PreviewInspectorPageCandidate;
    readonly emittedKey: string;
  }[] = [];
  const emittedKeys = new Set<string>();

  for (const authoredCandidate of candidates) {
    const contentCandidate = selectPreviewInspectorVirtualPageContentCandidate(
      candidates,
      authoredCandidate,
      targetMode,
      shallowVisualPaths,
    );
    const emittedKey = createVirtualPageEmissionKey(authoredCandidate, contentCandidate);
    if (emittedKeys.has(emittedKey)) continue;
    emittedKeys.add(emittedKey);
    emissions.push({ authoredCandidate, contentCandidate, emittedKey });
  }

  const browserIdsByEmissionKey = createBrowserCandidateIds(emissions);
  return Object.freeze(
    emissions.slice(0, boundedMaximum).map((emission) =>
      Object.freeze({
        authoredCandidate: emission.authoredCandidate,
        browserCandidate: createBrowserCandidate(
          emission.authoredCandidate,
          emission.contentCandidate,
          browserIdsByEmissionKey.get(emission.emittedKey) ?? emission.authoredCandidate.id,
          targetMode,
        ),
        contentCandidate: emission.contentCandidate,
        // Identity collisions still see every emission; only retained output needs shell work.
        recipe: createVirtualPageRecipe(
          emission.authoredCandidate,
          emission.contentCandidate,
          shallowVisualPaths,
          candidates,
        ),
      }),
    ),
  );
}

/** Assigns opaque browser IDs after every distinct emission is known, before output truncation. */
function createBrowserCandidateIds(
  emissions: readonly {
    readonly authoredCandidate: PreviewInspectorPageCandidate;
    readonly emittedKey: string;
  }[],
): ReadonlyMap<string, string> {
  const emissionsByAuthoredId = new Map<string, typeof emissions>();
  for (const emission of emissions) {
    const group = emissionsByAuthoredId.get(emission.authoredCandidate.id) ?? [];
    emissionsByAuthoredId.set(emission.authoredCandidate.id, [...group, emission]);
  }
  const browserIdsByEmissionKey = new Map<string, string>();
  for (const [authoredId, group] of emissionsByAuthoredId) {
    for (const emission of group) {
      browserIdsByEmissionKey.set(
        emission.emittedKey,
        group.length === 1
          ? authoredId
          : createCollidingVirtualPageBrowserCandidateId(authoredId, emission.emittedKey),
      );
    }
  }
  return browserIdsByEmissionKey;
}

/** Produces a bounded selector-protocol-safe ID without making collisions order-dependent. */
function createCollidingVirtualPageBrowserCandidateId(
  authoredId: string,
  emittedKey: string,
): string {
  const safeAuthoredId = authoredId.replace(/[^A-Za-z0-9._:/@-]+/gu, '_').slice(0, 478);
  const prefix = safeAuthoredId.length === 0 ? 'candidate' : safeAuthoredId;
  const digest = createHash('sha256')
    .update(authoredId)
    .update('\0')
    .update(emittedKey)
    .digest('hex');
  return `${prefix}:virtual-page-${digest.slice(0, 20)}`;
}

/**
 * Finds the safest page-shaped checkpoint on the same exact target-to-entry render path.
 *
 * Framework filesystem candidates already describe an implicit page composition and remain
 * untouched. Generic apps prefer concrete page/screen/view/form modules, then the nearest JSX
 * checkpoint, while strongly avoiding app/router/layout entries whose module initialization caused
 * the original preview failure.
 */
export function selectPreviewInspectorVirtualPageContentCandidate(
  candidates: readonly PreviewInspectorPageCandidate[],
  authoredCandidate: PreviewInspectorPageCandidate,
  targetMode?: PreviewInspectorTargetMode,
  shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[] = [],
): PreviewInspectorPageCandidate {
  if (isFrameworkComposedCandidate(authoredCandidate)) return authoredCandidate;
  if (routeSelectionDescribesSelectedSurface(authoredCandidate, targetMode)) {
    const routeOwner =
      (targetMode === 'selected-route-leaf'
        ? selectRetainedNestedRouteOwner(candidates, authoredCandidate, shallowVisualPaths)
        : undefined) ?? selectPreviewInspectorRouteOwnerCandidate(candidates, authoredCandidate);
    if (routeOwner !== undefined) return routeOwner;
    const selectedRouteLeaf = createPreviewInspectorSelectedRouteLeafCandidate(authoredCandidate);
    if (selectedRouteLeaf !== undefined) return selectedRouteLeaf;
  }
  const renderPathId = authoredCandidate.renderPath?.id;
  if (renderPathId === undefined) return authoredCandidate;
  const samePathCandidates = candidates.filter(
    (candidate) => candidate.renderPath?.id === renderPathId,
  );
  if (samePathCandidates.length === 0) return authoredCandidate;

  const ranked = samePathCandidates.map((candidate, discoveryIndex) => {
    const score = scoreVirtualPageContent(candidate, authoredCandidate);
    return { candidate, discoveryIndex, score };
  });
  if (ranked.some((entry) => Number.isNaN(entry.score))) {
    // NaN comparisons historically tie with adjacent entries; preserve that stable-sort behavior.
    return (
      ranked.sort(
        (left, right) => right.score - left.score || left.discoveryIndex - right.discoveryIndex,
      )[0]?.candidate ?? authoredCandidate
    );
  }
  let best = ranked[0];
  for (const entry of ranked) {
    if (best === undefined || entry.score > best.score) best = entry;
  }
  return best?.candidate ?? authoredCandidate;
}

/**
 * Uses a nearer explicit-route checkpoint only when its recipe retains every skipped outer owner.
 *
 * Ancestor-prefix exploration carries outer factory mounts before the inner page owner. Those
 * mounts prove context, not a preference for the outermost module as the live content root. Exact
 * same-path checkpoints may move inward only if source-backed owner shells preserve the complete
 * omitted mount corridor; missing frame proof leaves the existing outer-owner policy unchanged.
 */
function selectRetainedNestedRouteOwner(
  candidates: readonly PreviewInspectorPageCandidate[],
  authoredCandidate: PreviewInspectorPageCandidate,
  shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[],
): PreviewInspectorPageCandidate | undefined {
  const mounts = readPreviewInspectorGenericRouteLocation(
    authoredCandidate.routeLocation,
  )?.routeMounts;
  const renderPath = authoredCandidate.renderPath;
  if (mounts === undefined || renderPath === undefined) return undefined;
  for (let index = mounts.length - 1; index >= 0; index -= 1) {
    const mount = mounts[index];
    if (mount === undefined) continue;
    const owner = candidates.find((candidate) => {
      const stepIndex = candidate.rootStepIndex;
      const step = stepIndex === undefined ? undefined : renderPath.steps[stepIndex];
      return (
        candidate.renderPath?.id === renderPath.id &&
        step !== undefined &&
        path.normalize(step.sourcePath) === path.normalize(mount.sourcePath) &&
        createVirtualPageRootKey(candidate.root) === createVirtualPageRootKey(mount)
      );
    });
    if (owner === undefined) continue;
    const recipe = createVirtualPageRecipe(
      authoredCandidate,
      owner,
      shallowVisualPaths,
      candidates,
    );
    const retainedOwners = new Set(
      recipe.shells
        .filter((shell) => shell.relation === 'owner')
        .map((shell) => createVirtualPageRootKey(shell.root)),
    );
    if (
      mounts.slice(0, index).every((outer) => retainedOwners.has(createVirtualPageRootKey(outer)))
    )
      return owner;
  }
  return undefined;
}

/**
 * Distinguishes a selected route page from route metadata attached to a shared descendant surface.
 *
 * Route-choice expansion annotates every candidate on the current file's render path. When that
 * file is shared chrome (for example a panel beside several routed pages), the resolved route leaf
 * is only an outer corridor choice. Promoting its route owner would execute application gates while
 * bypassing a nearer, already-proven structural checkpoint. The innermost render-path step is the
 * authoritative selected surface whenever it exists; exact root identity remains the fallback for
 * detached route-leaf candidates that have no reverse-path proof.
 */
function routeSelectionDescribesSelectedSurface(
  authoredCandidate: PreviewInspectorPageCandidate,
  targetMode?: PreviewInspectorTargetMode,
): boolean {
  const location = readPreviewInspectorGenericRouteLocation(authoredCandidate.routeLocation);
  const componentSourcePath = location?.componentSourcePath;
  if (componentSourcePath === undefined) return true;
  if (targetMode === 'selected-route-leaf') return true;
  const normalizedComponentPath = path.normalize(componentSourcePath);
  const renderPathSteps = authoredCandidate.renderPath?.steps ?? [];
  const selectedSurfaceStep = renderPathSteps[0];
  if (selectedSurfaceStep !== undefined) {
    if (path.normalize(selectedSurfaceStep.sourcePath) === normalizedComponentPath) return true;
    const routeStepIndex = renderPathSteps.findIndex(
      (step) => path.normalize(step.sourcePath) === normalizedComponentPath,
    );
    if (
      routeStepIndex > 0 &&
      renderPathSteps.slice(0, routeStepIndex).some((step) => {
        const invocationSourcePath = step.invocation?.sourcePath;
        return (
          invocationSourcePath !== undefined &&
          path.normalize(invocationSourcePath) === normalizedComponentPath
        );
      })
    ) {
      // The selected document is a proven descendant rendered by this exact route page. Keep the
      // page's route owner; merely being deeper than the catalog leaf does not make it shared chrome.
      return true;
    }
    return false;
  }
  return path.normalize(authoredCandidate.root.sourcePath) === normalizedComponentPath;
}

/**
 * Promotes an exact resolved route choice below an authored router root to the live page body.
 *
 * The authored root remains VirtualPage provenance, but executing it would re-enter unrelated
 * application-wide gates before the selected route surface. Nested route owners are excluded here
 * because their retained mount is the proven provider/Router context for the leaf.
 */
function createPreviewInspectorSelectedRouteLeafCandidate(
  authoredCandidate: PreviewInspectorPageCandidate,
): PreviewInspectorPageCandidate | undefined {
  const location = authoredCandidate.routeLocation;
  if (location?.evidenceKind !== 'route-catalog' && location?.evidenceKind !== 'route-jsx') {
    return undefined;
  }
  const componentSourcePath = location.componentSourcePath;
  if (componentSourcePath === undefined || (location.routeMounts?.length ?? 0) > 0) {
    return undefined;
  }
  const routeRoot = Object.freeze({
    exportName: location.componentExportName ?? 'default',
    sourcePath: path.normalize(componentSourcePath),
  });
  if (
    path.normalize(authoredCandidate.root.sourcePath) === routeRoot.sourcePath &&
    authoredCandidate.root.exportName === routeRoot.exportName
  ) {
    return undefined;
  }
  const { rootStepIndex: omittedRootStepIndex, ...routeCandidate } = authoredCandidate;
  void omittedRootStepIndex;
  return Object.freeze({
    ...routeCandidate,
    dependencyPaths: Object.freeze(
      [...new Set([...authoredCandidate.dependencyPaths, routeRoot.sourcePath])].sort(),
    ),
    edges: Object.freeze([]),
    root: routeRoot,
    rootAutomaticProps: Object.freeze({}),
    rootOwnsRouter: false,
    stopReason: 'render-path-checkpoint',
    target: routeRoot,
    targetAutomaticProps: Object.freeze({}),
  });
}

/**
 * Pins a route leaf to an authenticated route owner. Existing route mounts retain precedence;
 * otherwise a direct JSX owner is admitted only when one same-render-path candidate has the exact
 * resolved owner source identity. Mounting a leaf directly drops route params and providers.
 */
function selectPreviewInspectorRouteOwnerCandidate(
  candidates: readonly PreviewInspectorPageCandidate[],
  authoredCandidate: PreviewInspectorPageCandidate,
): PreviewInspectorPageCandidate | undefined {
  const location = readPreviewInspectorGenericRouteLocation(authoredCandidate.routeLocation);
  if (location === undefined) return undefined;
  for (const mount of location.routeMounts ?? []) {
    const candidate = candidates.find(
      (item) =>
        path.normalize(item.root.sourcePath) === path.normalize(mount.sourcePath) &&
        item.root.exportName === mount.exportName,
    );
    if (candidate !== undefined) return candidate;
  }

  /*
   * An exact inline route element already supplies the selected leaf's authored page frame. Running
   * the outer direct owner again would re-enter unrelated redirects and application-wide gates,
   * even though the compiler can safely compose the proven wrappers around the concrete leaf.
   * Nested route mounts above remain authoritative and returned before this guard.
   */
  const componentSourcePath = location.componentSourcePath;
  if (
    componentSourcePath !== undefined &&
    (location.routeMounts?.length ?? 0) === 0 &&
    (location.elementWrappers?.length ?? 0) > 0
  ) {
    return undefined;
  }

  const directRouteOwnerSourcePath = location.directRouteOwnerSourcePath;
  const renderPathId = authoredCandidate.renderPath?.id;
  if (directRouteOwnerSourcePath === undefined || renderPathId === undefined) return undefined;
  const directRouteOwners = candidates.filter(
    (candidate) =>
      candidate.renderPath?.id === renderPathId &&
      path.normalize(candidate.root.sourcePath) === path.normalize(directRouteOwnerSourcePath),
  );
  return directRouteOwners.length === 1 ? directRouteOwners[0] : undefined;
}

/** Creates browser metadata using the live content root while preserving authored path identity. */
function createBrowserCandidate(
  authoredCandidate: PreviewInspectorPageCandidate,
  contentCandidate: PreviewInspectorPageCandidate,
  browserCandidateId: string,
  targetMode?: PreviewInspectorTargetMode,
): PreviewInspectorPageCandidate {
  const renderPath = authoredCandidate.renderPath ?? contentCandidate.renderPath;
  const detachedTargetPlacement =
    authoredCandidate.detachedTargetPlacement ?? contentCandidate.detachedTargetPlacement;
  /*
   * A route-factory owner can share one executable checkpoint across several child paths. The
   * authored candidate carries the user's exact route choice, while the selected content checkpoint
   * may be the first same-path candidate chosen only for dependency safety. Preserve authored route
   * identity so switching the Inspector selector changes MemoryRouter rather than only its label.
   */
  const attachedRouteLocation = attachPreviewInspectorDirectRouteOwnerMount(
    authoredCandidate.routeLocation ?? contentCandidate.routeLocation,
    contentCandidate.root,
  );
  const replacedAuthoredRoot =
    path.normalize(authoredCandidate.root.sourcePath) !==
      path.normalize(contentCandidate.root.sourcePath) ||
    authoredCandidate.root.exportName !== contentCandidate.root.exportName;
  const routeLocation =
    replacedAuthoredRoot && !routeSelectionDescribesSelectedSurface(authoredCandidate, targetMode)
      ? retainPreviewInspectorRouteStateWithoutOuterComposition(attachedRouteLocation)
      : attachedRouteLocation;
  const routeMount = selectPreviewInspectorRouteMount(routeLocation, contentCandidate.root);
  return Object.freeze({
    ...contentCandidate,
    ...(detachedTargetPlacement === undefined ? {} : { detachedTargetPlacement }),
    id: browserCandidateId,
    ...(renderPath === undefined ? {} : { renderPath }),
    ...(routeLocation === undefined ? {} : { routeLocation }),
    ...(routeMount === undefined
      ? {}
      : {
          routeMountBasePath: routeMount.basePath,
          routeSlotCount: routeMount.routeSlotCount,
          wildcardFallbackPresent: routeMount.hasWildcardFallback,
        }),
  });
}

/**
 * Keeps the selected pathname and parameters for shared chrome without re-entering its outer app.
 *
 * Route mounts and element wrappers compose the resolved leaf, not a panel or shell nested inside
 * that leaf's broader application path. An isolated structural checkpoint still receives a local
 * memory location from the retained route metadata; an authentic VirtualPage owner may add back a
 * narrower, compiler-proven mount later during Page Execution planning.
 */
function retainPreviewInspectorRouteStateWithoutOuterComposition(
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
): PreviewInspectorPageCandidate['routeLocation'] {
  const genericLocation = readPreviewInspectorGenericRouteLocation(routeLocation);
  if (genericLocation === undefined) return routeLocation;
  return Object.freeze({
    ...genericLocation,
    elementWrappers: Object.freeze([]),
    routeMounts: Object.freeze([]),
  });
}

/**
 * Gives an exact unmounted JSX route owner the local Router boundary its relative Routes require.
 * Existing authored mounts remain authoritative; source identity must match the retained content
 * root, so an unrelated or ambiguous route leaf cannot acquire synthetic ownership.
 */
function attachPreviewInspectorDirectRouteOwnerMount(
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
  contentRoot: PreviewInspectorPageCandidate['root'],
): PreviewInspectorPageCandidate['routeLocation'] {
  const genericLocation = readPreviewInspectorGenericRouteLocation(routeLocation);
  if (
    genericLocation === undefined ||
    (genericLocation.routeMounts?.length ?? 0) > 0 ||
    genericLocation.directRouteOwnerSourcePath === undefined ||
    path.normalize(genericLocation.directRouteOwnerSourcePath) !==
      path.normalize(contentRoot.sourcePath)
  ) {
    return routeLocation;
  }
  return Object.freeze({
    ...genericLocation,
    routeMounts: Object.freeze([
      Object.freeze({
        basePath: '/',
        contextOrigin: 'virtual-page-owner' as const,
        contextPattern: '/*',
        exportName: contentRoot.exportName,
        hasWildcardFallback: false,
        routeSlotCount: 1,
        sourcePath: path.normalize(contentRoot.sourcePath),
      }),
    ]),
  });
}

/**
 * Selects the deepest factory mount owned by the exact VirtualPage content root.
 *
 * Route metadata for a leaf can contain several outer modules, but only a source-and-export match
 * may localize a directly mounted component; any mismatch intentionally leaves Router input whole.
 */
function selectPreviewInspectorRouteMount(
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
  contentRoot: PreviewInspectorPageCandidate['root'],
):
  | {
      readonly basePath: string;
      readonly hasWildcardFallback: boolean;
      readonly routeSlotCount: number;
    }
  | undefined {
  if (routeLocation === undefined || !('routeMounts' in routeLocation)) return undefined;
  const mounts = routeLocation.routeMounts;
  const contentPath = path.normalize(contentRoot.sourcePath);
  for (let index = mounts.length - 1; index >= 0; index -= 1) {
    const mount = mounts[index];
    if (
      mount !== undefined &&
      path.normalize(mount.sourcePath) === contentPath &&
      mount.exportName === contentRoot.exportName
    ) {
      return mount;
    }
  }
  return undefined;
}
export type {
  PreviewInspectorVirtualPageCandidate,
  PreviewInspectorVirtualPageMode,
  PreviewInspectorVirtualPagePathStep,
  PreviewInspectorVirtualPageRecipe,
  PreviewInspectorVirtualPageShell,
} from './previewInspectorVirtualPageModel';
