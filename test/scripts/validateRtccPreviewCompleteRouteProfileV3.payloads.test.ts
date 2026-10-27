/** Covers payloads behavior for validateRtccPreviewCompleteRouteProfileV3. */
/** Verifies authored-source validateRtccPreviewCompleteRouteProfileV3 invariants. */
import './rtccReconstructedSetup';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { readReconstructedFile } from '../support/rtccReconstructedArchive';

import {
  AUTHORITY_PATH,
  AUTHORITY_POLICY,
  AUTHORITY_SHA256,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';

import {
  assertEvidenceSchema,
  assertGateSchema,
  assertLineageSchema,
  assertManifestSchema,
  assertSumsSchema,
  persistOfficialArtifacts,
  preflightOfficialRun,
} from '../../scripts/validation/rtcc-v3-official-artifacts.mjs';

import { createHash } from 'node:crypto';
import type {
  EvidenceMutationFixture,
  GateMutationFixture,
  LineageMutationFixture,
  ManifestMutationFixture,
} from './rtccV3ArtifactMutationTypes';
import type { FixturePreflightOptions } from './validateRtccPreviewCompleteRouteProfileV3Fixtures';

import {
  actualInvocation,
  isolatedTemp,
  nodePath,
  officialArgs,
  outputNames,
  persistedArtifacts,
  preparedPreflight,
  reorder,
  reorderInPlace,
  temporaryDirectories,
} from './validateRtccPreviewCompleteRouteProfileV3Fixtures';

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe('complete-route profile v3', () => {
  it('rejects reserved outputs before reading authority or writing results', () => {
    const prepared = preparedPreflight();
    let authorityReads = 0;
    const writes = 0;
    expect(() =>
      preflightOfficialRun({
        ...prepared.options,
        exists: () => true,
        readFile: (path: string, encoding?: BufferEncoding) => {
          if (path === AUTHORITY_PATH) authorityReads += 1;
          return prepared.read(path, encoding);
        },
      }),
    ).toThrow('reserved-output-exists');
    expect(authorityReads).toBe(0);
    expect(writes).toBe(0);
  });

  it.each([
    [
      'placeholder hash',
      (options: FixturePreflightOptions) => ({
        ...options,
        argv: officialArgs('<raw-gate-sha256>'),
      }),
    ],
    [
      'wrong cwd',
      (options: FixturePreflightOptions) => ({
        ...options,
        invocation: { ...options.invocation, cwd: '/tmp' },
      }),
    ],
    [
      'wrong executable',
      (options: FixturePreflightOptions) => ({
        ...options,
        invocation: { ...options.invocation, execPath: '/usr/bin/node' },
      }),
    ],
    [
      'wrong script',
      (options: FixturePreflightOptions) => ({
        ...options,
        invocation: {
          ...options.invocation,
          argv: [nodePath, '/tmp/validator.mjs', ...options.argv],
        },
      }),
    ],
    [
      'wrong argv identity',
      (options: FixturePreflightOptions) => ({
        ...options,
        invocation: { ...options.invocation, argv: [...options.invocation.argv, 'extra'] },
      }),
    ],
    [
      'wrong approved relation',
      (options: FixturePreflightOptions) => ({
        ...options,
        argv: [...options.argv.slice(0, 4), '0'.repeat(64)],
      }),
    ],
  ] as const)('requires the exact actual invocation %s', (_name, mutate) => {
    const prepared = preparedPreflight();
    expect(preflightOfficialRun(prepared.options).invocation.argv).toEqual(
      actualInvocation(prepared.argv).argv,
    );
    expect(() => preflightOfficialRun(mutate(prepared.options))).toThrow();
  });

  it('rejects amendment-3 and gate binding identity mutations', () => {
    const prepared = preparedPreflight();
    const changedPlan = structuredClone(prepared.gate.gate);
    const amendmentBinding = changedPlan.bindings[3];
    if (amendmentBinding === undefined) throw new Error('Expected the fourth gate binding.');
    amendmentBinding.sha256 = '0'.repeat(64);
    const bytes = `${JSON.stringify(changedPlan, null, 2)}\n`;
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(() =>
      preflightOfficialRun({
        ...prepared.options,
        argv: officialArgs(sha),
        invocation: actualInvocation(officialArgs(sha)),
        readFile: (path: string, encoding?: BufferEncoding) =>
          path.endsWith('validator-gate.json')
            ? encoding
              ? bytes
              : Buffer.from(bytes)
            : readReconstructedFile(path, encoding),
      }),
    ).toThrow('gate-schema-drift');
  });

  it.each([
    'spawn',
    'retry',
    'external',
    'browser',
    'chromium',
    'server',
    'campaign',
    'timeout',
    'newRoot',
    'profileRetry',
  ] as const)('rejects lineage prohibited action %s', (key) => {
    const run = persistedArtifacts();
    try {
      const value = structuredClone(run.artifacts.lineage) as LineageMutationFixture;
      value.prohibitedActions[key] = true;
      expect(() =>
        assertLineageSchema(value, {
          gateSha256: run.prepared.gate.sha256,
          moduleHashes: run.prepared.gate.gate.bindings,
          predecessors: run.preflight.predecessors,
        }),
      ).toThrow();
      Reflect.deleteProperty(value.prohibitedActions, key);
      expect(() => assertLineageSchema(value)).toThrow();
    } finally {
      rmSync(run.temp, { recursive: true, force: true });
    }
  });

  it.each([
    'spawn',
    'retry',
    'external',
    'browser',
    'chromium',
    'server',
    'campaign',
    'timeout',
    'newRoot',
    'profileRetry',
  ] as const)('rejects evidence prohibited action %s', (key) => {
    const run = persistedArtifacts();
    try {
      const value = structuredClone(run.artifacts.evidence) as EvidenceMutationFixture;
      value.prohibitedActions[key] = true;
      expect(() =>
        assertEvidenceSchema(value, {
          gateSha256: run.prepared.gate.sha256,
          moduleHashes: run.prepared.gate.gate.bindings,
        }),
      ).toThrow();
      Reflect.deleteProperty(value.prohibitedActions, key);
      expect(() => assertEvidenceSchema(value)).toThrow();
    } finally {
      rmSync(run.temp, { recursive: true, force: true });
    }
  });

  it.each(['missing', 'extra', 'reordered', 'abbreviated', 'placeholder', 'inconsistent'] as const)(
    'rejects exact lineage facts %s',
    (kind) => {
      const run = persistedArtifacts();
      try {
        const value = structuredClone(run.artifacts.lineage) as LineageMutationFixture;
        if (kind === 'missing') delete value.authority.bytes;
        if (kind === 'extra') value.extra = true;
        if (kind === 'reordered') {
          const next = reorder(value);
          Object.keys(value).forEach((key) => Reflect.deleteProperty(value, key));
          Object.assign(value, next);
        }
        if (kind === 'abbreviated') value.plans.pop();
        if (kind === 'placeholder') value.gate.sha256 = '0'.repeat(64);
        if (kind === 'inconsistent') value.engineTerminal.executionPlanCompleted = 680;
        expect(() =>
          assertLineageSchema(value, {
            gateSha256: run.prepared.gate.sha256,
            moduleHashes: run.prepared.gate.gate.bindings,
            predecessors: run.preflight.predecessors,
          }),
        ).toThrow();
      } finally {
        rmSync(run.temp, { recursive: true, force: true });
      }
    },
  );

  it.each(['missing', 'extra', 'reordered', 'abbreviated', 'placeholder', 'inconsistent'] as const)(
    'rejects exact evidence facts %s',
    (kind) => {
      const run = persistedArtifacts();
      try {
        const value = structuredClone(run.artifacts.evidence) as EvidenceMutationFixture;
        if (kind === 'missing') delete (value.invocation as Partial<typeof value.invocation>).argv;
        if (kind === 'extra') value.extra = true;
        if (kind === 'reordered') {
          const next = reorder(value);
          Object.keys(value).forEach((key) => Reflect.deleteProperty(value, key));
          Object.assign(value, next);
        }
        if (kind === 'abbreviated') value.bindings.pop();
        if (kind === 'placeholder') value.invocation.argv[6] = '<raw-gate-sha256>';
        if (kind === 'inconsistent') value.officialRunCount = 2;
        expect(() =>
          assertEvidenceSchema(value, {
            gateSha256: run.prepared.gate.sha256,
            moduleHashes: run.prepared.gate.gate.bindings,
          }),
        ).toThrow();
      } finally {
        rmSync(run.temp, { recursive: true, force: true });
      }
    },
  );

  it.each(['missing', 'extra', 'reordered', 'duplicate', 'self', 'bad hash', 'bad path'] as const)(
    'rejects exact manifest claims %s',
    (kind) => {
      const run = persistedArtifacts();
      try {
        const value = structuredClone(run.artifacts.manifest) as unknown as ManifestMutationFixture;
        if (kind === 'missing') delete value.inputs;
        if (kind === 'extra') value.extra = true;
        if (kind === 'reordered') value.results.reverse();
        if (kind === 'duplicate') value.results[1].path = value.results[0].path;
        if (kind === 'self')
          value.results[3].path = '.plan/launchers/rtcc-v5.5.31-artifact-manifest.json';
        if (kind === 'bad hash') value.results[0].sha256 = '0'.repeat(64);
        if (kind === 'bad path') value.results[0].path = 'wrong';
        expect(() =>
          assertManifestSchema(value, {
            gateSha256: run.prepared.gate.sha256,
            bytes: run.artifacts.bytes.slice(0, 4),
          }),
        ).toThrow();
      } finally {
        rmSync(run.temp, { recursive: true, force: true });
      }
    },
  );

  it.each(['missing', 'extra', 'reordered', 'duplicate', 'self', 'bad hash', 'bad path'] as const)(
    'rejects exact SHA claims %s',
    (kind) => {
      const run = persistedArtifacts();
      try {
        const sums = run.artifacts.bytes[5];
        if (sums === undefined) throw new Error('Expected the persisted checksum artifact.');
        let lines = sums.trimEnd().split('\n');
        const firstLine = lines[0];
        if (firstLine === undefined) throw new Error('Expected the first checksum entry.');
        if (kind === 'missing') lines = lines.slice(1);
        if (kind === 'extra') lines.push(`${'0'.repeat(64)}  extra`);
        if (kind === 'reordered') lines.reverse();
        if (kind === 'duplicate') lines[1] = firstLine;
        if (kind === 'self')
          lines[4] = `${'0'.repeat(64)}  .plan/launchers/rtcc-v5.5.31-SHA256SUMS`;
        if (kind === 'bad hash')
          lines[0] = `${'0'.repeat(64)}  .plan/launchers/rtcc-v5.5.31-profile-validation.json`;
        if (kind === 'bad path') lines[0] = `${firstLine.slice(0, 64)}  wrong`;
        expect(() =>
          assertSumsSchema(`${lines.join('\n')}\n`, { bytes: run.artifacts.bytes.slice(0, 5) }),
        ).toThrow();
      } finally {
        rmSync(run.temp, { recursive: true, force: true });
      }
    },
  );

  it.each([-1, 0, 1, 2, 3, 4, 5] as const)(
    'keeps exact bytes and terminal absence when persistence fails at %i',
    (failureIndex) => {
      const run = persistedArtifacts();
      try {
        rmSync(run.temp, { recursive: true, force: true });
        const temp = isolatedTemp('rtcc-v3-terminal-');
        const paths = outputNames.map((name) => join(temp, name));
        const writes: string[] = [];
        const authorityBytes = readReconstructedFile(AUTHORITY_PATH, 'utf8');
        const body = {
          schemaVersion: 3,
          validator: 'rtcc-preview-complete-route-profile-v3',
          authority: { path: AUTHORITY_PATH, sha256: AUTHORITY_SHA256, lineCount: 1530 },
          authorityBytes,
          externalRunCount: 0,
          noRetry: true,
          productionChanged: false,
          ...validateTrace(
            authorityBytes
              .trimEnd()
              .split('\n')
              .map((line) => JSON.parse(line) as unknown),
            AUTHORITY_POLICY,
          ),
        };
        expect(() =>
          persistOfficialArtifacts({
            paths,
            body,
            expectedExitCode: 1,
            gate: run.prepared.gate.gate,
            gateSha256: run.prepared.gate.sha256,
            moduleHashes: run.prepared.gate.gate.bindings,
            predecessors: run.preflight.predecessors,
            invocation: run.preflight.invocation,
            writeFile: (path: string, bytes: string) => {
              const index = writes.length;
              if (index === failureIndex || failureIndex === -1) throw new Error('injected');
              writes.push(path);
              writeFileSync(path, bytes, { encoding: 'utf8', flag: 'wx' });
            },
          }),
        ).toThrow('injected');
        expect(writes).toHaveLength(failureIndex < 0 ? 0 : failureIndex);
        for (const [index, path] of paths.entries()) {
          if (index < Math.max(0, failureIndex))
            expect(readFileSync(path, 'utf8')).toBe(run.artifacts.bytes[index]);
          else expect(existsSync(path)).toBe(false);
        }
        rmSync(temp, { recursive: true, force: true });
      } finally {
        if (existsSync(run.temp)) rmSync(run.temp, { recursive: true, force: true });
      }
    },
  );

  it.each([
    [
      'top missing',
      (gate: GateMutationFixture) => {
        delete gate.cwd;
      },
    ],
    [
      'top extra',
      (gate: GateMutationFixture) => {
        gate.extra = true;
      },
    ],
    [
      'top reordered',
      (gate: GateMutationFixture) => {
        reorderInPlace(gate);
      },
    ],
    [
      'review',
      (gate: GateMutationFixture) => {
        gate.preOfficialSolReview.status = 'FAIL';
      },
    ],
    [
      'review order',
      (gate: GateMutationFixture) => {
        reorderInPlace(gate.preOfficialSolReview);
      },
    ],
    [
      'node',
      (gate: GateMutationFixture) => {
        gate.node.version = 'v0.0.0';
      },
    ],
    [
      'node extra',
      (gate: GateMutationFixture) => {
        gate.node.extra = true;
      },
    ],
    [
      'authority',
      (gate: GateMutationFixture) => {
        gate.authority.sha256 = '0'.repeat(64);
      },
    ],
    [
      'bindings',
      (gate: GateMutationFixture) => {
        gate.bindings[0].path = 'wrong';
      },
    ],
    [
      'binding hash',
      (gate: GateMutationFixture) => {
        gate.bindings[0].sha256 = '0'.repeat(64);
      },
    ],
    [
      'binding order',
      (gate: GateMutationFixture) => {
        reorderInPlace(gate.bindings[0]);
      },
    ],
    [
      'production',
      (gate: GateMutationFixture) => {
        gate.productionManifest.entries = 34;
      },
    ],
    [
      'production order',
      (gate: GateMutationFixture) => {
        reorderInPlace(gate.productionManifest);
      },
    ],
    [
      'command prefix',
      (gate: GateMutationFixture) => {
        gate.command.fixedArgumentPrefix[0] = '--wrong';
      },
    ],
    [
      'command relation',
      (gate: GateMutationFixture) => {
        gate.command.finalArgumentRelation = 'wrong';
      },
    ],
    [
      'command order',
      (gate: GateMutationFixture) => {
        reorderInPlace(gate.command);
      },
    ],
    [
      'recursive placeholder',
      (gate: GateMutationFixture) => {
        gate.command.finalArgumentRelation = '<gate-hash>';
      },
    ],
  ] as const)('rejects recomputed-hash exact gate schema drift %s', (_name, mutate) => {
    const prepared = preparedPreflight();
    const gate = structuredClone(prepared.gate.gate) as GateMutationFixture;
    mutate(gate);
    const bytes = `${JSON.stringify(gate, null, 2)}\n`;
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(() => assertGateSchema(gate, { bindings: prepared.gate.gate.bindings })).toThrow();
    expect(() =>
      preflightOfficialRun({
        ...prepared.options,
        argv: officialArgs(hash),
        invocation: actualInvocation(officialArgs(hash)),
        readFile: (path: string, encoding?: BufferEncoding) =>
          path.endsWith('validator-gate.json')
            ? encoding
              ? bytes
              : Buffer.from(bytes)
            : readReconstructedFile(path, encoding),
      }),
    ).toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5, 6] as const)(
    'rejects actual invocation token mismatch %i',
    (index) => {
      const run = persistedArtifacts();
      const evidence = structuredClone(run.artifacts.evidence) as EvidenceMutationFixture;
      evidence.invocation.argv[index] = `${evidence.invocation.argv[index]}-wrong`;
      expect(() =>
        assertEvidenceSchema(evidence, {
          gateSha256: run.prepared.gate.sha256,
          moduleHashes: run.prepared.gate.gate.bindings,
          bytes: run.artifacts.bytes.slice(0, 3),
        }),
      ).toThrow();
    },
  );

  it.each([0, 1, 2, 3, 4] as const)('rejects approved invocation token mismatch %i', (index) => {
    const run = persistedArtifacts();
    const evidence = structuredClone(run.artifacts.evidence) as EvidenceMutationFixture;
    evidence.invocation.approvedTokens[index] =
      `${evidence.invocation.approvedTokens[index]}-wrong`;
    expect(() =>
      assertEvidenceSchema(evidence, {
        gateSha256: run.prepared.gate.sha256,
        moduleHashes: run.prepared.gate.gate.bindings,
        bytes: run.artifacts.bytes.slice(0, 3),
      }),
    ).toThrow();
  });

  it('persists no placeholder recursively in gate or validator evidence', () => {
    const run = persistedArtifacts();
    expect(JSON.stringify(run.prepared.gate.gate)).not.toMatch(/<[^>]+>/);
    expect(JSON.stringify(run.artifacts.evidence)).not.toMatch(/<[^>]+>/);
    expect((run.artifacts.evidence as EvidenceMutationFixture).invocation.approvedTokens).toEqual(
      run.prepared.argv,
    );
  });

  it.each([
    'plan',
    'canonicalArgv',
    'executor',
    'executorTest',
    'attempt',
    'terminal',
    'gateProbe',
    'preflight',
    'lineage',
  ] as const)('rejects predecessor fixed identity mutation %s', (key) => {
    const run = persistedArtifacts();
    const lineage = structuredClone(run.artifacts.lineage) as LineageMutationFixture;
    lineage.predecessors[key].sha256 = '0'.repeat(64);
    expect(() =>
      assertLineageSchema(lineage, {
        gateSha256: run.prepared.gate.sha256,
        moduleHashes: run.prepared.gate.gate.bindings,
      }),
    ).toThrow();
  });

  it.each([
    [
      'canonical missing',
      'canonicalArgv',
      (value: unknown) => {
        delete (value as { argumentCount?: number }).argumentCount;
      },
    ],
    [
      'canonical extra',
      'canonicalArgv',
      (value: unknown) => {
        (value as Record<string, unknown>).extra = true;
      },
    ],
    ['canonical reordered', 'canonicalArgv', reorderInPlace],
    [
      'canonical value',
      'canonicalArgv',
      (value: unknown) => {
        (value as { argumentCount?: number }).argumentCount = 21;
      },
    ],
    [
      'attempt missing',
      'attempt',
      (value: unknown) => {
        delete (value as { command?: unknown }).command;
      },
    ],
    [
      'attempt extra',
      'attempt',
      (value: unknown) => {
        (value as Record<string, unknown>).extra = true;
      },
    ],
    ['attempt reordered', 'attempt', reorderInPlace],
    [
      'attempt value',
      'attempt',
      (value: unknown) => {
        (value as { profileSpawnApiInvocationCount: number }).profileSpawnApiInvocationCount = 1;
      },
    ],
    [
      'terminal missing',
      'terminal',
      (value: unknown) => {
        delete (value as { execution: Record<string, unknown> & { events?: unknown[] } }).execution
          .events;
      },
    ],
    [
      'terminal extra',
      'terminal',
      (value: unknown) => {
        (value as { streams: Record<string, unknown> }).streams.extra = true;
      },
    ],
    [
      'terminal reordered',
      'terminal',
      (value: unknown) => {
        reorderInPlace(
          (value as { execution: Record<string, unknown> & { events?: unknown[] } }).execution,
        );
      },
    ],
    [
      'terminal value',
      'terminal',
      (value: unknown) => {
        (value as { audit: { strict681AuditPerformed: boolean } }).audit.strict681AuditPerformed =
          true;
      },
    ],
    [
      'gate probe missing',
      'gateProbe',
      (value: unknown) => {
        delete (value as { result?: string }).result;
      },
    ],
    [
      'gate probe extra',
      'gateProbe',
      (value: unknown) => {
        (value as Record<string, unknown>).extra = true;
      },
    ],
    ['gate probe reordered', 'gateProbe', reorderInPlace],
    [
      'gate probe value',
      'gateProbe',
      (value: unknown) => {
        (value as { result?: string }).result = 'fail';
      },
    ],
    [
      'preflight missing',
      'preflight',
      (value: unknown) => {
        delete (value as { decision?: unknown }).decision;
      },
    ],
    [
      'preflight extra',
      'preflight',
      (value: unknown) => {
        (value as Record<string, unknown>).extra = true;
      },
    ],
    ['preflight reordered', 'preflight', reorderInPlace],
    [
      'preflight value',
      'preflight',
      (value: unknown) => {
        (
          value as { decision: { preflightPassed: boolean; terminal: boolean } }
        ).decision.preflightPassed = false;
      },
    ],
    [
      'lineage missing',
      'lineage',
      (value: unknown) => {
        delete (value as { predecessor?: unknown }).predecessor;
      },
    ],
    [
      'lineage extra',
      'lineage',
      (value: unknown) => {
        (value as Record<string, unknown>).extra = true;
      },
    ],
    ['lineage reordered', 'lineage', reorderInPlace],
    [
      'lineage value',
      'lineage',
      (value: unknown) => {
        (value as { decision: { preflightPassed: boolean; terminal: boolean } }).decision.terminal =
          false;
      },
    ],
  ] as const)('rejects exact predecessor nested mutation %s', (_name, key, mutate) => {
    const run = persistedArtifacts();
    const lineage = structuredClone(run.artifacts.lineage) as LineageMutationFixture;
    mutate(lineage.predecessors[key].value);
    expect(() =>
      assertLineageSchema(lineage, {
        gateSha256: run.prepared.gate.sha256,
        moduleHashes: run.prepared.gate.gate.bindings,
      }),
    ).toThrow();
  });
});
