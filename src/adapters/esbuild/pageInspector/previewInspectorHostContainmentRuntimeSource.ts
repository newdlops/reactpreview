/**
 * Generates the CSS containing-block rules shared by target geometry checks.
 *
 * An ancestor's `overflow` clips only boxes it contains. A `position: fixed` modal escapes a
 * clipping page section unless an ancestor between them creates its containing block, and a
 * `position: absolute` box escapes every ancestor up to the nearest positioned one. Both the
 * visible-output check and the scroll-into-view decision walk ancestors with these rules.
 */
export function createPreviewInspectorHostContainmentRuntimeSource(): string {
  return String.raw`
/** Reports how a positioned box escapes ancestor clipping: 'fixed', 'absolute', or undefined. */
function readPreviewInspectorHostClipEscape(style) {
  const position = String(style?.position ?? '');
  return position === 'fixed' || position === 'absolute' ? position : undefined;
}

/** Reports an ancestor that contains fixed descendants (transform, filter, contain, will-change). */
function createsPreviewInspectorFixedContainingBlock(style) {
  const set = (value) => value !== undefined && value !== null && value !== '' && value !== 'none';
  return set(style?.transform) || set(style?.perspective) || set(style?.filter) ||
    set(style?.backdropFilter) ||
    /\b(?:paint|layout|strict|content)\b/u.test(String(style?.contain ?? '')) ||
    /\b(?:transform|perspective|filter)\b/u.test(String(style?.willChange ?? ''));
}

/** Reports whether an ancestor with this style contains a box escaping as 'escape'. */
function containsPreviewInspectorEscapedHost(style, escape) {
  return escape === undefined ||
    (escape === 'absolute' && !/^(?:static|)$/u.test(String(style?.position ?? 'static'))) ||
    createsPreviewInspectorFixedContainingBlock(style);
}
`;
}
