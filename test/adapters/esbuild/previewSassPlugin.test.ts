/** Exercises project-scoped Sass discovery, CSS emission, dependencies, and fail-soft behavior. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewSassPlugin } from '../../../src/adapters/esbuild/previewSassPlugin';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('createPreviewSassPlugin', () => {
  /** Uses the nearest package compiler and reports every Sass partial as a hot-reload dependency. */
  it('compiles Sass through the project package without loading framework config', async () => {
    const projectRoot = await createProject('sass-available-');
    const sourcePath = path.join(projectRoot, 'theme.scss');
    const partialPath = path.join(projectRoot, '_tokens.scss');
    await Promise.all([
      writeFile(sourcePath, '$color: red;', 'utf8'),
      writeFile(partialPath, '$space: 8px;', 'utf8'),
      installFakeSass(projectRoot, partialPath),
    ]);
    const boundary = createPreviewSassPlugin({ projectRoot, workspaceRoot: projectRoot });
    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [sourcePath],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    });

    expect(result.outputFiles[0]?.text).toContain('.compiled-sass');
    expect(boundary.getDependencyPaths()).toEqual(
      expect.arrayContaining([
        canonicalizeExistingPath(sourcePath),
        canonicalizeExistingPath(partialPath),
      ]),
    );
    expect(result.warnings).toEqual([]);
  });

  /** Returns empty CSS and a warning when the optional project Sass compiler is unavailable. */
  it('skips Sass without failing the component bundle', async () => {
    const projectRoot = await createProject('sass-missing-');
    const sourcePath = path.join(projectRoot, 'theme.scss');
    await writeFile(sourcePath, '$color: red;', 'utf8');
    const boundary = createPreviewSassPlugin({ projectRoot, workspaceRoot: projectRoot });
    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [sourcePath],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    });

    expect(result.outputFiles[0]?.text).toContain('theme.scss');
    expect(result.warnings[0]?.text).toContain('No compatible "sass" package');
    expect(boundary.getWatchDirectories()).toEqual([]);
  });
});

/** Creates an isolated nearest package boundary and records it for deterministic cleanup. */
async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), `react-preview-${prefix}`));
  temporaryRoots.push(projectRoot);
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/** Installs a tiny structural Sass fixture that proves project-local CommonJS discovery. */
async function installFakeSass(projectRoot: string, partialPath: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules', 'sass');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      '{"name":"sass","main":"index.js"}',
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      [
        "const { pathToFileURL } = require('node:url');",
        'exports.compileAsync = async (sourcePath) => ({',
        "  css: '.compiled-sass { color: red; }',",
        `  loadedUrls: [pathToFileURL(sourcePath), pathToFileURL(${JSON.stringify(partialPath)})],`,
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);
}
