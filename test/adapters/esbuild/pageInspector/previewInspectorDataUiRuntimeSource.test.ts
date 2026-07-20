/** Verifies component-scoped request filtering in the shared backend payload editor. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataUiRuntimeSource';

describe('Preview Inspector data UI runtime source', () => {
  /** Keeps the global payload inventory unchanged and admits only explicit component request IDs. */
  it('filters requests only when an embedding component supplies a scope', () => {
    const context: {
      __filter?: (
        requests: readonly { readonly id: string }[],
        requestIds?: readonly string[],
      ) => readonly { readonly id: string }[];
    } = {};
    vm.runInNewContext(
      `
        ${createPreviewInspectorDataUiRuntimeSource()}
        globalThis.__filter = filterPreviewInspectorDataRequests;
      `,
      context,
    );
    if (context.__filter === undefined) throw new Error('Data UI filter did not initialize.');
    const requests = [{ id: 'dashboard' }, { id: 'sidebar' }];

    expect([...context.__filter(requests)].map((request) => request.id)).toEqual([
      'dashboard',
      'sidebar',
    ]);
    expect([...context.__filter(requests, ['dashboard'])].map((request) => request.id)).toEqual([
      'dashboard',
    ]);
    expect([...context.__filter(requests, [])]).toEqual([]);
  });
});
