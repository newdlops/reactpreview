import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import { EsbuildPreviewCompiler } from '../esbuild/esbuildPreviewCompiler';
import { renderPreviewHeadlessly } from './previewHeadlessRenderer';
import type {
  PreviewTsxCorpusAttemptSpec,
  PreviewTsxCorpusCompilerEvent,
  PreviewTsxCorpusStageEvent,
  PreviewTsxCorpusStageName,
  PreviewTsxCorpusWorkerLifecycleEvent,
  PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';

/** Executes exactly one frozen manifest row in a fresh compiler/browser process. */
export async function runPreviewHeadlessTsxCorpusWorker(encodedSpec: string): Promise<number> {
  const spec = decodeSpec(encodedSpec);
  const startedAt = performance.now();
  const compileController = new AbortController();
  let compiler: EsbuildPreviewCompiler | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let renderActive = false;
  let terminationRequested = false;
  const writeDiagnostic = (event: PreviewTsxCorpusCompilerEvent | PreviewTsxCorpusWorkerLifecycleEvent): void => {
    try {
      writeSync(3, `${JSON.stringify(event)}\n`);
    } catch {
      // Diagnostic transport is observational and must not affect compiler or cleanup behavior.
    }
  };
  const emitWorkerLifecycle = (
    event: PreviewTsxCorpusWorkerLifecycleEvent['event'],
    detail?: Readonly<Record<string, unknown>>,
  ): void => {
    writeDiagnostic({
      ...(detail === undefined ? {} : { detail }),
      elapsedMs: Math.round(performance.now() - startedAt),
      event,
      index: spec.index,
      kind: 'worker-lifecycle',
      path: spec.row.path,
      version: 2,
    });
  };
  const emitStage = (
    stage: PreviewTsxCorpusStageName,
    detail?: Readonly<Record<string, unknown>>,
  ): void => {
    const event: PreviewTsxCorpusStageEvent = {
      ...(detail === undefined ? {} : { detail }),
      elapsedMs: Math.round(performance.now() - startedAt),
      index: spec.index,
      kind: 'target-stage',
      path: spec.row.path,
      stage,
      version: 2,
    };
    writeSync(3, `${JSON.stringify(event)}\n`);
  };
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (compiler !== undefined) {
        emitWorkerLifecycle('compiler-shutdown-started');
        await compiler.shutdown();
        emitWorkerLifecycle('compiler-shutdown-finished');
      }
      emitStage('cleanup-finished', { renderActive });
    })();
    return cleanupPromise;
  };
  process.once('SIGTERM', () => {
    terminationRequested = true;
    emitWorkerLifecycle('signal-received', { signal: 'SIGTERM' });
    if (renderActive) return;
    emitWorkerLifecycle('compiler-abort-requested');
    compileController.abort();
    void cleanup().then(() => {
      process.exitCode = 124;
    });
  });
  emitStage('spawned', { attemptKind: spec.attemptKind, pid: process.pid });
  const documentPath = path.resolve(spec.sourceRoot, spec.row.path);
  try {
    const sourceText = await readFile(documentPath, 'utf8');
    const sourceDigest = createHash('sha256').update(sourceText).digest('hex');
    if (sourceDigest !== spec.row.sha256) {
      throw new Error(`Frozen target digest changed: expected ${spec.row.sha256}, got ${sourceDigest}.`);
    }
    emitStage('target-opened', { documentPath, sourceDigest });
    compiler = new EsbuildPreviewCompiler();
    const request: PreviewBuildRequest = Object.freeze({
      dependencySnapshots: Object.freeze([]),
      documentPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText,
      useStorybookPreview: false,
      workspaceRoot: spec.workspace,
    });
    emitStage('compile-started');
    const bundle = await compiler.compile(request, {
      reportProgress: (stage, activity) => {
        writeDiagnostic({
          ...(activity === undefined ? {} : { activity }),
          elapsedMs: Math.round(performance.now() - startedAt),
          index: spec.index,
          kind: 'compiler-progress',
          path: spec.row.path,
          stage,
          version: 2,
        });
      },
      signal: compileController.signal,
    });
    emitStage('compile-finished', {
      chunkCount: bundle.chunks.length,
      diagnosticCount: bundle.diagnostics.length,
      javascriptBytes: bundle.javascript.byteLength,
    });
    emitStage('render-started');
    renderActive = true;
    const headless = await renderPreviewHeadlessly(
      { compile: async () => bundle },
      request,
      {
        chromiumPath: spec.chromiumPath,
        timeoutMs: 30_000,
        virtualTimeMs: 5_000,
      },
    );
    renderActive = false;
    emitStage('renderer-terminal', {
      cleanup: headless.cleanup,
      stabilizedOutcome: headless.stabilizedOutcome,
      status: headless.status,
    });
    await cleanup();
    const result: PreviewTsxCorpusWorkerResult = {
      documentPath,
      durationMs: Math.round(performance.now() - startedAt),
      headless,
      index: spec.index,
      kind: 'headless-result',
      path: spec.row.path,
      version: 2,
    };
    emitStage('result-emitted');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    renderActive = false;
    if (terminationRequested) {
      await cleanup();
      return 124;
    }
    const errorRecord = serializeError(error);
    await cleanup();
    const result: PreviewTsxCorpusWorkerResult = {
      documentPath,
      durationMs: Math.round(performance.now() - startedAt),
      ...errorRecord,
      index: spec.index,
      kind: 'compile-or-render-failure',
      path: spec.row.path,
      version: 2,
    };
    emitStage('result-emitted');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
}

function decodeSpec(encodedSpec: string): PreviewTsxCorpusAttemptSpec {
  const parsed = JSON.parse(Buffer.from(encodedSpec, 'base64url').toString('utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Worker spec must be an object.');
  return parsed as PreviewTsxCorpusAttemptSpec;
}

function serializeError(error: unknown): { readonly error: string; readonly errorName: string } {
  if (!(error instanceof Error)) return { error: String(error).slice(0, 16_384), errorName: 'Error' };
  const diagnostics = 'diagnostics' in error ? JSON.stringify(error.diagnostics) : '';
  return {
    error: `${error.message}${diagnostics.length === 0 ? '' : `\n${diagnostics}`}`.slice(0, 16_384),
    errorName: error.name,
  };
}
