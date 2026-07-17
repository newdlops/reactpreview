/**
 * Defines the bounded, user-adjustable size policy for one generated preview artifact set.
 * Values use mebibytes because the VS Code setting is human-facing, while the compiler converts
 * the normalized value to bytes only at its in-memory output boundary.
 */

/** Smallest configurable limit retained for users who prefer the original lightweight budget. */
export const MIN_PREVIEW_OUTPUT_MEBIBYTES = 32;
/** Default sized for code-split monorepo pages without making ordinary previews unbounded. */
export const DEFAULT_PREVIEW_OUTPUT_MEBIBYTES = 128;
/** Absolute guard against one preview consuming enough memory to destabilize the extension host. */
export const MAX_PREVIEW_OUTPUT_MEBIBYTES = 512;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/**
 * Converts an unknown resource-scoped setting into a finite whole-number policy value.
 * Invalid values fall back to the default and valid numbers are clamped to the documented range.
 *
 * @param configuredMebibytes Raw value supplied by VS Code settings or a compiler caller.
 * @returns Integer mebibyte limit between the public minimum and absolute maximum.
 */
export function normalizePreviewOutputMebibytes(configuredMebibytes: unknown): number {
  if (typeof configuredMebibytes !== 'number' || !Number.isFinite(configuredMebibytes)) {
    return DEFAULT_PREVIEW_OUTPUT_MEBIBYTES;
  }
  const wholeMebibytes = Math.floor(configuredMebibytes);
  return Math.min(
    MAX_PREVIEW_OUTPUT_MEBIBYTES,
    Math.max(MIN_PREVIEW_OUTPUT_MEBIBYTES, wholeMebibytes),
  );
}

/**
 * Resolves the normalized setting to the exact byte count used by esbuild output validation.
 *
 * @param configuredMebibytes Raw or already-normalized setting value.
 * @returns Safe integer byte limit for one complete in-memory preview build.
 */
export function resolvePreviewOutputLimitBytes(configuredMebibytes: unknown): number {
  return normalizePreviewOutputMebibytes(configuredMebibytes) * BYTES_PER_MEBIBYTE;
}
