/**
 * Prunes unrelated project-owned route branches from a statically proven Page Inspector corridor.
 *
 * A large application root commonly declares hundreds of React.lazy route branches. Esbuild must
 * otherwise emit every branch even though the pinned Inspector session can activate only the
 * candidate paths already proven by static render analysis. This plugin replaces out-of-path
 * project dynamic imports and syntax-proven eager leaf choices with inert ESM placeholders.
 * Ambiguous static imports, installed dependencies, setup loading, layouts, and every selected
 * target/ancestor module remain untouched.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { createPreviewLargePackageBarrelPlugin } from '../previewLargePackageBarrelPlugin';
import { PREVIEW_RESOLVE_GUARD } from '../previewPluginProtocol';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import { collectRenderedNextDynamicSpecifiers } from '../staticResources/previewNextDynamicInstrumentation';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import {
  collectPreviewStaticRouteProjectionInventory,
  createPreviewStaticRouteProjectionSource,
  type PreviewStaticRouteProjection,
  type PreviewStaticRouteProjectionInventory,
} from './previewInspectorStaticRouteProjection';
import {
  collectPreviewInspectorRuntimeHookProjectionInventory,
  collectPreviewInspectorShallowProjectionInventory,
  createPreviewInspectorShallowProjectionSource,
  type PreviewInspectorShallowProjection,
  type PreviewInspectorShallowProjectionInventory,
} from './previewInspectorShallowProjection';
import { hasPreviewInspectorAuthoredHookLogic } from './previewInspectorAuthoredHookLogic';
import {
  createPreviewInspectorVirtualPageComponentSource,
  type PreviewInspectorVirtualPageComponent,
} from './previewInspectorVirtualPageComponentSource';
import {
  createPreviewInspectorVirtualPageComponentRuntimeSource,
  PREVIEW_INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_SPECIFIER,
} from './previewInspectorVirtualPageComponentRuntimeSource';

const INSPECTOR_CORRIDOR_NAMESPACE = 'react-preview-inspector-corridor';
const INSPECTOR_CORRIDOR_PLACEHOLDER_PATH = 'omitted-deferred-route';
const INSPECTOR_STATIC_CORRIDOR_NAMESPACE = 'react-preview-inspector-static-corridor';
const INSPECTOR_SHALLOW_CORRIDOR_NAMESPACE = 'react-preview-inspector-shallow-corridor';
const INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE = 'react-preview-inspector-virtual-page-component';
const INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_NAMESPACE =
  'react-preview-inspector-virtual-page-component-runtime';
const MAX_DYNAMIC_IMPORTER_SOURCE_BYTES = 1024 * 1024;
const MAX_SMALL_DYNAMIC_IMPORTS = 24;
const MAX_SMALL_STATIC_ROUTE_IMPORTS = 0;
const MINIMUM_SELECTED_PACKAGE_BARREL_EXPORTS = 64;
const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

/** Bounded syntax facts used to distinguish a helper loader from a generated route registry. */
interface PreviewDynamicImporterEvidence {
  /** True when a small registry directly declares a path already selected by static analysis. */
  readonly hasCorridorTarget: boolean;
  /** Large/truncated registries are narrowed to a selected route instead of bundled wholesale. */
  readonly isBroadRegistry: boolean;
  /** Page-local `next/dynamic` requests whose bindings are visibly mounted in JSX. */
  readonly renderedNextDynamicSpecifiers: ReadonlySet<string>;
}

/** Build inputs required to bound deferred project branches without touching package dependencies. */
export interface PreviewInspectorCorridorPluginOptions {
  /** Optional first-paint limit after which dormant lazy choices become a generated registry. */
  readonly maximumSmallDynamicImports?: number;
  /** Optional first-paint limit after which proven eager leaf routes use inert projections. */
  readonly maximumSmallStaticRouteImports?: number;
  /** Enables direct leaf projection only for package roots imported by the selected fast corridor. */
  readonly optimizeSelectedPackageBarrels?: boolean;
  /** Static target-to-entry and mount-candidate evidence selected for this Page Inspector build. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** Nearest package root used to distinguish application sources from installed dependencies. */
  readonly projectRoot: string;
  /** Reads the current dirty editor source before falling back to the filesystem. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Existing compiler-owned resolver; reusing it avoids recursive esbuild resolution per route. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Trusted VS Code workspace that must contain every intercepted project source. */
  readonly workspaceRoot: string;
}

/**
 * Creates one esbuild boundary that keeps only dynamically imported authored corridor modules.
 *
 * @param options Inspector plan plus trusted package/workspace bounds.
 * @returns Build-scoped plugin; omitted modules are never evaluated by the extension or webview.
 */
export function createPreviewInspectorCorridorPlugin(
  options: PreviewInspectorCorridorPluginOptions,
): Plugin {
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const maximumSmallDynamicImports = Math.max(
    0,
    Math.floor(options.maximumSmallDynamicImports ?? MAX_SMALL_DYNAMIC_IMPORTS),
  );
  const maximumSmallStaticRouteImports = Math.max(
    0,
    Math.floor(options.maximumSmallStaticRouteImports ?? MAX_SMALL_STATIC_ROUTE_IMPORTS),
  );
  const contextMayCrossPackages = options.plan.contextModule !== undefined;
  const exactCorridorPaths = createPreviewInspectorCorridorPathSet(options.plan);
  const initialShallowExportsByPath = collectPreviewInspectorShallowExportsByPath(options.plan);
  const shallowExportsByPath = new Map(initialShallowExportsByPath);
  const shallowRuntimeHookExportsByPath = new Map<string, Set<string>>();
  const initialShallowVisualPaths = new Set(
    [...initialShallowExportsByPath.keys()].filter(
      (sourcePath) => !exactCorridorPaths.has(sourcePath),
    ),
  );
  const shallowVisualPaths = new Set(initialShallowVisualPaths);
  const corridorPaths = new Set([...exactCorridorPaths, ...shallowVisualPaths]);
  const initialSelectedPackageDemandPaths = new Set([
    ...corridorPaths,
    ...(options.plan.shallowVisualPaths?.map((item) => canonicalizeExistingPath(item.sourcePath)) ??
      []),
  ]);
  const selectedPackageDemandPaths = new Set(initialSelectedPackageDemandPaths);
  const corridorModuleStems = createPreviewInspectorCorridorModuleStemSet(options.plan);
  const routeParameterGroups = collectPreviewInspectorRouteParameterGroups(options.plan);
  const importerEvidenceByPath = new Map<string, Promise<PreviewDynamicImporterEvidence>>();
  const staticImporterEvidenceByPath = new Map<
    string,
    Promise<PreviewStaticRouteProjectionInventory>
  >();
  const shallowImporterEvidenceByPath = new Map<
    string,
    Promise<PreviewInspectorShallowProjectionInventory>
  >();
  const runtimeHookImporterEvidenceByPath = new Map<
    string,
    Promise<PreviewInspectorShallowProjectionInventory>
  >();
  const authoredHookEvidenceByPath = new Map<string, Promise<boolean>>();
  const expandedVirtualPageModuleExports = new Set<string>();

  /**
   * Follows component imports transitively below a VirtualPage root and cuts only proven hooks.
   *
   * Every statically rendered project component stays authentic. Each discovered module becomes a
   * new shallow-analysis root, so traversal continues until esbuild reaches leaves or revisits the
   * same module/export identity. Exact selected corridor modules cut only direct hook pass-through
   * leaves; hooks with authored state, branching, defaults, or value transforms become recursive
   * roots whose own data/effect leaves are classified on the next edge.
   */
  async function resolveShallowVisualChild(
    arguments_: OnResolveArgs,
  ): Promise<OnResolveResult | undefined> {
    if (
      (arguments_.kind !== 'import-statement' && arguments_.kind !== 'dynamic-import') ||
      (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
      arguments_.importer.length === 0 ||
      !path.isAbsolute(arguments_.importer)
    ) {
      return undefined;
    }
    const canonicalImporter = canonicalizeExistingPath(arguments_.importer);
    if (!corridorPaths.has(canonicalImporter)) return undefined;
    const evidence = shallowVisualPaths.has(canonicalImporter)
      ? await readShallowImporterEvidence(canonicalImporter)
      : await readRuntimeHookImporterEvidence(canonicalImporter);
    const projection = evidence.projectionsBySpecifier.get(arguments_.path);
    if (projection === undefined) return undefined;
    const resolvedPath = options.resolveModule(arguments_.path, arguments_.importer);
    if (resolvedPath === undefined || !SOURCE_MODULE_PATTERN.test(resolvedPath)) return undefined;
    const canonicalTarget = canonicalizeExistingPath(resolvedPath);
    if (
      exactCorridorPaths.has(canonicalTarget) ||
      !isPathInside(workspaceRoot, canonicalTarget) ||
      (!contextMayCrossPackages && !isPathInside(projectRoot, canonicalTarget)) ||
      containsDependencyDirectory(workspaceRoot, canonicalTarget)
    ) {
      return undefined;
    }
    if (await shouldRetainAuthoredHookLogic(canonicalTarget, projection)) {
      /*
       * Keep authored state, defaults, branching, and value transforms, then analyze this module as
       * another DFS root. Its direct data/effect hook leaves can still become generated projections
       * without erasing the JavaScript logic that produces the component-facing return value.
       */
      registerTransitiveVirtualPageModule(canonicalTarget, projection);
      return undefined;
    }
    if (shallowVisualPaths.has(canonicalImporter) && shouldExpandVirtualPageComponent(projection)) {
      /*
       * The facade imports the authentic module and gives it a component-local error boundary.
       * Registering the target as another analysis root turns esbuild's ordinary module traversal
       * into a cycle-safe DFS without an authored-hop or component-depth limit.
       */
      registerTransitiveVirtualPageModule(canonicalTarget, projection);
      return createVirtualPageComponentFacade(canonicalTarget, projection);
    }
    if (corridorPaths.has(canonicalTarget)) return undefined;
    return createShallowVisualProjection(canonicalImporter, projection);
  }

  /** Merges demanded exports before recursively analyzing one authentic JSX component module. */
  function registerTransitiveVirtualPageModule(
    sourcePath: string,
    projection: PreviewInspectorShallowProjection,
  ): void {
    let changed = false;
    const exportNames = new Set(shallowExportsByPath.get(sourcePath) ?? []);
    const runtimeHookExportNames = new Set(shallowRuntimeHookExportsByPath.get(sourcePath) ?? []);
    for (const exportName of projection.exportNames) {
      const identity = `${sourcePath}\0${exportName}`;
      if (!expandedVirtualPageModuleExports.has(identity)) {
        expandedVirtualPageModuleExports.add(identity);
        changed = true;
      }
      exportNames.add(exportName);
    }
    for (const exportName of projection.runtimeHookExportNames) {
      runtimeHookExportNames.add(exportName);
    }
    shallowExportsByPath.set(sourcePath, exportNames);
    shallowRuntimeHookExportsByPath.set(sourcePath, runtimeHookExportNames);
    shallowVisualPaths.add(sourcePath);
    corridorPaths.add(sourcePath);
    selectedPackageDemandPaths.add(sourcePath);
    if (changed) shallowImporterEvidenceByPath.delete(sourcePath);
  }

  /** Keeps selected project imports and coalesces deferred branches outside the proven corridor. */
  async function resolveDeferredBranch(
    arguments_: OnResolveArgs,
  ): Promise<OnResolveResult | undefined> {
    if (
      arguments_.kind !== 'dynamic-import' ||
      (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
      arguments_.importer.length === 0 ||
      !path.isAbsolute(arguments_.importer)
    ) {
      return undefined;
    }
    const canonicalImporter = canonicalizeExistingPath(arguments_.importer);
    if (
      !SOURCE_MODULE_PATTERN.test(canonicalImporter) ||
      !isPathInside(workspaceRoot, canonicalImporter) ||
      (!contextMayCrossPackages && !isPathInside(projectRoot, canonicalImporter)) ||
      containsDependencyDirectory(workspaceRoot, canonicalImporter)
    ) {
      return undefined;
    }
    if (matchesPreviewRouteParameters(arguments_.path, routeParameterGroups)) return undefined;
    const importerEvidence = await readDynamicImporterEvidence(canonicalImporter);
    if (
      corridorPaths.has(canonicalImporter) &&
      importerEvidence.renderedNextDynamicSpecifiers.has(arguments_.path)
    ) {
      return undefined;
    }
    if (
      importerEvidence.isBroadRegistry &&
      !matchesPreviewCorridorModuleStem(arguments_.path, corridorModuleStems)
    ) {
      return createOmittedDeferredBranch();
    }
    const resolvedPath = options.resolveModule(arguments_.path, arguments_.importer);
    if (resolvedPath === undefined || !SOURCE_MODULE_PATTERN.test(resolvedPath)) {
      if (!importerEvidence.isBroadRegistry) return undefined;
      return createOmittedDeferredBranch();
    }
    const canonicalTarget = canonicalizeExistingPath(resolvedPath);
    if (
      !isPathInside(workspaceRoot, canonicalTarget) ||
      (!contextMayCrossPackages && !isPathInside(projectRoot, canonicalTarget)) ||
      containsDependencyDirectory(workspaceRoot, canonicalTarget)
    ) {
      return undefined;
    }
    if (corridorPaths.has(canonicalTarget)) {
      return undefined;
    }
    if (
      !corridorPaths.has(canonicalImporter) &&
      !importerEvidence.hasCorridorTarget &&
      !importerEvidence.isBroadRegistry
    ) {
      return undefined;
    }
    return createOmittedDeferredBranch();
  }

  /**
   * Replaces only off-corridor eager imports proven to be leaf route component choices.
   *
   * This path is deliberately narrower than dynamic registry pruning: the importer itself must be
   * on the selected corridor, every runtime binding must have route-only syntax, and the resolved
   * source must remain inside trusted authored roots. Any missing proof keeps normal ESM behavior.
   */
  async function resolveStaticRouteBranch(
    arguments_: OnResolveArgs,
  ): Promise<OnResolveResult | undefined> {
    if (
      arguments_.kind !== 'import-statement' ||
      (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
      arguments_.importer.length === 0 ||
      !path.isAbsolute(arguments_.importer)
    ) {
      return undefined;
    }
    const canonicalImporter = canonicalizeExistingPath(arguments_.importer);
    if (
      !corridorPaths.has(canonicalImporter) ||
      !SOURCE_MODULE_PATTERN.test(canonicalImporter) ||
      !isPathInside(workspaceRoot, canonicalImporter) ||
      (!contextMayCrossPackages && !isPathInside(projectRoot, canonicalImporter)) ||
      containsDependencyDirectory(workspaceRoot, canonicalImporter)
    ) {
      return undefined;
    }
    const evidence = await readStaticImporterEvidence(canonicalImporter);
    if (evidence.branchCount <= maximumSmallStaticRouteImports) return undefined;
    const projection = evidence.projectionsBySpecifier.get(arguments_.path);
    if (projection === undefined) return undefined;
    const resolvedPath = options.resolveModule(arguments_.path, arguments_.importer);
    if (resolvedPath === undefined || !SOURCE_MODULE_PATTERN.test(resolvedPath)) return undefined;
    const canonicalTarget = canonicalizeExistingPath(resolvedPath);
    if (
      corridorPaths.has(canonicalTarget) ||
      !isPathInside(workspaceRoot, canonicalTarget) ||
      (!contextMayCrossPackages && !isPathInside(projectRoot, canonicalTarget)) ||
      containsDependencyDirectory(workspaceRoot, canonicalTarget)
    ) {
      return undefined;
    }
    return createOmittedStaticRouteBranch(canonicalImporter, projection);
  }

  /**
   * Reads each reached importer once and classifies its deferred requests without evaluating code.
   * Small helper modules remain intact unless they explicitly contain a selected-path sibling;
   * broad generated registries are narrowed by route evidence and share one omitted placeholder.
   */
  function readDynamicImporterEvidence(
    sourcePath: string,
  ): Promise<PreviewDynamicImporterEvidence> {
    const existing = importerEvidenceByPath.get(sourcePath);
    if (existing !== undefined) return existing;
    const pending = readBoundedSource(sourcePath).then((sourceText) => {
      if (sourceText === undefined) {
        return {
          hasCorridorTarget: false,
          // Missing or oversized source is not proof of a registry. Fail open so an authored lazy
          // child remains exact instead of being discarded because of transient I/O evidence.
          isBroadRegistry: false,
          renderedNextDynamicSpecifiers: new Set<string>(),
        };
      }
      const inventory = collectPreviewDynamicImportInventory(sourcePath, sourceText);
      const isBroadRegistry =
        inventory.truncated || inventory.specifiers.length > maximumSmallDynamicImports;
      const hasCorridorTarget =
        !isBroadRegistry &&
        inventory.specifiers.some((specifier) => {
          const resolvedPath = options.resolveModule(specifier, sourcePath);
          return (
            resolvedPath !== undefined && corridorPaths.has(canonicalizeExistingPath(resolvedPath))
          );
        });
      return {
        hasCorridorTarget,
        isBroadRegistry,
        renderedNextDynamicSpecifiers: collectRenderedNextDynamicSpecifiers(sourcePath, sourceText),
      };
    });
    importerEvidenceByPath.set(sourcePath, pending);
    return pending;
  }

  /** Parses one reached eager registry once per rebuild and retains only inert syntax facts. */
  function readStaticImporterEvidence(
    sourcePath: string,
  ): Promise<PreviewStaticRouteProjectionInventory> {
    const existing = staticImporterEvidenceByPath.get(sourcePath);
    if (existing !== undefined) return existing;
    const pending: Promise<PreviewStaticRouteProjectionInventory> = readBoundedSource(
      sourcePath,
    ).then((sourceText) =>
      sourceText === undefined
        ? {
            branchCount: 0,
            projectionsBySpecifier: new Map<string, PreviewStaticRouteProjection>(),
            routeBranchSpecifiers: new Set<string>(),
          }
        : collectPreviewStaticRouteProjectionInventory(sourcePath, sourceText),
    );
    staticImporterEvidenceByPath.set(sourcePath, pending);
    return pending;
  }

  /** Parses one retained shallow root once and scopes child projection to its selected exports. */
  function readShallowImporterEvidence(
    sourcePath: string,
  ): Promise<PreviewInspectorShallowProjectionInventory> {
    const existing = shallowImporterEvidenceByPath.get(sourcePath);
    if (existing !== undefined) return existing;
    const rootExportNames = shallowExportsByPath.get(sourcePath) ?? new Set(['default']);
    const rootRuntimeHookExportNames =
      shallowRuntimeHookExportsByPath.get(sourcePath) ?? new Set<string>();
    const pending = readBoundedSource(sourcePath).then((sourceText) =>
      sourceText === undefined
        ? {
            projectionsBySpecifier: new Map<string, PreviewInspectorShallowProjection>(),
            truncated: true,
          }
        : collectPreviewInspectorShallowProjectionInventory(
            sourcePath,
            sourceText,
            rootExportNames,
            rootRuntimeHookExportNames,
          ),
    );
    shallowImporterEvidenceByPath.set(sourcePath, pending);
    return pending;
  }

  /** Parses hook-only project boundaries on an exact selected module once per rebuild. */
  function readRuntimeHookImporterEvidence(
    sourcePath: string,
  ): Promise<PreviewInspectorShallowProjectionInventory> {
    const existing = runtimeHookImporterEvidenceByPath.get(sourcePath);
    if (existing !== undefined) return existing;
    const pending = readBoundedSource(sourcePath).then((sourceText) =>
      sourceText === undefined
        ? {
            projectionsBySpecifier: new Map<string, PreviewInspectorShallowProjection>(),
            truncated: true,
          }
        : collectPreviewInspectorRuntimeHookProjectionInventory(sourcePath, sourceText),
    );
    runtimeHookImporterEvidenceByPath.set(sourcePath, pending);
    return pending;
  }

  /**
   * Keeps custom-hook JavaScript when syntax proves it constructs the component-facing value.
   *
   * Direct pass-through hook leaves remain projectable. The retained module is registered as a
   * recursive shallow root so imported backend/session/effect leaves are still bounded one level
   * deeper instead of pulling the entire application graph back into the preview.
   */
  function shouldRetainAuthoredHookLogic(
    sourcePath: string,
    projection: PreviewInspectorShallowProjection,
  ): Promise<boolean> {
    if (
      projection.exportNames.length === 0 ||
      projection.runtimeHookExportNames.length !== projection.exportNames.length
    ) {
      return Promise.resolve(false);
    }
    const existing = authoredHookEvidenceByPath.get(sourcePath);
    if (existing !== undefined) return existing;
    const pending = readBoundedSource(sourcePath).then(
      (sourceText) =>
        sourceText !== undefined &&
        hasPreviewInspectorAuthoredHookLogic(
          sourcePath,
          sourceText,
          projection.runtimeHookExportNames,
        ),
    );
    authoredHookEvidenceByPath.set(sourcePath, pending);
    return pending;
  }

  /** Emits one shared side-effect-free module for every unselected generated route branch. */
  function loadDeferredBranch(arguments_: OnLoadArgs): OnLoadResult {
    if (arguments_.path !== INSPECTOR_CORRIDOR_PLACEHOLDER_PATH) {
      throw new TypeError('Unknown React Preview deferred corridor module.');
    }
    return {
      contents: [
        '/** Unselected project route omitted from this pinned static Page Inspector corridor. */',
        'function ReactPreviewDeferredCorridorRoute() { return null; }',
        'export default ReactPreviewDeferredCorridorRoute;',
        'export const __reactPreviewDeferredCorridorRoute = ReactPreviewDeferredCorridorRoute;',
      ].join('\n'),
      loader: 'js',
    };
  }

  /** Emits the exact default/named ESM surface requested by one omitted eager route import. */
  function loadStaticRouteBranch(arguments_: OnLoadArgs): OnLoadResult {
    const projection = readStaticProjectionPluginData(arguments_.pluginData);
    if (projection === undefined) {
      return { errors: [{ text: 'React Preview lost static corridor projection metadata.' }] };
    }
    return {
      contents: createPreviewStaticRouteProjectionSource(projection),
      loader: 'js',
    };
  }

  /** Emits a named structural component surface for one bounded shallow child import. */
  function loadShallowVisualChild(arguments_: OnLoadArgs): OnLoadResult {
    const projection = readShallowProjectionPluginData(arguments_.pluginData);
    if (projection === undefined) {
      return { errors: [{ text: 'React Preview lost shallow projection metadata.' }] };
    }
    return {
      contents: createPreviewInspectorShallowProjectionSource(projection),
      loader: 'js',
      resolveDir: projectRoot,
    };
  }

  /** Emits one authentic, independently recoverable component facade in the transitive JSX DFS. */
  function loadVirtualPageComponent(arguments_: OnLoadArgs): OnLoadResult {
    const component = readVirtualPageComponentPluginData(arguments_.pluginData);
    if (component === undefined) {
      return { errors: [{ text: 'React Preview lost VirtualPage component metadata.' }] };
    }
    return {
      contents: createPreviewInspectorVirtualPageComponentSource(component),
      loader: 'js',
      resolveDir: path.dirname(component.sourcePath),
    };
  }

  /** Emits the shared facade implementation once regardless of transitive component depth. */
  function loadVirtualPageComponentRuntime(): OnLoadResult {
    return {
      contents: createPreviewInspectorVirtualPageComponentRuntimeSource(),
      loader: 'js',
      resolveDir: projectRoot,
    };
  }

  return {
    name: 'react-preview-inspector-corridor',
    setup(build): void {
      if (options.optimizeSelectedPackageBarrels === true) {
        void createPreviewLargePackageBarrelPlugin({
          allowPhysicalLeafProjection: true,
          minimumBarrelExports: MINIMUM_SELECTED_PACKAGE_BARREL_EXPORTS,
          packageDemandSourcePaths: selectedPackageDemandPaths,
          ...(options.readSource === undefined ? {} : { readSource: options.readSource }),
          resolvePackageRoot: options.resolveModule,
          workspaceRoot,
        }).setup(build);
      }
      // Persistent esbuild contexts reuse the plugin closure across hot rebuilds. Syntax evidence
      // must therefore be reread at each build boundary instead of retaining a stale generated
      // registry after an authored source save.
      build.onStart(() => {
        importerEvidenceByPath.clear();
        runtimeHookImporterEvidenceByPath.clear();
        shallowImporterEvidenceByPath.clear();
        authoredHookEvidenceByPath.clear();
        staticImporterEvidenceByPath.clear();
        expandedVirtualPageModuleExports.clear();
        shallowExportsByPath.clear();
        shallowRuntimeHookExportsByPath.clear();
        for (const [sourcePath, exportNames] of initialShallowExportsByPath) {
          shallowExportsByPath.set(sourcePath, new Set(exportNames));
        }
        shallowVisualPaths.clear();
        for (const sourcePath of initialShallowVisualPaths) shallowVisualPaths.add(sourcePath);
        corridorPaths.clear();
        for (const sourcePath of exactCorridorPaths) corridorPaths.add(sourcePath);
        for (const sourcePath of shallowVisualPaths) corridorPaths.add(sourcePath);
        selectedPackageDemandPaths.clear();
        for (const sourcePath of initialSelectedPackageDemandPaths) {
          selectedPackageDemandPaths.add(sourcePath);
        }
      });
      build.onResolve(
        { filter: /.*/, namespace: INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE },
        (arguments_) => {
          if (arguments_.path === PREVIEW_INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_SPECIFIER) {
            return {
              namespace: INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_NAMESPACE,
              path: 'runtime',
            };
          }
          return path.isAbsolute(arguments_.path)
            ? {
                namespace: 'file',
                path: arguments_.path,
                pluginData: PREVIEW_RESOLVE_GUARD,
              }
            : undefined;
        },
      );
      build.onResolve({ filter: /.*/ }, resolveShallowVisualChild);
      build.onResolve({ filter: /.*/ }, resolveDeferredBranch);
      build.onResolve({ filter: /.*/ }, resolveStaticRouteBranch);
      build.onLoad({ filter: /.*/, namespace: INSPECTOR_CORRIDOR_NAMESPACE }, loadDeferredBranch);
      build.onLoad(
        { filter: /.*/, namespace: INSPECTOR_STATIC_CORRIDOR_NAMESPACE },
        loadStaticRouteBranch,
      );
      build.onLoad(
        { filter: /.*/, namespace: INSPECTOR_SHALLOW_CORRIDOR_NAMESPACE },
        loadShallowVisualChild,
      );
      build.onLoad(
        { filter: /.*/, namespace: INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE },
        loadVirtualPageComponent,
      );
      build.onLoad(
        { filter: /.*/, namespace: INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_NAMESPACE },
        loadVirtualPageComponentRuntime,
      );
    },
  };
}

/**
 * Selects a statically rendered component boundary for authentic VirtualPage traversal.
 *
 * Hook-only imports remain demand-shaped stubs and wildcard surfaces fail open because neither is
 * a component identity. All ordinary named/default component projections are admitted regardless
 * of semantic filename, allowing headers, sidebars, feature content, overlays, and the selected
 * file to be represented by their authored code at any graph depth.
 */
function shouldExpandVirtualPageComponent(projection: PreviewInspectorShallowProjection): boolean {
  const runtimeHookExportNames = new Set(projection.runtimeHookExportNames);
  return (
    !projection.exportNames.includes('*') &&
    projection.exportNames.some((exportName) => !runtimeHookExportNames.has(exportName))
  );
}

/** Returns one stable virtual identity so thousands of discarded registry edges share output. */
function createOmittedDeferredBranch(): OnResolveResult {
  return {
    namespace: INSPECTOR_CORRIDOR_NAMESPACE,
    path: INSPECTOR_CORRIDOR_PLACEHOLDER_PATH,
  };
}

/** Returns an importer-scoped virtual identity so different named ESM demands cannot collide. */
function createOmittedStaticRouteBranch(
  importerPath: string,
  projection: PreviewStaticRouteProjection,
): OnResolveResult {
  return {
    namespace: INSPECTOR_STATIC_CORRIDOR_NAMESPACE,
    path: `${importerPath}\0${projection.moduleSpecifier}`,
    pluginData: projection,
    sideEffects: false,
  };
}

/** Creates an importer-scoped virtual identity for one shallow child component surface. */
function createShallowVisualProjection(
  importerPath: string,
  projection: PreviewInspectorShallowProjection,
): OnResolveResult {
  return {
    namespace: INSPECTOR_SHALLOW_CORRIDOR_NAMESPACE,
    path: `${importerPath}\0${projection.moduleSpecifier}`,
    pluginData: projection,
    sideEffects: false,
  };
}

/**
 * Creates one stable module/export identity for an authentic transitive VirtualPage component.
 *
 * The identity deliberately excludes the importer. If authored modules form a render cycle,
 * esbuild reaches the same virtual module again and closes the graph instead of generating another
 * hop. Different demanded export sets remain distinct so named ESM surfaces stay exact.
 */
function createVirtualPageComponentFacade(
  sourcePath: string,
  projection: PreviewInspectorShallowProjection,
): OnResolveResult {
  const exportIdentity = [...projection.exportNames].sort().join(',');
  return {
    namespace: INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE,
    path: JSON.stringify([sourcePath, exportIdentity]),
    pluginData: {
      projection,
      sourcePath,
    } satisfies PreviewInspectorVirtualPageComponent,
    sideEffects: false,
  };
}

/** Validates private projection data before generating executable ESM source. */
function readStaticProjectionPluginData(value: unknown): PreviewStaticRouteProjection | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('moduleSpecifier' in value) ||
    typeof value.moduleSpecifier !== 'string' ||
    !('exportNames' in value) ||
    !Array.isArray(value.exportNames) ||
    !value.exportNames.every((name) => typeof name === 'string')
  ) {
    return undefined;
  }
  let neutralRouteBasePath: string | undefined;
  if ('neutralRouteBasePath' in value) {
    if (typeof value.neutralRouteBasePath !== 'string') return undefined;
    neutralRouteBasePath = value.neutralRouteBasePath;
  }
  return {
    exportNames: value.exportNames,
    moduleSpecifier: value.moduleSpecifier,
    ...(neutralRouteBasePath === undefined ? {} : { neutralRouteBasePath }),
  };
}

/** Validates shallow projection metadata before generating a browser module. */
function readShallowProjectionPluginData(
  value: unknown,
): PreviewInspectorShallowProjection | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('moduleSpecifier' in value) ||
    typeof value.moduleSpecifier !== 'string' ||
    !('exportNames' in value) ||
    !Array.isArray(value.exportNames) ||
    !value.exportNames.every((name) => typeof name === 'string') ||
    !('runtimeHookExportNames' in value) ||
    !Array.isArray(value.runtimeHookExportNames) ||
    !value.runtimeHookExportNames.every((name) => typeof name === 'string')
  ) {
    return undefined;
  }
  return {
    exportNames: Object.freeze([...value.exportNames]),
    moduleSpecifier: value.moduleSpecifier,
    runtimeHookExportNames: Object.freeze([...value.runtimeHookExportNames]),
  };
}

/** Validates private authentic-component data before importing a project source into a facade. */
function readVirtualPageComponentPluginData(
  value: unknown,
): PreviewInspectorVirtualPageComponent | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('sourcePath' in value) ||
    typeof value.sourcePath !== 'string' ||
    !path.isAbsolute(value.sourcePath) ||
    !('projection' in value)
  ) {
    return undefined;
  }
  const projection = readShallowProjectionPluginData(value.projection);
  if (projection === undefined) return undefined;
  return {
    projection,
    sourcePath: value.sourcePath,
  };
}

/**
 * Creates cheap lexical hints for the rare selected module hidden in a broad generated registry.
 * Resolving every branch defeats the fast corridor, while resolving matching stems preserves a
 * direct selected route even when no dynamic route parameter was statically available.
 */
function createPreviewInspectorCorridorModuleStemSet(
  plan: PreviewInspectorAncestorPlan,
): ReadonlySet<string> {
  const stems = new Set<string>();
  const selectedPaths = [
    plan.root.sourcePath,
    plan.target.sourcePath,
    ...plan.pageCandidates.flatMap((candidate) => [
      candidate.root.sourcePath,
      ...(candidate.renderPath?.steps.flatMap((step) => [
        step.sourcePath,
        ...(step.evidenceSourcePaths ?? []),
      ]) ?? []),
    ]),
    ...Object.values(plan.renderChainsByExport).flatMap((chain) =>
      chain.paths.flatMap((candidate) =>
        candidate.steps.flatMap((step) => [step.sourcePath, ...(step.evidenceSourcePaths ?? [])]),
      ),
    ),
    ...(plan.shallowVisualPaths?.map((item) => item.sourcePath) ?? []),
  ];
  for (const sourcePath of selectedPaths) {
    const extension = path.extname(sourcePath);
    const fileStem = path.basename(sourcePath, extension).toLowerCase();
    stems.add(
      fileStem === 'index' ? path.basename(path.dirname(sourcePath)).toLowerCase() : fileStem,
    );
  }
  return stems;
}

/** Groups retained shallow roots by exact source and runtime export for plugin-time analysis. */
function collectPreviewInspectorShallowExportsByPath(
  plan: PreviewInspectorAncestorPlan,
): ReadonlyMap<string, ReadonlySet<string>> {
  const exportsByPath = new Map<string, Set<string>>();
  for (const item of plan.shallowVisualPaths ?? []) {
    /*
     * Route alternatives are inactive page outcomes and wrappers already belong to the exact
     * corridor. Siblings and ordinary component props are requested first-depth page composition:
     * a frame's `component={Header}` must keep Header authentic while projecting its descendants.
     */
    if (item.relation === 'wrapper' || item.relation === 'route-alternative') continue;
    const sourcePath = canonicalizeExistingPath(item.sourcePath);
    const exportNames = exportsByPath.get(sourcePath) ?? new Set<string>();
    exportNames.add(item.exportName);
    exportsByPath.set(sourcePath, exportNames);
  }
  return new Map(
    [...exportsByPath].map(([sourcePath, exportNames]) => [
      sourcePath,
      new Set(exportNames) as ReadonlySet<string>,
    ]),
  );
}

/** Checks only a dynamic specifier's final path segment before paying for project resolution. */
function matchesPreviewCorridorModuleStem(
  moduleSpecifier: string,
  corridorModuleStems: ReadonlySet<string>,
): boolean {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
  const finalSegment = cleanSpecifier.split(/[\\/]/u).filter(Boolean).at(-1);
  if (finalSegment === undefined) return false;
  const extension = path.extname(finalSegment);
  return corridorModuleStems.has(path.basename(finalSegment, extension).toLowerCase());
}

/** Reads a source only after a file-size check so resolver-time evidence remains memory-bounded. */
async function readBoundedSource(sourcePath: string): Promise<string | undefined> {
  try {
    const sourceStats = await stat(sourcePath);
    if (!sourceStats.isFile() || sourceStats.size > MAX_DYNAMIC_IMPORTER_SOURCE_BYTES) {
      return undefined;
    }
    const sourceText = await readFile(sourcePath, 'utf8');
    return Buffer.byteLength(sourceText, 'utf8') <= MAX_DYNAMIC_IMPORTER_SOURCE_BYTES
      ? sourceText
      : undefined;
  } catch {
    return undefined;
  }
}

/** Collects every normalized source that proves a selectable candidate or render-chain path. */
function createPreviewInspectorCorridorPathSet(
  plan: PreviewInspectorAncestorPlan,
): ReadonlySet<string> {
  const sourcePaths = new Set<string>([
    plan.root.sourcePath,
    plan.target.sourcePath,
    ...(plan.contextModule === undefined ? [] : plan.contextModule.importPath),
    ...plan.pageCandidates.flatMap((candidate) => [
      candidate.root.sourcePath,
      ...(candidate.nextAppLayoutChain?.map((layout) => layout.sourcePath) ?? []),
      ...(candidate.renderPath?.steps.flatMap((step) => [
        step.sourcePath,
        ...(step.evidenceSourcePaths ?? []),
      ]) ?? []),
      ...(candidate.renderPath?.entryPoint === undefined
        ? []
        : [candidate.renderPath.entryPoint.sourcePath]),
    ]),
    ...Object.values(plan.renderChainsByExport).flatMap((renderChain) => [
      ...renderChain.paths.flatMap((candidate) => [
        ...candidate.steps.flatMap((step) => [
          step.sourcePath,
          ...(step.evidenceSourcePaths ?? []),
        ]),
        ...(candidate.entryPoint === undefined ? [] : [candidate.entryPoint.sourcePath]),
      ]),
    ]),
    ...(plan.shallowVisualPaths
      ?.filter((item) => item.relation === 'wrapper')
      .map((item) => item.sourcePath) ?? []),
  ]);
  return new Set([...sourcePaths].map(canonicalizeExistingPath));
}

/**
 * Collects exact Next App Router parameter choices for every selectable page candidate.
 * Group boundaries matter: one deferred request must satisfy all values from one candidate, never
 * an accidental union assembled from unrelated routes.
 */
function collectPreviewInspectorRouteParameterGroups(
  plan: PreviewInspectorAncestorPlan,
): readonly (readonly string[])[] {
  const groups = plan.pageCandidates.flatMap((candidate) => {
    const route = candidate.routeLocation;
    if (route?.evidenceKind !== 'next-app-filesystem' || !('params' in route)) return [];
    const values = Object.values(route.params).flatMap((value) =>
      typeof value === 'string' ? [value] : [...value],
    );
    const normalizedValues = [...new Set(values.map(normalizeRouteParameterValue).filter(Boolean))];
    return normalizedValues.length === 0 ? [] : [Object.freeze(normalizedValues)];
  });
  return Object.freeze(groups);
}

/** Keeps one literal lazy branch when its path contains every selected route parameter segment. */
function matchesPreviewRouteParameters(
  moduleSpecifier: string,
  parameterGroups: readonly (readonly string[])[],
): boolean {
  if (parameterGroups.length === 0) return false;
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
  const segments = new Set(
    cleanSpecifier.split(/[\\/]/u).map(normalizeRouteParameterValue).filter(Boolean),
  );
  return parameterGroups.some((group) => group.every((value) => segments.has(value)));
}

/** Normalizes path-safe evidence without decoding arbitrary URL or filesystem syntax. */
function normalizeRouteParameterValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/gu, '');
}

/** Checks trusted-root containment while rejecting sibling-prefix lookalikes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Leaves installed or vendored dependency graphs under their normal package runtime semantics. */
function containsDependencyDirectory(rootPath: string, candidatePath: string): boolean {
  return path
    .relative(rootPath, candidatePath)
    .split(path.sep)
    .some((segment) => segment === 'node_modules');
}
