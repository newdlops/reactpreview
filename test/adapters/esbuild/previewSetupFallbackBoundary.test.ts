/**
 * Exercises automatic Storybook fallback ownership and recovery watching through real esbuild
 * resolution. These tests keep setup failures distinct from target failures without depending on
 * human-readable diagnostic text or a framework development server.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type BuildFailure } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewSetupBridgePlugin } from '../../../src/adapters/esbuild/previewSetupBridgePlugin';
import { PreviewSetupFallbackBoundary } from '../../../src/adapters/esbuild/previewSetupFallbackBoundary';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('PreviewSetupFallbackBoundary', () => {
  /** Attributes a transitive setup error and retains the missing module's safe creation directory. */
  it('retries setup-owned failures and watches unresolved relative imports', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const storybookDirectory = path.join(workspaceRoot, '.storybook');
    const providerDirectory = path.join(workspaceRoot, 'src', 'providers');
    const setupModulePath = path.join(storybookDirectory, 'preview.ts');
    const missingModuleBase = path.join(providerDirectory, 'missing-theme');
    await Promise.all([
      mkdir(storybookDirectory, { recursive: true }),
      mkdir(providerDirectory, { recursive: true }),
    ]);
    await writeFile(
      setupModulePath,
      "import theme from '../src/providers/missing-theme'; export default { theme };",
      'utf8',
    );
    const boundary = new PreviewSetupFallbackBoundary(
      setupModulePath,
      workspaceRoot,
      workspaceRoot,
    );

    const failure = await captureBuildFailure({
      boundary,
      setupModulePath,
      sourceText: "import setup from 'react-preview:setup'; console.log(setup);",
      workspaceRoot,
    });
    const watchInputs = await boundary.createWatchInputs(failure.errors, workspaceRoot);
    const canonicalProviderDirectory = await realpath(providerDirectory);

    expect(boundary.shouldRetry(failure.errors, workspaceRoot)).toBe(true);
    expect(watchInputs.dependencyPaths).toEqual(
      expect.arrayContaining([
        await realpath(setupModulePath),
        `${path.join(canonicalProviderDirectory, path.basename(missingModuleBase))}.ts`,
      ]),
    );
    expect(watchInputs.watchDirectories).toContain(canonicalProviderDirectory);
  });

  /** Refuses fallback when an otherwise valid setup is bundled beside a broken target graph. */
  it('does not retry a target-owned failure', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const storybookDirectory = path.join(workspaceRoot, '.storybook');
    const setupModulePath = path.join(storybookDirectory, 'preview.ts');
    const targetModulePath = path.join(workspaceRoot, 'Target.ts');
    await mkdir(storybookDirectory, { recursive: true });
    await Promise.all([
      writeFile(setupModulePath, 'export default {};', 'utf8'),
      writeFile(targetModulePath, "import './missing-target'; export default 1;", 'utf8'),
    ]);
    const boundary = new PreviewSetupFallbackBoundary(
      setupModulePath,
      workspaceRoot,
      workspaceRoot,
    );

    const failure = await captureBuildFailure({
      boundary,
      setupModulePath,
      sourceText: [
        "import setup from 'react-preview:setup';",
        "import target from './Target';",
        'console.log(setup, target);',
      ].join('\n'),
      workspaceRoot,
    });

    expect(boundary.shouldRetry(failure.errors, workspaceRoot)).toBe(false);
  });

  /** Keeps a missing deep source tree from installing a recursive watcher over the whole package. */
  it('omits broad package-root recovery watchers in a monorepo', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const projectRoot = path.join(workspaceRoot, 'packages', 'client');
    const storybookDirectory = path.join(projectRoot, '.storybook');
    const setupModulePath = path.join(storybookDirectory, 'preview.ts');
    await mkdir(storybookDirectory, { recursive: true });
    await writeFile(
      setupModulePath,
      "import provider from '../src/missing/provider'; export default { provider };",
      'utf8',
    );
    const boundary = new PreviewSetupFallbackBoundary(setupModulePath, projectRoot, workspaceRoot);

    const failure = await captureBuildFailure({
      boundary,
      setupModulePath,
      sourceText: "import setup from 'react-preview:setup'; console.log(setup);",
      workspaceRoot,
    });
    const watchInputs = await boundary.createWatchInputs(failure.errors, workspaceRoot);

    expect(boundary.shouldRetry(failure.errors, workspaceRoot)).toBe(true);
    expect(watchInputs.watchDirectories).not.toContain(await realpath(projectRoot));
    expect(watchInputs.dependencyPaths).toContain(
      path.join(await realpath(projectRoot), 'src', 'missing', 'provider.ts'),
    );
  });

  /** Marks missing package requests as requiring explicit refresh because no safe local path exists. */
  it('reports manual recovery for unresolved bare setup imports', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const storybookDirectory = path.join(workspaceRoot, '.storybook');
    const setupModulePath = path.join(storybookDirectory, 'preview.ts');
    await mkdir(storybookDirectory, { recursive: true });
    await writeFile(
      setupModulePath,
      "import provider from 'missing-preview-provider'; export default { provider };",
      'utf8',
    );
    const boundary = new PreviewSetupFallbackBoundary(
      setupModulePath,
      workspaceRoot,
      workspaceRoot,
    );

    const failure = await captureBuildFailure({
      boundary,
      setupModulePath,
      sourceText: "import setup from 'react-preview:setup'; console.log(setup);",
      workspaceRoot,
    });

    expect(boundary.shouldRetry(failure.errors, workspaceRoot)).toBe(true);
    expect(boundary.requiresManualRefresh).toBe(true);
  });

  /** Does not classify failures reached through a setup symlink outside the workspace as owned. */
  it('excludes external symlink modules from setup fallback ownership', async () => {
    const temporaryRoot = await createTemporaryWorkspace();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const storybookDirectory = path.join(workspaceRoot, '.storybook');
    const setupModulePath = path.join(storybookDirectory, 'preview.ts');
    const externalModulePath = path.join(temporaryRoot, 'external-provider.ts');
    const linkedModulePath = path.join(storybookDirectory, 'external-provider.ts');
    await mkdir(storybookDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        setupModulePath,
        "import provider from './external-provider'; export default { provider };",
        'utf8',
      ),
      writeFile(
        externalModulePath,
        "import './missing-external-dependency'; export default {};",
        'utf8',
      ),
    ]);
    await symlink(externalModulePath, linkedModulePath, 'file');
    const boundary = new PreviewSetupFallbackBoundary(
      setupModulePath,
      workspaceRoot,
      workspaceRoot,
    );

    const failure = await captureBuildFailure({
      boundary,
      setupModulePath,
      sourceText: "import setup from 'react-preview:setup'; console.log(setup);",
      workspaceRoot,
    });

    expect(boundary.shouldRetry(failure.errors, workspaceRoot)).toBe(false);
  });
});

/** Input values shared by the two real resolver-failure fixtures. */
interface FailureFixtureOptions {
  /** Stateful observer under test. */
  readonly boundary: PreviewSetupFallbackBoundary;
  /** Storybook setup imported through the production virtual bridge. */
  readonly setupModulePath: string;
  /** Virtual entry source that selects setup-only or combined target resolution. */
  readonly sourceText: string;
  /** Temporary esbuild working directory. */
  readonly workspaceRoot: string;
}

/** Runs one expected-to-fail build and returns esbuild's structured failure for policy assertions. */
async function captureBuildFailure(options: FailureFixtureOptions): Promise<BuildFailure> {
  try {
    await build({
      absWorkingDir: options.workspaceRoot,
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      plugins: [
        createPreviewSetupBridgePlugin({ setupModulePath: options.setupModulePath }),
        options.boundary.plugin,
      ],
      stdin: {
        contents: options.sourceText,
        loader: 'ts',
        resolveDir: options.workspaceRoot,
        sourcefile: '<fallback-boundary-entry>',
      },
      write: false,
    });
  } catch (error) {
    if (isBuildFailure(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('The fallback boundary fixture unexpectedly produced a successful build.');
}

/** Creates and registers a disposable temporary workspace for one resolver fixture. */
async function createTemporaryWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-fallback-boundary-'));
  temporaryRoots.push(workspaceRoot);
  return workspaceRoot;
}

/** Narrows an unknown esbuild rejection to its documented structured failure shape. */
function isBuildFailure(error: unknown): error is BuildFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray(error.errors) &&
    'warnings' in error
  );
}
