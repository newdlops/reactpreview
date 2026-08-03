import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreviewHeadlessTsxCorpusCampaign } from './previewHeadlessTsxCorpusCampaign';
import { runPreviewHeadlessTsxCorpusWorker } from './previewHeadlessTsxCorpusCampaignWorker';

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
  if (command !== 'run') throw new Error(`Unknown corpus campaign command: ${command ?? '<missing>'}`);
  const values = parseNamedArguments(arguments_.slice(1));
  const phase = requireValue(values, '--phase');
  if (phase !== 'baseline' && phase !== 'final') throw new Error('--phase must be baseline or final.');
  assertExactInteger(values, '--jobs', 3);
  assertExactInteger(values, '--isolation-jobs', 1);
  assertExactInteger(values, '--max-isolated-attempts', 1);
  assertExactInteger(values, '--outer-deadline-ms', 90_000);
  const maxRowsValue = values.get('--max-rows');
  const maxRows = maxRowsValue === undefined ? undefined : parsePositiveInteger(maxRowsValue, '--max-rows');
  await runPreviewHeadlessTsxCorpusCampaign({
    artifacts: path.resolve(requireValue(values, '--artifacts')),
    chromiumPath: path.resolve(requireValue(values, '--chromium')),
    manifestPath: path.resolve(requireValue(values, '--manifest')),
    ...(maxRows === undefined ? {} : { maxRows }),
    phase,
    runtimePath: path.resolve(runtimePath),
    sourceRoot: path.resolve(requireValue(values, '--source-root')),
    workspace: path.resolve(requireValue(values, '--workspace')),
  });
  return 0;
}

function parseNamedArguments(arguments_: readonly string[]): ReadonlyMap<string, string> {
  const allowed = new Set([
    '--artifacts',
    '--chromium',
    '--isolation-jobs',
    '--jobs',
    '--manifest',
    '--max-isolated-attempts',
    '--max-rows',
    '--outer-deadline-ms',
    '--phase',
    '--source-root',
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

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runPreviewHeadlessTsxCorpusCampaignCli(
    process.argv.slice(2),
    fileURLToPath(import.meta.url),
  );
}
