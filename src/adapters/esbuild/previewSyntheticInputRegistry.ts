/** Exact build-scoped esbuild synthetic metafile identities, separate from load namespaces. */
import { createHash } from 'node:crypto';
import { PreviewCompilationError } from '../../domain/preview';

/** Identity emitted only when esbuild materializes the compiler's `import.meta.env` object define. */
export const PREVIEW_IMPORT_META_ENV_DEFINE_INPUT = '<define:import.meta.env>';

/** Stable basename used by the compiler's one stdin entry strategy. */
export const PREVIEW_STDIN_ENTRY_NAME = '<react-preview-entry>';

/** Synthetic-input policy identity. Bump whenever exact admission semantics change. */
export const PREVIEW_SYNTHETIC_INPUT_POLICY_VERSION = 1;

/** Stable campaign-facing digest of all compiler-declarable exact synthetic input kinds. */
export const PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      inputKinds: [PREVIEW_IMPORT_META_ENV_DEFINE_INPUT, PREVIEW_STDIN_ENTRY_NAME],
      policyVersion: PREVIEW_SYNTHETIC_INPUT_POLICY_VERSION,
    }),
  )
  .digest('hex');

/** Immutable build-scoped exact equality lookup with no prefix or pattern admission. */
export interface PreviewSyntheticInputRegistry {
  readonly policyDigest: string;
  readonly policyVersion: typeof PREVIEW_SYNTHETIC_INPUT_POLICY_VERSION;
  readonly registrations: readonly string[];
  owns(inputIdentity: string): boolean;
}

/**
 * Freezes exact compiler declarations before esbuild starts. This helper is adapter-internal and
 * receives no request or project plugin input.
 */
export function createPreviewSyntheticInputRegistry(
  inputIdentities: readonly string[],
): PreviewSyntheticInputRegistry {
  const identities = new Set<string>();
  for (const inputIdentity of inputIdentities) {
    if (
      !inputIdentity.startsWith('<') ||
      !inputIdentity.endsWith('>') ||
      inputIdentity.slice(1, -1).includes('<') ||
      inputIdentity.slice(1, -1).includes('>') ||
      inputIdentity.length < 3
    ) {
      throw createSyntheticRegistryError(`Malformed synthetic input identity: ${inputIdentity}`);
    }
    if (identities.has(inputIdentity)) {
      throw createSyntheticRegistryError(`Duplicate synthetic input identity: ${inputIdentity}`);
    }
    identities.add(inputIdentity);
  }
  const registrations = Object.freeze([...identities].sort());
  return Object.freeze({
    owns(inputIdentity: string): boolean {
      return identities.has(inputIdentity);
    },
    policyDigest: PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST,
    policyVersion: PREVIEW_SYNTHETIC_INPUT_POLICY_VERSION,
    registrations,
  });
}

function createSyntheticRegistryError(message: string): PreviewCompilationError {
  return new PreviewCompilationError(
    `React Preview synthetic input confinement registry rejected the build. ${message}`,
    [{ message, severity: 'error' }],
  );
}
