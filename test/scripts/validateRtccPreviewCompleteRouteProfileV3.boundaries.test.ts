/** Verifies malformed route and artifact schemas using only in-memory fixtures. */
import './rtccReconstructedSetup';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  validateRoute,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';
import {
  assertEvidenceSchema,
  assertLineageSchema,
  assertManifestSchema,
  assertSumsSchema,
  persistOfficialArtifacts,
} from '../../scripts/validation/rtcc-v3-official-artifacts.mjs';
import {
  evaluateRouteSemantics,
  parseRoutePattern,
  requireAuthoritySemanticFailure,
} from '../../scripts/validation/rtcc-v3-route-semantics.mjs';
import { validFixture } from '../support/rtccV3Fixture';
import {
  deleteFixtureValue,
  fixtureArray,
  fixtureObject,
  fixtureValue,
  setFixtureValue,
} from '../support/rtccV3Mutation';
import { temporaryDirectories } from './validateRtccPreviewCompleteRouteProfileV3Fixtures';
afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});
describe('complete-route profile v3', () => {
  it.each([
    [
      'nested groups and escaped parentheses',
      '/x/:id((?:a\\)b|[c/d])+)',
      '/x/a)b',
      { id: 'a)b' },
      [],
    ],
    ['character class', '/x/:id([a-z/]+)', '/x/a', { id: 'a' }, []],
    ['duplicate parameter', '/x/:id/:id', '/x/a/a', { id: 'a' }, ['route-pattern']],
    ['non-string parameter', '/x/:id', '/x/a', { id: 1 }, ['parameter-capture-mismatch']],
    ['empty terminal splat', '/x/:id/*', '/x/a', { id: 'a' }, []],
    ['slash terminal splat', '/x/:id/*', '/x/a/rest/of/path', { id: 'a' }, []],
    [
      'invalid constrained splat prefix',
      '/x/:id(\\d+)/*',
      '/x/no/rest',
      { id: 'no' },
      ['pathname-pattern-mismatch'],
    ],
  ] as const)('handles parser edge case %s', (_name, pattern, pathname, parameters, expected) => {
    expect(validateRoute({ pattern, pathname, parameters })).toEqual(expected);
  });
  it('records actual parameter offsets and evaluates runnable entries only', () => {
    const entries: unknown[] = [
      {
        id: 'ignored',
        disposition: 'duplicate',
        pattern: '/x/:id',
        pathname: '/x/no',
        parameters: { id: 'no' },
      },
      {
        id: 'second',
        disposition: 'runnable',
        pattern: '/x/:first(\\d+)/:second(\\w+)',
        pathname: '/x/no/!',
        parameters: { first: 'no', second: '!' },
      },
    ];
    const result = evaluateRouteSemantics(entries);
    expect(
      result.violations.map((v: unknown) => [
        fixtureValue(v, ['id']),
        fixtureValue(v, ['tokenOffset']),
      ]),
    ).toEqual([
      ['second', 3],
      ['second', 15],
    ]);
  });
  it('rejects malformed balanced route patterns', () => {
    expect(() => parseRoutePattern('/x/:id([a-z]+)')).not.toThrow();
    expect(() => parseRoutePattern('/x/:id([a-z]+')).toThrow();
  });
  it('asserts the pure authority semantic expectation', () => {
    const entries = Array.from({ length: 31 }, () => ({ parameters: { id: 'aaaaaaaa' } }));
    const report = {
      inventory: { entries },
      violations: Array.from({ length: 31 }, (_, inventoryIndex) => ({
        inventoryIndex,
        code: 'pathname-pattern-mismatch',
        nonSplat: inventoryIndex < 30,
      })),
      blockers: Array.from({ length: 18 }, () => ({})),
    };
    expect(requireAuthoritySemanticFailure(report)).toBe(true);
    fixtureArray(report, ['violations']).pop();
    expect(() => requireAuthoritySemanticFailure(report)).toThrow();
  });
  it('orders semantic violations and unresolved blockers deterministically', () => {
    const corpus = validFixture();
    fixtureArray(corpus, [-1, 'inventory', 'entries']).push(
      {
        id: 'unresolved-z',
        disposition: 'unresolved',
        pattern: '<unresolved>',
        pathname: '',
        parameters: {},
        reason: 'z',
      },
      {
        ...fixtureObject(corpus, [-1, 'inventory', 'entries', 0]),
        id: 'bad-a',
        pathname: '/groups/nope',
        parameters: { groupId: 'nope' },
      },
    );
    setFixtureValue(corpus, [-1, 'inventory', 'counts'], {
      total: 3,
      runnable: 2,
      duplicate: 0,
      unresolved: 1,
    });
    const result = validateTrace(corpus);
    expect(result.firstViolation).toMatchObject({ id: 'bad-a' });
    expect(result.firstBlocker).toMatchObject({ id: 'unresolved-z' });
  });
  it('requires verified official inputs before artifact persistence', () => {
    const paths = ['a.json', 'b.json', 'c.json', 'd.json', 'manifest.json', 'sums'].map((file) =>
      join(tmpdir(), `rtcc-v3-${file}`),
    );
    // Deliberately incomplete transport input must fail before any artifact can be written.
    const invalidInput = { paths, body: {}, expectedExitCode: 1 };
    expect(() =>
      persistOfficialArtifacts(invalidInput as Parameters<typeof persistOfficialArtifacts>[0]),
    ).toThrow('artifact-input-required');
  });
  it.each(['gate', 'runtime', 'outputHashes', 'officialRunCount', 'prohibitedActions'] as const)(
    'rejects evidence omission %s',
    (key) => {
      const value = {
        schemaVersion: 1,
        kind: 'validator-run-evidence',
        gate: null,
        runtime: 'x',
        outputHashes: ['a', 'b', 'c'],
        officialRunCount: 1,
        retryCount: 0,
        externalRunCount: 0,
        prohibitedActions: {},
      };
      deleteFixtureValue(value, [key]);
      expect(() => assertEvidenceSchema(value)).toThrow();
    },
  );
  it.each([
    'authority',
    'predecessors',
    'engineTerminal',
    'prohibitedActions',
    'cannotConvertCompletionToReleaseGo',
  ] as const)('rejects lineage omission %s', (key) => {
    const value = {
      schemaVersion: 1,
      kind: 'semantic-failure-lineage',
      authority: {},
      predecessors: {
        planSha256: 'x',
        attemptSha256: 'x',
        terminalEvidenceSha256: 'x',
        attempt: {},
        terminal: {},
      },
      engineTerminal: {},
      prohibitedActions: {},
      cannotConvertCompletionToReleaseGo: true,
    };
    deleteFixtureValue(value, [key]);
    expect(() => assertLineageSchema(value)).toThrow();
  });
  it.each([
    [
      { path: 'z', sha256: 'x' },
      { path: 'a', sha256: 'x' },
    ],
    [
      { path: 'a', sha256: 'x' },
      { path: 'a', sha256: 'x' },
    ],
    [{ path: 'artifact-manifest.json', sha256: 'x' }],
  ] as const)('rejects manifest drift', (...results: unknown[]) => {
    expect(() =>
      assertManifestSchema({ schemaVersion: 1, kind: 'artifact-manifest', inputs: [], results }),
    ).toThrow();
  });
  it.each([
    'a'.repeat(64) + '  a\n' + 'b'.repeat(64) + '  a\n',
    'a'.repeat(64) + '  SHA256SUMS\n',
  ] as const)('rejects SHA self/duplicate reference', (bytes) => {
    expect(() => assertSumsSchema(bytes)).toThrow();
  });
  it('keeps canonical self digests stable', () => {
    expect(canonicalDigest({ b: 1, a: [true] })).toBe(canonicalDigest({ a: [true], b: 1 }));
  });
});
