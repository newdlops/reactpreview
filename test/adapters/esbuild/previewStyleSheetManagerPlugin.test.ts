import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewStyleSheetManagerPlugin } from '../../../src/adapters/esbuild/previewStyleSheetManagerPlugin';
import { createPreviewStyledComponentsPlan } from '../../../src/adapters/esbuild/previewStyledComponentsPlan';
import { PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER } from '../../../src/adapters/esbuild/previewPluginProtocol';

describe('createPreviewStyleSheetManagerPlugin', () => {
  it('publishes a bounded frozen browser plan without host dependency paths', async () => {
    const plan = createPreviewStyledComponentsPlan({
      available: false,
      dependencyPaths: ['/secret/path'],
      evidence: 'absent',
      ignoredReasons: [],
      layers: [],
      sharedRuntimeChunk: false,
    });
    const result = await build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      plugins: [createPreviewStyleSheetManagerPlugin(plan)],
      stdin: {
        contents: `import { previewStyleSheetManagerPlan } from '${PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER}'; export default previewStyleSheetManagerPlan;`,
        loader: 'js',
        resolveDir: process.cwd(),
      },
      write: false,
    });
    const output = result.outputFiles[0]?.text ?? '';
    expect(output).toContain('previewStyleSheetManagerPlan');
    expect(output).not.toContain('/secret/path');
    expect(output).toContain('Object.freeze');
  });
});
