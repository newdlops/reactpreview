/**
 * Shares one browser-side source for generated sample dates.
 *
 * Compiled output keeps fixed canonical dates so builds stay deterministic. Pages, however, list
 * mostly recent records (an inbound table filtered to the last month, "next two weeks" panels),
 * so every runtime that materializes a generated date asks this API instead: item 0 is the
 * preview's current local day and later items step back one day each. Compile-time list items
 * carry the canonical day minus their index, which `rebase` maps the same way. A test pins the day
 * by setting `baseOverride` on the shared object.
 */

/** Registry key of the per-realm sample-date API. */
export const PREVIEW_SAMPLE_DATE_KEY = 'newdlops.react-file-preview.sample-dates';

/** Canonical compile-time sample day that runtimes rebase onto the current day. */
export const PREVIEW_CANONICAL_SAMPLE_DATE = '2026-01-15';

/** Canonical compile-time sample instant (09:00 UTC on the canonical day). */
export const PREVIEW_CANONICAL_SAMPLE_DATE_TIME = '2026-01-15T09:00:00.000Z';

/** The canonical instant as epoch milliseconds, for timestamp wrappers such as `{ value }`. */
export const PREVIEW_CANONICAL_SAMPLE_EPOCH_MILLIS = Date.parse(PREVIEW_CANONICAL_SAMPLE_DATE_TIME);

/** Generated lists hold at most ten items, so item dates step back at most nine days. */
export const PREVIEW_SAMPLE_DATE_MAX_OFFSET = 9;

/**
 * Canonical sample day of generated list item `offset` (`offset` days before the canonical day;
 * a negative offset is a later day, for future-named lists). Compile-time lists use it for per-item
 * dates; `rebase` maps it to the current day minus `offset`.
 */
export function createPreviewCanonicalSampleDate(offset: number): string {
  const limit = PREVIEW_SAMPLE_DATE_MAX_OFFSET;
  const days = Math.min(limit, Math.max(-limit, Math.trunc(offset)));
  return new Date(PREVIEW_CANONICAL_SAMPLE_EPOCH_MILLIS - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Canonical sample instant of generated list item `offset` (09:00 UTC on its canonical day). */
export function createPreviewCanonicalSampleDateTime(offset: number): string {
  return `${createPreviewCanonicalSampleDate(offset)}T09:00:00.000Z`;
}

/**
 * Canonical sample month-day text (`1/15`, or `01/15` when `padded`) of generated list item
 * `offset`, for fields documented as `'M/D'`; `rebase` maps it to the matching recent day.
 */
export function createPreviewCanonicalSampleMonthDay(offset: number, padded = false): string {
  const day = createPreviewCanonicalSampleDate(offset);
  const month = day.slice(5, 7);
  const date = day.slice(8, 10);
  return padded ? `${month}/${date}` : `${String(Number(month))}/${String(Number(date))}`;
}

/** Returns a browser expression that installs (once per realm) and evaluates to the shared API. */
export function createPreviewSampleDateApiExpression(): string {
  const canonicalOffsets: Record<string, number> = {};
  const canonicalMonthDays: Record<string, readonly [number, boolean]> = {};
  for (
    let offset = -PREVIEW_SAMPLE_DATE_MAX_OFFSET;
    offset <= PREVIEW_SAMPLE_DATE_MAX_OFFSET;
    offset += 1
  ) {
    canonicalOffsets[createPreviewCanonicalSampleDate(offset)] = offset;
    canonicalMonthDays[createPreviewCanonicalSampleMonthDay(offset)] = [offset, false];
    canonicalMonthDays[createPreviewCanonicalSampleMonthDay(offset, true)] = [offset, true];
  }
  return `(globalThis[Symbol.for(${JSON.stringify(PREVIEW_SAMPLE_DATE_KEY)})] ??= (() => {
  const pad = (value) => String(value).padStart(2, '0');
  // Item k of a compile-time list carries the canonical day minus k days (plus k for future lists).
  const canonicalOffsets = ${JSON.stringify(canonicalOffsets)};
  const readCanonicalOffset = (day) =>
    Object.prototype.hasOwnProperty.call(canonicalOffsets, day) ? canonicalOffsets[day] : undefined;
  // 'M/D' text ('1/15', '01/15') near the canonical day: [offset, zero-padded].
  const canonicalMonthDays = ${JSON.stringify(canonicalMonthDays)};
  const api = {
    baseOverride: undefined,
    base() {
      const override = api.baseOverride;
      return override instanceof Date && Number.isFinite(override.getTime()) ? override : new Date();
    },
    day(offset = 0) {
      const base = api.base();
      const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset, 12);
      return day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
    },
    monthDay(offset = 0, padded = false) {
      const base = api.base();
      const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset, 12);
      return padded
        ? pad(day.getMonth() + 1) + '/' + pad(day.getDate())
        : (day.getMonth() + 1) + '/' + day.getDate();
    },
    dateTime(offset = 0) {
      return api.day(offset) + 'T09:00:00.000Z';
    },
    rebase(value) {
      if (typeof value !== 'string') return value;
      if (value.length <= 5 && Object.prototype.hasOwnProperty.call(canonicalMonthDays, value)) {
        const [offset, padded] = canonicalMonthDays[value];
        return api.monthDay(offset, padded);
      }
      const day = value.length === 10 ? readCanonicalOffset(value) : undefined;
      if (day !== undefined) return api.day(day);
      const instant = value.length === 24 && value.endsWith('T09:00:00.000Z')
        ? readCanonicalOffset(value.slice(0, 10))
        : undefined;
      return instant === undefined ? value : api.dateTime(instant);
    },
  };
  return api;
})())`;
}

/** Returns a browser expression that rebases one compile-time literal when the API is installed. */
export function createPreviewSampleDateRebaseExpression(literal: string): string {
  const text = JSON.stringify(literal);
  return `(globalThis[Symbol.for(${JSON.stringify(PREVIEW_SAMPLE_DATE_KEY)})]?.rebase?.(${text}) ?? ${text})`;
}
