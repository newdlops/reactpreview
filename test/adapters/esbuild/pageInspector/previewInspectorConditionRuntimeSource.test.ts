/** Exercises Page Inspector branch overrides and automatic-value state without mounting React. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';

interface ConditionRuntimeHarness {
  readonly getRevision: () => number;
  readonly readConditions: () => readonly Record<string, unknown>[];
  readonly readFallbackValuesEnabled: () => boolean;
  readonly resetCondition: (conditionId: string) => void;
  readonly resolveCondition: (
    conditionId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly session: Record<string, unknown>;
  readonly setCondition: (conditionId: string, enabled: boolean) => void;
  readonly setFallbackValuesEnabled: (enabled: boolean) => void;
}

describe('Preview Inspector condition runtime source', () => {
  /** Preserves authored values until an explicit branch override is selected. */
  it('resolves authored, forced false, forced true, and reset states', async () => {
    const persist = vi.fn();
    const harness = createConditionRuntimeHarness({}, persist);
    const truthyValue = { loaded: true };
    const metadata = {
      expression: 'data',
      falsyLabel: '<LoadingFallback>',
      kind: 'ternary',
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<Content>',
    };

    expect(harness.resolveCondition('condition-1', truthyValue, metadata)).toBe(truthyValue);
    await Promise.resolve();
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: true,
      effectiveEnabled: true,
      override: undefined,
    });

    harness.setCondition('condition-1', false);
    expect(harness.resolveCondition('condition-1', truthyValue, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({ effectiveEnabled: false, override: false });

    harness.setCondition('condition-1', true);
    expect(harness.resolveCondition('condition-1', false, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({ effectiveEnabled: true, override: true });

    harness.resetCondition('condition-1');
    expect(harness.resolveCondition('condition-1', false, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: false,
      effectiveEnabled: false,
      override: undefined,
    });
    expect(harness.getRevision()).toBe(3);
    expect(persist).toHaveBeenCalledTimes(3);
  });

  /** Restores the persisted automatic-value preference and advances the shared remount revision. */
  it('toggles preview-generated fallback values independently from branch overrides', () => {
    const harness = createConditionRuntimeHarness({ fallbackValuesEnabled: false }, vi.fn());

    expect(harness.readFallbackValuesEnabled()).toBe(false);
    harness.setFallbackValuesEnabled(true);

    expect(harness.readFallbackValuesEnabled()).toBe(true);
    expect(harness.getRevision()).toBe(1);
  });

  /** Preserves compiler-proven overlay role metadata for the component-tree presentation layer. */
  it('retains bounded overlay visibility metadata', async () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());

    harness.resolveCondition('overlay-condition', false, {
      expression: '<DeleteModal>.open: open',
      falsyLabel: 'hidden <DeleteModal> overlay',
      kind: 'overlay-visibility',
      role: 'overlay',
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: 'visible <DeleteModal> overlay',
    });
    await Promise.resolve();

    expect(harness.readConditions()[0]).toMatchObject({
      kind: 'overlay-visibility',
      role: 'overlay',
    });
  });
});

/** Evaluates the generated lexical runtime against inert persistence and notification adapters. */
function createConditionRuntimeHarness(
  persistedState: Record<string, unknown>,
  persistPreviewInspectorState: () => void,
): ConditionRuntimeHarness {
  const source = createPreviewInspectorConditionRuntimeSource();
  const context: {
    __conditionRuntime?: ConditionRuntimeHarness;
    persistedState: Record<string, unknown>;
    persistPreviewInspectorState: () => void;
  } = { persistedState, persistPreviewInspectorState };
  vm.runInNewContext(
    `
      const previewInspectorSession = {};
      const readPersistedPreviewInspectorState = () => persistedState;
      const notifyPreviewInspector = () => undefined;
      const schedulePreviewInspectorCommitRefresh = () => undefined;
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      ${source}
      globalThis.__conditionRuntime = {
        getRevision: readPreviewInspectorRenderConditionRevision,
        readConditions: readPreviewInspectorRenderConditions,
        readFallbackValuesEnabled: readPreviewInspectorFallbackValuesEnabled,
        resetCondition: resetPreviewInspectorRenderConditionOverride,
        resolveCondition: resolvePreviewInspectorRenderCondition,
        session: previewInspectorSession,
        setCondition: setPreviewInspectorRenderConditionOverride,
        setFallbackValuesEnabled: setPreviewInspectorFallbackValuesEnabled,
      };
    `,
    context,
  );
  if (context.__conditionRuntime === undefined) {
    throw new Error('Condition runtime fixture did not initialize.');
  }
  return context.__conditionRuntime;
}
