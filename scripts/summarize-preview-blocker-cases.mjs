#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const MARKER = 'React preview blocker trace';
const PROTOCOL_MARKER = 'PREVIEW_BLOCKER_TRACE';
const LIMIT = 2 * 1024 * 1024;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const CATEGORY_VALUES = new Set([
  'build',
  'data',
  'environment',
  'navigation',
  'provider',
  'render',
  'runtime',
  'unsupported',
]);
const OUTCOME_VALUES = new Set([
  'auto-resolved',
  'prevented',
  'rejected',
  'report-only',
  'rolled-back',
  'unavailable',
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
async function expand(inputs) {
  const files = new Set();
  async function visit(input, explicit) {
    try {
      await access(input);
    } catch {
      throw new Error(`Cannot read input: ${input}`);
    }
    const stat = await lstat(input);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (explicit || input.endsWith('.log')) files.add(path.resolve(input));
      return;
    }
    if (!stat.isDirectory()) throw new Error(`Unreadable input: ${input}`);
    for (const name of (await readdir(input)).sort()) await visit(path.join(input, name), false);
  }
  for (const input of inputs) await visit(input, true);
  return [...files].sort();
}
async function records(file, malformed) {
  const result = [];
  let armed = false;
  let collecting = false;
  let text = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  const markerOutsideQuoted = (line) => {
    let inString = collecting ? quoted : false;
    let escapedCharacter = collecting ? escaped : false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (inString) {
        if (escapedCharacter) escapedCharacter = false;
        else if (character === '\\') escapedCharacter = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      for (const marker of [MARKER, PROTOCOL_MARKER]) {
        if (line.startsWith(marker, index)) return { index, marker };
      }
    }
    return undefined;
  };
  const consume = (chunk) => {
    for (const char of chunk) {
      if (!collecting) {
        if (armed && char === '{') {
          collecting = true;
          text = '{';
          depth = 1;
          quoted = false;
          escaped = false;
        }
        continue;
      }
      text += char;
      if (text.length > LIMIT) {
        malformed.count++;
        armed = false;
        collecting = false;
        text = '';
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(text);
          if (value.format === 'react-preview-blocker-trace/v1') result.push(value);
          else malformed.count++;
        } catch {
          malformed.count++;
        }
        collecting = false;
        armed = false;
        text = '';
      }
    }
  };
  for await (const line of readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })) {
    const marker = markerOutsideQuoted(line);
    if (marker !== undefined) {
      if (collecting) malformed.count++;
      collecting = false;
      armed = true;
      text = '';
      consume(line.slice(marker.index + marker.marker.length));
    } else if (armed) consume(`${line}\n`);
  }
  if (collecting) malformed.count++;
  return result;
}
function clean(value) {
  return String(value ?? '')
    .replace(
      /(?:file:\/\/|vscode-resource:\/\/|https?:\/\/)[^,;\r\n)\]}>,'"`]+(?=[,;\r\n)\]}>,'"`]|$)/giu,
      '[resource]',
    )
    .replace(/[A-Za-z]:\\[^,;\r\n]+/gu, '[path]')
    .replace(/\/(?:[^,;\r\n]+\/)+[^,;\r\n]+/gu, '[path]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu, '[id]')
    .replace(/(?<![0-9a-f])\b[A-Za-z][A-Za-z0-9_-]*-[0-9a-f]{8,}\b/giu, '[id]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b[0-9a-f]{16,}\b/giu, '[id]')
    .replace(/:\d+(?::\d+)?\b/gu, '')
    .slice(0, 500);
}
function targetIdentity(target) {
  if (typeof target === 'string' && target.length > 0) return target;
  if (target === null || typeof target !== 'object') return undefined;
  const entries = Object.entries(target)
    .filter(
      ([key, value]) =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? JSON.stringify(entries) : undefined;
}
function sorted(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function main(records, fileCount, malformedRecords) {
  const events = new Map(),
    blockerKinds = new Map(),
    blockerCategories = new Map(),
    blockerOutcomes = new Map(),
    autoModes = new Map(),
    renderOutcomes = new Map();
  const artifacts = new Set(),
    sessions = new Set(),
    targets = new Set(),
    traces = new Map();
  let unresolved = 0;
  for (const record of records) {
    const event = record.event ?? record.type;
    increment(events, event);
    if (record.artifactId) artifacts.add(record.artifactId);
    if (record.runtimeSessionId) sessions.add(record.runtimeSessionId);
    const target = targetIdentity(record.previewTarget ?? record.target);
    if (target !== undefined) targets.add(target);
    const blocker = record.blocker;
    if (blocker?.kind) increment(blockerKinds, blocker.kind);
    if (blocker?.category) increment(blockerCategories, blocker.category);
    if (blocker?.outcome) increment(blockerOutcomes, blocker.outcome);
    const auto = record.auto;
    if (auto?.mode) increment(autoModes, auto.mode);
    const outcome = record.result?.outcome ?? record.outcome;
    if (event === 'render-result' && outcome) {
      increment(renderOutcomes, outcome);
      if ((record.result?.remainingBlockerIds ?? []).length > 0) unresolved++;
    }
    const key = [record.runtimeSessionId, record.artifactId, record.traceId].join('\0');
    (traces.get(key) ?? traces.set(key, []).get(key)).push(record);
  }
  const regression = new Map(),
    standalone = new Map();
  for (const [tuple, trace] of traces) {
    trace.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
    for (let errorIndex = 0; errorIndex < trace.length; errorIndex++) {
      const error = trace[errorIndex];
      if ((error.event ?? error.type) !== 'subsequent-error') continue;
      let selection;
      let selectionIndex = -1;
      for (let index = errorIndex - 1; index >= 0; index--) {
        const candidate = trace[index];
        // Host records omit the browser-only attempt flag; this tuple/trace is the causal lifecycle.
        if ((candidate.event ?? candidate.type) === 'auto-selection') {
          selection = candidate;
          selectionIndex = index;
          break;
        }
      }
      const source = clean(error.error?.source);
      const message = clean(error.error?.message);
      const committed = trace
        .slice(selectionIndex + 1, errorIndex)
        .some(
          (r) =>
            (r.event ?? r.type) === 'render-result' &&
            (r.result?.outcome ?? r.outcome) === 'committed',
        );
      const key = selection
        ? [
            committed ? 'late-fatal-after-commit' : 'fatal-during-auto-attempt',
            selection.auto?.mode,
            source,
            message,
          ]
        : [source, message];
      const map = selection ? regression : standalone;
      const old =
        map.get(key.join('\0')) ??
        (selection
          ? {
              classification: key[0],
              autoMode: key[1],
              errorSource: source,
              message,
              occurrenceCount: 0,
              traceCount: 0,
              targetCount: 0,
              _traces: new Set(),
              _targets: new Set(),
            }
          : {
              errorSource: source,
              message,
              occurrenceCount: 0,
              _traces: new Set(),
            });
      old.occurrenceCount++;
      old._traces.add(tuple);
      if (selection) {
        const target = targetIdentity(
          selection.previewTarget ?? selection.target ?? error.previewTarget ?? error.target,
        );
        if (target !== undefined) old._targets.add(target);
        old.traceCount = old._traces.size;
        old.targetCount = old._targets.size;
      }
      map.set(key.join('\0'), old);
    }
  }
  const groups = (map) =>
    [...map.values()]
      .map(({ _traces, _targets, ...value }) => value)
      .sort((a, b) =>
        [a.classification ?? '', a.autoMode ?? '', a.errorSource, a.message]
          .join('\0')
          .localeCompare(
            [b.classification ?? '', b.autoMode ?? '', b.errorSource, b.message].join('\0'),
          ),
      );
  const normalized =
    blockerCategories.size > 0 || blockerOutcomes.size > 0
      ? { blockerCategories: sorted(blockerCategories), blockerOutcomes: sorted(blockerOutcomes) }
      : undefined;
  return {
    format: 'react-preview-blocker-cases/v1',
    inputs: { fileCount, parsedRecords: records.length, malformedRecords },
    scope: {
      artifactCount: artifacts.size,
      runtimeSessionCount: sessions.size,
      targetCount: targets.size,
    },
    counts: {
      events: sorted(events),
      blockerKinds: sorted(blockerKinds),
      autoModes: sorted(autoModes),
      renderOutcomes: sorted(renderOutcomes),
      renderResultsWithRemainingBlockers: unresolved,
      ...(normalized === undefined ? {} : normalized),
    },
    regressionCases: groups(regression),
    standaloneErrors: groups(standalone),
  };
}
/** Creates private manifest-bound scenario evidence without revealing manifest target paths. */
function manifestBoundEvidence(summary, records, manifestBytes) {
  const manifest = JSON.parse(manifestBytes);
  if (
    !Array.isArray(manifest?.targets) ||
    !Array.isArray(manifest?.commands) ||
    manifest.commands.length === 0 ||
    !manifest.commands.every((command) => typeof command === 'string' && command.length > 0) ||
    new Set(manifest.commands).size !== manifest.commands.length
  )
    throw new Error('Campaign manifest is invalid.');
  const manifestSha256 = sha256(manifestBytes);
  const scenarioOutcomes = manifest.targets.flatMap((target, targetOrdinal) =>
    manifest.commands.map((command) => {
      const id = sha256(JSON.stringify({ command, manifestSha256, targetOrdinal }));
      const events = records.filter(
        (record) => record.previewTarget === target.sourcePath && record.previewCommand === command,
      );
      const observed = events.length > 0;
      const unresolved = events.some(
        (record) => (record.result?.remainingBlockerIds ?? []).length > 0,
      );
      const blocker = [...events].reverse().find((record) => record.blocker?.category)?.blocker;
      const category = CATEGORY_VALUES.has(blocker?.category) ? blocker.category : 'unsupported';
      const outcome = !observed
        ? 'unavailable'
        : unresolved
          ? 'report-only'
          : OUTCOME_VALUES.has(blocker?.outcome)
            ? blocker.outcome
            : 'auto-resolved';
      return { category, id, outcome, unresolved: unresolved || !observed };
    }),
  );
  const categoryOutcomeCounts = {};
  for (const scenario of scenarioOutcomes) {
    const key = `${scenario.category}\0${scenario.outcome}`;
    categoryOutcomeCounts[key] = (categoryOutcomeCounts[key] ?? 0) + 1;
  }
  const scenarioIds = scenarioOutcomes.map((scenario) => scenario.id);
  const healthyScenarioIds = scenarioOutcomes
    .filter((scenario) => !scenario.unresolved)
    .map((scenario) => scenario.id);
  const unresolvedScenarioCount = scenarioOutcomes.length - healthyScenarioIds.length;
  if (
    new Set(scenarioIds).size !== scenarioIds.length ||
    healthyScenarioIds.length + unresolvedScenarioCount !== scenarioIds.length ||
    Object.values(categoryOutcomeCounts).reduce((total, count) => total + count, 0) !==
      scenarioIds.length
  )
    throw new Error('Campaign scenario evidence is incomplete.');
  return {
    ...summary,
    format: 'react-preview-blocker-cases/v2',
    manifestSha256,
    scenarioIds: scenarioIds.sort(),
    healthyScenarioIds: healthyScenarioIds.sort(),
    counts: {
      ...summary.counts,
      unresolvedScenarioCount,
    },
    normalized: { categoryOutcomeCounts },
    scenarioOutcomes: scenarioOutcomes.map(({ id, category, outcome, unresolved }) => ({
      category,
      id,
      outcome,
      unresolved,
    })),
  };
}

const arguments_ = process.argv.slice(2);
const manifestIndex = arguments_.indexOf('--manifest');
const manifestPath = manifestIndex < 0 ? undefined : arguments_[manifestIndex + 1];
const inputs =
  manifestIndex < 0
    ? arguments_
    : arguments_.filter((value, index) => index !== manifestIndex && index !== manifestIndex + 1);
if (inputs.length === 0 || (manifestIndex >= 0 && !manifestPath))
  fail(
    'Usage: summarize-preview-blocker-cases [--manifest frozen-manifest.json] <log file or directory> [...]',
  );
else {
  try {
    const files = await expand(inputs);
    if (!files.length) throw new Error('No readable log files.');
    const malformed = { count: 0 };
    const parsed = (await Promise.all(files.map((file) => records(file, malformed)))).flat();
    const summary = main(parsed, files.length, malformed.count);
    const evidence =
      manifestPath === undefined
        ? summary
        : manifestBoundEvidence(summary, parsed, await readFile(manifestPath));
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Cannot read inputs.');
  }
}
