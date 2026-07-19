/**
 * Bundles the VS Code extension host and background compiler into isolated module-format entries.
 * The ESM host stays responsive because parsing and compiler plugins live only in the CommonJS
 * worker; runtime `esbuild` remains external to retain its platform-specific native binary.
 */
import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';

const isProduction = process.argv.includes('--production');
const shouldWatch = process.argv.includes('--watch');

const sharedBuildOptions = {
  bundle: true,
  external: ['esbuild', 'vscode'],
  legalComments: 'none',
  logLevel: 'info',
  minify: isProduction,
  platform: 'node',
  sourcemap: isProduction ? false : 'external',
  target: 'node20',
};

/**
 * ESM keeps VS Code's extension-host import isolated from workspace-installed CommonJS resolver
 * hooks such as legacy Yarn PnP, which can otherwise reject VS Code's conditional load options.
 */
const extensionBuildOptions = {
  ...sharedBuildOptions,
  entryPoints: ['src/extension.ts'],
  format: 'esm',
  outfile: 'dist/extension.mjs',
};

/**
 * The compiler remains CommonJS because Node Worker owns its process boundary and esbuild's native
 * package is deliberately external to the bundle for platform-specific binary discovery.
 */
const compilerWorkerBuildOptions = {
  ...sharedBuildOptions,
  entryPoints: ['src/previewCompilerWorker.ts'],
  format: 'cjs',
  outfile: 'dist/previewCompilerWorker.js',
};

/** Independent host and compiler build plans with distinct module formats. */
const buildPlans = [extensionBuildOptions, compilerWorkerBuildOptions];

/**
 * Removes the former CommonJS host artifacts so VSIX packaging cannot retain an obsolete entry.
 * Worker output is left intact until its replacement is committed by esbuild.
 *
 * @returns {Promise<void>} Promise resolved after both known legacy files are absent.
 */
async function removeObsoleteHostArtifacts() {
  await Promise.all(
    ['dist/extension.js', 'dist/extension.js.map'].map(async (artifactPath) =>
      rm(artifactPath, { force: true }),
    ),
  );
}

/**
 * Runs either a one-shot extension build or a persistent incremental build.
 * In watch mode esbuild owns the process lifetime and rebuilds after source-file changes.
 *
 * @returns {Promise<void>} A promise that resolves after setup or the one-shot build completes.
 */
async function runBuild() {
  await removeObsoleteHostArtifacts();
  if (!shouldWatch) {
    await Promise.all(buildPlans.map(async (options) => esbuild.build(options)));
    return;
  }

  const contexts = await Promise.all(buildPlans.map(async (options) => esbuild.context(options)));
  await Promise.all(contexts.map(async (context) => context.watch()));
  console.log('Watching extension sources for changes...');
}

await runBuild();
