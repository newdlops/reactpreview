import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewBuildRequest, PreviewBundle } from '../../domain/preview';
import { EsbuildPreviewCompiler } from '../esbuild/esbuildPreviewCompiler';
import { renderCompiledPreviewHeadlessly } from './previewHeadlessRenderer';
import { createPreviewHeadlessTsxCorpusVendorCache } from './previewHeadlessTsxCorpusVendorCache';
import {
  writePreviewTsxCorpusSpool,
  type PreviewTsxCorpusCompilerLaneCommand,
} from './previewHeadlessTsxCorpusPipeline';
import type {
  PreviewTsxCorpusAttemptSpec,
  PreviewTsxCorpusCompilerEvent,
  PreviewTsxCorpusStageEvent,
  PreviewTsxCorpusStageName,
  PreviewTsxCorpusWorkerLifecycleEvent,
  PreviewTsxCorpusWorkerResult,
  PreviewTsxCorpusLaneCommand,
  PreviewTsxCorpusRowOwnershipEvent,
} from './previewHeadlessTsxCorpusCampaignTypes';

/** Persistent compile-only process used by the v12 two-stage accelerator. */
export async function runPreviewHeadlessTsxCorpusCompilerLane(): Promise<number> {
  let compiler: EsbuildPreviewCompiler | undefined;
  let cacheNamespace: {
    readonly campaignId: string;
    readonly engineDigest: string;
    readonly policyDigest: string;
    readonly spoolRoot: string;
  } | undefined;
  process.stdout.write(`${JSON.stringify({ kind: 'ready', version: 12 })}\n`);
  let buffer = '';
  try {
    for await (const chunk of process.stdin) {
      buffer += Buffer.from(chunk).toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line.length === 0) continue;
        const command = JSON.parse(line) as PreviewTsxCorpusCompilerLaneCommand;
        if (command.version !== 12) throw new Error('Unsupported v12 compiler-lane protocol version.');
        if (command.kind === 'shutdown') {
          await compiler?.shutdown();
          process.stdout.write(`${JSON.stringify({ kind: 'drained', version: 12 })}\n`);
          return 0;
        }
        const namespace = {
          campaignId: command.identity.campaignId,
          engineDigest: command.identity.engineDigest,
          policyDigest: command.identity.policyDigest,
          spoolRoot: path.resolve(command.spoolRoot),
        };
        if (cacheNamespace !== undefined && (
          cacheNamespace.campaignId !== namespace.campaignId ||
          cacheNamespace.engineDigest !== namespace.engineDigest ||
          cacheNamespace.policyDigest !== namespace.policyDigest ||
          cacheNamespace.spoolRoot !== namespace.spoolRoot
        )) throw new Error('Compiler lane received a command outside its cache namespace.');
        cacheNamespace ??= namespace;
        compiler ??= new EsbuildPreviewCompiler({
          vendorModuleCacheBackend: createPreviewHeadlessTsxCorpusVendorCache(namespace),
        });
        const compileStartedAt = Date.now();
        let bundle: PreviewBundle;
        try {
          bundle = await compiler.compile(command.request);
        } catch (error) {
          const serialized = serializeError(error);
          process.stdout.write(`${JSON.stringify({
            commandId: command.commandId,
            ...serialized,
            kind: 'compile-failed',
            stage: 'compile',
            version: 12,
          })}\n`);
          continue;
        }
        const compileFinishedAt = Date.now();
        try {
          const descriptor = await writePreviewTsxCorpusSpool(
            command.spoolRoot,
            command.identity,
            bundle,
            command.request,
            command.absoluteDeadlineEpochMs,
          );
          process.stdout.write(`${JSON.stringify({
            commandId: command.commandId,
            compileFinishedAt,
            compileStartedAt,
            descriptor,
            kind: 'compiled',
            version: 12,
          })}\n`);
        } catch (error) {
          const serialized = serializeError(error);
          process.stdout.write(`${JSON.stringify({
            commandId: command.commandId,
            ...serialized,
            kind: 'compile-failed',
            stage: 'spool',
            version: 12,
          })}\n`);
        }
      }
    }
    return 0;
  } finally {
    await compiler?.shutdown();
  }
}

/**
 * fd0 JSONL lane protocol. The supervisor never grants a third command before
 * the corresponding terminal acknowledgement has crossed its durable boundary.
 */
export async function runPreviewHeadlessTsxCorpusLane(): Promise<number> {
  const lane: { compiler?: EsbuildPreviewCompiler } = {};
  const awaitingDurableAck = new Set<number>();
  const closeLane = async (): Promise<void> => {
    await lane.compiler?.shutdown();
  };
  process.stdout.write(`${JSON.stringify({ kind: 'ready', version: 3 })}\n`);
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += Buffer.from(chunk).toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.length === 0) continue;
      const command = JSON.parse(line) as PreviewTsxCorpusLaneCommand;
      if (command.version !== 3) throw new Error('Unsupported lane protocol version.');
      if (command.kind === 'ack') {
        if (!awaitingDurableAck.delete(command.index)) throw new Error('Lane received an unknown durable acknowledgement.');
        continue;
      }
      if (command.kind === 'shutdown' || command.kind === 'drain') {
        if (command.kind === 'drain' && awaitingDurableAck.size !== 0) {
          throw new Error('Lane cannot drain before supervisor durable acknowledgements.');
        }
        process.stdout.write(`${JSON.stringify({ kind: command.kind === 'drain' ? 'drained' : 'drained', version: 3 })}\n`);
        if (command.kind === 'shutdown') { await closeLane(); return 0; }
        continue;
      }
      if (awaitingDurableAck.size >= 2) throw new Error('Lane two-credit ceiling exceeded.');
      const encoded = Buffer.from(JSON.stringify({
        ...command.row,
        commandId: command.commandId,
        generationId: command.generationId,
        laneId: command.laneId,
      })).toString('base64url');
      await runPreviewHeadlessTsxCorpusWorker(encoded, lane);
      awaitingDurableAck.add(command.row.index);
      process.stdout.write(`${JSON.stringify({ commandId: command.commandId, index: command.row.index, kind: 'row-terminal', version: 3 })}\n`);
    }
  }
  await closeLane();
  return 0;
}

/** Executes exactly one frozen manifest row in a fresh compiler/browser process. */
export async function runPreviewHeadlessTsxCorpusWorker(
  encodedSpec: string,
  persistentLane?: { compiler?: EsbuildPreviewCompiler },
): Promise<number> {
  const spec = decodeSpec(encodedSpec);
  const startedAt = performance.now();
  const compileController = new AbortController();
  let compiler: EsbuildPreviewCompiler | undefined = persistentLane?.compiler;
  let cleanupPromise: Promise<void> | undefined;
  let renderActive = false;
  let terminationRequested = false;
  const writeDiagnostic = (event: PreviewTsxCorpusCompilerEvent | PreviewTsxCorpusWorkerLifecycleEvent | PreviewTsxCorpusRowOwnershipEvent): void => {
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
      version: 3,
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
      version: 3,
    };
    writeSync(3, `${JSON.stringify(event)}\n`);
  };
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (compiler !== undefined && persistentLane === undefined) {
        emitWorkerLifecycle('compiler-shutdown-started');
        await compiler.shutdown();
        emitWorkerLifecycle('compiler-shutdown-finished');
      }
      emitStage('cleanup-finished', { renderActive });
    })();
    return cleanupPromise;
  };
  const onSigterm = (): void => {
    terminationRequested = true;
    emitWorkerLifecycle('signal-received', { signal: 'SIGTERM' });
    if (renderActive) return;
    emitWorkerLifecycle('compiler-abort-requested');
    compileController.abort();
    void cleanup().then(() => {
      process.exitCode = 124;
    });
  };
  process.once('SIGTERM', onSigterm);
  emitStage('spawned', { attemptKind: spec.attemptKind, pid: process.pid });
  const documentPath = path.resolve(spec.sourceRoot, spec.row.path);
  try {
    const sourceText = await readFile(documentPath, 'utf8');
    const sourceDigest = createHash('sha256').update(sourceText).digest('hex');
    if (sourceDigest !== spec.row.sha256) {
      throw new Error(`Frozen target digest changed: expected ${spec.row.sha256}, got ${sourceDigest}.`);
    }
    emitStage('target-opened', { documentPath, sourceDigest });
    compiler ??= new EsbuildPreviewCompiler();
    if (persistentLane !== undefined) {
      persistentLane.compiler = compiler;
    }
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
          version: 3,
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
    const headless = await renderCompiledPreviewHeadlessly(bundle, request, {
      chromiumPath: spec.chromiumPath, timeoutMs: 30_000, virtualTimeMs: 5_000,
      reportOwnership: (ownership) => writeDiagnostic({
        generation: spec.generationId ?? `lane-${process.pid.toString()}`,
        index: spec.index,
        kind: 'row-ownership',
        lane: spec.laneId ?? 0,
        ownership,
        path: spec.row.path,
        version: 3,
      }),
    });
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
      version: 3,
    };
    emitStage('result-emitted');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.removeListener('SIGTERM', onSigterm);
    return 0;
  } catch (error) {
    renderActive = false;
    if (terminationRequested) {
      await cleanup();
      process.removeListener('SIGTERM', onSigterm);
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
      version: 3,
    };
    emitStage('result-emitted');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.removeListener('SIGTERM', onSigterm);
    return 0;
  }
}

function decodeSpec(encodedSpec: string): PreviewTsxCorpusAttemptSpec {
  const parsed = JSON.parse(Buffer.from(encodedSpec, 'base64url').toString('utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Worker spec must be an object.');
  return parsed as PreviewTsxCorpusAttemptSpec;
}

function serializeError(error: unknown): { readonly error: string; readonly errorName: string } {
  const normalized = normalizeErrorEvidence(error);
  const record = asErrorRecord(error);
  const diagnostics = record?.diagnostics === undefined
    ? ''
    : `; diagnostics=${normalizeErrorEvidence(record.diagnostics)}`;
  return {
    error: `${normalized}${diagnostics}`.slice(0, 16_384),
    errorName: typeof record?.name === 'string' && record.name.length > 0 ? record.name : 'Error',
  };
}

/** Converts cross-realm throw values to stable, bounded transport evidence before JSONL encoding. */
function normalizeErrorEvidence(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'string': return value;
    case 'number':
    case 'boolean':
    case 'bigint': return String(value);
    case 'symbol': return value.toString();
    case 'function': return '[function]';
    case 'object': break;
    default: return String(value);
  }
  if (depth >= 4) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    const cause = record.cause;
    if (name !== undefined || message !== undefined || cause !== undefined) {
      const evidence = Object.keys(record)
        .filter((key) => key !== 'cause' && key !== 'message' && key !== 'name')
        .sort()
        .slice(0, 16)
        .map((key) => {
          try {
            return `${key}=${normalizeErrorEvidence(record[key], seen, depth + 1)}`;
          } catch {
            return `${key}=[unreadable]`;
          }
        });
      return `${name ?? 'Error'}${message === undefined || message.length === 0 ? '' : `: ${message}`}${cause === undefined ? '' : `; cause=${normalizeErrorEvidence(cause, seen, depth + 1)}`}${evidence.length === 0 ? '' : `; ${evidence.join(', ')}`}`;
    }
    const fields = Object.keys(record).sort().slice(0, 16).map((key) => {
      try {
        return `${key}=${normalizeErrorEvidence(record[key], seen, depth + 1)}`;
      } catch {
        return `${key}=[unreadable]`;
      }
    });
    return fields.length === 0 ? Object.prototype.toString.call(value) : `{${fields.join(', ')}}`;
  } catch {
    return Object.prototype.toString.call(value);
  } finally {
    seen.delete(value);
  }
}

function asErrorRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}
