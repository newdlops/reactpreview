/**
 * Verifies the structural child surface emitted beneath an authentic shallow page-shell root.
 *
 * The virtual child must keep host styling and accessibility props supplied by styled wrappers
 * while remaining visibly bounded when the authored child has neither styles nor content.
 */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorShallowProjectionSource,
  type PreviewInspectorShallowProjection,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowProjection';

/** Shared projection keeps assertions focused on generated host-prop behavior. */
const PROJECTION: PreviewInspectorShallowProjection = Object.freeze({
  exportNames: Object.freeze(['default']),
  moduleSpecifier: './DelegatedHost',
});

describe('createPreviewInspectorShallowProjectionSource', () => {
  it('forwards authored host style, accessibility data, and events without display: contents', () => {
    const source = createPreviewInspectorShallowProjectionSource(PROJECTION);

    expect(source).toContain("key === 'className'");
    expect(source).toContain("key.startsWith('data-')");
    expect(source).toContain("key.startsWith('aria-')");
    expect(source).toContain('const hostStyle = { ...fallbackStyle, ...authoredStyle };');
    expect(source).toContain("hostProps['data-react-preview-shallow-component'] = label;");
    expect(source).not.toContain("display: 'contents'");
  });
});
