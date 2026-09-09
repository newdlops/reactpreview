/** Generates a pre-change benchmark snapshot; never reads installed profiles or user projects. */
import { buildSync } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = process.argv[2];
if (!directory)
  throw new Error('Usage: node scripts/neural-recovery/snapshot-runtime.mjs <directory>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const built = buildSync({
  absWorkingDir: root,
  entryPoints: [
    'src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: factory, exports: factory.exports });
await mkdir(resolve(directory), { recursive: true });
await writeFile(
  resolve(directory, 'baseline-runtime.json'),
  JSON.stringify({
    source: factory.exports.createPreviewInspectorNeuralResidualRuntimeSource(),
  }),
);
console.log('Saved pre-change generated runtime for same-corpus comparison.');
