import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import {
  createPreviewInspectorCorridorPlugin,
  type PreviewInspectorAncestorPlan,
} from '../../../src/adapters/esbuild/inspector';
import { createPreviewInspectorRuntimePlugin } from '../../../src/adapters/esbuild/pageInspector';
import {
  PREVIEW_COMPILER_PRIVATE_NAMESPACES,
  createPreviewOwnedNamespaceRegistry,
} from '../../../src/adapters/esbuild/previewOwnedNamespaceRegistry';
import {
  PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
  PREVIEW_STDIN_ENTRY_NAME,
  createPreviewSyntheticInputRegistry,
} from '../../../src/adapters/esbuild/previewSyntheticInputRegistry';
import {
  assertPreviewBuildInputIdentities,
  assertPreviewResolutionPath,
  assertPreviewResolutionPaths,
  createPreviewResolutionConfinementPathMemo,
  createPreviewResolutionConfinementPlugin,
  normalizePreviewResolutionConfinement,
} from '../../../src/adapters/esbuild/previewResolutionConfinement';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';
import {
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
} from '../../../src/adapters/esbuild/previewPluginProtocol';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('preview resolution confinement', () => {
  it('memoizes only successful exact candidate assertions and releases audit state', () => {
    const memo = createPreviewResolutionConfinementPathMemo();
    const candidates = [
      '/workspace/App.tsx',
      './workspace/App.tsx',
      '/workspace/app.tsx',
      '/workspace/App.tsx?raw',
      '/workspace/App.tsx#hash',
      '/workspace\\App.tsx',
    ];
    const computations = new Map<string, number>();
    for (const candidate of candidates) {
      expect(
        memo.assert(candidate, () => {
          computations.set(candidate, (computations.get(candidate) ?? 0) + 1);
          return `canonical:${candidate}`;
        }),
      ).toBe(`canonical:${candidate}`);
    }
    for (const candidate of candidates) {
      expect(
        memo.assert(candidate, () => {
          throw new Error('A retained success must not recompute.');
        }),
      ).toBe(`canonical:${candidate}`);
    }
    expect(computations).toEqual(new Map(candidates.map((candidate) => [candidate, 1])));
    expect(memo.getStatistics()).toEqual({
      computations: candidates.length,
      entries: candidates.length,
      hits: candidates.length,
      released: false,
      requests: candidates.length * 2,
    });
    expect(Object.isFrozen(memo.getStatistics())).toBe(true);

    const rejection = new Error('synthetic physical assertion rejection');
    let rejectedComputations = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let observed: unknown;
      try {
        memo.assert('/workspace/rejected.tsx', () => {
          rejectedComputations += 1;
          throw rejection;
        });
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(rejection);
    }
    expect(rejectedComputations).toBe(2);
    expect(memo.getStatistics()).toEqual({
      computations: candidates.length + 2,
      entries: candidates.length,
      hits: candidates.length,
      released: false,
      requests: candidates.length * 2 + 2,
    });

    memo.release();
    memo.release();
    const released = memo.getStatistics();
    expect(released).toEqual({
      computations: candidates.length + 2,
      entries: 0,
      hits: candidates.length,
      released: true,
      requests: candidates.length * 2 + 2,
    });
    let postReleaseComputations = 0;
    expect(() =>
      memo.assert('/workspace/App.tsx', () => {
        postReleaseComputations += 1;
        return 'unreachable';
      }),
    ).toThrow('already released');
    expect(postReleaseComputations).toBe(0);
    expect(memo.getStatistics()).toEqual(released);
  });

  it('admits snapshot source and approved installed packages after canonical realpath', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const targetPath = path.join(sourceRoot, 'src', 'App.tsx');
    const packagePath = path.join(dependencyRoot, 'react', 'index.js');
    await mkdir(path.dirname(targetPath), { recursive: true });
    await mkdir(path.dirname(packagePath), { recursive: true });
    await writeFile(targetPath, 'export default function App() {}');
    await writeFile(packagePath, 'export const version = "test";');
    const request = createRequest(sourceRoot, targetPath, dependencyRoot);
    const confinement = normalizePreviewResolutionConfinement(request);
    if (confinement === undefined) throw new Error('Expected normalized confinement.');

    expect(assertPreviewResolutionPath(confinement, targetPath)).toBe(await realpath(targetPath));
    expect(assertPreviewResolutionPath(confinement, packagePath)).toBe(await realpath(packagePath));
    expect(() => {
      assertPreviewResolutionPaths(undefined, ['/unconfined/path']);
    }).not.toThrow();
  });

  it('rejects symlink escapes, live workspace source, and invalid identities', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const outsidePath = path.join(directory, 'live-worktree', 'App.tsx');
    const targetPath = path.join(sourceRoot, 'App.tsx');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(targetPath, 'export default function App() {}');
    await writeFile(outsidePath, 'export default function LiveApp() {}');
    await symlink(outsidePath, path.join(sourceRoot, 'escaped.tsx'));
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, targetPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');

    expect(() =>
      assertPreviewResolutionPath(confinement, path.join(sourceRoot, 'escaped.tsx')),
    ).toThrow('escaped');
    expect(() => assertPreviewResolutionPath(confinement, outsidePath)).toThrow('escaped');
    expect(() =>
      normalizePreviewResolutionConfinement({
        ...createRequest(sourceRoot, targetPath, dependencyRoot),
        resolutionConfinement: {
          approvedDependencyRoots: [dependencyRoot],
          dependencyViewDigest: 'not-a-digest',
          policyDigest: 'a'.repeat(64),
          sourceManifestDigest: 'b'.repeat(64),
          sourceRoot,
        },
      }),
    ).toThrow('SHA-256');
  });

  it('audits recovered file-backed metafile payloads before registered virtual inputs', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const targetPath = path.join(sourceRoot, 'App.tsx');
    const assetPath = path.join(sourceRoot, 'assets', 'logo.png');
    const outsidePath = path.join(directory, 'live-worktree', 'outside.png');
    const escapedLink = path.join(sourceRoot, 'assets', 'escaped.png');
    await mkdir(path.dirname(assetPath), { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(targetPath, 'export default function App() {}');
    await writeFile(assetPath, new Uint8Array([1]));
    await writeFile(outsidePath, new Uint8Array([2]));
    await symlink(outsidePath, escapedLink);
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, targetPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const owner = emptyPlugin('file-and-virtual-owner');
    const registry = createPreviewOwnedNamespaceRegistry(
      [owner],
      [
        { namespace: PREVIEW_ASSET_NAMESPACE, ownerPluginName: owner.name },
        { namespace: PREVIEW_DATA_URL_NAMESPACE, ownerPluginName: owner.name },
        { namespace: 'registered-virtual', ownerPluginName: owner.name },
      ],
    );
    const syntheticRegistry = createPreviewSyntheticInputRegistry([]);

    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        registry,
        syntheticRegistry,
        [
          `${PREVIEW_ASSET_NAMESPACE}:assets/logo.png?url#marker`,
          `${PREVIEW_DATA_URL_NAMESPACE}:${assetPath}#inline`,
          `registered-virtual:${outsidePath}`,
        ],
        sourceRoot,
      );
    }).not.toThrow();
    for (const escapedIdentity of [
      `${PREVIEW_ASSET_NAMESPACE}:../live-worktree/outside.png`,
      `${PREVIEW_DATA_URL_NAMESPACE}:${outsidePath}?inline`,
      `${PREVIEW_ASSET_NAMESPACE}:assets/escaped.png`,
    ]) {
      expect(() => {
        assertPreviewBuildInputIdentities(
          confinement,
          registry,
          syntheticRegistry,
          [escapedIdentity],
          sourceRoot,
        );
      }).toThrow('escaped');
    }
    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        registry,
        syntheticRegistry,
        [`${PREVIEW_ASSET_NAMESPACE}:`],
        sourceRoot,
      );
    }).toThrow('empty physical payload');
  });

  it('runs the confinement plugin through a real esbuild file build', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const targetPath = path.join(sourceRoot, 'App.ts');
    const dependencyPath = path.join(dependencyRoot, 'approved', 'index.js');
    await mkdir(path.dirname(targetPath), { recursive: true });
    await mkdir(path.dirname(dependencyPath), { recursive: true });
    await writeFile(
      targetPath,
      `import { approved } from ${JSON.stringify(dependencyPath)}; export default approved;`,
    );
    await writeFile(dependencyPath, 'export const approved = "confined";');
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, targetPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const registry = createPreviewOwnedNamespaceRegistry([], []);

    const result = await build({
      bundle: true,
      entryPoints: [targetPath],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      plugins: [
        createPreviewResolutionConfinementPlugin(
          confinement,
          registry,
          createPreviewSyntheticInputRegistry([]),
        ),
      ],
      write: false,
    });

    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0]?.text).toContain('confined');
  });

  it('freezes unique ownership and rejects duplicate, malformed, or missing owners', () => {
    const owner = emptyPlugin('registered-owner');
    const registry = createPreviewOwnedNamespaceRegistry(
      [owner],
      [{ namespace: 'registered-virtual', ownerPluginName: owner.name }],
    );

    expect(registry.ownerOf('registered-virtual')).toBe(owner.name);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.registrations)).toBe(true);
    expect(() =>
      createPreviewOwnedNamespaceRegistry(
        [owner],
        [
          { namespace: 'registered-virtual', ownerPluginName: owner.name },
          { namespace: 'registered-virtual', ownerPluginName: owner.name },
        ],
      ),
    ).toThrow('duplicate owners');
    expect(() =>
      createPreviewOwnedNamespaceRegistry(
        [owner],
        [{ namespace: 'registered-virtual', ownerPluginName: 'missing-owner' }],
      ),
    ).toThrow('no installed owner');
    expect(() =>
      createPreviewOwnedNamespaceRegistry(
        [owner],
        [{ namespace: 'file', ownerPluginName: owner.name }],
      ),
    ).toThrow('Malformed');
  });

  it('delegates the actual omitted corridor namespace to its owning plugin', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const dormantPath = path.join(sourceRoot, 'Dormant.ts');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(entryPath, `export const dormant = () => import('./Dormant');`);
    await writeFile(dormantPath, `export default 'MUST_NOT_BUNDLE';`);
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, entryPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const corridor = createPreviewInspectorCorridorPlugin({
      maximumSmallDynamicImports: 0,
      plan: createCorridorPlan(entryPath),
      projectRoot: sourceRoot,
      resolveModule: createPreviewStaticModuleResolver({ workspaceRoot: sourceRoot }).resolve,
      workspaceRoot: sourceRoot,
    });
    const registry = createPreviewOwnedNamespaceRegistry(
      [corridor],
      [
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorCorridor,
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorStaticCorridor,
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorShallowCorridor,
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorVirtualPageComponent,
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorVirtualPageComponentRuntime,
      ].map((namespace) => ({ namespace, ownerPluginName: corridor.name })),
    );

    const result = await build({
      absWorkingDir: sourceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      outdir: path.join(sourceRoot, 'out'),
      plugins: [
        createPreviewResolutionConfinementPlugin(
          confinement,
          registry,
          createPreviewSyntheticInputRegistry([]),
        ),
        corridor,
      ],
      splitting: true,
      write: false,
    });

    expect(result.outputFiles.map((file) => file.text).join('\n')).toContain(
      'ReactPreviewDeferredCorridorRoute',
    );
    expect(result.outputFiles.map((file) => file.text).join('\n')).not.toContain('MUST_NOT_BUNDLE');
    expect(Object.keys(result.metafile.inputs)).toContain(
      `${PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorCorridor}:omitted-deferred-route`,
    );
  });

  it('delegates the actual Inspector JSX runtime namespace without canonicalizing its JSON payload', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const reactRoot = path.join(dependencyRoot, 'react');
    const entryPath = path.join(sourceRoot, 'entry.tsx');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(reactRoot, { recursive: true });
    await writeFile(entryPath, `export const node = <div data-preview="owned" />;`);
    await writeFile(
      path.join(reactRoot, 'package.json'),
      JSON.stringify({
        exports: {
          '.': './index.js',
          './jsx-dev-runtime': './jsx-runtime.js',
          './jsx-runtime': './jsx-runtime.js',
        },
        name: 'react',
        type: 'module',
        version: '1.0.0',
      }),
    );
    await writeFile(
      path.join(reactRoot, 'index.js'),
      [
        'export const createContext = () => ({});',
        'export const createElement = () => ({});',
        'export const forwardRef = (value) => value;',
        'export const useContext = () => undefined;',
        'export const useMemo = (value) => value();',
        'export const useRef = () => ({});',
      ].join('\n'),
    );
    await writeFile(
      path.join(reactRoot, 'jsx-runtime.js'),
      'export const Fragment = Symbol(); export const jsx = () => ({}); export const jsxs = jsx; export const jsxDEV = jsx;',
    );
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, entryPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const inspectorRuntime = createPreviewInspectorRuntimePlugin({ projectRoot: sourceRoot });
    const registry = createPreviewOwnedNamespaceRegistry(
      [inspectorRuntime],
      [
        PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorJsxRuntime,
        PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorPortalRuntime,
      ].map((namespace) => ({ namespace, ownerPluginName: inspectorRuntime.name })),
    );

    const result = await build({
      absWorkingDir: sourceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      jsx: 'automatic',
      logLevel: 'silent',
      metafile: true,
      nodePaths: [dependencyRoot],
      plugins: [
        createPreviewResolutionConfinementPlugin(
          confinement,
          registry,
          createPreviewSyntheticInputRegistry([]),
        ),
        inspectorRuntime,
      ],
      write: false,
    });

    expect(
      Object.keys(result.metafile.inputs).some((identity) =>
        identity.startsWith(`${PREVIEW_COMPILER_PRIVATE_NAMESPACES.inspectorJsxRuntime}:`),
      ),
    ).toBe(true);
  });

  it('rejects an unknown namespace before its project loader executes', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(entryPath, `import value from 'project:custom'; export default value;`);
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, entryPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    let projectLoaderExecuted = false;
    const projectPlugin: Plugin = {
      name: 'project-custom-loader',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^project:custom$/ }, () => ({
          namespace: 'project-custom',
          path: 'payload',
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'project-custom' }, () => {
          projectLoaderExecuted = true;
          return { contents: 'export default "unsafe";', loader: 'js' };
        });
      },
    };

    await expect(
      build({
        bundle: true,
        entryPoints: [entryPath],
        logLevel: 'silent',
        metafile: true,
        plugins: [
          createPreviewResolutionConfinementPlugin(
            confinement,
            createPreviewOwnedNamespaceRegistry([], []),
            createPreviewSyntheticInputRegistry([]),
          ),
          projectPlugin,
        ],
        write: false,
      }),
    ).rejects.toThrow('unregistered namespace project-custom');
    expect(projectLoaderExecuted).toBe(false);
  });

  it('keeps generated virtual imports confined and rejects unknown metafile identities', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const escapedPath = path.join(directory, 'live-worktree', 'escaped.ts');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(path.dirname(escapedPath), { recursive: true });
    await writeFile(entryPath, `import 'owned:entry';`);
    await writeFile(escapedPath, `export const escaped = true;`);
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, entryPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const owner: Plugin = {
      name: 'owned-loader',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^owned:entry$/ }, () => ({
          namespace: 'owned-virtual',
          path: 'entry',
        }));
        pluginBuild.onLoad({ filter: /^entry$/, namespace: 'owned-virtual' }, () => ({
          contents: `import ${JSON.stringify(escapedPath)};`,
          loader: 'js',
          resolveDir: sourceRoot,
        }));
      },
    };
    const registry = createPreviewOwnedNamespaceRegistry(
      [owner],
      [{ namespace: 'owned-virtual', ownerPluginName: owner.name }],
    );

    await expect(
      build({
        bundle: true,
        entryPoints: [entryPath],
        logLevel: 'silent',
        metafile: true,
        plugins: [
          createPreviewResolutionConfinementPlugin(
            confinement,
            registry,
            createPreviewSyntheticInputRegistry([]),
          ),
          owner,
        ],
        write: false,
      }),
    ).rejects.toThrow('escaped');
    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        registry,
        createPreviewSyntheticInputRegistry([]),
        ['owned-virtual:entry', 'unknown-virtual:payload'],
        sourceRoot,
      );
    }).toThrow('unregistered compiler input namespace');
    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        registry,
        createPreviewSyntheticInputRegistry([]),
        ['owned-virtual:'],
        sourceRoot,
      );
    }).toThrow('empty payload');
  });

  it('registers synthetic metafile identities by exact equality and rejects duplicates', () => {
    const registry = createPreviewSyntheticInputRegistry([
      PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
      PREVIEW_STDIN_ENTRY_NAME,
    ]);

    expect(registry.owns(PREVIEW_IMPORT_META_ENV_DEFINE_INPUT)).toBe(true);
    expect(registry.owns(`${PREVIEW_IMPORT_META_ENV_DEFINE_INPUT}:near-match`)).toBe(false);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.registrations)).toBe(true);
    expect(() =>
      createPreviewSyntheticInputRegistry([
        PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
        PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
      ]),
    ).toThrow('Duplicate synthetic input identity');
    expect(() => createPreviewSyntheticInputRegistry(['define:import.meta.env'])).toThrow(
      'Malformed synthetic input identity',
    );
  });

  it('audits real esbuild define and preview stdin raw keys only when exactly registered', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const targetPath = path.join(sourceRoot, 'App.ts');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(targetPath, 'export default import.meta.env;');
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, targetPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const canonicalSourceRoot = await realpath(sourceRoot);
    const syntheticRegistry = createPreviewSyntheticInputRegistry([
      PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
      PREVIEW_STDIN_ENTRY_NAME,
    ]);

    const result = await build({
      absWorkingDir: canonicalSourceRoot,
      bundle: true,
      define: { 'import.meta.env': '{}' },
      logLevel: 'silent',
      metafile: true,
      plugins: [
        createPreviewResolutionConfinementPlugin(
          confinement,
          createPreviewOwnedNamespaceRegistry([], []),
          syntheticRegistry,
        ),
      ],
      stdin: {
        contents: 'export default import.meta.env;',
        loader: 'js',
        resolveDir: canonicalSourceRoot,
        sourcefile: PREVIEW_STDIN_ENTRY_NAME,
      },
      write: false,
    });
    const rawInputs = Object.keys(result.metafile.inputs).sort();

    expect(rawInputs).toEqual(
      [PREVIEW_IMPORT_META_ENV_DEFINE_INPUT, PREVIEW_STDIN_ENTRY_NAME].sort(),
    );
    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        createPreviewOwnedNamespaceRegistry([], []),
        createPreviewSyntheticInputRegistry([]),
        rawInputs,
        canonicalSourceRoot,
      );
    }).toThrow(PREVIEW_IMPORT_META_ENV_DEFINE_INPUT);
    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        createPreviewOwnedNamespaceRegistry([], []),
        syntheticRegistry,
        [`${PREVIEW_IMPORT_META_ENV_DEFINE_INPUT}:near-match`],
        canonicalSourceRoot,
      );
    }).toThrow('unregistered compiler input namespace');
  });

  it('does not grant onLoad or transitive filesystem exemptions to synthetic identities', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const targetPath = path.join(sourceRoot, 'App.ts');
    const escapedPath = path.join(directory, 'live-worktree', 'escaped.ts');
    const angleFilePath = path.join(sourceRoot, 'component<exact>.ts');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(path.dirname(escapedPath), { recursive: true });
    await writeFile(targetPath, 'export default 1;');
    await writeFile(escapedPath, 'export default "escaped";');
    await writeFile(angleFilePath, 'export default "confined";');
    const confinement = normalizePreviewResolutionConfinement(
      createRequest(sourceRoot, targetPath, dependencyRoot),
    );
    if (confinement === undefined) throw new Error('Expected normalized confinement.');
    const syntheticRegistry = createPreviewSyntheticInputRegistry([
      PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
      PREVIEW_STDIN_ENTRY_NAME,
    ]);
    let syntheticLoaderExecuted = false;
    const syntheticNamespacePlugin: Plugin = {
      name: 'synthetic-namespace-attempt',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^synthetic:attempt$/ }, () => ({
          namespace: PREVIEW_IMPORT_META_ENV_DEFINE_INPUT,
          path: 'payload',
        }));
        pluginBuild.onLoad(
          { filter: /.*/, namespace: PREVIEW_IMPORT_META_ENV_DEFINE_INPUT },
          () => {
            syntheticLoaderExecuted = true;
            return { contents: 'export default "unsafe";', loader: 'js' };
          },
        );
      },
    };
    const syntheticAttemptPath = path.join(sourceRoot, 'synthetic-attempt.ts');
    await writeFile(
      syntheticAttemptPath,
      `import value from 'synthetic:attempt'; export default value;`,
    );

    await expect(
      build({
        bundle: true,
        entryPoints: [syntheticAttemptPath],
        logLevel: 'silent',
        metafile: true,
        plugins: [
          createPreviewResolutionConfinementPlugin(
            confinement,
            createPreviewOwnedNamespaceRegistry([], []),
            syntheticRegistry,
          ),
          syntheticNamespacePlugin,
        ],
        write: false,
      }),
    ).rejects.toThrow(`unregistered namespace ${PREVIEW_IMPORT_META_ENV_DEFINE_INPUT}`);
    expect(syntheticLoaderExecuted).toBe(false);
    await expect(
      build({
        absWorkingDir: sourceRoot,
        bundle: true,
        logLevel: 'silent',
        metafile: true,
        plugins: [
          createPreviewResolutionConfinementPlugin(
            confinement,
            createPreviewOwnedNamespaceRegistry([], []),
            syntheticRegistry,
          ),
        ],
        stdin: {
          contents: `import ${JSON.stringify(escapedPath)};`,
          loader: 'js',
          resolveDir: sourceRoot,
          sourcefile: path.join(sourceRoot, PREVIEW_STDIN_ENTRY_NAME),
        },
        write: false,
      }),
    ).rejects.toThrow('escaped');
    expect(() => {
      assertPreviewBuildInputIdentities(
        confinement,
        createPreviewOwnedNamespaceRegistry([], []),
        syntheticRegistry,
        [path.basename(angleFilePath)],
        sourceRoot,
      );
    }).not.toThrow();
  });
});

/** Creates one valid confined build request for a temporary filesystem fixture. */
function createRequest(
  sourceRoot: string,
  targetPath: string,
  dependencyRoot: string,
): PreviewBuildRequest {
  return {
    dependencySnapshots: [],
    documentPath: targetPath,
    language: 'tsx',
    resolutionConfinement: {
      approvedDependencyRoots: [dependencyRoot],
      dependencyViewDigest: 'a'.repeat(64),
      policyDigest: 'b'.repeat(64),
      sourceManifestDigest: 'c'.repeat(64),
      sourceRoot,
    },
    sourceText: 'export default function App() {}',
    workspaceRoot: sourceRoot,
  };
}

/** Allocates one test-owned temporary directory and registers automatic cleanup. */
async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'preview-confinement-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** Creates one installed esbuild plugin that intentionally registers no hooks. */
function emptyPlugin(name: string): Plugin {
  return {
    name,
    setup() {
      return undefined;
    },
  };
}

/** Creates one exact ancestor plan used by confinement-aware inspector plugin tests. */
function createCorridorPlan(entryPath: string): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: entryPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: 'candidate-selected-path',
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'entry-render' as const,
        label: 'entry',
        occurrenceStart: 0,
        sourcePath: entryPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [entryPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const pageCandidate = {
    complete: true,
    dependencyPaths: [entryPath],
    edges: [],
    id: 'candidate-selected',
    renderPath,
    root: target,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    stopReason: 'root-reached' as const,
    targetAutomaticProps: {},
  };
  return {
    ...pageCandidate,
    pageCandidates: [pageCandidate],
    renderChain,
    renderChainsByExport: { default: renderChain },
    target,
  };
}
