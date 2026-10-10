/**
 * Places generated payload dates on the preview's current day.
 *
 * Declared date fields receive one fixed literal at compile time ('2026-01-15', or the same day at
 * 09:00 UTC) so compiled output stays deterministic, and untyped date fields receive one date per
 * generated row. Pages commonly list only recent records (an inbound table filtered to the last
 * month), so both now come from the shared sample-date API: the two canonical literals become the
 * current local day and row dates step back one day per row. Other literals pass through unchanged.
 */
import { createPreviewSampleDateApiExpression } from '../previewSampleDateRuntimeSource';

/** Creates the browser helpers used by the shared deterministic payload materializer. */
export function createPreviewInspectorDataSampleDateRuntimeSource(): string {
  return String.raw`
const previewInspectorSampleDates = ${createPreviewSampleDateApiExpression()};

/** Maps the two canonical compiler sample dates to the current local day. */
function rebasePreviewInspectorSampleDate(value) {
  return previewInspectorSampleDates.rebase(value);
}

/** Returns the generated date of one payload row, counting back from the current day. */
function createPreviewInspectorSampleDateTime(itemIndex) {
  return previewInspectorSampleDates.dateTime(itemIndex);
}
`;
}
