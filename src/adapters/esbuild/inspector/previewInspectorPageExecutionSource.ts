/* eslint-disable jsdoc/require-jsdoc */
/** Generates an exact-edge Page Execution Slice React root. */
import path from 'node:path';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { createPreviewInspectorPageSurfaceSpecifier } from './previewInspectorPageExecutionPlugin';
import { PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER } from './previewInspectorTargetPlugin';
import {
  PREVIEW_INSPECTOR_PAGE_ROUTE_STATE_SPECIFIER,
  shouldInstallPreviewInspectorPageRouteStatePrelude,
} from './previewInspectorPageRouteStatePrelude';
import { createPreviewInspectorRouteExecutionRuntimeSource } from './previewInspectorRouteExecutionRuntimeSource';
import type {
  PreviewInspectorMountSurface,
  PreviewInspectorPageCompositionEdge,
  PreviewInspectorPageExecutionCandidate,
} from './previewInspectorPageExecutionTypes';
import type { PreviewInspectorExecutionRootModuleContract } from './previewInspectorExecutionRootModuleContract';
import type { PreviewInspectorTargetModuleContract } from './previewInspectorTargetModuleContract';

export interface CreatePreviewInspectorPageExecutionSourceOptions {
  readonly candidate: PreviewInspectorPageExecutionCandidate;
  readonly executionRootModuleContract: PreviewInspectorExecutionRootModuleContract;
  readonly target: { readonly exportName: string; readonly sourcePath: string };
  readonly targetModuleContract?: PreviewInspectorTargetModuleContract;
}

/**
 * Emits a source-only React root. Surface imports are virtual only for selected/local slices;
 * authentic surfaces preserve their authored module export. Composition fails closed to a single
 * surface when an edge is incomplete, rather than injecting guessed children into a wrapper.
 */
export function createPreviewInspectorPageExecutionSource(
  options: CreatePreviewInspectorPageExecutionSourceOptions,
): string {
  const surfaces = options.candidate.criticalSurfaces;
  const imports = surfaces.map((surface, index) =>
    createSurfaceImport(
      surface,
      index,
      options.candidate.executionRootSurfaceId,
      options.candidate.runtimeTargetSurfaceId,
      options.executionRootModuleContract,
      options.target,
      options.targetModuleContract,
    ),
  );
  const localById = new Map(
    surfaces.map((surface, index) => [surface.id, `Surface${index.toString()}`]),
  );
  const childrenByParent = new Map<string, PreviewInspectorPageCompositionEdge[]>();
  const childIds = new Set<string>();
  for (const edge of options.candidate.compositionEdges) {
    if (!localById.has(edge.parentSurfaceId) || !localById.has(edge.childSurfaceId)) continue;
    const list = childrenByParent.get(edge.parentSurfaceId) ?? [];
    list.push(edge);
    childrenByParent.set(edge.parentSurfaceId, list);
    if (edge.mode !== 'contains-authored-child') childIds.add(edge.childSurfaceId);
  }
  const root = surfaces.find((surface) => surface.id === options.candidate.executionRootSurfaceId);
  if (root === undefined)
    return 'export default function PreviewInspectorPageExecution() { return null; }';
  const compositionRoot = surfaces.find((surface) => !childIds.has(surface.id)) ?? root;
  const render = (surfaceId: string, active: Set<string>): string => {
    const local = localById.get(surfaceId);
    if (local === undefined || active.has(surfaceId)) return 'null';
    active.add(surfaceId);
    const edges = [...(childrenByParent.get(surfaceId) ?? [])].sort(
      (left, right) =>
        left.placementIndex - right.placementIndex ||
        left.childSurfaceId.localeCompare(right.childSurfaceId),
    );
    const authoredChild = edges.some((edge) => edge.mode === 'contains-authored-child');
    const before = edges
      .filter((edge) => edge.mode === 'sibling-before')
      .map((edge) => render(edge.childSurfaceId, new Set(active)));
    const after = edges
      .filter((edge) => edge.mode === 'sibling-after')
      .map((edge) => render(edge.childSurfaceId, new Set(active)));
    const slot = edges.find(
      (edge) =>
        edge.mode !== 'contains-authored-child' &&
        edge.mode !== 'sibling-before' &&
        edge.mode !== 'sibling-after',
    );
    let current = `React.createElement(${local}, null)`;
    if (!authoredChild && slot !== undefined) {
      const child = render(slot.childSurfaceId, new Set(active));
      current = composeEdge(local, slot, child, current, options.candidate.routeRecipe);
    }
    active.delete(surfaceId);
    return before.length === 0 && after.length === 0
      ? current
      : `React.createElement(React.Fragment, null, ${[...before, current, ...after].join(', ')})`;
  };
  const renderedRoot = render(compositionRoot.id, new Set());
  const routeRecipe = options.candidate.routeRecipe;
  const routerSurfaceIds = new Set(
    routeRecipe?.mounts
      .map((mount) => mount.parentSurfaceId)
      .filter((surfaceId): surfaceId is string => surfaceId !== undefined) ?? [],
  );
  const routerPageSurfaceId = routeRecipe?.mounts.at(-1)?.childSurfaceId;
  const routerRenderedPage =
    routerPageSurfaceId === undefined ? renderedRoot : render(routerPageSurfaceId, new Set());
  const virtualPageOwnerSurfaceId = routeRecipe?.mounts.find(
    (mount) => mount.contextOrigin === 'virtual-page-owner',
  )?.parentSurfaceId;
  const virtualPageOwnerFrameLocal = 'PreviewInspectorVirtualPageOwnerRouteFrame';
  const routerRuntime =
    routeRecipe === undefined
      ? undefined
      : createPreviewInspectorRouteExecutionRuntimeSource({
          recipe: routeRecipe,
          renderedPage: routerRenderedPage,
          routeSurfaceLocals: [...routerSurfaceIds]
            .map((surfaceId) =>
              surfaceId === virtualPageOwnerSurfaceId
                ? virtualPageOwnerFrameLocal
                : localById.get(surfaceId),
            )
            .filter((local): local is string => local !== undefined),
        });
  const virtualPageOwnerFrame =
    routerRuntime !== undefined &&
    virtualPageOwnerSurfaceId !== undefined &&
    localById.has(virtualPageOwnerSurfaceId)
      ? [`function ${virtualPageOwnerFrameLocal}() {`, `  return ${renderedRoot};`, '}']
      : [];
  const routeStatePrelude = shouldInstallPreviewInspectorPageRouteStatePrelude(routeRecipe);
  const routeElement = routerRuntime !== undefined ? routerRuntime.routeElement : renderedRoot;
  const virtualPageSourceRegistrations = createVirtualPageSourceRegistrations(
    options.candidate.optionalSurfaces,
  );
  return [
    "import React from 'react';",
    ...(routeStatePrelude
      ? [`import ${JSON.stringify(PREVIEW_INSPECTOR_PAGE_ROUTE_STATE_SPECIFIER)};`]
      : []),
    ...imports,
    ...(routerRuntime?.imports ?? []),
    ...virtualPageSourceRegistrations,
    ...virtualPageOwnerFrame,
    'export default function PreviewInspectorPageExecution() {',
    `  return ${routeElement};`,
    '}',
  ].join('\n');
}

/**
 * Registers only compiler-proven visual descendants of the selected execution surfaces.
 * Authentic frozen-frontier modules do not pass through the ordinary VirtualPage component facade,
 * so without this prelude their early-return guards cannot choose the proven child continuation.
 */
function createVirtualPageSourceRegistrations(
  optionalSurfaces: readonly PreviewInspectorMountSurface[] | undefined,
): readonly string[] {
  const sourcePaths = [
    ...new Set(
      (optionalSurfaces ?? []).map((surface) =>
        canonicalizeExistingPath(path.normalize(surface.sourcePath)),
      ),
    ),
  ].sort();
  return Object.freeze(
    sourcePaths.map(
      (sourcePath) =>
        `globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')]?.registerVirtualPageSource?.(${JSON.stringify(sourcePath)});`,
    ),
  );
}

function createSurfaceImport(
  surface: PreviewInspectorMountSurface,
  index: number,
  executionRootSurfaceId: string,
  runtimeTargetSurfaceId: string,
  executionRootModuleContract: PreviewInspectorExecutionRootModuleContract,
  target: { readonly exportName: string; readonly sourcePath: string },
  targetModuleContract: PreviewInspectorTargetModuleContract | undefined,
): string {
  const local = `Surface${index.toString()}`;
  const isExecutionRoot = surface.id === executionRootSurfaceId;
  const isRuntimeTarget = surface.id === runtimeTargetSurfaceId;
  if (
    isExecutionRoot &&
    (executionRootModuleContract.surfaceId !== surface.id ||
      canonicalizeExistingPath(path.normalize(executionRootModuleContract.sourcePath)) !==
        canonicalizeExistingPath(path.normalize(surface.sourcePath)) ||
      executionRootModuleContract.exportName !== surface.exportName)
  ) {
    throw new TypeError(
      'Page Execution root role does not match the prepared execution-root module contract.',
    );
  }
  if (
    isRuntimeTarget &&
    (path.normalize(surface.sourcePath) !== path.normalize(target.sourcePath) ||
      surface.exportName !== target.exportName)
  ) {
    throw new TypeError('Page Execution runtime target role does not match the compiler target.');
  }
  if (
    isRuntimeTarget &&
    targetModuleContract !== undefined &&
    (path.normalize(targetModuleContract.sourcePath) !== path.normalize(target.sourcePath) ||
      !targetModuleContract.selectedExportNames.includes(target.exportName))
  ) {
    throw new TypeError(
      'Page Execution runtime target role does not match the prepared target module contract.',
    );
  }
  const specifier = isRuntimeTarget
    ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
    : isExecutionRoot
      ? executionRootModuleContract.sourcePath
      : surface.strategy === 'authentic-module-export' ||
          surface.strategy === 'framework-page-surface' ||
          surface.strategy === 'selected-route-surface'
        ? surface.sourcePath
        : createPreviewInspectorPageSurfaceSpecifier(surface.id);
  if (!isRuntimeTarget && !isExecutionRoot && surface.strategy === 'selected-route-surface') {
    const namespace = `${local}Module`;
    return [
      `import * as ${namespace} from ${JSON.stringify(specifier)};`,
      `const ${local} = Reflect.get(${namespace}, ${JSON.stringify(surface.exportName)}) ?? Reflect.get(${namespace}, 'default');`,
    ].join('\n');
  }
  const bindingExportName = isExecutionRoot
    ? executionRootModuleContract.bindingExportName
    : surface.exportName;
  return bindingExportName === 'default'
    ? `import ${local} from ${JSON.stringify(specifier)};`
    : `import { ${bindingExportName} as ${local} } from ${JSON.stringify(specifier)};`;
}

function composeEdge(
  parent: string,
  edge: PreviewInspectorPageCompositionEdge,
  child: string,
  fallback: string,
  routeRecipe: PreviewInspectorPageExecutionCandidate['routeRecipe'],
): string {
  if (
    edge.mode === 'children-slot' ||
    edge.mode === 'route-outlet' ||
    edge.mode === 'next-layout-slot'
  ) {
    const properties =
      edge.mode === 'next-layout-slot' && routeRecipe?.kind === 'next-app'
        ? `{ params: ${JSON.stringify(routeRecipe.params)}, searchParams: ${JSON.stringify(routeRecipe.searchParams)} }`
        : 'null';
    return `React.createElement(${parent}, ${properties}, ${child})`;
  }
  if (edge.mode === 'component-prop-slot' && edge.slotName === 'Component')
    return `React.createElement(${parent}, { "Component": () => ${child}, "pageProps": {} })`;
  if (edge.mode === 'component-prop-slot' && edge.slotName !== undefined)
    return `React.createElement(${parent}, { ${JSON.stringify(edge.slotName)}: ${child} })`;
  if (edge.mode === 'render-prop-slot' && edge.slotName !== undefined)
    return `React.createElement(${parent}, { ${JSON.stringify(edge.slotName)}: () => ${child} })`;
  return fallback;
}
