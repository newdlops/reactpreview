/** Generates shared, read-only choice navigation for the preview and its inert Inspector mirror. */
export function createPreviewInspectorChoiceFocusScript(): string {
  return String.raw`
/** Reveals real options inside Inspector-owned scroll regions without choosing or applying a value. */
function focusPreviewInspectorChoiceControls(root) {
  const list = root?.querySelector?.('#rpi-neural-choice-list');
  const scroll = list?.querySelector?.('.rpi-neural-choice-scroll');
  if (scroll === null || scroll === undefined) return false;
  const control = scroll.querySelector?.('.rpi-neural-choice-options button:not(:disabled)');
  const target = control ?? scroll;
  for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
  target.focus?.({ preventScroll: true });
  const group = control?.closest?.('.rpi-neural-choice-group') ?? target;
  const revealWithin = (viewport, element) => {
    const bounds = viewport?.getBoundingClientRect?.();
    const item = element?.getBoundingClientRect?.();
    if (bounds === undefined || item === undefined) return;
    if (item.top < bounds.top || item.bottom > bounds.bottom) {
      viewport.scrollTop = Math.max(0, viewport.scrollTop + item.top - bounds.top);
    }
  };
  revealWithin(scroll, group);
  revealWithin(list.closest?.('.rpi-toolbar'), target);
  revealWithin(list.closest?.('.rpi-shell'), target);
  return true;
}
`;
}
