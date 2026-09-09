/** Measures the existing production worker and owned Chromium fixture; never launches project scripts. */
import { build } from 'esbuild';
import { access, writeFile } from 'node:fs/promises';
import { createRequire, Module } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    browser: { type: 'boolean', default: false },
    mode: { type: 'string', default: 'page-inspector' },
    output: { type: 'string' },
    samples: { type: 'string', default: '7' },
    worker: { type: 'string', default: 'dist/previewCompilerWorker.js' },
  },
});
const samples = Number(values.samples);
if (!Number.isInteger(samples) || samples < 1 || samples > 30) {
  throw new Error('--samples must be an integer between 1 and 30.');
}
if (!['component', 'page-inspector'].includes(values.mode)) {
  throw new Error('--mode must be component or page-inspector.');
}
const workerPath = path.resolve(values.worker);
await access(workerPath);
const result = await build({
  bundle: true,
  entryPoints: ['test/performance/previewLoadingFixture.ts'],
  external: ['esbuild', 'typescript', 'vscode'],
  format: 'cjs',
  logLevel: 'silent',
  platform: 'node',
  target: 'node20',
  write: false,
});
// Compile only the owned benchmark harness in memory; the measured worker stays unmodified on disk.
const harnessPath = path.resolve('test/performance/preview-loading-harness.cjs');
const harness = new Module(harnessPath);
harness.filename = harnessPath;
harness.require = createRequire(harnessPath);
harness._compile(result.outputFiles[0].text, harnessPath);
const measurements = [];
for (let index = 0; index < samples; index += 1) {
  const measurement = await harness.exports.runPreviewLoadingSample(
    workerPath,
    values.browser,
    values.mode,
  );
  measurements.push(measurement);
  process.stderr.write(`Completed loading sample ${index + 1}/${samples}.\n`);
}
const medians = Object.fromEntries(
  Object.keys(measurements[0]).map((key) => {
    const sorted = measurements.map((measurement) => measurement[key]).sort((a, b) => a - b);
    return [key, sorted[Math.floor(sorted.length / 2)]];
  }),
);
const report = JSON.stringify(
  { browser: values.browser, mode: values.mode, workerPath, samples: measurements, medians },
  null,
  2,
);
if (values.output !== undefined) {
  await writeFile(path.resolve(values.output), `${report}\n`, { flag: 'wx', mode: 0o600 });
}
process.stdout.write(`${report}\n`);
