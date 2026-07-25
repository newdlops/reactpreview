/** Verifies pattern localization used by nested factory route owners. */
import { describe, expect, it } from 'vitest';
import {
  localizePreviewInspectorRoutePathname,
  relativizePreviewInspectorRoutePattern,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRoutePatternMatch';

describe('previewInspectorRoutePatternMatch', () => {
  it('relativizes compatible factory child patterns', () => {
    expect(relativizePreviewInspectorRoutePattern('/section', '/section')).toBe('');
    expect(relativizePreviewInspectorRoutePattern('/section', '/section/create')).toBe('create');
    expect(
      relativizePreviewInspectorRoutePattern(
        '/section/:managementId(\\d+)',
        '/section/:managementId(\\d+)/payment',
      ),
    ).toBe('payment');
  });

  it('localizes concrete paths through static and constrained dynamic owners', () => {
    expect(localizePreviewInspectorRoutePathname('/section', '/section/1/payment')).toBe(
      '/1/payment',
    );
    expect(
      localizePreviewInspectorRoutePathname('/section/:managementId(\\d+)', '/section/1/payment'),
    ).toBe('/payment');
    expect(
      localizePreviewInspectorRoutePathname(
        '/section/:managementId(\\d+)',
        '/section/text/payment',
      ),
    ).toBeUndefined();
  });
});
