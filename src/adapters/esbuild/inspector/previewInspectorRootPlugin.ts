/**
 * Exposes selectable authored ancestors through the existing preview target descriptor contract.
 * Candidate roots remain dynamic imports so only the chosen page branch loads in the webview.
 */
import path from 'node:path';
import type { OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
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

const INSPECTOR_ROOT_PATH = 'selected-ancestor-root';

/** Inputs required to expose one inspector plan as a preview target descriptor. */
export interface PreviewInspectorRootPluginOptions {
  /** User-facing name of the originally selected export. */
  readonly displayName?: string;
  /** Exported app-level global styles recovered from wrappers above the safe mounted root. */
  readonly globalStyleImports?: readonly PreviewGlobalStyleImportSelection[];
  /** Bounded real-owner plan produced from current editor-or-disk source. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** Neutral target props inferred without evaluating the selected project module. */
  readonly targetInference?: PreviewInferredExportProps;
  /** Exact page-corridor theme imported before any lazy authored root begins rendering. */
  readonly themeImport?: PreviewThemeImportSelection;
}

/**
 * Creates a virtual `react-preview:target` module importing the plan's real owner export.
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
        plan: options.plan,
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

  return {
    name: 'react-preview-inspector-root',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:target$/ }, resolveInspectorRoot);
      build.onLoad(
        { filter: /^selected-ancestor-root$/, namespace: PREVIEW_INSPECTOR_ROOT_NAMESPACE },
        loadInspectorRoot,
      );
    },
  };
}

/** Pure source generator inputs used by plugin and bridge contract tests. */
export interface PreviewInspectorRootSourceOptions {
  readonly displayName?: string;
  readonly globalStyleImports?: readonly PreviewGlobalStyleImportSelection[];
  readonly plan: PreviewInspectorAncestorPlan;
  readonly targetInference?: PreviewInferredExportProps;
  readonly themeImport?: PreviewThemeImportSelection;
}

/**
 * Generates a descriptor and lazy loaders for every statically proven authored page candidate.
 *
 * When root and target share a module, the import intentionally points at the instrumentation
 * facade. Otherwise the real ancestor imports its descendant normally and the target interceptor
 * replaces the nested target edge wherever it is resolved.
 *
 * @param options Inspector plan and optional original export display label.
 * @returns Executable ESM source satisfying the existing preview entry target contract.
 */
export function createPreviewInspectorRootSource(
  options: PreviewInspectorRootSourceOptions,
): string {
  const { plan } = options;
  const pageCandidates = plan.pageCandidates;
  for (const candidate of pageCandidates) {
    assertExportName(candidate.root.exportName);
  }
  const browserCandidates = pageCandidates.map((candidate) => ({
    complete: candidate.complete,
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
    ...(candidate.nextPagesShell === undefined ? {} : { nextPagesShell: candidate.nextPagesShell }),
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
  }));
  const candidateDefinitions = pageCandidates.map((candidate) => {
    const rootIsTarget =
      path.normalize(candidate.root.sourcePath) === path.normalize(plan.target.sourcePath);
    const rootSpecifier = rootIsTarget
      ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
      : candidate.root.sourcePath.replaceAll('\\', '/');
    const layoutSpecifiers = candidate.nextAppLayoutChain?.map((layout) =>
      path.normalize(layout.sourcePath) === path.normalize(plan.target.sourcePath)
        ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
        : layout.sourcePath.replaceAll('\\', '/'),
    );
    const nextAppRouteLocation =
      candidate.routeLocation?.evidenceKind === 'next-app-filesystem'
        ? candidate.routeLocation
        : undefined;
    if (nextAppRouteLocation !== undefined) {
      const imports = [rootSpecifier, ...(layoutSpecifiers ?? [])].map(
        (specifier) => `import(${JSON.stringify(specifier)})`,
      );
      return [
        '{ id: ',
        JSON.stringify(candidate.id),
        ', load: () => Promise.all([',
        imports.join(','),
        ']).then((modules) => __reactPreviewComposeNextAppPage(modules, ',
        JSON.stringify(candidate.root.exportName),
        ', ',
        JSON.stringify(nextAppRouteLocation.pathname),
        ', ',
        JSON.stringify(nextAppRouteLocation.params),
        ', ',
        JSON.stringify(nextAppRouteLocation.searchParams),
        ', ',
        JSON.stringify(candidate.nextAppLayoutChain?.map((layout) => layout.params) ?? []),
        ', ',
        JSON.stringify(createNextAppLayoutNavigationValues(candidate)),
        ', ',
        JSON.stringify(candidate.nextAppLayoutChain?.map((layout) => layout.slotNames ?? []) ?? []),
        ')) }',
      ].join('');
    }
    if (candidate.nextPagesShell !== undefined) {
      const appIsTarget =
        path.normalize(candidate.nextPagesShell.app.sourcePath) ===
        path.normalize(plan.target.sourcePath);
      const appSpecifier = appIsTarget
        ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
        : candidate.nextPagesShell.app.sourcePath.replaceAll('\\', '/');
      const syntheticPage = candidate.nextPagesShell.syntheticPage === true;
      const imports = (syntheticPage ? [appSpecifier] : [rootSpecifier, appSpecifier]).map(
        (specifier) => `import(${JSON.stringify(specifier)})`,
      );
      return [
        '{ id: ',
        JSON.stringify(candidate.id),
        ', load: () => Promise.all([',
        imports.join(','),
        ']).then((modules) => __reactPreviewComposeNextPagesPage(modules, ',
        JSON.stringify(candidate.root.exportName),
        ', ',
        JSON.stringify(syntheticPage),
        ')) }',
      ].join('');
    }
    return [
      '{ id: ',
      JSON.stringify(candidate.id),
      ', load: () => import(',
      JSON.stringify(rootSpecifier),
      ').then((module) => module[',
      JSON.stringify(candidate.root.exportName),
      ']) }',
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
  const requiresNextAppRuntime = pageCandidates.some(
    (candidate) => candidate.routeLocation?.evidenceKind === 'next-app-filesystem',
  );
  const requiresNextPagesRuntime = pageCandidates.some(
    (candidate) => candidate.nextPagesShell !== undefined,
  );
  const requiresFrameworkReactRuntime = requiresNextAppRuntime || requiresNextPagesRuntime;

  return [
    ...(requiresFrameworkReactRuntime ? ["import * as React from 'react';"] : []),
    ...(requiresNextPagesRuntime
      ? [
          "import __reactPreviewNextPagesRouter, { RouterContext as __reactPreviewNextPagesRouterContext } from 'next/router';",
        ]
      : []),
    ...(themeImport.statement === undefined ? [] : [themeImport.statement]),
    ...globalStyleImports.statements,
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
