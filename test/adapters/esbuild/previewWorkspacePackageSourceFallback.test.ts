/** Verifies unbuilt linked workspace packages recover from exact authored-source evidence. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewWorkspacePackageSourceFallbackPlugin } from '../../../src/adapters/esbuild/previewWorkspacePackageSourceFallback';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

describe('createPreviewWorkspacePackageSourceFallbackPlugin', () => {
  /** Resolves one exact missing dist export from a symlinked monorepo package's source entry. */
  it('uses source for an unbuilt linked workspace package subpath', async () => {
    const fixture = await createWorkspaceFixture('@scope/toolkit');
    try {
      await writePackageManifest(fixture.packageRoot, {
        exports: {
          './preset': {
            default: './dist/preset/index.js',
            types: './dist/preset/index.d.ts',
          },
        },
        files: ['dist'],
        name: '@scope/toolkit',
        scripts: { build: 'tsup' },
      });
      await writeSource(
        fixture.packageRoot,
        'src/preset/index.ts',
        "export const answer = 'source';",
      );
      await writeEntry(
        fixture.entryPath,
        "import { answer } from '@scope/toolkit/preset'; console.log(answer);",
      );

      const registerWatchDirectory = vi.fn();
      const result = await buildFixture(
        fixture,
        createPreviewWorkspacePackageSourceFallbackPlugin({
          registerWatchDirectory,
          workspaceRoot: fixture.workspaceRoot,
        }),
      );
      const consoleFixture = { log: vi.fn() };
      vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', { console: consoleFixture });

      expect(consoleFixture.log).toHaveBeenCalledWith('source');
      expect(result.warnings[0]?.text).toContain(
        'used workspace source for unbuilt package export "@scope/toolkit/preset"',
      );
      expect(registerWatchDirectory).toHaveBeenCalledWith(
        canonicalizeExistingPath(path.join(fixture.packageRoot, 'src', 'preset')),
      );
    } finally {
      await fixture.dispose();
    }
  });

  /** Supports wildcard exports while still deriving source from the concrete requested subpath. */
  it('maps a single-wildcard dist export to the matching source file', async () => {
    const fixture = await createWorkspaceFixture('design-system');
    try {
      await writePackageManifest(fixture.packageRoot, {
        exports: { './features/*': './build/features/*.js' },
        name: 'design-system',
        scripts: { build: 'rollup -c' },
      });
      await writeSource(
        fixture.packageRoot,
        'src/features/colors.ts',
        "export const color = 'blue';",
      );
      await writeEntry(
        fixture.entryPath,
        "import { color } from 'design-system/features/colors'; console.log(color);",
      );

      const result = await buildFixture(
        fixture,
        createPreviewWorkspacePackageSourceFallbackPlugin({
          workspaceRoot: fixture.workspaceRoot,
        }),
      );
      const consoleFixture = { log: vi.fn() };
      vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', { console: consoleFixture });

      expect(consoleFixture.log).toHaveBeenCalledWith('blue');
    } finally {
      await fixture.dispose();
    }
  });

  /** Restores a declared CSS export only from the identical checked-in src-relative path. */
  it('maps a missing workspace dist CSS export to its exact source stylesheet', async () => {
    const fixture = await createWorkspaceFixture('style-workspace');
    try {
      await writePackageManifest(fixture.packageRoot, {
        exports: { './tailwind.css': './dist/tailwind.css' },
        files: ['dist'],
        name: 'style-workspace',
        scripts: { build: 'tsup' },
      });
      await writeSource(
        fixture.packageRoot,
        'src/tailwind.css',
        '.workspace-source-style { color: rebeccapurple; }',
      );
      await writeEntry(fixture.entryPath, "import 'style-workspace/tailwind.css';");

      const result = await buildFixture(
        fixture,
        createPreviewWorkspacePackageSourceFallbackPlugin({
          workspaceRoot: fixture.workspaceRoot,
        }),
      );

      expect(result.outputFiles?.some((file) => file.text.includes('rebeccapurple'))).toBe(true);
      expect(result.warnings[0]?.text).toContain(
        'used workspace source for unbuilt package export "style-workspace/tailwind.css"',
      );
    } finally {
      await fixture.dispose();
    }
  });

  /** Treats a condition-only exports object as the root export instead of a subpath table. */
  it('recovers an unbuilt root package with conditional exports', async () => {
    const fixture = await createWorkspaceFixture('conditional-workspace');
    try {
      await writePackageManifest(fixture.packageRoot, {
        exports: {
          browser: './dist/index.js',
          default: './dist/index.js',
        },
        name: 'conditional-workspace',
        scripts: { build: 'tsup' },
      });
      await writeSource(fixture.packageRoot, 'src/index.ts', "export const answer = 'root';");
      await writeEntry(
        fixture.entryPath,
        "import { answer } from 'conditional-workspace'; console.log(answer);",
      );

      const result = await buildFixture(
        fixture,
        createPreviewWorkspacePackageSourceFallbackPlugin({
          workspaceRoot: fixture.workspaceRoot,
        }),
      );
      const consoleFixture = { log: vi.fn() };
      vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', { console: consoleFixture });

      expect(consoleFixture.log).toHaveBeenCalledWith('root');
    } finally {
      await fixture.dispose();
    }
  });

  /** Leaves a built workspace package on its public artifact instead of silently preferring source. */
  it('preserves an existing exported build artifact', async () => {
    const fixture = await createWorkspaceFixture('built-workspace');
    try {
      await writePackageManifest(fixture.packageRoot, {
        exports: { './preset': './dist/preset/index.js' },
        name: 'built-workspace',
        scripts: { build: 'tsup' },
      });
      await writeSource(
        fixture.packageRoot,
        'src/preset/index.ts',
        "export const answer = 'source';",
      );
      await writeSource(
        fixture.packageRoot,
        'dist/preset/index.js',
        "export const answer = 'dist';",
      );
      await writeEntry(
        fixture.entryPath,
        "import { answer } from 'built-workspace/preset'; console.log(answer);",
      );

      const result = await buildFixture(
        fixture,
        createPreviewWorkspacePackageSourceFallbackPlugin({
          workspaceRoot: fixture.workspaceRoot,
        }),
      );
      const consoleFixture = { log: vi.fn() };
      vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', { console: consoleFixture });

      expect(consoleFixture.log).toHaveBeenCalledWith('dist');
      expect(result.warnings).toHaveLength(0);
    } finally {
      await fixture.dispose();
    }
  });

  /** Rejects copied registry dependencies even if they happen to ship an unpublished src directory. */
  it('does not recover a non-linked node_modules package', async () => {
    const fixture = await createWorkspaceFixture('copied-package', false);
    try {
      await writePackageManifest(fixture.logicalPackageRoot, {
        exports: { './preset': './dist/preset/index.js' },
        name: 'copied-package',
        scripts: { build: 'tsup' },
      });
      await writeSource(
        fixture.logicalPackageRoot,
        'src/preset/index.ts',
        'export const answer = 1;',
      );
      await writeEntry(
        fixture.entryPath,
        "import { answer } from 'copied-package/preset'; console.log(answer);",
      );

      await expect(
        buildFixture(
          fixture,
          createPreviewWorkspacePackageSourceFallbackPlugin({
            workspaceRoot: fixture.workspaceRoot,
          }),
        ),
      ).rejects.toThrow('Could not resolve "copied-package/preset"');
    } finally {
      await fixture.dispose();
    }
  });

  /** Rejects a developer link whose authored package is outside the trusted preview workspace. */
  it('does not follow a linked package outside the workspace boundary', async () => {
    const fixture = await createWorkspaceFixture('external-link', false);
    const externalPackageRoot = await mkdtemp(
      path.join(tmpdir(), 'react-preview-external-package-'),
    );
    try {
      await rm(fixture.logicalPackageRoot, { force: true, recursive: true });
      await writePackageManifest(externalPackageRoot, {
        exports: { './preset': './dist/preset/index.js' },
        name: 'external-link',
        scripts: { build: 'tsup' },
      });
      await writeSource(externalPackageRoot, 'src/preset/index.ts', 'export const answer = 1;');
      await symlink(externalPackageRoot, fixture.logicalPackageRoot);
      await writeEntry(
        fixture.entryPath,
        "import { answer } from 'external-link/preset'; console.log(answer);",
      );

      await expect(
        buildFixture(
          fixture,
          createPreviewWorkspacePackageSourceFallbackPlugin({
            workspaceRoot: fixture.workspaceRoot,
          }),
        ),
      ).rejects.toThrow('Could not resolve "external-link/preset"');
    } finally {
      await Promise.all([
        fixture.dispose(),
        rm(externalPackageRoot, { force: true, recursive: true }),
      ]);
    }
  });

  /** Rejects a missing output below a dist symlink whose watcher target leaves the workspace. */
  it('does not recover or watch through an external output-directory symlink', async () => {
    const fixture = await createWorkspaceFixture('external-dist');
    const externalOutputRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-external-output-'));
    try {
      await writePackageManifest(fixture.packageRoot, {
        exports: { './preset': './dist/preset/index.js' },
        name: 'external-dist',
        scripts: { build: 'tsup' },
      });
      await writeSource(fixture.packageRoot, 'src/preset/index.ts', 'export const answer = 1;');
      await symlink(externalOutputRoot, path.join(fixture.packageRoot, 'dist'));
      await writeEntry(
        fixture.entryPath,
        "import { answer } from 'external-dist/preset'; console.log(answer);",
      );
      const registerWatchDirectory = vi.fn();

      await expect(
        buildFixture(
          fixture,
          createPreviewWorkspacePackageSourceFallbackPlugin({
            registerWatchDirectory,
            workspaceRoot: fixture.workspaceRoot,
          }),
        ),
      ).rejects.toThrow('Could not resolve "external-dist/preset"');
      expect(registerWatchDirectory).not.toHaveBeenCalled();
    } finally {
      await Promise.all([
        fixture.dispose(),
        rm(externalOutputRoot, { force: true, recursive: true }),
      ]);
    }
  });
});

/** Temporary monorepo fixture with either a workspace symlink or an ordinary package directory. */
interface WorkspaceFixture {
  readonly dispose: () => Promise<void>;
  readonly entryPath: string;
  readonly logicalPackageRoot: string;
  readonly packageRoot: string;
  readonly workspaceRoot: string;
}

/** Creates the minimum filesystem topology needed to exercise Node workspace package resolution. */
async function createWorkspaceFixture(
  packageName: string,
  linked = true,
): Promise<WorkspaceFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-workspace-source-'));
  const applicationRoot = path.join(workspaceRoot, 'apps', 'web');
  const packageRoot = path.join(workspaceRoot, 'packages', packageName.replaceAll('/', '-'));
  const packageSegments = packageName.split('/');
  const logicalPackageRoot = path.join(applicationRoot, 'node_modules', ...packageSegments);
  const entryPath = path.join(applicationRoot, 'src', 'entry.ts');
  await mkdir(path.dirname(entryPath), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await mkdir(path.dirname(logicalPackageRoot), { recursive: true });
  if (linked) {
    await symlink(path.relative(path.dirname(logicalPackageRoot), packageRoot), logicalPackageRoot);
  } else {
    await mkdir(logicalPackageRoot, { recursive: true });
  }
  return {
    dispose: async () => {
      await rm(workspaceRoot, { force: true, recursive: true });
    },
    entryPath,
    logicalPackageRoot,
    packageRoot,
    workspaceRoot,
  };
}

/** Writes one package manifest as inert JSON data. */
async function writePackageManifest(
  packageRoot: string,
  manifest: Readonly<Record<string, unknown>>,
): Promise<void> {
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    'utf8',
  );
}

/** Writes one authored or built module below a fixture package. */
async function writeSource(
  packageRoot: string,
  relativePath: string,
  sourceText: string,
): Promise<void> {
  const sourcePath = path.join(packageRoot, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
}

/** Writes the application issuer that imports the package subpath under test. */
async function writeEntry(entryPath: string, sourceText: string): Promise<void> {
  await writeFile(entryPath, sourceText, 'utf8');
}

/** Bundles a fixture entirely in memory so no generated files alter the temporary workspace. */
async function buildFixture(
  fixture: WorkspaceFixture,
  plugin: ReturnType<typeof createPreviewWorkspacePackageSourceFallbackPlugin>,
): Promise<Awaited<ReturnType<typeof build>>> {
  return await build({
    absWorkingDir: fixture.workspaceRoot,
    bundle: true,
    entryPoints: [fixture.entryPath],
    format: 'cjs',
    logLevel: 'silent',
    outdir: path.join(fixture.workspaceRoot, '.preview-out'),
    platform: 'browser',
    plugins: [plugin],
    write: false,
  });
}
