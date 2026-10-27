/** Uses real ESM evaluation and stylesheets to guard cancellation followed by a cached lazy import. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { planPreviewBuildOutputs } from '../../../src/adapters/esbuild/previewBuildOutputPlanner';
import { PREVIEW_LAZY_STYLE_CHUNK_NAMES } from '../../../src/adapters/esbuild/previewLazyStyleImports';
import { renderCompiledPreviewHeadlessly } from '../../../src/adapters/node/previewHeadlessRenderer';
import type { PreviewBundle, PreviewBuildRequest } from '../../../src/domain/preview';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = '<cached-style-cancellation-browser>';

it('restores a canceled module CSS on the old cached import without evaluating it twice', async () => {
  const directory = await mkdtemp(path.join(ROOT, 'test/fixtures/cached-style-cancellation-'));
  try {
    await Promise.all([
      writeFile(path.join(directory, 'page.js'), 'import "./page.css"; export const page = true;'),
      writeFile(path.join(directory, 'page.css'), ':root { font-size: 10px; }'),
      writeFile(
        path.join(directory, 'editor.js'),
        'import "./editor.css"; globalThis.__editorEvaluations = (globalThis.__editorEvaluations ?? 0) + 1; export const editor = true;',
      ),
      writeFile(path.join(directory, 'editor.css'), ':root { font-size: 30px; }'),
      writeFile(
        path.join(directory, 'unused.js'),
        'import "./unused.css"; export const unused = true;',
      ),
      writeFile(path.join(directory, 'unused.css'), ':root { font-size: 99px; }'),
    ]);
    const sourceText = createCachedImportProbeSource();
    const outputDirectory = path.join(directory, 'react-preview-output');
    const result = await build({
      absWorkingDir: directory,
      bundle: true,
      format: 'esm',
      splitting: true,
      metafile: true,
      write: false,
      chunkNames: PREVIEW_LAZY_STYLE_CHUNK_NAMES,
      entryNames: 'entry',
      outdir: outputDirectory,
      stdin: { contents: sourceText, loader: 'js', sourcefile: ENTRY, resolveDir: directory },
    });
    const plan = planPreviewBuildOutputs({
      absoluteWorkingDirectory: directory,
      absoluteOutputDirectory: outputDirectory,
      metafile: result.metafile,
      outputFiles: result.outputFiles,
      outputSelection: { ignoredEntryPoints: [], mainEntryPoint: ENTRY },
    });
    const bundle: PreviewBundle = {
      javascript: plan.entryJavaScript,
      chunks: [...plan.auxiliaryJavaScript, ...plan.auxiliaryStylesheets],
      ...(plan.entryStylesheet === undefined ? {} : { stylesheet: plan.entryStylesheet }),
      dependencies: [],
      diagnostics: [],
      watchDirectories: [],
      contextCoverage: 'partial',
    };
    const request: PreviewBuildRequest = {
      documentPath: path.join(directory, 'entry.js'),
      sourceText,
      dependencySnapshots: [],
      language: 'jsx',
      workspaceRoot: directory,
    };
    const rendered = await renderCompiledPreviewHeadlessly(
      bundle,
      request,
      process.env.CHROMIUM_PATH === undefined ? {} : { chromiumPath: process.env.CHROMIUM_PATH },
    );
    expect(rendered.status, rendered.protocolError).toBe('ready');
    expect(rendered.rootHtml).toContain('CACHED_STYLE_RESTORED');
    expect(rendered.rootHtml).toContain('data-before="10px"');
    expect(rendered.rootHtml).toContain('data-canceled="10px"');
    expect(rendered.rootHtml).toContain('data-refreshed="10px"');
    expect(rendered.rootHtml).toContain('data-replacement="30px"');
    expect(rendered.rootHtml).toContain('data-after="30px"');
    expect(rendered.rootHtml).toContain('data-evaluations="1"');
    expect(rendered.rootHtml).toContain('data-stylesheets="2"');
    expect(rendered.evidence.windowErrors).toEqual([]);
    expect(rendered.evidence.cdpExceptions ?? []).toEqual([]);
    const stylesheetRequests = rendered.evidence.loopbackRequests.filter((request) =>
      request.endsWith('.css 200'),
    );
    expect(stylesheetRequests).toHaveLength(3);
    expect(rendered.cleanup).toEqual({
      browserTerminated: true,
      profileRemoved: true,
      serverClosed: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Exercises the real cache in a second import of the generated entry, using only owned fixtures. */
function createCachedImportProbeSource(): string {
  return `
globalThis.__openStyleEditor = (globalThis, Symbol, URL, Promise) => import('./editor.js');
globalThis.__unusedStyleEditor = () => import('./unused.js');
if (!globalThis.__cachedStyleProbeStarted) {
  globalThis.__cachedStyleProbeStarted = true;
  void (async () => {
    const mount = document.querySelector('[data-react-preview-mount]');
    const api = acquireVsCodeApi();
    const revision = Number(mount.dataset.reactPreviewRuntimeRevision);
    const token = mount.dataset.reactPreviewRuntimeToken;
    try {
      const key = Symbol.for('newdlops.react-preview.lazy-styles.v1');
      const first = globalThis[key];
      await import('./page.js');
      first.commit();
      const before = getComputedStyle(document.documentElement).fontSize;
      const oldOpen = globalThis.__openStyleEditor;
      const replacement = new URL(import.meta.url);
      replacement.searchParams.set('cachedStyleProbe', 'replacement');
      await import(replacement.href);
      const candidate = globalThis[key];
      await candidate.ready;
      await globalThis.__openStyleEditor();
      candidate.dispose();
      const canceled = getComputedStyle(document.documentElement).fontSize;
      const untouched = new URL(import.meta.url);
      untouched.searchParams.set('cachedStyleProbe', 'after-cancellation');
      await import(untouched.href);
      const next = globalThis[key];
      await next.ready;
      next.activate();
      next.commit();
      const refreshed = getComputedStyle(document.documentElement).fontSize;
      const visibleOpen = globalThis.__openStyleEditor;
      const late = new URL(import.meta.url);
      late.searchParams.set('cachedStyleProbe', 'late-old-page-import');
      await import(late.href);
      const lateCandidate = globalThis[key];
      await lateCandidate.ready;
      await visibleOpen();
      lateCandidate.activate();
      lateCandidate.commit();
      const replacementStyle = getComputedStyle(document.documentElement).fontSize;
      await oldOpen();
      const after = getComputedStyle(document.documentElement).fontSize;
      const evaluations = globalThis.__editorEvaluations;
      const stylesheets = document.querySelectorAll('link[data-react-preview-lazy-style]').length;
      mount.innerHTML = '<output data-before="' + before + '" data-canceled="' + canceled +
        '" data-refreshed="' + refreshed + '" data-replacement="' + replacementStyle + '" data-after="' + after + '" data-evaluations="' + evaluations +
        '" data-stylesheets="' + stylesheets + '">CACHED_STYLE_RESTORED</output>';
      api.postMessage({revision,token,type:'react-preview-runtime-ready'});
    } catch (error) {
      mount.textContent = error.stack;
      api.postMessage({revision,token,type:'react-preview-runtime-failed'});
    }
  })();
}
`;
}
