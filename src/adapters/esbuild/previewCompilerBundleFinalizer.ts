/** Publishes one successful compiler build without coupling output assembly to build orchestration. */
import type { BuildResult, Message } from 'esbuild';
import type {
  PreviewBuildRequest,
  PreviewBundle,
  PreviewContextCoverage,
  PreviewDiagnostic,
} from '../../domain/preview';
import type { PreviewCompilerBundleFrontierActivity } from '../../domain/previewCompilerActivity';
import { createPreviewBundle } from './previewBuildResult';
import type { PreviewBuildOutputSelection } from './previewBuildOutputPlanner';
import type { PreviewGlobalPackageBridgePlan } from './globalPackageBridge';
import { verifyPreviewInspectorBundleFrontierMetafile } from './inspector/previewInspectorBundleFrontierMetafile';

/** Successful build data retained after adaptive planning and before bundle publication. */
export interface PreviewCompilerBuildExecution {
  readonly globalPackagePlan: PreviewGlobalPackageBridgePlan;
  readonly outputSelection: PreviewBuildOutputSelection;
  readonly result: BuildResult<{ metafile: true; write: false }>;
  readonly styleDependencyPaths: readonly string[];
  readonly watchDirectories: readonly string[];
}

/** Inputs that are intentionally independent from esbuild option construction. */
export interface FinalizePreviewCompilerBundleOptions {
  readonly request: PreviewBuildRequest;
  readonly buildExecution: PreviewCompilerBuildExecution;
  readonly fallbackDiagnostics: readonly PreviewDiagnostic[];
  readonly inspectorFallbackDiagnostics: readonly PreviewDiagnostic[];
  readonly fallbackDependencies: readonly string[];
  readonly managedDependencyPaths: readonly string[];
  readonly runtimeDependencyPaths: readonly string[];
  readonly styledComponentsDependencyPaths: readonly string[];
  readonly documentShellDependencyPath: string | undefined;
  readonly globalStyleDependencyPaths: readonly string[];
  readonly targetDependencyPaths: readonly string[];
  readonly admitBuildWarning: (message: Message) => boolean;
  readonly contextCoverage: PreviewContextCoverage;
  readonly isManagedDependencyPath: ((dependencyPath: string) => boolean) | undefined;
  readonly inspectorBundleFrontier:
    | {
        readonly activity: PreviewCompilerBundleFrontierActivity;
        readonly authenticSourcePaths: readonly string[];
        readonly packageDemandSourcePaths?: readonly string[];
        readonly executionSurfaces?: readonly {
          readonly id: string;
          readonly sourcePath: string;
          readonly strategy: string;
        }[];
      }
    | undefined;
}

/** Converts a successful esbuild revision into the externally watchable preview artifact. */
export async function finalizePreviewCompilerBundle(
  options: FinalizePreviewCompilerBundleOptions,
): Promise<PreviewBundle> {
  if (options.inspectorBundleFrontier !== undefined) {
    verifyPreviewInspectorBundleFrontierMetafile({
      activity: options.inspectorBundleFrontier.activity,
      authenticSourcePaths: options.inspectorBundleFrontier.authenticSourcePaths,
      ...(options.inspectorBundleFrontier.packageDemandSourcePaths === undefined
        ? {}
        : {
            packageDemandSourcePaths: options.inspectorBundleFrontier.packageDemandSourcePaths,
          }),
      ...(options.inspectorBundleFrontier.executionSurfaces === undefined
        ? {}
        : { executionSurfaces: options.inspectorBundleFrontier.executionSurfaces }),
      metafile: options.buildExecution.result.metafile,
      target: options.request.documentPath,
      workspaceRoot: options.request.workspaceRoot,
    });
  }
  const previewBundle = await createPreviewBundle(
    options.request,
    options.buildExecution.result,
    options.buildExecution.watchDirectories,
    [...options.fallbackDiagnostics, ...options.inspectorFallbackDiagnostics],
    [
      ...options.buildExecution.globalPackagePlan.dependencyPaths,
      ...options.managedDependencyPaths,
      ...options.runtimeDependencyPaths,
      ...options.fallbackDependencies,
      ...options.buildExecution.styleDependencyPaths,
      ...options.styledComponentsDependencyPaths,
      ...(options.documentShellDependencyPath === undefined
        ? []
        : [options.documentShellDependencyPath]),
      ...options.globalStyleDependencyPaths,
      ...options.targetDependencyPaths,
    ],
    options.admitBuildWarning,
    options.contextCoverage,
    options.buildExecution.outputSelection,
  );
  return options.isManagedDependencyPath === undefined
    ? previewBundle
    : {
        ...previewBundle,
        dependencies: previewBundle.dependencies.filter(
          (dependencyPath) => !options.isManagedDependencyPath?.(dependencyPath),
        ),
      };
}
