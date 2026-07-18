/** Exercises target-guided DFS selection without mounting project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Minimal pure helper result exposed by the generated runtime fixture. */
interface ReachabilityResult {
  readonly blockerPath: readonly string[];
  readonly desiredValue: boolean;
  readonly expression: string;
  readonly fallbackExpression: string;
  readonly key: string;
  readonly returnedTargetValue: boolean;
  readonly targetExportName: string;
}

describe('Preview Inspector target reachability runtime source', () => {
  /** Selects the outer login exit before downstream consumers and retains root-to-target context. */
  it('chooses one path-local continuation gate for the next DFS pass', () => {
    const context: { __result?: ReachabilityResult } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'DashboardPanel',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { DashboardPanel: { paths: [] } },
          target: { exportName: 'DashboardPanel' },
        } };
        const candidate = {
          edges: [],
          id: 'application-path',
          renderPath: { id: 'path', steps: [
            { label: 'DashboardPanel', sourcePath: '/workspace/Dashboard.tsx', wrapperNames: [] },
            { label: 'Application', sourcePath: '/workspace/Application.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Application' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        previewInspectorSession.renderConditions.set('login', {
          effectiveEnabled: true,
          expression: '<Application> gate: !session',
          id: 'login',
          kind: 'early-return',
          ownerName: 'Application',
          reachabilityDiscoveryOrder: 1,
          reachabilityKey: state.key,
          sourcePath: '/workspace/Application.tsx',
          targetBranch: 'falsy',
        });
        previewInspectorSession.renderConditions.set('unrelated', {
          effectiveEnabled: false,
          expression: 'showAdvertisement',
          id: 'unrelated',
          kind: 'logical-and',
          ownerName: 'Advertisement',
          reachabilityDiscoveryOrder: 0,
          reachabilityKey: state.key,
          sourcePath: '/workspace/Advertisement.tsx',
          truthyLabel: '<Advertisement>',
        });
        previewInspectorSession.renderConditions.set('hoc-guard', {
          effectiveEnabled: true,
          expression: '<GuardedPage> gate: !isStaffMode',
          id: 'hoc-guard',
          kind: 'early-return',
          ownerName: 'GuardedPage',
          reachabilityDiscoveryOrder: 0,
          reachabilityKey: state.key,
          sourcePath: '/workspace/with-staff-page.tsx',
          targetBranch: 'falsy',
        });
        const next = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
        previewInspectorSession.renderConditions.delete('login');
        const fallbackNext = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
        const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
        globalThis.__result = {
          blockerPath: state.applicationPath,
          desiredValue: next.desiredValue,
          expression: next.condition.expression,
          fallbackExpression: fallbackNext.condition.expression,
          key: state.key,
          returnedTargetValue: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <Application>',
            targetBranch: 'falsy',
            truthyLabel: '<DashboardPanel>',
          }, evidence),
          targetExportName: state.targetExportName,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      blockerPath: ['Application', 'DashboardPanel'],
      desiredValue: false,
      expression: '<Application> gate: !session',
      fallbackExpression: '<GuardedPage> gate: !isStaffMode',
      key: 'application-path:DashboardPanel',
      returnedTargetValue: true,
      targetExportName: 'DashboardPanel',
    });
  });

  /** Keeps direct-target fallback, payload inventory, and user recovery actions in one module. */
  it('emits bounded target assertion and direct fallback controls', () => {
    const source = createPreviewInspectorTargetReachabilityRuntimeSource();

    expect(source).toContain('PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT = 16');
    expect(source).toContain('PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8');
    expect(source).toContain('hasMountedPreviewInspectorTarget(state)');
    expect(source).toContain('activatePreviewInspectorDirectTarget(state)');
    expect(source).toContain('readPreviewInspectorTargetReachabilityRequiredPaths');
    expect(source).toContain('smartFillPreviewInspectorTargetApplicationPath');
    expect(source).toContain('smartFillPreviewInspectorRuntimeFallbacksForReachability');
    expect(source).toContain('smartFillPreviewInspectorDataPayloadsForReachability');
    expect(source).toContain('retryPreviewInspectorTargetApplicationPath');
  });

  /** Batches minimum hook/data fixtures and preserves already proven corridor branch choices. */
  it('smart-fills one page path without clearing its guided gates', () => {
    const context: {
      __result?: {
        readonly calls: readonly string[];
        readonly dataRevision: number;
        readonly fallbackValuesEnabled: boolean;
        readonly gateRetained: boolean;
        readonly renderConditionRevision: number;
        readonly stateRetained: boolean;
      };
    } = {};
    vm.runInNewContext(
      `
        const calls = [];
        const previewInspectorSession = {
          dataAutoEnabled: false,
          dataRevision: 2,
          fallbackValuesEnabled: false,
          renderConditionRevision: 4,
          targetGuidedConditionOverrides: new Map([['login', false]]),
          targetReachabilityByKey: new Map([['page:Target', { key: 'page:Target' }]]),
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const initializePreviewInspectorDataState = () => undefined;
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = (key) => {
          calls.push('runtime:' + key);
          return true;
        };
        const smartFillPreviewInspectorDataPayloadsForReachability = (key) => {
          calls.push('data:' + key);
          return true;
        };
        const persistPreviewInspectorState = () => calls.push('persist');
        const notifyPreviewInspector = () => calls.push('notify');
        const schedulePreviewInspectorTreeRefresh = () => calls.push('tree');
        const schedulePreviewInspectorCommitRefresh = () => calls.push('commit');
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        smartFillPreviewInspectorTargetApplicationPath({ key: 'page:Target' });
        globalThis.__result = {
          calls,
          dataRevision: previewInspectorSession.dataRevision,
          fallbackValuesEnabled: previewInspectorSession.fallbackValuesEnabled,
          gateRetained: previewInspectorSession.targetGuidedConditionOverrides.has('login'),
          renderConditionRevision: previewInspectorSession.renderConditionRevision,
          stateRetained: previewInspectorSession.targetReachabilityByKey.has('page:Target'),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      calls: ['runtime:page:Target', 'data:page:Target', 'persist', 'notify', 'tree', 'commit'],
      dataRevision: 3,
      fallbackValuesEnabled: true,
      gateRetained: true,
      renderConditionRevision: 5,
      stateRetained: true,
    });
  });

  /** Continues through newly revealed batches and stops remounting after values stabilize. */
  it('converges minimum requirements across bounded settled render passes', () => {
    const context: {
      __result?: {
        readonly commitCount: number;
        readonly pass: number;
        readonly runtimeCalls: number;
        readonly status: string;
      };
    } = {};
    vm.runInNewContext(
      `
        let commitCount = 0;
        let runtimeCalls = 0;
        const previewInspectorSession = {
          boundariesByExport: new Map(),
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
        const setPreviewInspectorTargetGuidedConditionOverride = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const collectPreviewInspectorFiberElements = (boundary) =>
          boundary?.host === true ? [{}] : [];
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { Target: { paths: [] } },
          target: { exportName: 'Target' },
        } };
        const candidate = {
          edges: [],
          id: 'page',
          renderPath: { id: 'path', steps: [
            { label: 'Target', sourcePath: '/Target.tsx', wrapperNames: [] },
            { label: 'Page', sourcePath: '/Page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Page' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        smartFillPreviewInspectorTargetApplicationPath({ key: state.key });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const search = readPreviewInspectorMinimumRequirementSearch(state);
        globalThis.__result = {
          commitCount,
          pass: search.pass,
          runtimeCalls,
          status: search.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      commitCount: 2,
      pass: 2,
      runtimeCalls: 4,
      status: 'settled',
    });
  });

  /** A mounted HOC that returns Navigate has no host output and must not terminate target DFS. */
  it('continues through an off-graph HOC guard until the target produces host output', () => {
    const context: {
      __result?: {
        readonly applied: readonly [string, boolean][];
        readonly status: string;
        readonly targetHasOutput: boolean;
        readonly targetMounted: boolean;
      };
    } = {};
    vm.runInNewContext(
      `
        const applied = [];
        const previewInspectorSession = {
          boundariesByExport: new Map([['Target', new Set([{}])]]),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'Target',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const collectPreviewInspectorFiberElements = () => [];
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const setPreviewInspectorTargetGuidedConditionOverride = (id, enabled) => {
          applied.push([id, enabled]);
        };
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { Target: { paths: [] } },
          target: { exportName: 'Target' },
        } };
        const candidate = {
          edges: [],
          id: 'page',
          renderPath: { id: 'path', steps: [
            { label: 'Target', sourcePath: '/Target.tsx', wrapperNames: [] },
            { label: 'Page', sourcePath: '/Page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Page' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.renderConditions.set('guard', {
          effectiveEnabled: true,
          expression: '<GuardedPage> gate: !session',
          id: 'guard',
          ownerName: 'GuardedPage',
          reachabilityDiscoveryOrder: 1,
          reachabilityKey: state.key,
          sourcePath: '/with-page-guard.tsx',
          targetBranch: 'falsy',
        });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = {
          applied,
          status: state.status,
          targetHasOutput: state.targetHasOutput,
          targetMounted: state.targetMounted,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      applied: [['guard', false]],
      status: 'advancing',
      targetHasOutput: false,
      targetMounted: true,
    });
  });

  /** Requires a real page commit and never auto-promotes target-only diagnostics to success. */
  it('marks success only when page root and target commit in the same corridor', () => {
    const context: {
      __result?: {
        readonly blockedDirectTarget: boolean;
        readonly blockedStatus: string;
        readonly pagePendingStatus: string;
        readonly reachedStatus: string;
        readonly targetOnlyStatus: string;
      };
    } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'DashboardPanel',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        const setPreviewInspectorTargetGuidedConditionOverride = () => undefined;
        const clearPreviewInspectorTargetGuidedConditionOverrides = () => false;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const collectPreviewInspectorFiberElements = (boundary) =>
          boundary?.host === true ? [{}] : [];
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { DashboardPanel: { paths: [] } },
          target: { exportName: 'DashboardPanel' },
        } };
        const candidate = {
          edges: [],
          id: 'dashboard-page',
          renderPath: { id: 'path', steps: [
            { label: 'DashboardPanel', sourcePath: '/workspace/Dashboard.tsx', wrapperNames: [] },
            { label: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'DashboardPage' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        previewInspectorSession.boundariesByExport.set('DashboardPanel', new Set([{ host: true }]));
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const pagePendingStatus = state.status;
        state.pageRootCommitted = true;
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const reachedStatus = state.status;
        state.directTarget = true;
        state.pageRootCommitted = false;
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const targetOnlyStatus = state.status;

        previewInspectorSession.boundariesByExport.clear();
        const blockedCandidate = { ...candidate, id: 'blocked-page' };
        const blocked = readPreviewInspectorTargetReachabilityState(descriptor, blockedCandidate);
        blocked.pageRootCommitted = true;
        evaluatePreviewInspectorTargetReachability(descriptor, blockedCandidate, blocked);
        evaluatePreviewInspectorTargetReachability(descriptor, blockedCandidate, blocked);
        globalThis.__result = {
          blockedDirectTarget: blocked.directTarget,
          blockedStatus: blocked.status,
          pagePendingStatus,
          reachedStatus,
          targetOnlyStatus,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      blockedDirectTarget: false,
      blockedStatus: 'page-blocked',
      pagePendingStatus: 'page-root-pending',
      reachedStatus: 'reached',
      targetOnlyStatus: 'target-only',
    });
  });
});
