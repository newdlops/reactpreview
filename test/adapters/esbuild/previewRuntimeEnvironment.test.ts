/**
 * Exercises runtime convention discovery against real temporary files and symlinks. The tests keep
 * setup validation, deterministic Storybook precedence, inert namespace extraction, and bounded
 * metadata reads observable without importing any project-authored module.
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPreviewRuntimeWatchInputs,
  MAX_RUNTIME_DISCOVERY_FILE_BYTES,
  MAX_RUNTIME_GLOBAL_NAMESPACES,
  resolvePreviewRuntimeEnvironment,
} from '../../../src/adapters/esbuild/previewRuntimeEnvironment';
import { PreviewCompilationError } from '../../../src/domain/preview';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('resolvePreviewRuntimeEnvironment', () => {
  /**
   * Gives an explicit workspace-relative module precedence and returns only namespace identifiers
   * from HTML and Storybook source, including declarations embedded in an inert previewHead template.
   */
  it('selects a custom setup and discovers safe global namespaces without executing source', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const customSetupPath = path.join(workspaceRoot, 'config', 'preview.setup.tsx');
    await Promise.all([
      mkdir(path.dirname(customSetupPath), { recursive: true }),
      mkdir(path.join(projectRoot, 'public'), { recursive: true }),
      mkdir(path.join(projectRoot, '.storybook'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        customSetupPath,
        'throw new Error("setup discovery must not execute this module");',
      ),
      writeFile(
        path.join(projectRoot, 'public', 'index.html'),
        [
          '<script>',
          'window.ZUZU = window.ZUZU || {};',
          'globalThis.Analytics = globalThis.Analytics || { };',
          'window.Modern ??= {};',
          'globalThis.Direct = {};',
          'window.__proto__ = window.__proto__ || {};',
          '// window.Infinity = window.Infinity || {};',
          '// window.CommentOnly = window.CommentOnly || {};',
          'const interpolated = `${window.Interpolated = window.Interpolated || {}}`;',
          'window.undefined = {};',
          'window.Mismatch = globalThis.Mismatch || {};',
          'window.NonEmpty = window.NonEmpty || { enabled: true };',
          'object. window.Nested = window.Nested || {};',
          '</script>',
        ].join('\n'),
      ),
      writeFile(
        path.join(projectRoot, 'index.html'),
        'window.Analytics = window.Analytics || {};\nglobalThis.Root = globalThis.Root || {};',
      ),
      writeFile(
        path.join(projectRoot, '.storybook', 'main.ts'),
        [
          'export default {',
          '  previewHead: () => `<script>',
          '    window.Storybook = window.Storybook || {};',
          '    window.Storybook.service = "app";',
          '  </script>`,',
          '};',
        ].join('\n'),
      ),
      writeFile(path.join(projectRoot, '.storybook', 'preview.tsx'), 'export default {};'),
    ]);

    const absoluteResult = await resolvePreviewRuntimeEnvironment({
      configuredSetupPath: customSetupPath,
      projectRoot,
      useStorybookPreview: true,
      workspaceRoot,
    });
    const relativeResult = await resolvePreviewRuntimeEnvironment({
      configuredSetupPath: path.relative(workspaceRoot, customSetupPath),
      projectRoot,
      useStorybookPreview: true,
      workspaceRoot,
    });

    const expectedResult = {
      globalNamespaces: ['Analytics', 'Direct', 'Modern', 'Root', 'Storybook', 'ZUZU'],
      setupKind: 'custom',
      setupModulePath: await realpath(customSetupPath),
    } as const;
    expect(absoluteResult).toEqual(expectedResult);
    expect(relativeResult).toEqual(expectedResult);
  });

  /** Prefers the project-owned setup convention over Storybook without requiring editor settings. */
  it('auto-discovers a project preview setup before Storybook', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const setupDirectory = path.join(projectRoot, '.react-preview');
    const storybookDirectory = path.join(projectRoot, '.storybook');
    const setupModulePath = path.join(setupDirectory, 'setup.tsx');
    await Promise.all([
      mkdir(setupDirectory, { recursive: true }),
      mkdir(storybookDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(setupModulePath, 'export const PreviewProviders = ({ children }) => children;'),
      writeFile(path.join(storybookDirectory, 'preview.tsx'), 'export default {};'),
    ]);

    await expect(
      resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: true,
        workspaceRoot,
      }),
    ).resolves.toEqual({
      globalNamespaces: [],
      setupKind: 'custom',
      setupModulePath: await realpath(setupModulePath),
    });
  });

  /** Selects the first regular Storybook preview file in the documented extension order. */
  it('auto-discovers the highest-priority Storybook preview module', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const storybookDirectory = path.join(projectRoot, '.storybook');
    const preferredPreviewPath = path.join(storybookDirectory, 'preview.tsx');
    await mkdir(storybookDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(storybookDirectory, 'preview.js'), 'export default {};'),
      writeFile(preferredPreviewPath, 'export default {};'),
    ]);

    const result = await resolvePreviewRuntimeEnvironment({
      configuredSetupPath: '   ',
      projectRoot,
      useStorybookPreview: true,
      workspaceRoot,
    });

    expect(result).toEqual({
      globalNamespaces: [],
      setupKind: 'storybook',
      setupModulePath: await realpath(preferredPreviewPath),
    });
  });

  /** Keeps setup disabled when automatic Storybook reuse is off, while still reading inert globals. */
  it('returns no setup when Storybook reuse is disabled', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const storybookDirectory = path.join(projectRoot, '.storybook');
    await mkdir(storybookDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(storybookDirectory, 'preview.tsx'), 'export default {};'),
      writeFile(
        path.join(storybookDirectory, 'main.js'),
        'globalThis.STORY_CONTEXT = globalThis.STORY_CONTEXT || {};',
      ),
    ]);

    await expect(
      resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: false,
        workspaceRoot,
      }),
    ).resolves.toEqual({
      globalNamespaces: ['STORY_CONTEXT'],
      setupKind: 'none',
    });
  });

  /** Treats absent optional convention files as normal ENOENT discovery misses. */
  it('returns empty metadata when no optional conventions exist', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();

    await expect(
      resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: true,
        workspaceRoot,
      }),
    ).resolves.toEqual({ globalNamespaces: [], setupKind: 'none' });
  });

  /** Converts missing, unsupported, and non-file explicit setup paths to domain failures. */
  it('rejects invalid explicit setup modules', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const setupDirectory = path.join(workspaceRoot, 'setup.tsx');
    const unsupportedSetupPath = path.join(workspaceRoot, 'setup.json');
    await mkdir(setupDirectory);
    await writeFile(unsupportedSetupPath, '{}');

    const baseOptions = { projectRoot, useStorybookPreview: false, workspaceRoot };
    await expect(
      resolvePreviewRuntimeEnvironment({
        ...baseOptions,
        configuredSetupPath: 'missing.ts',
      }),
    ).rejects.toBeInstanceOf(PreviewCompilationError);
    await expect(
      resolvePreviewRuntimeEnvironment({
        ...baseOptions,
        configuredSetupPath: unsupportedSetupPath,
      }),
    ).rejects.toThrow('must be a JavaScript or TypeScript module');
    await expect(
      resolvePreviewRuntimeEnvironment({
        ...baseOptions,
        configuredSetupPath: setupDirectory,
      }),
    ).rejects.toThrow('must be a regular file');
  });

  /** Rejects both direct and symlinked explicit modules after canonical workspace validation. */
  it('confines explicit setup modules to the selected workspace', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const projectRoot = path.join(workspaceRoot, 'project');
    const outsideSetupPath = path.join(temporaryRoot, 'outside.setup.ts');
    const linkedSetupPath = path.join(workspaceRoot, 'linked.setup.ts');
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      writeFile(outsideSetupPath, 'export default {};'),
    ]);
    await symlink(outsideSetupPath, linkedSetupPath, 'file');

    const baseOptions = { projectRoot, useStorybookPreview: false, workspaceRoot };
    await expect(
      resolvePreviewRuntimeEnvironment({
        ...baseOptions,
        configuredSetupPath: outsideSetupPath,
      }),
    ).rejects.toThrow('must stay inside the selected workspace');
    await expect(
      resolvePreviewRuntimeEnvironment({
        ...baseOptions,
        configuredSetupPath: linkedSetupPath,
      }),
    ).rejects.toThrow('must stay inside the selected workspace');
  });

  /** Refuses to return an automatically discovered Storybook module whose symlink leaves the workspace. */
  it('confines Storybook setup discovery after following symlinks', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const projectRoot = path.join(workspaceRoot, 'project');
    const storybookDirectory = path.join(projectRoot, '.storybook');
    const outsidePreviewPath = path.join(temporaryRoot, 'preview.tsx');
    await Promise.all([
      mkdir(storybookDirectory, { recursive: true }),
      writeFile(outsidePreviewPath, 'export default {};'),
    ]);
    await symlink(outsidePreviewPath, path.join(storybookDirectory, 'preview.tsx'), 'file');

    await expect(
      resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: true,
        workspaceRoot,
      }),
    ).rejects.toThrow('must stay inside the selected workspace');
  });

  /** Reads only the fixed one-mebibyte prefix of each metadata file. */
  it('enforces the per-file runtime metadata read limit', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const publicDirectory = path.join(projectRoot, 'public');
    const visibleDeclaration = 'window.Visible = window.Visible || {};\n';
    const paddingLength = MAX_RUNTIME_DISCOVERY_FILE_BYTES - Buffer.byteLength(visibleDeclaration);
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(
      path.join(publicDirectory, 'index.html'),
      `${visibleDeclaration}${' '.repeat(paddingLength)}window.Hidden = window.Hidden || {};`,
    );

    const result = await resolvePreviewRuntimeEnvironment({
      projectRoot,
      useStorybookPreview: false,
      workspaceRoot,
    });

    expect(result.globalNamespaces).toEqual(['Visible']);
  });

  /** Rejects metadata that would create an unbounded generated global prelude. */
  it('enforces the unique global namespace count limit', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const publicDirectory = path.join(projectRoot, 'public');
    const declarations = Array.from(
      { length: MAX_RUNTIME_GLOBAL_NAMESPACES + 1 },
      (_, index) => `window.Namespace${index.toString()} = {};`,
    ).join('\n');
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(path.join(publicDirectory, 'index.html'), declarations, 'utf8');

    await expect(
      resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: false,
        workspaceRoot,
      }),
    ).rejects.toThrow('namespace safety limit');
  });

  /** Skips optional metadata symlinks outside the workspace instead of reading untrusted source. */
  it('does not scan global metadata through an external symlink', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const projectRoot = path.join(workspaceRoot, 'project');
    const publicDirectory = path.join(projectRoot, 'public');
    const outsideHtmlPath = path.join(temporaryRoot, 'outside.html');
    await Promise.all([
      mkdir(publicDirectory, { recursive: true }),
      writeFile(outsideHtmlPath, 'window.External = window.External || {};'),
    ]);
    await symlink(outsideHtmlPath, path.join(publicDirectory, 'index.html'), 'file');

    await expect(
      resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: false,
        workspaceRoot,
      }),
    ).resolves.toEqual({ globalNamespaces: [], setupKind: 'none' });
  });

  /** Never installs a recursive convention watcher through a directory symlink outside workspace. */
  it('excludes external symlink directories from runtime watch inputs', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const projectRoot = path.join(workspaceRoot, 'project');
    const outsidePublicDirectory = path.join(temporaryRoot, 'outside-public');
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      mkdir(outsidePublicDirectory, { recursive: true }),
    ]);
    await symlink(outsidePublicDirectory, path.join(projectRoot, 'public'), 'dir');

    const inputs = await createPreviewRuntimeWatchInputs(projectRoot, workspaceRoot);

    expect(inputs.watchDirectories).not.toContain(await realpath(outsidePublicDirectory));
    expect(inputs.dependencyPaths).not.toContain(path.join(projectRoot, 'public', 'index.html'));
  });
});

/** Creates a workspace with a nested project root and registers it for test cleanup. */
async function createWorkspaceProject(): Promise<{
  readonly projectRoot: string;
  readonly workspaceRoot: string;
}> {
  const workspaceRoot = await createTemporaryRoot();
  const projectRoot = path.join(workspaceRoot, 'packages', 'client');
  await mkdir(projectRoot, { recursive: true });
  return { projectRoot, workspaceRoot };
}

/** Creates and tracks an empty temporary directory for one filesystem-backed test. */
async function createTemporaryRoot(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-runtime-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}
