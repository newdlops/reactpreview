/** Exercises target-local requirement admission without mounting project React components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorRequirementFrontierRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementFrontierRuntimeSource';

describe('Preview Inspector requirement frontier runtime source', () => {
  /**
   * Re-admits a Smart hook exactly when its compiler-required shape has expanded. A settled Smart
   * hook stays excluded, which prevents explicit Retry from reapplying the same value forever.
   */
  it('selects stale Smart paths once while excluding signatures already covered', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          runtimeFallbackSmartPathSignatures: new Map([
            ['stale', JSON.stringify(['data'])],
            ['settled', JSON.stringify(['data', 'loading'])],
          ]),
        };
        const records = [
          {
            id: 'stale', mode: 'smart', reachabilityKey: 'page:Target',
            requiredPaths: ['data', 'loading'],
          },
          {
            id: 'settled', mode: 'smart', reachabilityKey: 'page:Target',
            requiredPaths: ['loading', 'data'],
          },
          {
            id: 'opaque', mode: 'auto', reachabilityKey: 'page:Target',
            requiredPaths: ['<root>'],
          },
        ];
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify([...new Set(paths)].sort());
        const readPreviewInspectorTargetPathEvidence = () => ({ nameScores: new Map(), paths: [] });
        const readPreviewInspectorRuntimeFallbacks = () => records;
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, false,
        );
      `,
      context,
    );

    expect(context.__result).toEqual({ hookIds: ['stale'], requestIds: [] });
  });

  /** Opens exact branch gates before broad shell shapes consume the bounded hook batch. */
  it('prioritizes path-local exact Smart scalars within a crowded requirement batch', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = { runtimeFallbackSmartPathSignatures: new Map() };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify([...new Set(paths)].sort());
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(), nameScores: new Map([['Dashboard', 1000]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const shellRecords = Array.from({ length: 8 }, (_, index) => ({
          id: 'shell-' + index, mode: 'auto', ownerName: 'Dashboard',
          reachabilityKey: 'page:Target', requiredPaths: ['data.shell.' + index],
        }));
        const exactGate = {
          id: 'completion-gate', mode: 'auto', ownerName: 'Dashboard',
          reachabilityKey: 'page:Target', requiredPaths: ['status'],
          smartPathValues: [{ path: 'status', value: 'COMPLETED' }],
        };
        const unrelatedGate = {
          id: 'unrelated-gate', mode: 'auto', ownerName: 'Elsewhere',
          reachabilityKey: 'page:Target', requiredPaths: ['status'],
          smartPathValues: [{ path: 'status', value: 'COMPLETED' }],
        };
        const readPreviewInspectorRuntimeFallbacks = () => [
          ...shellRecords, unrelatedGate, exactGate,
        ];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const readPreviewInspectorTargetRenderPath = () => undefined;
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, false,
        );
      `,
      context,
    );

    expect(context.__result).toMatchObject({
      hookIds: [
        'completion-gate',
        'shell-0',
        'shell-1',
        'shell-2',
        'shell-3',
        'shell-4',
        'shell-5',
        'shell-6',
      ],
      requestIds: [],
    });
  });

  /** Learned ranking changes order only when a safe automatic or explicit caller opts into it. */
  it('prefers current neural scores for an opted-in admitted requirement search', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const records = [
          {
            id: 'deterministic-first', mode: 'auto', ownerName: 'ExactTarget',
            reachabilityKey: 'page:Target', requiredPaths: ['data.primary'],
          },
          {
            id: 'learned-first', mode: 'auto', ownerName: 'TargetShell',
            reachabilityKey: 'page:Target', requiredPaths: ['data.secondary'],
          },
        ];
        const previewInspectorSession = {
          runtimeFallbackNeuralDecisions: new Map([
            ['deterministic-first', { score: 0.1 }],
            ['learned-first', { score: 0.9 }],
          ]),
          runtimeFallbackSmartPathSignatures: new Map(),
        };
        const comparePreviewInspectorNeuralResidualDecisions = (left, right) =>
          Number(right?.score ?? 0.5) - Number(left?.score ?? 0.5);
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify(paths);
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(),
          nameScores: new Map([['ExactTarget', 1000], ['TargetShell', 500]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const readPreviewInspectorRuntimeFallbacks = () => records;
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const readPreviewInspectorTargetRenderPath = () => undefined;
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = {
          automatic: readPreviewInspectorRequirementBatch(
            {}, {}, { key: 'page:Target' }, false,
          ).hookIds,
          requested: readPreviewInspectorRequirementBatch(
            {}, {}, { key: 'page:Target' }, false, { preferNeural: true },
          ).hookIds,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      automatic: ['deterministic-first', 'learned-first'],
      requested: ['learned-first', 'deterministic-first'],
    });
  });

  /** Each retry isolates a different admitted axis instead of replaying one broad mutation batch. */
  it('alternates novel, data-first, and hook-first exploration portfolios', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const hooks = [
          {
            id: 'hook-a', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', requiredPaths: ['state.primary'],
          },
          {
            id: 'hook-b', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', requiredPaths: ['state.secondary'],
          },
        ];
        const requests = [
          {
            id: 'data-a', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', shape: { primary: 'string' },
          },
          {
            id: 'data-b', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', shape: { secondary: 'string' },
          },
        ];
        const previewInspectorSession = { runtimeFallbackSmartPathSignatures: new Map() };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify(paths);
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(), nameScores: new Map([['Target', 1000]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const readPreviewInspectorRuntimeFallbacks = () => hooks;
        const readPreviewInspectorDataRequests = () => requests;
        const readPreviewInspectorDataShapePaths = (shape) => Object.keys(shape ?? {});
        const readPreviewInspectorTargetRenderPath = () => undefined;
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        const state = { key: 'page:Target', targetExportName: 'Target', targetMounted: false };
        globalThis.__result = {
          dataFirst: readPreviewInspectorRequirementBatch(
            {}, {}, state, false,
            { explorationMode: 'data-first', explorationOrdinal: 2 },
          ),
          hookFirst: readPreviewInspectorRequirementBatch(
            {}, {}, state, false,
            { explorationMode: 'hook-first', explorationOrdinal: 3 },
          ),
          novel: readPreviewInspectorRequirementBatch(
            {}, {}, state, false,
            {
              excludedCandidateIds: ['hook-a', 'data-a'],
              explorationMode: 'novel-candidate',
              explorationOrdinal: 1,
            },
          ),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      dataFirst: {
        explorationMode: 'data-first',
        hookIds: [],
        requestIds: ['data-a'],
      },
      hookFirst: {
        explorationMode: 'hook-first',
        hookIds: ['hook-a'],
        requestIds: [],
      },
      novel: {
        explorationMode: 'novel-candidate',
        hookIds: ['hook-b'],
        requestIds: ['data-b'],
      },
    });
  });

  /** A uniquely correlated exception hole gets one reversible typed-value attempt of its own. */
  it('prioritizes a neural blocker-exception recommendation for an unrendered target', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          runtimeFallbackSmartPathSignatures: new Map(),
          targetReachabilityByKey: new Map(),
        };
        const persistPreviewInspectorState = () => undefined;
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify([...new Set(paths)].sort());
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(), nameScores: new Map([['DirectorPage', 1000]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const records = [
          ...Array.from({ length: 8 }, (_, index) => ({
            id: 'page-data-' + index, mode: 'auto', ownerName: 'DirectorPage',
            reachabilityKey: 'page:Target', requiredPaths: ['data.items.' + index],
          })),
          {
            evidence: 'nested generated hook result', hookName: 'useAiChatPanel',
            id: 'panel-context-hole', mode: 'auto', ownerName: 'ChatLayoutFrame',
            reachabilityKey: 'page:Target', reason: 'neural-candidate',
            requiredPaths: ['state.status'],
            residualHoleKind: 'nested-generated-shape-mismatch',
            neuralRecommendation: { strategy: 'shape-only' },
            smartPathValues: [{ path: 'state.status', value: 'open' }],
            sourcePath: '/workspace/chat-layout-frame.tsx',
          },
        ];
        const readPreviewInspectorRuntimeFallbacks = () => records;
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const readPreviewInspectorTargetRenderPath = () => undefined;
        const readPreviewInspectorRuntimeHealthTargetError = () => ({
          message: "Cannot read properties of undefined (reading 'status')",
        });
        const readPreviewInspectorErrorPropertyPaths = () => ['status'];
        ${createPreviewInspectorNeuralResidualRuntimeSource()}
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, {
            key: 'page:Target', targetExportName: 'DirectorChangeLogPanel',
            targetMounted: false,
          }, false,
        );
      `,
      context,
    );

    expect(context.__result).toMatchObject({
      hookIds: ['panel-context-hole'],
      neuralResidualDecision: {
        holeKind: 'blocker-exception-runtime-value',
        score: 0.5,
      },
      requestIds: [],
    });
  });

  it('repairs a compiler-admitted shell collection before unrelated target-path hooks', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = { runtimeFallbackSmartPathSignatures: new Map() };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify(paths);
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(), nameScores: new Map([['MeetingPaymentPage', 1000]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const readPreviewInspectorRuntimeFallbacks = () => [
          {
            hookName: 'useInvestmentContractAnalysisStatus', id: 'target-hook', mode: 'auto',
            ownerName: 'MeetingPaymentPage', reachabilityKey: 'page:TaxTypeBadge',
            requiredPaths: ['loaded', 'status', 'runId', 'isInProgress'],
          },
          {
            hookName: 'getFragmentData', id: 'owner-menubar-fragment', mode: 'auto',
            ownerName: 'UnreadNotificationSection', reachabilityKey: 'page:TaxTypeBadge',
            requiredPaths: ['warnings', 'warnings.some()', 'warnings[].isStaffOnly'],
          },
        ];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const readPreviewInspectorTargetRenderPath = () => undefined;
        const readPreviewInspectorErrorPropertyPaths = () => ['some'];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, {
            key: 'page:TaxTypeBadge', targetExportName: 'TaxTypeBadge', targetMounted: false,
            targetOutputError: {
              message: "Cannot read properties of undefined (reading 'some')",
            },
          }, false,
        );
      `,
      context,
    );

    expect(context.__result).toEqual({
      hookIds: ['owner-menubar-fragment'],
      requestIds: [],
    });
  });

  /** Protects an explicit user value during background inference even if its Smart shape is stale. */
  it('does not revise a stale Smart manual value during deterministic search', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = { runtimeFallbackSmartPathSignatures: new Map() };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) =>
          JSON.stringify([...new Set(paths)].sort());
        const readPreviewInspectorTargetPathEvidence = () => ({ nameScores: new Map(), paths: [] });
        const readPreviewInspectorRuntimeFallbacks = () => [{
          id: 'manual', mode: 'smart-manual', reachabilityKey: 'page:Target',
          requiredPaths: ['data'],
        }];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, true,
        );
      `,
      context,
    );

    expect(context.__result).toEqual({ hookIds: [], requestIds: [] });
  });

  /** Reopens only the backend fixture whose inferred response shape expanded after Smart fill. */
  it('selects stale Smart payload shapes while excluding covered payloads', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          dataPayloadSmartShapeSignatures: new Map([
            ['stale-request', 'old-shape'],
            ['settled-request', 'current-shape'],
          ]),
        };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) => JSON.stringify(paths);
        const readPreviewInspectorTargetPathEvidence = () => ({ nameScores: new Map(), paths: [] });
        const readPreviewInspectorTargetRenderPath = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [
          { id: 'stale-request', mode: 'smart', reachabilityKey: 'page:Target', shapeFingerprint: 'new-shape' },
          { id: 'settled-request', mode: 'smart', reachabilityKey: 'page:Target', shapeFingerprint: 'current-shape' },
        ];
        const readPreviewInspectorDataShapePaths = () => ['data.id'];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, false,
        );
      `,
      context,
    );

    expect(context.__result).toEqual({ hookIds: [], requestIds: ['stale-request'] });
  });

  /** Prioritizes the owner that must invoke a JSX render callback before broad target payloads. */
  it('scores a statically proven deferred render contract before ordinary path requirements', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {};
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) => JSON.stringify(paths);
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const readPreviewInspectorTargetRenderPath = () => ({ steps: [] });
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        const descriptor = { inspector: { renderOutcomesByExport: { Target: { outcomes: [
          {
            componentTree: [{
              children: [{
                children: [], name: 'Page', renderMode: 'deferred-callback',
                sourcePath: '/QueryPage.tsx',
              }],
              name: 'QueryRenderer', sourcePath: '/QueryPage.tsx',
            }],
            conditions: [{ id: 'has-data' }], id: 'visible', kind: 'jsx',
            sourcePath: '/QueryPage.tsx',
          },
        ] } } } };
        const state = { targetExportName: 'Target', targetMounted: true, targetHasOutput: false };
        const contract = readPreviewInspectorDeferredRenderContract(descriptor, {}, state);
        const evidence = {
          ambiguousNames: new Set(), deferredRenderContract: contract,
          nameScores: new Map([['Target', 1000]]), pathScores: new Map(), paths: [],
          runtimeOwnerNames: new Set(),
        };
        globalThis.__result = {
          contract,
          rendererScore: scorePreviewInspectorRequirementRecord(
            { ownerName: 'QueryRenderer', sourcePath: '/QueryPage.tsx' }, evidence,
          ),
          targetScore: scorePreviewInspectorRequirementRecord(
            { ownerName: 'Target', sourcePath: '/Target.tsx' }, evidence,
          ),
        };
      `,
      context,
    );

    expect(context.__result).toMatchObject({
      contract: {
        active: true,
        conditionIds: ['has-data'],
        kind: 'deferred-render-contract',
        ownerNames: ['QueryRenderer'],
        slotNames: ['children'],
      },
      rendererScore: 1400,
      targetScore: 1000,
    });
  });

  /** Preserves a child requirement discovered during the active pass and resumes it once. */
  it('defers a continuation until the current requirement search settles', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const callbacks = [];
        let notifications = 0;
        let treeRefreshes = 0;
        const state = {
          directTarget: false, exhausted: false, idlePasses: 0, key: 'page:Target',
          pageRootCommitted: false, probeRevision: 6, status: 'filling-requirements',
          targetExportName: 'Target', targetHasOutput: false, targetMounted: false,
        };
        const search = { origin: 'deterministic-auto', pass: 6, status: 'searching' };
        const hookRecord = {
          id: 'late-completion-gate', mode: 'auto', ownerName: 'Target', passive: false,
          reachabilityKey: state.key, requiredPaths: ['status'],
          smartPathValues: [{ path: 'status', value: 'COMPLETED' }],
        };
        const previewInspectorSession = {
          minimumRequirementSearchByKey: new Map([[state.key, search]]),
          requirementConvergenceByKey: new Map(),
          runtimeFallbackSmartPathSignatures: new Map(),
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        const initializePreviewInspectorTargetReachabilityState = () => undefined;
        const hasMountedPreviewInspectorTarget = () => false;
        const hasPreviewInspectorTargetHostOutput = () => false;
        const findSelectedPreviewInspectorDescriptor = () => ({ inspector: {} });
        const readSelectedPreviewInspectorPageCandidate = () => ({});
        const readPreviewInspectorMinimumRequirementSearch = () => search;
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(), nameScores: new Map([['Target', 1000]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const readPreviewInspectorTargetRenderPath = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [hookRecord];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) => JSON.stringify(paths);
        const canStartPreviewInspectorDeterministicRequirementSearch = () => true;
        const readPreviewInspectorRequirementConvergence = () => ({ totalPasses: 6 });
        const readPreviewInspectorTargetReachabilityRequiredPaths = () => hookRecord.requiredPaths;
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
        globalThis.queueMicrotask = (callback) => callbacks.push(callback);
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        const scheduled = schedulePreviewInspectorTargetRequirementContinuation(state.key);
        callbacks.shift()();
        const deferredBeforeCommit =
          previewInspectorSession.requirementContinuationDeferredKeys.has(state.key);
        state.pageRootCommitted = true;
        const releasedAtCommit = releasePreviewInspectorDeferredRequirementContinuation(state);
        callbacks.shift()();
        const deferredDuringSearch =
          previewInspectorSession.requirementContinuationDeferredKeys.has(state.key);
        const duplicate = schedulePreviewInspectorTargetRequirementContinuation(state.key);
        search.status = 'settled';
        const released = releasePreviewInspectorDeferredRequirementContinuation(state);
        const queuedAfterRelease = callbacks.length;
        callbacks.shift()();
        globalThis.__result = {
          deferredBeforeCommit, deferredDuringSearch, duplicate, notifications,
          probeRevision: state.probeRevision, queuedAfterRelease, released, releasedAtCommit,
          scheduled, searchStatus: search.status,
          stateStatus: state.status, treeRefreshes,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      deferredBeforeCommit: true,
      deferredDuringSearch: true,
      duplicate: false,
      notifications: 1,
      probeRevision: 7,
      queuedAfterRelease: 1,
      released: true,
      releasedAtCommit: true,
      scheduled: true,
      searchStatus: 'searching',
      stateStatus: 'resuming-new-requirements',
      treeRefreshes: 1,
    });
  });

  /** Reopens a settled corridor once for new actionable evidence, but not after host output exists. */
  it('coalesces bounded continuation around newly discovered child requirements', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        let notifications = 0;
        let treeRefreshes = 0;
        const state = {
          directTarget: false, exhausted: true, idlePasses: 2, key: 'page:Target',
          pageRootCommitted: true, probeRevision: 4, status: 'page-blocked',
          targetExportName: 'Target', targetHasOutput: false, targetMounted: true,
        };
        const search = { origin: 'user', pass: 4, status: 'settled' };
        const hookRecord = {
          id: 'child-hook', mode: 'auto', ownerName: 'Target', passive: false,
          reachabilityKey: state.key, requiredPaths: ['data.child.id'],
        };
        const previewInspectorSession = {
          minimumRequirementSearchByKey: new Map([[state.key, search]]),
          requirementConvergenceByKey: new Map(),
          runtimeFallbackSmartPathSignatures: new Map(),
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        const initializePreviewInspectorTargetReachabilityState = () => undefined;
        const hasMountedPreviewInspectorTarget = () => true;
        const hasPreviewInspectorTargetHostOutput = () => state.targetHasOutput;
        const findSelectedPreviewInspectorDescriptor = () => ({ inspector: {} });
        const readSelectedPreviewInspectorPageCandidate = () => ({});
        const readPreviewInspectorMinimumRequirementSearch = () => search;
        const readPreviewInspectorTargetPathEvidence = () => ({
          ambiguousNames: new Set(), nameScores: new Map([['Target', 1000]]),
          pathScores: new Map(), paths: [], runtimeOwnerNames: new Set(),
        });
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const readPreviewInspectorTargetRenderPath = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [hookRecord];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const createPreviewInspectorRuntimeFallbackSmartSignature = (_record, paths) => JSON.stringify(paths);
        const canStartPreviewInspectorDeterministicRequirementSearch = () => true;
        const readPreviewInspectorRequirementConvergence = () => ({ totalPasses: 4 });
        const readPreviewInspectorTargetReachabilityRequiredPaths = () => hookRecord.requiredPaths;
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
        globalThis.queueMicrotask = (callback) => callback();
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        const first = schedulePreviewInspectorTargetRequirementContinuation(state.key);
        const afterFirst = { probeRevision: state.probeRevision, status: state.status };
        state.targetHasOutput = true;
        search.status = 'settled';
        const second = schedulePreviewInspectorTargetRequirementContinuation(state.key);
        globalThis.__result = { afterFirst, first, notifications, second, treeRefreshes };
      `,
      context,
    );

    expect(context.__result).toEqual({
      afterFirst: { probeRevision: 5, status: 'resuming-new-requirements' },
      first: true,
      notifications: 1,
      second: true,
      treeRefreshes: 1,
    });
  });
});
