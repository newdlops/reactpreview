import {
  deleteFixtureValue,
  fixtureArray,
  fixtureValue,
  setFixtureValue,
} from '../support/rtccV3Mutation';
/** Covers semantics behavior for validateRtccPreviewCompleteRouteProfileV3. */
/** Verifies authored-source validateRtccPreviewCompleteRouteProfileV3 invariants. */
import './rtccReconstructedSetup';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateRoute,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';
import { parseJsonl } from '../../scripts/validation/rtcc-v3-structural-telemetry.mjs';
import { validFixture } from '../support/rtccV3Fixture';
import {
  checkFailed,
  policy,
  temporaryDirectories,
} from './validateRtccPreviewCompleteRouteProfileV3Fixtures';
afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});
describe('complete-route profile v3', () => {
  it('binds a supplied execution-plan policy digest', () => {
    const corpus = validFixture();
    const inventoryPolicy = {
      ...policy.inventory,
      executionPlanPolicyDigest: fixtureValue(corpus, [
        -1,
        'inventory',
        'entries',
        0,
        'executionPlan',
        'policyDigest',
      ]),
    };
    expect(
      checkFailed(
        validateTrace(corpus, { ...policy, inventory: inventoryPolicy }),
        'execution-plan-policy',
      ),
    ).toBe(false);
    setFixtureValue(
      corpus,
      [-1, 'inventory', 'entries', 0, 'executionPlan', 'policyDigest'],
      'a'.repeat(64),
    );
    expect(
      checkFailed(
        validateTrace(corpus, { ...policy, inventory: inventoryPolicy }),
        'execution-plan-policy',
      ),
    ).toBe(true);
  });
  it.each([
    ['missing final LF', '{"ok":true}'],
    ['empty', ''],
    ['blank line', '{"ok":true}\n\n'],
    ['bad JSON', '{\n'],
  ] as const)('rejects raw JSONL %s', (_name, bytes) => {
    expect(() => {
      parseJsonl(bytes);
    }).toThrow();
  });
  it('parses canonical nonempty JSONL', () => {
    expect(parseJsonl('{"ok":true}\n')).toEqual([{ ok: true }]);
  });
  it.each([
    [
      'progress event schema',
      (x: unknown[]) => {
        setFixtureValue(x, [1, 'event', 'version'], 3);
      },
      'progress-schema',
    ],
    [
      'event key order',
      (x: unknown[]) => {
        const event = fixtureValue(
          fixtureArray(x).find((r: unknown) => fixtureValue(r, ['event', 'routeOrdinal']) === 1),
          ['event'],
        );
        const phase = fixtureValue(event, ['phase']);
        deleteFixtureValue(event, ['phase']);
        setFixtureValue(event, ['phase'], phase);
      },
      'progress-schema',
    ],
    [
      'event extra key',
      (x: unknown[]) => {
        setFixtureValue(
          fixtureArray(x).find((r: unknown) => fixtureValue(r, ['event', 'routeOrdinal']) === 1),
          ['event', 'extra'],
          1,
        );
      },
      'progress-schema',
    ],
    [
      'event missing key',
      (x: unknown[]) => {
        deleteFixtureValue(
          fixtureArray(x).find((r: unknown) => fixtureValue(r, ['event', 'routeOrdinal']) === 1),
          ['event', 'executionPlanTotal'],
        );
      },
      'progress-schema',
    ],
    [
      'phase interleave',
      (x: unknown[]) => {
        setFixtureValue(x, [3, 'event', 'phase'], 'prepare-source');
      },
      'phase-order',
    ],
    [
      'enumeration checkpoint',
      (x: unknown[]) => {
        setFixtureValue(x, [3, 'event', 'analysisPasses'], 9);
      },
      'enumeration-contract',
    ],
    [
      'enumeration equation',
      (x: unknown[]) => {
        setFixtureValue(x, [3, 'event', 'enumerationPrefixRequestCount'], 1);
      },
      'enumeration-contract',
    ],
    [
      'replay total',
      (x: unknown[]) => {
        setFixtureValue(x, [7, 'event', 'replayTotal'], 4);
      },
      'replay-contract',
    ],
    [
      'replay checkpoint',
      (x: unknown[]) => {
        setFixtureValue(x, [8, 'event', 'replayCompleted'], 8);
      },
      'replay-contract',
    ],
    [
      'execution phase pair',
      (x: unknown[]) => {
        setFixtureValue(
          fixtureArray(x).find(
            (r: unknown) =>
              fixtureValue(r, ['event', 'phase']) === 'execution-route-usage' &&
              fixtureValue(r, ['event', 'transition']) === 'complete',
          ),
          ['event', 'transition'],
          'start',
        );
      },
      'execution-derived-contract',
    ],
    [
      'execution interleaving',
      (x: unknown[]) => {
        const left = fixtureArray(x).findIndex(
          (r: unknown) =>
            fixtureValue(r, ['event', 'phase']) === 'execution-frontier-style' &&
            fixtureValue(r, ['event', 'transition']) === 'start',
        );
        const records = fixtureArray(x);
        [records[left], records[left + 1]] = [records[left + 1], records[left]];
      },
      'execution-derived-contract',
    ],
    [
      'execution terminal',
      (x: unknown[]) => {
        const execution = fixtureValue(
          fixtureArray(x).filter((r: unknown) => fixtureValue(r, ['event', 'routeOrdinal']) === 1),
          [-1],
        );
        setFixtureValue(execution, ['event', 'executionPlanCompleted'], 0);
      },
      'execution-derived-contract',
    ],
    [
      'bundle placement',
      (x: unknown[]) => {
        const execution = fixtureArray(x).find((r: unknown) =>
          fixtureValue(r, ['event', 'bundleDiagnostics']),
        );
        setFixtureValue(execution, ['event', 'phase'], 'execution-frontier-plan');
      },
      'bundle-schema',
    ],
    [
      'terminal fallback',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'lastCounters', 'executionPlanCompleted'], 1);
      },
      'execution-derived-contract',
    ],
  ] as const)('rejects AC-1 through AC-4 %s', (_name, mutate, expected) => {
    const corpus = structuredClone(validFixture());
    mutate(corpus);
    expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true);
  });
  it.each([
    ['numeric', '/groups/:id(\\d+)', '/groups/x', { id: 'x' }, 'pathname-pattern-mismatch'],
    ['missing', '/groups/:id', '/groups/1', {}, 'parameter-capture-mismatch'],
    ['extra', '/groups/:id', '/groups/1', { id: '1', extra: 'x' }, 'unexpected-parameter'],
    ['trailing', '/groups/:id', '/groups/1/extra', { id: '1' }, 'pathname-pattern-mismatch'],
    [
      'v4',
      '/users/:id([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/*',
      '/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rest',
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      '',
    ],
    [
      'bad-v4-prefix',
      '/users/:id([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/*',
      '/users/aaaaaaaa/rest',
      { id: 'aaaaaaaa' },
      'pathname-pattern-mismatch',
    ],
  ] as const)(
    'independently matches %s routes',
    (_name, pattern, pathname, parameters, expected) => {
      const errors = validateRoute({ pattern, pathname, parameters });
      if (expected) expect(errors).toContain(expected);
      else expect(errors).toEqual([]);
    },
  );
});
