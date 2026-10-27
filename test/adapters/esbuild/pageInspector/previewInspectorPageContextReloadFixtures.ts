/** Simulates complete webview replacement using real selection, exploration, and SDK-state code. */
import { createPreviewInspectorStateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStateRuntimeSource';
/** Exercises neural page-context ranking without importing React or project modules. */
import vm from 'node:vm';
import { createPreviewInspectorPageCandidateSelectionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateSelectionRuntimeSource';
import { createPreviewInspectorNeuralPageContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralPageContextRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorPageContextExecutionContractRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextExecutionContractRuntimeSource';
import { createPreviewInspectorPageContextPathSurfaceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextPathSurfaceRuntimeSource';

interface PageCandidateFixture {
  readonly complete: boolean;
  readonly edges: readonly {
    readonly kind?: string;
    readonly localOwnerNames?: readonly string[];
    readonly owner?: { readonly exportName: string };
    readonly child?: { readonly exportName: string };
  }[];
  readonly id: string;
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
    readonly kinds: readonly string[];
    readonly pathSegments: readonly string[];
    readonly queued: boolean;
    readonly selectable: boolean;
    readonly stabilityLabel?: string;
    readonly state: string;
    readonly variantCount: number;
    readonly wrapperNames: readonly string[];
  }[];
  readonly pinTemporal: () => boolean;
  readonly rankingCalls: () => number;
  readonly releaseTemporal: () => boolean;
  readonly prepareContract: (candidateId: string, origin: 'neural' | 'user') => boolean;
  readonly persistenceCount: () => number;
  readonly record: () => {
    readonly coverageComplete: boolean;
    readonly evaluatedCandidateIds: Set<string>;
    readonly executionContractByCandidateId: Map<
      string,
      {
        readonly snapshot: { readonly conditionEntries: readonly [string, boolean][] };
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
  readonly select: () =>
    | {
        readonly candidate: PageCandidateFixture;
        readonly origin: string;
      }
    | undefined;
  readonly setExecutableCandidateId: (candidateId: string) => void;
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

const candidates: readonly [PageCandidateFixture, PageCandidateFixture] = [
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
const firstCandidate = candidates[0];
const secondCandidate = candidates[1];

/** Evaluates the generated model and page-context bridge inside one isolated browser-like realm. */
export function createPageContextReloadFixture(
  candidateInventory: readonly PageCandidateFixture[] = candidates,
  verifiedCandidateId = '',
  persistedState: Record<string, unknown> = {},
  frontierScope = 'source-input-one',
): PageContextFixture & { persistedState: () => Record<string, unknown> } {
  const context = vm.createContext({
    __candidates: candidateInventory,
    __verifiedCandidateId: verifiedCandidateId,
    __persistedState: persistedState,
    __frontierScope: frontierScope,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
  vm.runInContext(
    `
      const previewEntryRevision = 31;
      const requests = [];
      const health = [];
      let persistenceCount = 0;
      const PREVIEW_INSPECTOR_STATE_KEY = 'react-preview-inspector';
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      let storedWebviewState = JSON.parse(JSON.stringify(globalThis.__persistedState));
      const previewHotRuntime = { pageContextFrontierId: globalThis.__frontierScope, vscodeApi: {
        getState: () => storedWebviewState,
        setState: (value) => { storedWebviewState = JSON.parse(JSON.stringify(value)); persistenceCount += 1; },
      } };
      function readPreviewInspectorDataAutoEnabled() { return true; }
      function readPreviewInspectorDataListSampleCount() { return 3; }
      function serializePreviewInspectorDataOverrides() { return []; }
      function serializePreviewInspectorVirtualBackendScenarios() { return []; }
      function readPreviewInspectorFallbackValuesEnabled() { return true; }
      function serializePreviewInspectorRenderChoiceOverrides() { return []; }
      function serializePreviewInspectorRenderConditionOverrides() { return []; }
      function serializePreviewInspectorRuntimeFallbackOverrides() { return []; }
      function readPreviewInspectorRenderScenario() { return 'authored-page'; }
      ${createPreviewInspectorStateRuntimeSource()}
      const persisted = readPersistedPreviewInspectorState();
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
        interactionSequence: 0,
        overridesByExport: new Map(),
        devtoolsState: {},
        minimumRequirementSearchByKey: new Map(),
        pendingPageCandidateId: undefined,
        selectedExportName: targetExportName,
        selectedPageCandidateId: globalThis.__candidates[0].id,
        targetReachabilityByKey: new Map(),
        userSelectedPageCandidateId: '',
        verifiedPageCandidateId: persisted.verifiedPageCandidateId ?? globalThis.__verifiedCandidateId,
        verifiedPageContextScope: persisted.verifiedPageContextScope ?? '',
        renderConditionAutoOverrides: new Map(),
      };
      const restoredContracts = [];

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
      function previewInspectorPostHostMessage(message) {
        requests.push({ candidateId: message.candidateId, options: { origin: previewInspectorSession.pendingPageCandidateOrigin } });
      }
      function notifyPreviewInspector() {}
      function readPreviewInspectorHostRuntimeRevision() { return previewEntryRevision; }
      function resetPreviewInspectorTargetReachability() {}
      function schedulePreviewInspectorCommitRefresh() {}
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
      ${createPreviewInspectorPageCandidateSelectionRuntimeSource()}
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorNeuralPageContextRuntimeSource()}
      ${createPreviewInspectorPageContextExecutionContractRuntimeSource()}
      ${createPreviewInspectorPageContextPathSurfaceRuntimeSource()}
      const originalSelectPreviewInspectorNeuralResidualCandidate =
        selectPreviewInspectorNeuralResidualCandidate;
      let neuralPageContextRankingCalls = 0;
      selectPreviewInspectorNeuralResidualCandidate = (...args) => {
        neuralPageContextRankingCalls += 1;
        return originalSelectPreviewInspectorNeuralResidualCandidate(...args);
      };
      globalThis.__fixture = {
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
        persistedState: () => storedWebviewState,
        prepareContract: (candidateId, origin) =>
          preparePreviewInspectorNeuralPageContextExecutionContract(
            descriptor,
            candidateId,
            origin,
          ),
        rankingCalls: () => neuralPageContextRankingCalls,
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
        select: () => selectPreviewInspectorNeuralPageContextCandidate(descriptor),
        setExecutableCandidateId: (candidateId) => {
          descriptor.inspector.executablePageCandidateId = candidateId;
        },
        session: previewInspectorSession,
        summary: (state) => readPreviewInspectorPageContextPathSummary(descriptor, state),
      };
    `,
    context,
  );
  return context.__fixture as PageContextFixture & {
    persistedState: () => Record<string, unknown>;
  };
}

/** Exact source-only candidates used by every cross-document replay. */
export {
  candidates as reloadCandidates,
  firstCandidate as reloadFirstCandidate,
  secondCandidate as reloadSecondCandidate,
};
