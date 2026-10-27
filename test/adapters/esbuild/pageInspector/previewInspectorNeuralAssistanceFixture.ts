/** Shared vm fixture for the neural assistance runtime source tests. */
import vm from 'node:vm';
import { createPreviewInspectorNeuralAssistanceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceRuntimeSource';
export interface AssistanceFixture {
  readonly availability: () => {
    readonly actionable: boolean;
    readonly blockerCount: number;
    readonly choiceAttempt?: number;
    readonly choiceAvailable: boolean;
    readonly choiceCount?: number;
    readonly learning: boolean;
    readonly mode: 'choice' | 'none' | 'resolve' | 'review';
    readonly modelUpdates: number;
    readonly pending: boolean;
    readonly refining: boolean;
    readonly rendered: boolean;
    readonly title: string;
    readonly verifying: boolean;
  };
  readonly activate: () => boolean;
  readonly applyChoices: (choice: unknown, selectedIndexes: Record<string, number>) => boolean;
  readonly choice: (options?: Record<string, unknown>) => unknown;
  readonly calls: {
    readonly choiceAttempts: readonly {
      readonly automatic?: boolean;
      readonly candidateId?: string;
      readonly id: string;
      readonly ordinal?: number;
      readonly signature?: string;
    }[];
    readonly choices: unknown[];
    readonly conditions: string[];
    readonly data: string[];
    readonly failures: string[];
    readonly health: unknown[];
    readonly paths: unknown[];
    readonly remounts: unknown[];
    readonly reviews: string[];
    readonly reveals: string[];
    readonly runtime: string[];
    readonly selections: unknown[];
  };
  readonly flushFrame: () => void;
  readonly flushTimer: () => void;
  readonly readResolverProps: () => unknown;
  readonly request: () => boolean;
  readonly scheduleAutomatic: (event: string, detail?: Record<string, unknown>) => boolean;
  readonly session: {
    neuralAssistancePending?: boolean;
    neuralLearningStatus?: {
      readonly activeCount?: number;
      readonly choiceAttempt?: number;
      readonly choiceCount?: number;
      readonly collecting?: boolean;
      readonly labelReason?: string;
      readonly phase: string;
      readonly restoring?: boolean;
      readonly successCount?: number;
      readonly updates: number;
    };
    runtimeFallbackAuthoredValues: Map<string, unknown>;
    runtimeFallbackDataFlowRecommendations: Map<string, unknown>;
    runtimeFallbackDataFlowSignals: Map<string, unknown>;
    runtimeFallbackNeuralDecisions: Map<string, unknown>;
    runtimeFallbackNeuralRevision: number;
    runtimeFallbackSemanticValueRecommendations: Map<string, unknown>;
    runtimeFallbackSharedNeuralRecommendations: Map<string, unknown>;
  };
  readonly setBlockers: (blockers: unknown[]) => void;
  readonly clearReachability: () => void;
  readonly setConditions: (conditions: unknown[]) => void;
  readonly setLearningStatus: (status: Record<string, unknown>) => void;
  readonly setModelUpdates: (updates: number) => void;
  readonly setVisible: (visible: boolean) => void;
  readonly setReachabilityDirectTarget: (directTarget: boolean) => void;
  readonly setReachabilityOutput: (targetHasOutput: boolean) => void;
  readonly setReachabilityStatus: (status: string) => void;
  readonly successfulPathCount: () => number;
  readonly verifyCurrentOutput: () => boolean;
}

/** Evaluates the request bridge with explicit frame and minimum-visible timer queues. */
export function createAssistanceFixture(): AssistanceFixture {
  const sandbox: {
    __fixture?: AssistanceFixture;
    Date: { now(): number };
    frames: (() => void)[];
    now: number;
    setTimeout(callback: () => void): number;
    timers: (() => void)[];
  } = {
    Date: { now: () => sandbox.now },
    frames: [],
    now: 1_000,
    setTimeout: (callback) => sandbox.timers.push(callback),
    timers: [],
  };
  vm.runInNewContext(
    `
      let blockers = [{ blocker: { key: 'page:Panel' }, blockerKind: 'target-reachability' }];
      let conditions = [];
      let rendererVisible = true;
      const previewEntryRevision = 7;
      const calls = { choiceAttempts: [], choices: [], conditions: [], data: [], failures: [],
        health: [], paths: [], remounts: [], reviews: [], reveals: [], runtime: [], selections: [] };
      let pageContextExpanded = false;
      const pageContextEvidence = { focus: () => calls.reviews.push('focus'), scrollIntoView: () => calls.reviews.push('scroll') };
      const pageContextToggle = { click: () => { pageContextExpanded = true; calls.reviews.push('expand'); }, getAttribute: (name) => name === 'aria-expanded' ? String(pageContextExpanded) : null }; const pageOptions = { set open(value) { if (value) calls.reviews.push('open-paths'); } };
      const pageContextShell = { querySelector: (selector) => selector === '.rpi-page-options' ? pageOptions : selector === '.rpi-page-paths' ? pageContextEvidence : selector === '[data-rpi-accordion-toggle="shell-page-context"]' ? pageContextToggle : undefined };
      const previewInspectorCompanionState = { shell: pageContextShell }; const requestPreviewInspectorCompanionContextReveal = (value) => calls.reviews.push('companion:' + value);
      const document = { get visibilityState() { return rendererVisible ? 'visible' : 'hidden'; }, querySelector: () => undefined };
      const previewInspectorSession = {
        activeTargetReachabilityKey: 'page:Panel',
        neuralResidualModel: { heads: {}, updates: 12, version: 3 },
        propsRevisionByExport: new Map([['Panel', 0]]), renderConditionAutoAttempts: new Map(),
        renderConditionAutoOverrides: new Map(), renderConditionOverrides: new Map(),
        renderConditionRevision: 0, renderConditions: new Map(),
        resolverPropsByExport: new Map([['Panel', { taxType: 'initial' }]]),
        runtimeFallbackAuthoredValues: new Map([['user-value', { status: 'custom' }]]),
        runtimeFallbackDataFlowRecommendations: new Map([['stale', {}]]),
        runtimeFallbackDataFlowSignals: new Map([['stale', {}]]),
        runtimeFallbackNeuralDecisions: new Map([['stale', {}]]),
        runtimeFallbackNeuralRevision: 4,
        runtimeFallbackSemanticValueRecommendations: new Map([['stale', {}]]),
        runtimeFallbackSharedNeuralRecommendations: new Map([['verified', { status: 'open' }]]),
        selectedPageCandidateId: 'page-candidate',
        selectedExportName: 'Panel',
        targetReachabilityByKey: new Map([['page:Panel', { key: 'page:Panel',
          pageRootCommitted: true, status: 'page-blocked', targetExportName: 'Panel',
          targetWasMounted: true }]]),
      };
      const PREVIEW_INSPECTOR_NEURAL_LEARNING_MIN_VISIBLE_MS = 600;
      const fingerprintPreviewInspectorSmartPropValue = (value) => JSON.stringify(value); const initializePreviewInspectorConditionState = () => undefined;
      const initializePreviewInspectorRuntimeFallbackState = () => undefined; const normalizePreviewInspectorProps = (value) => value;
      const notifyPreviewInspector = () => undefined; const previewInspectorScheduleRuntimeEffectFrame = (callback) => frames.push(callback);
      const readPreviewInspectorActiveBlockerSummary = () =>
        ({ active: blockers, count: blockers.length });
      const readPreviewInspectorRenderConditions = () => conditions; const createPreviewInspectorConditionTreeNode = (condition) => ({ blocksCurrentTarget:
        condition.blocksCurrentTarget === true, condition, conditionId: condition.id,
        id: 'render-condition:' + condition.id, kind: 'condition' });
      const findSelectedPreviewInspectorDescriptor = () => ({}); const readSelectedPreviewInspectorPageCandidate = () => ({});
      const readPreviewInspectorTargetPathEvidence = () => ({});
      const readPreviewInspectorTargetConditionValue = (condition) => condition.requiredValue;
      const setPreviewInspectorTargetGuidedConditionOverride = (id) => {
        calls.conditions.push(id); conditions = conditions.filter((item) => item.id !== id); return true; };
      const readPreviewInspectorNeuralLearningModelUpdates = () => previewInspectorSession.neuralResidualModel.updates;
      const readPreviewInspectorNeuralLearningStatus = () => previewInspectorSession.neuralLearningStatus;
      const readPreviewInspectorTargetFailurePropChoices = (failure) => Array.isArray(failure?.sourceChoices)
        ? failure.sourceChoices : failure?.sourceChoice === true
          ? [{ candidates: ['heavy_tax', 'normal_tax'], currentValue: 'taxType', kind: 'string', path: 'taxType', userControlled: true }] : [];
      const readPreviewInspectorTargetFailurePropChoiceDomains = (failure) => readPreviewInspectorTargetFailurePropChoices(failure);
      const createPreviewInspectorTargetFailurePropChoiceSignature = (failure, choice) => JSON.stringify(
        { candidates: choice.candidates, exportName: failure.exportName, path: choice.path });
      const createPreviewInspectorFinitePropChoiceMutation = (failure, options = {}) => failure?.sourceChoice === true
        ? undefined : failure?.finiteChoiceCycle === true
          ? { automatic: true, finiteChoiceOrdinal: options.finiteChoiceOrdinal } : { automatic: true };
      const createPreviewInspectorNeuralResidualDecision = (input) => input;
      const applyPreviewInspectorSmartPropChoice = (exportName, choice, selectedValue, commit) => {
        calls.choices.push([exportName, choice.path, selectedValue, commit]); return { [choice.path]: selectedValue }; };
      const recordPreviewInspectorRuntimeHealth = (event) => calls.health.push(event);
      const requestPreviewInspectorTreeReveal = (id) => calls.reveals.push(id); const remountPreviewInspectorExport = (...args) => calls.remounts.push(args);
      const schedulePreviewInspectorCommitRefresh = () => undefined; const schedulePreviewInspectorTreeRefresh = () => undefined;
      const selectPreviewInspectorUiNode = (node) => calls.selections.push(node);
      const setPreviewInspectorNeuralLearningStatus = (status) => { previewInspectorSession.neuralLearningStatus = status; };
      const smartFillPreviewInspectorDataPayload = (id) => (calls.data.push(id), true);
      const smartFillPreviewInspectorRuntimeFallback = (id) => (calls.runtime.push(id), true);
      const smartFillPreviewInspectorTargetApplicationPath = (...args) => (calls.paths.push(args), true);
      const smartFillPreviewInspectorTargetFailure = (failure, _commit, neuralResidualDecision, options = {}) => {
        calls.failures.push(failure.id);
        calls.choiceAttempts.push({ automatic: options.automatic, candidateId: neuralResidualDecision?.candidateId, id: failure.id,
          ordinal: options.finiteChoiceOrdinal, signature: options.finiteChoiceSignature });
        const finiteChoice = readPreviewInspectorTargetFailurePropChoices(failure)[0];
        const candidate = finiteChoice?.candidates?.[(options.finiteChoiceOrdinal ?? 1) - 1];
        if (candidate !== undefined) previewInspectorSession.resolverPropsByExport.set(
          'Panel', { [finiteChoice.path]: candidate });
        return true;
      };
      ${createPreviewInspectorNeuralAssistanceRuntimeSource()}
      globalThis.__fixture = {
        activate: activatePreviewInspectorNeuralAssistance,
        applyChoices: applyPreviewInspectorNeuralUserChoices,
        availability: readPreviewInspectorNeuralAssistanceAvailability,
        choice: readPreviewInspectorNeuralUserChoice,
        calls,
        clearReachability: () => { previewInspectorSession.activeTargetReachabilityKey = undefined; previewInspectorSession.targetReachabilityByKey.clear(); },
        flushFrame: () => frames.shift()?.(),
        flushTimer: () => { now += 600;
          for (const callback of timers.splice(0)) callback(); },
        readResolverProps: () => previewInspectorSession.resolverPropsByExport.get('Panel'),
        request: requestPreviewInspectorNeuralAssistance,
        scheduleAutomatic: schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth,
        session: previewInspectorSession,
        setBlockers: (next) => { blockers = next; },
        setConditions: (next) => { conditions = next; },
        setLearningStatus: (status) => { previewInspectorSession.neuralLearningStatus = status; },
        setModelUpdates: (updates) => { previewInspectorSession.neuralResidualModel.updates = updates; },
        setVisible: (visible) => { rendererVisible = visible; },
        setReachabilityDirectTarget: (value) => { previewInspectorSession.targetReachabilityByKey.get('page:Panel').directTarget = value; },
        setReachabilityOutput: (value) => { previewInspectorSession.targetReachabilityByKey.get('page:Panel').targetHasOutput = value; },
        setReachabilityStatus: (value) => { previewInspectorSession.targetReachabilityByKey.get('page:Panel').status = value; },
        successfulPathCount: () => {
          const reachability = previewInspectorSession.targetReachabilityByKey.get('page:Panel');
          const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
          return readPreviewInspectorNeuralSuccessfulPathCount(
            previewInspectorSession.automaticNeuralAssistanceByKey?.get(key));
        },
        verifyCurrentOutput: () => recordPreviewInspectorNeuralSuccessfulPath(previewInspectorSession.targetReachabilityByKey.get('page:Panel')),
      };
    `,
    sandbox,
  );
  if (sandbox.__fixture === undefined) {
    throw new Error('Neural assistance fixture did not initialize.');
  }
  return sandbox.__fixture;
}
