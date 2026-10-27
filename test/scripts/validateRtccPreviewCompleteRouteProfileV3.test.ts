import {
  deleteFixtureValue,
  fixtureArray,
  fixtureObject,
  fixtureValue,
  setFixtureValue,
} from '../support/rtccV3Mutation';
/** Covers structural behavior for validateRtccPreviewCompleteRouteProfileV3. */
/** Verifies authored-source validateRtccPreviewCompleteRouteProfileV3 invariants. */
import './rtccReconstructedSetup';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORITY_PATH,
  AUTHORITY_POLICY,
  AUTHORITY_SHA256,
  canonicalDigest,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';
import {
  validFixture,
  validMultiMountFixture,
  validPageRootFixture,
  validRouteRootFixture,
} from '../support/rtccV3Fixture';
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
  it('exports the immutable authority policy used by pure validation', () => {
    expect(AUTHORITY_PATH).toMatch(/profile\.jsonl$/);
    expect(AUTHORITY_SHA256).toHaveLength(64);
    expect(AUTHORITY_POLICY.structural.executionCount).toBe(1496);
    expect(AUTHORITY_POLICY.inventory.runnable).toBe(681);
    expect(
      validateTrace(validFixture(), {
        structural: { ...policy.structural },
        inventory: { ...policy.inventory },
      }).structuralResult,
    ).toBe('pass');
  });
  it.each([
    ['route-root', validRouteRootFixture],
    ['page-root', validPageRootFixture],
    ['multi-mount', validMultiMountFixture],
  ] as const)('accepts the production-derived %s mount topology', (_name, create) => {
    const result = validateTrace(create(), policy);
    expect(
      fixtureArray(result, ['checks']).filter((check: unknown) => !fixtureValue(check, ['passed'])),
    ).toEqual([]);
    expect(result.releaseResult).toBe('go');
  });
  it('allows intermediate execution counters and independent raw/request bundle counts', () => {
    const corpus = validFixture();
    const bundle = fixtureValue(
      fixtureArray(corpus).find((record: unknown) =>
        fixtureValue(record, ['event', 'bundleDiagnostics']),
      ),
      ['event'],
    );
    setFixtureValue(bundle, ['bundleDiagnostics', 'rawSourceReadCount'], 1932);
    setFixtureValue(bundle, ['bundleDiagnostics', 'inventoryReadRequestCount'], 1933);
    expect(checkFailed(validateTrace(corpus, policy), 'bundle-schema')).toBe(false);
    const firstExecution = fixtureArray(corpus).find(
      (record: unknown) => fixtureValue(record, ['event', 'routeOrdinal']) === 1,
    );
    setFixtureValue(firstExecution, ['event', 'executionPlanCompleted'], 1);
    expect(checkFailed(validateTrace(corpus, policy), 'execution-derived-contract')).toBe(true);
  });
  it('validates arbitrary supplied identities without an allowlist', () => {
    const result = validateTrace(validFixture(), policy);
    expect(
      fixtureArray(result, ['checks']).filter((check: unknown) => !fixtureValue(check, ['passed'])),
    ).toEqual([]);
    expect(result.releaseResult).toBe('go');
  });
  it.each([
    [
      'sequence',
      (x: unknown[]) => {
        setFixtureValue(x, [1, 'event', 'sequence'], 9);
      },
      'contiguous-progress',
    ],
    [
      'terminal',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'cleanupConfirmed'], false);
      },
      'terminal-contract',
    ],
    [
      'diagnostic',
      (x: unknown[]) => {
        setFixtureValue(
          fixtureArray(x).find((record: unknown) =>
            fixtureValue(record, ['event', 'bundleDiagnostics']),
          ),
          ['event', 'bundleDiagnostics', 'sliceHitCount'],
          2,
        );
      },
      'bundle-schema',
    ],
    [
      'digest',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'digest'],
          '0'.repeat(64),
        );
      },
      'execution-plan-digest',
    ],
    [
      'replay',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'entries', 0, 'replay', 'pathname'], '/wrong');
      },
      'entry-replay-binding',
    ],
    [
      'dependency',
      (x: unknown[]) => {
        fixtureArray(x, [-1, 'inventory', 'dependencyPaths']).push('/a');
      },
      'dependencies',
    ],
  ] as const)('rejects one-field %s mutation', (_name, mutate, expected) => {
    const corpus = structuredClone(validFixture());
    mutate(corpus);
    expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true);
  });
  it.each([
    [
      'inventory key order',
      (x: unknown[]) => {
        const inventory = fixtureValue(x, [-1, 'inventory']);
        setFixtureValue(inventory, ['entries'], []);
        deleteFixtureValue(inventory, ['entries']);
        setFixtureValue(inventory, ['entries'], []);
      },
      'inventory-schema',
    ],
    [
      'inventory version',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'version'], 3);
      },
      'inventory-schema',
    ],
    [
      'inventory completion',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'complete'], false);
      },
      'inventory-schema',
    ],
    [
      'inventory truncation',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'truncated'], true);
      },
      'inventory-schema',
    ],
    [
      'inventory limit scalar',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'limits', 'maximumDepth'], 0);
      },
      'inventory-schema',
    ],
    [
      'inventory owner',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'owner', 'extra'], true);
      },
      'inventory-schema',
    ],
    [
      'replay policy',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'replayPolicy', 'version'], 1);
      },
      'inventory-schema',
    ],
    [
      'count total',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'counts', 'total'], 9);
      },
      'inventory-counts',
    ],
    [
      'dependency ordering',
      (x: unknown[]) => {
        fixtureArray(x, [-1, 'inventory', 'dependencyPaths']).reverse();
      },
      'dependencies',
    ],
    [
      'duplicate dependency',
      (x: unknown[]) => {
        fixtureArray(x, [-1, 'inventory', 'dependencyPaths']).push('/b');
      },
      'dependencies',
    ],
    [
      'runnable key set',
      (x: unknown[]) => {
        deleteFixtureValue(x, [-1, 'inventory', 'entries', 0, 'sourcePath']);
      },
      'runnable-schema',
    ],
    [
      'runnable scalar',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'entries', 0, 'parameters', 'groupId'], 42);
      },
      'runnable-schema',
    ],
    [
      'replay key set',
      (x: unknown[]) => {
        deleteFixtureValue(x, [-1, 'inventory', 'entries', 0, 'replay', 'ownerChain']);
      },
      'replay-schema',
    ],
    [
      'replay resolution',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'replay', 'routeSelectionResolution'],
          'fallback',
        );
      },
      'replay-schema',
    ],
    [
      'replay policy digest',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'replay', 'policyDigest'],
          'a'.repeat(64),
        );
      },
      'entry-replay-binding',
    ],
    [
      'plan key set',
      (x: unknown[]) => {
        deleteFixtureValue(x, [-1, 'inventory', 'entries', 0, 'executionPlan', 'recipe']);
      },
      'execution-plan-schema',
    ],
    [
      'plan version',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'entries', 0, 'executionPlan', 'version'], 1);
      },
      'execution-plan-schema',
    ],
    [
      'optional router value',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'recipe', 'routerModuleSpecifier'],
          'router',
        );
      },
      'execution-plan-schema',
    ],
    [
      'mount schema',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'recipe', 'mounts', 0, 'extra'],
          true,
        );
      },
      'execution-plan-schema',
    ],
    [
      'context digest',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'planningContextDigest'],
          '0'.repeat(64),
        );
      },
      'execution-plan-schema',
    ],
    [
      'plan self digest',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'digest'],
          '0'.repeat(64),
        );
      },
      'execution-plan-digest',
    ],
    [
      'entry replay component',
      (x: unknown[]) => {
        setFixtureValue(x, [-1, 'inventory', 'entries', 0, 'replay', 'componentName'], 'Other');
      },
      'entry-replay-binding',
    ],
    [
      'entry replay owner',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'replay', 'owner', 'sourcePath'],
          '/other',
        );
      },
      'entry-replay-binding',
    ],
    [
      'entry replay selection',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'replay', 'selection'],
          [{ componentName: 'Group', pattern: '/other' }],
        );
      },
      'entry-replay-binding',
    ],
    [
      'plan branch',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'selectedBranch', 'pathname'],
          '/other',
        );
      },
      'entry-execution-plan-binding',
    ],
    [
      'candidate agreement',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'pageCandidateId'],
          'page:other',
        );
      },
      'entry-execution-plan-binding',
    ],
    [
      'role contract',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'rootRoleContract', 'sourcePath'],
          '/other',
        );
      },
      'entry-execution-plan-binding',
    ],
    [
      'recipe binding',
      (x: unknown[]) => {
        setFixtureValue(
          x,
          [-1, 'inventory', 'entries', 0, 'executionPlan', 'recipe', 'pathname'],
          '/other',
        );
      },
      'entry-execution-plan-binding',
    ],
  ] as const)('rejects AC-5 %s', (_name, mutate, expected) => {
    const corpus = structuredClone(validFixture());
    mutate(corpus);
    expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true);
  });
  it.each([
    [
      'valid duplicate',
      (x: unknown[]) => {
        const entry = fixtureValue(x, [-1, 'inventory', 'entries', 0]);
        const copy = structuredClone(entry);
        const duplicate = {
          id: 'duplicate-route',
          componentName: fixtureValue(copy, ['componentName']),
          exportName: fixtureValue(copy, ['exportName']),
          owner: fixtureValue(copy, ['owner']),
          parameters: fixtureValue(copy, ['parameters']),
          pathname: fixtureValue(copy, ['pathname']),
          pattern: fixtureValue(copy, ['pattern']),
          selection: fixtureValue(copy, ['selection']),
          sourcePath: fixtureValue(copy, ['sourcePath']),
          disposition: 'duplicate',
          duplicateOf: fixtureValue(entry, ['id']),
          reason: 'exact-semantic-route',
          replay: fixtureValue(copy, ['replay']),
        };
        fixtureArray(x, [-1, 'inventory', 'entries']).push(duplicate);
        setFixtureValue(x, [-1, 'inventory', 'counts'], {
          duplicate: 1,
          runnable: 1,
          total: 2,
          unresolved: 0,
        });
      },
      false,
    ],
    [
      'dangling duplicate',
      (x: unknown[]) => {
        const entry = fixtureValue(x, [-1, 'inventory', 'entries', 0]);
        const copy = structuredClone(entry);
        setFixtureValue(copy, ['replay', 'branchId'], 'duplicate-route');
        const duplicate = {
          id: 'duplicate-route',
          componentName: fixtureValue(copy, ['componentName']),
          exportName: fixtureValue(copy, ['exportName']),
          owner: fixtureValue(copy, ['owner']),
          parameters: fixtureValue(copy, ['parameters']),
          pathname: fixtureValue(copy, ['pathname']),
          pattern: fixtureValue(copy, ['pattern']),
          selection: fixtureValue(copy, ['selection']),
          sourcePath: fixtureValue(copy, ['sourcePath']),
          disposition: 'duplicate',
          duplicateOf: 'missing',
          reason: 'exact-semantic-route',
          replay: fixtureValue(copy, ['replay']),
        };
        fixtureArray(x, [-1, 'inventory', 'entries']).push(duplicate);
        setFixtureValue(x, [-1, 'inventory', 'counts'], {
          duplicate: 1,
          runnable: 1,
          total: 2,
          unresolved: 0,
        });
      },
      true,
    ],
    [
      'self duplicate',
      (x: unknown[]) => {
        const entry = fixtureValue(x, [-1, 'inventory', 'entries', 0]);
        const copy = structuredClone(entry);
        setFixtureValue(copy, ['replay', 'branchId'], 'duplicate-route');
        const duplicate = {
          id: 'duplicate-route',
          componentName: fixtureValue(copy, ['componentName']),
          exportName: fixtureValue(copy, ['exportName']),
          owner: fixtureValue(copy, ['owner']),
          parameters: fixtureValue(copy, ['parameters']),
          pathname: fixtureValue(copy, ['pathname']),
          pattern: fixtureValue(copy, ['pattern']),
          selection: fixtureValue(copy, ['selection']),
          sourcePath: fixtureValue(copy, ['sourcePath']),
          disposition: 'duplicate',
          duplicateOf: 'duplicate-route',
          reason: 'exact-semantic-route',
          replay: fixtureValue(copy, ['replay']),
        };
        fixtureArray(x, [-1, 'inventory', 'entries']).push(duplicate);
        setFixtureValue(x, [-1, 'inventory', 'counts'], {
          duplicate: 1,
          runnable: 1,
          total: 2,
          unresolved: 0,
        });
      },
      true,
    ],
    [
      'duplicate target cannot be duplicate',
      (x: unknown[]) => {
        const entry = fixtureValue(x, [-1, 'inventory', 'entries', 0]);
        setFixtureValue(entry, ['id'], 'runnable-route');
        setFixtureValue(entry, ['replay', 'branchId'], fixtureValue(entry, ['id']));
        setFixtureValue(entry, ['executionPlan', 'routeId'], fixtureValue(entry, ['id']));
        setFixtureValue(
          entry,
          ['executionPlan', 'selectedBranch', 'id'],
          fixtureValue(entry, ['id']),
        );
        setFixtureValue(
          entry,
          ['executionPlan', 'digest'],
          canonicalDigest(
            Object.fromEntries(
              Object.entries(fixtureObject(entry, ['executionPlan'])).filter(
                ([key]) => key !== 'digest',
              ),
            ),
          ),
        );
        const duplicate = {
          ...structuredClone(fixtureObject(entry)),
          id: 'duplicate-route',
          disposition: 'duplicate',
          duplicateOf: fixtureValue(entry, ['id']),
          reason: 'expanded-owner',
        };
        deleteFixtureValue(duplicate, ['executionPlan']);
        setFixtureValue(duplicate, ['replay', 'branchId'], fixtureValue(duplicate, ['id']));
        setFixtureValue(entry, ['disposition'], 'duplicate');
        setFixtureValue(entry, ['duplicateOf'], fixtureValue(duplicate, ['id']));
        setFixtureValue(entry, ['reason'], 'expanded-owner');
        deleteFixtureValue(entry, ['executionPlan']);
        fixtureArray(x, [-1, 'inventory', 'entries']).push(duplicate);
        setFixtureValue(x, [-1, 'inventory', 'counts'], {
          duplicate: 2,
          runnable: 0,
          total: 2,
          unresolved: 0,
        });
      },
      true,
    ],
    [
      'unresolved exact keys',
      (x: unknown[]) => {
        const unresolved = {
          id: 'unresolved-route',
          componentName: 'Missing',
          owner: { exportName: 'default', sourcePath: '/missing.tsx' },
          parameters: {},
          pathname: '/missing',
          pattern: '/missing',
          selection: [{ componentName: 'Missing', pattern: '/missing' }],
          disposition: 'unresolved',
          reason: 'component-unresolved',
          replay: {},
        };
        fixtureArray(x, [-1, 'inventory', 'entries']).push(unresolved);
        setFixtureValue(x, [-1, 'inventory', 'counts'], {
          duplicate: 0,
          runnable: 1,
          total: 2,
          unresolved: 1,
        });
      },
      true,
    ],
    [
      'unresolved blocker',
      (x: unknown[]) => {
        const unresolved = {
          id: 'unresolved-route',
          componentName: 'Missing',
          owner: { exportName: 'default', sourcePath: '/missing.tsx' },
          parameters: {},
          pathname: '/missing',
          pattern: '/missing',
          selection: [{ componentName: 'Missing', pattern: '/missing' }],
          disposition: 'unresolved',
          reason: 'unknown',
        };
        fixtureArray(x, [-1, 'inventory', 'entries']).push(unresolved);
        setFixtureValue(x, [-1, 'inventory', 'counts'], {
          duplicate: 0,
          runnable: 1,
          total: 2,
          unresolved: 1,
        });
      },
      true,
    ],
  ] as const)(
    'enforces duplicate targets and unresolved blockers: %s',
    (_name, mutate, invalid) => {
      const corpus = structuredClone(validFixture());
      mutate(corpus);
      const failed = fixtureArray(validateTrace(corpus), ['checks']).some(
        (check: unknown) => !fixtureValue(check, ['passed']),
      );
      expect(failed).toBe(invalid);
    },
  );
});
