/** Verifies that successful viewer recipes preserve non-prop runtime value contracts. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralPageGenerationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralPageGenerationRuntimeSource';
import { createPreviewInspectorNeuralSuccessSnapshotRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessSnapshotRuntimeSource';

interface NeuralSuccessSnapshotFixture {
  readonly copy: (value: unknown) => unknown;
  readonly restore: (value: unknown) => unknown;
}

/** Evaluates only the snapshot copier with the production object-only props normalizer present. */
function createNeuralSuccessSnapshotFixture(): NeuralSuccessSnapshotFixture {
  const sandbox: { __fixture?: NeuralSuccessSnapshotFixture } = {};
  vm.runInNewContext(
    `
      const copyPreviewInspectorBlockerValueForJson = (value) => {
        if (typeof value === 'function') return '[Preview no-op function]';
        if (Array.isArray(value)) return value.map(copyPreviewInspectorBlockerValueForJson);
        if (value === null || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [
          key,
          copyPreviewInspectorBlockerValueForJson(child),
        ]));
      };
      const normalizePreviewInspectorProps = (value) => {
        const normalized = Object.create(null);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return normalized;
        return Object.assign(normalized, value);
      };
      const materializePreviewInspectorRuntimeFallbackOverride = (value) => {
        if (value === '[Preview no-op function]') return () => undefined;
        if (Array.isArray(value)) return value.map(materializePreviewInspectorRuntimeFallbackOverride);
        if (value === null || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [
          key,
          materializePreviewInspectorRuntimeFallbackOverride(child),
        ]));
      };
      ${createPreviewInspectorNeuralSuccessSnapshotRuntimeSource()}
      globalThis.__fixture = {
        copy: copyPreviewInspectorNeuralSuccessValue,
        restore: restorePreviewInspectorNeuralSuccessRuntimeFallbackValue,
      };
    `,
    sandbox,
  );
  if (sandbox.__fixture === undefined) throw new Error('Snapshot fixture did not initialize.');
  return sandbox.__fixture;
}

describe('Preview Inspector neural success snapshot runtime source', () => {
  /** Passive observed values are not controls; explicit choices and active hooks still own their id. */
  it.each(['observation', 'smart', 'signature', 'manual', 'active'])(
    'keeps %s hook disappearance consistent with the state that a checkpoint can restore',
    (mode) => {
      const sandbox: { __result?: unknown } = {};
      vm.runInNewContext(
        `
          const mode = ${JSON.stringify(mode)};
          const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT = 64;
          const previewInspectorSession = {
            selectedExportName: 'Panel', selectedPageCandidateId: 'page',
            runtimeFallbacks: new Map([
              ['context', { passive: mode !== 'active' }], ['query', {}],
            ]),
            runtimeFallbackValues: new Map([
              ['context', { id: 'observed-provider' }], ['query', { rows: [1] }],
            ]),
            runtimeFallbackSmartIds: new Set(mode === 'smart' ? ['context'] : []),
            runtimeFallbackSmartPathSignatures:
              new Map(mode === 'signature' ? [['context', 'rows[].id']] : []),
            runtimeFallbackOverrides: new Map(mode === 'manual' ? [['context', {}]] : []),
          };
          ${createPreviewInspectorNeuralSuccessSnapshotRuntimeSource()}
          const checkpoint = createPreviewInspectorNeuralSuccessSnapshot({ targetExportName: 'Panel' });
          previewInspectorSession.runtimeFallbacks.delete('context');
          const current = createPreviewInspectorNeuralSuccessSnapshot({ targetExportName: 'Panel' });
          globalThis.__result = {
            ids: checkpoint.runtimeFallbackIds,
            valueIds: checkpoint.runtimeFallbackValueEntries.map(([id]) => id),
            compatible: isPreviewInspectorNeuralSuccessSnapshotCompatible(current, checkpoint),
          };
        `,
        sandbox,
      );

      const controlled = mode !== 'observation';
      expect(sandbox.__result).toEqual({
        ids: controlled ? ['context', 'query'] : ['query'],
        valueIds: controlled ? ['context', 'query'] : ['query'],
        compatible: !controlled,
      });
    },
  );

  /** Filtering observations cannot consume the existing bounded slots needed for active values. */
  it('preserves admitted control values when passive records sort before the bounded inventory', () => {
    const sandbox: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT = 2;
        const previewInspectorSession = {
          selectedExportName: 'Panel',
          runtimeFallbacks: new Map([
            ['a-observed', { passive: true }], ['b-observed', { passive: true }],
            ['c-query', {}], ['d-query', {}], ['e-query', {}],
          ]),
          runtimeFallbackValues: new Map([
            ['a-observed', 0], ['b-observed', 0], ['c-query', 1], ['d-query', 2], ['e-query', 3],
          ]),
        };
        ${createPreviewInspectorNeuralSuccessSnapshotRuntimeSource()}
        const snapshot = createPreviewInspectorNeuralSuccessSnapshot({ targetExportName: 'Panel' });
        globalThis.__result = {
          ids: snapshot.runtimeFallbackIds, values: snapshot.runtimeFallbackValueEntries,
        };
      `,
      sandbox,
    );

    expect(sandbox.__result).toEqual({
      ids: ['c-query', 'd-query'],
      values: [
        ['c-query', 1],
        ['d-query', 2],
      ],
    });
  });

  it('preserves an exact collection root instead of coercing it through props normalization', () => {
    const fixture = createNeuralSuccessSnapshotFixture();

    expect(fixture.copy(['read:patients'])).toEqual(['read:patients']);
    expect(fixture.copy('ready')).toBe('ready');
  });

  it('rematerializes generated hook callbacks when restoring a successful collection', () => {
    const fixture = createNeuralSuccessSnapshotFixture();
    const restored = fixture.restore(['read:patients', () => undefined]) as unknown[];

    expect(restored[0]).toBe('read:patients');
    expect(typeof restored[1]).toBe('function');
  });

  it('preserves a hook collection while restoring the next neural path baseline', () => {
    const sandbox: { __restored?: unknown } = {};
    vm.runInNewContext(
      `
        const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT = 64;
        const previewEntryRevision = 3;
        const copyPreviewInspectorBlockerValueForJson = (value) =>
          JSON.parse(JSON.stringify(value));
        const normalizePreviewInspectorProps = (value) => Array.isArray(value) ? {} : value;
        const materializePreviewInspectorRuntimeFallbackOverride = (value) => value;
        const previewInspectorSession = {
          activeTargetReachabilityKey: 'page:Patients',
          fallbackValuesEnabled: true,
          propsRevisionByExport: new Map([['Patients', 0]]),
          renderConditionAutoAttempts: new Map(),
          renderConditionAutoOverrides: new Map(),
          renderConditionOverrides: new Map(),
          renderConditionRejectedAutoOverridesByKey: new Map(),
          renderConditionRevision: 0,
          renderConditions: new Map(),
          resolverPropsByExport: new Map(),
          runtimeFallbackOverrides: new Map(),
          runtimeFallbackSmartIds: new Set(),
          runtimeFallbackSmartPathSignatures: new Map(),
          runtimeFallbackValues: new Map([['permissions', [{}]]]),
        };
        ${createPreviewInspectorNeuralSuccessSnapshotRuntimeSource()}
        ${createPreviewInspectorNeuralPageGenerationRuntimeSource()}
        restorePreviewInspectorNeuralPageGenerationBaseline({
          conditionEntries: [],
          exportName: 'Patients',
          fallbackValuesEnabled: true,
          hasResolverProps: false,
          runtimeFallbackSmartIds: ['permissions'],
          runtimeFallbackSmartPathEntries: [['permissions', '["[]"]']],
          runtimeFallbackValueEntries: [['permissions', ['read:patients']]],
        });
        globalThis.__restored = previewInspectorSession.runtimeFallbackValues.get('permissions');
      `,
      sandbox,
    );

    expect(sandbox.__restored).toEqual(['read:patients']);
  });
});
