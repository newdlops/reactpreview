/** Actual esbuild regressions for passive CSS URLs; no remote resource is fetched during compilation. */
import path from 'node:path';
import { build, type BuildResult } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewAssetPlugin } from '../../../src/adapters/esbuild/previewAssetPlugin';

/** Bundles one inert CSS or JavaScript input through the real asset boundary. */
function compile(contents: string, loader: 'css' | 'js'): Promise<BuildResult<{ write: false }>> {
  const root = process.cwd();
  return build({
    absWorkingDir: root,
    bundle: true,
    logLevel: 'silent',
    outfile: path.join(root, 'unused-preview-output', `entry.${loader}`),
    plugins: [
      createPreviewAssetPlugin({
        documentPath: path.join(root, 'unwritten-preview-target.tsx'),
        projectRoot: root,
        workspaceRoot: root,
      }),
    ],
    stdin: { contents, loader, resolveDir: root },
    write: false,
  });
}

describe('passive HTTPS CSS resources', () => {
  it('preserves HTTPS font and image URLs with queries and fragments for the existing CSP', async () => {
    const font = 'https://cdn.example.invalid/fonts/ui.woff2?v=1#face';
    const image = 'https://cdn.example.invalid/images/backdrop.png?v=2';
    const result = await compile(
      `@font-face { font-family: UI; src: url('${font}') } main { background: url('${image}') }`,
      'css',
    );
    expect(result.outputFiles[0]?.text).toContain(font);
    expect(result.outputFiles[0]?.text).toContain(image);
  });

  it('continues to reject external JavaScript asset imports', async () => {
    await expect(
      compile("import font from 'https://cdn.example.invalid/font.ttf'; console.log(font)", 'js'),
    ).rejects.toThrow('Preview asset imports must be bundled instead of external');
  });

  it.each([
    'http://cdn.example.invalid/font.ttf',
    'https://user:secret@cdn.example.invalid/font.ttf',
    'file:///private/font.ttf',
  ])('does not add passive external admission for %s', async (url) => {
    await expect(
      compile(`@font-face { font-family: UI; src: url('${url}') }`, 'css'),
    ).rejects.toThrow();
  });
});
