/**
 * Selects the executable body of a generated VirtualPage without evaluating an application root.
 *
 * A React application entry is valuable static evidence: it proves the route-to-target path and
 * identifies omitted shell components. It is frequently a poor preview entry, however, because
 * importing it also evaluates authentication bootstraps, route catalogs, analytics, and backend
 * clients before React can mount anything. A VirtualPage therefore keeps that authored root as
 * provenance while mounting the nearest concrete page checkpoint on the same proven render path.
 *
 * This module is deliberately data-only. It does not read source files, resolve modules, or emit
 * JavaScript, so candidate selection remains deterministic and independently testable.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocationTypes';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';
import { isPreviewInspectorSafeShallowVisualBinding } from './previewInspectorVisualBinding';

/** How the generated page obtains its executable body. */
export type PreviewInspectorVirtualPageMode =
  'authored-root' | 'next-app-filesystem' | 'next-pages-filesystem' | 'static-page-checkpoint';

/** One omitted outer path step retained as VirtualPage composition evidence. */
export interface PreviewInspectorVirtualPagePathStep {
  /** Static confidence attached to the authored render edge. */
  readonly certainty: 'conditional' | 'confirmed';
  /** React/value-flow relationship used by the application path. */
  readonly kind: string;
  /** Local component, route, or wrapper label shown by Inspector diagnostics. */
  readonly label: string;
  /** Component-valued prop or slot crossed by this edge, when statically known. */
  readonly slotName?: string;
  /** Authored source identity retained for navigation and hot reload. */
  readonly sourcePath: string;
  /** Local HOC/styled/memo wrappers crossed by this exact step. */
  readonly wrapperNames: readonly string[];
}

/** One importable layout boundary selected from inert one-hop JSX evidence. */
export interface PreviewInspectorVirtualPageShell {
  /** Module whose selected render outcome placed this shell around or beside the route child. */
  readonly importerPath: string;
  /** Exact component export imported by the generated VirtualPage module. */
  readonly root: PreviewInspectorPageCandidate['root'];
  /**
   * Static composition relationship retained for diagnostics and runtime placement.
   *
   * `owner` is a proven corridor component that already renders the inner route itself. It runs as
   * an authentic page root and falls back to the next inner frame only when it throws.
   */
  readonly relation: 'owner' | 'sibling' | 'wrapper';
  /**
   * Sibling position around the selected page slot. Wrappers omit this and contain the whole group.
   */
  readonly placement?: 'after' | 'before';
}

/**
 * JSON-safe recipe emitted beside a generated VirtualPage loader.
 *
 * `authoredRoot` remains the statically proven application-side root. `contentRoot` is the smaller
 * executable checkpoint that can render without running unrelated application initialization.
 */
export interface PreviewInspectorVirtualPageRecipe {
  /** Proven outer root that would normally own the complete authored application flow. */
  readonly authoredRoot: PreviewInspectorPageCandidate['root'];
  /** Number of outer render steps intentionally represented as static composition evidence. */
  readonly bypassedStepCount: number;
  /** Real component module imported as the live VirtualPage body. */
  readonly contentRoot: PreviewInspectorPageCandidate['root'];
  /** Stable strategy label consumed by browser diagnostics and regression logs. */
  readonly mode: PreviewInspectorVirtualPageMode;
  /** Outer-to-inner application steps between the authored root and live content checkpoint. */
  readonly omittedOuterPath: readonly PreviewInspectorVirtualPagePathStep[];
  /** Static render-path identity shared by authored and content roots, when available. */
  readonly renderPathId?: string;
  /** Outer-to-inner layout components composed around the live page body. */
  readonly shells: readonly PreviewInspectorVirtualPageShell[];
}

/** Build-time pairing used by the root source generator. */
export interface PreviewInspectorVirtualPageCandidate {
  /** Highest-ranked authored application candidate that supplied path provenance. */
  readonly authoredCandidate: PreviewInspectorPageCandidate;
  /** Browser-facing candidate whose root and props describe the executable VirtualPage body. */
  readonly browserCandidate: PreviewInspectorPageCandidate;
  /** Candidate imported by the generated VirtualPage module. */
  readonly contentCandidate: PreviewInspectorPageCandidate;
  /** Serializable VirtualPage composition recipe. */
  readonly recipe: PreviewInspectorVirtualPageRecipe;
}

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
): readonly PreviewInspectorVirtualPageCandidate[] {
  const boundedMaximum = Math.max(1, Math.floor(maximumCount));
  const emissions: {
    readonly authoredCandidate: PreviewInspectorPageCandidate;
    readonly contentCandidate: PreviewInspectorPageCandidate;
    readonly emittedKey: string;
    readonly recipe: PreviewInspectorVirtualPageRecipe;
  }[] = [];
  const emittedKeys = new Set<string>();

  for (const authoredCandidate of candidates) {
    const contentCandidate = selectPreviewInspectorVirtualPageContentCandidate(
      candidates,
      authoredCandidate,
    );
    const recipe = createVirtualPageRecipe(
      authoredCandidate,
      contentCandidate,
      shallowVisualPaths,
      candidates,
    );
    const emittedKey = createVirtualPageEmissionKey(authoredCandidate, contentCandidate);
    if (emittedKeys.has(emittedKey)) continue;
    emittedKeys.add(emittedKey);
    emissions.push({ authoredCandidate, contentCandidate, emittedKey, recipe });
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
        ),
        contentCandidate: emission.contentCandidate,
        recipe: emission.recipe,
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
): PreviewInspectorPageCandidate {
  if (isFrameworkComposedCandidate(authoredCandidate)) return authoredCandidate;
  if (routeSelectionDescribesSelectedSurface(authoredCandidate)) {
    const routeOwner = selectPreviewInspectorRouteOwnerCandidate(candidates, authoredCandidate);
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

  return (
    samePathCandidates
      .map((candidate, discoveryIndex) => ({
        candidate,
        discoveryIndex,
        score: scoreVirtualPageContent(candidate, authoredCandidate),
      }))
      .sort(
        (left, right) => right.score - left.score || left.discoveryIndex - right.discoveryIndex,
      )[0]?.candidate ?? authoredCandidate
  );
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
): boolean {
  const location = readPreviewInspectorGenericRouteLocation(authoredCandidate.routeLocation);
  const componentSourcePath = location?.componentSourcePath;
  if (componentSourcePath === undefined) return true;
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
    replacedAuthoredRoot && !routeSelectionDescribesSelectedSurface(authoredCandidate)
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

/** Narrows framework filesystem locations away from generic route-catalog-only metadata. */
function readPreviewInspectorGenericRouteLocation(
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
): PreviewInspectorRouteLocation | undefined {
  return routeLocation?.evidenceKind === 'route-catalog' ||
    routeLocation?.evidenceKind === 'route-jsx'
    ? routeLocation
    : undefined;
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
  return mounts.find(
    (mount) =>
      path.normalize(mount.sourcePath) === contentPath &&
      mount.exportName === contentRoot.exportName,
  );
}

/** Serializes the outer path skipped by the live page checkpoint. */
function createVirtualPageRecipe(
  authoredCandidate: PreviewInspectorPageCandidate,
  contentCandidate: PreviewInspectorPageCandidate,
  shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[],
  pageCandidates: readonly PreviewInspectorPageCandidate[],
): PreviewInspectorVirtualPageRecipe {
  const renderPath = authoredCandidate.renderPath ?? contentCandidate.renderPath;
  const authoredStepIndex = authoredCandidate.rootStepIndex;
  const contentStepIndex = resolveVirtualPageRecipeStepIndex(contentCandidate, renderPath);
  const outerStart =
    contentStepIndex === undefined ? 0 : Math.max(0, Math.floor(contentStepIndex) + 1);
  const outerEnd =
    authoredStepIndex === undefined
      ? (renderPath?.steps.length ?? 0)
      : Math.max(outerStart, Math.floor(authoredStepIndex) + 1);
  const omittedOuterPath = (renderPath?.steps.slice(outerStart, outerEnd) ?? [])
    .slice()
    .reverse()
    .map((step) =>
      Object.freeze({
        certainty: step.certainty,
        kind: step.kind,
        label: step.label,
        ...(step.invocation?.slotName === undefined ? {} : { slotName: step.invocation.slotName }),
        sourcePath: step.sourcePath,
        wrapperNames: Object.freeze([...step.wrapperNames]),
      }),
    );
  const mode = readVirtualPageMode(authoredCandidate, contentCandidate);
  const shells =
    mode === 'static-page-checkpoint'
      ? collectVirtualPageShells(
          omittedOuterPath,
          contentCandidate,
          shallowVisualPaths,
          pageCandidates,
        )
      : Object.freeze([]);
  return Object.freeze({
    authoredRoot: authoredCandidate.root,
    bypassedStepCount: omittedOuterPath.length,
    contentRoot: contentCandidate.root,
    mode,
    omittedOuterPath: Object.freeze(omittedOuterPath),
    ...(renderPath?.id === undefined ? {} : { renderPathId: renderPath.id }),
    shells,
  });
}

/**
 * Recovers a route-promoted content checkpoint's exact boundary without publishing a stale root
 * index on the derived browser candidate. A promoted leaf intentionally drops `rootStepIndex`, but
 * its unique source can still occur on the same immutable render path. Treating that missing index
 * as zero misclassifies target-side descendants as outer shells and nests the complete page inside
 * its own content slot.
 */
function resolveVirtualPageRecipeStepIndex(
  candidate: PreviewInspectorPageCandidate,
  renderPath: PreviewInspectorPageCandidate['renderPath'],
): number | undefined {
  if (candidate.rootStepIndex !== undefined) return candidate.rootStepIndex;
  const normalizedRootPath = path.normalize(candidate.root.sourcePath);
  const routeLocation = readPreviewInspectorGenericRouteLocation(candidate.routeLocation);
  if (
    routeLocation?.componentSourcePath === undefined ||
    path.normalize(routeLocation.componentSourcePath) !== normalizedRootPath ||
    (routeLocation.componentExportName ?? 'default') !== candidate.root.exportName
  ) {
    return undefined;
  }
  const matchingIndexes = (renderPath?.steps ?? []).flatMap((step, index) =>
    path.normalize(step.sourcePath) === normalizedRootPath ? [index] : [],
  );
  return matchingIndexes.length === 1 ? matchingIndexes[0] : undefined;
}

/**
 * Selects the complete, statically proven JSX frame around the omitted corridor modules.
 *
 * Ordinary wrappers, siblings, and component slots from the same exact return are retained, allowing
 * Header, Sidebar, navigation, toolbars, and overlays to keep their authored descendants. Provider,
 * Context, Router, Route, and Boundary values are not independently reproducible here because the
 * shallow path does not retain their authored props or member access; runtime infrastructure owns
 * those boundaries instead. Static route alternatives and explicit fallback siblings remain
 * excluded. The transitive corridor plugin follows each admitted component by module/export
 * identity, so this broadens visible page composition without restoring application-wide route
 * registries.
 */
function collectVirtualPageShells(
  omittedOuterPath: readonly PreviewInspectorVirtualPagePathStep[],
  contentCandidate: PreviewInspectorPageCandidate,
  shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[],
  pageCandidates: readonly PreviewInspectorPageCandidate[],
): readonly PreviewInspectorVirtualPageShell[] {
  const outerIndexBySource = new Map(
    omittedOuterPath.map((step, index) => [path.normalize(step.sourcePath), index]),
  );
  const contentPath = path.normalize(contentCandidate.root.sourcePath);
  const structuralOwnerStep = findNearestVirtualPageStructuralOwner(
    omittedOuterPath,
    shallowVisualPaths,
    contentPath,
    contentCandidate.routeLocation,
    contentCandidate,
    pageCandidates,
  );
  const ownerSteps = omittedOuterPath.filter(
    (step) => isVirtualPageOwnerStep(step) || step === structuralOwnerStep,
  );
  const ownerSourcePaths = new Set(ownerSteps.map((step) => path.normalize(step.sourcePath)));
  const competingPageRootKeys = new Set(
    pageCandidates
      .filter(
        (candidate) =>
          path.normalize(candidate.root.sourcePath) !== contentPath ||
          candidate.root.exportName !== contentCandidate.root.exportName,
      )
      .map((candidate) => createVirtualPageRootKey(candidate.root)),
  );
  const ambiguousFrameImporters = collectAmbiguousVisualFrameImporters(
    shallowVisualPaths,
    outerIndexBySource,
  );
  const ranked = shallowVisualPaths
    .filter((visualPath) => {
      if (visualPath.relation !== 'wrapper' && visualPath.relation !== 'sibling') {
        return false;
      }
      if (!isPreviewInspectorSafeShallowVisualBinding(visualPath.renderedLocalName)) return false;
      if (path.normalize(visualPath.sourcePath) === contentPath) return false;
      /*
       * The live content export already executes wrappers and siblings authored in its own module.
       * Re-composing them around that export duplicates provider/layout boundaries and can route a
       * healthy page into its fallback path even though the target component mounted correctly.
       */
      if (path.normalize(visualPath.importerPath) === contentPath) return false;
      if (!outerIndexBySource.has(path.normalize(visualPath.importerPath))) return false;
      /*
       * An authentic owner already renders every sibling in its own JSX. Re-composing those same
       * imports outside the owner would duplicate navigation and headers around its child slot.
       */
      if (ownerSourcePaths.has(path.normalize(visualPath.importerPath))) return false;
      /*
       * Route factories and page catalogs often expose every page component through one callback or
       * object owner. In incomplete syntax evidence those mutually exclusive entries can look like
       * ordinary siblings. A VirtualPage may retain Header/Sidebar siblings, but it must never stack
       * another page endpoint beside the selected page; that endpoint remains a separate candidate.
       */
      if (
        visualPath.relation === 'sibling' &&
        isCompetingVisualPageSibling(visualPath, competingPageRootKeys)
      ) {
        return false;
      }
      if (
        visualPath.relation !== 'wrapper' &&
        ambiguousFrameImporters.has(path.normalize(visualPath.importerPath))
      ) {
        return false;
      }
      return visualPath.relation === 'wrapper' || !isFallbackVisualSibling(visualPath);
    })
    .map((visualPath, discoveryIndex) => {
      const relation =
        visualPath.relation === 'wrapper' || isVisualPageFrame(visualPath) ? 'wrapper' : 'sibling';
      const placement =
        relation === 'sibling' &&
        visualPath.selectedOccurrenceStart !== undefined &&
        visualPath.occurrenceStart > visualPath.selectedOccurrenceStart
          ? 'after'
          : 'before';
      return {
        discoveryIndex,
        importerIndex: outerIndexBySource.get(path.normalize(visualPath.importerPath)) ?? 0,
        placement,
        relation,
        visualPath,
      } as const;
    })
    .sort(
      (left, right) =>
        left.importerIndex - right.importerIndex ||
        (left.relation === 'wrapper' ? -1 : 1) - (right.relation === 'wrapper' ? -1 : 1) ||
        (left.placement === 'before' ? -1 : 1) - (right.placement === 'before' ? -1 : 1) ||
        (left.placement === 'after'
          ? right.visualPath.occurrenceStart - left.visualPath.occurrenceStart
          : left.visualPath.occurrenceStart - right.visualPath.occurrenceStart) ||
        left.discoveryIndex - right.discoveryIndex,
    );
  const shells: PreviewInspectorVirtualPageShell[] = [];
  const emitted = new Set<string>();

  /*
   * A layout can be the selected corridor node itself rather than a one-hop sibling. Retain that
   * authored module before sibling shells so Header/Sidebar imports beneath RootLayout remain part
   * of the generated source. Prefer the public export already proven for this exact render-path
   * step; the component-shaped label remains a fallback only when no checkpoint proved a binding.
   */
  for (const step of ownerSteps) {
    const root = resolveVirtualPageOwnerRoot(step, contentCandidate, pageCandidates);
    const key = `${path.normalize(root.sourcePath)}\0${root.exportName}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    shells.push(
      Object.freeze({
        importerPath: step.sourcePath,
        relation: 'owner',
        root,
      }),
    );
  }

  for (const { placement, relation, visualPath } of ranked) {
    const key = `${path.normalize(visualPath.sourcePath)}\0${visualPath.exportName}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    shells.push(
      Object.freeze({
        importerPath: visualPath.importerPath,
        ...(relation === 'sibling' ? { placement } : {}),
        relation,
        root: Object.freeze({
          exportName: visualPath.exportName,
          sourcePath: visualPath.sourcePath,
        }),
      }),
    );
  }
  return Object.freeze(
    shells.sort(
      (left, right) =>
        (outerIndexBySource.get(path.normalize(left.importerPath)) ?? Number.MAX_SAFE_INTEGER) -
        (outerIndexBySource.get(path.normalize(right.importerPath)) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

/** Creates one normalized component identity for route-page de-duplication. */
function createVirtualPageRootKey(root: PreviewInspectorPageCandidate['root']): string {
  return `${path.normalize(root.sourcePath)}\0${root.exportName}`;
}

/**
 * Identifies a mutually exclusive page endpoint without confusing PageHeader or PageAction chrome.
 *
 * Exact candidate identity is the strongest evidence. The suffix fallback covers lazy/barrel route
 * catalogs where the checkpoint points at a concrete implementation but one-hop evidence still
 * references the named re-export. Only sibling relations use this rule; a page-shaped component
 * proven to wrap the selected child remains authored composition.
 */
function isCompetingVisualPageSibling(
  visualPath: PreviewInspectorOneHopVisualPath,
  competingPageRootKeys: ReadonlySet<string>,
): boolean {
  if (
    competingPageRootKeys.has(
      createVirtualPageRootKey({
        exportName: visualPath.exportName,
        sourcePath: visualPath.sourcePath,
      }),
    )
  ) {
    return true;
  }
  const sourceStem = path.basename(visualPath.sourcePath).replace(/\.[^.]+$/u, '');
  return [visualPath.exportName, visualPath.renderedLocalName, sourceStem].some(
    hasPageEndpointSuffix,
  );
}

/** Matches only a final page-role word so PageHeader, PageAction, and PageLayout remain visible. */
function hasPageEndpointSuffix(identity: string): boolean {
  const separated = identity
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  const finalToken = separated
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .at(-1);
  return finalToken === 'page' || finalToken === 'screen' || finalToken === 'view';
}

/** Recognizes corridor components safe and useful enough to execute as complete page owners. */
function isVirtualPageOwnerStep(step: PreviewInspectorVirtualPagePathStep): boolean {
  const tokens = tokenizeComponentIdentity(`${step.label} ${path.basename(step.sourcePath)}`);
  return hasAnyToken(tokens, ['layout', 'shell', 'frame', 'scaffold', 'chrome']);
}

/**
 * Finds the nearest route owner whose source owns the page's authentic visual frame.
 *
 * Some application factories receive their page catalog in one argument and a JSX-producing
 * callback in another. Static one-hop evidence then sees the selected page and callback layout as
 * component slots owned by the same exported value. Flattening those slots loses injected routes
 * and passes a ReactNode where receivers expect `children()`; executing the exact corridor owner
 * preserves both contracts. A route catalog can also flatten its callback layout into a sibling
 * frame because the selected child arrives through an injected route collection. Mounting that
 * frame alone would bypass local provider/HOC boundaries in the route-owner source and leave its
 * navigation or overlay descendants without context. Only the innermost proven route owner is
 * selected so outer app bootstraps do not re-enter expensive or unrelated route registries.
 */
function findNearestVirtualPageStructuralOwner(
  omittedOuterPath: readonly PreviewInspectorVirtualPagePathStep[],
  visualPaths: readonly PreviewInspectorOneHopVisualPath[],
  contentPath: string,
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
  contentCandidate: PreviewInspectorPageCandidate,
  pageCandidates: readonly PreviewInspectorPageCandidate[],
): PreviewInspectorVirtualPagePathStep | undefined {
  const genericRouteLocation = readPreviewInspectorGenericRouteLocation(routeLocation);
  const exactRouteOwnerSourcePath = genericRouteLocation?.sourcePath;
  if (exactRouteOwnerSourcePath !== undefined) {
    const normalizedExactRouteOwnerSourcePath = path.normalize(exactRouteOwnerSourcePath);
    const renderPathId = contentCandidate.renderPath?.id;
    const provenStepKeys = new Set(
      pageCandidates.flatMap((candidate) => {
        if (path.normalize(candidate.root.sourcePath) !== normalizedExactRouteOwnerSourcePath) {
          return [];
        }
        if (renderPathId !== undefined && candidate.renderPath?.id !== renderPathId) return [];
        const rootStepIndex = candidate.rootStepIndex;
        if (rootStepIndex === undefined) return [];
        const rootStep = candidate.renderPath?.steps[rootStepIndex];
        if (
          rootStep === undefined ||
          path.normalize(rootStep.sourcePath) !== normalizedExactRouteOwnerSourcePath
        ) {
          return [];
        }
        return [`${normalizedExactRouteOwnerSourcePath}\0${rootStep.label}`];
      }),
    );
    const exactRouteOwner = [...omittedOuterPath]
      .reverse()
      .find((step) => provenStepKeys.has(`${path.normalize(step.sourcePath)}\0${step.label}`));
    if (exactRouteOwner !== undefined) return exactRouteOwner;
  }
  const corridorSourcePaths = new Set([
    contentPath,
    ...omittedOuterPath.map((step) => path.normalize(step.sourcePath)),
  ]);
  const renderCallbackImporters = new Set(
    visualPaths
      .filter(
        (visualPath) =>
          visualPath.relation === 'component-prop' && visualPath.invocation?.mode === 'render-prop',
      )
      .map((visualPath) => path.normalize(visualPath.importerPath)),
  );
  const structuralFramesByImporter = new Map<string, PreviewInspectorOneHopVisualPath[]>();
  for (const visualPath of visualPaths) {
    if (
      visualPath.relation !== 'sibling' ||
      !isVisualPageFrame(visualPath) ||
      !corridorSourcePaths.has(path.normalize(visualPath.selectedChildPath))
    ) {
      continue;
    }
    const importerPath = path.normalize(visualPath.importerPath);
    const frames = structuralFramesByImporter.get(importerPath) ?? [];
    frames.push(visualPath);
    structuralFramesByImporter.set(importerPath, frames);
  }
  return [...omittedOuterPath].reverse().find((step) => {
    if (step.kind !== 'route-branch') return false;
    const sourcePath = path.normalize(step.sourcePath);
    if (renderCallbackImporters.has(sourcePath)) return true;
    const ownerName = inferVirtualPagePathShellExportName(step.label);
    return (structuralFramesByImporter.get(sourcePath) ?? []).some(
      (visualPath) => visualPath.renderedLocalName !== ownerName,
    );
  });
}

/**
 * Finds route/config owners that expose several competing layout components as flat siblings.
 *
 * An exact JSX ancestor is classified as `wrapper` and never enters this ambiguity set. Two or
 * more sibling-shaped frames from one owner instead indicate a route catalog or fallback table;
 * choosing all of them would stack mutually exclusive pages around the selected content.
 */
function collectAmbiguousVisualFrameImporters(
  visualPaths: readonly PreviewInspectorOneHopVisualPath[],
  outerIndexBySource: ReadonlyMap<string, number>,
): ReadonlySet<string> {
  const frameKeysByImporter = new Map<string, Set<string>>();
  for (const visualPath of visualPaths) {
    const importerPath = path.normalize(visualPath.importerPath);
    if (
      visualPath.relation !== 'sibling' ||
      !outerIndexBySource.has(importerPath) ||
      !isVisualPageFrame(visualPath)
    ) {
      continue;
    }
    const frameKeys = frameKeysByImporter.get(importerPath) ?? new Set<string>();
    frameKeys.add(`${path.normalize(visualPath.sourcePath)}\0${visualPath.exportName}`);
    frameKeysByImporter.set(importerPath, frameKeys);
  }
  return new Set(
    [...frameKeysByImporter]
      .filter(([, frameKeys]) => frameKeys.size > 1)
      .map(([importerPath]) => importerPath),
  );
}

/** Recognizes a single page-frame component without relying on a project or package identity. */
function isVisualPageFrame(visualPath: PreviewInspectorOneHopVisualPath): boolean {
  const tokens = tokenizeComponentIdentity(
    `${visualPath.exportName} ${visualPath.renderedLocalName} ${path.basename(visualPath.sourcePath)}`,
  );
  return hasAnyToken(tokens, ['layout', 'shell', 'frame', 'scaffold', 'chrome']);
}

/**
 * Excludes only explicit alternate-state surfaces from sibling composition.
 *
 * The check uses complete semantic tokens rather than project paths or package names. A fallback
 * nested as an actual wrapper is still retained because it may be the project's error boundary;
 * only a sibling alternate that would replace the normal page is omitted.
 */
function isFallbackVisualSibling(visualPath: PreviewInspectorOneHopVisualPath): boolean {
  const tokens = tokenizeComponentIdentity(
    `${visualPath.exportName} ${visualPath.renderedLocalName} ${path.basename(visualPath.sourcePath)}`,
  );
  return hasAnyToken(tokens, [
    'error',
    'fallback',
    'loading',
    'loader',
    'notfound',
    'pending',
    'redirect',
    'skeleton',
  ]);
}

/** Infers an import demand from a render-path label while preserving a safe default fallback. */
function inferVirtualPagePathShellExportName(label: string): string {
  const normalized = label.trim().replace(/^<|>$/gu, '');
  if (normalized === 'default' || normalized === '@default') return 'default';
  const finalSegment = normalized.split('.').at(-1) ?? '';
  return /^[A-Za-z_$][\w$]*$/u.test(finalSegment) ? finalSegment : 'default';
}

/**
 * Reuses the importable export recovered for the exact corridor step instead of treating its local
 * JSX label as a module export. This is what maps `import RootLayout from './RootLayout'` back to the
 * module's real `default` binding while keeping ambiguous, unproven labels on the legacy fallback.
 */
function resolveVirtualPageOwnerRoot(
  step: PreviewInspectorVirtualPagePathStep,
  contentCandidate: PreviewInspectorPageCandidate,
  pageCandidates: readonly PreviewInspectorPageCandidate[],
): PreviewInspectorPageCandidate['root'] {
  const inferredExportName = inferVirtualPagePathShellExportName(step.label);
  const sourcePath = path.normalize(step.sourcePath);
  const renderPathId = contentCandidate.renderPath?.id;
  const provenRoots = pageCandidates
    .filter((candidate) => {
      if (path.normalize(candidate.root.sourcePath) !== sourcePath) return false;
      if (renderPathId !== undefined && candidate.renderPath?.id !== renderPathId) return false;
      if (candidate.rootStepIndex === undefined) return false;
      const candidateStep = candidate.renderPath?.steps[candidate.rootStepIndex];
      return (
        candidateStep !== undefined &&
        path.normalize(candidateStep.sourcePath) === sourcePath &&
        candidateStep.label === step.label
      );
    })
    .map((candidate) => candidate.root);
  const exactRoot = provenRoots.find((root) => root.exportName === inferredExportName);
  const distinctExportNames = new Set(provenRoots.map((root) => root.exportName));
  const provenRoot = exactRoot ?? (distinctExportNames.size === 1 ? provenRoots[0] : undefined);
  return Object.freeze({
    exportName: provenRoot?.exportName ?? inferredExportName,
    sourcePath: step.sourcePath,
  });
}

/** Produces a stable de-duplication key without conflating independent application entries. */
function createVirtualPageEmissionKey(
  authoredCandidate: PreviewInspectorPageCandidate,
  contentCandidate: PreviewInspectorPageCandidate,
): string {
  return [
    authoredCandidate.renderPath?.id ?? authoredCandidate.id,
    path.normalize(contentCandidate.root.sourcePath),
    contentCandidate.root.exportName,
    authoredCandidate.routeLocation?.componentName ?? '',
    authoredCandidate.routeLocation?.pattern ?? '',
  ].join('\0');
}

/** Scores page roles and dependency safety without using any project-specific identifier. */
function scoreVirtualPageContent(
  candidate: PreviewInspectorPageCandidate,
  authoredCandidate: PreviewInspectorPageCandidate,
): number {
  const sourceName = path.basename(candidate.root.sourcePath);
  const sourceStem = sourceName.replace(/\.[^.]+$/u, '');
  const stepLabel =
    candidate.rootStepIndex === undefined
      ? ''
      : (candidate.renderPath?.steps[candidate.rootStepIndex]?.label ?? '');
  const tokens = tokenizeComponentIdentity(
    `${candidate.root.exportName} ${sourceStem} ${stepLabel}`,
  );
  let score = 0;

  if (hasAnyToken(tokens, ['page', 'screen', 'view'])) score += 20_000;
  else if (hasAnyToken(tokens, ['form', 'wizard'])) score += 14_000;
  else if (hasAnyToken(tokens, ['panel', 'section', 'modal', 'dialog'])) score += 8_000;
  if (hasAnyToken(tokens, ['app', 'application', 'router', 'route'])) score -= 18_000;
  if (hasAnyToken(tokens, ['entry', 'layout', 'shell', 'frame', 'root'])) score -= 12_000;
  if (candidate.stopReason === 'render-path-checkpoint') score += 2_000;
  if (/\.[cm]?[jt]sx$/iu.test(sourceName)) score += 1_500;
  if (/^index\.[cm]?[jt]sx?$/iu.test(sourceName)) score -= 5_000;
  if (candidate.rootStepIndex !== undefined) {
    // Inner-to-outer indices make a smaller checkpoint cheaper once semantic roles tie.
    score -= Math.min(1_000, Math.max(0, candidate.rootStepIndex) * 20);
  }
  if (
    path.normalize(candidate.root.sourcePath) ===
      path.normalize(authoredCandidate.root.sourcePath) &&
    candidate.root.exportName === authoredCandidate.root.exportName
  ) {
    // Keep the authored root when no materially safer page checkpoint exists.
    score += 250;
  }
  return score;
}

/** Splits PascalCase, kebab-case, snake_case, and path-like names into comparable role tokens. */
function tokenizeComponentIdentity(identity: string): ReadonlySet<string> {
  const separated = identity
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  return new Set(
    separated
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/** Returns true when one semantic role token is present as a complete word. */
function hasAnyToken(tokens: ReadonlySet<string>, expected: readonly string[]): boolean {
  return expected.some((token) => tokens.has(token));
}

/** Identifies framework candidates whose existing loader already generates a VirtualPage recipe. */
function isFrameworkComposedCandidate(candidate: PreviewInspectorPageCandidate): boolean {
  return (
    candidate.routeLocation?.evidenceKind === 'next-app-filesystem' ||
    candidate.nextPagesShell !== undefined
  );
}

/** Assigns the browser-visible composition strategy. */
function readVirtualPageMode(
  authoredCandidate: PreviewInspectorPageCandidate,
  contentCandidate: PreviewInspectorPageCandidate,
): PreviewInspectorVirtualPageMode {
  if (contentCandidate.routeLocation?.evidenceKind === 'next-app-filesystem') {
    return 'next-app-filesystem';
  }
  if (contentCandidate.nextPagesShell !== undefined) return 'next-pages-filesystem';
  return contentCandidate === authoredCandidate ? 'authored-root' : 'static-page-checkpoint';
}
