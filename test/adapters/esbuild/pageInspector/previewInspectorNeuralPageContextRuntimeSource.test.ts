/** Exercises neural page-context ranking without importing React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralPageContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralPageContextRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorNeuralSuccessCheckpointRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessCheckpointRuntimeSource';
import { createPreviewInspectorPageContextExecutionContractRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextExecutionContractRuntimeSource';
import { createPreviewInspectorPageContextPathSurfaceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextPathSurfaceRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorConsoleRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConsoleRuntimeSource';
import { createPreviewInspectorRuntimeHealthSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeHealthSource';

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

const candidates: readonly PageCandidateFixture[] = [
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
if (firstCandidate === undefined || secondCandidate === undefined) {
  throw new Error('Expected two neural page-context candidates.');
}

/** Evaluates the generated model and page-context bridge inside one isolated browser-like realm. */
function createPageContextFixture(
  candidateInventory: readonly PageCandidateFixture[] = candidates,
  verifiedCandidateId = '',
): PageContextFixture {
  const context = vm.createContext({
    __candidates: candidateInventory,
    __verifiedCandidateId: verifiedCandidateId,
  });
  vm.runInContext(
    `
      const previewEntryRevision = 31;
      const requests = [];
      const health = [];
      let persistenceCount = 0;
      const descriptor = {
        exportName: 'TaxTypeBadge',
        sourcePath: '/workspace/components/tax-type-badge.tsx',
        inspector: {
          executablePageCandidateId: globalThis.__candidates[0].id,
          pageCandidates: globalThis.__candidates,
          target: { exportName: 'TaxTypeBadge', sourcePath: '/workspace/components/tax-type-badge.tsx' },
        },
      };
      const previewInspectorSession = {
        activeTargetReachabilityKey: undefined,
        minimumRequirementSearchByKey: new Map(),
        pendingPageCandidateId: undefined,
        selectedExportName: 'TaxTypeBadge',
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
  return context.__fixture as PageContextFixture;
}

describe('Preview Inspector neural page-context runtime source', () => {
  it('emits syntactically valid generated browser code', () => {
    expect(
      () => new vm.Script(createPreviewInspectorNeuralPageContextRuntimeSource()),
    ).not.toThrow();
  });

  it('connects only verified success and terminal corridor failure producers', () => {
    expect(createPreviewInspectorNeuralSuccessCheckpointRuntimeSource()).toContain(
      'observeCurrentPreviewInspectorNeuralPageContextOutcome(state)',
    );
    expect(createPreviewInspectorNeuralSuccessCheckpointRuntimeSource()).toContain(
      'continuePreviewInspectorNeuralPageContextCoverage()',
    );
    expect(createPreviewInspectorConsoleRuntimeSource()).toContain(
      'observePreviewInspectorNeuralPageContextConsoleEntry(entry)',
    );
    expect(createPreviewInspectorRuntimeHealthSource()).toContain("'neural-page-context-verified'");
    expect(createPreviewInspectorRuntimeHealthSource()).toContain("'neural-page-context-failed'");
  });

  it('surfaces one canonical time contract with an explicit Resume control', () => {
    const contractSource = createPreviewInspectorPageContextExecutionContractRuntimeSource();
    const pathSource = createPreviewInspectorPageContextPathSurfaceRuntimeSource();
    const uiSource = createPreviewInspectorPageCandidateUiRuntimeSource();

    expect(contractSource).toContain(
      "kind = transient ? 'transient-checkpoint' : 'terminal-stable'",
    );
    expect(contractSource).toContain(
      "holdPolicy: transient ? 'viewer-pending-until-resume' : 'none'",
    );
    expect(contractSource).toContain('releasePreviewInspectorNeuralTemporalStateContract');
    expect(pathSource).toContain("'LOADING STATE PINNED'");
    expect(pathSource).toContain("'TIME STATE RESUMED'");
    expect(pathSource).toContain("'TIME CONTRACT · transient checkpoint · '");
    expect(uiSource).toContain("'Resume normal page time progression'");
    expect(uiSource).toContain("'Resume'");
  });

  it('models the Page Context transition from pinned loading to user-resumed time', () => {
    const fixture = createPageContextFixture();
    const state = {
      applicationPath: ['AppShell', 'FallbackPage', 'TaxTypeBadge'],
      status: 'reached',
      targetExportName: 'TaxTypeBadge',
      targetHasOutput: true,
    };

    expect(fixture.pinTemporal()).toBe(true);
    expect(fixture.summary(state)).toMatchObject({
      state: 'transient',
      statusLabel: 'LOADING STATE PINNED',
      temporalPinned: true,
    });

    expect(fixture.releaseTemporal()).toBe(true);
    expect(fixture.summary(state)).toMatchObject({
      state: 'resumed',
      statusLabel: 'TIME STATE RESUMED',
      temporalReleased: true,
    });
  });

  it('keeps compiler rank as the neutral baseline and exposes the selected corridor', () => {
    const fixture = createPageContextFixture();

    expect(fixture.select()).toMatchObject({ candidate: candidates[0], origin: 'deterministic' });
    expect(
      fixture.summary({
        applicationPath: ['AppShell', 'FallbackPage', 'TaxTypeBadge'],
        status: 'probing',
        targetExportName: 'TaxTypeBadge',
        targetHasOutput: false,
      }),
    ).toMatchObject({
      segments: ['AppShell', 'FallbackPage', 'TaxTypeBadge'],
      state: 'baseline',
      statusLabel: 'SOURCE ORDER',
    });
  });

  it('groups duplicate mount checkpoints and explores another wrapper path before retrying one', () => {
    const wrapperCandidates: readonly PageCandidateFixture[] = [
      {
        complete: true,
        edges: [{ localOwnerNames: ['CardBody'] }],
        id: 'sheet-path-page-mount',
        renderPath: {
          id: 'sheet-path',
          steps: [
            {
              certainty: 'confirmed',
              invocation: {
                calleeName: 'withPermission',
                factoryNames: ['withStaff'],
                mode: 'hoc',
              },
              label: 'Skeleton',
              wrapperNames: ['SheetContent', 'Sheet'],
            },
            { certainty: 'conditional', label: 'ExplorePage' },
          ],
        },
        root: { exportName: 'ExplorePage' },
        routeLocation: { pathname: '/explore' },
        stopReason: 'root-reached',
        target: { exportName: 'Skeleton' },
      },
      {
        complete: false,
        edges: [{ localOwnerNames: ['CardBody'] }],
        id: 'sheet-path-local-mount',
        renderPath: {
          id: 'sheet-path',
          steps: [
            {
              certainty: 'confirmed',
              invocation: { calleeName: 'withPermission', mode: 'hoc' },
              label: 'Skeleton',
              wrapperNames: ['SheetContent', 'Sheet'],
            },
            { certainty: 'conditional', label: 'ExplorePage' },
          ],
        },
        root: { exportName: 'SheetContent' },
        routeLocation: { pathname: '/explore' },
        stopReason: 'render-path-checkpoint',
        target: { exportName: 'Skeleton' },
      },
      {
        complete: true,
        edges: [{ localOwnerNames: ['PosterCardSkeleton'] }],
        id: 'poster-path-page-mount',
        renderPath: {
          id: 'poster-path',
          steps: [
            {
              certainty: 'confirmed',
              invocation: { calleeName: 'styled.div', mode: 'styled' },
              label: 'Skeleton',
            },
            {
              certainty: 'conditional',
              invocation: { calleeName: 'forwardRef', mode: 'forward-ref' },
              label: 'PosterScrollSkeleton',
            },
            {
              certainty: 'confirmed',
              invocation: { calleeName: 'memo', mode: 'memo' },
              label: 'ExplorePage',
            },
          ],
        },
        root: { exportName: 'ExplorePage' },
        routeLocation: { pathname: '/explore' },
        stopReason: 'root-reached',
        target: { exportName: 'Skeleton' },
      },
    ];
    const first = wrapperCandidates[0];
    const alternatePath = wrapperCandidates[2];
    if (first === undefined || alternatePath === undefined) {
      throw new Error('Expected wrapper-path fixtures.');
    }
    const fixture = createPageContextFixture(wrapperCandidates);

    const possibilities = fixture.possibilities();
    expect(possibilities).toMatchObject([
      {
        candidateId: 'sheet-path-local-mount',
        candidateIds: ['sheet-path-page-mount', 'sheet-path-local-mount'],
        pathSegments: ['ExplorePage', 'Sheet', 'SheetContent', 'Skeleton'],
        selectable: true,
        variantCount: 2,
      },
      {
        candidateIds: ['poster-path-page-mount'],
        pathSegments: ['ExplorePage', 'PosterScrollSkeleton', 'Skeleton'],
        variantCount: 1,
      },
    ]);
    expect(possibilities[0]?.kinds).toEqual(
      expect.arrayContaining([
        'component caller',
        'conditional',
        'HOC',
        'JSX wrapper',
        'local owner',
      ]),
    );
    expect(possibilities[0]?.callerNames).toEqual(['ExplorePage']);
    expect(possibilities[0]?.wrapperNames).toEqual(
      expect.arrayContaining(['SheetContent', 'Sheet', 'withPermission', 'withStaff', 'CardBody']),
    );
    expect(possibilities[1]?.kinds).toEqual(
      expect.arrayContaining([
        'component caller',
        'conditional',
        'forwardRef',
        'memo',
        'styled',
        'local owner',
      ]),
    );
    expect(possibilities[1]?.callerNames).toEqual(['ExplorePage', 'PosterScrollSkeleton']);
    expect(fixture.select()).toMatchObject({ candidate: first, origin: 'deterministic' });

    expect(
      fixture.observe(first, {
        directTarget: false,
        exhausted: true,
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
      }),
    ).toBe(true);
    expect(fixture.requests.at(-1)).toEqual({
      candidateId: alternatePath.id,
      options: { origin: 'neural-page-context' },
    });
  });

  it('trains a verified blocked path and advances to another long-id compiler candidate', () => {
    const fixture = createPageContextFixture();
    fixture.select();

    expect(
      fixture.observe(firstCandidate, {
        directTarget: false,
        exhausted: true,
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
      }),
    ).toBe(true);

    expect(fixture.requests.at(-1)).toEqual({
      candidateId: secondCandidate.id,
      options: { origin: 'neural-page-context' },
    });
    expect(fixture.record().failedCandidateIds.has(firstCandidate.id)).toBe(true);
    expect(fixture.model().heads['page-choice']?.updates).toBe(1);
    expect(JSON.stringify(fixture.model())).not.toContain('/workspace/very/long/application/path');
    expect(fixture.health.at(-1)?.event).toBe('neural-page-context-failed');
  });

  it('checkpoints verified output, then continues across the remaining caller path', () => {
    const fixture = createPageContextFixture();
    fixture.session.selectedPageCandidateId = secondCandidate.id;
    fixture.setExecutableCandidateId(secondCandidate.id);

    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        exhausted: false,
        pageRootCommitted: true,
        status: 'target-error',
        targetHasOutput: false,
      }),
    ).toBe(false);
    expect(fixture.model().updates).toBe(0);

    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        exhausted: false,
        pageRootCommitted: true,
        status: 'reached',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(false);
    expect(fixture.model().updates).toBe(0);

    expect(
      fixture.observe(secondCandidate, {
        applicationPath: ['MeetingApp', 'MeetingLayout', 'TaxPage', 'TaxTypeBadge'],
        directTarget: false,
        exhausted: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetExportName: 'TaxTypeBadge',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.record().successfulCandidateIds.has(secondCandidate.id)).toBe(true);
    const summary = fixture.summary({
      applicationPath: ['MeetingApp', 'MeetingLayout', 'TaxPage', 'TaxTypeBadge'],
      status: 'reached',
      targetExportName: 'TaxTypeBadge',
      targetHasOutput: true,
    });
    expect(summary).toMatchObject({
      state: 'neural',
      statusLabel: 'STABLE OUTPUT · OPTIMIZING',
    });
    expect(summary.detail).toContain('testing remaining caller/HOC mount candidates');

    expect(fixture.continueCoverage()).toBe(true);
    expect(fixture.requests.at(-1)).toEqual({
      candidateId: firstCandidate.id,
      options: { origin: 'neural-page-context' },
    });
  });

  it('keeps automatic viewer repairs inside the exact caller/HOC execution contract', () => {
    const fixture = createPageContextFixture();
    fixture.session.selectedPageCandidateId = secondCandidate.id;
    fixture.setExecutableCandidateId(secondCandidate.id);
    fixture.setAutoConditions([['tax-panel-open', true]]);

    expect(
      fixture.observe(secondCandidate, {
        applicationPath: ['MeetingApp', 'MeetingLayout', 'TaxPage', 'TaxTypeBadge'],
        directTarget: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetExportName: 'TaxTypeBadge',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    expect(
      fixture.record().executionContractByCandidateId.get(secondCandidate.id)?.snapshot
        .conditionEntries,
    ).toEqual([['tax-panel-open', true]]);
    expect(
      fixture.possibilities().find((path) => path.candidateIds.includes(secondCandidate.id))
        ?.executionContractLabel,
    ).toContain('1/1 reproducible mount contract(s) · up to 1 condition(s)');

    expect(fixture.continueCoverage()).toBe(true);
    fixture.setAutoConditions([['leaked-from-previous-path', true]]);
    expect(fixture.activateContract(firstCandidate.id)).toBe(true);
    expect(fixture.autoConditions()).toEqual([]);

    expect(fixture.prepareContract(secondCandidate.id, 'neural')).toBe(true);
    expect(fixture.activateContract(secondCandidate.id)).toBe(true);
    expect(fixture.autoConditions()).toEqual([['tax-panel-open', true]]);
  });

  it('replays a partial component repair recipe into the next full-page candidate', () => {
    const fixture = createPageContextFixture();
    fixture.select();
    fixture.setAutoConditions([['component-output-visible', true]]);

    expect(
      fixture.retainRecoveryRecipe(firstCandidate, {
        applicationPath: ['FallbackPage', 'TaxTypeBadge'],
        targetExportName: 'TaxTypeBadge',
      }),
    ).toBe(true);
    expect(fixture.record().pageContextRecoveryRecipe).toMatchObject({
      sourceCandidateId: firstCandidate.id,
    });

    expect(fixture.prepareContract(secondCandidate.id, 'neural')).toBe(true);
    fixture.setAutoConditions([]);
    expect(fixture.activateContract(secondCandidate.id)).toBe(true);
    expect(fixture.autoConditions()).toEqual([['component-output-visible', true]]);
  });

  it('reopens a failed full page when a new partial-path recipe becomes available', () => {
    const partialCandidate: PageCandidateFixture = {
      complete: false,
      edges: secondCandidate.edges,
      id: 'partial-carousel-checkpoint',
      renderPath: {
        id: 'partial-carousel-path',
        steps: [{ label: 'ExplorePageCarousel' }, { label: 'TaxTypeBadge' }],
      },
      root: secondCandidate.root,
      stopReason: 'render-path-checkpoint',
      target: secondCandidate.target,
    };
    const fixture = createPageContextFixture([firstCandidate, partialCandidate]);
    fixture.select();

    expect(
      fixture.observe(firstCandidate, {
        directTarget: false,
        exhausted: true,
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
      }),
    ).toBe(true);
    expect(fixture.requests.at(-1)?.candidateId).toBe(partialCandidate.id);

    fixture.session.pendingPageCandidateId = undefined;
    fixture.session.selectedPageCandidateId = partialCandidate.id;
    fixture.setExecutableCandidateId(partialCandidate.id);
    fixture.setAutoConditions([['open-authored-overlay', true]]);
    expect(
      fixture.retainRecoveryRecipe(partialCandidate, {
        applicationPath: ['ExplorePageCarousel', 'TaxTypeBadge'],
        targetExportName: 'TaxTypeBadge',
      }),
    ).toBe(true);
    expect(fixture.record().failedCandidateIds.has(firstCandidate.id)).toBe(false);

    expect(
      fixture.observe(partialCandidate, {
        directTarget: false,
        exhausted: true,
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
      }),
    ).toBe(true);
    expect(fixture.requests.at(-1)?.candidateId).toBe(firstCandidate.id);

    fixture.setAutoConditions([]);
    fixture.session.pendingPageCandidateId = undefined;
    fixture.session.selectedPageCandidateId = firstCandidate.id;
    fixture.setExecutableCandidateId(firstCandidate.id);
    expect(fixture.activateContract(firstCandidate.id)).toBe(true);
    expect(fixture.autoConditions()).toEqual([['open-authored-overlay', true]]);
  });

  it('restores the least invasive successful contract after every mount candidate is evaluated', () => {
    const fixture = createPageContextFixture();
    fixture.setAutoConditions([]);

    expect(
      fixture.observe(firstCandidate, {
        applicationPath: ['AppShell', 'FallbackPage', 'TaxTypeBadge'],
        directTarget: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetExportName: 'TaxTypeBadge',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    expect(fixture.continueCoverage()).toBe(true);
    expect(fixture.requests.at(-1)?.candidateId).toBe(secondCandidate.id);

    fixture.session.pendingPageCandidateId = undefined;
    fixture.session.selectedPageCandidateId = secondCandidate.id;
    fixture.setExecutableCandidateId(secondCandidate.id);
    fixture.setAutoConditions([['needs-extra-condition', true]]);
    expect(
      fixture.observe(secondCandidate, {
        applicationPath: ['MeetingApp', 'MeetingLayout', 'TaxPage', 'TaxTypeBadge'],
        directTarget: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetExportName: 'TaxTypeBadge',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    expect(fixture.record().coverageComplete).toBe(true);

    fixture.session.pendingPageCandidateId = undefined;
    expect(fixture.continueCoverage()).toBe(true);
    expect(fixture.requests.at(-1)?.candidateId).toBe(firstCandidate.id);
    expect(fixture.activateContract(firstCandidate.id)).toBe(true);
    expect(fixture.autoConditions()).toEqual([]);
  });

  it('does not rerank a verified page path during descriptor reconciliation', async () => {
    const fixture = createPageContextFixture();
    fixture.session.selectedPageCandidateId = secondCandidate.id;
    fixture.setExecutableCandidateId(secondCandidate.id);
    fixture.schedule();

    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        exhausted: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    const rankingCalls = fixture.rankingCalls();

    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.schedule();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.rankingCalls()).toBe(rankingCalls);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.record()).toMatchObject({
      selectedCandidateId: secondCandidate.id,
      status: 'verified',
    });
  });

  it('does not preflight another page build before the executable path receives a verdict', async () => {
    const fixture = createPageContextFixture();
    fixture.session.selectedPageCandidateId = secondCandidate.id;
    fixture.setExecutableCandidateId(secondCandidate.id);

    fixture.schedule();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.requests).toHaveLength(0);
    expect(fixture.rankingCalls()).toBe(0);
  });

  it('persists verified output and restores that candidate across a fresh runtime', async () => {
    const fixture = createPageContextFixture();
    fixture.session.selectedPageCandidateId = secondCandidate.id;

    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        exhausted: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    expect(fixture.session.verifiedPageCandidateId).toBe(secondCandidate.id);
    expect(fixture.session.verifiedPageContextScope).toMatch(/^[a-f0-9]{8}$/u);
    expect(fixture.persistenceCount()).toBeGreaterThan(0);

    const restored = createPageContextFixture(candidates, secondCandidate.id);
    expect(restored.record().provisionalCandidateIds.has(secondCandidate.id)).toBe(true);
    expect(restored.record().successfulCandidateIds.has(secondCandidate.id)).toBe(false);
    expect(
      restored.possibilities().find((path) => path.candidateIds.includes(secondCandidate.id))
        ?.state,
    ).toBe('checking');
    restored.schedule();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(restored.requests).toEqual([
      {
        candidateId: secondCandidate.id,
        options: { origin: 'neural-page-context' },
      },
    ]);
  });

  it('demotes a stable page path when its output regresses to a blocker-only state', () => {
    const fixture = createPageContextFixture();
    fixture.session.selectedPageCandidateId = secondCandidate.id;

    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        neuralStableOutputVerified: true,
        pageRootCommitted: true,
        status: 'reached',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toBe(true);
    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        neuralStableOutputRegressed: true,
        pageRootCommitted: true,
        status: 'target-mounted-no-output',
        targetHasOutput: false,
        targetWasMounted: true,
      }),
    ).toBe(true);

    expect(fixture.record().successfulCandidateIds.has(secondCandidate.id)).toBe(false);
    expect(fixture.record().unstableCandidateIds.has(secondCandidate.id)).toBe(true);
    expect(fixture.session.verifiedPageCandidateId).toBe('');
    expect(fixture.requests.at(-1)).toEqual({
      candidateId: firstCandidate.id,
      options: { origin: 'neural-page-context' },
    });
    expect(
      fixture.possibilities().find((path) => path.candidateIds.includes(secondCandidate.id)),
    ).toMatchObject({ stabilityLabel: '1/2 stable verdict(s)', state: 'unstable' });
  });

  it('keeps an explicit user page path authoritative', () => {
    const fixture = createPageContextFixture();
    fixture.session.userSelectedPageCandidateId = secondCandidate.id;
    fixture.session.selectedPageCandidateId = secondCandidate.id;

    expect(fixture.select()).toMatchObject({ candidate: secondCandidate, origin: 'user' });
    expect(
      fixture.observe(secondCandidate, {
        directTarget: false,
        exhausted: true,
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
      }),
    ).toBe(true);
    expect(fixture.requests).toHaveLength(0);
    expect(
      fixture.possibilities().find((path) => path.candidateIds.includes(secondCandidate.id)),
    ).toMatchObject({ state: 'unstable' });
    expect(fixture.summary({ status: 'page-blocked', targetHasOutput: false })).toMatchObject({
      state: 'unstable',
      statusLabel: 'USER PATH · UNSTABLE',
    });
  });

  it('renders recommendation, evidence, and alternatives in one page-path surface', () => {
    const source = createPreviewInspectorPageCandidateUiRuntimeSource();
    const componentStart = source.indexOf('function PreviewInspectorPagePathSurface');
    const componentEnd = source.indexOf('function formatPreviewInspectorPageContextAccordionLabel');
    const componentSource = source.slice(componentStart, componentEnd);

    expect(componentSource).toContain('PAGE CONTEXT PATHS');
    expect(componentSource).toContain(
      "'aria-label': 'Page context path recommendation and source-proven alternatives'",
    );
    expect(componentSource).toContain("'aria-label': 'Source-proven page context paths'");
    expect(componentSource).toContain("className: 'rpi-page-path-model-meta'");
    expect(componentSource).toContain('tabIndex: 0');
    expect(componentSource).toContain('surface.summary');
    expect(componentSource).toContain('surface.paths');
    expect(componentSource).toContain("'aria-live': 'polite'");
    expect(source).not.toContain('function PreviewInspectorOptimizedViewPath');
    expect(source).not.toContain("'aria-label': 'Authored page caller path'");
    expect(source).not.toContain("'aria-label': 'Current page to target path'");
  });

  it('renders every admitted path with status and one explicit apply action', () => {
    const source = createPreviewInspectorPageCandidateUiRuntimeSource();
    const componentStart = source.indexOf('function PreviewInspectorPagePathSurface');
    const componentEnd = source.indexOf('function formatPreviewInspectorPageContextAccordionLabel');
    const componentSource = source.slice(componentStart, componentEnd);

    expect(componentSource).toContain("'data-rpi-page-choice': 'true'");
    expect(componentSource).toContain("'Apply recommended page path '");
    expect(componentSource).toContain("'Apply page path '");
    expect(componentSource).toContain("'Apply path'");
    expect(componentSource).toContain("'Try next'");
    expect(componentSource).toContain("'Queue path'");
    expect(componentSource).toContain('possibility.wrapperNames');
    expect(componentSource).toContain('possibility.callerNames');
    expect(componentSource).toContain('possibility.checking');
    expect(componentSource).toContain('possibility.executionContractLabel');
    expect(componentSource).toContain('possibility.stabilityLabel');
    expect(componentSource).toContain('possibility.variantCount');
    expect(componentSource).toContain("'Checking…'");
    expect(componentSource).toContain("'Unstable'");
  });
});
