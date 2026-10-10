/**
 * Command-line entry for Page Inspector neural pre-training.
 *
 * Usage (through `scripts/pretrain-page-inspector-neural.mjs`):
 * - `--plan <file>`: `{ "workspaces": [{ "name": "...", "root": "/abs/project", "pages": ["src/..."] }] }`
 * - `--base <file>`: model to continue from, normally a copy of the profile model; empty when omitted
 * - `--store <dir>`: a copy of the extension's `dependency-store/v4`, for projects without
 *   `node_modules` (never the live store)
 * - `--out <dir>`: progress log, resumable checkpoint, and `neural-model-import.json`
 * - `--worker <file>`: compiler worker bundle (default `dist/previewCompilerWorker.js`)
 * - `--chunk <n>`: pages per workspace turn (default 10)
 * - `--nice <n>`: process niceness, inherited by Chromium (default 10; never background QoS)
 * - `--max-load <ratio>`: pause before a page while the 1-minute load average exceeds
 *   `ratio × CPUs` (default 1; `0` disables the gate), resuming below three quarters of it
 * - `--merge <start> <lane>...`: instead of previewing, adds the differences of parallel runs that
 *   started from `<start>` and writes `<out>/neural-model-import.json` with `<start>` as its base
 * - `--write-archetypes <dir>`: only writes the synthetic archetype projects (`spa`, `next`) and
 *   prints their plan; install their dependencies there before running it
 *
 * Copying `<out>/neural-model-import.json` into the extension's global storage directory makes the
 * next Page Inspector panel add the trained difference to the profile model.
 *
 * Only one compiler worker (up to the interactive 4 GiB heap) is alive at a time: the previous
 * project's worker shuts down when the round-robin moves on. A page that fails because the machine
 * was starved (Chromium terminal timeout, compiler watchdog/queue/memory stall) is retried once
 * after the other pages instead of being recorded as finished.
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import {
  createEmptyPreviewInspectorNeuralModel,
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from '../../presentation/previewInspectorNeuralModelProtocol';
import { PreviewBuildStalledError } from '../../domain/previewBuildExecution';
import { PreviewCompilerWorkerClient } from '../worker/previewCompilerWorkerClient';
import { PREVIEW_INTERACTIVE_WORKER_OLD_GENERATION_LIMIT_MB } from '../worker/previewCompilerWorkerIsolation';
import { renderCompiledPreviewHeadlessly } from './previewHeadlessRenderer';
import { writePreviewNeuralArchetypes } from './previewNeuralPretrainingArchetypes';
import {
  isPreviewPretrainingEnvironmentalFailure,
  lowerPreviewPretrainingPriority,
  PREVIEW_PRETRAINING_DEFAULT_GOVERNOR_POLICY,
  PREVIEW_PRETRAINING_DEFAULT_NICENESS,
  waitForPreviewPretrainingCapacity,
} from './previewNeuralPretrainingGovernor';
import {
  createPreviewNeuralPretrainingImport,
  mergePreviewNeuralPretrainingLanes,
  runPreviewNeuralPretraining,
  type PreviewNeuralPretrainingRow,
  type PreviewNeuralPretrainingWorkspace,
} from './previewNeuralPretraining';

/**
 * Runs or resumes one pre-training run.
 *
 * @param argv Command-line arguments after the script path.
 * @returns Process exit code.
 */
export async function runPreviewNeuralPretrainingCli(argv: readonly string[]): Promise<number> {
  const readOption = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index < 0 ? undefined : argv[index + 1];
  };
  const archetypeRoot = readOption('--write-archetypes');
  if (archetypeRoot !== undefined) {
    const workspaces = await writePreviewNeuralArchetypes(path.resolve(archetypeRoot));
    process.stdout.write(`${JSON.stringify({ workspaces }, undefined, 2)}\n`);
    return 0;
  }
  const mergeIndex = argv.indexOf('--merge');
  if (mergeIndex >= 0) {
    const mergeOutput = readOption('--out');
    const mergeArguments = argv.slice(mergeIndex + 1);
    const optionIndex = mergeArguments.findIndex((value) => value.startsWith('--'));
    const [startPath, ...lanePaths] =
      optionIndex < 0 ? mergeArguments : mergeArguments.slice(0, optionIndex);
    if (mergeOutput === undefined || startPath === undefined || lanePaths.length === 0) {
      process.stderr.write('usage: --merge <start> <lane>... --out <dir>\n');
      return 2;
    }
    const start = await readModel(startPath);
    const merged = mergePreviewNeuralPretrainingLanes(
      start,
      await Promise.all(lanePaths.map((lanePath) => readModel(lanePath))),
    );
    await mkdir(mergeOutput, { recursive: true });
    await writeFile(
      path.join(mergeOutput, 'neural-model-import.json'),
      `${JSON.stringify(createPreviewNeuralPretrainingImport(start, merged))}\n`,
      'utf8',
    );
    process.stdout.write(
      `merged ${String(lanePaths.length)} lanes: ${String(merged.updates)} updates\n`,
    );
    return 0;
  }
  const planPath = readOption('--plan');
  const outputRoot = readOption('--out');
  if (planPath === undefined || outputRoot === undefined) {
    process.stderr.write('usage: --plan <file> --out <dir> [--base <file>] [--store <dir>]\n');
    return 2;
  }
  const workspaces = readWorkspaces(JSON.parse(await readFile(planPath, 'utf8')) as unknown);
  const basePath = readOption('--base');
  const base =
    basePath === undefined ? createEmptyPreviewInspectorNeuralModel() : await readModel(basePath);
  const progressPath = path.join(outputRoot, 'progress.jsonl');
  const checkpointPath = path.join(outputRoot, 'checkpoint.json');
  await mkdir(outputRoot, { recursive: true });
  const completed = existsSync(progressPath)
    ? new Set(
        (await readFile(progressPath, 'utf8'))
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as PreviewNeuralPretrainingRow)
          .map((row) => `${row.workspace}:${row.page}`),
      )
    : new Set<string>();
  const start = existsSync(checkpointPath) ? await readModel(checkpointPath) : base;
  const storeRoot = readOption('--store');
  const workerPath = path.resolve(readOption('--worker') ?? 'dist/previewCompilerWorker.js');
  const niceness = lowerPreviewPretrainingPriority(
    Number(readOption('--nice') ?? PREVIEW_PRETRAINING_DEFAULT_NICENESS),
  );
  const pauseLoadRatio = Number(
    readOption('--max-load') ?? PREVIEW_PRETRAINING_DEFAULT_GOVERNOR_POLICY.pauseLoadRatio,
  );
  const policy = {
    ...PREVIEW_PRETRAINING_DEFAULT_GOVERNOR_POLICY,
    pauseLoadRatio,
    resumeLoadRatio: pauseLoadRatio * 0.75,
  };
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };
  log(
    `governor: niceness ${String(niceness ?? 'unknown')}, pause load ratio ${String(pauseLoadRatio)}`,
  );
  let pausedMs = 0;
  let retries = 0;
  const compilers = new Map<string, PreviewCompilerWorkerClient>();
  try {
    const trained = await runPreviewNeuralPretraining({
      base: start,
      beforePage: async () => {
        if (pauseLoadRatio <= 0) return;
        pausedMs += await waitForPreviewPretrainingCapacity({
          log: (message) => {
            log(`governor ${message}`);
          },
          policy,
        });
      },
      chunkSize: Number(readOption('--chunk') ?? 10),
      completed,
      isRetryable: isPreviewPretrainingEnvironmentalFailure,
      onRetry: (row) => {
        retries += 1;
        log(`${row.workspace} ${row.status} (retry later) ${row.page}`);
      },
      onPage: async (row, model) => {
        await appendFile(progressPath, `${JSON.stringify(row)}\n`, 'utf8');
        await writeFile(checkpointPath, JSON.stringify(model), 'utf8');
        process.stdout.write(
          `${row.workspace} ${row.status} ${JSON.stringify(row.learned)} ${row.page}\n`,
        );
      },
      previewPage: async (workspace, page, model) => {
        let compiler = compilers.get(workspace.root);
        if (compiler === undefined) {
          // One live worker: each keeps its project's caches in a heap of up to 4 GiB.
          await Promise.all([...compilers.values()].map((previous) => previous.shutdown()));
          compilers.clear();
          compiler = new PreviewCompilerWorkerClient(workerPath, {
            bundledNodeModulesPath: path.resolve('node_modules'),
            ...(storeRoot === undefined
              ? {}
              : { managedDependencyStoreRoot: path.resolve(storeRoot) }),
            maxOldGenerationSizeMb: PREVIEW_INTERACTIVE_WORKER_OLD_GENERATION_LIMIT_MB,
          });
          compilers.set(workspace.root, compiler);
        }
        const request = await createRequest(workspace, page);
        let bundle;
        try {
          bundle = await compiler.compile(request);
        } catch (error) {
          return {
            status:
              error instanceof PreviewBuildStalledError && error.reason !== 'frontier-mismatch'
                ? 'build-stalled'
                : 'build-failed',
          };
        }
        const result = await renderCompiledPreviewHeadlessly(bundle, request, {
          neuralResidualModel: model,
          timeoutMs: 60_000,
        });
        return {
          ...(result.neuralResidualModel === undefined
            ? {}
            : { model: result.neuralResidualModel }),
          status: `${result.status}/${result.stabilizedOutcome ?? 'none'}`,
        };
      },
      workspaces,
    });
    await writeFile(
      path.join(outputRoot, 'neural-model-import.json'),
      `${JSON.stringify(createPreviewNeuralPretrainingImport(base, trained))}\n`,
      'utf8',
    );
    log(
      `governor: paused ${String(Math.round(pausedMs / 1_000))} s, retried ${String(retries)} pages`,
    );
  } finally {
    await Promise.all([...compilers.values()].map((compiler) => compiler.shutdown()));
  }
  return 0;
}

/** Validates the plan's workspace list. */
function readWorkspaces(value: unknown): readonly PreviewNeuralPretrainingWorkspace[] {
  const workspaces = (value as { readonly workspaces?: unknown }).workspaces;
  if (!Array.isArray(workspaces)) throw new Error('The plan needs a "workspaces" array.');
  return workspaces.map((entry: unknown) => {
    const { name, pages, root } = entry as Record<string, unknown>;
    if (
      typeof name !== 'string' ||
      typeof root !== 'string' ||
      !Array.isArray(pages) ||
      !pages.every((page) => typeof page === 'string')
    )
      throw new Error('Each workspace needs a name, an absolute root, and page paths.');
    return { name, pages, root: path.resolve(root) };
  });
}

/** Reads and validates one model file. */
async function readModel(filePath: string): Promise<PreviewInspectorNeuralModel> {
  const model = readPreviewInspectorNeuralModel(JSON.parse(await readFile(filePath, 'utf8')));
  if (model === undefined) throw new Error(`${filePath} is not a Page Inspector neural model.`);
  return model;
}

/** Builds the Page Inspector request the extension sends for one saved page file. */
async function createRequest(
  workspace: PreviewNeuralPretrainingWorkspace,
  page: string,
): Promise<PreviewBuildRequest> {
  const documentPath = path.resolve(workspace.root, page);
  const extension = path.extname(documentPath).slice(1);
  return {
    dependencySnapshots: [],
    documentPath,
    language: extension === 'tsx' || extension === 'ts' || extension === 'jsx' ? extension : 'js',
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    sourceText: await readFile(documentPath, 'utf8'),
    useStorybookPreview: true,
    workspaceRoot: workspace.root,
  };
}
