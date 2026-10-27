/**
 * Verifies declared REST response shapes for requests made through imported client instances:
 * build-time registration by method and path pattern, and the runtime path-suffix lookup.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTypedRestRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTypedRestRuntimeSource';
import { createPreviewTypedRestEndpointRegistrations } from '../../../../src/adapters/esbuild/staticResources/previewTypedRestEndpointRegistrations';
import {
  PreviewTypeOracle,
  type PreviewTypeOracleView,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const SUMMARY_SHAPE = {
  fields: { grade: { kind: 'literal', value: 'S' }, total: { kind: 'number' } },
  kind: 'object',
} as const;

describe('createPreviewTypedRestEndpointRegistrations', () => {
  it('skips long nested generic declarations without consulting the type oracle', () => {
    const source = `type Nested = ${'Wrapper<'.repeat(20_000)}string${'>'.repeat(20_000)};`;
    const calls: string[] = [];
    expect(
      createPreviewTypedRestEndpointRegistrations(
        createOracle((text) => {
          calls.push(text);
          return SUMMARY_SHAPE;
        }),
        '/virtual/nested-generics.ts',
        source,
      ),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('retains declared helper payloads across comments and parenthesized type arguments', () => {
    const sourcePath = '/virtual/preview-rest-helper-syntax.ts';
    const source = `
      declare function fetchJson<T>(path: string): Promise<T>;
      export const summary = fetchJson /* request */ <({ total: number })> ('/api/summary');
    `;
    const oracle = new PreviewTypeOracle(undefined, () => ({
      heap_size_limit: 4096 * 1024 * 1024,
      used_heap_size: 64 * 1024 * 1024,
    }));
    const view = oracle.createView({
      rootPaths: [sourcePath],
      managedNodeModulesPaths: [],
      readSnapshot: (name) => (name === sourcePath ? source : undefined),
    });
    try {
      const context = createContext({});
      const statements = createPreviewTypedRestEndpointRegistrations(view, sourcePath, source);
      runInContext(statements.join('\n'), context);
      const registry: unknown = runInContext(
        "globalThis[Symbol.for('newdlops.react-file-preview.typed-rest-endpoints')]",
        context,
      );
      expect(JSON.parse(JSON.stringify(registry))).toEqual([
        ['GET', '/api/summary', { kind: 'object', fields: { total: { kind: 'number' } } }],
      ]);
    } finally {
      view.release();
    }
  });

  it('keeps identical request ordinals across unrelated nested calls using actual declared types', () => {
    const sourcePath = '/virtual/preview-rest-ordinals.ts';
    const source = `
      declare function unrelated(value?: unknown): unknown;
      export function First(client: { get(url: string): Promise<{ first: number }> }) {
        unrelated(unrelated());
        return client.get('/summary');
      }
      export function Second(client: { get(url: string): Promise<{ second: boolean }> }) {
        unrelated(unrelated(unrelated()));
        return client.get('/summary');
      }
    `;
    const oracle = new PreviewTypeOracle(undefined, () => ({
      heap_size_limit: 4096 * 1024 * 1024,
      used_heap_size: 64 * 1024 * 1024,
    }));
    const view = oracle.createView({
      rootPaths: [sourcePath],
      managedNodeModulesPaths: [],
      readSnapshot: (name) => (name === sourcePath ? source : undefined),
    });
    try {
      const statements = createPreviewTypedRestEndpointRegistrations(view, sourcePath, source);
      const context = createContext({});
      runInContext(statements.join('\n'), context);
      const registry: unknown = runInContext(
        "globalThis[Symbol.for('newdlops.react-file-preview.typed-rest-endpoints')]",
        context,
      );
      expect(JSON.parse(JSON.stringify(registry))).toEqual([
        ['GET', '/summary', { kind: 'object', fields: { first: { kind: 'number' } } }],
        ['GET', '/summary', { kind: 'object', fields: { second: { kind: 'boolean' } } }],
      ]);
    } finally {
      view.release();
    }
  });

  /** Typed calls with static or templated paths register; other calls do not. */
  it('queues method, path pattern, and declared shape for typed request calls', () => {
    const source = [
      "import { apiClient } from './client';",
      "export const loadSummary = () => apiClient.get<Summary>('/dashboard/summary?week=1');",
      'export const loadBoms = (id: string) => apiClient.get<Summary>(`/products/${id}/boms`);',
      "export const readCache = (cache: Map<string, Summary>) => cache.get('/local');",
      'export const loadDynamic = (url: string) => apiClient.get<Summary>(url);',
    ].join('\n');
    const calls: string[] = [];
    const oracle = createOracle((callText) => {
      calls.push(callText);
      return callText.startsWith('cache.get') ? undefined : SUMMARY_SHAPE;
    });

    const statements = createPreviewTypedRestEndpointRegistrations(
      oracle,
      '/w/src/api/dashboard.ts',
      source,
    );
    const context = createContext({});
    runInContext(statements.join('\n'), context);
    const registry: unknown = runInContext(
      "globalThis[Symbol.for('newdlops.react-file-preview.typed-rest-endpoints')]",
      context,
    );

    expect(calls).toEqual([
      "apiClient.get<Summary>('/dashboard/summary?week=1')",
      'apiClient.get<Summary>(`/products/${id}/boms`)',
      "cache.get('/local')",
    ]);
    expect(JSON.parse(JSON.stringify(registry))).toEqual([
      ['GET', '/dashboard/summary', SUMMARY_SHAPE],
      ['GET', '/products/*/boms', SUMMARY_SHAPE],
    ]);
    expect(createPreviewTypedRestEndpointRegistrations(undefined, '/w/a.ts', source)).toEqual([]);
  });
});

describe('createPreviewTypedRestEndpointRegistrations helpers', () => {
  /** Generic fetch helpers and SWR hooks register payload shapes; navigation and fetch do not. */
  it('registers typed helper and SWR calls but not navigation, booleans, or raw fetch', () => {
    const source = [
      "import useSWR from 'swr';",
      "import { fetchJson, postJson } from './api';",
      "export const settings = () => fetchJson<Settings>('/api/settings');",
      'export const feed = (cursor: number) => fetchJson<Feed>(`/api/feed?cursor=${cursor}`);',
      "export const save = () => postJson<Saved>('/api/orders', { method: 'POST' });",
      "export const useAccount = () => useSWR<Account>('/api/account', fetchJson);",
      "export const go = (router: Router) => router.push('/settings');",
      "export const raw = () => fetch('/api/raw');",
      "export const leave = (navigate: (to: string) => void) => navigate('/login');",
    ].join('\n');
    const objectShape = { fields: { id: { kind: 'string' } }, kind: 'object' } as const;
    const oracle: PreviewTypeOracleView = {
      ...createOracle(() => undefined),
      readTypedCallResponseShape: (request) =>
        request.callText.startsWith('router.push')
          ? ({ kind: 'boolean' } as never)
          : request.callText.startsWith('fetch(')
            ? undefined
            : objectShape,
      readTypedComponentProps: () => undefined,
      readTypedResponseShape: (request) =>
        request.typeText === 'Account' ? objectShape : undefined,
    };

    const statements = createPreviewTypedRestEndpointRegistrations(
      oracle,
      '/w/src/api/hooks.ts',
      source,
    );
    const context = createContext({});
    runInContext(statements.join('\n'), context);
    const registry: unknown = runInContext(
      "globalThis[Symbol.for('newdlops.react-file-preview.typed-rest-endpoints')]",
      context,
    );

    expect(JSON.parse(JSON.stringify(registry))).toEqual([
      ['GET', '/api/settings', objectShape],
      ['GET', '/api/feed', objectShape],
      ['POST', '/api/orders', objectShape],
      ['GET', '/api/account', objectShape],
    ]);
  });
});

describe('readPreviewInspectorTypedRestShape', () => {
  /** More literal segments win at equal length, while equal declarations still update on reload. */
  it('prefers specific wildcard patterns and preserves latest declarations of equal specificity', () => {
    const context = createContext({ URL });
    runInContext(
      `${createPreviewInspectorTypedRestRuntimeSource()}
      globalThis[PREVIEW_INSPECTOR_TYPED_REST_ENDPOINTS_KEY] = [
        ['GET', '/api/contents/*', { kind: 'object', fields: { specific: { kind: 'number' } } }],
        ['GET', '/api/*/*', { kind: 'object', fields: { broad: { kind: 'number' } } }],
        ['GET', '/settings', { kind: 'object', fields: { old: { kind: 'number' } } }],
        ['GET', '/settings', { kind: 'object', fields: { current: { kind: 'number' } } }],
      ];
      globalThis.__read = readPreviewInspectorTypedRestShape;`,
      context,
    );
    const read = runInContext('globalThis.__read', context) as (
      method: string,
      url: string,
    ) => unknown;
    expect(read('GET', '/prefix/api/contents/42')).toEqual({
      fields: { specific: { kind: 'number' } },
      kind: 'object',
    });
    expect(read('GET', '/settings')).toEqual({
      fields: { current: { kind: 'number' } },
      kind: 'object',
    });
  });

  /** Patterns match the tail of the request path, so client base URLs do not matter. */
  it('matches by method and path suffix, preferring the longest pattern', () => {
    const context = createContext({ URL });
    runInContext(
      `${createPreviewInspectorTypedRestRuntimeSource()}
      globalThis[PREVIEW_INSPECTOR_TYPED_REST_ENDPOINTS_KEY] = [
        ['GET', '/summary', { kind: 'object', fields: { short: { kind: 'number' } } }],
        ['GET', '/dashboard/summary', { kind: 'object', fields: { long: { kind: 'number' } } }],
        ['GET', '/products/*/boms', { kind: 'array', items: { kind: 'string' } }],
        ['POST', '/orders', { kind: 'object', fields: { id: { kind: 'string' } } }],
      ];
      globalThis.__read = readPreviewInspectorTypedRestShape;`,
      context,
    );
    const read = runInContext('globalThis.__read', context) as (
      method: string,
      url: string,
    ) => unknown;

    expect(read('GET', 'http://localhost/api/v1/dashboard/summary')).toEqual({
      fields: { long: { kind: 'number' } },
      kind: 'object',
    });
    expect(read('GET', '/api/products/sku-1/boms')).toEqual({
      items: { kind: 'string' },
      kind: 'array',
    });
    expect(read('GET', '/api/orders')).toBeUndefined();
    expect(read('POST', '/api/orders')).toEqual({
      fields: { id: { kind: 'string' } },
      kind: 'object',
    });
    expect(read('GET', '/api/products/boms')).toBeUndefined();
  });
});

/** Creates a stub oracle that answers request-call shape questions only. */
function createOracle(
  shapeFor: (callText: string) => typeof SUMMARY_SHAPE | undefined,
): PreviewTypeOracleView {
  return {
    readStatus: () => undefined,
    readTypedCallResponseShape: (request) => shapeFor(request.callText),
    readTypedCallValue: () => undefined,
    readTypedDocumentShapes: () => [],
    readTypedGuardValue: () => undefined,
    readTypedComponentProps: () => undefined,
    readTypedExportValue: () => undefined,
    readTypedModuleTypeValue: () => undefined,
    readTypedResponseShape: () => undefined,
    release: () => undefined,
  };
}
