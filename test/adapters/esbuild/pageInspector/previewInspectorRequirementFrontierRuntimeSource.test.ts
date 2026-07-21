/** Exercises target-local requirement admission without mounting project React components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
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
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) =>
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

  /** Protects an explicit user value during background inference even if its Smart shape is stale. */
  it('does not revise a stale Smart manual value during deterministic search', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = { runtimeFallbackSmartPathSignatures: new Map() };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) =>
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
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) => JSON.stringify(paths);
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
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) => JSON.stringify(paths);
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
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) => JSON.stringify(paths);
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
