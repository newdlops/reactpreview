import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRuntimeImportInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorRuntimeImportInventory';

describe('collectPreviewInspectorRuntimeImportInventory', () => {
  it('retains only literal runtime import edges in source order', () => {
    const edges = collectPreviewInspectorRuntimeImportInventory(
      '/workspace/view.tsx',
      [
        "import type { Props } from './types';",
        "import Default, { Runtime } from './runtime';",
        "import './style.css';",
        "export { runtimeValue } from './reexport';",
        "import Package = require('pkg');",
        "const lazy = import('./lazy');",
        "const required = require('./required');",
        'const ignored = import(`./${name}`);',
      ].join('\n'),
    );

    expect(edges).toEqual([
      expect.objectContaining({
        importedNames: ['Default', 'Runtime'],
        kind: 'import',
        moduleSpecifier: './runtime',
      }),
      expect.objectContaining({
        importedNames: [],
        kind: 'import',
        moduleSpecifier: './style.css',
      }),
      expect.objectContaining({
        importedNames: ['runtimeValue'],
        kind: 'export',
        moduleSpecifier: './reexport',
      }),
      expect.objectContaining({
        importedNames: ['Package'],
        kind: 'import-equals',
        moduleSpecifier: 'pkg',
      }),
      expect.objectContaining({ kind: 'dynamic-import', moduleSpecifier: './lazy' }),
      expect.objectContaining({ kind: 'require', moduleSpecifier: './required' }),
    ]);
    expect(Object.isFrozen(edges)).toBe(true);
  });
});
