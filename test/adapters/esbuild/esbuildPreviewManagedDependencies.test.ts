/** Verifies compiler-level dependency learning and reuse through persistent global storage. */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const temporaryRoots: string[] = [];
/** Path-independent bounded lock evidence shared by the two equivalent compiler fixtures. */
const SHARED_PACKAGE_LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    'node_modules/learned-package': { version: '1.0.0' },
    'node_modules/react': { version: '19.2.7' },
    'node_modules/react-dom': { version: '19.2.7' },
  },
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('EsbuildPreviewCompiler managed dependencies', () => {
  /** Reuses a reached third-party package and bundled React in a clone with no node_modules. */
  it('compiles the same dependency profile in another project without installing it there', async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-compiler-store-')),
    );
    temporaryRoots.push(fixtureRoot);
    const storeRoot = path.join(fixtureRoot, 'global-storage', 'dependency-store', 'v1');
    const firstProject = await writeProject(fixtureRoot, 'first-project', true);
    const firstTargetPath = path.join(firstProject, 'Target.tsx');
    const firstCompiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      managedDependencyStoreRoot: storeRoot,
    });

    const firstBundle = await firstCompiler.compile({
      dependencySnapshots: [],
      documentPath: firstTargetPath,
      language: 'tsx',
      preparationMode: 'fast',
      sourceText: await readTargetSource(firstTargetPath),
      useStorybookPreview: false,
      workspaceRoot: firstProject,
    });
    expect(new TextDecoder().decode(firstBundle.javascript)).toContain('learned-package-value');
    await firstCompiler.shutdown();

    const secondProject = await writeProject(fixtureRoot, 'second-project', false);
    const secondTargetPath = path.join(secondProject, 'Target.tsx');
    const secondCompiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      managedDependencyStoreRoot: storeRoot,
    });
    const secondBundle = await secondCompiler.compile({
      dependencySnapshots: [],
      documentPath: secondTargetPath,
      language: 'tsx',
      preparationMode: 'fast',
      sourceText: await readTargetSource(secondTargetPath),
      useStorybookPreview: false,
      workspaceRoot: secondProject,
    });

    expect(new TextDecoder().decode(secondBundle.javascript)).toContain('learned-package-value');
    expect(secondBundle.dependencies.every((dependency) => !dependency.includes(storeRoot))).toBe(
      true,
    );
    await secondCompiler.shutdown();
  });
});

/** Writes two manifest-equivalent projects and optionally installs one learnable package. */
async function writeProject(
  fixtureRoot: string,
  projectName: string,
  includeInstalledPackage: boolean,
): Promise<string> {
  const projectRoot = path.join(fixtureRoot, projectName);
  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          'learned-package': '1.0.0',
          react: '19.2.7',
          'react-dom': '19.2.7',
        },
        name: projectName,
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(path.join(projectRoot, 'package-lock.json'), SHARED_PACKAGE_LOCK, 'utf8'),
  ]);
  const targetSource =
    'import { marker } from "learned-package"; export default function Target() { return <div>{marker}</div>; }';
  await writeFile(path.join(projectRoot, 'Target.tsx'), targetSource, 'utf8');
  if (includeInstalledPackage) {
    const packageRoot = path.join(projectRoot, 'node_modules', 'learned-package');
    await mkdir(packageRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({
          main: 'index.js',
          name: 'learned-package',
          version: '1.0.0',
        }),
        'utf8',
      ),
      writeFile(
        path.join(packageRoot, 'index.js'),
        'export const marker = "learned-package-value";',
        'utf8',
      ),
    ]);
  }
  return projectRoot;
}

/** Reads the saved target exactly as an editor snapshot would provide it. */
async function readTargetSource(targetPath: string): Promise<string> {
  return import('node:fs/promises').then(async ({ readFile }) => readFile(targetPath, 'utf8'));
}
