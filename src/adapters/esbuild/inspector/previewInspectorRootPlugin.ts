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
import {
  createPreviewInspectorDirectTargetSpecifier,
  PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER,
} from './previewInspectorTargetPlugin';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import type { PreviewThemeImportSelection } from '../previewTargetExports';
import type { PreviewGlobalStyleImportSelection } from '../previewGlobalStyleSelection';

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
    rootOwnsRouter: candidate.rootOwnsRouter,
    ...(candidate.rootStepIndex === undefined ? {} : { rootStepIndex: candidate.rootStepIndex }),
    ...(candidate.routeLocation === undefined ? {} : { routeLocation: candidate.routeLocation }),
    stopReason: candidate.stopReason,
    targetAutomaticProps: candidate.targetAutomaticProps,
  }));
  const candidateDefinitions = pageCandidates.map((candidate) => {
    const rootIsTarget =
      path.normalize(candidate.root.sourcePath) === path.normalize(plan.target.sourcePath);
    const rootSpecifier = rootIsTarget
      ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
      : candidate.root.sourcePath.replaceAll('\\', '/');
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
  const directTargetExportNames = [
    ...new Set([plan.target.exportName, ...Object.keys(plan.renderChainsByExport)]),
  ];
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
      pageCandidates: browserCandidates,
      renderChain: plan.renderChain,
      renderChainsByExport: plan.renderChainsByExport,
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

  return [
    ...(themeImport.statement === undefined ? [] : [themeImport.statement]),
    ...globalStyleImports.statements,
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
