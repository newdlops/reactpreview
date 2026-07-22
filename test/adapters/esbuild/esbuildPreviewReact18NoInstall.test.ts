/**
 * Reproduces a node_modules-free React 18 TypeScript application whose ordinary webpack build
 * obtains dependencies from a lockfile. The fixture mirrors a nested Yarn Berry workspace while
 * keeping registry and archive operations deterministic and entirely offline.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { acquirePreviewLockedDependencies } from '../../../src/adapters/node/previewLockedDependencyAcquirer';
import { PreviewCompilationError } from '../../../src/domain/preview';
import type {
  PreviewPackageArchiveExtractRequest,
  PreviewPackageArchiveExtractor,
  PreviewPackageArchiveTransport,
  PreviewPackageArchiveTransportRequest,
} from '../../../src/adapters/node/previewPackageArchive';
import type {
  PreviewYarnMetadataTransport,
  PreviewYarnMetadataTransportRequest,
} from '../../../src/adapters/node/previewYarnLockAcquirer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('EsbuildPreviewCompiler without a project React installation', () => {
  /**
   * Selects the extension's compatible React 18 seed from manifest ranges alone. A freshly cloned
   * webpack/TypeScript application may have neither a lockfile nor node_modules, so this path must
   * not depend on package acquisition and must never install into the authored project.
   */
  it('previews a manifest-only React 18 webpack app from the bundled runtime seed', async () => {
    const fixture = await createManifestOnlyReact18WebpackFixture();
    let acquisitionCount = 0;
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: fixture.bundledNodeModulesPath,
      lockedDependencyAcquirer: () => {
        acquisitionCount += 1;
        return Promise.resolve(undefined);
      },
      managedDependencyStoreRoot: fixture.managedStoreRoot,
    });

    try {
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: fixture.targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        sourceText: await readFile(fixture.targetPath, 'utf8'),
        useStorybookPreview: false,
        workspaceRoot: fixture.projectRoot,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(javascript).toContain('manifest-only-react-18-webpack-fixture');
      expect(javascript).toContain('extension-bundled-react-18-seed');
      expect(acquisitionCount).toBe(0);
      await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
      await expectPathToBeMissing(path.join(fixture.projectRoot, 'package-lock.json'));
      await expectPathToBeMissing(path.join(fixture.projectRoot, 'yarn.lock'));
    } finally {
      await compiler.shutdown();
    }
  });

  /**
   * Mirrors Storybook's React 18 webpack sandbox before and after initialization. Its Babel build
   * uses the automatic JSX runtime, but the retained TypeScript config says `jsx: react`; esbuild
   * therefore lowers JSX to a classic factory unless the preview supplies the missing namespace.
   */
  it.each([
    { label: 'before Storybook initialization', withStorybookPreview: false },
    { label: 'after Storybook initialization', withStorybookPreview: true },
  ])('binds classic JSX factories $label', async ({ withStorybookPreview }) => {
    const fixture = await createClassicJsxReact18WebpackFixture(withStorybookPreview);
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: fixture.bundledNodeModulesPath,
      managedDependencyStoreRoot: fixture.managedStoreRoot,
      maximumSplitOutputFiles: 1,
    });

    try {
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: fixture.targetPath,
        language: 'tsx',
        sourceText: await readFile(fixture.targetPath, 'utf8'),
        useStorybookPreview: true,
        workspaceRoot: fixture.projectRoot,
      });
      const javascript = decodeCompleteBundle(bundle);
      const targetModule = selectGeneratedModule(javascript, 'CLASSIC_JSX_NAMESPACE_TARGET');

      expect(targetModule).toContain('createElement');
      expectClassicFactoryReceiversToBeBound(targetModule);
      if (withStorybookPreview) {
        expect(javascript).toContain('STORYBOOK_PREVIEW_SELECTED');
      }
      await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
    } finally {
      await compiler.shutdown();
    }
  });

  /**
   * Reproduces the logged failure when an exact lock acquisition produces no managed layer. This
   * keeps the failure attributable to the unavailable React pair rather than webpack or TypeScript
   * configuration, and proves both package roots were recognized before the compiler stopped.
   */
  it('reports unresolved React imports when the exact lock acquisition cannot publish a layer', async () => {
    const fixture = await createReact18WebpackFixture();
    const acquisitions: string[][] = [];
    const progressStages: string[] = [];
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      lockedDependencyAcquirer: ({ requiredPackageNames }) => {
        acquisitions.push([...(requiredPackageNames ?? [])]);
        return Promise.resolve(undefined);
      },
      managedDependencyStoreRoot: fixture.managedStoreRoot,
    });
    let failure: unknown;

    try {
      await compiler.compile(
        {
          dependencySnapshots: [],
          documentPath: fixture.targetPath,
          language: 'tsx',
          preparationMode: 'fast',
          sourceText: await readFile(fixture.targetPath, 'utf8'),
          useStorybookPreview: false,
          workspaceRoot: fixture.workspaceRoot,
        },
        { reportProgress: (stage) => progressStages.push(stage) },
      );
    } catch (error) {
      failure = error;
    } finally {
      await compiler.shutdown();
    }

    expect(failure).toBeInstanceOf(PreviewCompilationError);
    const diagnosticMessages =
      failure instanceof PreviewCompilationError
        ? failure.diagnostics.map(({ message }) => message)
        : [];
    expect(diagnosticMessages).toEqual(
      expect.arrayContaining(['Could not resolve "react"', 'Could not resolve "react-dom"']),
    );
    expect(acquisitions).toEqual([['react', 'react-dom']]);
    expect(progressStages).toContain('acquiring-dependencies');
    await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
    await expectPathToBeMissing(path.join(fixture.workspaceRoot, 'node_modules'));
  });

  /**
   * Restores the exact React 18 pair selected by an ancestor Berry lock, retries once, and keeps
   * the nested webpack/TypeScript package free from extension-created node_modules state.
   */
  it('previews a nested React 18 webpack TypeScript app with no project node_modules', async () => {
    const fixture = await createReact18WebpackFixture();
    const archives = createReact18Archives();
    const acquisitions: string[][] = [];
    const progressStages: string[] = [];
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      lockedDependencyAcquirer: async (request) => {
        acquisitions.push([...(request.requiredPackageNames ?? [])]);
        return acquirePreviewLockedDependencies({
          ...request,
          extractor: packageExtractor(),
          metadataTransport: metadataTransport(archives),
          transport: archiveTransport(archives),
        });
      },
      managedDependencyStoreRoot: fixture.managedStoreRoot,
    });

    try {
      const bundle = await compiler.compile(
        {
          dependencySnapshots: [],
          documentPath: fixture.targetPath,
          language: 'tsx',
          preparationMode: 'fast',
          sourceText: await readFile(fixture.targetPath, 'utf8'),
          useStorybookPreview: false,
          workspaceRoot: fixture.workspaceRoot,
        },
        { reportProgress: (stage) => progressStages.push(stage) },
      );

      expect(new TextDecoder().decode(bundle.javascript)).toContain('react-18-webpack-fixture');
      expect(acquisitions).toEqual([['react', 'react-dom']]);
      expect(progressStages).toContain('acquiring-dependencies');
      await expectPathToBeMissing(path.join(fixture.projectRoot, 'node_modules'));
      await expectPathToBeMissing(path.join(fixture.workspaceRoot, 'node_modules'));
    } finally {
      await compiler.shutdown();
    }
  });
});

/** Paths owned by one node_modules-free nested webpack application fixture. */
interface React18WebpackFixture {
  readonly managedStoreRoot: string;
  readonly projectRoot: string;
  readonly targetPath: string;
  readonly tsconfigPath: string;
  readonly workspaceRoot: string;
}

/** Paths owned by a package.json-only React 18 application and an extension runtime catalog. */
interface ManifestOnlyReact18WebpackFixture {
  readonly bundledNodeModulesPath: string;
  readonly managedStoreRoot: string;
  readonly projectRoot: string;
  readonly targetPath: string;
}

/** Exact archive bytes and public metadata retained for one package identity. */
interface React18Archive {
  readonly bytes: Uint8Array;
  readonly packageName: 'react' | 'react-dom';
  readonly packageVersion: '18.2.0';
  readonly url: string;
}

/**
 * Writes only inert package, webpack, TypeScript, and Berry lock evidence. No PnP loader or package
 * directory is created, matching a freshly cloned workspace before its package manager runs.
 */
async function createReact18WebpackFixture(): Promise<React18WebpackFixture> {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'react-preview-react18-webpack-')),
  );
  temporaryRoots.push(fixtureRoot);
  const workspaceRoot = path.join(fixtureRoot, 'workspace');
  const projectRoot = path.join(workspaceRoot, 'apps', 'dashboard');
  const sourceRoot = path.join(projectRoot, 'src');
  const targetPath = path.join(sourceRoot, 'App.tsx');
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: { react: 'latest', 'react-dom': 'latest' },
        devDependencies: { typescript: '4.7.4', webpack: '5.88.0' },
        name: '@fixture/dashboard',
        private: true,
        scripts: { build: 'webpack' },
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({
        name: 'fixture-workspace',
        private: true,
        version: '1.0.0',
        workspaces: ['apps/*'],
      }),
      'utf8',
    ),
    writeFile(path.join(workspaceRoot, 'yarn.lock'), react18BerryLock(), 'utf8'),
    writeFile(path.join(workspaceRoot, '.yarnrc.yml'), 'nodeLinker: pnp\n', 'utf8'),
    writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          jsx: 'react',
          module: 'esnext',
          moduleResolution: 'node',
          strict: true,
          target: 'es2018',
        },
        include: ['src'],
      }),
      'utf8',
    ),
    writeFile(
      path.join(projectRoot, 'webpack.config.js'),
      'module.exports = { entry: "./src/App.tsx" };\n',
      'utf8',
    ),
    writeFile(
      targetPath,
      [
        "import React from 'react';",
        'export default function App() {',
        '  return <main>react-18-webpack-fixture</main>;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    ),
  ]);
  return Object.freeze({
    managedStoreRoot: path.join(fixtureRoot, 'global-storage', 'dependency-store'),
    projectRoot,
    targetPath,
    tsconfigPath,
    workspaceRoot,
  });
}

/**
 * Writes a React 18 webpack/TypeScript package with semver declarations but deliberately omits
 * every lockfile and install artifact. The separate extension directory mimics VSIX-owned alias
 * packages, which are eligible to seed global storage but are not directly visible to the app.
 */
async function createManifestOnlyReact18WebpackFixture(): Promise<ManifestOnlyReact18WebpackFixture> {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'react-preview-react18-manifest-only-')),
  );
  temporaryRoots.push(fixtureRoot);
  const projectRoot = path.join(fixtureRoot, 'webpack-app');
  const sourceRoot = path.join(projectRoot, 'src');
  const targetPath = path.join(sourceRoot, 'App.tsx');
  const bundledNodeModulesPath = path.join(fixtureRoot, 'extension', 'node_modules');
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18', 'react-dom': '^18' },
        devDependencies: { typescript: '^5.0.0', webpack: '^5.0.0' },
        name: 'manifest-only-react-18-webpack-app',
        private: true,
        scripts: { build: 'webpack' },
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          jsx: 'react-jsx',
          module: 'esnext',
          moduleResolution: 'node',
          strict: true,
          target: 'es2020',
        },
        include: ['src'],
      }),
      'utf8',
    ),
    writeFile(
      path.join(projectRoot, 'webpack.config.js'),
      'module.exports = { entry: "./src/App.tsx" };\n',
      'utf8',
    ),
    writeFile(
      targetPath,
      [
        "import React from 'react';",
        'export default function App() {',
        '  return <main data-react-version={React.version}>manifest-only-react-18-webpack-fixture</main>;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    ),
    writeBundledReact18Runtime(bundledNodeModulesPath),
  ]);
  return Object.freeze({
    bundledNodeModulesPath,
    managedStoreRoot: path.join(fixtureRoot, 'global-storage', 'dependency-store'),
    projectRoot,
    targetPath,
  });
}

/**
 * Changes the manifest-only fixture to the conflicting Babel/TypeScript JSX configuration used by
 * Storybook's generated webpack sandbox. The target intentionally imports a named React value but
 * never declares the `React` namespace that the classic TypeScript transform otherwise expects.
 */
async function createClassicJsxReact18WebpackFixture(
  withStorybookPreview: boolean,
): Promise<ManifestOnlyReact18WebpackFixture> {
  const fixture = await createManifestOnlyReact18WebpackFixture();
  const storybookDirectory = path.join(fixture.projectRoot, '.storybook');
  await Promise.all([
    writeFile(
      path.join(fixture.projectRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          allowSyntheticDefaultImports: true,
          jsx: 'react',
          target: 'es5',
        },
        include: ['src/*'],
      }),
      'utf8',
    ),
    writeFile(
      path.join(fixture.projectRoot, '.babelrc'),
      JSON.stringify({
        presets: [
          ['@babel/preset-env', { targets: { chrome: '100' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      }),
      'utf8',
    ),
    writeFile(
      fixture.targetPath,
      [
        "import { StrictMode } from 'react';",
        'export default function App() {',
        '  return (',
        '    <StrictMode>',
        '      <main>CLASSIC_JSX_NAMESPACE_TARGET</main>',
        '    </StrictMode>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'utf8',
    ),
  ]);
  if (withStorybookPreview) {
    await mkdir(storybookDirectory, { recursive: true });
    await writeFile(
      path.join(storybookDirectory, 'preview.tsx'),
      [
        "import type { Preview } from '@storybook/react-webpack5';",
        'globalThis.STORYBOOK_PREVIEW_SELECTED = true;',
        'const preview: Preview = { parameters: { controls: {} } };',
        'export default preview;',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  return fixture;
}

/** Decodes the entry and any split chunks so target source can be checked independent of policy. */
function decodeCompleteBundle(bundle: {
  readonly chunks: readonly { readonly contents: Uint8Array }[];
  readonly javascript: Uint8Array;
}): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map(({ contents }) => contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}

/** Selects the generated source module containing one fixture-only marker. */
function selectGeneratedModule(javascript: string, marker: string): string {
  const markerIndex = javascript.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const moduleStart = javascript.lastIndexOf('\n// ', markerIndex);
  const nextModuleStart = javascript.indexOf('\n// ', markerIndex);
  return javascript.slice(
    moduleStart < 0 ? 0 : moduleStart,
    nextModuleStart < 0 ? javascript.length : nextModuleStart,
  );
}

/**
 * Proves every classic JSX factory receiver is lexical rather than an undeclared browser global.
 * The receiver name is intentionally not fixed because esbuild renames deduplicated imports.
 */
function expectClassicFactoryReceiversToBeBound(generatedModule: string): void {
  const receiverNames = [
    ...new Set(
      [...generatedModule.matchAll(/\b([A-Za-z_$][\w$]*)\.createElement\(/gu)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      ),
    ),
  ];
  expect(receiverNames.length).toBeGreaterThan(0);
  const declaredNames = new Set(
    [...generatedModule.matchAll(/\bvar\s+([^;]+);/gu)].flatMap((match) =>
      (match[1] ?? '')
        .split(',')
        .map((declaration) => /^\s*([A-Za-z_$][\w$]*)/u.exec(declaration)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  );
  expect(receiverNames.filter((name) => !declaredNames.has(name))).toEqual([]);
}

/** Writes the exact three alias packages retained by the extension's React 18 runtime catalog. */
async function writeBundledReact18Runtime(nodeModulesPath: string): Promise<void> {
  await Promise.all([
    writeBundledPackage(
      nodeModulesPath,
      'react-preview-react-18',
      'react',
      '18.2.0',
      bundledReact18Files(),
      {
        '.': './index.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './jsx-runtime': './jsx-runtime.js',
      },
    ),
    writeBundledPackage(
      nodeModulesPath,
      'react-preview-react-dom-18',
      'react-dom',
      '18.2.0',
      {
        'client.js': [
          "exports.seed = 'extension-bundled-react-dom-18-seed';",
          'exports.createRoot = function createRoot() {',
          '  return { render: function render() {}, unmount: function unmount() {} };',
          '};',
          '',
        ].join('\n'),
        'index.js': [
          'exports.createPortal = function createPortal(child) { return child; };',
          'exports.flushSync = function flushSync(callback) { return callback(); };',
          'exports.render = function render() {};',
          'exports.unmountComponentAtNode = function unmountComponentAtNode() {};',
          '',
        ].join('\n'),
      },
      { '.': './index.js', './client': './client.js' },
    ),
    writeBundledPackage(nodeModulesPath, 'react-preview-scheduler-18', 'scheduler', '0.23.0', {
      'index.js': [
        'exports.unstable_now = Date.now;',
        'exports.unstable_scheduleCallback = function scheduleCallback(_priority, callback) {',
        '  return callback();',
        '};',
        '',
      ].join('\n'),
    }),
  ]);
}

/** Browser-bundleable React surfaces whose marker proves the compatible seed was selected. */
function bundledReact18Files(): Readonly<Record<string, string>> {
  const jsxRuntime = [
    "const React = require('./index.js');",
    'exports.Fragment = React.Fragment;',
    'exports.jsx = React.createElement;',
    'exports.jsxs = React.createElement;',
    'exports.jsxDEV = React.createElement;',
    '',
  ].join('\n');
  return Object.freeze({
    'index.js': [
      "const seed = 'extension-bundled-react-18-seed';",
      'class Component {}',
      'function identity(value) { return value; }',
      'function createElement(type, props) { return { type: type, props: props || {} }; }',
      'const React = {',
      '  Component: Component,',
      "  Fragment: Symbol.for('react.fragment'),",
      "  Suspense: Symbol.for('react.suspense'),",
      '  cloneElement: identity,',
      '  createContext: function createContext(value) {',
      '    return { Consumer: {}, Provider: {}, _currentValue: value };',
      '  },',
      '  createElement: createElement,',
      '  forwardRef: identity,',
      '  lazy: identity,',
      '  memo: identity,',
      '  startTransition: function startTransition(callback) { callback(); },',
      '  useCallback: identity,',
      '  useContext: function useContext(context) { return context._currentValue; },',
      '  useEffect: function useEffect() {},',
      '  useLayoutEffect: function useLayoutEffect() {},',
      '  useMemo: function useMemo(factory) { return factory(); },',
      '  useReducer: function useReducer(_reducer, value) { return [value, function dispatch() {}]; },',
      '  useRef: function useRef(value) { return { current: value }; },',
      '  useState: function useState(value) { return [value, function setValue() {}]; },',
      '  useSyncExternalStore: function useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },',
      '  version: "18.2.0",',
      '  __previewSeed: seed,',
      '};',
      'module.exports = React;',
      'module.exports.default = React;',
      '',
    ].join('\n'),
    'jsx-dev-runtime.js': jsxRuntime,
    'jsx-runtime.js': jsxRuntime,
  });
}

/** Writes one extension-owned npm alias while preserving the package's authored identity. */
async function writeBundledPackage(
  nodeModulesPath: string,
  directoryName: string,
  packageName: string,
  version: string,
  files: Readonly<Record<string, string>>,
  exportsMap: Readonly<Record<string, string>> = { '.': './index.js' },
): Promise<void> {
  const packageRoot = path.join(nodeModulesPath, directoryName);
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ exports: exportsMap, main: 'index.js', name: packageName, version }),
      'utf8',
    ),
    ...Object.entries(files).map(([relativePath, source]) =>
      writeFile(path.join(packageRoot, relativePath), source, 'utf8'),
    ),
  ]);
}

/** Serializes the two exact npm resolutions selected by the nested workspace manifest. */
function react18BerryLock(): string {
  return [
    '__metadata:',
    '  version: 6',
    '',
    '"react@npm:latest":',
    '  version: 18.2.0',
    '  resolution: "react@npm:18.2.0"',
    '  languageName: node',
    '  linkType: hard',
    '',
    '"react-dom@npm:latest":',
    '  version: 18.2.0',
    '  resolution: "react-dom@npm:18.2.0"',
    '  peerDependencies:',
    '    react: ^18.2.0',
    '  languageName: node',
    '  linkType: hard',
    '',
  ].join('\n');
}

/** Creates stable compressed-body stand-ins keyed by exact React package identity. */
function createReact18Archives(): ReadonlyMap<string, React18Archive> {
  return new Map(
    (['react', 'react-dom'] as const).map((packageName) => {
      const archive: React18Archive = Object.freeze({
        bytes: Buffer.from(`${packageName}-18.2.0-archive`),
        packageName,
        packageVersion: '18.2.0',
        url: `https://registry.npmjs.org/${packageName}/-/${packageName}-18.2.0.tgz`,
      });
      return [`${packageName}\0${archive.packageVersion}`, archive] as const;
    }),
  );
}

/** Supplies exact-version registry metadata without allowing a real network request. */
function metadataTransport(
  archives: ReadonlyMap<string, React18Archive>,
): PreviewYarnMetadataTransport {
  return Object.freeze({
    download: (request: PreviewYarnMetadataTransportRequest) => {
      const archive = archives.get(`${request.packageName}\0${request.packageVersion}`);
      if (archive === undefined) {
        throw new Error(`Unexpected metadata identity: ${request.packageName}`);
      }
      return Promise.resolve(
        Buffer.from(
          JSON.stringify({
            dist: { integrity: sri(archive.bytes), tarball: archive.url },
            name: archive.packageName,
            version: archive.packageVersion,
          }),
        ),
      );
    },
  });
}

/** Returns exact archive stand-ins after matching the production planner's admitted URL. */
function archiveTransport(
  archives: ReadonlyMap<string, React18Archive>,
): PreviewPackageArchiveTransport {
  const archiveByUrl = new Map([...archives.values()].map((archive) => [archive.url, archive]));
  return Object.freeze({
    download: (request: PreviewPackageArchiveTransportRequest) => {
      if (request.signal.aborted) throw request.signal.reason;
      const archive = archiveByUrl.get(request.url);
      if (archive === undefined) throw new Error(`Unexpected archive URL: ${request.url}`);
      return Promise.resolve(Uint8Array.from(archive.bytes));
    },
  });
}

/** Materializes browser-bundleable React package surfaces without executing application code. */
function packageExtractor(): PreviewPackageArchiveExtractor {
  return Object.freeze({
    extract: async (request: PreviewPackageArchiveExtractRequest) => {
      if (request.signal.aborted) throw request.signal.reason;
      await mkdir(request.targetPath, { recursive: false });
      await writeFile(
        path.join(request.targetPath, 'package.json'),
        JSON.stringify({ main: 'index.js', name: request.packageName, version: '18.2.0' }),
        'utf8',
      );
      if (request.packageName === 'react') {
        await writeFile(
          path.join(request.targetPath, 'index.js'),
          'module.exports = new Proxy({}, { get: () => function PreviewReactValue() {} });\n',
          'utf8',
        );
        return;
      }
      await Promise.all([
        writeFile(
          path.join(request.targetPath, 'index.js'),
          'exports.render = function render() {}; exports.unmountComponentAtNode = function unmount() {};\n',
          'utf8',
        ),
        writeFile(
          path.join(request.targetPath, 'client.js'),
          'exports.createRoot = function createRoot() { return { render() {}, unmount() {} }; };\n',
          'utf8',
        ),
      ]);
    },
  });
}

/** Computes the SHA-512 SRI required by the production archive admission boundary. */
function sri(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** Confirms that preview dependency restoration never installed into the authored workspace. */
async function expectPathToBeMissing(candidatePath: string): Promise<void> {
  await expect(lstat(candidatePath)).rejects.toMatchObject({ code: 'ENOENT' });
}
