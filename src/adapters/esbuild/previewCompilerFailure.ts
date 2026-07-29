/** Converts compiler failures and one-time dependency recovery into the public preview contract. */
import {
  PreviewCompilationError,
  type PreviewBundle,
  type PreviewDiagnostic,
} from '../../domain/preview';
import {
  isPreviewBuildCancellation,
  isPreviewFrontierMismatchEvidence,
  PreviewBuildStalledError,
} from '../../domain/previewBuildExecution';
import { convertMessage, describeUnknownError, isBuildFailure } from './previewBuildResult';

/** Failure inputs kept outside the compiler's successful build orchestration. */
export interface ResolvePreviewCompilerFailureOptions {
  readonly error: unknown;
  readonly buildSignal: AbortSignal;
  readonly dependencyAcquisitionAttempted: boolean;
  readonly retryCompilation: () => Promise<PreviewBundle>;
  readonly target: string;
  readonly tryAcquireMissingDependencies: (
    errors: readonly import('esbuild').Message[],
  ) => Promise<boolean>;
}

/** Either returns the recovered build or throws a stable diagnostic error. */
export async function resolvePreviewCompilerFailure(
  options: ResolvePreviewCompilerFailureOptions,
): Promise<PreviewBundle> {
  const { buildSignal, error } = options;
  if (isPreviewBuildCancellation(error, buildSignal)) throw error;
  if (error instanceof PreviewBuildStalledError) throw error;
  const frontierMismatch = readPreviewInspectorFrontierMismatch(error);
  if (frontierMismatch !== undefined) {
    throw new PreviewBuildStalledError(
      options.target,
      'bundling-modules',
      0,
      'frontier-mismatch',
      undefined,
      frontierMismatch.evidence,
    );
  }
  if (
    !options.dependencyAcquisitionAttempted &&
    isBuildFailure(error) &&
    (await options.tryAcquireMissingDependencies(error.errors))
  ) {
    return options.retryCompilation();
  }
  if (error instanceof PreviewCompilationError) throw error;
  const diagnostics: readonly PreviewDiagnostic[] = isBuildFailure(error)
    ? error.errors.map((message) => convertMessage(message, 'error'))
    : [{ message: describeUnknownError(error), severity: 'error' }];
  const summary = diagnostics[0]?.message ?? 'The React module could not be bundled.';
  throw new PreviewCompilationError(`Preview build failed: ${summary}`, diagnostics, error);
}

/** Maps a frozen-frontier guard violation to a typed consistency failure. */
function readPreviewInspectorFrontierMismatch(
  error: unknown,
):
  | { evidence?: import('../../domain/previewBuildExecution').PreviewFrontierMismatchEvidence }
  | undefined {
  if (!isBuildFailure(error)) return undefined;
  const message = error.errors.find((candidate) =>
    candidate.text.startsWith('React Preview frontier mismatch:'),
  );
  return message === undefined
    ? undefined
    : {
        ...(isPreviewFrontierMismatchEvidence(message.detail) ? { evidence: message.detail } : {}),
      };
}
