/**
 * Bundles the VS Code extension host and background compiler into isolated module-format entries.
 * The ESM host stays responsive because parsing and compiler plugins live only in the CommonJS
 * worker; runtime `esbuild` remains external to retain its platform-specific native binary.
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { NODE_ESM_COMPATIBILITY_BANNER } from './preview-node-esm-compatibility.mjs';
import { createPreviewTypeScriptInteropPlugin } from './preview-typescript-interop.mjs';

const isProduction = process.argv.includes('--production');
const shouldWatch = process.argv.includes('--watch');
const REACT_18_RUNTIME_ROOT = path.resolve('dist/runtime/react18/node_modules');
/** ECMAScript declaration libraries read by the worker's declared-type analysis program. */
const TYPESCRIPT_LIB_ROOT = path.resolve('dist/typescript-lib');
const TYPESCRIPT_LIB_FILE_PATTERN =
  /^lib\.(?:es\d{4}|es5|es6|esnext|decorators)(?:\.[a-z.]+)?\.d\.ts$/u;

/** Exact npm alias inputs copied to authored package names in the shipped runtime catalog. */
const REACT_18_RUNTIME_PACKAGES = Object.freeze([
  Object.freeze({
    name: 'react',
    sourceDirectory: 'react-preview-react-18',
    version: '18.3.1',
  }),
  Object.freeze({
    name: 'react-dom',
    sourceDirectory: 'react-preview-react-dom-18',
    version: '18.3.1',
  }),
  Object.freeze({
    name: 'scheduler',
    sourceDirectory: 'react-preview-scheduler-18',
    version: '0.23.2',
  }),
]);

/**
 * Rejects generated JavaScript that exceeds the same physical-line limit as maintained code.
 *
 * @returns {import('esbuild').Plugin} Build and watch validation for each emitted runtime entry.
 */
function createRuntimeLineLimitPlugin() {
  return {
    name: 'runtime-line-limit',
    setup(build) {
      build.onEnd(async (result) => {
        const outfile = build.initialOptions.outfile;
        if (result.errors.length > 0 || outfile === undefined) return;
        const source = await readFile(outfile, 'utf8');
        const lines = (source.match(/\n/gu)?.length ?? 0) + (source.endsWith('\n') ? 0 : 1);
        return lines <= 1000
          ? undefined
          : { errors: [{ text: `${outfile}: ${lines} lines exceeds the 1000-line limit.` }] };
      });
    },
  };
}

const sharedBuildOptions = {
  bundle: true,
  external: ['esbuild', 'vscode'],
  legalComments: 'none',
  logLevel: 'info',
  minify: isProduction,
  // Escape multiline generated templates; source maps retain development debugging locations.
  minifyWhitespace: true,
  platform: 'node',
  plugins: [createPreviewTypeScriptInteropPlugin(), createRuntimeLineLimitPlugin()],
  sourcemap: isProduction ? false : 'external',
  supported: { 'template-literal': false },
  target: 'node20',
};

/**
 * ESM keeps VS Code's extension-host import isolated from workspace-installed CommonJS resolver
 * hooks such as legacy Yarn PnP, which can otherwise reject VS Code's conditional load options.
 */
const extensionBuildOptions = {
  ...sharedBuildOptions,
  banner: {
    js: NODE_ESM_COMPATIBILITY_BANNER,
  },
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
const buildPlans = [
  extensionBuildOptions,
  compilerWorkerBuildOptions,
  {
    ...sharedBuildOptions,
    entryPoints: ['src/previewSassWorker.ts'],
    format: 'cjs',
    outfile: 'dist/previewSassWorker.js',
  },
];

/**
 * Removes the former CommonJS host artifacts so VSIX packaging cannot retain an obsolete entry.
 * Worker output is left intact until its replacement is committed by esbuild.
 *
 * @returns {Promise<void>} Promise resolved after legacy files and the stale runtime are absent.
 */
async function removeObsoleteHostArtifacts() {
  await Promise.all([
    ...['dist/extension.js', 'dist/extension.js.map'].map(async (artifactPath) =>
      rm(artifactPath, { force: true }),
    ),
    rm(REACT_18_RUNTIME_ROOT, { force: true, recursive: true }),
    rm(TYPESCRIPT_LIB_ROOT, { force: true, recursive: true }),
  ]);
}

/**
 * Copies TypeScript's ECMAScript declaration libraries next to the bundled worker.
 *
 * The worker bundles the TypeScript compiler, so its default lib lookup no longer points at an
 * installed package. DOM and host libraries are excluded on purpose: the analysis program uses
 * only `lib.es2022.d.ts` and its references to type application data shapes.
 *
 * @returns Promise resolved after every matching lib file is present below dist.
 */
async function prepareTypeScriptLibCatalog() {
  const sourceRoot = path.resolve('node_modules/typescript/lib');
  await mkdir(TYPESCRIPT_LIB_ROOT, { recursive: true });
  const names = (await readdir(sourceRoot)).filter((name) =>
    TYPESCRIPT_LIB_FILE_PATTERN.test(name),
  );
  if (!names.includes('lib.es2022.d.ts') || !names.includes('lib.es5.d.ts')) {
    throw new Error(`TypeScript ECMAScript libraries are missing from ${sourceRoot}.`);
  }
  await Promise.all(
    names.map(async (name) =>
      cp(path.join(sourceRoot, name), path.join(TYPESCRIPT_LIB_ROOT, name)),
    ),
  );
}

/**
 * Copies the exact React 18 browser runtime into dist under ordinary npm package names.
 *
 * Keeping npm aliases as development-only inputs avoids an unsatisfied ReactDOM 18 peer beside
 * the extension host's React 19, while the VSIX still carries a complete immutable preview tuple.
 * Nested node_modules are excluded because Scheduler is copied as its own verified package and no
 * package-manager installation layout should leak into the release artifact.
 *
 * @returns Promise resolved after all three exact package trees are present below dist.
 */
async function prepareReact18RuntimeCatalog() {
  await mkdir(REACT_18_RUNTIME_ROOT, { recursive: true });
  await Promise.all(
    REACT_18_RUNTIME_PACKAGES.map(async (runtimePackage) => {
      const sourceRoot = path.resolve('node_modules', runtimePackage.sourceDirectory);
      const destinationRoot = path.join(REACT_18_RUNTIME_ROOT, runtimePackage.name);
      await assertRuntimePackageIdentity(sourceRoot, runtimePackage);
      await cp(sourceRoot, destinationRoot, {
        dereference: false,
        errorOnExist: true,
        filter: (sourcePath) => shouldCopyRuntimePath(sourceRoot, sourcePath),
        force: false,
        recursive: true,
        verbatimSymlinks: true,
      });
      await assertRuntimePackageIdentity(destinationRoot, runtimePackage);
    }),
  );
}

/** Rejects missing, renamed, or unexpectedly upgraded catalog build inputs before packaging. */
async function assertRuntimePackageIdentity(packageRoot, expected) {
  const parsed = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (parsed.name !== expected.name || parsed.version !== expected.version) {
    throw new Error(
      `React runtime catalog expected ${expected.name}@${expected.version} in ${packageRoot}.`,
    );
  }
}

/** Keeps package-owned files while excluding nested install state and sensitive configuration. */
function shouldCopyRuntimePath(packageRoot, sourcePath) {
  const relativePath = path.relative(packageRoot, sourcePath);
  if (relativePath === '') return true;
  const segments = relativePath.split(path.sep);
  const basename = segments.at(-1) ?? '';
  return (
    !segments.includes('node_modules') &&
    !/^(?:\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\..*)?)$/iu.test(basename)
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
    await prepareReact18RuntimeCatalog();
    await prepareTypeScriptLibCatalog();
    return;
  }

  await prepareReact18RuntimeCatalog();
  await prepareTypeScriptLibCatalog();
  const contexts = await Promise.all(buildPlans.map(async (options) => esbuild.context(options)));
  await Promise.all(contexts.map(async (context) => context.watch()));
  console.log('Watching extension sources for changes...');
}

await runBuild();
