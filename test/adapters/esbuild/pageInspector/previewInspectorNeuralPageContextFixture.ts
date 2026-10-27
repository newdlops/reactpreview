/** Shared production-runtime VM fixture for page-context learning regressions. */
import vm from 'node:vm';
import { createPreviewInspectorNeuralPageContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralPageContextRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorPageContextExecutionContractRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextExecutionContractRuntimeSource';
import { createPreviewInspectorPageContextPathSurfaceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextPathSurfaceRuntimeSource';
import { createPreviewInspectorNeuralSuccessVerificationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessVerificationRuntimeSource';

export interface PageCandidateFixture {
  readonly complete: boolean;
  readonly edges: readonly {
    readonly kind?: string;
    readonly localOwnerNames?: readonly string[];
    readonly owner?: { readonly exportName: string };
    readonly child?: { readonly exportName: string };
  }[];
  readonly id: string;
  readonly nextAppRedirectDestination?: string;
  readonly renderPath: {
    readonly entryPoint?: { readonly sourcePath: string };
    readonly id?: string;
    readonly steps: readonly {
      readonly certainty?: 'conditional' | 'confirmed';
      readonly invocation?: {
        readonly calleeName?: string;
        readonly factoryNames?: readonly string[];
        readonly localOwnerNames?: readonly string[];
        readonly mode?: string;
      };
      readonly label: string;
      readonly wrapperNames?: readonly string[];
    }[];
  };
  readonly root: { readonly exportName: string };
  readonly routeLocation?: {
    readonly componentName?: string;
    readonly evidenceKind?: string;
    readonly pathname: string;
  };
  readonly stopReason: string;
  readonly target: { readonly exportName: string };
}

interface PageContextFixture {
  readonly advanceEntryRevision: () => void;
  readonly candidates: readonly PageCandidateFixture[];
  readonly activateContract: (candidateId: string) => boolean;
  readonly autoConditions: () => readonly [string, boolean][];
  readonly continueCoverage: () => boolean;
  readonly health: readonly { readonly event: string }[];
  readonly model: () => {
    readonly candidateOutcomes: Readonly<Record<string, unknown>>;
    readonly heads: Readonly<Record<string, { readonly updates: number }>>;
    readonly updates: number;
  };
  readonly observe: (candidate: PageCandidateFixture, state: Record<string, unknown>) => boolean;
  readonly possibilities: () => readonly {
    readonly candidateId: string;
    readonly candidateIds: readonly string[];
    readonly callerNames: readonly string[];
    readonly executionContractLabel?: string;
    readonly evaluatedVariantCount: number;
    readonly kinds: readonly string[];
    readonly pathSegments: readonly string[];
    readonly queued: boolean;
    readonly selectable: boolean;
    readonly stabilityLabel?: string;
    readonly state: string;
    readonly statusLabel: string;
    readonly variantCount: number;
    readonly wrapperNames: readonly string[];
  }[];
  readonly pinTemporal: () => boolean;
  readonly rankingCalls: () => number;
  readonly reconcile: () => void;
  readonly runAuthoredStateTimers: () => void;
  readonly scheduleAuthoredStateContinuation: (state: Record<string, unknown>) => boolean;
  readonly setPaused: (paused: boolean) => void;
  readonly setCurrentReachability: (state: Record<string, unknown>) => void;
  readonly releaseTemporal: () => boolean;
  readonly prepareContract: (candidateId: string, origin: 'neural' | 'user') => boolean;
  readonly persistenceCount: () => number;
  readonly record: () => {
    readonly awaitingCurrentCandidateId?: string;
    readonly authoredStateCandidateIds: Set<string>;
    readonly coverageComplete: boolean;
    readonly evaluatedCandidateIds: Set<string>;
    readonly executionContractByCandidateId: Map<
      string,
      {
        readonly snapshot: {
          readonly conditionEntries: readonly [string, boolean][];
          readonly pageExecutionContext?: { readonly contextComplete: boolean };
          readonly temporalState?: { readonly kind: string };
        };
      }
    >;
    readonly failedCandidateIds: Set<string>;
    readonly pageContextRecoveryRecipe?: {
      readonly sourceCandidateId: string;
    };
    readonly provisionalCandidateIds: Set<string>;
    readonly status: string;
    readonly successfulCandidateIds: Set<string>;
    readonly unstableCandidateIds: Set<string>;
  };
  readonly requests: readonly {
    readonly candidateId: string;
    readonly options?: { readonly origin?: string };
  }[];
  readonly schedule: () => void;
  readonly retainRecoveryRecipe: (
    candidate: PageCandidateFixture,
    state: Record<string, unknown>,
  ) => boolean;
  readonly setAutoConditions: (entries: readonly [string, boolean][]) => void;
  readonly select: (options?: { readonly exploreUnevaluated?: boolean }) =>
    | {
        readonly candidate: PageCandidateFixture;
        readonly origin: string;
      }
    | undefined;
  readonly setExecutableCandidateId: (candidateId: string | undefined) => void;
  readonly session: {
    neuralHumanControlRevision?: number;
    pendingPageCandidateId?: string | undefined;
    selectedPageCandidateId: string;
    userSelectedPageCandidateId: string;
    verifiedPageCandidateId: string;
    verifiedPageContextScope: string;
  };
  readonly summary: (state: Record<string, unknown>) => {
    readonly detail: string;
    readonly modelLabel: string;
    readonly segments: readonly string[];
    readonly state: string;
    readonly statusLabel: string;
    readonly temporalPinned?: boolean;
    readonly temporalReleased?: boolean;
  };
}

export const candidates: readonly PageCandidateFixture[] = [
  {
    complete: true,
    edges: [{ kind: 'render' }],
    id: '/workspace/very/long/application/path/'.repeat(6) + 'first-page-candidate',
    renderPath: {
      entryPoint: { sourcePath: '/workspace/main.tsx' },
      steps: [{ label: 'AppShell' }, { label: 'FallbackPage' }],
    },
    root: { exportName: 'AppShell' },
    routeLocation: {
      componentName: 'FallbackPage',
      evidenceKind: 'react-router',
      pathname: '/fallback',
    },
    stopReason: 'root-reached',
    target: { exportName: 'TaxTypeBadge' },
  },
  {
    complete: true,
    edges: [{ kind: 'render' }, { kind: 'route' }],
    id: '/workspace/very/long/application/path/'.repeat(6) + 'second-page-candidate',
    renderPath: {
      entryPoint: { sourcePath: '/workspace/main.tsx' },
      steps: [{ label: 'MeetingApp' }, { label: 'TaxPage', wrapperNames: ['MeetingLayout'] }],
    },
    root: { exportName: 'MeetingApp' },
    routeLocation: {
      componentName: 'TaxPage',
      evidenceKind: 'react-router',
      pathname: '/company/1/meeting/1/tax',
    },
    stopReason: 'root-reached',
    target: { exportName: 'TaxTypeBadge' },
  },
];
/** Evaluates the generated model and page-context bridge inside one isolated browser-like realm. */
export function createPageContextFixture(
  candidateInventory: readonly PageCandidateFixture[] = candidates,
  verifiedCandidateId = '',
): PageContextFixture {
  const context = vm.createContext({
    __candidates: candidateInventory,
    __verifiedCandidateId: verifiedCandidateId,
  });
  vm.runInContext(
    `
      let previewEntryRevision = 31;
      const authoredStateTimers = [];
      let assistancePaused = false;
      let currentReachability;
      function setTimeout(callback) { authoredStateTimers.push(callback); }
      function isPreviewInspectorNeuralAssistancePaused() { return assistancePaused; }
      function readPreviewInspectorNeuralAssistanceReachability() { return currentReachability; }
      const requests = [];
      const health = [];
      let persistenceCount = 0;
      const targetExportName = globalThis.__candidates[0].target.exportName;
      const descriptor = {
        exportName: targetExportName,
        sourcePath: '/workspace/components/tax-type-badge.tsx',
        inspector: {
          executablePageCandidateId: globalThis.__candidates[0].id,
          pageCandidates: globalThis.__candidates,
          target: { exportName: targetExportName, sourcePath: '/workspace/components/tax-type-badge.tsx' },
        },
      };
      const previewInspectorSession = {
        activeTargetReachabilityKey: undefined,
        minimumRequirementSearchByKey: new Map(),
        pendingPageCandidateId: undefined,
        selectedExportName: targetExportName,
        selectedPageCandidateId: globalThis.__candidates[0].id,
        targetReachabilityByKey: new Map(),
        userSelectedPageCandidateId: '',
        verifiedPageCandidateId: globalThis.__verifiedCandidateId,
        verifiedPageContextScope: '',
        renderConditionAutoOverrides: new Map(),
      };
      const restoredContracts = [];
      function persistPreviewInspectorState() { persistenceCount += 1; }
      function readPreviewInspectorPageCandidates() { return globalThis.__candidates; }
      function readSelectedPreviewInspectorPageCandidate() {
        return globalThis.__candidates.find(
          (candidate) => candidate.id === previewInspectorSession.selectedPageCandidateId,
        ) ?? globalThis.__candidates[0];
      }
      function readSelectedPreviewInspectorCandidateTarget() {
        return readSelectedPreviewInspectorPageCandidate().target;
      }
      function findSelectedPreviewInspectorDescriptor() { return descriptor; }
      function isPreviewInspectorCompletePageCandidateContext(candidate) {
        return candidate?.complete === true ||
          candidate?.renderPath?.entryPoint !== undefined ||
          ['next-app-filesystem', 'next-pages-filesystem'].includes(
            candidate?.virtualPage?.mode,
          );
      }
      function selectPreviewInspectorPageCandidate(candidateId, options) {
        requests.push({ candidateId, options });
        previewInspectorSession.selectedPageCandidateId = candidateId;
        previewInspectorSession.pendingPageCandidateId = candidateId;
        return true;
      }
      function recordPreviewInspectorRuntimeHealth(value) { health.push(value); }
      function createPreviewInspectorNeuralSuccessSnapshot(state) {
        const conditionEntries = [...previewInspectorSession.renderConditionAutoOverrides];
        const pageCandidateId = previewInspectorSession.selectedPageCandidateId;
        return Object.freeze({
          conditionEntries: Object.freeze(conditionEntries),
          dataAutoEnabled: true,
          dataPayloadEntries: Object.freeze([]),
          dataRequestIds: Object.freeze([]),
          exportName: state?.targetExportName ?? previewInspectorSession.selectedExportName,
          fallbackValuesEnabled: true,
          fingerprint: JSON.stringify({ conditionEntries, pageCandidateId }),
          hasResolverProps: false,
          pageCandidateId,
          pageExecutionContext: state?.pageExecutionContext,
          runtimeFallbackIds: Object.freeze([]),
          runtimeFallbackSmartIds: Object.freeze([]),
          runtimeFallbackSmartPathEntries: Object.freeze([]),
          runtimeFallbackValueEntries: Object.freeze([]),
          score: -conditionEntries.length * 10,
        });
      }
      function restorePreviewInspectorNeuralPageGenerationBaseline(snapshot) {
        restoredContracts.push(snapshot);
        previewInspectorSession.renderConditionAutoOverrides =
          new Map(snapshot.conditionEntries ?? []);
        return true;
      }
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorNeuralPageContextRuntimeSource()}
      ${createPreviewInspectorPageContextExecutionContractRuntimeSource()}
      ${createPreviewInspectorPageContextPathSurfaceRuntimeSource()}
      ${createPreviewInspectorNeuralSuccessVerificationRuntimeSource()}
      if (previewInspectorSession.verifiedPageCandidateId.length > 0) {
        previewInspectorSession.verifiedPageContextScope =
          createPreviewInspectorNeuralPageContextPersistedScope(descriptor);
      }
      const originalSelectPreviewInspectorNeuralResidualCandidate =
        selectPreviewInspectorNeuralResidualCandidate;
      let neuralPageContextRankingCalls = 0;
      selectPreviewInspectorNeuralResidualCandidate = (...args) => {
        neuralPageContextRankingCalls += 1;
        return originalSelectPreviewInspectorNeuralResidualCandidate(...args);
      };
      globalThis.__fixture = {
        advanceEntryRevision: () => { previewEntryRevision += 1; },
        activateContract: (candidateId) =>
          activatePreviewInspectorNeuralPageContextExecutionContract(descriptor, candidateId),
        autoConditions: () => [...previewInspectorSession.renderConditionAutoOverrides],
        candidates: globalThis.__candidates,
        continueCoverage: () => continuePreviewInspectorNeuralPageContextCoverage(),
        health,
        model: serializePreviewInspectorNeuralResidualModel,
        observe: (candidate, state) =>
          observePreviewInspectorNeuralPageContextOutcome(descriptor, candidate, state),
        possibilities: () => readPreviewInspectorPageContextPossibilities(descriptor),
        pinTemporal: () => activatePreviewInspectorNeuralTemporalStateContract(Object.freeze({
          backendScenarioEntries: Object.freeze([]),
          fingerprint: 'time:' + previewInspectorSession.selectedPageCandidateId,
          kind: 'transient-checkpoint',
          observationWindowMs: 960,
          pageCandidateId: previewInspectorSession.selectedPageCandidateId,
          released: false,
          signalCount: 2,
        })),
        persistenceCount: () => persistenceCount,
        prepareContract: (candidateId, origin) =>
          preparePreviewInspectorNeuralPageContextExecutionContract(
            descriptor,
            candidateId,
            origin,
          ),
        rankingCalls: () => neuralPageContextRankingCalls,
        reconcile: () => reconcilePreviewInspectorNeuralPageContextSelection(descriptor),
        runAuthoredStateTimers: () => { for (const callback of authoredStateTimers.splice(0)) callback(); },
        scheduleAuthoredStateContinuation: (state) =>
          schedulePreviewInspectorNeuralPageAuthoredStateContinuation(
            descriptor, readSelectedPreviewInspectorPageCandidate(), state,
          ),
        setPaused: (paused) => { assistancePaused = paused; },
        setCurrentReachability: (state) => { currentReachability = state; },
        releaseTemporal: releasePreviewInspectorNeuralTemporalStateContract,
        retainRecoveryRecipe: (candidate, state) => {
          const snapshot = Object.freeze({
            ...createPreviewInspectorNeuralSuccessSnapshot(state),
            pageExecutionContext: Object.freeze({ contextComplete: false }),
          });
          return retainPreviewInspectorNeuralPageContextRecoveryRecipe(
            descriptor,
            candidate,
            state,
            snapshot,
          );
        },
        record: () => readPreviewInspectorNeuralPageContextRecord(descriptor),
        requests,
        schedule: () => schedulePreviewInspectorNeuralPageContextSelection(),
        setAutoConditions: (entries) => {
          previewInspectorSession.renderConditionAutoOverrides = new Map(entries);
        },
        select: (options) => selectPreviewInspectorNeuralPageContextCandidate(descriptor, options),
        setExecutableCandidateId: (candidateId) => {
          descriptor.inspector.executablePageCandidateId = candidateId;
        },
        session: previewInspectorSession,
        summary: (state) => readPreviewInspectorPageContextPathSummary(descriptor, state),
      };
    `,
    context,
  );
  return context.__fixture as PageContextFixture;
}
