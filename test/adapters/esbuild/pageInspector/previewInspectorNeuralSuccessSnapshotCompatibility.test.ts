/**
 * Verifies the growth rule of neural success checkpoints: components mounted after a checkpoint may
 * add requests, hooks, and their own guard choices, while every value the checkpoint owns stays.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralSuccessSnapshotRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessSnapshotRuntimeSource';

const CHECKPOINT = {
  conditionEntries: [['shell-gate', false]],
  dataAutoEnabled: true,
  dataPayloadEntries: [['orders', { mode: 'smart', payload: { items: [] } }]],
  dataRequestIds: ['orders'],
  exportName: 'default',
  fallbackValuesEnabled: true,
  fingerprint: 'checkpoint',
  hasResolverProps: false,
  knownConditionIds: ['list-gate', 'shell-gate'],
  pageCandidateId: 'candidate',
  pageExecutionContext: { contextComplete: true, executionCandidateId: 'page', fidelity: 'full' },
  resolverProps: undefined,
  runtimeFallbackIds: ['auth'],
  runtimeFallbackSmartIds: [],
  runtimeFallbackSmartPathEntries: [],
  runtimeFallbackValueEntries: [['auth', { id: 'preview-id' }]],
  temporalState: {
    applicationPath: ['App'],
    conditionEntries: [],
    fingerprint: 'terminal',
    kind: 'terminal-stable',
    pageCandidateId: 'candidate',
    runtimeStateEntries: [{ fallbackId: 'auth', path: 'status', transient: false, value: 'done' }],
    targetExportName: 'default',
  },
};

/** A later panel registered its request and hook and opened its own guard. */
const GROWN = {
  ...CHECKPOINT,
  conditionEntries: [
    ['panel-gate', false],
    ['shell-gate', false],
  ],
  dataPayloadEntries: [...CHECKPOINT.dataPayloadEntries, ['panel', { mode: 'smart', payload: {} }]],
  dataRequestIds: ['orders', 'panel'],
  fingerprint: 'grown',
  runtimeFallbackIds: ['auth', 'panel-hook'],
  runtimeFallbackValueEntries: [...CHECKPOINT.runtimeFallbackValueEntries, ['panel-hook', 1]],
  temporalState: {
    ...CHECKPOINT.temporalState,
    fingerprint: 'grown-temporal',
    kind: 'transient-checkpoint',
    runtimeStateEntries: [
      ...CHECKPOINT.temporalState.runtimeStateEntries,
      { fallbackId: 'panel-hook', path: 'isLoading', transient: true, value: true },
    ],
  },
};

describe('neural success checkpoint growth', () => {
  /** Later components may add requests, hooks, overrides, guards, and their own loading state. */
  it('accepts a grown viewer state and the exact checkpoint', () => {
    const compatible = createCompatibility();

    expect(compatible(CHECKPOINT, CHECKPOINT)).toBe(true);
    expect(compatible(GROWN, CHECKPOINT)).toBe(true);
  });

  /** Owned values, ids, overrides, and known guards must persist exactly. */
  it.each([
    ['a changed owned hook value', { runtimeFallbackValueEntries: [['auth', { id: 'other' }]] }],
    ['a removed request', { dataRequestIds: ['panel'] }],
    [
      'an override added to an existing request',
      { dataPayloadEntries: [['orders', { mode: 'custom', payload: {} }]] },
    ],
    [
      'a known guard forced later',
      {
        conditionEntries: [
          ['list-gate', true],
          ['shell-gate', false],
        ],
      },
    ],
    ['a different page candidate', { pageCandidateId: 'other' }],
  ])('rejects %s', (_label, change) => {
    expect(createCompatibility()({ ...GROWN, ...change }, CHECKPOINT)).toBe(false);
  });

  /** A checkpoint may only turn transient through hooks that mounted after it. */
  it('rejects transient state owned by the checkpoint and older checkpoints with new guards', () => {
    const compatible = createCompatibility();
    const ownedLoading = {
      ...GROWN,
      temporalState: {
        ...GROWN.temporalState,
        runtimeStateEntries: [{ fallbackId: 'auth', path: 'status', transient: true, value: 'x' }],
      },
    };
    const olderCheckpoint: Record<string, unknown> = { ...CHECKPOINT };
    delete olderCheckpoint.knownConditionIds;

    expect(compatible(ownedLoading, CHECKPOINT)).toBe(false);
    expect(compatible(GROWN, olderCheckpoint)).toBe(false);
    expect(
      compatible({ ...GROWN, conditionEntries: CHECKPOINT.conditionEntries }, olderCheckpoint),
    ).toBe(true);
  });
});

/** Evaluates the snapshot fragment and exposes its compatibility check. */
function createCompatibility(): (current: unknown, checkpoint: unknown) => boolean {
  const context = vm.createContext({ previewInspectorSession: {} });
  vm.runInContext(createPreviewInspectorNeuralSuccessSnapshotRuntimeSource(), context);
  const check = context.isPreviewInspectorNeuralSuccessSnapshotCompatible as (
    current: unknown,
    checkpoint: unknown,
  ) => boolean;
  return (current, checkpoint) => check(current, checkpoint);
}
