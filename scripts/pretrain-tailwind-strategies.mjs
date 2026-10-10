/**
 * Measures real Tailwind releases through the preview Tailwind pipeline and (optionally)
 * regenerates the adapter-strategy seed shipped with the extension.
 *
 * Install the releases first, outside every project, for example:
 *   npm install --prefix .tmp/tailwind-strategy-matrix/installs/3.4.19 --no-save \
 *     --no-package-lock --ignore-scripts tailwindcss@3.4.19 postcss@8 && \
 *     touch .tmp/tailwind-strategy-matrix/installs/3.4.19/.done
 * (v4 releases install `tailwindcss@<v> @tailwindcss/postcss@<v>` instead.) Then run:
 *   node scripts/pretrain-tailwind-strategies.mjs [--write-seed src/adapters/esbuild/previewAdapterStrategySeed.ts]
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_ESM_COMPATIBILITY_BANNER } from './preview-node-esm-compatibility.mjs';

/* Keep the bundle below the repository so Node resolves the external esbuild package. */
const temporaryRoot = await mkdtemp(path.join(process.cwd(), '.react-preview-tailwind-matrix-'));
const outputPath = path.join(temporaryRoot, 'matrix.mjs');
try {
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/adapters/node/previewTailwindStrategyMatrixCli.ts')],
    banner: { js: NODE_ESM_COMPATIBILITY_BANNER },
    external: ['esbuild', 'vscode'],
    format: 'esm',
    logLevel: 'silent',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
    outfile: outputPath,
  });
  const module = await import(pathToFileURL(outputPath).href);
  process.exitCode = await module.runPreviewTailwindStrategyMatrixCli(process.argv.slice(2));
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
