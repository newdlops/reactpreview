/** Framework-general categories shared by compiler, inspector, and campaign evidence. */
export const PREVIEW_BLOCKER_CATEGORIES = [
  'build',
  'data',
  'environment',
  'navigation',
  'provider',
  'render',
  'runtime',
  'unsupported',
] as const;

export type PreviewBlockerCategory = (typeof PREVIEW_BLOCKER_CATEGORIES)[number];

/** A bounded resolver result; report-only preserves unsupported application semantics. */
export const PREVIEW_BLOCKER_OUTCOMES = [
  'auto-resolved',
  'prevented',
  'rejected',
  'report-only',
  'rolled-back',
  'unavailable',
] as const;

export type PreviewBlockerOutcome = (typeof PREVIEW_BLOCKER_OUTCOMES)[number];

/** Stable kind-to-category bridge serialized into the isolated browser runtime. */
export const PREVIEW_BLOCKER_KIND_CATEGORIES: Readonly<Record<string, PreviewBlockerCategory>> =
  Object.freeze({
    'component-error': 'render',
    'data-request': 'data',
    'jsx-runtime-global': 'runtime',
    'runtime-fallback': 'provider',
    'runtime-global': 'runtime',
    'target-error': 'render',
    'target-reachability': 'navigation',
  });

/** Maps existing generic blocker kinds without inspecting authored names, fields, or payloads. */
export function normalizePreviewBlockerCategory(kind: string): PreviewBlockerCategory {
  return PREVIEW_BLOCKER_KIND_CATEGORIES[kind] ?? 'unsupported';
}

export function isPreviewBlockerCategory(value: unknown): value is PreviewBlockerCategory {
  return (
    typeof value === 'string' && (PREVIEW_BLOCKER_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isPreviewBlockerOutcome(value: unknown): value is PreviewBlockerOutcome {
  return (
    typeof value === 'string' && (PREVIEW_BLOCKER_OUTCOMES as readonly string[]).includes(value)
  );
}
