/** Verifies compiler-level dependency learning and reuse through persistent global storage. */
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import {
  verifyPreviewManagedPackages,
  verifyPreviewManagedPackageTree,
  type PreviewManagedPackageCopyResult,
} from '../../../src/adapters/node/previewManagedDependencyAdmission';

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
  /** Restores one declared package into extension storage, then retries the complete build once. */
  it('acquires an exact declared missing package without creating workspace node_modules', async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-compiler-acquire-')),
    );
    temporaryRoots.push(fixtureRoot);
    const projectRoot = await writeProject(fixtureRoot, 'cold-project', false);
    const targetPath = path.join(projectRoot, 'Target.tsx');
    const manifestPath = path.join(projectRoot, 'package.json');
    const lockfilePath = path.join(projectRoot, 'package-lock.json');
    const [manifestBefore, lockfileBefore] = await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(lockfilePath, 'utf8'),
    ]);
    const acquisitions: string[][] = [];
    const reportedStages: string[] = [];
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      managedDependencyStoreRoot: path.join(
        fixtureRoot,
        'global-storage',
        'dependency-store',
        'v1',
      ),
      lockedDependencyAcquirer: async ({ requiredPackageNames, targetNodeModulesPath }) => {
        acquisitions.push([...(requiredPackageNames ?? [])]);
        return writeVerifiedManagedPackage(
          targetNodeModulesPath,
          'learned-package',
          '1.0.0',
          'export const marker = "acquired-package-value";',
        );
      },
    });

    try {
      const bundle = await compiler.compile(
        {
          dependencySnapshots: [],
          documentPath: targetPath,
          language: 'tsx',
          preparationMode: 'fast',
          sourceText: await readTargetSource(targetPath),
          useStorybookPreview: false,
          workspaceRoot: projectRoot,
        },
        { reportProgress: (stage) => reportedStages.push(stage) },
      );

      expect(new TextDecoder().decode(bundle.javascript)).toContain('acquired-package-value');
      expect(acquisitions).toEqual([['learned-package']]);
      expect(reportedStages.filter((stage) => stage === 'acquiring-dependencies')).toHaveLength(1);
      await expectPathToBeMissing(path.join(projectRoot, 'node_modules'));
      await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBefore);
      await expect(readFile(lockfilePath, 'utf8')).resolves.toBe(lockfileBefore);
    } finally {
      await compiler.shutdown();
    }
  }, 15_000);

  /** Prevents a newly exposed unresolved package from turning acquisition into an unbounded loop. */
  it('does not acquire or retry again when the single retry exposes another missing package', async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-compiler-single-retry-')),
    );
    temporaryRoots.push(fixtureRoot);
    const projectRoot = await writeProject(fixtureRoot, 'single-retry-project', false, {
      'second-declared-package': '1.0.0',
    });
    const targetPath = path.join(projectRoot, 'Target.tsx');
    let acquisitionCount = 0;
    const reportedStages: string[] = [];
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      managedDependencyStoreRoot: path.join(
        fixtureRoot,
        'global-storage',
        'dependency-store',
        'v1',
      ),
      lockedDependencyAcquirer: async ({ targetNodeModulesPath }) => {
        acquisitionCount += 1;
        return writeVerifiedManagedPackage(
          targetNodeModulesPath,
          'learned-package',
          '1.0.0',
          'import { missing } from "second-declared-package"; export const marker = missing;',
        );
      },
    });

    try {
      await expect(
        compiler.compile(
          {
            dependencySnapshots: [],
            documentPath: targetPath,
            language: 'tsx',
            preparationMode: 'fast',
            sourceText: await readTargetSource(targetPath),
            useStorybookPreview: false,
            workspaceRoot: projectRoot,
          },
          { reportProgress: (stage) => reportedStages.push(stage) },
        ),
      ).rejects.toThrow(/second-declared-package/u);
      expect(acquisitionCount).toBe(1);
      expect(reportedStages.filter((stage) => stage === 'acquiring-dependencies')).toHaveLength(1);
      await expectPathToBeMissing(path.join(projectRoot, 'node_modules'));
    } finally {
      await compiler.shutdown();
    }
  });

  /** Remembers a published requirement whose package cannot satisfy the requested subpath. */
  it('does not reacquire the same unchanged requirement on later preview revisions', async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-compiler-repeat-')),
    );
    temporaryRoots.push(fixtureRoot);
    const projectRoot = await writeProject(fixtureRoot, 'repeat-project', false);
    const targetPath = path.join(projectRoot, 'Target.tsx');
    await writeFile(
      targetPath,
      'import value from "learned-package/missing"; export default function Target() { return <div>{value}</div>; }',
      'utf8',
    );
    let acquisitionCount = 0;
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      managedDependencyStoreRoot: path.join(
        fixtureRoot,
        'global-storage',
        'dependency-store',
        'v1',
      ),
      lockedDependencyAcquirer: async ({ targetNodeModulesPath }) => {
        acquisitionCount += 1;
        return writeVerifiedManagedPackage(
          targetNodeModulesPath,
          'learned-package',
          '1.0.0',
          'export default "root-only";',
        );
      },
    });
    const request = {
      dependencySnapshots: [],
      documentPath: targetPath,
      language: 'tsx' as const,
      preparationMode: 'fast' as const,
      sourceText: await readTargetSource(targetPath),
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    };

    try {
      await expect(compiler.compile(request)).rejects.toThrow(/learned-package\/missing/u);
      await expect(compiler.compile(request)).rejects.toThrow(/learned-package\/missing/u);
      expect(acquisitionCount).toBe(1);
      await expectPathToBeMissing(path.join(projectRoot, 'node_modules'));
    } finally {
      await compiler.shutdown();
    }
  });

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
  additionalDependencies: Readonly<Record<string, string>> = {},
): Promise<string> {
  const projectRoot = path.join(fixtureRoot, projectName);
  const dependencies = {
    'learned-package': '1.0.0',
    react: '19.2.7',
    'react-dom': '19.2.7',
    ...additionalDependencies,
  };
  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies,
        name: projectName,
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(
      path.join(projectRoot, 'package-lock.json'),
      Object.keys(additionalDependencies).length === 0
        ? SHARED_PACKAGE_LOCK
        : createPackageLock(dependencies),
      'utf8',
    ),
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

/** Creates deterministic package-lock evidence for a compiler fixture with extra declarations. */
function createPackageLock(dependencies: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries(dependencies)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([packageName, version]) => [`node_modules/${packageName}`, { version }]),
    ),
  });
}

/** Writes an injected acquisition result and verifies exactly the bytes the store will publish. */
async function writeVerifiedManagedPackage(
  targetNodeModulesPath: string,
  packageName: string,
  version: string,
  sourceText: string,
): Promise<PreviewManagedPackageCopyResult> {
  const relativePath = packageName;
  const packageRoot = path.join(targetNodeModulesPath, ...packageName.split('/'));
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ main: 'index.js', name: packageName, version }),
      'utf8',
    ),
    writeFile(path.join(packageRoot, 'index.js'), sourceText, 'utf8'),
  ]);
  const verification = await verifyPreviewManagedPackageTree(packageRoot);
  return verifyPreviewManagedPackages(
    [
      {
        contentDigest: verification.contentDigest,
        name: packageName,
        relativePath,
        version,
      },
    ],
    targetNodeModulesPath,
  );
}

/** Reads the saved target exactly as an editor snapshot would provide it. */
async function readTargetSource(targetPath: string): Promise<string> {
  return import('node:fs/promises').then(async ({ readFile }) => readFile(targetPath, 'utf8'));
}

/** Asserts that compiler acquisition did not install anything into the selected project. */
async function expectPathToBeMissing(candidatePath: string): Promise<void> {
  await expect(
    import('node:fs/promises').then(async ({ access }) => access(candidatePath)),
  ).rejects.toThrow();
}
