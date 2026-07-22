/** Verifies versioned, byte-bound React seeds without reading or mutating project installations. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  doesPreviewBundledRuntimeMatchStaging,
  inspectPreviewBundledReactRuntimes,
  selectPreviewBundledReactRuntime,
} from '../../../src/adapters/node/previewBundledReactRuntime';
import { readPreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('preview bundled React runtime catalog', () => {
  /** Chooses the authored React major and maps npm alias directories back to real package names. */
  it('selects the React 18 tuple for an unlocked shorthand caret manifest', async () => {
    const fixture = await createCatalogFixture();
    const projectRoot = await writeProject(fixture.rootPath, { react: '^18', 'react-dom': '^18' });
    const profile = await readPreviewDependencyProfile(projectRoot, projectRoot);
    const runtimes = await inspectPreviewBundledReactRuntimes(fixture.nodeModulesPath);
    const selected = await selectPreviewBundledReactRuntime(runtimes, profile, projectRoot);

    expect(runtimes).toHaveLength(2);
    expect(selected?.reactVersion).toBe('18.3.1');
    expect(selected?.reactDomVersion).toBe('18.3.1');
    expect(selected?.copies.map(({ targetRelativePath }) => targetRelativePath)).toEqual([
      'react',
      'react-dom',
      'scheduler',
    ]);
  });

  /** Reads the shipped dist catalog when development-only npm aliases are absent from a VSIX. */
  it('selects the packaged React 18 tuple outside extension node_modules', async () => {
    const fixture = await createCatalogFixture();
    await Promise.all(
      ['react-preview-react-18', 'react-preview-react-dom-18', 'react-preview-scheduler-18'].map(
        async (directoryName) =>
          rm(path.join(fixture.nodeModulesPath, directoryName), { force: true, recursive: true }),
      ),
    );
    const packagedNodeModules = path.join(
      fixture.rootPath,
      'extension',
      'dist',
      'runtime',
      'react18',
      'node_modules',
    );
    await Promise.all([
      writePackage(packagedNodeModules, 'react', 'react', '18.3.1', 'exports.major = 18;\n'),
      writePackage(
        packagedNodeModules,
        'react-dom',
        'react-dom',
        '18.3.1',
        'exports.major = 18;\n',
      ),
      writePackage(
        packagedNodeModules,
        'scheduler',
        'scheduler',
        '0.23.2',
        'exports.major = 18;\n',
      ),
    ]);
    const projectRoot = await writeProject(fixture.rootPath, { react: '^18', 'react-dom': '^18' });
    const selected = await selectPreviewBundledReactRuntime(
      await inspectPreviewBundledReactRuntimes(fixture.nodeModulesPath),
      await readPreviewDependencyProfile(projectRoot, projectRoot),
      projectRoot,
    );

    expect(selected?.reactVersion).toBe('18.3.1');
    expect(selected?.copies.every(({ sourceRoot }) => sourceRoot.includes('dist/runtime'))).toBe(
      true,
    );
  });

  /** Changes seed identity when extension-owned bytes change without a package version change. */
  it('binds catalog identity to verified package contents', async () => {
    const fixture = await createCatalogFixture();
    const first = (await inspectPreviewBundledReactRuntimes(fixture.nodeModulesPath)).find(
      ({ reactVersion }) => reactVersion === '18.3.1',
    );
    await writeFile(
      path.join(fixture.nodeModulesPath, 'react-preview-react-18', 'index.js'),
      'exports.marker = "changed bytes";\n',
      'utf8',
    );
    const second = (await inspectPreviewBundledReactRuntimes(fixture.nodeModulesPath)).find(
      ({ reactVersion }) => reactVersion === '18.3.1',
    );

    expect(first?.identity).toBeDefined();
    expect(second?.identity).toBeDefined();
    expect(second?.identity).not.toBe(first?.identity);
    expect(
      first === undefined || second === undefined
        ? true
        : doesPreviewBundledRuntimeMatchStaging(first, second.expectedPackages),
    ).toBe(false);
  });

  /** Refuses a seed beside even one locally resolved React half to avoid duplicate hook runtimes. */
  it('preserves a project-local partial React installation', async () => {
    const fixture = await createCatalogFixture();
    const projectRoot = await writeProject(fixture.rootPath, { react: '^18', 'react-dom': '^18' });
    await writePackage(
      path.join(projectRoot, 'node_modules'),
      'react',
      'react',
      '18.3.1',
      'exports.marker = "project local";\n',
    );
    const profile = await readPreviewDependencyProfile(projectRoot, projectRoot);
    const selected = await selectPreviewBundledReactRuntime(
      await inspectPreviewBundledReactRuntimes(fixture.nodeModulesPath),
      profile,
      projectRoot,
    );

    expect(selected).toBeUndefined();
  });
});

/** Extension-owned node_modules and temporary workspace roots used by one catalog test. */
interface CatalogFixture {
  readonly nodeModulesPath: string;
  readonly rootPath: string;
}

/** Creates complete React 19 and aliased React 18 catalog rows from inert package files. */
async function createCatalogFixture(): Promise<CatalogFixture> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-runtime-catalog-'));
  temporaryRoots.push(rootPath);
  const nodeModulesPath = path.join(rootPath, 'extension', 'node_modules');
  await Promise.all([
    writePackage(nodeModulesPath, 'react', 'react', '19.2.7', 'exports.major = 19;\n'),
    writePackage(nodeModulesPath, 'react-dom', 'react-dom', '19.2.7', 'exports.major = 19;\n'),
    writePackage(nodeModulesPath, 'scheduler', 'scheduler', '0.27.0', 'exports.major = 19;\n'),
    writePackage(
      nodeModulesPath,
      'react-preview-react-18',
      'react',
      '18.3.1',
      'exports.major = 18;\n',
    ),
    writePackage(
      nodeModulesPath,
      'react-preview-react-dom-18',
      'react-dom',
      '18.3.1',
      'exports.major = 18;\n',
    ),
    writePackage(
      nodeModulesPath,
      'react-preview-scheduler-18',
      'scheduler',
      '0.23.2',
      'exports.major = 18;\n',
    ),
  ]);
  return Object.freeze({ nodeModulesPath, rootPath });
}

/** Writes one lockless package root whose dependencies describe the required React tuple. */
async function writeProject(
  rootPath: string,
  dependencies: Readonly<Record<string, string>>,
): Promise<string> {
  const projectRoot = path.join(rootPath, `project-${Math.random().toString(16).slice(2)}`);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ dependencies, name: 'fixture-project', private: true, version: '1.0.0' }),
    'utf8',
  );
  return projectRoot;
}

/** Writes an inert ordinary package directory under an authored or aliased source name. */
async function writePackage(
  nodeModulesPath: string,
  directoryName: string,
  packageName: string,
  version: string,
  sourceText: string,
): Promise<void> {
  const packageRoot = path.join(nodeModulesPath, directoryName);
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(packageRoot, 'index.js'), sourceText, 'utf8'),
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ main: 'index.js', name: packageName, version }),
      'utf8',
    ),
  ]);
}
