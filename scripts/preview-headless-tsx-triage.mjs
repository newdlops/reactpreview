/** Builds and invokes the source-only blocker/Unrendered triage host. */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_ESM_COMPATIBILITY_BANNER } from './preview-node-esm-compatibility.mjs';

const runtimeRoot = path.resolve('.tmp/preview-headless-tsx-triage/runtime');
const runtimePath = path.join(runtimeRoot, 'preview-headless-tsx-triage.mjs');
await mkdir(runtimeRoot, { recursive: true });
await build({
  banner: { js: NODE_ESM_COMPATIBILITY_BANNER },
  bundle: true,
  entryPoints: [path.resolve('src/adapters/node/previewHeadlessTsxCorpusTriageCli.ts')],
  external: ['typescript'],
  format: 'esm',
  logLevel: 'silent',
  outfile: runtimePath,
  platform: 'node',
  sourcemap: false,
  target: 'node22',
});
const module = await import(`${pathToFileURL(runtimePath).href}?triage=${Date.now().toString(36)}`);
process.exitCode = await module.runPreviewHeadlessTsxCorpusTriageCli(process.argv.slice(2));
