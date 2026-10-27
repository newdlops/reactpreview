/** Exercises real finite threads: live style reads, initialization, cancellation, and fallback. */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPreviewSassWorkerTaskFactory } from '../../../src/adapters/worker/previewSassWorkerClient';

let root: string;
let workerPath: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'react-preview-sass-worker-'));
  workerPath = path.join(root, 'previewSassWorker.cjs');
  await build({
    entryPoints: ['src/previewSassWorker.ts'],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    minify: true,
    supported: { 'template-literal': false },
    logLevel: 'silent',
  });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes an owned project compiler whose observable markers prove source-read timing. */
async function project(name: string, body?: string): Promise<string> {
  const projectRoot = path.join(root, name);
  const sass = path.join(projectRoot, 'node_modules/sass');
  await mkdir(sass, { recursive: true });
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}');
  await writeFile(path.join(sass, 'package.json'), '{"name":"sass","main":"index.cjs"}');
  await writeFile(path.join(projectRoot, 'theme.scss'), '.live { color: red; }');
  await writeFile(
    path.join(sass, 'index.cjs'),
    [
      "const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');",
      `const root=${JSON.stringify(projectRoot)};fs.writeFileSync(path.join(root,'loaded'),'yes');`,
      "exports.compileAsync=async sourcePath=>{fs.writeFileSync(path.join(root,'compiled'),'yes');",
      body ??
        "return {css:fs.readFileSync(sourcePath,'utf8'),loadedUrls:[pathToFileURL(sourcePath)]};",
      '};',
      'exports.info="dart-sass\\t1.90.0\\ndart2js\\t3.8.2";exports.compile=exports.compileAsync;',
    ].join('\n'),
  );
  return projectRoot;
}

describe('finite Sass worker', () => {
  it('does not initialize an embedded alias in the finite JavaScript task', async () => {
    const projectRoot = await project('embedded-alias');
    await writeFile(
      path.join(projectRoot, 'node_modules/sass/package.json'),
      '{"name":"sass-embedded","main":"index.cjs"}',
    );
    const task = createPreviewSassWorkerTaskFactory(workerPath)({
      projectRoot,
      workspaceRoot: projectRoot,
      sourcePath: path.join(projectRoot, 'theme.scss'),
    });
    try {
      await expect(task.compile()).resolves.toBeUndefined();
      await expect(access(path.join(projectRoot, 'loaded'))).rejects.toThrow();
    } finally {
      await task.dispose();
    }
  });

  it('leaves a non-JavaScript compiler on the ordinary compilation path', async () => {
    const projectRoot = await project('non-javascript');
    const modulePath = path.join(projectRoot, 'node_modules/sass/index.cjs');
    await writeFile(
      modulePath,
      (await readFile(modulePath, 'utf8')) + '\nexports.info="dart-sass\\t1.90.0\\nnative";',
    );
    const task = createPreviewSassWorkerTaskFactory(workerPath)({
      projectRoot,
      workspaceRoot: projectRoot,
      sourcePath: path.join(projectRoot, 'theme.scss'),
    });
    try {
      await expect(task.compile()).resolves.toBeUndefined();
      await expect(access(path.join(projectRoot, 'compiled'))).rejects.toThrow();
    } finally {
      await task.dispose();
    }
  });
  it('preloads only the compiler and reads changed styles at the requested compile boundary', async () => {
    const projectRoot = await project('live-input');
    const sourcePath = path.join(projectRoot, 'theme.scss');
    const task = createPreviewSassWorkerTaskFactory(workerPath)({
      projectRoot,
      workspaceRoot: projectRoot,
      sourcePath,
    });
    try {
      await vi.waitFor(() => access(path.join(projectRoot, 'loaded')));
      await expect(access(path.join(projectRoot, 'compiled'))).rejects.toThrow();
      await writeFile(sourcePath, '.live { color: blue; }');
      const first = task.compile();
      expect(task.compile()).toBe(first);
      const result = await first;
      expect(result?.css).toBe('.live { color: blue; }');
      expect(result?.loadedUrls.map((url) => url.protocol)).toEqual(['file:']);
    } finally {
      await task.dispose();
    }
    expect(await readFile(path.join(projectRoot, 'compiled'), 'utf8')).toBe('yes');
  });

  it('terminates a non-responsive compile when its owning build is cancelled', async () => {
    const projectRoot = await project('cancelled', 'for (;;) {}');
    const controller = new AbortController();
    const task = createPreviewSassWorkerTaskFactory(workerPath)(
      { projectRoot, workspaceRoot: projectRoot, sourcePath: path.join(projectRoot, 'theme.scss') },
      controller.signal,
    );
    try {
      const result = task.compile();
      await vi.waitFor(() => access(path.join(projectRoot, 'compiled')));
      controller.abort();
      await expect(result).resolves.toBeUndefined();
      const disposal = task.dispose();
      expect(task.dispose()).toBe(disposal);
      await disposal;
    } finally {
      await task.dispose();
    }
  });

  it('releases an unused initialization without compiling its stylesheet', async () => {
    const projectRoot = await project('unused');
    const task = createPreviewSassWorkerTaskFactory(workerPath)({
      projectRoot,
      workspaceRoot: projectRoot,
      sourcePath: path.join(projectRoot, 'theme.scss'),
    });
    await vi.waitFor(() => access(path.join(projectRoot, 'loaded')));
    await task.dispose();
    await expect(task.compile()).resolves.toBeUndefined();
    await expect(access(path.join(projectRoot, 'compiled'))).rejects.toThrow();
  });

  it('returns a normal-path miss for a missing worker instead of losing styles', async () => {
    const projectRoot = await project('missing-worker');
    const task = createPreviewSassWorkerTaskFactory(path.join(root, 'absent.cjs'))({
      projectRoot,
      workspaceRoot: projectRoot,
      sourcePath: path.join(projectRoot, 'theme.scss'),
    });
    try {
      await expect(task.compile()).resolves.toBeUndefined();
    } finally {
      await task.dispose();
    }
  });

  it('rejects malformed worker URL data and permits ordinary Sass fallback', async () => {
    const malformed = path.join(root, 'malformed.cjs');
    await writeFile(
      malformed,
      "require('node:worker_threads').parentPort.once('message',()=>require('node:worker_threads').parentPort.postMessage({css:'bad',loadedUrls:['invalid URL']}));",
    );
    const task = createPreviewSassWorkerTaskFactory(malformed)({
      projectRoot: root,
      workspaceRoot: root,
      sourcePath: path.join(root, 'theme.scss'),
    });
    try {
      await expect(task.compile()).resolves.toBeUndefined();
    } finally {
      await task.dispose();
    }
  });
});
