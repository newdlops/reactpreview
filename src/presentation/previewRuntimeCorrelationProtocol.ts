/**
 * Validates shared correlation fields carried by Page Inspector diagnostic envelopes.
 * Legacy envelopes may omit the complete group; once correlation is claimed, session and revision
 * are mandatory so a partial identity cannot merge unrelated browser runtimes in Output logs.
 */

const RUNTIME_ARTIFACT_PATTERN = /^[0-9a-f]{16,64}$/u;
const RUNTIME_SESSION_PATTERN = /^rp-[0-9a-f]{24}$/u;
const RUNTIME_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u;

/** Optional fields exposed by a validated diagnostic envelope for backward compatibility. */
export interface PreviewRuntimeCorrelationEnvelope {
  readonly artifactId?: string;
  readonly runtimeRevision?: number;
  readonly runtimeSessionId?: string;
  readonly runtimeVersion?: string;
}

/** Complete identity emitted by current Page Inspector browser runtimes. */
export interface PreviewRuntimeCorrelation {
  readonly artifactId?: string;
  readonly runtimeRevision: number;
  readonly runtimeSessionId: string;
  readonly runtimeVersion?: string;
}

/**
 * Reads one correlation group without accepting a partially forged session identity.
 *
 * @returns Frozen fields, `undefined` for a legacy envelope, or `null` for malformed correlation.
 */
export function readPreviewRuntimeCorrelation(
  value: Record<string, unknown>,
): PreviewRuntimeCorrelation | null | undefined {
  const hasCorrelation = [
    'artifactId',
    'runtimeRevision',
    'runtimeSessionId',
    'runtimeVersion',
  ].some((key) => value[key] !== undefined);
  if (!hasCorrelation) return undefined;

  const { artifactId, runtimeRevision, runtimeSessionId, runtimeVersion } = value;
  if (
    (artifactId !== undefined &&
      (typeof artifactId !== 'string' || !RUNTIME_ARTIFACT_PATTERN.test(artifactId))) ||
    !Number.isSafeInteger(runtimeRevision) ||
    (runtimeRevision as number) < 0 ||
    typeof runtimeSessionId !== 'string' ||
    !RUNTIME_SESSION_PATTERN.test(runtimeSessionId) ||
    (runtimeVersion !== undefined &&
      (typeof runtimeVersion !== 'string' || !RUNTIME_VERSION_PATTERN.test(runtimeVersion)))
  ) {
    return null;
  }

  return Object.freeze({
    ...(artifactId === undefined ? {} : { artifactId }),
    runtimeRevision: runtimeRevision as number,
    runtimeSessionId,
    ...(runtimeVersion === undefined ? {} : { runtimeVersion }),
  });
}
