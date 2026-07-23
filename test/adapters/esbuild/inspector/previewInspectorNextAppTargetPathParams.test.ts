/**
 * Verifies conservative dynamic App Router parameter inference from selected auxiliary sources.
 */
import { describe, expect, it } from 'vitest';
import { inferPreviewInspectorNextAppTargetPathParams } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppTargetPathParams';

describe('inferPreviewInspectorNextAppTargetPathParams', () => {
  it('binds mirrored dynamic segments after a shared literal route anchor', () => {
    expect(
      inferPreviewInspectorNextAppTargetPathParams({
        routePattern: '/examples/[base]/[name]',
        targetPath: '/workspace/apps/site/examples/base/button-demo.tsx',
      }),
    ).toEqual({
      base: 'base',
      name: 'button-demo',
    });
  });

  it('binds a terminal catch-all suffix without retaining the source extension', () => {
    expect(
      inferPreviewInspectorNextAppTargetPathParams({
        routePattern: '/demos/[...parts]',
        targetPath: '/workspace/demos/forms/account/profile.tsx',
      }),
    ).toEqual({
      parts: ['forms', 'account', 'profile'],
    });
  });

  it('does not guess parameters when the route and source share no static anchor', () => {
    expect(
      inferPreviewInspectorNextAppTargetPathParams({
        routePattern: '/catalog/[name]',
        targetPath: '/workspace/examples/button-demo.tsx',
      }),
    ).toBeUndefined();
  });
});
