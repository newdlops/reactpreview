/**
 * Bundles the VS Code extension host entry point into one CommonJS file.
 * The `vscode` API and runtime `esbuild` package remain external because VS Code supplies the
 * former and the packaged extension must retain the latter's platform-specific native binary.
 * TypeScript's parser is bundled so AST resource classification never depends on a user's project.
 */
import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');
const shouldWatch = process.argv.includes('--watch');

const buildOptions = {
  bundle: true,
  entryPoints: ['src/extension.ts'],
  external: ['esbuild', 'vscode'],
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'info',
  minify: isProduction,
  outfile: 'dist/extension.js',
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
