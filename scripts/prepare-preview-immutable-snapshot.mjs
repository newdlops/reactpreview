/** Bundles and runs the immutable snapshot preparer without installing dependencies. */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const temporaryRoot = await mkdtemp(path.join(process.cwd(), '.react-preview-snapshot-cli-'));
const outputPath = path.join(temporaryRoot, 'snapshot.cjs');
const require = createRequire(import.meta.url);

try {
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/adapters/node/previewImmutableSnapshotCli.ts')],
    external: ['esbuild', 'vscode'],
    format: 'cjs',
    logLevel: 'silent',
    platform: 'node',
    sourcemap: false,
    target: 'node22',
    outfile: outputPath,
  });
  const module = require(outputPath);
  process.exitCode = await module.runPreviewImmutableSnapshotCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
