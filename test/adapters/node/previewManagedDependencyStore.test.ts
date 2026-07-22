/** Verifies persistent cross-workspace reuse, local precedence, bundled seeds and peer singletons. */
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewManagedDependencyPeerPlugin } from '../../../src/adapters/esbuild/previewManagedDependencyPeerPlugin';
import { PreviewManagedDependencyStore } from '../../../src/adapters/node/previewManagedDependencyStore';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('PreviewManagedDependencyStore', () => {
  /** Learns reached package bytes once and resolves them from another workspace with no install. */
  it('reuses an exact dependency profile without writing node_modules into the second project', async () => {
    const fixture = await createFixture();
    const firstWorkspace = await createProject(fixture.rootPath, 'workspace-a', {
      'shared-package': '1.0.0',
    });
    const localPackagePath = await writePackage(
      path.join(firstWorkspace, 'node_modules'),
      'shared-package',
      '1.0.0',
      'export const marker = "managed-copy";',
    );
    const firstStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const firstEnvironment = await firstStore.prepare(firstWorkspace);
    firstStore.scheduleAdmission({
      dependencyPaths: [path.join(localPackagePath, 'index.js')],
      profile: firstEnvironment.profile,
      workspaceRoot: firstWorkspace,
    });
    await firstStore.shutdown();

    const secondWorkspace = await createProject(fixture.rootPath, 'workspace-b', {
      'shared-package': '1.0.0',
    });
    const secondStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const secondEnvironment = await secondStore.prepare(secondWorkspace);
    const managedOutput = await bundleMarker(secondWorkspace, secondEnvironment.nodeModulesPaths);

    expect(secondEnvironment.nodeModulesPaths).toHaveLength(1);
    expect(managedOutput).toContain('managed-copy');
    await expectPathToBeMissing(path.join(secondWorkspace, 'node_modules'));

    await writePackage(
      path.join(secondWorkspace, 'node_modules'),
      'shared-package',
      '1.0.0',
      'export const marker = "project-local";',
    );
    const localOutput = await bundleMarker(secondWorkspace, secondEnvironment.nodeModulesPaths);
    expect(localOutput).toContain('project-local');
    expect(localOutput).not.toContain('managed-copy');
    await secondStore.shutdown();
  });

  /** Combines independently reached packages as immutable layers under one exact lock profile. */
  it('adds later package layers without hiding packages learned by an earlier target', async () => {
    const fixture = await createFixture();
    const dependencies = { 'package-a': '1.0.0', 'package-b': '1.0.0' };
    const firstWorkspace = await createProject(fixture.rootPath, 'layer-workspace-a', dependencies);
    const packageA = await writePackage(
      path.join(firstWorkspace, 'node_modules'),
      'package-a',
      '1.0.0',
      'export const markerA = "layer-a";',
    );
    const firstStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const firstEnvironment = await firstStore.prepare(firstWorkspace);
    firstStore.scheduleAdmission({
      dependencyPaths: [path.join(packageA, 'index.js')],
      profile: firstEnvironment.profile,
      workspaceRoot: firstWorkspace,
    });
    await firstStore.shutdown();

    const secondWorkspace = await createProject(
      fixture.rootPath,
      'layer-workspace-b',
      dependencies,
    );
    const packageB = await writePackage(
      path.join(secondWorkspace, 'node_modules'),
      'package-b',
      '1.0.0',
      'export const markerB = "layer-b";',
    );
    const secondStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const secondEnvironment = await secondStore.prepare(secondWorkspace);
    secondStore.scheduleAdmission({
      dependencyPaths: [path.join(packageB, 'index.js')],
      profile: secondEnvironment.profile,
      workspaceRoot: secondWorkspace,
    });
    await secondStore.shutdown();

    const emptyWorkspace = await createProject(
      fixture.rootPath,
      'layer-workspace-empty',
      dependencies,
    );
    const thirdStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const combinedEnvironment = await thirdStore.prepare(emptyWorkspace);
    const output = await bundleLayerMarkers(emptyWorkspace, combinedEnvironment.nodeModulesPaths);

    expect(combinedEnvironment.nodeModulesPaths).toHaveLength(2);
    expect(output).toContain('layer-a');
    expect(output).toContain('layer-b');
    await expectPathToBeMissing(path.join(emptyWorkspace, 'node_modules'));
    await thirdStore.shutdown();
  });

  /** Refuses to share ordinary package bytes when no bounded lock proves the resolved graph. */
  it('does not admit a package profile without reusable lock evidence', async () => {
    const fixture = await createFixture();
    const firstWorkspace = await createProject(
      fixture.rootPath,
      'unlocked-workspace-a',
      { 'shared-package': '1.0.0' },
      false,
    );
    const localPackage = await writePackage(
      path.join(firstWorkspace, 'node_modules'),
      'shared-package',
      '1.0.0',
      'export const marker = "must-stay-local";',
    );
    const firstStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const firstEnvironment = await firstStore.prepare(firstWorkspace);
    firstStore.scheduleAdmission({
      dependencyPaths: [path.join(localPackage, 'index.js')],
      profile: firstEnvironment.profile,
      workspaceRoot: firstWorkspace,
    });
    await firstStore.shutdown();

    const secondWorkspace = await createProject(
      fixture.rootPath,
      'unlocked-workspace-b',
      { 'shared-package': '1.0.0' },
      false,
    );
    const secondStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const secondEnvironment = await secondStore.prepare(secondWorkspace);

    expect(firstEnvironment.profile?.hasReusableLockEvidence).toBe(false);
    expect(secondEnvironment.nodeModulesPaths).toEqual([]);
    await secondStore.shutdown();
  });

  /** Rejects stale installed bytes whose exact version does not satisfy the direct manifest. */
  it('does not admit an installed package with a mismatched declared version', async () => {
    const fixture = await createFixture();
    const dependencies = { 'shared-package': '2.0.0' };
    const firstWorkspace = await createProject(
      fixture.rootPath,
      'version-mismatch-workspace-a',
      dependencies,
    );
    const stalePackage = await writePackage(
      path.join(firstWorkspace, 'node_modules'),
      'shared-package',
      '1.0.0',
      'export const marker = "stale-version";',
    );
    const firstStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const firstEnvironment = await firstStore.prepare(firstWorkspace);
    firstStore.scheduleAdmission({
      dependencyPaths: [path.join(stalePackage, 'index.js')],
      profile: firstEnvironment.profile,
      workspaceRoot: firstWorkspace,
    });
    await firstStore.shutdown();

    const secondWorkspace = await createProject(
      fixture.rootPath,
      'version-mismatch-workspace-b',
      dependencies,
    );
    const secondStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const secondEnvironment = await secondStore.prepare(secondWorkspace);

    expect(firstEnvironment.profile?.hasReusableLockEvidence).toBe(true);
    expect(secondEnvironment.nodeModulesPaths).toEqual([]);
    await secondStore.shutdown();
  });

  /** Revalidates persisted package bytes after restart and hides deleted or modified layers. */
  it.each([
    {
      label: 'deleted',
      mutate: async (sourcePath: string): Promise<void> => unlink(sourcePath),
    },
    {
      label: 'modified',
      mutate: async (sourcePath: string): Promise<void> =>
        writeFile(sourcePath, 'export const marker = "tampered";', 'utf8'),
    },
  ])('does not expose a committed layer whose package file was $label', async ({ mutate }) => {
    const fixture = await createFixture();
    const dependencies = { 'shared-package': '1.0.0' };
    const firstWorkspace = await createProject(
      fixture.rootPath,
      'integrity-workspace-a',
      dependencies,
    );
    const localPackage = await writePackage(
      path.join(firstWorkspace, 'node_modules'),
      'shared-package',
      '1.0.0',
      'export const marker = "verified";',
    );
    const writerStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const writerEnvironment = await writerStore.prepare(firstWorkspace);
    writerStore.scheduleAdmission({
      dependencyPaths: [path.join(localPackage, 'index.js')],
      profile: writerEnvironment.profile,
      workspaceRoot: firstWorkspace,
    });
    await writerStore.shutdown();

    const emptyWorkspace = await createProject(
      fixture.rootPath,
      'integrity-workspace-empty',
      dependencies,
    );
    const locatingStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const committedEnvironment = await locatingStore.prepare(emptyWorkspace);
    const committedNodeModulesPath = committedEnvironment.nodeModulesPaths[0];
    expect(committedNodeModulesPath).toBeDefined();
    if (committedNodeModulesPath === undefined) {
      throw new Error('The valid committed layer was not available for integrity mutation.');
    }
    await mutate(path.join(committedNodeModulesPath, 'shared-package', 'index.js'));
    await locatingStore.shutdown();

    const validatingStore = new PreviewManagedDependencyStore({ rootPath: fixture.storeRoot });
    const validatedEnvironment = await validatingStore.prepare(emptyWorkspace);

    expect(validatedEnvironment.nodeModulesPaths).toEqual([]);
    await validatingStore.shutdown();
  });

  /** Supplies packaged React only for manifestless or provably compatible project ranges. */
  it('materializes a version-compatible bundled React seed', async () => {
    const fixture = await createFixture();
    const bundledNodeModules = path.join(fixture.rootPath, 'extension', 'node_modules');
    await writePackage(bundledNodeModules, 'react', '19.2.7', 'exports.version = "19.2.7";');
    await writePackage(bundledNodeModules, 'react-dom', '19.2.7', 'exports.version = "19.2.7";');
    await writePackage(
      bundledNodeModules,
      'scheduler',
      '0.27.0',
      'exports.unstable_now = Date.now;',
    );
    const compatibleProject = await createProject(fixture.rootPath, 'compatible', {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    });
    const incompatibleProject = await createProject(fixture.rootPath, 'incompatible', {
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    });
    const store = new PreviewManagedDependencyStore({
      bundledNodeModulesPath: bundledNodeModules,
      rootPath: fixture.storeRoot,
    });

    const compatible = await store.prepare(compatibleProject);
    const incompatible = await store.prepare(incompatibleProject);

    expect(compatible.nodeModulesPaths).toHaveLength(1);
    expect(incompatible.nodeModulesPaths).toHaveLength(0);
    await store.shutdown();
  });

  /** Keeps a detected project React major intact instead of pairing it with bundled ReactDOM 19. */
  it('does not activate the bundled runtime beside an undeclared local React 18', async () => {
    const fixture = await createFixture();
    const bundledNodeModules = path.join(fixture.rootPath, 'extension', 'node_modules');
    await writePackage(bundledNodeModules, 'react', '19.2.7', 'exports.version = "19.2.7";');
    await writePackage(bundledNodeModules, 'react-dom', '19.2.7', 'exports.version = "19.2.7";');
    await writePackage(
      bundledNodeModules,
      'scheduler',
      '0.27.0',
      'exports.unstable_now = Date.now;',
    );
    const projectRoot = await createProject(fixture.rootPath, 'local-react-18', {});
    await writePackage(
      path.join(projectRoot, 'node_modules'),
      'react',
      '18.3.1',
      'exports.version = "18.3.1";',
    );
    const store = new PreviewManagedDependencyStore({
      bundledNodeModulesPath: bundledNodeModules,
      rootPath: fixture.storeRoot,
    });

    const environment = await store.prepare(projectRoot);

    expect(environment.nodeModulesPaths).toEqual([]);
    await store.shutdown();
  });

  /** Gives a verified lock-backed React tuple precedence over the extension's compatible seed. */
  it('exposes exactly one React runtime when a managed layer already provides it', async () => {
    const fixture = await createFixture();
    const bundledNodeModules = path.join(fixture.rootPath, 'extension', 'node_modules');
    await Promise.all([
      writePackage(bundledNodeModules, 'react', '19.2.7', 'exports.origin = "bundled";'),
      writePackage(bundledNodeModules, 'react-dom', '19.2.7', 'exports.origin = "bundled";'),
      writePackage(bundledNodeModules, 'scheduler', '0.27.0', 'exports.origin = "bundled";'),
    ]);
    const dependencies = { react: '^19.0.0', 'react-dom': '^19.0.0' };
    const installedProject = await createProject(
      fixture.rootPath,
      'installed-react-project',
      dependencies,
    );
    const installedNodeModules = path.join(installedProject, 'node_modules');
    const reachedPackages = await Promise.all([
      writePackage(installedNodeModules, 'react', '19.2.7', 'exports.origin = "managed";'),
      writePackage(installedNodeModules, 'react-dom', '19.2.7', 'exports.origin = "managed";'),
      writePackage(installedNodeModules, 'scheduler', '0.27.0', 'exports.origin = "managed";'),
    ]);
    const admittingStore = new PreviewManagedDependencyStore({
      bundledNodeModulesPath: bundledNodeModules,
      rootPath: fixture.storeRoot,
    });
    const installedEnvironment = await admittingStore.prepare(installedProject);
    admittingStore.scheduleAdmission({
      dependencyPaths: reachedPackages.map((packageRoot) => path.join(packageRoot, 'index.js')),
      profile: installedEnvironment.profile,
      workspaceRoot: installedProject,
    });
    await admittingStore.shutdown();

    const emptyProject = await createProject(fixture.rootPath, 'empty-react-project', dependencies);
    const selectingStore = new PreviewManagedDependencyStore({
      bundledNodeModulesPath: bundledNodeModules,
      rootPath: fixture.storeRoot,
    });
    const selectedEnvironment = await selectingStore.prepare(emptyProject);

    expect(selectedEnvironment.nodeModulesPaths).toHaveLength(1);
    expect(selectedEnvironment.nodeModulesPaths[0]).toContain(`${path.sep}environments${path.sep}`);
    expect(selectedEnvironment.nodeModulesPaths[0]).not.toContain(`${path.sep}seeds${path.sep}`);
    await selectingStore.shutdown();
  });
});

describe('managed dependency peer resolution', () => {
  /** Re-issues cached peer imports from the project so React is bundled exactly once. */
  it('keeps project-local React as the singleton for a managed peer consumer', async () => {
    const fixture = await createFixture();
    const workspaceRoot = await createProject(fixture.rootPath, 'peer-project', {
      react: '1.0.0',
      'peer-widget': '1.0.0',
    });
    const managedNodeModules = path.join(fixture.rootPath, 'managed', 'node_modules');
    const localReact = await writePackage(
      path.join(workspaceRoot, 'node_modules'),
      'react',
      '1.0.0',
      'module.exports = { origin: "local-react" };',
    );
    const managedReact = await writePackage(
      managedNodeModules,
      'react',
      '1.0.0',
      'module.exports = { origin: "managed-react" };',
    );
    await writePackage(
      managedNodeModules,
      'peer-widget',
      '1.0.0',
      'module.exports = require("react");',
      { react: '1.0.0' },
    );

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      nodePaths: [managedNodeModules],
      plugins: [
        createPreviewManagedDependencyPeerPlugin({
          managedNodeModulesPaths: [managedNodeModules],
          projectRoot: workspaceRoot,
        }),
      ],
      stdin: {
        contents:
          'import React from "react"; import widget from "peer-widget"; export default React === widget;',
        loader: 'js',
        resolveDir: workspaceRoot,
      },
      write: false,
    });
    const inputPaths = Object.keys(result.metafile.inputs).map((inputPath) =>
      path.resolve(workspaceRoot, inputPath),
    );

    expect(inputPaths).toContain(path.join(localReact, 'index.js'));
    expect(inputPaths).not.toContain(path.join(managedReact, 'index.js'));
  });

  /** Redirects React's automatic-JSX subpath through the same project-owned peer singleton. */
  it('keeps project-local react/jsx-runtime as the singleton for a managed peer consumer', async () => {
    const fixture = await createFixture();
    const workspaceRoot = await createProject(fixture.rootPath, 'peer-jsx-project', {
      react: '1.0.0',
      'peer-widget': '1.0.0',
    });
    const managedNodeModules = path.join(fixture.rootPath, 'managed-jsx', 'node_modules');
    const localReact = await writePackage(
      path.join(workspaceRoot, 'node_modules'),
      'react',
      '1.0.0',
      'module.exports = { origin: "local-react" };',
    );
    const managedReact = await writePackage(
      managedNodeModules,
      'react',
      '1.0.0',
      'module.exports = { origin: "managed-react" };',
    );
    await Promise.all([
      writeFile(
        path.join(localReact, 'jsx-runtime.js'),
        'module.exports = { origin: "local-jsx-runtime" };',
        'utf8',
      ),
      writeFile(
        path.join(managedReact, 'jsx-runtime.js'),
        'module.exports = { origin: "managed-jsx-runtime" };',
        'utf8',
      ),
    ]);
    await writePackage(
      managedNodeModules,
      'peer-widget',
      '1.0.0',
      'module.exports = require("react/jsx-runtime");',
      { react: '1.0.0' },
    );

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      nodePaths: [managedNodeModules],
      plugins: [
        createPreviewManagedDependencyPeerPlugin({
          managedNodeModulesPaths: [managedNodeModules],
          projectRoot: workspaceRoot,
        }),
      ],
      stdin: {
        contents:
          'import runtime from "react/jsx-runtime"; import widget from "peer-widget"; export default runtime === widget;',
        loader: 'js',
        resolveDir: workspaceRoot,
      },
      write: false,
    });
    const inputPaths = Object.keys(result.metafile.inputs).map((inputPath) =>
      path.resolve(workspaceRoot, inputPath),
    );
    const output = result.outputFiles[0]?.text ?? '';

    expect(inputPaths).toContain(path.join(localReact, 'jsx-runtime.js'));
    expect(inputPaths).not.toContain(path.join(managedReact, 'jsx-runtime.js'));
    expect(output).toContain('local-jsx-runtime');
    expect(output).not.toContain('managed-jsx-runtime');
  });
});

/** Creates isolated persistent storage and project parent directories. */
async function createFixture(): Promise<{ readonly rootPath: string; readonly storeRoot: string }> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-managed-deps-'));
  temporaryRoots.push(rootPath);
  return { rootPath, storeRoot: path.join(rootPath, 'global-storage', 'dependency-store', 'v1') };
}

/** Writes one project whose dependency maps form the reusable profile identity. */
async function createProject(
  parentRoot: string,
  name: string,
  dependencies: Readonly<Record<string, string>>,
  includeLockfile = true,
): Promise<string> {
  const projectRoot = path.join(parentRoot, name);
  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ dependencies, name, version: '1.0.0' }),
      'utf8',
    ),
    ...(includeLockfile
      ? [
          writeFile(
            path.join(projectRoot, 'package-lock.json'),
            createBoundedLockfile(dependencies),
            'utf8',
          ),
        ]
      : []),
  ]);
  return projectRoot;
}

/** Creates path-independent bounded lock evidence shared by manifest-equivalent workspaces. */
function createBoundedLockfile(dependencies: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries(dependencies)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([packageName, version]) => [
          `node_modules/${packageName}`,
          { version: version.replace(/^[=~^]/u, '') },
        ]),
    ),
  });
}

/** Writes a tiny ordinary package with optional peer metadata. */
async function writePackage(
  nodeModulesRoot: string,
  packageName: string,
  version: string,
  sourceText: string,
  peerDependencies?: Readonly<Record<string, string>>,
): Promise<string> {
  const packageRoot = path.join(nodeModulesRoot, ...packageName.split('/'));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      main: 'index.js',
      name: packageName,
      ...(peerDependencies === undefined ? {} : { peerDependencies }),
      version,
    }),
    'utf8',
  );
  await writeFile(path.join(packageRoot, 'index.js'), sourceText, 'utf8');
  return packageRoot;
}

/** Bundles one package marker using normal local-first esbuild node-path precedence. */
async function bundleMarker(
  workspaceRoot: string,
  nodeModulesPaths: readonly string[],
): Promise<string> {
  const result = await build({
    absWorkingDir: workspaceRoot,
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    nodePaths: [...nodeModulesPaths],
    stdin: {
      contents: 'export { marker } from "shared-package";',
      loader: 'js',
      resolveDir: workspaceRoot,
    },
    write: false,
  });
  return result.outputFiles[0]?.text ?? '';
}

/** Bundles marker exports from two independently admitted package layers. */
async function bundleLayerMarkers(
  workspaceRoot: string,
  nodeModulesPaths: readonly string[],
): Promise<string> {
  const result = await build({
    absWorkingDir: workspaceRoot,
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    nodePaths: [...nodeModulesPaths],
    stdin: {
      contents: 'export { markerA } from "package-a"; export { markerB } from "package-b";',
      loader: 'js',
      resolveDir: workspaceRoot,
    },
    write: false,
  });
  return result.outputFiles[0]?.text ?? '';
}

/** Asserts that the preview did not create dependency files inside the consumer project. */
async function expectPathToBeMissing(candidatePath: string): Promise<void> {
  await expect(
    import('node:fs/promises').then(async ({ access }) => access(candidatePath)),
  ).rejects.toThrow();
}
