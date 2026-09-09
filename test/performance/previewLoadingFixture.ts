/** Measures shipped-worker preparation and real Chromium first commit using owned fixtures only. */
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PreviewCompilerWorkerClient } from '../../src/adapters/worker/previewCompilerWorkerClient';
import { renderCompiledPreviewHeadlessly } from '../../src/adapters/node/previewHeadlessRenderer';
import type {
  PreviewBuildRequest,
  PreviewBundle,
  PreviewRenderMode,
} from '../../src/domain/preview';

/** One fresh worker's cold preparation, warm rebuild, artifact bytes, and fresh-browser first commit. */
export interface PreviewLoadingSample {
  /** Cold request dispatch through worker activation and transfer, in milliseconds. */
  readonly coldPreparationMs: number;
  /** Time to the first compiler progress message, including worker activation, in milliseconds. */
  readonly workerActivationMs: number;
  /** Same-target source-edit preparation with the existing worker, in milliseconds. */
  readonly warmPreparationMs: number;
  /** Browser navigation through the target's first committed DOM, excluding browser launch. */
  readonly firstCommitMs?: number;
  /** Total emitted JavaScript bytes, including shared package chunks. */
  readonly javascriptBytes: number;
  /** Number of emitted JavaScript chunks in addition to the main entry. */
  readonly javascriptChunks: number;
}

/** Creates a fixed shallow page without reading or starting any user application. */
async function createFixture(rootPath: string): Promise<PreviewBuildRequest> {
  const sourceText = [
    "import * as React from 'react';",
    'export default function LoadingTarget() {',
    '  const [marker] = React.useState(() => "PREVIEW_LOADING_ORIGINAL");',
    '  const ref = React.useRef(null);',
    '  React.useLayoutEffect(() => {',
    '    const element = ref.current;',
    '    if (element && !element.hasAttribute("data-first-commit-ms")) {',
    '      element.setAttribute("data-first-commit-ms", performance.now().toFixed(3));',
    '    }',
    '  }, []);',
    '  return <main ref={ref} id="loading-benchmark">{marker}</main>;',
    '}',
  ].join('\n');
  const documentPath = path.join(rootPath, 'Target.tsx');
  await Promise.all([
    writeFile(path.join(rootPath, 'package.json'), '{"private":true}', 'utf8'),
    writeFile(documentPath, sourceText, 'utf8'),
    writeFile(
      path.join(rootPath, 'App.tsx'),
      [
        "import Target from './Target';",
        'export default function App() { return <section><header>PREVIEW_LOADING_SHELL</header><Target /></section>; }',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      path.join(rootPath, 'main.tsx'),
      "import { createRoot } from 'react-dom/client'; import App from './App'; createRoot(document.body).render(<App />);",
      'utf8',
    ),
  ]);
  return {
    dependencySnapshots: [],
    documentPath,
    language: 'tsx',
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    sourceText,
    useStorybookPreview: false,
    workspaceRoot: rootPath,
  };
}

/** Rejects compilation failures before counting any sample as a successful preparation. */
function assertBundle(bundle: PreviewBundle, marker: string): void {
  assert.deepEqual(
    bundle.diagnostics.filter((item) => item.severity === 'error'),
    [],
  );
  const javascript = Buffer.concat([
    Buffer.from(bundle.javascript),
    ...bundle.chunks
      .filter((chunk) => chunk.relativePath.endsWith('.js'))
      .map((chunk) => Buffer.from(chunk.contents)),
  ]).toString('utf8');
  assert(javascript.includes(marker), 'The source edit must be present in the prepared bundle.');
}

/** Runs a fresh shipped worker and browser; all owned project, browser, and server state is closed. */
export async function runPreviewLoadingSample(
  workerPath: string,
  browser: boolean,
  renderMode: PreviewRenderMode,
): Promise<PreviewLoadingSample> {
  const rootPath = await mkdtemp(path.resolve('test/fixtures/preview-loading-benchmark-'));
  const compiler = new PreviewCompilerWorkerClient(workerPath);
  try {
    const request = { ...(await createFixture(rootPath)), renderMode };
    let workerActivationMs = 0;
    const startedAt = performance.now();
    const cold = await compiler.compile(request, {
      reportProgress: () => {
        if (workerActivationMs === 0) workerActivationMs = performance.now() - startedAt;
      },
    });
    const coldPreparationMs = performance.now() - startedAt;
    assertBundle(cold, 'PREVIEW_LOADING_ORIGINAL');
    const warmRequest = {
      ...request,
      sourceText: request.sourceText.replace('PREVIEW_LOADING_ORIGINAL', 'PREVIEW_LOADING_EDITED'),
    };
    // Exercise the normal immutable editor snapshot without persisting the edit on disk.
    const warmStartedAt = performance.now();
    const warm = await compiler.compile(warmRequest);
    const warmPreparationMs = performance.now() - warmStartedAt;
    assertBundle(warm, 'PREVIEW_LOADING_EDITED');
    await compiler.shutdown();

    let firstCommitMs: number | undefined;
    if (browser) {
      const result = await renderCompiledPreviewHeadlessly(cold, request, {
        ...(process.env.CHROMIUM_PATH === undefined
          ? {}
          : { chromiumPath: process.env.CHROMIUM_PATH }),
      });
      assert.equal(result.status, 'ready', result.protocolError ?? result.timeoutDiagnostic);
      assert.equal(result.terminal?.revision, 1);
      assert.equal(result.stabilization?.progressVisible, false);
      assert.deepEqual(result.evidence.requiredArtifactFailures ?? [], []);
      assert.deepEqual(result.evidence.cdpExceptions ?? [], []);
      assert.deepEqual(result.evidence.windowErrors, []);
      assert.deepEqual(result.cleanup, {
        browserTerminated: true,
        profileRemoved: true,
        serverClosed: true,
      });
      assert(result.rootHtml.includes('PREVIEW_LOADING_ORIGINAL'));
      firstCommitMs = Number(/data-first-commit-ms="([\d.]+)"/u.exec(result.rootHtml)?.[1]);
      assert(Number.isFinite(firstCommitMs) && firstCommitMs > 0, result.rootHtml);
    }
    const javascriptChunks = cold.chunks.filter((chunk) => chunk.relativePath.endsWith('.js'));
    return {
      coldPreparationMs,
      workerActivationMs,
      warmPreparationMs,
      ...(firstCommitMs === undefined ? {} : { firstCommitMs }),
      javascriptBytes:
        cold.javascript.byteLength +
        javascriptChunks.reduce((bytes, chunk) => bytes + chunk.contents.byteLength, 0),
      javascriptChunks: javascriptChunks.length,
    };
  } finally {
    await compiler.shutdown();
    await rm(rootPath, { force: true, recursive: true });
  }
}
