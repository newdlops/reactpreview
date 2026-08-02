import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRouteParameterValues,
  composePreviewInspectorNestedRoutePattern,
  createPreviewInspectorV6RoutePattern,
  materializePreviewInspectorRoutePattern,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRoutePattern';

const genericUuidConstraint =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const strictUuidV4Constraint =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const deterministicUuid = '00000000-0000-4000-8000-000000000000';

describe('previewInspectorRoutePattern', () => {
  it.each([
    ['/parent/*', 'child', '/parent', '/parent/child', '/parent/child'],
    ['/parent/*', '/child', '/parent', '/parent/child', '/parent/child'],
    ['/parent/*', '/parent/child', '/parent', '/parent/child', '/parent/child'],
    ['/parent/', '/', '/parent', '/parent', '/parent'],
    ['/*', '/child', '/', '/child', '/child'],
    [
      '/parent/:parentId/*',
      'child/:childId(\\\\d+)',
      '/parent/:parentId',
      '/parent/:parentId/child/:childId(\\\\d+)',
      '/parent/1/child/1',
    ],
    ['/parent/*', 'files/*', '/parent', '/parent/files/*', '/parent/files'],
  ])(
    'canonically composes parent %s and child %s',
    (parentPattern, childPattern, basePattern, pattern, pathname) => {
      expect(composePreviewInspectorNestedRoutePattern(parentPattern, childPattern)).toEqual({
        basePattern,
        pathname,
        pattern,
      });
    },
  );

  it('uses numeric values for semantic identifiers and retains them as route params', () => {
    const pattern = '/company/:companyId/contracts/:contractId';
    const pathname = materializePreviewInspectorRoutePattern(pattern);

    expect(pathname).toBe('/company/1/contracts/1');
    expect(collectPreviewInspectorRouteParameterValues(pattern, pathname)).toEqual({
      companyId: '1',
      contractId: '1',
    });
  });

  it.each([
    ['generic UUID', genericUuidConstraint],
    ['strict UUID v4', strictUuidV4Constraint],
    ['anchored generic UUID', `^${genericUuidConstraint}$`],
    ['anchored strict UUID v4', `^${strictUuidV4Constraint}$`],
  ])('materializes the complete %s constraint', (_name, constraint) => {
    expect(materializePreviewInspectorRoutePattern(`/shares/:id(${constraint})`)).toBe(
      `/shares/${deterministicUuid}`,
    );
  });

  it.each([
    ['fixed numeric', '/values/:value(\\d{4})', '/values/1111'],
    ['numeric', '/values/:value(\\d+)', '/values/1'],
    ['digit', '/values/:value(digit)', '/values/1'],
    ['plain fixed hex', '/values/:value([a-f0-9]{6})', '/values/aaaaaa'],
    ['word-like name fallback', '/values/:slug(\\w+)', '/values/preview'],
    ['literal alternative', '/values/:role(admin|manager)', '/values/admin'],
    ['textual uuid', '/values/:value(uuid)', `/values/${deterministicUuid}`],
    ['textual guid', '/values/:value(GUID)', `/values/${deterministicUuid}`],
    ['uuid name', '/values/:documentUuid', `/values/${deterministicUuid}`],
    ['guid name', '/values/:documentGuid', `/values/${deterministicUuid}`],
  ])('retains the %s materialization fallback', (_name, pattern, pathname) => {
    expect(materializePreviewInspectorRoutePattern(pattern)).toBe(pathname);
  });

  it.each([
    ['leading literal', `x${genericUuidConstraint}`],
    ['trailing structure', `${genericUuidConstraint}-[0-9a-f]{2}`],
    [
      'wrong separator',
      '[0-9a-f]{8}_[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    ],
    [
      'broader character class',
      '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}',
    ],
    [
      'wrong v4 marker',
      '[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
    ],
    [
      'wrong v4 variant',
      '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[79ab][0-9a-f]{3}-[0-9a-f]{12}',
    ],
  ])('does not infer UUID semantics from the %s near miss', (_name, constraint) => {
    expect(materializePreviewInspectorRoutePattern(`/values/:value(${constraint})`)).toBe(
      '/values/aaaaaaaa',
    );
  });

  it('materializes a strict UUID prefix while a terminal splat consumes zero segments', () => {
    const pattern = `/shares/:shareId(${strictUuidV4Constraint})/*`;
    const pathname = materializePreviewInspectorRoutePattern(pattern);

    expect(pathname).toBe(`/shares/${deterministicUuid}`);
    expect(collectPreviewInspectorRouteParameterValues(pattern, pathname)).toEqual({
      shareId: deterministicUuid,
    });
  });

  it('keeps mixed numeric and UUID path segments aligned with collected parameters', () => {
    const pattern = `/companies/:companyId(\\d+)/shares/:shareId(${strictUuidV4Constraint})`;
    const pathname = materializePreviewInspectorRoutePattern(pattern);

    expect(pathname).toBe(`/companies/1/shares/${deterministicUuid}`);
    expect(collectPreviewInspectorRouteParameterValues(pattern, pathname)).toEqual({
      companyId: '1',
      shareId: deterministicUuid,
    });
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
