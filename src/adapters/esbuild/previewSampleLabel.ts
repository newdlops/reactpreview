/**
 * Turns a field name into the readable label used as generated sample text.
 *
 * Generated text without a stronger meaning (an id, email, date, url or status has its own format)
 * used to repeat the raw key, so tables showed `sku_name` and `grade`. The key is now written as a
 * short label (`Sku name`, `Grade`, `Customer name`): still visibly derived from the field and never
 * invented business data, but readable in a rendered page. Compile-time generators call the
 * TypeScript function; each browser runtime installs the same logic under its own function name so
 * concatenated runtimes never declare one top-level name twice.
 */

/** Longest generated label; a longer one keeps its start followed by an ellipsis. */
const PREVIEW_SAMPLE_LABEL_LIMIT = 32;

/** Returns the readable label of one key (`sku_name` → `Sku name`); `fallback` when it is empty. */
export function createPreviewSampleLabel(rawName: string, fallback = 'Preview'): string {
  const segments = rawName
    .trim()
    .split(/[.[\]]+/u)
    .filter(Boolean);
  const words = (segments.at(-1) ?? '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const text = words.join(' ');
  if (text.length === 0) return fallback;
  const label = text.charAt(0).toUpperCase() + text.slice(1);
  return label.length <= PREVIEW_SAMPLE_LABEL_LIMIT
    ? label
    : `${label.slice(0, PREVIEW_SAMPLE_LABEL_LIMIT - 1)}…`;
}

/** Returns browser source declaring `functionName(rawName, fallback)` with the same behavior. */
export function createPreviewSampleLabelRuntimeSource(functionName: string): string {
  const limit = String(PREVIEW_SAMPLE_LABEL_LIMIT);
  const kept = String(PREVIEW_SAMPLE_LABEL_LIMIT - 1);
  return `
/** Returns the readable label of one key ('sku_name' → 'Sku name'); fallback when it is empty. */
function ${functionName}(rawName, fallback = 'Preview') {
  const segments = String(rawName ?? '').trim().split(/[.[\\]]+/u).filter(Boolean);
  const words = (segments.at(-1) ?? '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[\\s_-]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const text = words.join(' ');
  if (text.length === 0) return fallback;
  const label = text.charAt(0).toUpperCase() + text.slice(1);
  return label.length <= ${limit}
    ? label
    : label.slice(0, ${kept}) + '…';
}
`;
}
