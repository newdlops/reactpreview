/** Emits the frozen Inspector root module with authored wrappers and target ownership. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readPreviewJsxPathOccurrences } from '../previewJsxOccurrenceIdentity';
import type { PreviewInspectorTargetMode } from '../../../domain/preview';
import { createPreviewApplicationStylesheetSpecifier } from '../previewApplicationStylesheetBridge';
import type { PreviewApplicationStylesheetImportSelection } from '../previewApplicationStylesheetSelection';
import type { PreviewGlobalStyleImportSelection } from '../previewGlobalStyleSelection';
import { createPreviewNextAppControlBoundarySource } from '../previewNextAppControlBoundarySource';
import {
  PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY,
  PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY,
} from '../previewNextAppNavigationRuntimeSource';
import type { PreviewThemeImportSelection } from '../previewTargetExports';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import {
  completePreviewAutomaticProps,
  completePreviewTypedListShape,
  type PreviewTypedPropValue,
} from '../typeOracle/previewTypedComponentProps';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorComponentReference,
} from './previewInspectorAncestorPlan';
import { createPreviewInspectorAutomaticPropsSampleDateStatements } from './previewInspectorAutomaticPropsSampleDates';
import { canBundlePreviewInspectorDirectTargetDefinitions } from './previewInspectorDirectTargetBundling';
import { selectPreviewInspectorExecutableCandidate } from './previewInspectorExecutableCandidateSelection';
import { createPreviewInspectorPageExecutionCandidateSummaries } from './previewInspectorPageExecutionCandidateSummary';
import { PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER } from './previewInspectorPageExecutionEntryPlugin';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';
import {
  createNextAppLayoutNavigationValues,
  createPreviewInspectorDescriptorRenderChains,
} from './previewInspectorRootNavigation';
import type { PreviewInspectorRootPluginOptions } from './previewInspectorRootPlugin';
import {
  createPreviewInspectorDirectTargetSpecifier,
  PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER,
} from './previewInspectorTargetPlugin';
import { createPreviewInspectorVirtualPageCandidates } from './previewInspectorVirtualPagePlan';
import { createPreviewInspectorVirtualPageRuntimeSource } from './previewInspectorVirtualPageRuntimeSource';

/** Reads the current snapshot first and falls back to disk; unreadable bootstrap source stays unavailable. */
export function readRenderBootstrapSource(
  options: PreviewInspectorRootPluginOptions,
  sourcePath: string,
): string | undefined {
  const snapshot = options.readSource?.(sourcePath);
  if (snapshot !== undefined) return snapshot;
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Generates ordered imports that initialize the optional bootstrap before loading candidate modules. */
export function createCandidateModuleImportPromise(
  importExpressions: readonly string[],
  renderBootstrapSpecifier: string | undefined,
): string {
  const pagePromise = `Promise.all([${importExpressions.join(',')}])`;
  return renderBootstrapSpecifier === undefined
    ? pagePromise
    : `import(${JSON.stringify(renderBootstrapSpecifier)}).then(() => ${pagePromise})`;
}

/** Pure source generator inputs used by plugin and bridge contract tests. */
export interface PreviewInspectorRootSourceOptions {
  readonly applicationStylesheetImports?: readonly PreviewApplicationStylesheetImportSelection[];
  readonly displayName?: string;
  readonly globalStyleImports?: readonly PreviewGlobalStyleImportSelection[];
  readonly maximumPageCandidates?: number;
  readonly pageExecutionCandidate?: PreviewInspectorPageExecutionCandidate;
  readonly pageExecutionCandidates?: readonly PreviewInspectorPageExecutionCandidate[];
  readonly plan: PreviewInspectorAncestorPlan;
  readonly renderBootstrapSpecifiersByCandidateId?: Readonly<Record<string, string>>;
  /** Runtime-only selected route leaf; omission preserves the active-document target. */
  readonly runtimeOwnershipTarget?: PreviewInspectorComponentReference;
  /** One persisted caller-path choice that may produce an executable loader. */
  readonly selectedPageCandidateId?: string;
  readonly targetInference?: PreviewInferredExportProps;
  /** Explicit route intent shared with compiler candidate construction. */
  readonly targetMode?: PreviewInspectorTargetMode;
  readonly targetTypedProps?: Readonly<Record<string, PreviewTypedPropValue>> | undefined;
  readonly themeImport?: PreviewThemeImportSelection;
}

/** Generates Inspector descriptor metadata and one executable candidate loader. */
export function createPreviewInspectorRootSource(
  options: PreviewInspectorRootSourceOptions,
): string {
  const { plan } = options;
  const runtimeOwnershipTarget = options.runtimeOwnershipTarget ?? plan.target;
  const runtimeOwnershipDiffersFromAnalysis =
    path.normalize(runtimeOwnershipTarget.sourcePath) !== path.normalize(plan.target.sourcePath) ||
    runtimeOwnershipTarget.exportName !== plan.target.exportName;
  const runtimeTargetInference = runtimeOwnershipDiffersFromAnalysis
    ? undefined
    : options.targetInference;
  const virtualPageCandidates = createPreviewInspectorVirtualPageCandidates(
    plan.pageCandidates,
    options.maximumPageCandidates ?? plan.pageCandidates.length,
    plan.shallowVisualPaths ?? [],
    options.targetMode,
  );
  const executableCandidate = selectPreviewInspectorExecutableCandidate(
    virtualPageCandidates,
    options.selectedPageCandidateId,
  );
  const selectedRenderPath =
    options.pageExecutionCandidate?.browserCandidate.renderPath ??
    executableCandidate?.active.browserCandidate.renderPath;
  const descriptorRenderChains = createPreviewInspectorDescriptorRenderChains(
    plan,
    runtimeOwnershipTarget,
    selectedRenderPath,
  );
  const pageCandidates = virtualPageCandidates.map((candidate) => candidate.browserCandidate);
  for (const candidate of pageCandidates) {
    assertExportName(candidate.root.exportName);
  }
  for (const virtualPage of virtualPageCandidates) {
    for (const shell of virtualPage.recipe.shells) assertExportName(shell.root.exportName);
  }
  const browserCandidates = virtualPageCandidates.map((virtualPage) => {
    const analysisCandidate = virtualPage.browserCandidate;
    const executionCandidate =
      options.pageExecutionCandidate?.browserCandidate.id === analysisCandidate.id
        ? options.pageExecutionCandidate
        : undefined;
    const candidate = executionCandidate?.browserCandidate ?? analysisCandidate;
    const executionRecipe = executionCandidate?.routeRecipe;
    /*
     * Ordinary single-export plans keep their shared target on the plan rather than duplicating it
     * onto every candidate. Page Execution enriches only the active candidate, so publishing that
     * one explicit target beside target-less alternatives made the browser's export filter discard
     * every HOC/wrapper path except the mounted one. Named-export scenarios already carry an exact
     * candidate target and remain authoritative; otherwise inherit the immutable analysis target.
     */
    const runtimeCandidateTarget =
      executionCandidate?.browserCandidate.target ?? candidate.target ?? plan.target;
    const selectedExecutionRootOwnsRouter =
      executionCandidate === undefined
        ? candidate.rootOwnsRouter
        : executionCandidate.browserCandidate.rootOwnsRouter;
    const generatedExecutionOwnsRouter =
      executionRecipe?.rootOwnsRouter === false &&
      (executionRecipe.kind === 'react-router-v5' || executionRecipe.kind === 'react-router-v6');
    const selectedJsxSites = readPreviewJsxPathOccurrences(candidate);
    return {
      complete: candidate.complete,
      ...(candidate.detachedTargetPlacement === undefined
        ? {}
        : { detachedTargetPlacement: candidate.detachedTargetPlacement }),
      ...(candidate.contextModule === undefined ? {} : { contextModule: candidate.contextModule }),
      edges: candidate.edges,
      selectedJsxOccurrenceIds: selectedJsxSites.ids,
      selectedSuspenseFallbackOccurrenceIds: selectedJsxSites.suspenseFallbackIds,
      id: candidate.id,
      ...(candidate.renderPath === undefined ? {} : { renderPath: candidate.renderPath }),
      root: candidate.root,
      // A target-only execution mounts the target itself as the root, so it needs the same
      // declared-type props the contextual target element receives (StatusChip's `status`).
      rootAutomaticProps:
        executionCandidate?.fidelity === 'target-only'
          ? completePreviewAutomaticProps(
              candidate.rootAutomaticProps,
              options.targetTypedProps,
              candidate.rootInference?.shape,
            )
          : candidate.rootAutomaticProps,
      ...(candidate.rootInference === undefined
        ? {}
        : {
            rootInferredPropShape:
              executionCandidate?.fidelity === 'target-only'
                ? completePreviewTypedListShape(
                    candidate.rootInference.shape,
                    options.targetTypedProps,
                  )
                : candidate.rootInference.shape,
            rootInferredProps: candidate.rootInference.provenance,
          }),
      ...(candidate.nextAppLayoutChain === undefined
        ? {}
        : { nextAppLayoutChain: candidate.nextAppLayoutChain }),
      ...(candidate.nextPagesShell === undefined
        ? {}
        : { nextPagesShell: candidate.nextPagesShell }),
      ...(candidate.nextAppRedirectDestination === undefined
        ? {}
        : { nextAppRedirectDestination: candidate.nextAppRedirectDestination }),
      rootOwnsRouter: selectedExecutionRootOwnsRouter || generatedExecutionOwnsRouter,
      ...(candidate.routeMountBasePath === undefined
        ? {}
        : {
            routeMountBasePath: candidate.routeMountBasePath,
            routeSlotCount: candidate.routeSlotCount ?? 0,
            wildcardFallbackPresent: candidate.wildcardFallbackPresent === true,
          }),
      ...(candidate.rootStepIndex === undefined ? {} : { rootStepIndex: candidate.rootStepIndex }),
      ...(candidate.routeLocation === undefined
        ? {}
        : {
            routeLocation: {
              componentName: candidate.routeLocation.componentName,
              evidenceKind: candidate.routeLocation.evidenceKind,
              pathname: candidate.routeLocation.pathname,
              ...('params' in candidate.routeLocation
                ? {
                    params: candidate.routeLocation.params,
                    searchParams: candidate.routeLocation.searchParams,
                  }
                : {}),
              pattern: candidate.routeLocation.pattern,
              sourcePath: candidate.routeLocation.sourcePath,
            },
          }),
      stopReason: candidate.stopReason,
      targetAutomaticProps: completePreviewAutomaticProps(
        executionCandidate?.browserCandidate.targetAutomaticProps ?? candidate.targetAutomaticProps,
        options.targetTypedProps,
        runtimeTargetInference?.shape,
      ),
      ...(executionCandidate?.targetPageTabKeys === undefined ||
      executionCandidate.targetPageTabKeys.length === 0
        ? {}
        : { targetPageTabKeys: executionCandidate.targetPageTabKeys }),
      target: runtimeCandidateTarget,
      virtualPage: virtualPage.recipe,
    };
  });
  const legacyCandidateDefinitions = (
    executableCandidate === undefined ? [] : [executableCandidate.active]
  ).map((virtualPage) => {
    const { browserCandidate: candidate, contentCandidate, recipe } = virtualPage;
    const rootIsTarget =
      path.normalize(contentCandidate.root.sourcePath) ===
        path.normalize(runtimeOwnershipTarget.sourcePath) &&
      contentCandidate.root.exportName === runtimeOwnershipTarget.exportName;
    const rootSpecifier = rootIsTarget
      ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
      : contentCandidate.root.sourcePath.replaceAll('\\', '/');
    const layoutSpecifiers = contentCandidate.nextAppLayoutChain?.map((layout) =>
      path.normalize(layout.sourcePath) === path.normalize(runtimeOwnershipTarget.sourcePath) &&
      layout.exportName === runtimeOwnershipTarget.exportName
        ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
        : layout.sourcePath.replaceAll('\\', '/'),
    );
    const nextAppRouteLocation =
      contentCandidate.routeLocation?.evidenceKind === 'next-app-filesystem'
        ? contentCandidate.routeLocation
        : undefined;
    const renderBootstrapSpecifier = options.renderBootstrapSpecifiersByCandidateId?.[candidate.id];
    if (nextAppRouteLocation !== undefined) {
      const imports = [rootSpecifier, ...(layoutSpecifiers ?? [])].map(
        (specifier) => `import(${JSON.stringify(specifier)})`,
      );
      return [
        '{ id: ',
        JSON.stringify(candidate.id),
        ', load: () => ',
        createCandidateModuleImportPromise(imports, renderBootstrapSpecifier),
        '.then((modules) => __reactPreviewComposeNextAppPage(modules, ',
        JSON.stringify(contentCandidate.root.exportName),
        ', ',
        JSON.stringify(nextAppRouteLocation.pathname),
        ', ',
        JSON.stringify(nextAppRouteLocation.params),
        ', ',
        JSON.stringify(nextAppRouteLocation.searchParams),
        ', ',
        JSON.stringify(contentCandidate.nextAppLayoutChain?.map((layout) => layout.params) ?? []),
        ', ',
        JSON.stringify(createNextAppLayoutNavigationValues(contentCandidate)),
        ', ',
        JSON.stringify(
          contentCandidate.nextAppLayoutChain?.map((layout) => layout.slotNames ?? []) ?? [],
        ),
        ')) }',
      ].join('');
    }
    if (contentCandidate.nextPagesShell !== undefined) {
      const appIsTarget =
        path.normalize(contentCandidate.nextPagesShell.app.sourcePath) ===
          path.normalize(runtimeOwnershipTarget.sourcePath) &&
        contentCandidate.nextPagesShell.app.exportName === runtimeOwnershipTarget.exportName;
      const appSpecifier = appIsTarget
        ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
        : contentCandidate.nextPagesShell.app.sourcePath.replaceAll('\\', '/');
      const syntheticPage = contentCandidate.nextPagesShell.syntheticPage === true;
      const imports = (syntheticPage ? [appSpecifier] : [rootSpecifier, appSpecifier]).map(
        (specifier) => `import(${JSON.stringify(specifier)})`,
      );
      return [
        '{ id: ',
        JSON.stringify(candidate.id),
        ', load: () => ',
        createCandidateModuleImportPromise(imports, renderBootstrapSpecifier),
        '.then((modules) => __reactPreviewComposeNextPagesPage(modules, ',
        JSON.stringify(contentCandidate.root.exportName),
        ', ',
        JSON.stringify(syntheticPage),
        ')) }',
      ].join('');
    }
    const shellSpecifiers = recipe.shells.map((shell) =>
      path.normalize(shell.root.sourcePath) === path.normalize(runtimeOwnershipTarget.sourcePath) &&
      shell.root.exportName === runtimeOwnershipTarget.exportName
        ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
        : shell.root.sourcePath.replaceAll('\\', '/'),
    );
    const imports = [rootSpecifier, ...shellSpecifiers].map(
      (specifier) => `import(${JSON.stringify(specifier)})`,
    );
    return [
      '{ id: ',
      JSON.stringify(candidate.id),
      ', load: () => ',
      createCandidateModuleImportPromise(imports, renderBootstrapSpecifier),
      '.then((modules) => __reactPreviewComposeVirtualPage(modules, ',
      JSON.stringify(contentCandidate.root.exportName),
      ', ',
      JSON.stringify(recipe.shells.map((shell) => shell.root.exportName)),
      ', ',
      JSON.stringify(recipe),
      ')) }',
    ].join('');
  });
  const candidateDefinitions =
    options.pageExecutionCandidate === undefined
      ? legacyCandidateDefinitions
      : [
          [
            '{ id: ',
            JSON.stringify(options.pageExecutionCandidate.browserCandidate.id),
            ', load: () => import(',
            JSON.stringify(PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER),
            ').then((module) => module.default) }',
          ].join(''),
        ];
  // Register every statically proven current-file component behind its own dynamic import. The
  // browser invokes these loaders only for the explicit file-component overview; authored page
  // flow still mounts one selected caller path and preserves its exact UI.
  const directTargetExportNames =
    !runtimeOwnershipDiffersFromAnalysis &&
    plan.contextModule === undefined &&
    canBundlePreviewInspectorDirectTargetDefinitions(options.pageExecutionCandidate, plan.target)
      ? [...new Set([plan.target.exportName, ...Object.keys(plan.renderChainsByExport)])]
      : [];
  for (const exportName of directTargetExportNames) assertExportName(exportName);
  const directTargetDefinitions = directTargetExportNames.map((exportName) =>
    [
      '{ directTarget: true, id: ',
      JSON.stringify(`direct-target:${exportName}`),
      ', targetExportName: ',
      JSON.stringify(exportName),
      ', load: () => import(',
      JSON.stringify(createPreviewInspectorDirectTargetSpecifier(exportName)),
      ').then((module) => module.default) }',
    ].join(''),
  );
  const primaryRootIsTarget =
    path.normalize(runtimeOwnershipTarget.sourcePath) === path.normalize(plan.root.sourcePath) &&
    runtimeOwnershipTarget.exportName === plan.root.exportName;
  const pageExecutionCandidateSummaries = createPreviewInspectorPageExecutionCandidateSummaries(
    options.pageExecutionCandidates,
    (sourcePath) => readRenderBootstrapSource(options, sourcePath),
  );
  const descriptor = {
    automaticProps: {},
    displayName: options.displayName ?? runtimeOwnershipTarget.exportName,
    exportName: runtimeOwnershipTarget.exportName,
    ...(primaryRootIsTarget && runtimeTargetInference !== undefined
      ? {
          inferredPropShape: runtimeTargetInference.shape,
          inferredProps: runtimeTargetInference.provenance,
        }
      : {}),
    inspector: {
      ancestry: plan.edges,
      complete: plan.complete,
      ...(plan.contextModule === undefined ? {} : { contextModule: plan.contextModule }),
      pageCandidates: browserCandidates,
      ...(executableCandidate === undefined
        ? {}
        : { executablePageCandidateId: executableCandidate.active.browserCandidate.id }),
      // prettier-ignore
      ...(options.pageExecutionCandidate === undefined ? {} : { pageExecutionCandidateId: options.pageExecutionCandidate.id }),
      ...(pageExecutionCandidateSummaries === undefined
        ? {}
        : { pageExecutionCandidates: pageExecutionCandidateSummaries }),
      ...(executableCandidate?.requestedCandidateWasUnavailable === true
        ? { requestedPageCandidateUnavailable: true }
        : {}),
      renderChain: descriptorRenderChains.renderChain,
      renderChainsByExport: descriptorRenderChains.renderChainsByExport,
      renderOutcomesByExport: plan.renderOutcomesByExport ?? {},
      routeBranches:
        plan.routeBranches?.map((branch) => ({
          ...(branch.availability === undefined ? {} : { availability: branch.availability }),
          childState: branch.childState,
          componentName: branch.componentName,
          depth: branch.depth,
          id: branch.id,
          ...(branch.parentId === undefined ? {} : { parentId: branch.parentId }),
          pathname: branch.pathname,
          pattern: branch.pattern,
          selectionPath: branch.selectionPath,
          selectable: branch.selectable !== false,
        })) ?? [],
      root: runtimeOwnershipDiffersFromAnalysis ? runtimeOwnershipTarget : plan.root,
      ...(plan.selectedRouteBranchId === undefined
        ? {}
        : { selectedRouteBranchId: plan.selectedRouteBranchId }),
      ...(plan.routeSelectionResolution === undefined
        ? {}
        : { routeSelectionResolution: plan.routeSelectionResolution }),
      stopReason: plan.stopReason,
      target: runtimeOwnershipTarget,
      ...(options.targetMode === undefined ? {} : { targetMode: options.targetMode }),
      targetAutomaticProps: completePreviewAutomaticProps(
        runtimeOwnershipDiffersFromAnalysis ? {} : plan.targetAutomaticProps,
        options.targetTypedProps,
        runtimeTargetInference?.shape,
      ),
      ...(runtimeTargetInference === undefined
        ? {}
        : { targetInferredPropShape: runtimeTargetInference.shape }),
      targetInferredProps: runtimeTargetInference?.provenance ?? [],
    },
  };
  const themeImport = createInspectorThemeImport(options.themeImport);
  const globalStyleImports = createInspectorGlobalStyleImports(options.globalStyleImports ?? []);
  const applicationStylesheetStatements = (options.applicationStylesheetImports ?? []).map(
    (_selection, index) =>
      `import ${JSON.stringify(createPreviewApplicationStylesheetSpecifier(index))};`,
  );
  const requiresNextAppRuntime = virtualPageCandidates.some(
    (candidate) => candidate.contentCandidate.routeLocation?.evidenceKind === 'next-app-filesystem',
  );
  const requiresNextPagesRuntime = virtualPageCandidates.some(
    (candidate) => candidate.contentCandidate.nextPagesShell !== undefined,
  );

  return [
    "import * as React from 'react';",
    ...applicationStylesheetStatements,
    ...(requiresNextPagesRuntime
      ? [
          "import __reactPreviewNextPagesRouter, { RouterContext as __reactPreviewNextPagesRouterContext } from 'next/router';",
        ]
      : []),
    ...(themeImport.statement === undefined ? [] : [themeImport.statement]),
    ...globalStyleImports.statements,
    ...createPreviewInspectorVirtualPageRuntimeSource(),
    ...(requiresNextAppRuntime
      ? [
          "import { PreviewLayoutSegmentsContext as __reactPreviewNextLayoutSegmentsContext } from 'next/navigation';",
          `const __reactPreviewNextAppRouteStateSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY)});`,
          `const __reactPreviewNextAppControlSignalSymbol = Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY)});`,
          '/** Publishes one inferred App route without resetting local navigation on re-render. */',
          'function __reactPreviewInstallNextAppRoute(pathname, params, searchParams) {',
          '  const signature = JSON.stringify([pathname, params, searchParams]);',
          '  const previous = globalThis[__reactPreviewNextAppRouteStateSymbol];',
          '  if (previous?.initialSignature === signature) return;',
          '  globalThis[__reactPreviewNextAppRouteStateSymbol] = {',
          '    initialSignature: signature,',
          '    params: Object.freeze({ ...params }),',
          '    pathname,',
          '    revision: Number.isSafeInteger(previous?.revision) ? previous.revision + 1 : 0,',
          '    searchParams: Object.freeze({ ...searchParams }),',
          '  };',
          '}',
          ...createPreviewNextAppControlBoundarySource('__reactPreviewNextAppControlBoundary'),
          '/**',
          ' * Creates a stable object that supports legacy direct property reads, `await`, and',
          ' * React 19 `use()` without choosing a project-specific Next.js major version.',
          ' */',
          'function __reactPreviewCreateNextAppCompatRecord(source) {',
          '  const value = Object.freeze({ ...source });',
          '  const record = { ...value };',
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
          '/** Keeps each async App page/layout on one stable promise instead of suspending forever. */',
          'function __reactPreviewAdaptNextComponent(Component) {',
          '  if (typeof Component !== "function" || Component.constructor?.name !== "AsyncFunction") return Component;',
          '  let record;',
          '  return function ReactPreviewAsyncNextComponent(props) {',
          '   if (record === undefined) {',
          '    let resume;',
          '    const promise = new Promise((resolve) => { resume = resolve; });',
          '    record = { promise, status: "pending", value: null };',
          '    let timer = setTimeout(() => {',
          '      if (record.status !== "pending") return;',
          '      record.status = "fulfilled";',
          '      record.value = React.createElement("span", {',
          '        "data-react-preview-next-async": "timeout", role: "status", title: "Async Next output timed out",',
          '      }, "…");',
          '      resume();',
          '    }, 1500);',
          '    Promise.resolve().then(() => Component(props)).then(',
          '      (value) => {',
          '        if (record.status !== "pending") return;',
          '        clearTimeout(timer); record.status = "fulfilled"; record.value = value; resume();',
          '      },',
          '      (error) => {',
          '        if (record.status !== "pending") return;',
          '        clearTimeout(timer);',
          '        if (error?.[__reactPreviewNextAppControlSignalSymbol] !== undefined) {',
          '          record.status = "rejected"; record.value = error;',
          '        } else {',
          '          globalThis.console?.warn?.("[React Preview] async Next component", error);',
          '          record.status = "fulfilled";',
          '          record.value = React.createElement("span", {',
          '            "data-react-preview-next-async": "failed", role: "status", title: String(error?.message ?? error).slice(0, 240),',
          '          }, "…");',
          '        }',
          '        resume();',
          '      },',
          '    );',
          '   }',
          '   if (record.status === "pending") throw record.promise;',
          '   if (record.status === "rejected") throw record.value;',
          '   return record.value;',
          '  };',
          '}',
          '/** Supplies one inert but truthy React node for each statically proven named slot prop. */',
          'function __reactPreviewCreateNextSlotProps(slotNames) {',
          '  const props = {};',
          '  for (const slotName of slotNames) {',
          '    props[slotName] = React.createElement("span", {',
          '      "data-react-preview-next-slot": slotName, hidden: true,',
          '    });',
          '  }',
          '  return props;',
          '}',
          '/** Recreates Next App Router implicit root-to-leaf layout nesting around one page. */',
          'function __reactPreviewComposeNextAppPage(',
          '  modules,',
          '  rootExportName,',
          '  pathname,',
          '  pageParamValues,',
          '  searchParamValues,',
          '  layoutParamValues,',
          '  layoutNavigationValues,',
          '  layoutSlotNames,',
          ') {',
          '  const Root = __reactPreviewAdaptNextComponent(modules[0]?.[rootExportName]);',
          '  const layouts = modules.slice(1).map((module) => __reactPreviewAdaptNextComponent(module?.default));',
          '  const pageParams = __reactPreviewCreateNextAppCompatRecord(pageParamValues);',
          '  const searchParams = __reactPreviewCreateNextAppCompatRecord(searchParamValues);',
          '  const layoutParams = layoutParamValues.map(__reactPreviewCreateNextAppCompatRecord);',
          '  return function ReactPreviewNextAppPage(props) {',
          '    __reactPreviewInstallNextAppRoute(pathname, pageParamValues, searchParamValues);',
          '    const pageProps = Object.assign({}, props, { params: pageParams, searchParams });',
          '    let child = React.createElement(',
          '      __reactPreviewNextLayoutSegmentsContext.Provider,',
          '      { value: { segments: [], slots: {} } },',
          '      React.createElement(',
          '        __reactPreviewNextAppControlBoundary,',
          '        null,',
          '        React.createElement(Root, pageProps),',
          '      ),',
          '    );',
          '    for (let index = layouts.length - 1; index >= 0; index -= 1) {',
          '      const layoutProps = Object.assign(',
          '        { children: child, params: layoutParams[index] },',
          '        __reactPreviewCreateNextSlotProps(layoutSlotNames[index] ?? []),',
          '      );',
          '      child = React.createElement(',
          '        __reactPreviewNextLayoutSegmentsContext.Provider,',
          '        { value: layoutNavigationValues[index] ?? { segments: [], slots: {} } },',
          '        React.createElement(',
          '          __reactPreviewNextAppControlBoundary,',
          '          null,',
          '          React.createElement(layouts[index], layoutProps),',
          '        ),',
          '      );',
          '    }',
          '    return child;',
          '  };',
          '}',
        ]
      : []),
    ...(requiresNextPagesRuntime
      ? [
          '/** Supplies a stable host marker when `_app` is the only authored Pages module. */',
          'function __reactPreviewSyntheticNextPagesPage() {',
          "  return React.createElement('main', { 'data-react-preview-synthetic-next-page': 'true' });",
          '}',
          '/** Recreates Next Pages `_app -> Component` composition absent from import graphs. */',
          'function __reactPreviewComposeNextPagesPage(modules, rootExportName, syntheticPage) {',
          '  const authoredPage = syntheticPage ? undefined : modules[0]?.[rootExportName];',
          '  const Page = authoredPage ?? __reactPreviewSyntheticNextPagesPage;',
          '  const App = modules[syntheticPage ? 0 : 1]?.default;',
          '  if (App === undefined || App === null) return Page;',
          '  return function ReactPreviewNextPagesPage(props) {',
          '    const pageProps = Object.assign({}, props);',
          '    return React.createElement(',
          '      __reactPreviewNextPagesRouterContext.Provider,',
          '      { value: __reactPreviewNextPagesRouter },',
          '      React.createElement(App, {',
          '        Component: Page,',
          '        pageProps,',
          '        router: __reactPreviewNextPagesRouter,',
          '      }),',
          '    );',
          '  };',
          '}',
        ]
      : []),
    `const __reactPreviewInspectorCandidates = Object.freeze([${[
      ...candidateDefinitions,
      ...directTargetDefinitions,
    ].join(',')}]);`,
    `const __reactPreviewInspectorDescriptor = ${JSON.stringify(descriptor)};`,
    ...createPreviewInspectorAutomaticPropsSampleDateStatements(
      '__reactPreviewInspectorDescriptor',
    ),
    '/** Delegates candidate selection and Suspense loading to the entry-owned Inspector runtime. */',
    'function __reactPreviewInspectorRoot(props) {',
    "  const api = globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')];",
    "  if (typeof api?.createPageCandidateElement !== 'function') {",
    "    throw new Error('React Page Inspector candidate runtime is unavailable.');",
    '  }',
    '  return api.createPageCandidateElement(__reactPreviewInspectorCandidates, props);',
    '}',
    '__reactPreviewInspectorDescriptor.value = __reactPreviewInspectorRoot;',
    `export const previewTheme = ${themeImport.reference};`,
    `export const previewGlobalStyles = Object.freeze([${globalStyleImports.references.join(',')}]);`,
    'export default Object.freeze([Object.freeze(__reactPreviewInspectorDescriptor)]);',
  ].join('\n');
}

/** Creates stable eager imports for app-level global styles while page candidates remain lazy. */
export function createInspectorGlobalStyleImports(
  globalStyleImports: readonly PreviewGlobalStyleImportSelection[],
): { readonly references: readonly string[]; readonly statements: readonly string[] } {
  const references: string[] = [];
  const statements: string[] = [];
  for (const [index, globalStyleImport] of globalStyleImports.entries()) {
    assertExportName(globalStyleImport.exportName);
    const reference = `__reactPreviewInspectorGlobalStyle${index.toString()}`;
    references.push(reference);
    statements.push(
      `import { ${globalStyleImport.exportName} as ${reference} } from ${JSON.stringify(globalStyleImport.moduleSpecifier)};`,
    );
  }
  return { references, statements };
}

/** Creates one eager exact-theme import while every authored page candidate remains lazy. */
export function createInspectorThemeImport(themeImport: PreviewThemeImportSelection | undefined): {
  readonly reference: string;
  readonly statement?: string;
} {
  if (themeImport === undefined) return { reference: 'undefined' };
  assertExportName(themeImport.exportName);
  return {
    reference: '__reactPreviewInspectorTheme',
    statement: `import { ${themeImport.exportName} as __reactPreviewInspectorTheme } from ${JSON.stringify(themeImport.moduleSpecifier)};`,
  };
}

/** Rejects names that cannot be emitted in an ECMAScript named import clause. */
export function assertExportName(exportName: string): void {
  if (
    exportName !== 'default' &&
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
  ) {
    throw new TypeError(`Invalid React preview inspector root export name: ${exportName}`);
  }
}
