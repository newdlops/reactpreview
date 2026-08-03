/**
 * Bundles the TypeScript campaign entry point with the repository's existing esbuild dependency.
 * The generated runner lives under the OS temp directory and never mutates the target workspace.
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_ESM_COMPATIBILITY_BANNER } from './preview-node-esm-compatibility.mjs';

/*
 * Keep the ephemeral bundle below the repository so Node can resolve the intentionally external
 * esbuild package (and its platform binary) from this installation's node_modules.
 */
const temporaryRoot = await mkdtemp(path.join(process.cwd(), '.react-preview-route-cli-'));
const outputPath = path.join(temporaryRoot, 'campaign.mjs');
const workerPath = path.join(temporaryRoot, 'compiler-worker.cjs');

try {
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/adapters/node/previewHeadlessRouteCampaignCli.ts')],
    banner: { js: NODE_ESM_COMPATIBILITY_BANNER },
    external: ['esbuild', 'vscode'],
    format: 'esm',
    logLevel: 'silent',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
    outfile: outputPath,
  });
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/previewCompilerWorker.ts')],
    external: ['esbuild', 'vscode'],
    format: 'cjs',
    logLevel: 'silent',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
    outfile: workerPath,
  });
  const module = await import(pathToFileURL(outputPath).href);
  process.exitCode = await module.runPreviewHeadlessRouteCampaignCli(
    process.argv.slice(2),
    workerPath,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
