/**
 * Pre-trains the Page Inspector's profile neural model on real project pages and writes an import
 * document the extension merges into the profile model without resetting it.
 *
 * Build the compiler worker first (`npm run build`), copy the profile model and, for projects
 * without node_modules, the extension's dependency store (never point at the live store). Then:
 *   node scripts/pretrain-page-inspector-neural.mjs --plan plan.json --base profile-model.json \
 *     --store <copy>/dependency-store/v4 --out .tmp/neural-pretraining
 * See `src/adapters/node/previewNeuralPretrainingCli.ts` for every option.
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_ESM_COMPATIBILITY_BANNER } from './preview-node-esm-compatibility.mjs';

/* Keep the bundle below the repository so Node resolves the external esbuild package. */
const temporaryRoot = await mkdtemp(path.join(process.cwd(), '.react-preview-neural-pretraining-'));
const outputPath = path.join(temporaryRoot, 'pretraining.mjs');
try {
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/adapters/node/previewNeuralPretrainingCli.ts')],
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
  process.exitCode = await module.runPreviewNeuralPretrainingCli(process.argv.slice(2));
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
