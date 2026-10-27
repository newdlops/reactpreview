/** Covers requirements behavior for previewInspectorTargetReachabilityRuntimeSource. */
/** Verifies authored-source previewInspectorTargetReachabilityRuntimeSource invariants. */
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createPreviewInspectorRequirementFrontierRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementFrontierRuntimeSource';

import {
  createPageTargetDescriptorCandidateFixtureSource,
  createTargetReachabilityFixtureSource,
} from './previewInspectorTargetReachabilityRuntimeSourceFixtures';

describe('Preview Inspector target reachability runtime source', () => {
  /** Prioritizes a bounded target corridor frontier and excludes passive hook observations. */
  it('selects incremental path-local hook and backend requirement batches', () => {
    const context: {
      __result?: { readonly hookIds: readonly string[]; readonly requestIds: readonly string[] };
    } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'Target',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const hooks = [
          ...Array.from({ length: 10 }, (_, index) => ({
            hookName: 'useSibling' + index,
            id: 'sibling-hook-' + index,
            mode: 'auto',
            ownerName: 'Sibling' + index,
            reachabilityKey: 'page:Target',
            requiredPaths: ['value'],
            sourcePath: '/Sibling' + index + '.tsx',
          })),
          {
            hookName: 'usePage', id: 'page-hook', mode: 'auto', ownerName: 'Page',
            reachabilityKey: 'page:Target', requiredPaths: ['layout'], sourcePath: '/Page.tsx',
          },
          {
            hookName: 'useTarget', id: 'target-hook', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', requiredPaths: ['value'], sourcePath: '/Target.tsx',
          },
          {
            hookName: 'usePassive', id: 'passive-hook', mode: 'auto', ownerName: 'Target',
            passive: true, reachabilityKey: 'page:Target', requiredPaths: ['<root>'],
            sourcePath: '/Target.tsx',
          },
          {
            hookName: 'useOpaque', id: 'opaque-hook', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', requiredPaths: ['<root>'], sourcePath: '/Target.tsx',
          },
        ];
        const requests = [
          ...Array.from({ length: 6 }, (_, index) => ({
            id: 'sibling-request-' + index,
            label: 'Sibling request ' + index,
            mode: 'auto',
            ownerName: 'Sibling' + index,
            reachabilityKey: 'page:Target',
            sourcePath: '/Sibling' + index + '.tsx',
          })),
          {
            id: 'page-request', label: 'Page request', mode: 'auto', ownerName: 'Page',
            reachabilityKey: 'page:Target', sourcePath: '/Page.tsx',
          },
          {
            id: 'target-request', label: 'Target request', mode: 'auto', ownerName: 'Target',
            reachabilityKey: 'page:Target', sourcePath: '/Target.tsx',
          },
        ];
        const readPreviewInspectorRuntimeFallbacks = () => hooks;
        const readPreviewInspectorDataRequests = () => requests;
        const readPreviewInspectorDataShapePaths = () => [];
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        globalThis.__result = readPreviewInspectorRequirementBatch(
          descriptor, candidate, state, false,
        );
      `,
      context,
    );
    expect(context.__result?.hookIds).toEqual(['target-hook', 'page-hook']);
    expect(context.__result?.hookIds).not.toContain('passive-hook');
    expect(context.__result?.hookIds).not.toContain('opaque-hook');
    expect(context.__result?.requestIds).toEqual(['target-request', 'page-request']);
  });

  /** Retains bounded progress for anonymous requirements when no path correlation exists at all. */
  it('uses the frontier limits as a last-resort batch for entirely unscored observations', () => {
    const context: {
      __result?: { readonly hookIds: readonly string[]; readonly requestIds: readonly string[] };
    } = {};
    vm.runInNewContext(
      `
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const readPreviewInspectorTargetPathEvidence = () => ({
          nameScores: new Map(), paths: [],
        });
        const readPreviewInspectorRuntimeFallbacks = () =>
          Array.from({ length: 10 }, (_, index) => ({
            id: 'hook-' + index, mode: 'auto', reachabilityKey: 'page:Target',
            requiredPaths: ['value'],
          }));
        const readPreviewInspectorDataRequests = () =>
          Array.from({ length: 6 }, (_, index) => ({
            id: 'request-' + index, mode: 'auto', reachabilityKey: 'page:Target',
          }));
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, false,
        );
      `,
      context,
    );

    expect(context.__result?.hookIds).toHaveLength(8);
    expect(context.__result?.requestIds).toHaveLength(4);
  });

  /** Batches minimum hook/data fixtures and preserves already proven corridor branch choices. */
  it('smart-fills one page path without clearing its guided gates', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const calls = [];
        const previewInspectorSession = {
          dataAutoEnabled: false,
          dataRevision: 2,
          fallbackValuesEnabled: false,
          renderConditionRevision: 4,
          runtimeFallbackValues: new Map(),
          dataRequests: new Map(),
          targetGuidedConditionOverrides: new Map([['login', false]]),
          targetReachabilityByKey: new Map([['page:Target', { key: 'page:Target' }]]),
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const initializePreviewInspectorDataState = () => undefined;
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = (key, options) => {
          calls.push('runtime:' + key + ':' + String(options?.preserveUserValues));
          return true;
        };
        const smartFillPreviewInspectorDataPayloadsForReachability = (key, options) => {
          calls.push('data:' + key + ':' + String(options?.preserveUserValues));
          return true;
        };
        const persistPreviewInspectorState = () => calls.push('persist');
        const notifyPreviewInspector = () => calls.push('notify');
        const schedulePreviewInspectorTreeRefresh = () => calls.push('tree');
        const schedulePreviewInspectorCommitRefresh = () => calls.push('commit');
        const readPreviewInspectorRuntimeFallbacks = () => [{
          hookName: 'useQuery', id: 'query', mode: 'auto', passive: false,
          reachabilityKey: 'page:Target', requiredPaths: ['data'],
        }];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const createPreviewInspectorRuntimeFallbackSmartDraftTemplate = () => ({});
        const generatePreviewInspectorDataValue = () => ({});
        let recordPreviewInspectorBlockerAutoDecision = () => undefined;
        ${createTargetReachabilityFixtureSource()}
        const resetConvergence = resetPreviewInspectorRequirementConvergence;
        resetPreviewInspectorRequirementConvergence = (key) => {
          calls.push('convergence-reset:' + (key?.key ?? key));
          return resetConvergence(key);
        };
        const clearRollbacks = clearPreviewInspectorRequirementAutoRollbacks;
        clearPreviewInspectorRequirementAutoRollbacks = (key) => {
          calls.push('rollback-clear:' + key);
          return clearRollbacks(key);
        };
        const captureRollback = capturePreviewInspectorRequirementAutoRollback;
        capturePreviewInspectorRequirementAutoRollback = (state, batch) => {
          calls.push('capture:' + state.key + ':' + batch.hookIds.join(','));
          return captureRollback(state, batch);
        };
        const registerRollback = registerPreviewInspectorRequirementAutoRollback;
        registerPreviewInspectorRequirementAutoRollback = (traceId, snapshot) => {
          const registered = registerRollback(traceId, snapshot);
          calls.push('register:' + traceId + ':' + snapshot?.reachabilityKey + ':' + snapshot?.mode + ':' + registered);
          return registered;
        };
        recordPreviewInspectorBlockerAutoDecision = (decision) => {
          calls.push('trace:' + decision.mode + ':' + String(decision.startsRenderAttempt));
          return decision.startsRenderAttempt === true ? 'user-trace' : undefined;
        };
        smartFillPreviewInspectorTargetApplicationPath({ key: 'page:Target' });
        globalThis.__result = {
          calls,
          dataRevision: previewInspectorSession.dataRevision,
          fallbackValuesEnabled: previewInspectorSession.fallbackValuesEnabled,
          gateRetained: previewInspectorSession.targetGuidedConditionOverrides.has('login'),
          observedPathCount:
            previewInspectorSession.minimumRequirementSearchByKey.get('page:Target').observedPathCount,
          renderConditionRevision: previewInspectorSession.renderConditionRevision,
          stateRetained: previewInspectorSession.targetReachabilityByKey.has('page:Target'),
        };
      `,
      context,
    );
    expect(context.__result).toEqual({
      calls:
        'convergence-reset:page:Target|rollback-clear:page:Target|trace:minimum-requirement-dfs:undefined|capture:page:Target:query|runtime:page:Target:false|data:page:Target:false|trace:minimum-requirement-dfs:true|register:user-trace:page:Target:minimum-requirement-dfs:true|persist|notify|tree|commit'.split(
          '|',
        ),
      dataRevision: 3,
      fallbackValuesEnabled: true,
      gateRetained: true,
      observedPathCount: 1,
      renderConditionRevision: 5,
      stateRetained: true,
    });
  });

  /** Leaves an identical data frontier and advances the mounted current-file gate without remounting. */
  it('continues from a stalled requirement batch into an exact target-local gate', () => {
    const context: {
      __result?: {
        readonly applied: readonly [string, boolean][];
        readonly commitCount: number;
        readonly pass: number;
        readonly runtimeCalls: number;
        readonly status: string;
      };
    } = {};
    vm.runInNewContext(
      `
        const applied = [];
        let commitCount = 0;
        let runtimeCalls = 0;
        const previewInspectorSession = {
          boundariesByExport: new Map([['Target', new Set([{
            props: { exportName: 'Target', sourcePath: '/Target.tsx' },
          }])]]),
          dataRevision: 0,
          renderConditionOverrides: new Map(),
          renderConditionRevision: 0,
          renderConditions: new Map(),
          selectedExportName: 'Target',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = () => {
          runtimeCalls += 1;
          return runtimeCalls <= 2;
        };
        const smartFillPreviewInspectorDataPayloadsForReachability = () => false;
        const persistPreviewInspectorState = () => undefined;
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => { commitCount += 1; };
        const setPreviewInspectorTargetGuidedConditionOverride = (id, enabled) => {
          applied.push([id, enabled]);
          previewInspectorSession.renderConditionOverrides.set(id, enabled);
          return true;
        };
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const collectPreviewInspectorFiberElements = (boundary) =>
          boundary?.host === true ? [{}] : [];
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.directTargetConditionIdsByExport = new Map([
          ['Target', new Set(['target-guard'])],
        ]);
        previewInspectorSession.renderConditions.set('target-guard', {
          effectiveEnabled: false,
          expression: 'showDirectorList',
          id: 'target-guard',
          ownerName: 'Target',
          reachabilityKey: state.key,
          sourcePath: '/Target.tsx',
          targetBranch: 'truthy',
        });
        smartFillPreviewInspectorTargetApplicationPath({ key: state.key });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const search = readPreviewInspectorMinimumRequirementSearch(state);
        globalThis.__result = {
          applied,
          commitCount,
          pass: search.pass,
          runtimeCalls,
          status: search.status,
        };
      `,
      context,
    );
    expect(context.__result).toEqual({
      applied: [['target-guard', true]],
      commitCount: 2,
      pass: 2,
      runtimeCalls: 2,
      status: 'stalled',
    });
  });

  /** Applies coherent target state before independently bypassing its authored JSX guards. */
  it('prioritizes an exact target Smart discriminator over a mounted empty gate', () => {
    const context: {
      __result?: {
        readonly conditionCalls: number;
        readonly runtimeCalls: number;
        readonly status: string;
      };
    } = {};
    vm.runInNewContext(
      `
        let activeKey = '';
        let conditionCalls = 0;
        let runtimeCalls = 0;
        const previewInspectorSession = {
          boundariesByExport: new Map([['Target', new Set([{
            props: { exportName: 'Target', sourcePath: '/Target.tsx' },
          }])]]),
          dataRequests: new Map(),
          dataPayloadOverrides: new Map(),
          dataPayloadSmartShapeSignatures: new Map(),
          dataRevision: 0,
          fallbackValuesEnabled: true,
          renderConditionOverrides: new Map(),
          renderConditionRevision: 0,
          renderConditions: new Map(),
          runtimeFallbackMaterializedOverrides: new Map(),
          runtimeFallbackOverrides: new Map(),
          runtimeFallbacks: new Map(),
          runtimeFallbackSmartIds: new Set(),
          runtimeFallbackSmartPathSignatures: new Map(),
          runtimeFallbackValues: new Map([['target-state', { state: { status: 'PREVIEW' } }]]),
          selectedExportName: 'Target',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [{
          id: 'target-state', mode: 'auto', ownerName: 'Target',
          reachabilityKey: activeKey, requiredPaths: ['state.status'],
          smartPathValues: [{ path: 'state.status', value: 'loading' }],
          sourcePath: '/Target.tsx',
        }];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = () => {
          runtimeCalls += 1;
          return true;
        };
        const smartFillPreviewInspectorDataPayloadsForReachability = () => false;
        const persistPreviewInspectorState = () => undefined;
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        const setPreviewInspectorTargetGuidedConditionOverride = () => {
          conditionCalls += 1;
          return true;
        };
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const recordPreviewInspectorBlockerAutoDecision = () => undefined;
        const createPreviewInspectorRuntimeFallbackSmartDraftTemplate = () => ({});
        const generatePreviewInspectorDataValue = () => ({});
        const collectPreviewInspectorFiberElements = () => [];
        const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        activeKey = state.key;
        state.pageRootCommitted = true;
        previewInspectorSession.renderConditions.set('target-gate', {
          authoredValueKind: 'boolean', effectiveEnabled: true,
          expression: '<Target> gate: state.status === "closed"', id: 'target-gate',
          kind: 'early-return', ownerName: 'Target', reachabilityKey: state.key,
          sourcePath: '/Target.tsx', targetBranch: 'falsy',
        });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = { conditionCalls, runtimeCalls, status: state.status };
      `,
      context,
    );

    expect(context.__result).toEqual({
      conditionCalls: 0,
      runtimeCalls: 1,
      status: 'filling-requirements',
    });
  });

  /** Re-admits a stale Smart backend shape to deterministic convergence without an Inspector click. */
  it('auto-starts deterministic minimum requirements for an expanded Smart payload', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const calls = [];
        let activeKey = '';
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          dataPayloadOverrides: new Map([['profile-request', { mode: 'smart', payload: {} }]]),
          dataPayloadSmartShapeSignatures: new Map([['profile-request', 'previous-shape']]),
          dataRequests: new Map(),
          dataRevision: 0,
          renderConditionOverrides: new Map(),
          renderConditionRevision: 0,
          renderConditions: new Map(),
          selectedExportName: 'Target',
          runtimeFallbackValues: new Map(),
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [{
          id: 'profile-request', kind: 'graphql', mode: 'smart', shapeFingerprint: 'expanded-shape',
          reachabilityKey: activeKey,
          shape: { fields: { id: { kind: 'string' } }, kind: 'object' },
        }];
        const readPreviewInspectorDataShapePaths = () => ['profile.id'];
        let filled = false;
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = (key, options) => {
          calls.push('runtime:' + key + ':' + String(options?.preserveUserValues));
          return false;
        };
        const smartFillPreviewInspectorDataPayloadsForReachability = (key, options) => {
          calls.push('data:' + key + ':' + String(options?.preserveUserValues));
          if (filled) return false;
          filled = true;
          return true;
        };
        const persistPreviewInspectorState = () => calls.push('persist');
        const notifyPreviewInspector = () => calls.push('notify');
        const schedulePreviewInspectorTreeRefresh = () => calls.push('tree');
        const schedulePreviewInspectorCommitRefresh = () => calls.push('commit');
        const collectPreviewInspectorFiberElements = () => [];
        let clearPreviewInspectorTargetGuidedConditionOverrides = () => false;
        const setPreviewInspectorTargetGuidedConditionOverride = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const createPreviewInspectorRuntimeFallbackSmartDraftTemplate = () => ({});
        const generatePreviewInspectorDataValue = () => ({});
        let recordPreviewInspectorBlockerAutoDecision = () => undefined;
        ${createTargetReachabilityFixtureSource()}
        const captureRollback = capturePreviewInspectorRequirementAutoRollback;
        capturePreviewInspectorRequirementAutoRollback = (state, batch) => {
          calls.push(
            'capture:' + state.key + ':' + batch.hookIds.join(',') + ':' + batch.requestIds.join(','),
          );
          return captureRollback(state, batch);
        };
        const registerRollback = registerPreviewInspectorRequirementAutoRollback;
        registerPreviewInspectorRequirementAutoRollback = (traceId, snapshot) => {
          const registered = registerRollback(traceId, snapshot);
          if (registered)
            calls.push('register:' + traceId + ':' + snapshot.reachabilityKey + ':' + snapshot.mode);
          return registered;
        };
        recordPreviewInspectorBlockerAutoDecision = (decision) => {
          calls.push('trace:' + decision.mode + ':' + String(decision.startsRenderAttempt));
          return decision.startsRenderAttempt === true ? 'trace-1' : undefined;
        };
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        activeKey = state.key;
        previewInspectorSession.dataRequests.set('profile-request', readPreviewInspectorDataRequests()[0]);
        state.pageRootCommitted = true;
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const search = readPreviewInspectorMinimumRequirementSearch(state);
        const changedStatus = state.status;
        const changedCalls = calls.length;
        resetPreviewInspectorRequirementConvergence(state);
        search.status = 'searching';
        advancePreviewInspectorMinimumRequirementSearch(descriptor, candidate, state);
        const unchangedCalls = calls.length;
        const clears = [], conditionClears = [];
        const clearRollbacks = clearPreviewInspectorRequirementAutoRollbacks;
        clearPreviewInspectorRequirementAutoRollbacks = (key) => {
          clears.push(key === undefined ? 'all' : key);
          return clearRollbacks(key);
        };
        const clearConditions = clearPreviewInspectorTargetGuidedConditionOverrides;
        clearPreviewInspectorTargetGuidedConditionOverrides = (key) => {
          conditionClears.push(key === undefined ? 'all' : key);
          return clearConditions(key);
        };
        const otherSnapshot = capturePreviewInspectorRequirementAutoRollback(
          { key: 'page:Other' },
          { hookIds: [], requestIds: ['profile-request'] },
        );
        otherSnapshot.mode = 'deterministic-minimum-auto';
        registerPreviewInspectorRequirementAutoRollback('other-trace', otherSnapshot);
        findSelectedPreviewInspectorDescriptor = () => descriptor;
        readSelectedPreviewInspectorPageCandidate = () => candidate;
        retryPreviewInspectorTargetApplicationPath();
        const firstTransactionGone = !previewInspectorSession.requirementAutoRollbackByTraceId.has('trace-1');
        const otherTransactionRetained = previewInspectorSession.requirementAutoRollbackByTraceId.has('other-trace');
        const retryStateAbsent = !previewInspectorSession.targetReachabilityByKey.has(state.key);
        const retrySearchAbsent = !previewInspectorSession.minimumRequirementSearchByKey.has(state.key);
        const retrySizes = [previewInspectorSession.targetReachabilityByKey.size, previewInspectorSession.minimumRequirementSearchByKey.size, previewInspectorSession.requirementAutoRollbackByTraceId.size];
        const reset = resetPreviewInspectorTargetReachability();
        globalThis.__result = {
          calls,
          changedCalls,
          changedStatus,
          clears,
          conditionClears,
          firstTransactionGone,
          otherTransactionRetained,
          retryStateAbsent,
          retrySearchAbsent,
          retrySizes,
          origin: search.origin,
          pass: search.pass,
          reset,
          searchStatus: search.status,
          status: state.status,
          mapsEmpty: [previewInspectorSession.targetReachabilityByKey.size, previewInspectorSession.minimumRequirementSearchByKey.size, previewInspectorSession.requirementAutoRollbackByTraceId.size],
          activeKey: previewInspectorSession.activeTargetReachabilityKey,
          unchangedCalls,
        };
      `,
      context,
    );
    expect(context.__result).toEqual({
      calls:
        'trace:deterministic-minimum-auto:undefined|capture:page:Target::profile-request|runtime:page:Target:true|data:page:Target:true|trace:deterministic-minimum-auto:true|register:trace-1:page:Target:deterministic-minimum-auto|persist|notify|tree|commit|capture:page:Target::profile-request|runtime:page:Target:true|data:page:Target:true|capture:page:Other::profile-request|register:other-trace:page:Other:deterministic-minimum-auto|notify|commit'.split(
          '|',
        ),
      clears: ['page:Target', 'all'],
      conditionClears: ['page:Target', 'all'],
      changedCalls: 10,
      changedStatus: 'filling-requirements',
      origin: 'deterministic-auto',
      pass: 1,
      reset: true,
      searchStatus: 'settled',
      status: 'filling-requirements',
      unchangedCalls: 13,
      firstTransactionGone: true,
      otherTransactionRetained: true,
      retryStateAbsent: true,
      retrySearchAbsent: true,
      retrySizes: [0, 0, 1],
      mapsEmpty: [0, 0, 0],
      activeKey: undefined,
    });
  });
});
