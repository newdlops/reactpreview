/** Collects, caches, and independently replays frozen compiler-owned route inventory identities. */
import { createHash } from 'node:crypto';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewRouteExecutionPlanArtifact,
} from '../../domain/preview';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  EMPTY_MANAGED_ENVIRONMENT,
  PreviewManagedDependencyStore,
  type PreviewManagedDependencyEnvironment,
} from '../node/previewManagedDependencyStore';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  type PreviewInspectorBundleSourceInventoryMemo,
} from './inspector/previewInspectorBundleFrontier';
import {
  collectPreviewInspectorCompleteRouteInventory,
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
  replayPreviewInspectorCompleteRouteEntry,
  type PreviewCompleteRouteInventoryExecutionProgress,
  type PreviewCompleteRouteInventoryTelemetryEmitter,
  type PreviewCompleteRouteInventoryTelemetryObserver,
  type PreviewInspectorCompleteRouteBaseEntry,
  type PreviewInspectorCompleteRouteInventory,
  type PreviewInspectorCompleteRouteInventoryLimits,
  type PreviewInspectorExactRouteReplayResult,
  type PreviewInspectorPlanlessRunnableRoute,
} from './inspector/previewInspectorCompleteRouteInventory';
import {
  createPreviewCompleteRouteUsageContext,
  preparePreviewCompilerUsage,
  type PreviewCompleteRouteUsageContext,
} from './preparePreviewCompilerUsage';
import { preparePreviewCompleteRouteInventoryAnalysis } from './preparePreviewCompleteRouteInventoryAnalysis';
import { preparePreviewRouteExecutionFinalFrontier } from './preparePreviewRouteExecutionFinalFrontier';
import { emitPreviewRouteExecutionTelemetry } from './preparePreviewRouteExecutionPlanner';
import { EMPTY_RUNTIME_WATCH_INPUTS } from './previewCompilerDefaults';
import { preparePreviewCompilerTarget } from './previewImperativeEntryTarget';
import { PreviewImplicitGlobalEvidenceCache } from './previewImplicitGlobalEvidenceCache';
import { collectPreviewNextRuntimeEvidence as findNext } from './previewNextRuntimeEvidence';
import { createPreviewPreparationPolicy } from './previewPreparationPolicy';
import { findPreviewProjectRoot } from './previewProjectRoot';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import {
  assertPreviewResolutionPath,
  assertPreviewResolutionPaths,
  createPreviewResolutionConfinementPathMemo,
  normalizePreviewResolutionConfinement,
  type PreviewResolutionConfinementPathMemo,
} from './previewResolutionConfinement';
import {
  createPreviewRuntimeWatchInputs,
  resolvePreviewRuntimeEnvironment,
} from './previewRuntimeEnvironment';
import {
  createPreviewStaticModuleResolutionMemo,
  createPreviewStaticModuleResolver,
  type PreviewStaticModuleResolutionMemo,
} from './previewStaticModuleResolver';
import { selectPreviewThemeImport } from './previewTargetExports';
import { assertPreviewReactTarget } from './previewTargetRuntimeGuard';

/** Caller-owned analysis services; the compiler remains responsible for their lifetime. */
interface PreviewCompilerRouteInventoryResources {
  /** Prevents analysis after the owning compiler starts shutdown. */
  readonly isDisposed: () => boolean;
  /** Optional package environment shared with ordinary compilation. */
  readonly managedDependencyStore: PreviewManagedDependencyStore | undefined;
  /** Inert source and usage evidence reused across inventory entries. */
  readonly projectUsageCache: PreviewProjectUsageCache;
  /** Shared syntax-only global-name evidence used by the real route planner. */
  readonly implicitGlobalEvidenceCache: PreviewImplicitGlobalEvidenceCache;
}

/** Owns the frozen inventory cache while borrowing the compiler's bounded analysis services. */
export class PreviewCompilerRouteInventory {
  private readonly completeRouteInventoryCache = new Map<
    string,
    Promise<PreviewInspectorCompleteRouteInventory>
  >();
  /** Retains shared services without taking over their shutdown or executing workspace code. */
  public constructor(private readonly resources: PreviewCompilerRouteInventoryResources) {}

  /**
   * Collects the frozen, compiler-verifiable route inventory used by sequential headless campaigns.
   *
   * This is intentionally an adapter capability rather than part of the framework-neutral compiler
   * port: ordinary previews never need to enumerate sibling routes.
   */
  public async collectCompleteRouteInventory(
    request: PreviewBuildRequest,
    limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>,
    signal?: AbortSignal,
    observer?: PreviewCompleteRouteInventoryTelemetryObserver,
  ): Promise<PreviewInspectorCompleteRouteInventory> {
    const telemetry = createPreviewCompleteRouteInventoryTelemetryEmitter(observer);
    let shutdownReported = false;
    const reportShutdown = (): void => {
      if (shutdownReported) return;
      shutdownReported = true;
      telemetry?.emit({
        phase: 'shutdown',
        transition: 'start',
      });
    };
    if (signal?.aborted === true) reportShutdown();
    signal?.addEventListener('abort', reportShutdown, { once: true });
    try {
      if (this.resources.isDisposed()) {
        throw new PreviewCompilationError('The React preview compiler is already closed.', []);
      }
      const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
      const resolutionConfinement = normalizePreviewResolutionConfinement(request);
      const documentPath = canonicalizeExistingPath(request.documentPath);
      const targetSelection = preparePreviewCompilerTarget({
        ...request,
        documentPath,
        renderMode: 'page-inspector',
      });
      const exportName = targetSelection.inspectorExportName;
      if (exportName === undefined) {
        throw new PreviewCompilationError(
          'The selected module does not expose a statically inspectable React export.',
          [],
        );
      }
      const cacheKey = createHash('sha256')
        .update(canonicalWorkspaceRoot)
        .update('\0')
        .update(documentPath)
        .update('\0')
        .update(request.tsconfigPath ?? '')
        .update('\0')
        .update(targetSelection.sourceText)
        .update('\0')
        .update(JSON.stringify(request.dependencySnapshots))
        .update('\0')
        .update(JSON.stringify(limits ?? {}))
        .update('\0')
        .update(JSON.stringify(request.resolutionConfinement ?? {}))
        .update('\0')
        .update(PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST)
        .update('\0')
        .update(PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION.toString())
        .digest('hex');
      const cached = this.completeRouteInventoryCache.get(cacheKey);
      if (cached !== undefined) return await cached;
      const pending = (async (): Promise<PreviewInspectorCompleteRouteInventory> => {
        let confinementPathMemo: PreviewResolutionConfinementPathMemo | undefined;
        let routeUsageContext: PreviewCompleteRouteUsageContext | undefined;
        let staticModuleResolutionMemo: PreviewStaticModuleResolutionMemo | undefined;
        let sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo | undefined;
        try {
          const analysis = await preparePreviewCompleteRouteInventoryAnalysis({
            cache: this.resources.projectUsageCache,
            canonicalWorkspaceRoot,
            documentPath,
            exportName,
            ...(limits === undefined ? {} : { limits }),
            request,
            resolutionConfinement,
            targetSelection,
            ...(telemetry === undefined ? {} : { telemetry }),
          });
          const inventory = await collectPreviewInspectorCompleteRouteInventory({
            ...analysis,
            prepareExecutionPlan: (entry, progress) => {
              sourceInventoryMemo ??= createPreviewInspectorBundleSourceInventoryMemo();
              staticModuleResolutionMemo ??= createPreviewStaticModuleResolutionMemo();
              if (resolutionConfinement !== undefined) {
                confinementPathMemo ??= createPreviewResolutionConfinementPathMemo();
                routeUsageContext ??= createPreviewCompleteRouteUsageContext();
              }
              return this.prepareCompleteRouteExecutionPlanArtifact(
                request,
                entry,
                progress,
                telemetry,
                sourceInventoryMemo,
                staticModuleResolutionMemo,
                confinementPathMemo,
                routeUsageContext,
              );
            },
          });
          assertPreviewResolutionPaths(resolutionConfinement, inventory.dependencyPaths);
          return inventory;
        } finally {
          routeUsageContext?.release();
          confinementPathMemo?.release();
          staticModuleResolutionMemo?.release();
          sourceInventoryMemo?.release();
        }
      })();
      this.completeRouteInventoryCache.set(cacheKey, pending);
      try {
        return await pending;
      } catch (error) {
        this.completeRouteInventoryCache.delete(cacheKey);
        throw error;
      }
    } finally {
      signal?.removeEventListener('abort', reportShutdown);
    }
  }

  /** Independently replays one frozen inventory identity with compiler-owned inert analysis. */
  public async replayCompleteRouteInventoryEntry(
    request: PreviewBuildRequest,
    entry: PreviewInspectorCompleteRouteBaseEntry,
  ): Promise<PreviewInspectorExactRouteReplayResult> {
    if (this.resources.isDisposed()) {
      throw new PreviewCompilationError('The React preview compiler is already closed.', []);
    }
    const canonicalWorkspaceRoot = canonicalizeExistingPath(request.workspaceRoot);
    const resolutionConfinement = normalizePreviewResolutionConfinement(request);
    const documentPath = canonicalizeExistingPath(request.documentPath);
    const targetSelection = preparePreviewCompilerTarget({
      ...request,
      documentPath,
      renderMode: 'page-inspector',
    });
    const exportName = targetSelection.inspectorExportName;
    if (exportName === undefined) {
      throw new PreviewCompilationError(
        'The selected module does not expose a statically inspectable React export.',
        [],
      );
    }
    const analysis = await preparePreviewCompleteRouteInventoryAnalysis({
      cache: this.resources.projectUsageCache,
      canonicalWorkspaceRoot,
      documentPath,
      exportName,
      request,
      resolutionConfinement,
      targetSelection,
    });
    const result = await replayPreviewInspectorCompleteRouteEntry(analysis, entry);
    if (result.exact) {
      assertPreviewResolutionPaths(resolutionConfinement, [
        result.replay.executionRoot.sourcePath,
        result.replay.runtimeTarget.sourcePath,
        result.replay.sourcePath,
      ]);
    }
    return result;
  }

  /** Runs one provisional inventory row through the same real fast planner used by compilation. */
  private async prepareCompleteRouteExecutionPlanArtifact(
    request: PreviewBuildRequest,
    entry: PreviewInspectorPlanlessRunnableRoute,
    executionProgress: PreviewCompleteRouteInventoryExecutionProgress,
    telemetry: PreviewCompleteRouteInventoryTelemetryEmitter | undefined,
    sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo,
    staticModuleResolutionMemo: PreviewStaticModuleResolutionMemo,
    confinementPathMemo: PreviewResolutionConfinementPathMemo | undefined,
    routeUsageContext: PreviewCompleteRouteUsageContext | undefined,
  ): Promise<PreviewRouteExecutionPlanArtifact | undefined> {
    const executionTelemetry =
      telemetry === undefined
        ? undefined
        : Object.freeze({ emitter: telemetry, progress: executionProgress });
    emitPreviewRouteExecutionTelemetry(executionTelemetry, 'execution-shared-context', 'start');
    const routeRequest: PreviewBuildRequest = Object.freeze({
      ...request,
      inspectorRouteSelection: Object.freeze(
        entry.selection.map((step) => Object.freeze({ ...step })),
      ),
      inspectorTargetMode: 'selected-route-leaf',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
    });
    try {
      const canonicalWorkspaceRoot = canonicalizeExistingPath(routeRequest.workspaceRoot);
      const resolutionConfinement = normalizePreviewResolutionConfinement(routeRequest);
      const documentPath = canonicalizeExistingPath(routeRequest.documentPath);
      const projectRoot = await findPreviewProjectRoot(documentPath, canonicalWorkspaceRoot);
      const managedDependencyEnvironment: PreviewManagedDependencyEnvironment =
        (await this.resources.managedDependencyStore?.prepare(
          projectRoot,
          canonicalWorkspaceRoot,
        )) ?? EMPTY_MANAGED_ENVIRONMENT;
      const dependencyProfile = managedDependencyEnvironment.profile;
      const nextEvidence = await findNext(dependencyProfile, projectRoot, routeRequest);
      const baseResolver = createPreviewStaticModuleResolver({
        ...(routeRequest.tsconfigPath === undefined
          ? {}
          : { configuredTsconfigPath: routeRequest.tsconfigPath }),
        fallbackNodeModulesPaths: managedDependencyEnvironment.nodeModulesPaths,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
        staticModuleResolutionMemo.resolve(moduleSpecifier, consumerPath, () =>
          baseResolver.resolve(moduleSpecifier, consumerPath),
        );
      const assertConfinedPath = (
        confinement: NonNullable<typeof resolutionConfinement>,
        candidatePath: string,
      ): string =>
        confinementPathMemo === undefined
          ? assertPreviewResolutionPath(confinement, candidatePath)
          : confinementPathMemo.assert(candidatePath, () =>
              assertPreviewResolutionPath(confinement, candidatePath),
            );
      const resolver =
        resolutionConfinement === undefined
          ? { ...baseResolver, resolve: resolveModule }
          : {
              ...baseResolver,
              resolve(moduleSpecifier: string, consumerPath: string) {
                assertConfinedPath(resolutionConfinement, consumerPath);
                const resolved = resolveModule(moduleSpecifier, consumerPath);
                if (resolved !== undefined) {
                  assertConfinedPath(resolutionConfinement, resolved);
                }
                return resolved;
              },
            };
      assertPreviewReactTarget(routeRequest, dependencyProfile, resolver);
      const targetSelection = preparePreviewCompilerTarget({
        ...routeRequest,
        documentPath,
      });
      const policy = createPreviewPreparationPolicy(routeRequest);
      const [runtimeEnvironment, runtimeWatchInputs] = await Promise.all([
        resolvePreviewRuntimeEnvironment({
          ...(routeRequest.setupModulePath === undefined
            ? {}
            : { configuredSetupPath: routeRequest.setupModulePath }),
          projectRoot,
          useStorybookPreview: policy.allowAutomaticStorybook,
          workspaceRoot: canonicalWorkspaceRoot,
        }),
        policy.collectRuntimeWatchInputs
          ? createPreviewRuntimeWatchInputs(projectRoot, canonicalWorkspaceRoot)
          : Promise.resolve(EMPTY_RUNTIME_WATCH_INPUTS),
      ]);
      emitPreviewRouteExecutionTelemetry(
        executionTelemetry,
        'execution-shared-context',
        'complete',
      );
      emitPreviewRouteExecutionTelemetry(executionTelemetry, 'execution-route-usage', 'start');
      const preparedUsage = await preparePreviewCompilerUsage({
        cache: this.resources.projectUsageCache,
        discoveryScope: policy.discoveryScope,
        projectRoot,
        projectUsesNextRuntime: nextEvidence.routeContext,
        request: routeRequest,
        resolver,
        setupKind: runtimeEnvironment.setupKind,
        targetSelection,
        ...(routeUsageContext === undefined ? {} : { usageContext: routeUsageContext }),
        workspaceRoot: canonicalWorkspaceRoot,
      });
      emitPreviewRouteExecutionTelemetry(executionTelemetry, 'execution-route-usage', 'complete');
      const directThemeImport = selectPreviewThemeImport(routeRequest.sourceText);
      const finalFrontier = await preparePreviewRouteExecutionFinalFrontier({
        contextDiscoveryTruncated: preparedUsage.contextDiscoveryTruncated === true,
        ...(directThemeImport === undefined ? {} : { directThemeImport }),
        implicitGlobalEvidenceCache: this.resources.implicitGlobalEvidenceCache,
        implicitGlobalSourcePaths: preparedUsage.implicitGlobalSourcePaths,
        ...(targetSelection.inspectorExportName === undefined
          ? {}
          : { inspectorExportName: targetSelection.inspectorExportName }),
        policy,
        projectRoot,
        readProjectSource: (options) => this.resources.projectUsageCache.readSourceText(options),
        request: routeRequest,
        routeId: entry.id,
        runtimeDependencyPaths: runtimeWatchInputs.dependencyPaths,
        ...(runtimeEnvironment.setupModulePath === undefined
          ? {}
          : { runtimeSetupModulePath: runtimeEnvironment.setupModulePath }),
        staticModuleResolver: resolver,
        targetSelection,
        targetUsageProps: preparedUsage.packageTargetUsageProps,
        ...(executionTelemetry === undefined ? {} : { telemetry: executionTelemetry }),
        sourceInventoryMemo,
        workspaceRoot: canonicalWorkspaceRoot,
      });
      const artifact = finalFrontier.plannedRouteExecution?.artifact;
      if (artifact === undefined) return undefined;
      assertPreviewResolutionPaths(resolutionConfinement, [
        artifact.executionRoot.sourcePath,
        artifact.runtimeTarget.sourcePath,
        artifact.selectedBranch.sourcePath,
        artifact.rootRoleContract.sourcePath,
        artifact.targetRoleContract.sourcePath,
        ...artifact.ownerChain.map((owner) => owner.sourcePath),
      ]);
      return artifact;
    } catch (error) {
      if (error instanceof PreviewCompilationError) return undefined;
      throw error;
    }
  }
  /** Releases only cached inventory promises during the owning compiler's shutdown. */
  public clear(): void {
    this.completeRouteInventoryCache.clear();
  }
}
