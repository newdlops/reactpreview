/**
 * Bundles the VS Code extension host and background compiler into separate CommonJS entry files.
 * The host stays responsive because TypeScript parsing and compiler plugins live only in the worker;
 * runtime `esbuild` remains external so the package retains its platform-specific native binary.
 */
import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');
const shouldWatch = process.argv.includes('--watch');

const buildOptions = {
  bundle: true,
  entryPoints: {
    extension: 'src/extension.ts',
    previewCompilerWorker: 'src/previewCompilerWorker.ts',
  },
  external: ['esbuild', 'vscode'],
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'info',
  minify: isProduction,
  outdir: 'dist',
  platform: 'node',
  sourcemap: isProduction ? false : 'external',
  target: 'node20',
};

/**
 * Runs either a one-shot extension build or a persistent incremental build.
 * In watch mode esbuild owns the process lifetime and rebuilds after source-file changes.
 *
 * @returns {Promise<void>} A promise that resolves after setup or the one-shot build completes.
 */
async function runBuild() {
  if (!shouldWatch) {
    await esbuild.build(buildOptions);
    return;
  }

  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('Watching extension sources for changes...');
}

await runBuild();
