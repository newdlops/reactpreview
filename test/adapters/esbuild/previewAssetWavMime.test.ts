/** Real asset-boundary regressions for playable WAV URLs without rewriting authored strings. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, type BuildResult } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewAssetPlugin } from '../../../src/adapters/esbuild/previewAssetPlugin';

const roots: string[] = [];
const waveBytes = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE', 'binary');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

/** Bundles bounded local bytes through the same loader and plugin used by the preview compiler. */
async function compile(
  contents: string,
  loader: 'css' | 'js' = 'js',
): Promise<BuildResult<{ write: false }>> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-wave-mime-'));
  roots.push(root);
  await writeFile(path.join(root, 'tone.WAV'), waveBytes);
  return build({
    absWorkingDir: root,
    bundle: true,
    format: 'esm',
    loader: { '.WAV': 'dataurl' },
    logLevel: 'silent',
    metafile: true,
    outfile: path.join(root, `out.${loader}`),
    platform: 'browser',
    plugins: [
      createPreviewAssetPlugin({
        documentPath: path.join(root, 'entry.js'),
        projectRoot: root,
        workspaceRoot: root,
      }),
    ],
    stdin: { contents, loader, resolveDir: root },
    write: false,
  });
}

describe('generated WAV asset URLs', () => {
  it.each(['', '?url', '?cache=1#t=0,1'])(
    'uses a playable MIME for JavaScript imports %s',
    async (suffix) => {
      const result = await compile(
        `import tone from './tone.WAV${suffix}'; export default tone; export const authored = 'data:audio/wave;authored';`,
      );
      const output = result.outputFiles[0]?.text ?? '';
      expect(output).toContain(`data:audio/wav;base64,${waveBytes.toString('base64')}`);
      expect(output).toContain('data:audio/wave;authored');
      expect(output.includes('#t=0,1')).toBe(suffix.includes('#'));
      expect(Object.keys(result.metafile?.inputs ?? {})).toEqual(
        expect.arrayContaining([expect.stringContaining('tone.WAV')]),
      );
    },
  );

  it('preserves explicit raw text imports', async () => {
    const result = await compile("import text from './tone.WAV?raw'; export default text");
    expect(result.outputFiles[0]?.text).toContain('RIFF');
    expect(result.outputFiles[0]?.text).not.toContain('data:audio/');
  });

  it('keeps CSS URL tokens in the CSS data-URL loader', async () => {
    const result = await compile(".tone { background: url('./tone.WAV') }", 'css');
    expect(result.outputFiles[0]?.text).toMatch(/url\(data:audio\/[^,]*,RIFF/u);
    expect(result.outputFiles[0]?.text).toContain('WAVE');
    expect(result.outputFiles[0]?.text).not.toContain('export default');
  });
});
