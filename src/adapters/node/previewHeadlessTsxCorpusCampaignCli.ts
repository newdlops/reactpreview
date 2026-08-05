import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calibratePreviewHeadlessTsxCorpusCampaign,
  acceleratePreviewHeadlessTsxCorpusCampaign,
  runPreviewHeadlessTsxCorpusCampaign,
  verifyPreviewHeadlessTsxCorpusCampaign,
} from './previewHeadlessTsxCorpusCampaign';
import {
  runPreviewHeadlessTsxCorpusCompilerLane,
  runPreviewHeadlessTsxCorpusLane,
  runPreviewHeadlessTsxCorpusWorker,
} from './previewHeadlessTsxCorpusCampaignWorker';

/** Parses and executes the closed corpus campaign command contract. */
export async function runPreviewHeadlessTsxCorpusCampaignCli(
  arguments_: readonly string[],
  runtimePath: string,
): Promise<number> {
  const command = arguments_[0];
  if (command === '__worker') {
    const encodedSpec = arguments_[1];
    if (encodedSpec === undefined || arguments_.length !== 2) {
      throw new Error('Worker mode requires exactly one encoded attempt spec.');
    }
    return runPreviewHeadlessTsxCorpusWorker(encodedSpec);
  }
  if (command === '__lane') {
    if (arguments_.length !== 1) throw new Error('Lane mode accepts commands only through stdin.');
    return runPreviewHeadlessTsxCorpusLane();
  }
  if (command === '__v12-compiler-lane') {
    if (arguments_.length !== 1) throw new Error('v12 compiler-lane mode accepts commands only through stdin.');
    return runPreviewHeadlessTsxCorpusCompilerLane();
  }
  if (command === 'verify') {
    const values = parseNamedArguments(arguments_.slice(1));
    await verifyPreviewHeadlessTsxCorpusCampaign({
      baseline: path.resolve(requireValue(values, '--baseline')),
      final: path.resolve(requireValue(values, '--final')),
      manifestPath: path.resolve(requireValue(values, '--manifest')),
      policyPath: path.resolve(requireValue(values, '--policy')),
      report: path.resolve(requireValue(values, '--report')),
    });
    return 0;
  }
  if (command !== 'run' && command !== 'calibrate' && command !== 'accelerate')
    throw new Error(`Unknown corpus campaign command: ${command ?? '<missing>'}`);
  const values = parseNamedArguments(arguments_.slice(1));
  if (command === 'calibrate') {
    if (requireValue(values, '--candidates') !== '12,14,16') throw new Error('--candidates must be exactly 12,14,16.');
    await calibratePreviewHeadlessTsxCorpusCampaign({
      artifacts: path.resolve(requireValue(values, '--artifacts')),
      chromiumPath: path.resolve(requireValue(values, '--chromium')),
      manifestPath: path.resolve(requireValue(values, '--manifest')),
      runtimePath: path.resolve(runtimePath),
      sourceRoot: path.resolve(requireValue(values, '--source-root')),
      windowRows: parsePositiveInteger(requireValue(values, '--window-rows'), '--window-rows'),
      windowStart: parseNonnegativeInteger(requireValue(values, '--window-start'), '--window-start'),
      workspace: path.resolve(requireValue(values, '--workspace')),
    });
    return 0;
  }
  if (command === 'accelerate') {
    if (requireValue(values, '--candidates') !== '12x4,14x4,16x5') throw new Error('--candidates must be exactly 12x4,14x4,16x5.');
    const chunkRows = parsePositiveInteger(requireValue(values, '--chunk-rows'), '--chunk-rows');
    if (chunkRows !== 8) throw new Error('--chunk-rows must be exactly 8.');
    await acceleratePreviewHeadlessTsxCorpusCampaign({
      artifacts: path.resolve(requireValue(values, '--artifacts')),
      chromiumPath: path.resolve(requireValue(values, '--chromium')),
      candidates: '12x4,14x4,16x5', chunkRows,
      manifestPath: path.resolve(requireValue(values, '--manifest')),
      runtimePath: path.resolve(runtimePath), sourceRoot: path.resolve(requireValue(values, '--source-root')),
      windowRows: parsePositiveInteger(requireValue(values, '--window-rows'), '--window-rows'),
      windowStart: parseNonnegativeInteger(requireValue(values, '--window-start'), '--window-start'), workspace: path.resolve(requireValue(values, '--workspace')),
    });
    return 0;
  }
  const phase = requireValue(values, '--phase');
  if (phase !== 'baseline' && phase !== 'final') throw new Error('--phase must be baseline or final.');
  const policyPath = path.resolve(requireValue(values, '--policy'));
  const maxRowsValue = values.get('--max-rows');
  const maxRows = maxRowsValue === undefined ? undefined : parsePositiveInteger(maxRowsValue, '--max-rows');
  await runPreviewHeadlessTsxCorpusCampaign({
    artifacts: path.resolve(requireValue(values, '--artifacts')),
    chromiumPath: path.resolve(requireValue(values, '--chromium')),
    manifestPath: path.resolve(requireValue(values, '--manifest')),
    ...(maxRows === undefined ? {} : { maxRows }),
    phase,
    policyPath,
    runtimePath: path.resolve(runtimePath),
    sourceRoot: path.resolve(requireValue(values, '--source-root')),
    workspace: path.resolve(requireValue(values, '--workspace')),
  });
  return 0;
}

function parseNamedArguments(arguments_: readonly string[]): ReadonlyMap<string, string> {
  const allowed = new Set([
    '--artifacts',
    '--baseline',
    '--chromium',
    '--chunk-rows',
    '--candidates',
    '--isolation-jobs',
    '--jobs',
    '--manifest',
    '--max-isolated-attempts',
    '--max-rows',
    '--outer-deadline-ms',
    '--policy',
    '--report',
    '--phase',
    '--source-root',
    '--window-rows',
    '--window-start',
    '--workspace',
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || !allowed.has(name)) throw new Error(`Unknown campaign argument: ${name ?? '<missing>'}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    if (values.has(name)) throw new Error(`Duplicate campaign argument: ${name}`);
    values.set(name, value);
  }
  return values;
}

function requireValue(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) throw new Error(`Missing required campaign argument: ${name}`);
  return value;
}

function assertExactInteger(
  values: ReadonlyMap<string, string>,
  name: string,
  expected: number,
): void {
  const value = requireValue(values, name);
  if (parsePositiveInteger(value, name) !== expected) {
    throw new Error(`${name} must be exactly ${expected}.`);
  }
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer.`);
  return parsed;
}

function parseNonnegativeInteger(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a non-negative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer.`);
  return parsed;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runPreviewHeadlessTsxCorpusCampaignCli(
    process.argv.slice(2),
    fileURLToPath(import.meta.url),
  );
}
