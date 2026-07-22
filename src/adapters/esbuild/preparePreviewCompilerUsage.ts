/**
 * Prepares target-centric usage evidence or a non-component Next page context for one build.
 * Keeping this orchestration outside the compiler preserves its 1000-line boundary and makes the
 * expensive package inventory decision explicit: fast previews remain direct, while full Page
 * Inspector builds may promote a helper module only after a consuming page is statically proven.
 */
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import { EMPTY_TARGET_USAGE_PROPS } from './previewCompilerDefaults';
import type { PreviewCompilerTargetSelection } from './previewImperativeEntryTarget';
import {
  createPreviewInspectorModuleConsumerPagePlan,
  hasPreviewInspectorCallableModuleExports,
} from './inspector/previewInspectorModuleConsumerPagePlan';
import { createPreviewInspectorNextAppDirectRoutePlan } from './inspector/previewInspectorNextAppDirectRoutePlan';
import { createPreviewInspectorNextAppModulePagePlan } from './inspector/previewInspectorNextAppModulePagePlan';
import type { PreviewProjectUsageCache } from './previewProjectUsageCache';
import type { createPreviewStaticModuleResolver } from './previewStaticModuleResolver';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';
import { collectPreviewNextAppDirectRouteInventory } from './previewNextAppDirectRouteInventory';
import { shouldPreferPreviewModulePageContext } from './previewTargetExports';
import { shouldEscalatePreviewAncestorSearch } from './previewWorkspaceAncestorPolicy';

const MAXIMUM_CONTEXT_SOURCE_BYTES = 4 * 1024 * 1024;
const NEXT_APP_DIRECT_ROUTE_MODULE_PATTERN = /^(?:layout|page|template)\.[cm]?[jt]sx?$/u;
const NEXT_APP_ROUTE_STATE_MODULE_PATTERN = /^(?:error|loading|not-found)\.[cm]?[jt]sx?$/u;

/** Static resolver shape inferred from the project-aware resolver factory. */
type PreviewCompilerStaticModuleResolver = ReturnType<typeof createPreviewStaticModuleResolver>;

/** Inputs shared by normal reverse component analysis and module-to-page promotion. */
export interface PreparePreviewCompilerUsageOptions {
  /** Compiler-lifetime inventory and source analysis cache. */
  readonly cache: PreviewProjectUsageCache;
  /** Cancels stale inventory, source, and import-path work with the compiler's combined signal. */
  readonly signal?: AbortSignal;
  /** Nearest package root selected for the current editor module. */
  readonly projectRoot: string;
  /** Whether package metadata proves that this project uses the Next runtime. */
  readonly projectUsesNextRuntime: boolean;
  /** Active request containing dirty snapshots and render-mode intent. */
  readonly request: PreviewBuildRequest;
  /** Resolver whose exact aliases must agree with the eventual esbuild graph. */
  readonly resolver: PreviewCompilerStaticModuleResolver;
  /** Runtime setup kind controls whether ordinary parent slices are useful. */
  readonly setupKind: 'custom' | 'none' | 'storybook';
  /** Ordinary or synthesized target exports selected before usage analysis. */
  readonly targetSelection: PreviewCompilerTargetSelection;
  /** Trusted canonical workspace that bounds every path and source read. */
  readonly workspaceRoot: string;
}

/** Initial package evidence plus the reusable inventory for implicit runtime-global discovery. */
export interface PreparedPreviewCompilerUsage {
  readonly implicitGlobalSourcePaths: readonly string[];
  readonly packageTargetUsageProps: PreviewTargetUsageProps;
}

/**
 * Chooses normal component analysis or one consuming Next page for an authored source module.
 *
 * The source-context path intentionally returns at most one lazy page root. If no page can be
 * proven, ordinary target discovery resumes. Empty files retain the existing non-evaluating
 * gallery behavior, while component exports outside Next continue through generic ancestry.
 */
export async function preparePreviewCompilerUsage(
  options: PreparePreviewCompilerUsageOptions,
): Promise<PreparedPreviewCompilerUsage> {
  const { request, targetSelection } = options;
  const signal = options.signal;
  const useFastPreparation = request.preparationMode === 'fast';
  const hasPreviewableTarget = targetSelection.targetExports.length > 0;
  const shouldTryGenericConsumerContext =
    !useFastPreparation &&
    request.renderMode === 'page-inspector' &&
    !targetSelection.isImperativeEntry &&
    hasPreviewInspectorCallableModuleExports(request.documentPath, targetSelection.sourceText);
  const shouldTryNextModuleContext =
    options.projectUsesNextRuntime &&
    request.renderMode === 'page-inspector' &&
    !targetSelection.isImperativeEntry &&
    (NEXT_APP_ROUTE_STATE_MODULE_PATTERN.test(path.basename(request.documentPath)) ||
      shouldPreferPreviewModulePageContext(
        request.documentPath,
        request.sourceText,
        targetSelection.inspectorExportName,
      )) &&
    !NEXT_APP_DIRECT_ROUTE_MODULE_PATTERN.test(path.basename(request.documentPath));
  const shouldTryModulePageContext = shouldTryNextModuleContext || shouldTryGenericConsumerContext;
  const shouldTryDirectRouteContext =
    useFastPreparation &&
    options.projectUsesNextRuntime &&
    request.renderMode === 'page-inspector' &&
    !targetSelection.isImperativeEntry &&
    targetSelection.inspectorExportName === 'default' &&
    NEXT_APP_DIRECT_ROUTE_MODULE_PATTERN.test(path.basename(request.documentPath));
  if (
    (!hasPreviewableTarget && !shouldTryModulePageContext) ||
    (useFastPreparation && !shouldTryModulePageContext && !shouldTryDirectRouteContext)
  ) {
    return {
      implicitGlobalSourcePaths: Object.freeze([]),
      packageTargetUsageProps: EMPTY_TARGET_USAGE_PROPS,
    };
  }

  if (shouldTryDirectRouteContext) {
    const snapshotSourceByPath = createSnapshotSourceMap(request);
    const sourcePaths = await collectPreviewNextAppDirectRouteInventory({
      additionalSourcePaths: snapshotSourceByPath.keys(),
      documentPath: request.documentPath,
      projectRoot: options.projectRoot,
      ...(signal === undefined ? {} : { signal }),
    });
    const inspectorPlan = await createPreviewInspectorNextAppDirectRoutePlan({
      documentPath: request.documentPath,
      readSource: createContextSourceReader(options, snapshotSourceByPath),
      resolveModule: options.resolver.resolve,
      sourcePaths,
    });
    if (inspectorPlan !== undefined) {
      return createPreparedInspectorUsage(options, inspectorPlan);
    }
  }
  if (useFastPreparation) {
    return {
      implicitGlobalSourcePaths: Object.freeze([]),
      packageTargetUsageProps: EMPTY_TARGET_USAGE_PROPS,
    };
  }

  let sourcePaths = await options.cache.getSourcePaths(
    options.workspaceRoot,
    options.projectRoot,
    signal,
  );
  if (shouldTryModulePageContext) {
    const snapshotSourceByPath = createSnapshotSourceMap(request);
    const createPlan = async (
      inventoryPaths: readonly string[],
    ): ReturnType<typeof createPreviewInspectorNextAppModulePagePlan> => {
      const sourcePathsWithSnapshots = mergeInventorySnapshots(
        inventoryPaths,
        snapshotSourceByPath.keys(),
        options.workspaceRoot,
      );
      const readSource = createContextSourceReader(options, snapshotSourceByPath);
      const nextPlan = shouldTryNextModuleContext
        ? await createPreviewInspectorNextAppModulePagePlan({
            documentPath: request.documentPath,
            readSource,
            resolveModule: options.resolver.resolve,
            ...(signal === undefined ? {} : { signal }),
            sourcePaths: sourcePathsWithSnapshots,
          })
        : undefined;
      return (
        nextPlan ??
        (shouldTryGenericConsumerContext
          ? createPreviewInspectorModuleConsumerPagePlan({
              acceptedImportSpecifiers: (target) =>
                options.resolver.getMatchedSpecifiers(target.sourcePath),
              documentPath: request.documentPath,
              readSource,
              resolveModule: options.resolver.resolve,
              ...(signal === undefined ? {} : { signal }),
              sourcePaths: sourcePathsWithSnapshots,
            })
          : undefined)
      );
    };
    let inspectorPlan = await createPlan(sourcePaths);
    const localGenericPlanNeedsWorkspaceComparison =
      inspectorPlan !== undefined &&
      shouldTryGenericConsumerContext &&
      !shouldTryNextModuleContext &&
      isWeakGenericConsumerPlan(inspectorPlan);
    if (
      (inspectorPlan === undefined || localGenericPlanNeedsWorkspaceComparison) &&
      (await shouldEscalatePreviewAncestorSearch(options.projectRoot, options.workspaceRoot))
    ) {
      sourcePaths = await options.cache.getSourcePaths(
        options.workspaceRoot,
        options.workspaceRoot,
        signal,
      );
      const workspaceInspectorPlan = await createPlan(sourcePaths);
      inspectorPlan = selectPreferredGenericConsumerPlan(inspectorPlan, workspaceInspectorPlan);
    }
    if (inspectorPlan !== undefined) {
      return createPreparedInspectorUsage(options, inspectorPlan);
    }
  }

  const packageTargetUsageProps = hasPreviewableTarget
    ? await options.cache.discover({
        climbParentSlices: request.renderMode !== 'page-inspector' && options.setupKind === 'none',
        documentPath: request.documentPath,
        exports: targetSelection.targetExports,
        ...(targetSelection.inspectorExportName === undefined
          ? {}
          : { inspectorExportName: targetSelection.inspectorExportName }),
        projectRoot: options.projectRoot,
        ...(signal === undefined ? {} : { signal }),
        snapshots: request.dependencySnapshots,
        sourceText: targetSelection.sourceText,
        ...(request.tsconfigPath === undefined ? {} : { tsconfigPath: request.tsconfigPath }),
        workspaceRoot: options.workspaceRoot,
      })
    : EMPTY_TARGET_USAGE_PROPS;
  return { implicitGlobalSourcePaths: sourcePaths, packageTargetUsageProps };
}

/** Builds one normalized dirty-source map shared by both bounded Next context planners. */
function createSnapshotSourceMap(request: PreviewBuildRequest): ReadonlyMap<string, string> {
  return new Map(
    [
      ...request.dependencySnapshots,
      {
        documentPath: request.documentPath,
        language: request.language,
        sourceText: request.sourceText,
      },
    ].map((snapshot) => [path.normalize(snapshot.documentPath), snapshot.sourceText] as const),
  );
}

/** Reads current snapshots before the compiler cache while retaining one strict source byte cap. */
function createContextSourceReader(
  options: PreparePreviewCompilerUsageOptions,
  snapshots: ReadonlyMap<string, string>,
): (sourcePath: string) => Promise<string | undefined> {
  return async (sourcePath) => {
    const snapshotText = snapshots.get(path.normalize(sourcePath));
    if (snapshotText !== undefined) return snapshotText;
    return options.cache.readSourceText({
      maximumBytes: MAXIMUM_CONTEXT_SOURCE_BYTES,
      sourcePath,
    });
  };
}

/** Adapts one frozen Inspector plan to the compiler's existing target-usage boundary. */
function createPreparedInspectorUsage(
  options: PreparePreviewCompilerUsageOptions,
  inspectorPlan: NonNullable<PreviewTargetUsageProps['inspectorPlan']>,
): PreparedPreviewCompilerUsage {
  const acceptedSpecifiers = options.resolver.getMatchedSpecifiers(inspectorPlan.target.sourcePath);
  return {
    implicitGlobalSourcePaths: inspectorPlan.dependencyPaths,
    packageTargetUsageProps: {
      dependencyPaths: inspectorPlan.dependencyPaths,
      inspectorPlan,
      ...(acceptedSpecifiers.length === 0
        ? {}
        : { inspectorTargetImportSpecifiers: acceptedSpecifiers }),
      parentSlicesByExport: Object.freeze({}),
      propsByExport: Object.freeze({}),
      renderChainsByExport: inspectorPlan.renderChainsByExport,
    },
  };
}

/**
 * Identifies a package-local callable consumer that may hide a stronger sibling application path.
 * Incomplete and entry-unreachable plans are structurally weak. Story, test, demo, and fixture
 * roots are also weak even when a local runner gives them an entry, because Page Inspector should
 * prefer the authored product shell when the bounded workspace inventory can prove one.
 */
function isWeakGenericConsumerPlan(
  plan: NonNullable<PreviewTargetUsageProps['inspectorPlan']>,
): boolean {
  return (
    !plan.complete ||
    plan.renderChain.reachability !== 'entry-connected' ||
    isAuxiliaryPreviewSourcePath(plan.root.sourcePath)
  );
}

/** Chooses the more application-like plan while retaining stable package-local ties. */
function selectPreferredGenericConsumerPlan(
  localPlan: PreviewTargetUsageProps['inspectorPlan'],
  workspacePlan: PreviewTargetUsageProps['inspectorPlan'],
): PreviewTargetUsageProps['inspectorPlan'] {
  if (localPlan === undefined) return workspacePlan;
  if (workspacePlan === undefined) return localPlan;
  return scoreGenericConsumerPlan(workspacePlan) > scoreGenericConsumerPlan(localPlan)
    ? workspacePlan
    : localPlan;
}

/** Ranks exact entry reachability before completeness and auxiliary-source naming evidence. */
function scoreGenericConsumerPlan(
  plan: NonNullable<PreviewTargetUsageProps['inspectorPlan']>,
): number {
  return (
    (plan.renderChain.reachability === 'entry-connected' ? 100 : 0) +
    (plan.complete ? 20 : 0) +
    (isAuxiliaryPreviewSourcePath(plan.root.sourcePath) ? 0 : 10)
  );
}

/** Matches complete path segments and filename suffixes without capturing ordinary product names. */
function isAuxiliaryPreviewSourcePath(sourcePath: string): boolean {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  return (
    /(?:^|\/)(?:__tests__|tests?|stories?|storybook|examples?|demos?|fixtures?|mocks?|playgrounds?|sandboxes?)(?:\/|$)/u.test(
      normalizedPath,
    ) || /\.(?:stories?|spec|test)\.[cm]?[jt]sx?$/u.test(normalizedPath)
  );
}

/** Includes newly created dirty modules without allowing a snapshot to escape the workspace. */
function mergeInventorySnapshots(
  sourcePaths: readonly string[],
  snapshotPaths: Iterable<string>,
  workspaceRoot: string,
): readonly string[] {
  const merged = new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  for (const snapshotPath of snapshotPaths) {
    const normalizedPath = path.normalize(snapshotPath);
    if (isPathInside(workspaceRoot, normalizedPath)) merged.add(normalizedPath);
  }
  return Object.freeze([...merged].sort());
}

/** Segment-aware containment prevents sibling path prefixes from crossing the trusted boundary. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}
