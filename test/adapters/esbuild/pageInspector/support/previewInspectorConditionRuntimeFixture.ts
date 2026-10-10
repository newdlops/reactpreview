/** Shares an isolated condition registry with inert persistence, tracing, and notification boundaries. */
import vm from 'node:vm';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';

/** Test-only access to compiler-admitted conditions and their retained authored state. */
interface ConditionRuntimeHarness {
  readonly getRevision: () => number;
  readonly rememberDirectOwner: (exportName: string, ownerName: string) => void;
  readonly readChoices: () => readonly Record<string, unknown>[];
  readonly readConditions: () => readonly Record<string, unknown>[];
  readonly readCoherenceSources: (condition: Record<string, unknown>) => readonly string[];
  readonly readControllableConditions: () => readonly Record<string, unknown>[];
  readonly readConsoleEntries: () => readonly Record<string, unknown>[];
  readonly readFallbackValuesEnabled: () => boolean;
  readonly registerVirtualPageSource: (sourcePath: string) => boolean;
  readonly registerDefinitions: (
    sourcePath: string,
    candidates: readonly Record<string, unknown>[],
  ) => boolean;
  readonly registerSourceProvenPropChoice: (
    exportName: string,
    path: string,
    value: unknown,
    metadata?: Record<string, unknown>,
  ) => boolean;
  readonly isAutoConditionRejected: (conditionId: string, reachabilityKey: string) => boolean;
  readonly observeChoice: (
    choiceId: string,
    branchId: string,
    valueKey: string,
    value: unknown,
  ) => unknown;
  readonly resetCondition: (conditionId: string) => void;
  readonly resetChoice: (choiceId: string) => boolean;
  readonly resolveChoice: (
    choiceId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly resolveCondition: (
    conditionId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly resolveConditionLazy: (
    conditionId: string,
    evaluateAuthoredValue: () => unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly session: Record<string, unknown>;
  readonly setAutoCondition: (conditionId: string, enabled: boolean) => boolean;
  readonly setChoice: (choiceId: string, branchId: string) => boolean;
  readonly setCondition: (conditionId: string, enabled: boolean) => void;
  readonly setFallbackValuesEnabled: (enabled: boolean) => void;
  readonly serializeChoiceOverrides: () => Record<string, string>;
  readonly rollbackAutoDecision: (traceId: string) => boolean;
  readonly rollbackNoProgressAutoDecision: (traceId: string) => boolean;
}

/** Evaluates the generated lexical runtime against inert persistence and notification adapters. */
export function createConditionRuntimeHarness(
  persistedState: Record<string, unknown>,
  persistPreviewInspectorState: () => void,
  initialSession: Record<string, unknown> = {},
): ConditionRuntimeHarness {
  const source = createPreviewInspectorConditionRuntimeSource();
  const context: {
    __conditionRuntime?: ConditionRuntimeHarness;
    persistedState: Record<string, unknown>;
    persistPreviewInspectorState: () => void;
    initialSession: Record<string, unknown>;
  } = { initialSession, persistedState, persistPreviewInspectorState };
  vm.runInNewContext(
    `
      const previewInspectorSession = { ...initialSession };
      const readPersistedPreviewInspectorState = () => persistedState;
      const notifyPreviewInspector = () => undefined;
      const schedulePreviewInspectorCommitRefresh = () => undefined;
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const isPreviewInspectorNeuralSuccessfulPathRestorationActive = () =>
        previewInspectorSession.neuralSuccessfulPathRestorationActive === true;
      const findSelectedPreviewInspectorDescriptor = () =>
        previewInspectorSession.descriptors?.[0];
      const readSelectedPreviewInspectorPageCandidate = () =>
        previewInspectorSession.selectedPageCandidate;
      const isPreviewInspectorRestCollectionFillServing = () =>
        previewInspectorSession.restCollectionFillServing === true;
      const readPreviewInspectorTargetPathEvidence = (_descriptor, _candidate, state) => ({
        paths: new Set(state?.synchronousEvidencePaths ?? []),
      });
      const recordedConsoleEntries = [];
      const recordPreviewInspectorConsoleEntry = (candidate) => {
        recordedConsoleEntries.push(candidate);
        return candidate;
      };
      let automaticTraceSequence = 0;
      const recordPreviewInspectorBlockerAutoDecision = (candidate) => {
        if (candidate?.startsRenderAttempt !== true) return undefined;
        automaticTraceSequence += 1;
        return 'condition-trace-' + String(automaticTraceSequence);
      };
      ${source}
      globalThis.__conditionRuntime = {
        getRevision: readPreviewInspectorRenderConditionRevision,
        rememberDirectOwner: (exportName, ownerName) => {
          previewInspectorSession.directTargetRuntimeOwnerNamesByExport = new Map([
            [exportName, new Set([ownerName])],
          ]);
        },
        readChoices: readPreviewInspectorRenderChoices,
        readConditions: readPreviewInspectorRenderConditions,
        readCoherenceSources: readPreviewInspectorScalarCoherenceSources,
        readControllableConditions: readPreviewInspectorControllableRenderConditions,
        readConsoleEntries: () => recordedConsoleEntries.slice(),
        readFallbackValuesEnabled: readPreviewInspectorFallbackValuesEnabled,
        registerDefinitions: registerPreviewInspectorRenderConditionDefinitions,
        registerSourceProvenPropChoice: registerPreviewInspectorSourceProvenPropChoice,
        registerVirtualPageSource: registerPreviewInspectorVirtualPageSource,
        isAutoConditionRejected: isPreviewInspectorTargetGuidedConditionRejected,
        observeChoice: observePreviewInspectorRenderChoiceCase,
        resetCondition: resetPreviewInspectorRenderConditionOverride,
        resetChoice: resetPreviewInspectorRenderChoiceOverride,
        resolveChoice: resolvePreviewInspectorRenderChoice,
        resolveCondition: resolvePreviewInspectorRenderCondition,
        resolveConditionLazy: resolvePreviewInspectorRenderConditionLazy,
        rollbackAutoDecision: rollbackPreviewInspectorFailedAutoDecision,
        rollbackNoProgressAutoDecision: rollbackPreviewInspectorNoProgressAutoDecision,
        session: previewInspectorSession,
        setAutoCondition: setPreviewInspectorTargetGuidedConditionOverride,
        setChoice: setPreviewInspectorRenderChoiceOverride,
        setCondition: setPreviewInspectorRenderConditionOverride,
        setFallbackValuesEnabled: setPreviewInspectorFallbackValuesEnabled,
        serializeChoiceOverrides: serializePreviewInspectorRenderChoiceOverrides,
      };
    `,
    context,
  );
  if (context.__conditionRuntime === undefined) {
    throw new Error('Condition runtime fixture did not initialize.');
  }
  return context.__conditionRuntime;
}
