/**
 * Generates executable VirtualPages from statically proven application-to-target render paths.
 *
 * The authored application root remains descriptor evidence, but generic projects execute the
 * nearest concrete page checkpoint. This avoids evaluating unrelated bootstraps while preserving
 * the route, omitted shell path, current-file instrumentation, global styles, and framework shells.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_TARGET_SPECIFIER,
} from '../previewPluginProtocol';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import {
  createPreviewInspectorDirectTargetSpecifier,
  PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER,
} from './previewInspectorTargetPlugin';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import type { PreviewThemeImportSelection } from '../previewTargetExports';
import type { PreviewGlobalStyleImportSelection } from '../previewGlobalStyleSelection';
import {
  PREVIEW_NEXT_APP_CONTROL_SIGNAL_SYMBOL_KEY,
  PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY,
} from '../previewNextAppNavigationRuntimeSource';
import {
  collectPreviewInspectorRenderBootstrapSlice,
  type PreviewInspectorRenderBootstrapSlice,
} from './previewInspectorRenderBootstrapSlice';
import { createPreviewInspectorVirtualPageCandidates } from './previewInspectorVirtualPagePlan';

const INSPECTOR_ROOT_PATH = 'selected-ancestor-root';
const INSPECTOR_RENDER_BOOTSTRAP_NAMESPACE = 'react-preview-inspector-render-bootstrap';
const INSPECTOR_RENDER_BOOTSTRAP_SPECIFIER_PREFIX = 'react-preview:inspector-render-bootstrap/';

/** One candidate-scoped virtual module containing a safe entry registration slice. */
interface PreviewInspectorRenderBootstrapModule {
  readonly candidateId: string;
  readonly slice: PreviewInspectorRenderBootstrapSlice;
  readonly specifier: string;
}

/** Inputs required to expose one inspector plan as a preview target descriptor. */
export interface PreviewInspectorRootPluginOptions {
  /** User-facing name of the originally selected export. */
  readonly displayName?: string;
  /** Exported app-level global styles recovered from wrappers above the safe mounted root. */
  readonly globalStyleImports?: readonly PreviewGlobalStyleImportSelection[];
  /** Optional first-paint cap preventing unselected alternate application roots from bundling. */
  readonly maximumPageCandidates?: number;
  /** Bounded real-owner plan produced from current editor-or-disk source. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** Supplies unsaved entry snapshots before the plugin falls back to bounded disk reads. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Neutral target props inferred without evaluating the selected project module. */
  readonly targetInference?: PreviewInferredExportProps;
  /** Exact page-corridor theme imported before any lazy authored root begins rendering. */
  readonly themeImport?: PreviewThemeImportSelection;
}

/**
 * Creates a virtual `react-preview:target` module that emits and loads generated VirtualPages.
 *
 * `watchFiles` contains the entire selected ancestry so saved source changes trigger esbuild's
 * rebuild pipeline even before the module graph changes shape. Dirty snapshot refresh remains
 * controlled by the existing preview panel dependency watcher.
 *
 * @param options Inspector ancestor plan and optional source label.
 * @returns Build-scoped bridge plugin used in place of the normal target gallery bridge.
 */
export function createPreviewInspectorRootPlugin(
  options: PreviewInspectorRootPluginOptions,
): Plugin {
  const renderBootstrapModules = collectRenderBootstrapModules(options);
  const renderBootstrapBySpecifier = new Map(
    renderBootstrapModules.map((module) => [module.specifier, module]),
  );
  const renderBootstrapSpecifiersByCandidateId = Object.fromEntries(
    renderBootstrapModules.map((module) => [module.candidateId, module.specifier]),
  );

  /** Resolves only the target specifier already imported by the generated browser entry. */
  function resolveInspectorRoot(arguments_: OnResolveArgs): OnResolveResult | undefined {
    return arguments_.path === PREVIEW_TARGET_SPECIFIER
      ? { namespace: PREVIEW_INSPECTOR_ROOT_NAMESPACE, path: INSPECTOR_ROOT_PATH }
      : undefined;
  }

  /** Loads a single descriptor whose candidate roots are independently lazy and hot-reloadable. */
  function loadInspectorRoot(): OnLoadResult {
    return {
      contents: createPreviewInspectorRootSource({
        ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
        ...(options.globalStyleImports === undefined
          ? {}
          : { globalStyleImports: options.globalStyleImports }),
        ...(options.maximumPageCandidates === undefined
          ? {}
          : { maximumPageCandidates: options.maximumPageCandidates }),
        plan: options.plan,
        renderBootstrapSpecifiersByCandidateId,
        ...(options.targetInference === undefined
          ? {}
          : { targetInference: options.targetInference }),
        ...(options.themeImport === undefined ? {} : { themeImport: options.themeImport }),
      }),
      loader: 'js',
      resolveDir: path.dirname(options.plan.root.sourcePath),
      watchFiles: [...options.plan.dependencyPaths],
    };
  }

  /** Resolves only render-bootstrap modules proven and generated for this exact build plan. */
  function resolveRenderBootstrap(arguments_: OnResolveArgs): OnResolveResult | undefined {
    return renderBootstrapBySpecifier.has(arguments_.path)
      ? { namespace: INSPECTOR_RENDER_BOOTSTRAP_NAMESPACE, path: arguments_.path }
      : undefined;
  }

  /** Loads one dependency-only registration slice before its selected page modules evaluate. */
  function loadRenderBootstrap(arguments_: OnLoadArgs): OnLoadResult | undefined {
    const module = renderBootstrapBySpecifier.get(arguments_.path);
    if (module === undefined) return undefined;
    return {
      contents: module.slice.source,
      loader: 'ts',
      resolveDir: path.dirname(module.slice.sourcePath),
      watchFiles: [module.slice.sourcePath],
    };
  }

  return {
    name: 'react-preview-inspector-root',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:target$/ }, resolveInspectorRoot);
      build.onResolve(
        { filter: /^react-preview:inspector-render-bootstrap\// },
        resolveRenderBootstrap,
      );
      build.onLoad(
        { filter: /^selected-ancestor-root$/, namespace: PREVIEW_INSPECTOR_ROOT_NAMESPACE },
        loadInspectorRoot,
      );
      build.onLoad(
        { filter: /.*/, namespace: INSPECTOR_RENDER_BOOTSTRAP_NAMESPACE },
        loadRenderBootstrap,
      );
    },
  };
}

/**
 * Builds candidate-scoped render bootstraps without importing or evaluating an application entry.
 *
 * The same entry slice is parsed once and can back several independently selectable page paths.
 * A slice is omitted when the entry is already one of the modules loaded for the page, because its
 * top-level registration will naturally run and repeating it can break single-registration APIs.
 */
function collectRenderBootstrapModules(
  options: PreviewInspectorRootPluginOptions,
): readonly PreviewInspectorRenderBootstrapModule[] {
  const virtualPages = createPreviewInspectorVirtualPageCandidates(
    options.plan.pageCandidates,
    options.maximumPageCandidates ?? options.plan.pageCandidates.length,
    options.plan.shallowVisualPaths ?? [],
  );
  const sliceBySourcePath = new Map<string, PreviewInspectorRenderBootstrapSlice | null>();
  const modules: PreviewInspectorRenderBootstrapModule[] = [];
  for (const virtualPage of virtualPages) {
    const entrySourcePath = virtualPage.authoredCandidate.renderPath?.entryPoint?.sourcePath;
    if (entrySourcePath === undefined || pageLoadsSourcePath(virtualPage, entrySourcePath))
      continue;
    const canonicalEntryPath = path.normalize(entrySourcePath);
    let slice = sliceBySourcePath.get(canonicalEntryPath);
    if (slice === undefined) {
      const sourceText = readRenderBootstrapSource(options, entrySourcePath);
      slice =
        sourceText === undefined
          ? null
          : (collectPreviewInspectorRenderBootstrapSlice(entrySourcePath, sourceText) ?? null);
      sliceBySourcePath.set(canonicalEntryPath, slice);
    }
    if (slice === null) continue;
    const candidateId = virtualPage.browserCandidate.id;
    modules.push(
      Object.freeze({
        candidateId,
        slice,
        specifier: `${INSPECTOR_RENDER_BOOTSTRAP_SPECIFIER_PREFIX}${encodeURIComponent(candidateId)}`,
      }),
    );
  }
  return Object.freeze(modules);
}

/** Returns true when page composition already imports the entry and will execute it exactly once. */
function pageLoadsSourcePath(
  virtualPage: ReturnType<typeof createPreviewInspectorVirtualPageCandidates>[number],
  sourcePath: string,
): boolean {
  const canonicalSourcePath = path.normalize(sourcePath);
  const loadedPaths = [
    virtualPage.contentCandidate.root.sourcePath,
    ...(virtualPage.contentCandidate.nextAppLayoutChain?.map((layout) => layout.sourcePath) ?? []),
    ...(virtualPage.contentCandidate.nextPagesShell === undefined
      ? []
      : [virtualPage.contentCandidate.nextPagesShell.app.sourcePath]),
    ...virtualPage.recipe.shells.map((shell) => shell.root.sourcePath),
  ];
  return loadedPaths.some((loadedPath) => path.normalize(loadedPath) === canonicalSourcePath);
}

/** Reads an unsaved snapshot first, then performs one bounded worker-side disk read as fallback. */
function readRenderBootstrapSource(
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

/**
 * Creates a lazy module promise that initializes its render dependency registry before page code.
 *
 * Dynamic sequencing matters: putting the bootstrap and page imports in the same `Promise.all`
 * would allow component module evaluation to race ahead of the registration it depends on.
 */
function createCandidateModuleImportPromise(
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
  readonly displayName?: string;
  readonly globalStyleImports?: readonly PreviewGlobalStyleImportSelection[];
  readonly maximumPageCandidates?: number;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly renderBootstrapSpecifiersByCandidateId?: Readonly<Record<string, string>>;
  readonly targetInference?: PreviewInferredExportProps;
  readonly themeImport?: PreviewThemeImportSelection;
}

/**
 * Generates a descriptor and lazy loaders for every statically proven VirtualPage candidate.
 *
 * When the live content root and target share a module, the import intentionally points at the
 * instrumentation facade. Otherwise the concrete page imports its descendant normally and the
 * target interceptor replaces the nested target edge wherever it is resolved. The application
 * root is serialized as provenance instead of being imported merely to prove page context.
 *
 * @param options Inspector plan and optional original export display label.
 * @returns Executable ESM source satisfying the existing preview entry target contract.
 */
export function createPreviewInspectorRootSource(
  options: PreviewInspectorRootSourceOptions,
): string {
  const { plan } = options;
  const virtualPageCandidates = createPreviewInspectorVirtualPageCandidates(
    plan.pageCandidates,
    options.maximumPageCandidates ?? plan.pageCandidates.length,
    plan.shallowVisualPaths ?? [],
  );
  const pageCandidates = virtualPageCandidates.map((candidate) => candidate.browserCandidate);
  for (const candidate of pageCandidates) {
    assertExportName(candidate.root.exportName);
  }
  for (const virtualPage of virtualPageCandidates) {
    for (const shell of virtualPage.recipe.shells) assertExportName(shell.root.exportName);
  }
  const browserCandidates = virtualPageCandidates.map((virtualPage) => {
    const { browserCandidate: candidate } = virtualPage;
    return {
      complete: candidate.complete,
      ...(candidate.contextModule === undefined ? {} : { contextModule: candidate.contextModule }),
      edges: candidate.edges,
      id: candidate.id,
      ...(candidate.renderPath === undefined ? {} : { renderPath: candidate.renderPath }),
      root: candidate.root,
      rootAutomaticProps: candidate.rootAutomaticProps,
      ...(candidate.rootInference === undefined
        ? {}
        : {
            rootInferredPropShape: candidate.rootInference.shape,
            rootInferredProps: candidate.rootInference.provenance,
          }),
      ...(candidate.nextAppLayoutChain === undefined
        ? {}
        : { nextAppLayoutChain: candidate.nextAppLayoutChain }),
      ...(candidate.nextPagesShell === undefined
        ? {}
        : { nextPagesShell: candidate.nextPagesShell }),
      rootOwnsRouter: candidate.rootOwnsRouter,
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
      targetAutomaticProps: candidate.targetAutomaticProps,
      ...(candidate.target === undefined ? {} : { target: candidate.target }),
      virtualPage: virtualPage.recipe,
    };
  });
  const candidateDefinitions = virtualPageCandidates.map((virtualPage) => {
    const { browserCandidate: candidate, contentCandidate, recipe } = virtualPage;
    const rootIsTarget =
      path.normalize(contentCandidate.root.sourcePath) === path.normalize(plan.target.sourcePath);
    const rootSpecifier = rootIsTarget
      ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
      : contentCandidate.root.sourcePath.replaceAll('\\', '/');
    const layoutSpecifiers = contentCandidate.nextAppLayoutChain?.map((layout) =>
      path.normalize(layout.sourcePath) === path.normalize(plan.target.sourcePath)
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
        path.normalize(plan.target.sourcePath);
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
      path.normalize(shell.root.sourcePath) === path.normalize(plan.target.sourcePath)
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
  // Register every statically proven current-file component behind its own dynamic import. The
  // browser invokes these loaders only for the explicit file-component overview; authored page
  // flow still mounts one selected caller path and preserves its exact UI.
  const directTargetExportNames =
    plan.contextModule === undefined
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
    path.normalize(plan.root.sourcePath) === path.normalize(plan.target.sourcePath);
  const descriptor = {
    automaticProps: {},
    displayName: options.displayName ?? plan.target.exportName,
    exportName: plan.target.exportName,
    ...(primaryRootIsTarget && options.targetInference !== undefined
      ? {
          inferredPropShape: options.targetInference.shape,
          inferredProps: options.targetInference.provenance,
        }
      : {}),
    inspector: {
      ancestry: plan.edges,
      complete: plan.complete,
      ...(plan.contextModule === undefined ? {} : { contextModule: plan.contextModule }),
      pageCandidates: browserCandidates,
      renderChain: plan.renderChain,
      renderChainsByExport: plan.renderChainsByExport,
      renderOutcomesByExport: plan.renderOutcomesByExport ?? {},
      root: plan.root,
      stopReason: plan.stopReason,
      target: plan.target,
      targetAutomaticProps: plan.targetAutomaticProps,
      ...(options.targetInference === undefined
        ? {}
        : { targetInferredPropShape: options.targetInference.shape }),
      targetInferredProps: options.targetInference?.provenance ?? [],
    },
  };
  const themeImport = createInspectorThemeImport(options.themeImport);
  const globalStyleImports = createInspectorGlobalStyleImports(options.globalStyleImports ?? []);
  const requiresNextAppRuntime = virtualPageCandidates.some(
    (candidate) => candidate.contentCandidate.routeLocation?.evidenceKind === 'next-app-filesystem',
  );
  const requiresNextPagesRuntime = virtualPageCandidates.some(
    (candidate) => candidate.contentCandidate.nextPagesShell !== undefined,
  );

  return [
    "import * as React from 'react';",
    ...(requiresNextPagesRuntime
      ? [
          "import __reactPreviewNextPagesRouter, { RouterContext as __reactPreviewNextPagesRouterContext } from 'next/router';",
        ]
      : []),
    ...(themeImport.statement === undefined ? [] : [themeImport.statement]),
    ...globalStyleImports.statements,
    '/** Mounts a concrete page checkpoint while retaining the full authored path as recipe data. */',
    'class __reactPreviewVirtualPageContentProbe extends React.Component {',
    '  componentDidMount() { this.props.onMount(); }',
    '  render() { return this.props.children; }',
    '}',
    '/** Isolates one inferred shell and restores its child when it throws or swallows children. */',
    'class __reactPreviewVirtualPageShellBoundary extends React.Component {',
    '  constructor(props) {',
    '    super(props);',
    '    this.bypassTimer = undefined;',
    '    this.contentMounted = false;',
    '    this.state = { bypass: false, error: null };',
    '  }',
    '  static getDerivedStateFromError(error) { return { bypass: true, error }; }',
    '  componentDidCatch(error) {',
    '    globalThis.console?.warn?.("[React Preview] VirtualPage shell bypassed", error);',
    '  }',
    '  componentDidMount() {',
    '    if (this.props.standalone) return;',
    '    // A real shell may return null during its first generated-data pass. Keep it mounted long',
    '    // enough for condition and payload resolution before falling back to the page body.',
    '    this.bypassTimer = globalThis.setTimeout(() => {',
    '      if (!this.contentMounted && !this.state.bypass) this.setState({ bypass: true });',
    '    }, 1800);',
    '  }',
    '  componentWillUnmount() {',
    '    if (this.bypassTimer !== undefined) globalThis.clearTimeout(this.bypassTimer);',
    '  }',
    '  render() {',
    '    if (this.state.bypass) return this.props.children;',
    '    const Shell = this.props.shell;',
    '    if (this.props.standalone) {',
    '      return React.createElement(Shell, { children: this.props.children });',
    '    }',
    '    const child = React.createElement(',
    '      __reactPreviewVirtualPageContentProbe,',
    '      { onMount: () => { this.contentMounted = true; } },',
    '      this.props.children,',
    '    );',
    '    return React.createElement(Shell, { children: child });',
    '  }',
    '}',
    /**
     * The generated module keeps this helper next to the composition boundary so anonymous default
     * page exports still have one stable, readable identity in React DevTools and the inspector tree.
     */
    '/** Derives one readable page-root name when its ESM export is the generic default. */',
    'function __reactPreviewReadPageName(recipe, exportName) {',
    '  const exportedName = recipe?.contentRoot?.exportName ?? exportName;',
    '  if (exportedName !== "default") return exportedName;',
    '  const sourcePath = String(recipe?.contentRoot?.sourcePath ?? "Page");',
    '  const pathSegments = sourcePath.split(String.fromCharCode(92)).join("/").split("/");',
    '  const fileName = pathSegments.at(-1) ?? "Page";',
    '  const fileStem = fileName.replace(/\\.[^.]+$/u, "");',
    '  const sourceStem = fileStem === "index" ? (pathSegments.at(-2) ?? "Page") : fileStem;',
    '  const inferredName = sourceStem',
    '    .split(/[^A-Za-z0-9_$]+/u)',
    '    .filter(Boolean)',
    '    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))',
    '    .join("");',
    '  return inferredName || "Page";',
    '}',
    '/** Builds one live page body plus its authored wrapper and sibling composition frame. */',
    'function __reactPreviewComposeVirtualPage(modules, exportName, shellExportNames, recipe) {',
    '  const Content = modules[0]?.[exportName];',
    '  if (Content === null || (typeof Content !== "function" && typeof Content !== "object")) {',
    '    throw new TypeError(`VirtualPage content export is unavailable: ${exportName}`);',
    '  }',
    '  const shells = shellExportNames.map((shellExportName, index) => {',
    '    const shellModule = modules[index + 1];',
    '    const Shell = shellModule?.[shellExportName] ?? shellModule?.default;',
    '    return Shell === null || (typeof Shell !== "function" && typeof Shell !== "object")',
    '      ? undefined',
    '      : Shell;',
    '  });',
    '  function ReactPreviewVirtualPage(props) {',
    '    let child = React.createElement(Content, Object.assign({}, props));',
    '    for (let index = shells.length - 1; index >= 0; index -= 1) {',
    '      const Shell = shells[index];',
    '      if (Shell === undefined) continue;',
    '      const shellRecipe = recipe?.shells?.[index];',
    '      if (shellRecipe?.relation === "sibling") {',
    '        const sibling = React.createElement(',
    '          __reactPreviewVirtualPageShellBoundary,',
    '          { key: shellRecipe?.root?.sourcePath ?? index, shell: Shell, standalone: true },',
    '        );',
    '        child = shellRecipe?.placement === "after"',
    '          ? React.createElement(React.Fragment, null, child, sibling)',
    '          : React.createElement(React.Fragment, null, sibling, child);',
    '      } else if (shellRecipe?.relation === "owner") {',
    '        // A corridor owner already imports and renders its selected inner path. Running it',
    '        // standalone preserves the authored Header/Sidebar placement instead of waiting for a',
    '        // children probe it may never consume; a thrown owner still falls back to `child`.',
    '        child = React.createElement(',
    '          __reactPreviewVirtualPageShellBoundary,',
    '          { key: shellRecipe?.root?.sourcePath ?? index, shell: Shell, standalone: true },',
    '          child,',
    '        );',
    '      } else {',
    '        child = React.createElement(',
    '          __reactPreviewVirtualPageShellBoundary,',
    '          { key: shellRecipe?.root?.sourcePath ?? index, shell: Shell },',
    '          child,',
    '        );',
    '      }',
    '    }',
    '    return child;',
    '  }',
    '  try {',
    '    Object.defineProperties(ReactPreviewVirtualPage, {',
    '      displayName: { value: `PagePreview(${__reactPreviewReadPageName(recipe, exportName)})` },',
    '      virtualPageRecipe: { value: Object.freeze(recipe), enumerable: false },',
    '    });',
    '  } catch {}',
    '  return ReactPreviewVirtualPage;',
    '}',
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
          '/** Keeps Next never-returning guards local while allowing surrounding layouts to render. */',
          'class __reactPreviewNextAppControlBoundary extends React.Component {',
          '  constructor(props) { super(props); this.state = { error: null }; }',
          '  static getDerivedStateFromError(error) { return { error }; }',
          '  render() {',
          '    const error = this.state.error;',
          '    if (error !== null) {',
          '      const signal = error?.[__reactPreviewNextAppControlSignalSymbol];',
          '      if (signal === undefined) throw error;',
          '      const destination = typeof signal.destination === "string"',
          '        ? ` · ${signal.destination}`',
          '        : "";',
          '      return React.createElement(',
          '        "section",',
          '        {',
          '          "data-react-preview-next-app-control": signal.kind,',
          '          style: {',
          '            border: "1px dashed #c98b2e", borderRadius: "6px", color: "#7a5318",',
          '            margin: "8px", padding: "10px",',
          '          },',
          '        },',
          '        React.createElement("strong", null, `Next ${signal.kind}() intercepted${destination}`),',
          '        React.createElement(',
          '          "button",',
          '          { onClick: () => this.setState({ error: null }), style: { marginLeft: "8px" } },',
          '          "Retry",',
          '        ),',
          '      );',
          '    }',
          '    return this.props.children;',
          '  }',
          '}',
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

/** Per-layout navigation context serialized beside one composed App Router candidate. */
interface PreviewNextAppLayoutNavigationValue {
  /** Active route segments below this exact layout/template boundary. */
  readonly segments: readonly string[];
  /** Known named slots remain neutral until a future bounded slot branch is selected. */
  readonly slots: Readonly<Record<string, readonly string[]>>;
}

/**
 * Derives Next's layout-relative segment hook values from the same filesystem route evidence.
 * Using source directories instead of splitting the final URL preserves route groups and collapses
 * catch-all values into the single segment returned by Next's public navigation hooks.
 */
function createNextAppLayoutNavigationValues(
  candidate: PreviewInspectorPageCandidate,
): readonly PreviewNextAppLayoutNavigationValue[] {
  const routeParams =
    candidate.routeLocation !== undefined && 'params' in candidate.routeLocation
      ? candidate.routeLocation.params
      : {};
  const pageDirectory = path.dirname(candidate.root.sourcePath);
  return Object.freeze(
    (candidate.nextAppLayoutChain ?? []).map((layout) => {
      const relativePath = path.relative(path.dirname(layout.sourcePath), pageDirectory);
      const segments =
        relativePath.startsWith('..') || path.isAbsolute(relativePath)
          ? []
          : relativePath
              .split(path.sep)
              .filter(Boolean)
              .flatMap((segment) => normalizeNextLayoutSegment(segment, routeParams));
      const slots = Object.fromEntries((layout.slotNames ?? []).map((slotName) => [slotName, []]));
      return Object.freeze({
        segments: Object.freeze(segments),
        slots: Object.freeze(slots),
      });
    }),
  );
}

/** Converts one filesystem segment into the public layout-hook representation. */
function normalizeNextLayoutSegment(
  sourceSegment: string,
  params: Readonly<Record<string, string | readonly string[]>>,
): readonly string[] {
  if (
    sourceSegment.startsWith('@') ||
    sourceSegment.startsWith('_') ||
    /^\([^)]*\)$/u.test(sourceSegment)
  ) {
    return Object.freeze([]);
  }
  const segment = sourceSegment.replace(/^(?:\(\.\.\.\)|\(\.\.\)|\(\.\))+/u, '');
  const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(segment);
  if (optionalCatchAll !== null) {
    const values = readNextLayoutParameterValues(params[optionalCatchAll[1] ?? '']);
    return values.length === 0 ? Object.freeze([]) : Object.freeze([values.join('/')]);
  }
  const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(segment);
  if (catchAll !== null) {
    const values = readNextLayoutParameterValues(params[catchAll[1] ?? '']);
    return Object.freeze([values.length === 0 ? (catchAll[1] ?? 'preview') : values.join('/')]);
  }
  const dynamic = /^\[([^\]]+)\]$/u.exec(segment);
  if (dynamic !== null) {
    const values = readNextLayoutParameterValues(params[dynamic[1] ?? '']);
    return Object.freeze([values[0] ?? dynamic[1] ?? 'preview']);
  }
  return Object.freeze([decodeNextLayoutSegment(segment)]);
}

/** Narrows scalar and catch-all route values to one immutable string sequence. */
function readNextLayoutParameterValues(value: string | readonly string[] | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (value === undefined) return [];
  return Array.from(value);
}

/** Decodes ordinary URL-safe segment spelling while keeping malformed escapes inspectable. */
function decodeNextLayoutSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/^%5f/iu, '_'));
  } catch {
    return segment;
  }
}

/** Creates stable eager imports for app-level global styles while page candidates remain lazy. */
function createInspectorGlobalStyleImports(
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
function createInspectorThemeImport(themeImport: PreviewThemeImportSelection | undefined): {
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
function assertExportName(exportName: string): void {
  if (
    exportName !== 'default' &&
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
  ) {
    throw new TypeError(`Invalid React preview inspector root export name: ${exportName}`);
  }
}
