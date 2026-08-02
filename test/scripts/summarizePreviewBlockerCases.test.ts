import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const script = path.resolve('scripts/summarize-preview-blocker-cases.mjs');
interface CensusGroup {
  readonly autoMode?: string;
  readonly classification?: string;
  readonly errorSource?: string;
  readonly message?: string;
  readonly occurrenceCount: number;
}
interface CensusSummary {
  readonly format: string;
  readonly inputs: {
    readonly fileCount: number;
    readonly malformedRecords: number;
    readonly parsedRecords: number;
  };
  readonly scope: {
    readonly artifactCount: number;
    readonly runtimeSessionCount: number;
    readonly targetCount: number;
  };
  readonly counts: {
    readonly autoModes: Record<string, number>;
    readonly blockerKinds: Record<string, number>;
    readonly events: Record<string, number>;
    readonly renderResultsWithRemainingBlockers: number;
    readonly renderOutcomes: Record<string, number>;
  };
  readonly regressionCases: readonly CensusGroup[];
  readonly standaloneErrors: readonly CensusGroup[];
}

/** Narrows the local CLI JSON fixture to the fields asserted by this test. */
function parseSummary(text: string): CensusSummary {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid census result.');
  const record = value as Record<string, unknown>;
  if (
    record.format !== 'react-preview-blocker-cases/v1' ||
    !Array.isArray(record.regressionCases) ||
    !Array.isArray(record.standaloneErrors) ||
    record.inputs === null ||
    typeof record.inputs !== 'object' ||
    record.counts === null ||
    typeof record.counts !== 'object'
  )
    throw new TypeError('Invalid census result.');
  return record as unknown as CensusSummary;
}

/** Creates one host-schema trace record for a temporary log fixture. */
function trace(event: string, extra: Record<string, unknown> = {}): string {
  return `React preview blocker trace\n${JSON.stringify({
    artifactId: 'artifact-12345678',
    event,
    format: 'react-preview-blocker-trace/v1',
    runtimeSessionId: 'session-12345678',
    previewTarget: '/private/path with spaces/Target.tsx',
    target: { exportName: 'Target' },
    traceId: 'trace-1',
    ...extra,
  })}\n`;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe('summarize-preview-blocker-cases', () => {
  /** Binds one private scenario ID to each frozen target without disclosing its source path. */
  it('emits v2 manifest-bound scenario outcomes with redacted target identities', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    const target = path.join(directory, 'PillList.tsx');
    const manifest = path.join(directory, 'manifest.json');
    writeFileSync(
      path.join(directory, 'events.log'),
      trace('render-result', {
        blocker: { category: 'render', outcome: 'auto-resolved' },
        previewCommand: 'direct-preview',
        result: { outcome: 'committed', remainingBlockerIds: [] },
        previewTarget: target,
      }),
    );
    writeFileSync(
      manifest,
      JSON.stringify({
        commands: ['direct-preview', 'page-inspector'],
        targets: [{ sourceHash: 'a'.repeat(64), sourcePath: target }],
      }),
    );

    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [script, '--manifest', manifest, path.join(directory, 'events.log')],
        { encoding: 'utf8' },
      ),
    ) as Record<string, unknown>;

    expect(report.format).toBe('react-preview-blocker-cases/v2');
    expect(report.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.scenarioIds).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.stringMatching(/^[0-9a-f]{64}$/u),
    ]);
    expect(report.healthyScenarioIds).toHaveLength(1);
    expect((report.counts as { unresolvedScenarioCount: number }).unresolvedScenarioCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain(target);
  });

  /** A direct terminal failure remains unresolved even when its blocker outcome is report-only. */
  it('keeps direct terminal failure evidence out of the healthy v2 partition', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    const target = path.join(directory, 'BrokenDirect.tsx');
    const manifest = path.join(directory, 'manifest.json');
    writeFileSync(
      path.join(directory, 'events.log'),
      trace('subsequent-error', {
        blocker: { category: 'runtime', outcome: 'report-only' },
        previewCommand: 'direct-preview',
        previewTarget: target,
        result: { outcome: 'committed', remainingBlockerIds: ['direct-preview-terminal-failure'] },
      }),
    );
    writeFileSync(
      manifest,
      JSON.stringify({
        commands: ['direct-preview'],
        targets: [{ sourceHash: 'b'.repeat(64), sourcePath: target }],
      }),
    );

    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [script, '--manifest', manifest, path.join(directory, 'events.log')],
        { encoding: 'utf8' },
      ),
    ) as {
      readonly healthyScenarioIds: readonly string[];
      readonly scenarioOutcomes: readonly { outcome: string; unresolved: boolean }[];
    };
    expect(report.healthyScenarioIds).toEqual([]);
    expect(report.scenarioOutcomes).toEqual([
      expect.objectContaining({ category: 'runtime', outcome: 'report-only', unresolved: true }),
    ]);
  });

  it('aggregates bounded local traces deterministically without source or payload output', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    writeFileSync(
      path.join(directory, 'one.log'),
      trace('auto-selection', {
        auto: {
          generatedPaths: ['generated-secret-path'],
          mode: 'deterministic-minimum-auto',
          selectedValue: { secret: 'payload' },
        },
        blocker: { kind: 'target-reachability' },
        sequence: 1,
        sourceCode: 'source-code-secret',
      }) +
        trace('render-result', {
          result: { outcome: 'committed', remainingBlockerIds: ['blocker'] },
          sequence: 2,
        }) +
        'React preview blocker trace\n{bad\n',
    );
    writeFileSync(
      path.join(directory, 'two.log'),
      trace('subsequent-error', {
        error: {
          message: `Error at ${directory}/secret.ts:12:4; https://preview.invalid/${directory}`,
          source: 'preview-runtime',
        },
        sequence: 3,
      }) +
        trace('subsequent-error', {
          artifactId: 'other',
          blocker: { kind: 'target-error' },
          error: { message: 'standalone', source: 'console' },
          previewTarget: '/private/path with spaces/Other.tsx',
          target: { exportName: 'Other' },
          traceId: 'trace-2',
          sequence: 1,
        }),
    );
    /** Invokes the local CLI against this fixture directory. */
    const run = (): string =>
      execFileSync(process.execPath, [script, directory], { encoding: 'utf8' });
    const first = run();
    const report = parseSummary(first);
    expect(run()).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
    expect(report).toEqual({
      format: 'react-preview-blocker-cases/v1',
      inputs: { fileCount: 2, malformedRecords: 1, parsedRecords: 4 },
      scope: { artifactCount: 2, runtimeSessionCount: 1, targetCount: 2 },
      counts: {
        events: { 'auto-selection': 1, 'render-result': 1, 'subsequent-error': 2 },
        blockerKinds: { 'target-error': 1, 'target-reachability': 1 },
        autoModes: { 'deterministic-minimum-auto': 1 },
        renderOutcomes: { committed: 1 },
        renderResultsWithRemainingBlockers: 1,
      },
      regressionCases: [
        {
          autoMode: 'deterministic-minimum-auto',
          classification: 'late-fatal-after-commit',
          errorSource: 'preview-runtime',
          message: 'Error at [path]; [resource]',
          occurrenceCount: 1,
          targetCount: 1,
          traceCount: 1,
        },
      ],
      standaloneErrors: [{ errorSource: 'console', message: 'standalone', occurrenceCount: 1 }],
    });
    expect(first).not.toContain(directory);
    expect(first).not.toContain('payload');
    for (const secret of [
      'selectedValue',
      'sourceCode',
      'source-code-secret',
      'generatedPaths',
      'generated-secret-path',
      'previewTarget',
    ])
      expect(first).not.toContain(secret);
  });

  it('isolates host trace tuples and bounds commit classification to the selected causal interval', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    writeFileSync(
      path.join(directory, 'events.log'),
      [
        trace('subsequent-error', {
          error: { message: 'interval', source: 'runtime' },
          sequence: 9,
        }),
        trace('render-result', { result: { outcome: 'committed' }, sequence: 8 }),
        trace('auto-selection', { auto: { mode: 'auto' }, sequence: 7 }),
        trace('render-result', { result: { outcome: 'committed' }, sequence: 6 }),
        trace('subsequent-error', {
          error: { message: 'post-error', source: 'runtime' },
          sequence: 5,
        }),
        trace('auto-selection', { auto: { mode: 'auto' }, sequence: 4 }),
        trace('subsequent-error', {
          error: { message: 'pre-selection', source: 'runtime' },
          sequence: 3,
        }),
        trace('auto-selection', { auto: { mode: 'auto' }, sequence: 2 }),
        trace('render-result', { result: { outcome: 'committed' }, sequence: 1 }),
        trace('auto-selection', {
          artifactId: 'group-one',
          auto: { mode: 'smart' },
          previewTarget: undefined,
          sequence: 1,
          target: { exportName: 'Target', pageCandidateId: 'page-one' },
          traceId: 'shared-trace',
        }),
        trace('subsequent-error', {
          artifactId: 'group-one',
          error: { message: 'grouped', source: 'group-source' },
          previewTarget: undefined,
          sequence: 2,
          target: { exportName: 'Target', pageCandidateId: 'page-one' },
          traceId: 'shared-trace',
        }),
        trace('auto-selection', {
          artifactId: 'group-two',
          auto: { mode: 'smart' },
          previewTarget: undefined,
          sequence: 1,
          target: { pageCandidateId: 'page-one', exportName: 'Target' },
          traceId: 'shared-trace',
        }),
        trace('subsequent-error', {
          artifactId: 'group-two',
          error: { message: 'grouped', source: 'group-source' },
          previewTarget: undefined,
          sequence: 2,
          target: { pageCandidateId: 'page-one', exportName: 'Target' },
          traceId: 'shared-trace',
        }),
        trace('auto-selection', {
          artifactId: 'group-three',
          auto: { mode: 'smart' },
          previewTarget: undefined,
          runtimeSessionId: 'other-session',
          sequence: 1,
          target: { exportName: 'Other', pageCandidateId: 'page-two' },
          traceId: 'shared-trace',
        }),
        trace('subsequent-error', {
          artifactId: 'group-three',
          error: { message: 'grouped', source: 'group-source' },
          previewTarget: undefined,
          runtimeSessionId: 'other-session',
          sequence: 2,
          target: { exportName: 'Other', pageCandidateId: 'page-two' },
          traceId: 'shared-trace',
        }),
        trace('auto-selection', {
          artifactId: 'session-isolated',
          auto: { mode: 'auto' },
          sequence: 1,
          traceId: 'shared-trace',
        }),
        trace('subsequent-error', {
          artifactId: 'session-isolated',
          error: { message: 'reused-id-isolated', source: 'runtime' },
          runtimeSessionId: 'other-session',
          sequence: 2,
          traceId: 'shared-trace',
        }),
      ].join(''),
    );
    const report = parseSummary(
      execFileSync(process.execPath, [script, directory], { encoding: 'utf8' }),
    );
    expect(report.regressionCases).toEqual([
      {
        autoMode: 'auto',
        classification: 'fatal-during-auto-attempt',
        errorSource: 'runtime',
        message: 'post-error',
        occurrenceCount: 1,
        targetCount: 1,
        traceCount: 1,
      },
      {
        autoMode: 'auto',
        classification: 'fatal-during-auto-attempt',
        errorSource: 'runtime',
        message: 'pre-selection',
        occurrenceCount: 1,
        targetCount: 1,
        traceCount: 1,
      },
      {
        autoMode: 'smart',
        classification: 'fatal-during-auto-attempt',
        errorSource: 'group-source',
        message: 'grouped',
        occurrenceCount: 3,
        targetCount: 2,
        traceCount: 3,
      },
      {
        autoMode: 'auto',
        classification: 'late-fatal-after-commit',
        errorSource: 'runtime',
        message: 'interval',
        occurrenceCount: 1,
        targetCount: 1,
        traceCount: 1,
      },
    ]);
    expect(report.standaloneErrors).toEqual([
      { errorSource: 'runtime', message: 'reused-id-isolated', occurrenceCount: 1 },
    ]);
  });

  it('normalizes delimited resources and complete prefixed identifiers without leaking context', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    const message =
      'safe prefix; file:///private/path with spaces/secret.tsx:12:4; safe middle, artifact-aabbccddeeff0011, /private/other path/file.ts, C:\\work dir\\file.ts, 123e4567-e89b-12d3-a456-426614174000, aabbccddeeff0011, safe suffix';
    writeFileSync(
      path.join(directory, 'privacy.log'),
      trace('subsequent-error', { error: { message, source: 'preview-runtime' }, sequence: 1 }),
    );
    const report = parseSummary(
      execFileSync(process.execPath, [script, directory], { encoding: 'utf8' }),
    );
    expect(report.standaloneErrors).toEqual([
      {
        errorSource: 'preview-runtime',
        message:
          'safe prefix; [resource]; safe middle, [id], [path], [path], [id], [id], safe suffix',
        occurrenceCount: 1,
      },
    ]);
  });

  it('correlates host trace tuples in sequence order without the browser-only attempt flag', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    const records = [
      trace('render-result', { result: { outcome: 'committed' }, sequence: 1 }),
      trace('auto-selection', { auto: { mode: 'auto' }, sequence: 2 }),
      trace('subsequent-error', {
        error: { message: 'before selection', source: 'runtime' },
        sequence: 3,
      }),
      trace('auto-selection', { auto: { mode: 'auto' }, sequence: 4 }),
      trace('subsequent-error', {
        error: { message: 'precommit', source: 'runtime' },
        sequence: 5,
      }),
      trace('render-result', { result: { outcome: 'committed' }, sequence: 6 }),
      trace('subsequent-error', { error: { message: 'interval', source: 'runtime' }, sequence: 7 }),
    ];
    writeFileSync(path.join(directory, 'causal.log'), records.reverse().join(''));
    const report = parseSummary(
      execFileSync(process.execPath, [script, directory], { encoding: 'utf8' }),
    );
    expect(report.regressionCases).toEqual([
      {
        autoMode: 'auto',
        classification: 'fatal-during-auto-attempt',
        errorSource: 'runtime',
        message: 'before selection',
        occurrenceCount: 1,
        targetCount: 1,
        traceCount: 1,
      },
      {
        autoMode: 'auto',
        classification: 'fatal-during-auto-attempt',
        errorSource: 'runtime',
        message: 'precommit',
        occurrenceCount: 1,
        targetCount: 1,
        traceCount: 1,
      },
      {
        autoMode: 'auto',
        classification: 'late-fatal-after-commit',
        errorSource: 'runtime',
        message: 'interval',
        occurrenceCount: 1,
        targetCount: 1,
        traceCount: 1,
      },
    ]);
    expect(report.standaloneErrors).toEqual([]);
  });

  it('keeps quoted markers and safe error context while recovering after an oversized record', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-'));
    directories.push(directory);
    const oversized =
      'React preview blocker trace\n' +
      '{"format":"react-preview-blocker-trace/v1","message":"' +
      'x'.repeat(2 * 1024 * 1024) +
      '"}\n';
    const message =
      'prefix PREVIEW_BLOCKER_TRACE with \\"quotes\\" and { braces } at /private/path with spaces/file.ts, C:\\\\work dir\\\\file.ts, https://preview.invalid/a, 123e4567-e89b-12d3-a456-426614174000, aabbccddeeff0011 suffix';
    writeFileSync(
      path.join(directory, 'quoted.log'),
      oversized +
        trace('subsequent-error', {
          error: { message, source: 'preview-runtime' },
          sequence: 1,
        }),
    );
    const stdout = execFileSync(process.execPath, [script, directory], { encoding: 'utf8' });
    const report = parseSummary(stdout);
    expect(report).toEqual({
      format: 'react-preview-blocker-cases/v1',
      inputs: { fileCount: 1, malformedRecords: 1, parsedRecords: 1 },
      scope: { artifactCount: 1, runtimeSessionCount: 1, targetCount: 1 },
      counts: {
        autoModes: {},
        blockerKinds: {},
        events: { 'subsequent-error': 1 },
        renderOutcomes: {},
        renderResultsWithRemainingBlockers: 0,
      },
      regressionCases: [],
      standaloneErrors: [
        {
          errorSource: 'preview-runtime',
          message:
            'prefix PREVIEW_BLOCKER_TRACE with \\"quotes\\" and { braces } at [path], [path], [resource], [id], [id] suffix',
          occurrenceCount: 1,
        },
      ],
    });
    expect(stdout).toContain('prefix PREVIEW_BLOCKER_TRACE with');
    for (const secret of [
      '/private/path with spaces',
      'C:\\work dir',
      'https://preview.invalid',
      '123e4567-e89b-12d3-a456-426614174000',
      'aabbccddeeff0011',
    ])
      expect(stdout).not.toContain(secret);
  });

  it('rejects missing input, no arguments, and empty directories with concise diagnostics', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-blocker-cases-empty-'));
    directories.push(directory);
    for (const [arguments_, diagnostic] of [
      [[], /Usage:/u],
      [['/missing-preview-log'], /Cannot read input:/u],
      [[directory], /No readable log files\./u],
    ] as const) {
      const result = spawnSync(process.execPath, [script, ...arguments_], {
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toMatch(diagnostic);
      expect(result.stderr.trim().split('\n')).toHaveLength(1);
    }
  });
});
