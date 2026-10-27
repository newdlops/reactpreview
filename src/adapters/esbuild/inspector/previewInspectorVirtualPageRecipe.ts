/** Builds exact shell recipes and resolves structural owner steps. */
import path from 'node:path';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocationTypes';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';
import type {
  PreviewInspectorVirtualPagePathStep,
  PreviewInspectorVirtualPageRecipe,
  PreviewInspectorVirtualPageShell,
} from './previewInspectorVirtualPageModel';
import {
  hasAnyToken,
  readVirtualPageMode,
  readVirtualPageIdentityTokens,
} from './previewInspectorVirtualPageScoring';
import { isPreviewInspectorSafeShallowVisualBinding } from './previewInspectorVisualBinding';

/** Narrows framework filesystem locations away from generic route-catalog-only metadata. */
export function readPreviewInspectorGenericRouteLocation(
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
): PreviewInspectorRouteLocation | undefined {
  return routeLocation?.evidenceKind === 'route-catalog' ||
    routeLocation?.evidenceKind === 'route-jsx'
    ? routeLocation
    : undefined;
}

/** Serializes the outer path skipped by the live page checkpoint. */
export function createVirtualPageRecipe(
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
 * its route identity can still locate the implementation on the same immutable render path, even
 * when a barrel owns the public route export and the implementation module also contains local
 * page components. Treating that missing index as zero misclassifies target-side descendants as
 * outer shells and nests the complete page inside its own content slot.
 */
export function resolveVirtualPageRecipeStepIndex(
  candidate: PreviewInspectorPageCandidate,
  renderPath: PreviewInspectorPageCandidate['renderPath'],
): number | undefined {
  if (candidate.rootStepIndex !== undefined) return candidate.rootStepIndex;
  const normalizedRootPath = path.normalize(candidate.root.sourcePath);
  const routeLocation = readPreviewInspectorGenericRouteLocation(candidate.routeLocation);
  if (routeLocation === undefined || renderPath === undefined) return undefined;
  const matchingIndexes = renderPath.steps.flatMap((step, index) =>
    path.normalize(step.sourcePath) === normalizedRootPath ? [index] : [],
  );
  const routeIdentityNames = new Set(
    [routeLocation.componentName, routeLocation.componentExportName].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );
  const matchesRouteIdentity = (step: (typeof renderPath.steps)[number]): boolean =>
    routeIdentityNames.has(step.label) ||
    (step.invocation?.calleeName !== undefined &&
      routeIdentityNames.has(step.invocation.calleeName));
  const routeComponentSourcePaths = new Set(
    [routeLocation.componentSourcePath, ...(routeLocation.componentSourcePaths ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => path.normalize(value)),
  );
  const rootIsPublishedRouteSurface = routeComponentSourcePaths.has(normalizedRootPath);
  const routeBarrelIdentityProven = renderPath.steps.some(
    (step) =>
      routeComponentSourcePaths.has(path.normalize(step.sourcePath)) && matchesRouteIdentity(step),
  );
  const routeComponentIndexes = matchingIndexes.filter((index) => {
    const step = renderPath.steps[index];
    return step !== undefined && matchesRouteIdentity(step);
  });
  if (
    routeComponentIndexes.length === 1 &&
    (rootIsPublishedRouteSurface || routeBarrelIdentityProven)
  ) {
    return routeComponentIndexes[0];
  }
  if (rootIsPublishedRouteSurface && candidate.root.exportName !== 'default') {
    const exportIndexes = matchingIndexes.filter((index) => {
      const step = renderPath.steps[index];
      return (
        step?.label === candidate.root.exportName ||
        step?.invocation?.calleeName === candidate.root.exportName
      );
    });
    if (exportIndexes.length === 1) return exportIndexes[0];
  }
  return rootIsPublishedRouteSurface &&
    (routeLocation.componentExportName ?? 'default') === candidate.root.exportName &&
    matchingIndexes.length === 1
    ? matchingIndexes[0]
    : undefined;
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
export function collectVirtualPageShells(
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
export function createVirtualPageRootKey(root: PreviewInspectorPageCandidate['root']): string {
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
export function isCompetingVisualPageSibling(
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
export function hasPageEndpointSuffix(identity: string): boolean {
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
export function isVirtualPageOwnerStep(step: PreviewInspectorVirtualPagePathStep): boolean {
  const tokens = readVirtualPageIdentityTokens(
    step,
    `${step.label} ${path.basename(step.sourcePath)}`,
  );
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
export function findNearestVirtualPageStructuralOwner(
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
export function collectAmbiguousVisualFrameImporters(
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
export function isVisualPageFrame(visualPath: PreviewInspectorOneHopVisualPath): boolean {
  const tokens = readVirtualPageIdentityTokens(
    visualPath,
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
export function isFallbackVisualSibling(visualPath: PreviewInspectorOneHopVisualPath): boolean {
  const tokens = readVirtualPageIdentityTokens(
    visualPath,
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
export function inferVirtualPagePathShellExportName(label: string): string {
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
export function resolveVirtualPageOwnerRoot(
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
