/** Verifies bounded Inspector navigation without applying a choice or moving the authored document. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorChoiceFocusScript } from '../../src/presentation/webview/previewInspectorChoiceFocusScript';

/** Exercises the shared browser helper with a closed disclosure and independent scroll containers. */
function navigate(disabled = false, missing = false): Record<string, unknown> {
  return vm.runInNewContext(`
    const events = [];
    const page = { scrollTop: 42 };
    const viewport = () => ({scrollTop: 0, getBoundingClientRect: () => ({top:10,bottom:150})});
    const shell = viewport(), toolbar = viewport();
    const details = {tagName:'DETAILS',open:false,parentElement:shell};
    const group = {getBoundingClientRect:()=>({top:200,bottom:400})};
    const button = {parentElement:details, closest:()=>group, focus:options=>events.push(['button',options]),
      click:()=>{throw Error('must not select');},getBoundingClientRect:()=>({top:240,bottom:268})};
    const scroll = {...viewport(),parentElement:shell,querySelector:selector=>${String(disabled)} ? null : button,
      focus:options=>events.push(['region',options])};
    const list = {querySelector:()=>scroll,closest:selector=>selector==='.rpi-toolbar'?toolbar:shell};
    shell.querySelector = () => ${String(missing)} ? null : list;
    ${createPreviewInspectorChoiceFocusScript()}
    const result = focusPreviewInspectorChoiceControls(shell);
    ({result,events,open:details.open,page:page.scrollTop,scroll:scroll.scrollTop,toolbar:toolbar.scrollTop,shell:shell.scrollTop});
  `) as Record<string, unknown>;
}

describe('Inspector choice focus', () => {
  it('opens a closed group and focuses an option without clicking it or scrolling the page', () => {
    expect(navigate()).toEqual({
      result: true,
      events: [['button', { preventScroll: true }]],
      open: true,
      page: 42,
      scroll: 190,
      toolbar: 230,
      shell: 230,
    });
  });

  it('focuses the accessible options region when all controls are disabled', () => {
    expect(navigate(true)).toMatchObject({
      result: true,
      events: [['region', { preventScroll: true }]],
      page: 42,
    });
  });

  it('reports missing inline UI so the caller can retain the existing details fallback', () => {
    expect(navigate(false, true)).toMatchObject({ result: false, events: [], page: 42 });
  });
});
