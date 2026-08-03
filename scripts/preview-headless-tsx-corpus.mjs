/** Builds and invokes the repository-local ESM corpus supervisor host. */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_ESM_COMPATIBILITY_BANNER } from './preview-node-esm-compatibility.mjs';

const runtimeRoot = path.resolve('.tmp/rtcc-tsx-corpus-20260803/runtime');
const runtimePath = path.join(runtimeRoot, 'preview-headless-tsx-corpus-v1.mjs');
const metafilePath = path.join(runtimeRoot, 'preview-headless-tsx-corpus-v1.metafile.json');
await mkdir(runtimeRoot, { recursive: true });
const result = await build({
  banner: { js: NODE_ESM_COMPATIBILITY_BANNER },
  bundle: true,
  entryPoints: [path.resolve('src/adapters/node/previewHeadlessTsxCorpusCampaignCli.ts')],
  external: ['esbuild'],
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  outfile: runtimePath,
  platform: 'node',
  sourcemap: false,
  target: 'node22',
});
await writeFile(metafilePath, `${JSON.stringify(result.metafile, undefined, 2)}\n`);
const module = await import(`${pathToFileURL(runtimePath).href}?campaign=${Date.now().toString(36)}`);
process.exitCode = await module.runPreviewHeadlessTsxCorpusCampaignCli(
  process.argv.slice(2),
  runtimePath,
);
