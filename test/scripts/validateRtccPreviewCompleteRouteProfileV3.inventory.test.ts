/** Verifies inventory and execution-plan bindings using only in-memory malformed fixtures. */
import './rtccReconstructedSetup';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';
import { mountFallbackEvidenceDigest } from '../../scripts/validation/rtcc-v3-inventory-execution-plan.mjs';
import {
  validFixture,
  validMultiMountFixture,
  validPageRootFixture,
} from '../support/rtccV3Fixture';
import {
  deleteFixtureValue,
  fixtureArray,
  fixtureObject,
  fixtureValue,
  setFixtureValue,
} from '../support/rtccV3Mutation';
import {
  checkFailed,
  policy,
  recomputePlanDigest,
  reorder,
  reorderInPlace,
  temporaryDirectories,
} from './validateRtccPreviewCompleteRouteProfileV3Fixtures';
afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});
describe('complete-route profile v3', () => {
  it.each([
    ['variant A', (entry: unknown) => entry, false],
    [
      'variant B',
      (entry: unknown) => ({
        id: fixtureValue(entry, ['id']),
        componentName: fixtureValue(entry, ['componentName']),
        exportName: 'default',
        owner: fixtureValue(entry, ['owner']),
        parameters: fixtureValue(entry, ['parameters']),
        pathname: fixtureValue(entry, ['pathname']),
        pattern: fixtureValue(entry, ['pattern']),
        selection: fixtureValue(entry, ['selection']),
        sourcePath: '/missing.tsx',
        disposition: fixtureValue(entry, ['disposition']),
        reason: fixtureValue(entry, ['reason']),
      }),
      false,
    ],
    ['export only', (entry: unknown) => ({ ...fixtureObject(entry), exportName: 'default' }), true],
    [
      'source only',
      (entry: unknown) => ({ ...fixtureObject(entry), sourcePath: '/missing.tsx' }),
      true,
    ],
    [
      'empty export',
      (entry: unknown) => ({
        id: fixtureValue(entry, ['id']),
        componentName: fixtureValue(entry, ['componentName']),
        exportName: '',
        owner: fixtureValue(entry, ['owner']),
        parameters: fixtureValue(entry, ['parameters']),
        pathname: fixtureValue(entry, ['pathname']),
        pattern: fixtureValue(entry, ['pattern']),
        selection: fixtureValue(entry, ['selection']),
        sourcePath: '/missing.tsx',
        disposition: fixtureValue(entry, ['disposition']),
        reason: fixtureValue(entry, ['reason']),
      }),
      true,
    ],
    [
      'empty source',
      (entry: unknown) => ({
        id: fixtureValue(entry, ['id']),
        componentName: fixtureValue(entry, ['componentName']),
        exportName: 'default',
        owner: fixtureValue(entry, ['owner']),
        parameters: fixtureValue(entry, ['parameters']),
        pathname: fixtureValue(entry, ['pathname']),
        pattern: fixtureValue(entry, ['pattern']),
        selection: fixtureValue(entry, ['selection']),
        sourcePath: '',
        disposition: fixtureValue(entry, ['disposition']),
        reason: fixtureValue(entry, ['reason']),
      }),
      true,
    ],
    ['reordered', (entry: unknown) => reorder(entry), true],
    ['extra', (entry: unknown) => ({ ...fixtureObject(entry), extra: true }), true],
  ] as const)('enforces unresolved exact union %s', (_name, create, invalid) => {
    const corpus = validFixture();
    const entry = {
      id: 'unresolved',
      componentName: 'Missing',
      owner: { exportName: 'default', sourcePath: '/missing.tsx' },
      parameters: {},
      pathname: '/missing',
      pattern: '/missing',
      selection: [{ componentName: 'Missing', pattern: '/missing' }],
      disposition: 'unresolved',
      reason: 'component-unresolved',
    };
    fixtureArray(corpus, [-1, 'inventory', 'entries']).push(create(entry));
    setFixtureValue(corpus, [-1, 'inventory', 'counts'], {
      duplicate: 0,
      runnable: 1,
      total: 2,
      unresolved: 1,
    });
    expect(
      fixtureArray(
        validateTrace(corpus, {
          ...policy,
          inventory: { ...policy.inventory, total: 2, unresolved: 1 },
        }),
        ['checks'],
      ).some((check: unknown) => !fixtureValue(check, ['passed'])),
    ).toBe(invalid);
  });
  it.each([
    [
      'own fields differ',
      (duplicate: unknown) => {
        setFixtureValue(duplicate, ['componentName'], 'Different');
        setFixtureValue(duplicate, ['exportName'], 'named');
        setFixtureValue(duplicate, ['owner'], {
          exportName: 'owner',
          sourcePath: '/different.tsx',
        });
        setFixtureValue(duplicate, ['parameters'], { other: '1' });
        setFixtureValue(duplicate, ['pathname'], '/different');
        setFixtureValue(duplicate, ['pattern'], '/different');
        setFixtureValue(
          duplicate,
          ['selection'],
          [{ componentName: 'Different', pattern: '/different' }],
        );
        setFixtureValue(duplicate, ['sourcePath'], '/different.tsx');
      },
      false,
    ],
    [
      'target replay id mismatch',
      (duplicate: unknown) => {
        setFixtureValue(duplicate, ['replay', 'branchId'], 'other');
      },
      true,
    ],
    [
      'dangling target',
      (duplicate: unknown) => {
        setFixtureValue(duplicate, ['duplicateOf'], 'missing');
      },
      true,
    ],
    [
      'non-runnable target',
      (duplicate: unknown, corpus: unknown) => {
        setFixtureValue(corpus, [-1, 'inventory', 'entries', 0, 'disposition'], 'unresolved');
        deleteFixtureValue(corpus, [-1, 'inventory', 'entries', 0, 'replay']);
        deleteFixtureValue(corpus, [-1, 'inventory', 'entries', 0, 'executionPlan']);
        setFixtureValue(corpus, [-1, 'inventory', 'entries', 0, 'reason'], 'component-unresolved');
      },
      true,
    ],
    [
      'self target',
      (duplicate: unknown) => {
        setFixtureValue(duplicate, ['duplicateOf'], fixtureValue(duplicate, ['id']));
      },
      true,
    ],
    [
      'unequal target replay',
      (duplicate: unknown) => {
        setFixtureValue(duplicate, ['replay', 'pathname'], '/other');
      },
      true,
    ],
  ] as const)('enforces duplicate replay binding %s', (_name, mutate, invalid) => {
    const corpus = validFixture();
    const target = fixtureValue(corpus, [-1, 'inventory', 'entries', 0]);
    const duplicate = {
      id: 'duplicate',
      componentName: fixtureValue(target, ['componentName']),
      exportName: fixtureValue(target, ['exportName']),
      owner: fixtureValue(target, ['owner']),
      parameters: fixtureValue(target, ['parameters']),
      pathname: fixtureValue(target, ['pathname']),
      pattern: fixtureValue(target, ['pattern']),
      selection: fixtureValue(target, ['selection']),
      sourcePath: fixtureValue(target, ['sourcePath']),
      disposition: 'duplicate',
      duplicateOf: fixtureValue(target, ['id']),
      reason: 'exact-semantic-route',
      replay: structuredClone(fixtureValue(target, ['replay'])),
    };
    fixtureArray(corpus, [-1, 'inventory', 'entries']).push(duplicate);
    setFixtureValue(corpus, [-1, 'inventory', 'counts'], {
      duplicate: 1,
      runnable: 1,
      total: 2,
      unresolved: 0,
    });
    mutate(duplicate, corpus);
    expect(
      fixtureArray(
        validateTrace(corpus, {
          ...policy,
          inventory: { ...policy.inventory, total: 2, duplicate: 1 },
        }),
        ['checks'],
      ).some((check: unknown) => !fixtureValue(check, ['passed'])),
    ).toBe(invalid);
  });
  it.each(['maximumAnalysisPasses', 'maximumBranches', 'maximumDepth'] as const)(
    'rejects positive limit drift %s',
    (key) => {
      const corpus = validFixture();
      const expected = fixtureValue(corpus, [-1, 'inventory', 'limits', key]);
      if (typeof expected !== 'number') throw new Error('Expected numeric fixture limit.');
      setFixtureValue(corpus, [-1, 'inventory', 'limits', key], expected + 1);
      const result = validateTrace(corpus, {
        ...policy,
        inventory: { ...policy.inventory, [key]: expected },
      });
      expect(checkFailed(result, 'inventory-policy')).toBe(true);
    },
  );
  it('rejects replay and execution-plan policy drift even when local bindings and digest are recomputed', () => {
    const replayCorpus = validFixture();
    const replayDigest = 'a'.repeat(64);
    setFixtureValue(replayCorpus, [-1, 'inventory', 'replayPolicy', 'digest'], replayDigest);
    setFixtureValue(
      replayCorpus,
      [-1, 'inventory', 'entries', 0, 'replay', 'policyDigest'],
      replayDigest,
    );
    expect(
      checkFailed(
        validateTrace(replayCorpus, {
          ...policy,
          inventory: { ...policy.inventory, replayPolicyDigest: canonicalDigest('replay-policy') },
        }),
        'inventory-policy',
      ),
    ).toBe(true);
    const planCorpus = validFixture();
    const expected = fixtureValue(planCorpus, [
      -1,
      'inventory',
      'entries',
      0,
      'executionPlan',
      'policyDigest',
    ]);
    setFixtureValue(
      planCorpus,
      [-1, 'inventory', 'entries', 0, 'executionPlan', 'policyDigest'],
      'b'.repeat(64),
    );
    recomputePlanDigest(fixtureValue(planCorpus, [-1, 'inventory', 'entries', 0, 'executionPlan']));
    expect(
      checkFailed(
        validateTrace(planCorpus, {
          ...policy,
          inventory: { ...policy.inventory, executionPlanPolicyDigest: expected },
        }),
        'execution-plan-policy',
      ),
    ).toBe(true);
  });
  it.each([
    [
      'mount order',
      (entry: unknown) => {
        reorderInPlace(fixtureValue(entry, ['executionPlan', 'recipe', 'mounts', 0]));
      },
      'execution-plan-schema',
    ],
    [
      'recipe order',
      (entry: unknown) => {
        reorderInPlace(fixtureValue(entry, ['executionPlan', 'recipe']));
      },
      'execution-plan-schema',
    ],
    [
      'execution root',
      (entry: unknown) => {
        for (const role of [
          fixtureValue(entry, ['executionPlan', 'executionRoot']),
          fixtureValue(entry, ['executionPlan', 'rootRoleContract']),
          fixtureValue(entry, ['executionPlan', 'ownerChain', 0]),
        ])
          setFixtureValue(role, ['sourcePath'], '/other-root.tsx');
      },
      'entry-execution-plan-binding',
    ],
    [
      'owner chain',
      (entry: unknown) => {
        fixtureArray(entry, ['executionPlan', 'ownerChain']).push({
          basePattern: '/other',
          exportName: 'Other',
          sourcePath: '/other.tsx',
        });
      },
      'entry-execution-plan-binding',
    ],
    [
      'runtime',
      (entry: unknown) => {
        for (const role of [
          fixtureValue(entry, ['executionPlan', 'runtimeTarget']),
          fixtureValue(entry, ['executionPlan', 'targetRoleContract']),
        ])
          setFixtureValue(role, ['sourcePath'], '/other-target.tsx');
      },
      'entry-execution-plan-binding',
    ],
    [
      'role',
      (entry: unknown) => {
        setFixtureValue(
          entry,
          ['executionPlan', 'rootRoleContract', 'sourcePath'],
          '/other-role.tsx',
        );
      },
      'entry-execution-plan-binding',
    ],
    [
      'recipe',
      (entry: unknown) => {
        setFixtureValue(entry, ['executionPlan', 'recipe', 'params'], { groupId: '43' });
      },
      'entry-execution-plan-binding',
    ],
  ] as const)('rejects recomputed-digest deep plan drift %s', (_name, mutate, expected) => {
    const corpus = validFixture();
    const entry = fixtureValue(corpus, [-1, 'inventory', 'entries', 0]);
    mutate(entry);
    recomputePlanDigest(fixtureValue(entry, ['executionPlan']));
    expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true);
  });
  it.each([
    [
      'reversed array',
      (mounts: unknown[]) => {
        fixtureArray(mounts, []).reverse();
      },
    ],
    [
      'removed mount',
      (mounts: unknown[]) => {
        fixtureArray(mounts, []).splice(1, 1);
      },
    ],
    [
      'duplicated mount',
      (mounts: unknown[]) => {
        fixtureArray(mounts, []).splice(1, 0, structuredClone(fixtureValue(mounts, [0])));
      },
    ],
    [
      'basePath value',
      (mounts: unknown[]) => {
        setFixtureValue(mounts, [0, 'basePath'], '/other');
      },
    ],
    [
      'childSurfaceId value',
      (mounts: unknown[]) => {
        setFixtureValue(mounts, [0, 'childSurfaceId'], 'surface:other');
      },
    ],
    [
      'contextPattern value',
      (mounts: unknown[]) => {
        setFixtureValue(mounts, [0, 'contextPattern'], '/other/*');
      },
    ],
    [
      'contextPattern presence',
      (mounts: unknown[]) => {
        deleteFixtureValue(mounts, [0, 'contextPattern']);
      },
    ],
    [
      'parentSurfaceId value',
      (mounts: unknown[]) => {
        setFixtureValue(mounts, [0, 'parentSurfaceId'], 'surface:other');
      },
    ],
    [
      'parentSurfaceId presence',
      (mounts: unknown[]) => {
        deleteFixtureValue(mounts, [0, 'parentSurfaceId']);
      },
    ],
    [
      'pattern value',
      (mounts: unknown[]) => {
        setFixtureValue(mounts, [0, 'pattern'], '/other/:id');
      },
    ],
  ] as const)('rejects recomputed-digest mount %s drift', (_name, mutate) => {
    const corpus = validMultiMountFixture();
    const entry = fixtureValue(corpus, [-1, 'inventory', 'entries', 0]);
    mutate(fixtureArray(entry, ['executionPlan', 'recipe', 'mounts']));
    recomputePlanDigest(fixtureValue(entry, ['executionPlan']));
    expect(checkFailed(validateTrace(corpus, policy), 'entry-execution-plan-binding')).toBe(true);
  });
  it('rejects recomputed-digest hasWildcardFallback drift against authority-bound evidence', () => {
    const corpus = validMultiMountFixture();
    const entry = fixtureValue(corpus, [-1, 'inventory', 'entries', 0]);
    const expected = mountFallbackEvidenceDigest(
      fixtureValue(corpus, [-1, 'inventory', 'entries']),
    );
    setFixtureValue(
      entry,
      ['executionPlan', 'recipe', 'mounts', 0, 'hasWildcardFallback'],
      !fixtureValue(entry, ['executionPlan', 'recipe', 'mounts', 0, 'hasWildcardFallback']),
    );
    recomputePlanDigest(fixtureValue(entry, ['executionPlan']));
    const result = validateTrace(corpus, {
      ...policy,
      inventory: { ...policy.inventory, mountFallbackEvidenceDigest: expected },
    });
    expect(checkFailed(result, 'inventory-policy')).toBe(true);
  });
  it('rejects conflicting fallback evidence for the same owner and selection across entries', () => {
    const corpus = validMultiMountFixture();
    const copy = structuredClone(fixtureValue(corpus, [-1, 'inventory', 'entries', 0]));
    setFixtureValue(copy, ['id'], 'synthetic-route-18');
    setFixtureValue(copy, ['replay', 'branchId'], fixtureValue(copy, ['id']));
    setFixtureValue(copy, ['executionPlan', 'routeId'], fixtureValue(copy, ['id']));
    setFixtureValue(copy, ['executionPlan', 'selectedBranch', 'id'], fixtureValue(copy, ['id']));
    setFixtureValue(
      copy,
      ['executionPlan', 'recipe', 'mounts', 0, 'hasWildcardFallback'],
      !fixtureValue(copy, ['executionPlan', 'recipe', 'mounts', 0, 'hasWildcardFallback']),
    );
    recomputePlanDigest(fixtureValue(copy, ['executionPlan']));
    fixtureArray(corpus, [-1, 'inventory', 'entries']).push(copy);
    setFixtureValue(corpus, [-1, 'inventory', 'counts'], {
      duplicate: 0,
      runnable: 2,
      total: 2,
      unresolved: 0,
    });
    const result = validateTrace(corpus, {
      ...policy,
      inventory: { ...policy.inventory, runnable: 2, total: 2 },
    });
    expect(checkFailed(result, 'duplicate-reference-graph')).toBe(true);
  });
  it.each([
    ['multi-mount route-root', validMultiMountFixture],
    ['page-root', validPageRootFixture],
  ] as const)('rejects coordinated final selection drift for %s', (_name, create) => {
    const corpus = create();
    const entry = fixtureValue(corpus, [-1, 'inventory', 'entries', 0]);
    for (const selection of [
      fixtureValue(entry, ['selection']),
      fixtureValue(entry, ['replay', 'selection']),
      fixtureValue(entry, ['executionPlan', 'selection']),
    ])
      setFixtureValue(selection, [-1, 'pattern'], '/coordinated/:id');
    recomputePlanDigest(fixtureValue(entry, ['executionPlan']));
    const result = validateTrace(corpus, policy);
    expect(checkFailed(result, 'entry-replay-binding')).toBe(false);
    expect(checkFailed(result, 'entry-execution-plan-binding')).toBe(true);
  });
});
