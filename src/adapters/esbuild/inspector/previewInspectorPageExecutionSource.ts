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
import { isReactOverlayComponentName } from '../staticResources/reactOverlayVisibilityInference';
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
  const routeRecipe = options.candidate.routeRecipe;
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
  const executionRootLocal = localById.get(root.id);
  if (executionRootLocal === undefined)
    return 'export default function PreviewInspectorPageExecution() { return null; }';
  const executionPropsContext = 'PreviewInspectorExecutionRootPropsContext';
  const executionRootBridge = 'PreviewInspectorExecutionRootBridge';
  const syntheticNextPagesPage = 'PreviewInspectorSyntheticNextPagesPage';
  const requiresSyntheticNextPagesPage =
    options.candidate.browserCandidate.nextPagesShell?.syntheticPage === true;
  const selectedRouteSurfacePassthrough = 'PreviewInspectorSelectedRouteSurfacePassthrough';
  const selectedRouteSurfaceResolver = 'PreviewInspectorResolveSelectedRouteSurface';
  const contextualTargetFallback = 'PreviewInspectorContextualTargetFallback';
  const contextualTargetParentFrame = 'PreviewInspectorContextualTargetParentFrame';
  const nextAppPageProps = 'PreviewInspectorNextAppPageProps';
  const nextAppPageRoot = options.candidate.browserCandidate.root;
  const nextAppLayoutEdges = options.candidate.compositionEdges.filter(
    (edge) => edge.mode === 'next-layout-slot',
  );
  const nextAppLayoutParentIds = new Set(nextAppLayoutEdges.map((edge) => edge.parentSurfaceId));
  const nextAppLayoutLeafSurfaceId = nextAppLayoutEdges
    .map((edge) => edge.childSurfaceId)
    .find((surfaceId) => !nextAppLayoutParentIds.has(surfaceId));
  const nextAppPageSurfaceId =
    routeRecipe?.kind === 'next-app'
      ? (nextAppLayoutLeafSurfaceId ??
        surfaces.find(
          (surface) =>
            path.normalize(surface.sourcePath) === path.normalize(nextAppPageRoot.sourcePath) &&
            surface.exportName === nextAppPageRoot.exportName,
        )?.id ??
        routeRecipe.mounts.at(-1)?.childSurfaceId)
      : undefined;
  const nextAppPagePropsSource = createNextAppPagePropsSource(routeRecipe, nextAppPageSurfaceId);
  const authoredContextualTargetEdge = options.candidate.compositionEdges.find(
    (edge) =>
      edge.mode === 'contains-authored-child' &&
      edge.childSurfaceId === options.candidate.runtimeTargetSurfaceId,
  );
  const deferredContextualTargetEdge =
    options.candidate.browserCandidate.detachedTargetPlacement === 'deferred-sibling'
      ? options.candidate.compositionEdges.find(
          (edge) =>
            edge.mode === 'sibling-after' &&
            edge.childSurfaceId === options.candidate.runtimeTargetSurfaceId,
        )
      : undefined;
  const contextualTargetEdge = authoredContextualTargetEdge ?? deferredContextualTargetEdge;
  const contextualTargetLocal = localById.get(options.candidate.runtimeTargetSurfaceId);
  const contextualTargetWrapperExportName = selectContextualTargetOverlayRootExport(
    options.candidate,
    options.target,
    options.targetModuleContract,
  );
  const contextualTargetWrapperLocal =
    contextualTargetWrapperExportName === undefined
      ? undefined
      : 'PreviewInspectorContextualTargetOverlayRoot';
  const contextualTargetSupportsMountedTransparentChildren =
    options.targetModuleContract?.transparentOrdinaryChildrenOutputExportNames.includes(
      options.target.exportName,
    ) === true;
  const contextualTargetSupportsDeferredSibling =
    contextualTargetEdge !== undefined && options.targetModuleContract !== undefined;
  const contextualTargetReachabilityKey = `${options.candidate.browserCandidate.id}:${options.target.exportName}`;
  const contextualTargetFallbackCapabilityRevision = JSON.stringify({
    mountedTransparentChildren: contextualTargetSupportsMountedTransparentChildren,
    retainedRoutePage: contextualTargetSupportsMountedTransparentChildren,
  });
  localById.set(root.id, executionRootBridge);
  // Keep ordinary recovery beside its authored parent inside any outer layout. Mounting it beside
  // the complete route element places forms after application chrome such as a global footer.
  const contextualTargetParentSurfaceId =
    contextualTargetEdge !== undefined &&
    options.targetModuleContract !== undefined &&
    !contextualTargetSupportsMountedTransparentChildren
      ? contextualTargetEdge.parentSurfaceId
      : undefined;
  const contextualTargetParentLocal =
    contextualTargetParentSurfaceId === undefined
      ? undefined
      : localById.get(contextualTargetParentSurfaceId);
  if (contextualTargetParentLocal !== undefined && contextualTargetParentSurfaceId !== undefined) {
    localById.set(contextualTargetParentSurfaceId, contextualTargetParentFrame);
  }
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
      .filter((edge) => edge.mode === 'sibling-after' && edge !== deferredContextualTargetEdge)
      .map((edge) => render(edge.childSurfaceId, new Set(active)));
    const slot = edges.find(
      (edge) =>
        edge.mode !== 'contains-authored-child' &&
        edge.mode !== 'sibling-before' &&
        edge.mode !== 'sibling-after',
    );
    const properties = surfaceId === nextAppPageSurfaceId ? nextAppPageProps : 'null';
    let current = `React.createElement(${local}, ${properties})`;
    if (
      surfaceId === options.candidate.runtimeTargetSurfaceId &&
      contextualTargetWrapperLocal !== undefined
    ) {
      current = `React.createElement(${contextualTargetWrapperLocal}, { open: true }, ${current})`;
    }
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
  const detachedOverlayEdge =
    options.candidate.browserCandidate.detachedTargetPlacement === 'overlay-sibling'
      ? options.candidate.compositionEdges.find(
          (edge) =>
            edge.mode === 'sibling-after' &&
            edge.childSurfaceId === options.candidate.runtimeTargetSurfaceId,
        )
      : undefined;
  const detachedOverlayPage =
    detachedOverlayEdge === undefined
      ? undefined
      : render(detachedOverlayEdge.parentSurfaceId, new Set());
  const routerSurfaceIds = new Set(
    routeRecipe?.mounts
      .map((mount) => mount.parentSurfaceId)
      .filter((surfaceId): surfaceId is string => surfaceId !== undefined) ?? [],
  );
  const routerPageSurfaceId = routeRecipe?.mounts.at(-1)?.childSurfaceId;
  const routerRenderedPage =
    detachedOverlayPage ??
    (routerPageSurfaceId === undefined ? renderedRoot : render(routerPageSurfaceId, new Set()));
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
    routerRuntime !== undefined && virtualPageOwnerSurfaceId !== undefined
      ? [
          `function ${virtualPageOwnerFrameLocal}() {`,
          `  return ${detachedOverlayPage ?? renderedRoot};`,
          '}',
        ]
      : [];
  const routeStatePrelude = shouldInstallPreviewInspectorPageRouteStatePrelude(routeRecipe);
  const routeElement = routerRuntime !== undefined ? routerRuntime.routeElement : renderedRoot;
  const contextualTargetFallbackSource =
    contextualTargetLocal === undefined || !contextualTargetSupportsDeferredSibling
      ? []
      : [
          `const ${contextualTargetFallback}ReachabilityKey = ${JSON.stringify(contextualTargetReachabilityKey)};`,
          `const ${contextualTargetFallback}Capability = Object.freeze(${contextualTargetFallbackCapabilityRevision});`,
          `function ${contextualTargetFallback}({ children }) {`,
          '  const [, setRevision] = React.useState(0);',
          `  const inspectorSession = globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')];`,
          `  const contextualOwner = React.useMemo(() => ({}), [${contextualTargetFallback}ReachabilityKey, inspectorSession]);`,
          '  const contextualRoleToken = React.useRef(undefined);',
          '  React.useEffect(() => {',
          '    let registrationReady = false;',
          '    let notificationBuffered = false;',
          '    const unsubscribe = inspectorSession?.subscribe?.(() => {',
          '      if (!registrationReady) {',
          '        notificationBuffered = true;',
          '        return;',
          '      }',
          '      setRevision((value) => value + 1);',
          '    });',
          `    const registration = inspectorSession?.registerContextualTargetFallback?.(${contextualTargetFallback}ReachabilityKey, ${contextualTargetFallback}Capability, contextualOwner);`,
          '    contextualRoleToken.current = registration?.contextualRoleToken;',
          '    registrationReady = true;',
          `    if (notificationBuffered || inspectorSession?.shouldRenderContextualTargetFallback?.(${contextualTargetFallback}ReachabilityKey, contextualOwner) === true)`,
          '      setRevision((value) => value + 1);',
          '    return () => {',
          "      if (typeof unsubscribe === 'function') unsubscribe();",
          '      contextualRoleToken.current = undefined;',
          "      if (typeof registration === 'function') registration();",
          '    };',
          '  }, [inspectorSession, contextualOwner]);',
          `  const targetElement = inspectorSession?.createContextualTargetElement?.(${contextualTargetLocal}, ${JSON.stringify(options.target)}, contextualRoleToken.current${contextualTargetSupportsMountedTransparentChildren ? ', children' : ''}) ?? null;`,
          `  return inspectorSession?.shouldRenderContextualTargetFallback?.(${contextualTargetFallback}ReachabilityKey, contextualOwner) === true`,
          `    ? ${contextualTargetWrapperLocal === undefined ? 'targetElement' : `React.createElement(${contextualTargetWrapperLocal}, { open: true }, targetElement)`}`,
          `    : ${contextualTargetSupportsMountedTransparentChildren ? 'children' : 'null'};`,
          '}',
        ];
  const contextualTargetParentFrameSource =
    contextualTargetFallbackSource.length === 0 || contextualTargetParentLocal === undefined
      ? []
      : [
          `function ${contextualTargetParentFrame}(frameProps) {`,
          '  return React.createElement(',
          '    React.Fragment,',
          '    null,',
          `    React.createElement(${contextualTargetParentLocal}, frameProps),`,
          `    React.createElement(${contextualTargetFallback}, null),`,
          '  );',
          '}',
        ];
  const contextualRouteElement =
    contextualTargetFallbackSource.length === 0
      ? routeElement
      : contextualTargetSupportsMountedTransparentChildren
        ? `React.createElement(${contextualTargetFallback}, null, ${routeElement})`
        : contextualTargetParentFrameSource.length > 0
          ? routeElement
          : `React.createElement(React.Fragment, null, ${routeElement}, React.createElement(${contextualTargetFallback}, null))`;
  const virtualPageSourceRegistrations = createVirtualPageSourceRegistrations(
    options.candidate.optionalSurfaces,
  );
  return [
    "import React from 'react';",
    ...(routeStatePrelude
      ? [`import ${JSON.stringify(PREVIEW_INSPECTOR_PAGE_ROUTE_STATE_SPECIFIER)};`]
      : []),
    ...imports,
    ...(contextualTargetWrapperExportName === undefined ||
    contextualTargetWrapperLocal === undefined
      ? []
      : [
          `import { ${contextualTargetWrapperExportName} as ${contextualTargetWrapperLocal} } from ${JSON.stringify(PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER)};`,
        ]),
    ...(routerRuntime?.imports ?? []),
    ...virtualPageSourceRegistrations,
    ...(routerRuntime?.declarations ?? []),
    ...nextAppPagePropsSource,
    `function ${selectedRouteSurfacePassthrough}({ children }) {`,
    '  return children ?? null;',
    '}',
    `function ${selectedRouteSurfaceResolver}(surface) {`,
    '  const marker = surface?.$$typeof;',
    "  return marker === Symbol.for('react.context') || marker === Symbol.for('react.consumer') || marker === Symbol.for('react.provider')",
    `    ? ${selectedRouteSurfacePassthrough}`,
    '    : surface;',
    '}',
    `const ${executionPropsContext} = React.createContext(Object.freeze({}));`,
    ...(requiresSyntheticNextPagesPage
      ? [
          `function ${syntheticNextPagesPage}() {`,
          `  return React.createElement('main', { 'data-react-preview-synthetic-next-page': 'true' });`,
          '}',
        ]
      : []),
    `function ${executionRootBridge}(bridgeProps) {`,
    `  const executionProps = React.useContext(${executionPropsContext});`,
    '  const rootProps = Object.assign({}, executionProps, bridgeProps);',
    ...(requiresSyntheticNextPagesPage
      ? [
          `  if (rootProps.Component == null) rootProps.Component = ${syntheticNextPagesPage};`,
          '  if (rootProps.pageProps == null) rootProps.pageProps = Object.freeze({});',
        ]
      : []),
    `  return Object.prototype.hasOwnProperty.call(bridgeProps, 'children')`,
    `    ? React.createElement(${executionRootLocal}, rootProps, bridgeProps.children)`,
    `    : React.createElement(${executionRootLocal}, rootProps);`,
    '}',
    ...contextualTargetFallbackSource,
    ...contextualTargetParentFrameSource,
    ...virtualPageOwnerFrame,
    'export default function PreviewInspectorPageExecution(previewProps) {',
    `  return React.createElement(${executionPropsContext}.Provider, { value: previewProps ?? Object.freeze({}) }, ${contextualRouteElement});`,
    '}',
  ].join('\n');
}

function createNextAppPagePropsSource(
  recipe: PreviewInspectorPageExecutionCandidate['routeRecipe'],
  pageSurfaceId: string | undefined,
): readonly string[] {
  if (recipe?.kind !== 'next-app' || pageSurfaceId === undefined) return [];
  return [
    'const PreviewInspectorNextAppCompatRecordPrototype = Object.freeze({});',
    'function PreviewInspectorCreateNextAppCompatRecord(source) {',
    '  const value = Object.freeze({ ...source });',
    '  const record = Object.assign(',
    '    Object.create(PreviewInspectorNextAppCompatRecordPrototype),',
    '    value,',
    '  );',
    '  Object.defineProperties(record, {',
    "    status: { configurable: false, enumerable: false, value: 'fulfilled' },",
    '    value: { configurable: false, enumerable: false, value },',
    '    then: {',
    '      configurable: false,',
    '      enumerable: false,',
    '      value(onFulfilled, onRejected) {',
    '        return Promise.resolve(value).then(onFulfilled, onRejected);',
    '      },',
    '    },',
    '  });',
    '  return Object.freeze(record);',
    '}',
    'const PreviewInspectorNextAppPageProps = Object.freeze({',
    `  params: PreviewInspectorCreateNextAppCompatRecord(${JSON.stringify(recipe.params)}),`,
    `  searchParams: PreviewInspectorCreateNextAppCompatRecord(${JSON.stringify(recipe.searchParams)}),`,
    '});',
  ];
}

/** Finds a same-module overlay root that supplies Context to a detached Content/Portal target. */
function selectContextualTargetOverlayRootExport(
  candidate: PreviewInspectorPageExecutionCandidate,
  target: { readonly exportName: string; readonly sourcePath: string },
  contract: PreviewInspectorTargetModuleContract | undefined,
): string | undefined {
  if (candidate.browserCandidate.detachedTargetPlacement === undefined || contract === undefined) {
    return undefined;
  }
  return [...contract.explicitExportNames]
    .filter(
      (exportName) =>
        exportName !== 'default' &&
        exportName !== target.exportName &&
        target.exportName.startsWith(exportName) &&
        isReactOverlayComponentName(exportName),
    )
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0];
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
  const isVirtualSlice =
    surface.strategy === 'selected-export-slice' ||
    surface.strategy === 'inner-local-component-slice';
  const specifier = isRuntimeTarget
    ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
    : isExecutionRoot && !isVirtualSlice
      ? executionRootModuleContract.sourcePath
      : surface.strategy === 'authentic-module-export' ||
          surface.strategy === 'framework-page-surface' ||
          surface.strategy === 'selected-route-surface'
        ? surface.sourcePath
        : createPreviewInspectorPageSurfaceSpecifier(surface.id);
  if (!isRuntimeTarget && !isExecutionRoot && surface.strategy === 'selected-route-surface') {
    const namespace = `${local}Module`;
    const value = `${local}Value`;
    return [
      `import * as ${namespace} from ${JSON.stringify(specifier)};`,
      `const ${value} = Reflect.get(${namespace}, ${JSON.stringify(surface.exportName)}) ?? Reflect.get(${namespace}, 'default');`,
      `const ${local} = PreviewInspectorResolveSelectedRouteSurface(${value});`,
    ].join('\n');
  }
  const bindingExportName =
    isExecutionRoot && !isVirtualSlice
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
