import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorPageExecutionPlugin,
  createPreviewInspectorPageSurfaceSpecifier,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionPlugin';

describe('createPreviewInspectorPageExecutionPlugin', () => {
  it('bundles only the selected export closure from a virtual page surface', async () => {
    const sourcePath = '/workspace/Views.ts';
    const result = await build({
      bundle: true,
      format: 'esm',
      plugins: [
        createPreviewInspectorPageExecutionPlugin({
          readSource: (candidate) =>
            candidate === sourcePath
              ? [
                  'const helper = () => 1;',
                  'export const Selected = helper;',
                  "import { Huge } from './Huge';",
                  'export const Unrelated = Huge;',
                ].join('\n')
              : undefined,
          surfaces: [{ exportName: 'Selected', id: 'selected', sourcePath }],
        }),
      ],
      stdin: {
        contents: `import { Selected } from ${JSON.stringify(createPreviewInspectorPageSurfaceSpecifier('selected'))}; console.log(Selected);`,
        loader: 'js',
        resolveDir: '/workspace',
      },
      write: false,
    });
    const output = result.outputFiles[0]?.text ?? '';

    expect(output).toContain('helper');
    expect(output).toContain('Selected');
    expect(output).not.toContain('Huge');
    expect(output).not.toContain('Unrelated');
  });
});
