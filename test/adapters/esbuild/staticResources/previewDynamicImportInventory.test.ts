/** Verifies bounded literal dynamic-import discovery used by Page Inspector graph narrowing. */
import { describe, expect, it } from 'vitest';
import { collectPreviewDynamicImportInventory } from '../../../../src/adapters/esbuild/staticResources/previewDynamicImportInventory';

describe('collectPreviewDynamicImportInventory', () => {
  /** Keeps source order, removes duplicates, and rejects computed requests. */
  it('collects only literal dynamic imports', () => {
    const inventory = collectPreviewDynamicImportInventory(
      '/workspace/registry.tsx',
      [
        `const first = () => import('./first');`,
        `const duplicate = () => import('./first');`,
        `const selected = React.lazy(() => import('./base/preview/index'));`,
        `const spaced = () => import /* webpackChunkName: "template" */ (\`./template\`);`,
        `const computed = () => import('./' + name);`,
      ].join('\n'),
    );

    expect(inventory).toEqual({
      reliable: true,
      specifiers: ['./first', './base/preview/index', './template'],
      truncated: false,
    });
  });

  /** Invalid editor snapshots fail closed rather than inventing a registry policy. */
  it('returns no evidence for incomplete syntax', () => {
    expect(
      collectPreviewDynamicImportInventory('/workspace/registry.ts', `import('./broken'`),
    ).toEqual({ reliable: false, specifiers: [], truncated: true });
  });
});
