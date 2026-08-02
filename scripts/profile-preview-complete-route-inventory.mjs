/**
 * Bundles the analyzer-only profile CLI and one-shot compiler worker without installing packages.
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const temporaryRoot = await mkdtemp(path.join(process.cwd(), '.react-preview-profile-cli-'));
const outputPath = path.join(temporaryRoot, 'profile.cjs');
const workerPath = path.join(temporaryRoot, 'compiler-worker.cjs');
const require = createRequire(import.meta.url);

try {
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/adapters/node/previewCompleteRouteInventoryProfileCli.ts')],
    external: ['esbuild', 'vscode'],
    format: 'cjs',
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
  const module = require(outputPath);
  process.exitCode = await module.runPreviewCompleteRouteInventoryProfileCli(
    process.argv.slice(2),
    workerPath,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
