/** Exercises project-scoped Sass discovery, CSS emission, dependencies, and fail-soft behavior. */
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, context } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewSassPlugin } from '../../../src/adapters/esbuild/previewSassPlugin';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('createPreviewSassPlugin', () => {
  it('initializes once and shares physical termination across concurrent disposal calls', async () => {
    const projectRoot = await createProject('sass-shared-termination-');
    const stylesheet = path.join(projectRoot, 'plain.css');
    await writeFile(stylesheet, '.plain { color: blue; }');
    let finish: (() => void) | undefined;
    const termination = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const compile = vi.fn(() => Promise.resolve(undefined));
    const dispose = vi.fn(() => termination);
    const createTask = vi.fn(() => ({ compile, dispose }));
    const boundary = createPreviewSassPlugin({
      projectRoot,
      workspaceRoot: projectRoot,
      preparation: {
        sourcePath: path.join(projectRoot, 'unused.scss'),
        signal: new AbortController().signal,
        createTask,
      },
    });
    const native = await context({
      bundle: true,
      entryPoints: [stylesheet],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    });
    const first = native.rebuild();
    void first.catch(() => undefined);
    try {
      await vi.waitFor(() => {
        expect(dispose).toHaveBeenCalledOnce();
      });
      expect(createTask).toHaveBeenCalledOnce();
      expect(compile).not.toHaveBeenCalled();
      let secondFinished = false;
      const second = boundary.dispose().then(() => {
        secondFinished = true;
      });
      await Promise.resolve();
      expect(secondFinished).toBe(false);
      finish?.();
      await Promise.all([first, second]);
      expect(secondFinished).toBe(true);
      expect((await native.rebuild()).outputFiles[0]?.text).toContain('.plain');
      expect(createTask).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      finish?.();
      await first.catch(() => undefined);
      await native.dispose();
    }
  });

  it.each(['entry', 'partial'] as const)(
    'refreshes a same-size %s edit with a preserved modification time and keeps unchanged CSS cached',
    async (edited) => {
      const projectRoot = await createProject('sass-preserved-time-');
      const sourcePath = path.join(projectRoot, 'theme.scss');
      const partial = path.join(projectRoot, '_tokens.scss');
      const counter = path.join(projectRoot, 'compile-count');
      await writeFile(sourcePath, 'red');
      await writeFile(partial, 'red');
      const changed = edited === 'entry' ? sourcePath : partial;
      await utimes(changed, 1_700_000_000, 1_700_000_000);
      await installFakeSass(projectRoot, partial);
      await writeFile(
        path.join(projectRoot, 'node_modules/sass/index.js'),
        [
          "const fs = require('node:fs');",
          "const {pathToFileURL} = require('node:url');",
          'exports.compileAsync = async (sourcePath) => {',
          `const counter = ${JSON.stringify(counter)};`,
          'fs.writeFileSync(counter, String(Number(fs.existsSync(counter) ? fs.readFileSync(counter) : 0) + 1));',
          `return {css: '.authored { color: ' + fs.readFileSync(${JSON.stringify(changed)}, 'utf8') + '; }',`,
          `loadedUrls: [pathToFileURL(sourcePath), pathToFileURL(${JSON.stringify(partial)})]};`,
          '};',
        ].join('\n'),
      );
      const boundary = createPreviewSassPlugin({ projectRoot, workspaceRoot: projectRoot });
      const native = await context({
        absWorkingDir: projectRoot,
        bundle: true,
        entryPoints: [sourcePath],
        logLevel: 'silent',
        outdir: path.join(projectRoot, 'out'),
        plugins: [boundary.plugin],
        write: false,
      });
      try {
        expect((await native.rebuild()).outputFiles[0]?.text).toContain('color: red;');
        expect((await native.rebuild()).outputFiles[0]?.text).toContain('color: red;');
        expect(await readFile(counter, 'utf8')).toBe('1');
        const before = await stat(changed, { bigint: true });
        await writeFile(changed, 'tan');
        await utimes(changed, 1_700_000_000, 1_700_000_000);
        const after = await stat(changed, { bigint: true });
        expect(after.size).toBe(before.size);
        expect(after.mtimeNs).toBe(before.mtimeNs);
        expect(after.ctimeNs).not.toBe(before.ctimeNs);
        expect((await native.rebuild()).outputFiles[0]?.text).toContain('color: tan;');
        expect((await native.rebuild()).outputFiles[0]?.text).toContain('color: tan;');
        expect(await readFile(counter, 'utf8')).toBe('2');
        expect(boundary.getDependencyPaths()).toContain(canonicalizeExistingPath(partial));
      } finally {
        await native.dispose();
      }
    },
  );

  it('uses finite initialization once and preserves partial refreshes after its first signal expires', async () => {
    const projectRoot = await createProject('sass-prepared-');
    let sourcePath = path.join(projectRoot, 'theme.scss');
    const partial = path.join(projectRoot, '_tokens.scss');
    const marker = path.join(projectRoot, 'ordinary-sass-loaded');
    await Promise.all([
      writeFile(sourcePath, '$color: red;'),
      writeFile(partial, 'red'),
      installFakeSass(projectRoot, partial, marker),
    ]);
    sourcePath = canonicalizeExistingPath(sourcePath);
    const compile = vi.fn(() =>
      Promise.resolve({
        css: '.prepared { color: red; }',
        loadedUrls: [pathToFileURL(sourcePath), pathToFileURL(partial)],
      }),
    );
    const dispose = vi.fn(() => Promise.resolve());
    const createTask = vi.fn(() => ({ compile, dispose }));
    const controller = new AbortController();
    const boundary = createPreviewSassPlugin({
      projectRoot,
      workspaceRoot: projectRoot,
      preparation: { sourcePath, createTask, signal: controller.signal },
    });
    const native = await context({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [sourcePath],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    });
    try {
      expect((await native.rebuild()).outputFiles[0]?.text).toContain('.prepared');
      await expect(access(marker)).rejects.toThrow();
      expect(dispose).toHaveBeenCalledOnce();
      expect(boundary.getDependencyPaths()).toContain(canonicalizeExistingPath(partial));
      controller.abort();
      await writeFile(partial, 'changed tokens with a different size');
      expect((await native.rebuild()).outputFiles[0]?.text).toContain('.compiled-sass');
      await expect(access(marker)).resolves.toBeUndefined();
      expect(createTask).toHaveBeenCalledOnce();
      expect(compile).toHaveBeenCalledOnce();
      expect(createTask).toHaveBeenCalledWith(
        { projectRoot, workspaceRoot: projectRoot, sourcePath },
        controller.signal,
      );
    } finally {
      await native.dispose();
    }
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('retains authored styles through ordinary Sass when a prepared transport is unavailable', async () => {
    const projectRoot = await createProject('sass-prepared-fallback-');
    const sourcePath = path.join(projectRoot, 'theme.scss');
    await writeFile(sourcePath, '$color: red;');
    await installFakeSass(projectRoot, sourcePath);
    const dispose = vi.fn(() => Promise.resolve());
    const boundary = createPreviewSassPlugin({
      projectRoot,
      workspaceRoot: projectRoot,
      preparation: {
        sourcePath: canonicalizeExistingPath(sourcePath),
        signal: new AbortController().signal,
        createTask: () => ({ compile: () => Promise.resolve(undefined), dispose }),
      },
    });
    const result = await build({
      bundle: true,
      entryPoints: [sourcePath],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    });
    expect(result.outputFiles[0]?.text).toContain('.compiled-sass');
    expect(result.warnings).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('releases unused initialization without requesting any Sass source compile', async () => {
    const projectRoot = await createProject('sass-prepared-unused-');
    const stylesheet = path.join(projectRoot, 'plain.css');
    await writeFile(stylesheet, '.plain { color: blue; }');
    const compile = vi.fn(() => Promise.resolve(undefined));
    const dispose = vi.fn(() => Promise.resolve());
    const boundary = createPreviewSassPlugin({
      projectRoot,
      workspaceRoot: projectRoot,
      preparation: {
        sourcePath: path.join(projectRoot, 'unused.scss'),
        signal: new AbortController().signal,
        createTask: () => ({ compile, dispose }),
      },
    });
    await build({
      bundle: true,
      entryPoints: [stylesheet],
      logLevel: 'silent',
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    });
    expect(compile).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  /** A synchronous Dart failure remains a recoverable style warning with hot-reload evidence. */
  it('keeps rendering and watches the source directory when Dart JavaScript compilation fails', async () => {
    const projectRoot = await createProject('sass-sync-failure-');
    const sourcePath = path.join(projectRoot, 'theme.scss');
    await writeFile(sourcePath, 'invalid Sass');
    await installFakeSass(projectRoot, sourcePath);
    const modulePath = path.join(projectRoot, 'node_modules/sass/index.js');
    await writeFile(
      modulePath,
      (await readFile(modulePath, 'utf8')) +
        '\nexports.info="dart-sass\\t1.90.0\\ndart2js\\t3.8.2"; exports.compile=()=>{throw new Error("Invalid Sass fixture");};',
    );
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
    expect(result.warnings[0]?.text).toContain('Sass compilation failed');
    expect(boundary.getDependencyPaths()).toContain(canonicalizeExistingPath(sourcePath));
    expect(boundary.getWatchDirectories()).toEqual([
      path.dirname(canonicalizeExistingPath(sourcePath)),
    ]);
  });

  /** Real JavaScript and embedded/native Sass identities must keep their supported API contracts. */
  it.each([true, false])(
    'keeps CSS and partial tracking with Dart JavaScript selection %s',
    async (javascript) => {
      const projectRoot = await createProject('sass-api-');
      const sourcePath = path.join(projectRoot, 'theme.scss');
      const partial = path.join(projectRoot, '_tokens.scss');
      await Promise.all([
        writeFile(sourcePath, '$color: red;'),
        writeFile(partial, '$space: 8px;'),
        installFakeSass(projectRoot, partial),
      ]);
      const modulePath = path.join(projectRoot, 'node_modules/sass/index.js');
      const identity = javascript
        ? 'dart-sass\t1.90.0\ndart2js\t3.8.2'
        : 'dart-sass\t1.90.0\nnative';
      const extra = javascript
        ? [
            'exports.compile = (sourcePath) => ({css: ".compiled-sass { color: red; }", loadedUrls: [pathToFileURL(sourcePath), pathToFileURL(' +
              JSON.stringify(partial) +
              ')]});',
            'exports.compileAsync = () => {throw new Error("ASYNC_MUST_NOT_RUN");};',
          ]
        : ['exports.compile = () => {throw new Error("NATIVE_SYNC_MUST_NOT_RUN");};'];
      await writeFile(
        modulePath,
        (await readFile(modulePath, 'utf8')) +
          '\nexports.info=' +
          JSON.stringify(identity) +
          ';\n' +
          extra.join('\n'),
      );
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
      expect(result.warnings).toEqual([]);
      expect(boundary.getDependencyPaths()).toContain(canonicalizeExistingPath(partial));
    },
  );

  /** CSS-only previews must not initialize the optional Sass runtime before native bundling. */
  it('loads the project Sass implementation only when a Sass file is actually reached', async () => {
    const projectRoot = await createProject('sass-demand-');
    const stylesheet = path.join(projectRoot, 'plain.css');
    const sourcePath = path.join(projectRoot, 'theme.scss');
    const marker = path.join(projectRoot, 'sass-loaded');
    await Promise.all([
      writeFile(stylesheet, '.plain { color: blue; }'),
      writeFile(sourcePath, '$color: red;'),
      installFakeSass(projectRoot, sourcePath, marker),
    ]);
    const boundary = createPreviewSassPlugin({ projectRoot, workspaceRoot: projectRoot });
    const options = {
      absWorkingDir: projectRoot,
      bundle: true,
      logLevel: 'silent' as const,
      outdir: path.join(projectRoot, 'out'),
      plugins: [boundary.plugin],
      write: false,
    };
    const css = await build({ ...options, entryPoints: [stylesheet] });
    expect(css.outputFiles?.[0]?.text).toContain('.plain');
    await expect(access(marker)).rejects.toThrow();
    const sass = await build({ ...options, entryPoints: [sourcePath] });
    expect(sass.outputFiles?.[0]?.text).toContain('.compiled-sass');
    await expect(access(marker)).resolves.toBeUndefined();
  });

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
async function installFakeSass(
  projectRoot: string,
  partialPath: string,
  loadMarker?: string,
): Promise<void> {
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
        ...(loadMarker === undefined
          ? []
          : [`require('node:fs').writeFileSync(${JSON.stringify(loadMarker)}, 'loaded');`]),
        'exports.compileAsync = async (sourcePath) => ({',
        "  css: '.compiled-sass { color: red; }',",
        `  loadedUrls: [pathToFileURL(sourcePath), pathToFileURL(${JSON.stringify(partialPath)})],`,
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);
}
