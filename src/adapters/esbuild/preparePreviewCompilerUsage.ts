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
import { createPreviewInspectorNextAppModulePagePlan } from './inspector/previewInspectorNextAppModulePagePlan';
import type { PreviewProjectUsageCache } from './previewProjectUsageCache';
import type { createPreviewStaticModuleResolver } from './previewStaticModuleResolver';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';
import { shouldPreferPreviewModulePageContext } from './previewTargetExports';
import { shouldEscalatePreviewAncestorSearch } from './previewWorkspaceAncestorPolicy';

const MAXIMUM_CONTEXT_SOURCE_BYTES = 4 * 1024 * 1024;
const NEXT_APP_DIRECT_ROUTE_MODULE_PATTERN = /^(?:layout|page|template)\.[cm]?[jt]sx?$/iu;
const NEXT_APP_ROUTE_STATE_MODULE_PATTERN = /^(?:error|loading|not-found)\.[cm]?[jt]sx?$/iu;

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
  const shouldTryModulePageContext =
    !useFastPreparation &&
    request.renderMode === 'page-inspector' &&
    !targetSelection.isImperativeEntry &&
    (NEXT_APP_ROUTE_STATE_MODULE_PATTERN.test(path.basename(request.documentPath)) ||
      shouldPreferPreviewModulePageContext(
        request.documentPath,
        request.sourceText,
        targetSelection.inspectorExportName,
      )) &&
    !NEXT_APP_DIRECT_ROUTE_MODULE_PATTERN.test(path.basename(request.documentPath));
  if (useFastPreparation || (!hasPreviewableTarget && !shouldTryModulePageContext)) {
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
    const snapshotSourceByPath = new Map(
      [
        ...request.dependencySnapshots,
        {
          documentPath: request.documentPath,
          language: request.language,
          sourceText: request.sourceText,
        },
      ].map((snapshot) => [path.normalize(snapshot.documentPath), snapshot.sourceText] as const),
    );
    const createPlan = (
      inventoryPaths: readonly string[],
    ): ReturnType<typeof createPreviewInspectorNextAppModulePagePlan> =>
      createPreviewInspectorNextAppModulePagePlan({
        documentPath: request.documentPath,
        readSource: async (sourcePath) => {
          const snapshotText = snapshotSourceByPath.get(path.normalize(sourcePath));
          if (snapshotText !== undefined) return snapshotText;
          return options.cache.readSourceText({
            maximumBytes: MAXIMUM_CONTEXT_SOURCE_BYTES,
            sourcePath,
          });
        },
        resolveModule: options.resolver.resolve,
        ...(signal === undefined ? {} : { signal }),
        sourcePaths: mergeInventorySnapshots(
          inventoryPaths,
          snapshotSourceByPath.keys(),
          options.workspaceRoot,
        ),
      });
    let inspectorPlan = await createPlan(sourcePaths);
    if (
      inspectorPlan === undefined &&
      (await shouldEscalatePreviewAncestorSearch(options.projectRoot, options.workspaceRoot))
    ) {
      sourcePaths = await options.cache.getSourcePaths(
        options.workspaceRoot,
        options.workspaceRoot,
        signal,
      );
      inspectorPlan = await createPlan(sourcePaths);
    }
    if (inspectorPlan !== undefined) {
      const acceptedSpecifiers = options.resolver.getMatchedSpecifiers(
        inspectorPlan.target.sourcePath,
      );
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
