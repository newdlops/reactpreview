import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreviewHeadlessTsxCorpusTriage } from './previewHeadlessTsxCorpusTriage';

/** Executes the source-only blocker/Unrendered triage command. */
export async function runPreviewHeadlessTsxCorpusTriageCli(
  arguments_: readonly string[],
): Promise<number> {
  if (arguments_[0] !== 'triage') {
    throw new Error(`Unknown TSX corpus triage command: ${arguments_[0] ?? '<missing>'}`);
  }
  const values = parseArguments(arguments_.slice(1));
  const selectionStrategy = parseSelectionStrategy(values.get('--strategy')?.[0]);
  const artifact = await runPreviewHeadlessTsxCorpusTriage({
    cap: parsePositiveInteger(requireSingle(values, '--cap'), '--cap'),
    histories: values.get('--history') ?? [],
    manifestPath: path.resolve(requireSingle(values, '--manifest')),
    outputPath: path.resolve(requireSingle(values, '--output')),
    selectionStrategy,
    sourceRoot: path.resolve(requireSingle(values, '--source-root')),
  });
  process.stdout.write(
    `${JSON.stringify({
      knownBlockerRecall: artifact.summary.knownBlockerRecall,
      knownBlockers: artifact.summary.knownBlockers,
      knownUnrendered: artifact.summary.knownUnrendered,
      multiLayerPotentialRows: artifact.summary.multiLayerPotentialRows,
      mode: artifact.mode,
      observedBlockerRecall: artifact.summary.observedBlockerRecall,
      output: path.resolve(requireSingle(values, '--output')),
      potentialBlockerRows: artifact.summary.potentialBlockerRows,
      potentialBlockerSites: artifact.summary.potentialBlockerSites,
      scanRatePerMinute: artifact.scan.ratePerMinute,
      selectionStrategy: artifact.selection.strategy ?? 'complete-history',
      selectedRows: artifact.summary.selectedRows,
      totalRatePerMinute: artifact.total.ratePerMinute,
    })}\n`,
  );
  return 0;
}

/** Parses repeatable history inputs and singleton corpus inputs. */
function parseArguments(arguments_: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const allowed = new Set([
    '--cap',
    '--history',
    '--manifest',
    '--output',
    '--source-root',
    '--strategy',
  ]);
  const values = new Map<string, string[]>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || !allowed.has(name)) {
      throw new Error(`Unknown TSX corpus triage argument: ${name ?? '<missing>'}`);
    }
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    if (name !== '--history' && values.has(name)) {
      throw new Error(`Duplicate TSX corpus triage argument: ${name}`);
    }
    const existing = values.get(name) ?? [];
    existing.push(value);
    values.set(name, existing);
  }
  return values;
}

/** Returns one required singleton CLI value. */
function requireSingle(values: ReadonlyMap<string, readonly string[]>, name: string): string {
  const value = values.get(name)?.[0];
  if (value === undefined) throw new Error(`Missing required TSX corpus triage argument: ${name}`);
  return value;
}

/** Parses a bounded later by the triage engine positive integer argument. */
function parsePositiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer.`);
  return parsed;
}

/** Keeps complete historical recall as the compatibility default. */
function parseSelectionStrategy(
  value: string | undefined,
): 'complete-history' | 'representative-history' {
  if (value === undefined || value === 'complete-history') return 'complete-history';
  if (value === 'representative-history') return value;
  throw new Error('--strategy must be complete-history or representative-history.');
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runPreviewHeadlessTsxCorpusTriageCli(process.argv.slice(2));
}
