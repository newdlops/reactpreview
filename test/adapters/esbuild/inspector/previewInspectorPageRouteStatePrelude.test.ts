import { describe, expect, it } from 'vitest';
import {
  PREVIEW_NEXT_PAGES_ROUTE_STATE_SYMBOL_KEY,
  createPreviewInspectorPageRouteStatePreludeSource,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorPageRouteStatePrelude';

describe('createPreviewInspectorPageRouteStatePreludeSource', () => {
  it('installs generic location before selected surfaces import', () => {
    const source = createPreviewInspectorPageRouteStatePreludeSource({
      kind: 'generic-memory-location',
      loaderPolicy: 'never-execute',
      mounts: [],
      params: {},
      pattern: '/orders/:id',
      pathname: '/orders/42',
      rootOwnsRouter: false,
      searchParams: { filter: ['open', 'mine'] },
    });

    expect(source).toContain('history?.replaceState');
    expect(source).toContain('/orders/42?filter=open&filter=mine');
    expect(source).toContain('PopStateEvent');
  });

  it('installs bounded Next Pages state without evaluating a route registry', () => {
    const source = createPreviewInspectorPageRouteStatePreludeSource({
      kind: 'next-pages',
      loaderPolicy: 'never-execute',
      mounts: [],
      params: { id: '42' },
      pattern: '/products/[id]',
      pathname: '/products/42',
      rootOwnsRouter: false,
      searchParams: { tab: 'details' },
    });

    expect(source).toContain(PREVIEW_NEXT_PAGES_ROUTE_STATE_SYMBOL_KEY);
    expect(source).toContain('asPath');
    expect(source).toContain('/products/42?tab=details');
    expect(source).not.toContain('RouteRegistry');
  });

  it('installs browser history for an authored React Router root without creating a router', () => {
    const source = createPreviewInspectorPageRouteStatePreludeSource({
      kind: 'react-router-v6',
      loaderPolicy: 'never-execute',
      mounts: [],
      params: {},
      pattern: '/selected',
      pathname: '/selected',
      rootOwnsRouter: true,
      routerModuleSpecifier: 'react-router-dom',
      searchParams: { tab: 'details' },
    });

    expect(source).toContain('history?.replaceState');
    expect(source).toContain('/selected?tab=details');
    expect(source).not.toContain('MemoryRouter');
  });

  it('leaves route state to a generated React Router boundary when the root does not own one', () => {
    const source = createPreviewInspectorPageRouteStatePreludeSource({
      kind: 'react-router-v6',
      loaderPolicy: 'never-execute',
      mounts: [],
      params: {},
      pattern: '/selected',
      pathname: '/selected',
      rootOwnsRouter: false,
      routerModuleSpecifier: 'react-router-dom',
      searchParams: {},
    });

    expect(source).toBeUndefined();
  });
});
