/** Coordinates RootPlugin using bounded authored-source evidence. */
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import path from 'node:path';
import type { PreviewInspectorTargetMode } from '../../../domain/preview';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { registerPreviewApplicationStylesheetResolver } from '../previewApplicationStylesheetBridge';
import type { PreviewApplicationStylesheetImportSelection } from '../previewApplicationStylesheetSelection';
import type { PreviewGlobalStyleImportSelection } from '../previewGlobalStyleSelection';
import {
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_TARGET_SPECIFIER,
} from '../previewPluginProtocol';
import type { PreviewThemeImportSelection } from '../previewTargetExports';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import { type PreviewTypedPropValue } from '../typeOracle/previewTypedComponentProps';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorComponentReference,
} from './previewInspectorAncestorPlan';
import { selectPreviewInspectorExecutableCandidate } from './previewInspectorExecutableCandidateSelection';
import type { PreviewInspectorExecutionRootModuleContract } from './previewInspectorExecutionRootModuleContract';
import { registerPreviewInspectorPageExecutionEntryPlugin } from './previewInspectorPageExecutionEntryPlugin';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';
import {
  collectPreviewInspectorRenderBootstrapSlice,
  type PreviewInspectorRenderBootstrapSlice,
} from './previewInspectorRenderBootstrapSlice';
import {
  createPreviewInspectorRootSource,
  readRenderBootstrapSource,
} from './previewInspectorRootSource';
import type { PreviewInspectorTargetModuleContract } from './previewInspectorTargetModuleContract';
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
  /** Side-effect CSS recovered from exact application wrappers above the mounted page root. */
  readonly applicationStylesheetImports?: readonly PreviewApplicationStylesheetImportSelection[];
  /** User-facing name of the originally selected export. */
  readonly displayName?: string;
  /** Exported app-level global styles recovered from wrappers above the safe mounted root. */
  readonly globalStyleImports?: readonly PreviewGlobalStyleImportSelection[];
  /** Optional first-paint cap preventing unselected alternate application roots from bundling. */
  readonly maximumPageCandidates?: number;
  /** Frozen selected route/page/target slice; descriptor alternatives remain metadata only. */
  readonly pageExecutionCandidate?: PreviewInspectorPageExecutionCandidate;
  /** Compiler-proven exact binding for the selected PageExecution owner module. */
  readonly executionRootModuleContract?: PreviewInspectorExecutionRootModuleContract;
  /** Ordered, path-free retry alternatives for the current browser candidate. */
  readonly pageExecutionCandidates?: readonly PreviewInspectorPageExecutionCandidate[];
  /** Bounded real-owner plan produced from current editor-or-disk source. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** One persisted caller-path choice allowed to produce executable imports in this build. */
  readonly selectedPageCandidateId?: string;
  /** Supplies unsaved entry snapshots before the plugin falls back to bounded disk reads. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Runtime-only current-file identity derived from the frozen Page Execution route leaf. */
  readonly runtimeOwnershipTarget?: PreviewInspectorComponentReference;
  /** Neutral target props inferred without evaluating the selected project module. */
  readonly targetInference?: PreviewInferredExportProps;
  /** Explicit route intent shared by descriptor and bootstrap selection. */
  readonly targetMode?: PreviewInspectorTargetMode;
  /** Prepared-source target identity shared with the exact facade and PageExecution edge. */
  readonly targetModuleContract?: PreviewInspectorTargetModuleContract;
  /** Typed values for required target props that usage literals left missing. */
  readonly targetTypedProps?: Readonly<Record<string, PreviewTypedPropValue>> | undefined;
  /** Exact page-corridor theme imported before any lazy authored root begins rendering. */
  readonly themeImport?: PreviewThemeImportSelection;
}

/** Creates the Inspector root descriptor and build-scoped candidate loaders. */
export function createPreviewInspectorRootPlugin(
  options: PreviewInspectorRootPluginOptions,
): Plugin {
  assertTargetModuleContract(options);
  assertExecutionRootModuleContract(options);
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
        ...(options.applicationStylesheetImports === undefined
          ? {}
          : { applicationStylesheetImports: options.applicationStylesheetImports }),
        ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
        ...(options.globalStyleImports === undefined
          ? {}
          : { globalStyleImports: options.globalStyleImports }),
        ...(options.maximumPageCandidates === undefined
          ? {}
          : { maximumPageCandidates: options.maximumPageCandidates }),
        // prettier-ignore
        ...(options.pageExecutionCandidate === undefined ? {} : { pageExecutionCandidate: options.pageExecutionCandidate }),
        // prettier-ignore
        ...(options.pageExecutionCandidates === undefined ? {} : { pageExecutionCandidates: options.pageExecutionCandidates }),
        plan: options.plan,
        renderBootstrapSpecifiersByCandidateId,
        targetTypedProps: options.targetTypedProps,
        ...(options.targetMode === undefined ? {} : { targetMode: options.targetMode }),
        ...(options.runtimeOwnershipTarget === undefined
          ? {}
          : { runtimeOwnershipTarget: options.runtimeOwnershipTarget }),
        ...(options.selectedPageCandidateId === undefined
          ? {}
          : { selectedPageCandidateId: options.selectedPageCandidateId }),
        ...(options.targetInference === undefined
          ? {}
          : { targetInference: options.targetInference }),
        ...(options.themeImport === undefined ? {} : { themeImport: options.themeImport }),
      }),
      loader: 'js',
      resolveDir: path.dirname(options.plan.root.sourcePath),
      watchFiles: [
        ...options.plan.dependencyPaths,
        ...(options.applicationStylesheetImports ?? []).map((selection) => selection.importerPath),
      ],
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
      registerPreviewApplicationStylesheetResolver(
        build,
        options.applicationStylesheetImports ?? [],
      );
      build.onResolve(
        { filter: /^react-preview:inspector-render-bootstrap\// },
        resolveRenderBootstrap,
      );
      build.onLoad(
        { filter: /^selected-ancestor-root$/, namespace: PREVIEW_INSPECTOR_ROOT_NAMESPACE },
        loadInspectorRoot,
      );
      registerPreviewInspectorPageExecutionEntryPlugin(build, {
        ...(options.pageExecutionCandidate === undefined
          ? {}
          : { candidate: options.pageExecutionCandidate }),
        ...(options.executionRootModuleContract === undefined
          ? {}
          : { executionRootModuleContract: options.executionRootModuleContract }),
        target: options.runtimeOwnershipTarget ?? options.plan.target,
        ...(options.targetModuleContract === undefined
          ? {}
          : { targetModuleContract: options.targetModuleContract }),
      });
      build.onLoad(
        { filter: /.*/, namespace: INSPECTOR_RENDER_BOOTSTRAP_NAMESPACE },
        loadRenderBootstrap,
      );
    },
  };
}

/** Rejects compiler, descriptor, and PageExecution target identity drift before source generation. */
function assertTargetModuleContract(options: PreviewInspectorRootPluginOptions): void {
  const contract = options.targetModuleContract;
  if (contract === undefined) return;
  const target = options.runtimeOwnershipTarget ?? options.plan.target;
  if (
    path.normalize(contract.sourcePath) !== path.normalize(target.sourcePath) ||
    !contract.selectedExportNames.includes(target.exportName)
  ) {
    throw new TypeError(
      'Preview Inspector root target does not match the prepared target module contract.',
    );
  }
}

/** Rejects PageExecution owner drift before registering its virtual entry. */
function assertExecutionRootModuleContract(options: PreviewInspectorRootPluginOptions): void {
  const candidate = options.pageExecutionCandidate;
  const contract = options.executionRootModuleContract;
  if (candidate === undefined && contract === undefined) return;
  if (candidate === undefined || contract === undefined) {
    throw new TypeError(
      'Preview Inspector root requires one PageExecution execution-root contract.',
    );
  }
  const role = candidate.executionRootContract;
  if (
    contract.surfaceId !== role.surfaceId ||
    canonicalizeExistingPath(path.normalize(contract.sourcePath)) !==
      canonicalizeExistingPath(path.normalize(role.sourcePath)) ||
    contract.exportName !== role.exportName
  ) {
    throw new TypeError(
      'Preview Inspector root does not match the prepared execution-root module contract.',
    );
  }
}

/** Builds candidate-scoped entry registration slices without importing the entry module. */
function collectRenderBootstrapModules(
  options: PreviewInspectorRootPluginOptions,
): readonly PreviewInspectorRenderBootstrapModule[] {
  const virtualPages = createPreviewInspectorVirtualPageCandidates(
    options.plan.pageCandidates,
    options.maximumPageCandidates ?? options.plan.pageCandidates.length,
    options.plan.shallowVisualPaths ?? [],
    options.targetMode,
  );
  const executable = selectPreviewInspectorExecutableCandidate(
    virtualPages,
    options.selectedPageCandidateId,
  );
  const sliceBySourcePath = new Map<string, PreviewInspectorRenderBootstrapSlice | null>();
  const modules: PreviewInspectorRenderBootstrapModule[] = [];
  for (const virtualPage of executable === undefined ? [] : [executable.active]) {
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

/** Checks the normalized page, layout, application shell, and composed shell paths for one physical source. */
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
export { createPreviewInspectorRootSource } from './previewInspectorRootSource';
export type { PreviewInspectorRootSourceOptions } from './previewInspectorRootSource';
