import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRouteParameterValues,
  createPreviewInspectorV6RoutePattern,
  materializePreviewInspectorRoutePattern,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRoutePattern';

describe('previewInspectorRoutePattern', () => {
  it('uses numeric values for semantic identifiers and retains them as route params', () => {
    const pattern = '/company/:companyId/contracts/:contractId';
    const pathname = materializePreviewInspectorRoutePattern(pattern);

    expect(pathname).toBe('/company/1/contracts/1');
    expect(collectPreviewInspectorRouteParameterValues(pattern, pathname)).toEqual({
      companyId: '1',
      contractId: '1',
    });
  });

  it('materializes common regex contracts without evaluating authored expressions', () => {
    expect(materializePreviewInspectorRoutePattern('/reports/:year(\\d{4})')).toBe('/reports/1111');
    expect(materializePreviewInspectorRoutePattern('/members/:role(admin|manager)')).toBe(
      '/members/admin',
    );
    expect(materializePreviewInspectorRoutePattern('/shares/:documentUuid')).toBe(
      '/shares/00000000-0000-4000-8000-000000000000',
    );
    expect(
      materializePreviewInspectorRoutePattern(
        '/shares/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      ),
    ).toBe('/shares/00000000-0000-4000-8000-000000000000');
  });

  it('allows terminal splats to consume zero segments while retaining unsupported splats', () => {
    expect(materializePreviewInspectorRoutePattern('/*')).toBe('/');
    expect(materializePreviewInspectorRoutePattern('/catalog/*')).toBe('/catalog');
    expect(materializePreviewInspectorRoutePattern('/partner/:partnerId/*')).toBe('/partner/1');
    expect(
      materializePreviewInspectorRoutePattern('/workspace/:workspaceId/*', [
        '/workspace/:workspaceId/dashboard',
      ]),
    ).toBe('/workspace/1/dashboard');
    expect(materializePreviewInspectorRoutePattern('/files/*/detail')).toBe(
      '/files/preview/detail',
    );
  });

  it('removes v5 regex suffixes from isolated v6 route patterns while preserving params', () => {
    expect(
      createPreviewInspectorV6RoutePattern(
        '/company/:companyId(\\d+)/documents/:documentId([0-9]+)?',
      ),
    ).toBe('/company/:companyId/documents/:documentId?');
  });
});
