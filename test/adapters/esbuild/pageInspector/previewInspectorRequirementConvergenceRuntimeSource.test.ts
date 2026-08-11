/** Exercises automatic requirement convergence and session-only rollback transactions without mounting project-owned React components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRequirementConvergenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementConvergenceRuntimeSource';

/** Runs one browser-runtime scenario with stable hook/request registries and captured diagnostics. */
function runConvergenceScenario(scenario: string): unknown {
  const context: { __result?: unknown } = {};
  vm.runInNewContext(
    `
      const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
      const PREVIEW_INSPECTOR_REQUIREMENT_HOOK_BATCH_LIMIT = 24;
      const PREVIEW_INSPECTOR_REQUIREMENT_DATA_BATCH_LIMIT = 12;
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const previewEntryRevision = 4;
      const warnings = [];
      const health = [];
      let notifications = 0;
      let treeRefreshes = 0;
      let commits = 0;
      let deferredClears = 0;
      let deferredReleases = 0;
      let contextualFallbackAccepted = false;
      let contextualFallbackRequests = 0;
      let pageExecutionRetryAccepted = false;
      let pageExecutionRetryRequests = 0;
      let persists = 0;
      const hookRecord = {
        id: 'session-hook',
        reachabilityKey: 'page:Target',
        requiredPaths: ['session.user.id'],
      };
      const previewInspectorSession = {
        dataPayloadOverrides: new Map(),
        dataPayloadSmartShapeSignatures: new Map(),
        dataAutoEnabled: false,
        dataRevision: 3,
        fallbackValuesEnabled: false,
        minimumRequirementSearchByKey: new Map(),
        renderConditionRevision: 6,
        runtimeFallbackMaterializedOverrides: new Map(),
        runtimeFallbackOverrides: new Map(),
        runtimeFallbackSmartIds: new Set(),
        runtimeFallbackSmartPathSignatures: new Map(),
        runtimeFallbacks: new Map([['session-hook', hookRecord]]),
        runtimeFallbackValues: new Map([['session-hook', { session: { user: { id: 'A' } } }]]),
        targetReachabilityByKey: new Map(),
      };
      const initializePreviewInspectorTargetReachabilityState = () => {
        previewInspectorSession.minimumRequirementSearchByKey ??= new Map();
      };
      const readPreviewInspectorRuntimeFallbacks = () => [{ ...hookRecord }];
      const readPreviewInspectorDataRequests = () => [];
      const readPreviewInspectorDataShapePaths = () => [];
      const readPreviewInspectorTargetReachabilityRequiredPaths = () => hookRecord.requiredPaths;
      const recordPreviewInspectorConsoleEntry = (entry) => warnings.push(entry);
      const recordPreviewInspectorRuntimeHealth = (entry) => health.push(entry);
      const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
      const notifyPreviewInspector = () => { notifications += 1; };
      const persistPreviewInspectorState = () => { persists += 1; };
      const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
      const schedulePreviewInspectorCommitRefresh = () => { commits += 1; };
      const clearPreviewInspectorDeferredRequirementContinuation = () => {
        deferredClears += 1;
        return true;
      };
      const releasePreviewInspectorDeferredRequirementContinuation = () => {
        deferredReleases += 1;
        return true;
      };
      const selectedCandidate = { id: 'browser-candidate' };
      const selectedDescriptor = { inspector: { id: 'descriptor' } };
      const findSelectedPreviewInspectorDescriptor = () => selectedDescriptor;
      const readSelectedPreviewInspectorPageCandidate = () => selectedCandidate;
      const createPreviewInspectorTargetReachabilityKey = () => 'page:Target';
      const requestPreviewInspectorContextualTargetFallback = () => {
        contextualFallbackRequests += 1;
        if (!contextualFallbackAccepted) return false;
        state.exhausted = false;
        state.status = 'mounting-contextual-target';
        return true;
      };
      const requestPreviewInspectorPageExecutionRetry = () => {
        pageExecutionRetryRequests += 1;
        return pageExecutionRetryAccepted;
      };
      const clearedResources = [];
      const clearPreviewInspectorVirtualBackendResource = (id) => clearedResources.push(id);
      ${createPreviewInspectorRequirementConvergenceRuntimeSource()}
      const state = {
        appliedConditions: [],
        exhausted: false,
        key: 'page:Target',
        pageRootCommitted: true,
        status: 'searching-requirements',
        targetExportName: 'Target',
        targetHasOutput: false,
        targetMounted: false,
      };
      const search = { observedPathCount: 1, origin: 'user', pass: 0, status: 'searching' };
      previewInspectorSession.minimumRequirementSearchByKey.set(state.key, search);
      previewInspectorSession.targetReachabilityByKey.set(state.key, state);
      const batch = { hookIds: ['session-hook'], requestIds: [] };
      ${scenario}
    `,
    context,
  );
  if (context.__result === undefined) throw new Error('Convergence scenario returned no result.');
  return context.__result;
}

describe('Preview Inspector requirement convergence runtime source', () => {
  /** Detects an alternating generated state before the third expensive page remount is scheduled. */
  it('opens the circuit for an A-B-A requirement oscillation', () => {
    const result = runConvergenceScenario(`
      const first = beginPreviewInspectorRequirementFrontier(state, search, batch);
      completePreviewInspectorRequirementFrontier(search, first, true);
      previewInspectorSession.runtimeFallbackValues.set(
        'session-hook',
        { session: { user: { id: 'B' } } },
      );
      const second = beginPreviewInspectorRequirementFrontier(state, search, batch);
      completePreviewInspectorRequirementFrontier(search, second, true);
      previewInspectorSession.runtimeFallbackValues.set(
        'session-hook',
        { session: { user: { id: 'A' } } },
      );
      const repeated = beginPreviewInspectorRequirementFrontier(state, search, batch);
      globalThis.__result = {
        cycleLength: search.cycleLength,
        exhausted: state.exhausted,
        healthEvents: health.length,
        pass: search.pass,
        repeated,
        status: search.status,
        warnings: warnings.length,
      };
    `) as {
      readonly cycleLength: number;
      readonly exhausted: boolean;
      readonly healthEvents: number;
      readonly pass: number;
      readonly status: string;
      readonly warnings: number;
    };

    expect(result).toEqual({
      cycleLength: 2,
      exhausted: true,
      healthEvents: 1,
      pass: 2,
      repeated: undefined,
      status: 'cycle-detected',
      warnings: 1,
    });
  });

  /** Tries the next compiler-owned page execution before exposing a terminal value-search loop. */
  it('hands an A-B-A requirement oscillation to the next page execution candidate', () => {
    const result = runConvergenceScenario(`
      const first = beginPreviewInspectorRequirementFrontier(state, search, batch);
      completePreviewInspectorRequirementFrontier(search, first, true, state);
      previewInspectorSession.runtimeFallbackValues.set(
        'session-hook',
        { session: { user: { id: 'B' } } },
      );
      const second = beginPreviewInspectorRequirementFrontier(state, search, batch);
      completePreviewInspectorRequirementFrontier(search, second, true, state);
      previewInspectorSession.runtimeFallbackValues.set(
        'session-hook',
        { session: { user: { id: 'A' } } },
      );
      pageExecutionRetryAccepted = true;
      const repeated = beginPreviewInspectorRequirementFrontier(state, search, batch);
      globalThis.__result = {
        contextualFallbackRequests,
        convergenceStatus: readPreviewInspectorRequirementConvergence(state).status,
        exhausted: state.exhausted,
        pageExecutionRetryRequests,
        repeated,
        stateStatus: state.status,
        status: search.status,
        treeRefreshes,
        warnings: warnings.length,
      };
    `);

    expect(result).toEqual({
      contextualFallbackRequests: 1,
      convergenceStatus: 'settled',
      exhausted: true,
      pageExecutionRetryRequests: 1,
      repeated: undefined,
      stateStatus: 'retrying-page-execution',
      status: 'settled',
      treeRefreshes: 1,
      warnings: 0,
    });
  });

  /** Settles order-only registry churn without exhausting other page-corridor continuation types. */
  it('canonicalizes a stable requirement frontier and leaves the corridor available', () => {
    const result = runConvergenceScenario(`
      hookRecord.requiredPaths = ['session.roles.0', 'session.user.id'];
      const first = beginPreviewInspectorRequirementFrontier(state, search, batch);
      completePreviewInspectorRequirementFrontier(search, first, true);
      hookRecord.requiredPaths = ['session.user.id', 'session.roles.0'];
      beginPreviewInspectorRequirementFrontier(state, search, batch);
      globalThis.__result = {
        cycleLength: search.cycleLength,
        exhausted: state.exhausted,
        status: search.status,
      };
    `) as {
      readonly cycleLength?: number;
      readonly exhausted: boolean;
      readonly status: string;
    };

    expect(result).toEqual({ cycleLength: undefined, exhausted: false, status: 'stalled' });
  });

  /** Keeps a settled deterministic frontier terminal until new evidence or an explicit retry exists. */
  it('does not reopen a settled search for the same semantic evidence', () => {
    const result = runConvergenceScenario(`
      const observed = beginPreviewInspectorRequirementFrontier(state, search, batch);
      completePreviewInspectorRequirementFrontier(search, observed, false);
      const settledStatus = search.status;
      const automaticRestart = canStartPreviewInspectorDeterministicRequirementSearch(state, batch);
      resetPreviewInspectorRequirementConvergence(state);
      const explicitRetry = canStartPreviewInspectorDeterministicRequirementSearch(state, batch);
      globalThis.__result = { automaticRestart, explicitRetry, settledStatus };
    `);

    expect(result).toEqual({
      automaticRestart: false,
      explicitRetry: true,
      settledStatus: 'settled',
    });
  });

  /** Releases a registry update that became actionable during the pass that just settled. */
  it('releases a deferred child requirement at the settled search boundary', () => {
    const result = runConvergenceScenario(`
      settlePreviewInspectorMinimumRequirementSearch(state);
      globalThis.__result = {
        convergenceStatus: readPreviewInspectorRequirementConvergence(state).status,
        deferredReleases,
        searchStatus: search.status,
      };
    `);

    expect(result).toEqual({
      convergenceStatus: 'settled',
      deferredReleases: 1,
      searchStatus: 'settled',
    });
  });

  /** Preserves a monotonic hard budget and gives only an explicit retry a fresh revision-local run. */
  it('never resets the automatic pass limit until the user clears the corridor circuit', () => {
    const result = runConvergenceScenario(`
      for (let index = 0; index < 8; index += 1) {
        previewInspectorSession.runtimeFallbackValues.set(
          'session-hook',
          { session: { user: { id: 'pass-' + String(index) } } },
        );
        const frontier = beginPreviewInspectorRequirementFrontier(state, search, batch);
        completePreviewInspectorRequirementFrontier(search, frontier, true);
      }
      stopPreviewInspectorRequirementConvergenceAtLimit(state);
      const oldPasses = search.totalPasses;
      const statusAtLimit = search.status;
      const exhaustedAtLimit = state.exhausted;
      const reset = resetPreviewInspectorRequirementConvergence(state);
      state.exhausted = false;
      const freshSearch = { observedPathCount: 1, origin: 'user', pass: 0, status: 'searching' };
      previewInspectorSession.minimumRequirementSearchByKey.set(state.key, freshSearch);
      previewInspectorSession.runtimeFallbackValues.set(
        'session-hook',
        { session: { user: { id: 'fresh' } } },
      );
      const fresh = beginPreviewInspectorRequirementFrontier(state, freshSearch, batch);
      completePreviewInspectorRequirementFrontier(freshSearch, fresh, true);
      globalThis.__result = {
        exhaustedAtLimit,
        freshPasses: freshSearch.totalPasses,
        oldPasses,
        reset,
        statusAtLimit,
      };
    `) as {
      readonly exhaustedAtLimit: boolean;
      readonly freshPasses: number;
      readonly oldPasses: number;
      readonly reset: boolean;
      readonly statusAtLimit: string;
    };

    expect(result).toEqual({
      exhaustedAtLimit: true,
      freshPasses: 1,
      oldPasses: 8,
      reset: true,
      statusAtLimit: 'limit-reached',
    });
  });

  it('restores a captured requirement transaction exactly once before resolver side effects', () => {
    const result = runConvergenceScenario(`
      const value = { session: { user: { id: 'prior' } } };
      const override = { session: { user: { id: 'override' } } };
      const signature = ['session.user.id'];
      const materialized = { session: true };
      const record = { ...hookRecord, mode: 'manual', requiredPaths: ['old'] };
      const requestOverride = { payload: { profile: { name: 'prior' } } };
      const requestSignature = ['profile.name'];
      previewInspectorSession.runtimeFallbackValues.set('session-hook', value);
      previewInspectorSession.runtimeFallbackOverrides.set('session-hook', override);
      previewInspectorSession.runtimeFallbackSmartPathSignatures.set('session-hook', signature);
      previewInspectorSession.runtimeFallbackMaterializedOverrides.set('session-hook', materialized);
      previewInspectorSession.runtimeFallbackSmartIds.add('session-hook');
      previewInspectorSession.runtimeFallbacks.set('session-hook', record);
      previewInspectorSession.dataPayloadOverrides.set('profile-request', requestOverride);
      previewInspectorSession.dataPayloadSmartShapeSignatures.set('profile-request', requestSignature);
      const snapshot = capturePreviewInspectorRequirementAutoRollback(state, {
        hookIds: ['session-hook'], requestIds: ['profile-request'],
      });
      snapshot.mode = 'deterministic-minimum-auto';
      previewInspectorSession.runtimeFallbackValues.set('session-hook', { unsafe: true });
      previewInspectorSession.runtimeFallbackOverrides.delete('session-hook');
      previewInspectorSession.runtimeFallbackSmartPathSignatures.set('session-hook', ['unsafe']);
      previewInspectorSession.runtimeFallbackMaterializedOverrides.set('session-hook', { unsafe: true });
      previewInspectorSession.runtimeFallbackSmartIds.delete('session-hook');
      previewInspectorSession.runtimeFallbacks.set('session-hook', {
        ...record, mode: 'auto', requiredPaths: ['newly.observed'], observed: true,
      });
      previewInspectorSession.dataPayloadOverrides.set('profile-request', { payload: { unsafe: true } });
      previewInspectorSession.dataPayloadSmartShapeSignatures.set('profile-request', ['unsafe']);
      previewInspectorSession.fallbackValuesEnabled = true;
      previewInspectorSession.dataAutoEnabled = true;
      previewInspectorSession.activeTargetReachabilityKey = state.key;
      const registered = registerPreviewInspectorRequirementAutoRollback('trace-restore', snapshot);
      const restored = rollbackPreviewInspectorRequirementAutoDecision('trace-restore');
      const effects = [clearedResources.length, commits, health.length, notifications, persists, treeRefreshes, warnings.length];
      const duplicate = rollbackPreviewInspectorRequirementAutoDecision('trace-restore');
      const effectsAfterDuplicate = [clearedResources.length, commits, health.length, notifications, persists, treeRefreshes, warnings.length];
      globalThis.__result = {
        clearedResources, commits, convergence: readPreviewInspectorRequirementConvergence(state), dataRevision: previewInspectorSession.dataRevision, duplicate,
        effects, effectsAfterDuplicate,
        dataAutoEnabled: previewInspectorSession.dataAutoEnabled,
        fallbackValuesEnabled: previewInspectorSession.fallbackValuesEnabled, health, notifications,
        persists, record: previewInspectorSession.runtimeFallbacks.get('session-hook'),
        registered, renderConditionRevision: previewInspectorSession.renderConditionRevision, restored,
        search, state, treeRefreshes, valueSame: previewInspectorSession.runtimeFallbackValues.get('session-hook') === value,
        overrideSame: previewInspectorSession.runtimeFallbackOverrides.get('session-hook') === override,
        signatureSame: previewInspectorSession.runtimeFallbackSmartPathSignatures.get('session-hook') === signature,
        materializedSame: previewInspectorSession.runtimeFallbackMaterializedOverrides.get('session-hook') === materialized,
        requestSame: previewInspectorSession.dataPayloadOverrides.get('profile-request') === requestOverride,
        requestSignatureSame: previewInspectorSession.dataPayloadSmartShapeSignatures.get('profile-request') === requestSignature,
        smart: previewInspectorSession.runtimeFallbackSmartIds.has('session-hook'), warnings,
      };
    `) as Record<string, unknown>;
    expect(result.registered).toBe(true);
    expect(result.restored).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.dataAutoEnabled).toBe(false);
    expect(result.fallbackValuesEnabled).toBe(false);
    expect(result.effects).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(result.effectsAfterDuplicate).toEqual(result.effects);
    expect(result.valueSame).toBe(true);
    expect(result.overrideSame).toBe(true);
    expect(result.signatureSame).toBe(true);
    expect(result.materializedSame).toBe(true);
    expect(result.requestSame).toBe(true);
    expect(result.requestSignatureSame).toBe(true);
    expect(result.smart).toBe(true);
    expect(result.record).toEqual({
      ...{ id: 'session-hook', reachabilityKey: 'page:Target' },
      mode: 'manual',
      observed: true,
      requiredPaths: ['newly.observed'],
    });
    expect(result.clearedResources).toEqual(['profile-request']);
    expect(result).toMatchObject({
      commits: 1,
      dataRevision: 4,
      notifications: 1,
      persists: 1,
      renderConditionRevision: 7,
      treeRefreshes: 1,
    });
    expect(result.search).toMatchObject({
      rollbackTraceId: 'trace-restore',
      rolledBackHookCount: 1,
      rolledBackRequestCount: 1,
      status: 'rolled-back',
    });
    expect(result.convergence).toMatchObject({ status: 'rolled-back' });
    expect(result.state).toMatchObject({
      exhausted: true,
      idlePasses: 0,
      probeRevision: 1,
      status: 'resolver-rolled-back',
    });
    expect(result.health).toEqual([
      {
        category: 'blocker-resolver',
        detail: {
          hookCount: 1,
          mode: 'deterministic-minimum-auto',
          reason: 'runtime-error',
          requestCount: 1,
          target: 'Target',
          traceId: 'trace-restore',
        },
        event: 'automatic-resolution-rolled-back',
      },
    ]);
    expect(result.warnings).toEqual([
      {
        details:
          'Trace: trace-restore\\nMode: deterministic-minimum-auto\\nTarget: Target\\nGenerated hooks: 1\\nGenerated requests: 1',
        level: 'warn',
        location: '',
        message: 'Automatic generated preview values were reverted after a new render error.',
        phase: 'blocker resolver rollback',
        source: 'target-reachability',
      },
    ]);
  });

  it('consumes mismatches, bounds registrations, and clears only the requested corridor', () => {
    const result = runConvergenceScenario(`
      const other = capturePreviewInspectorRequirementAutoRollback({ key: 'page:Other' }, batch);
      const retainedUnsafe = { unsafe: true };
      previewInspectorSession.runtimeFallbackValues.set('session-hook', retainedUnsafe);
      previewInspectorSession.activeTargetReachabilityKey = state.key;
      registerPreviewInspectorRequirementAutoRollback('mismatch', other);
      const mismatch = rollbackPreviewInspectorRequirementAutoDecision('mismatch');
      const consumed = previewInspectorSession.requirementAutoRollbackByTraceId.has('mismatch');
      const invalid = [
        registerPreviewInspectorRequirementAutoRollback('', other),
        registerPreviewInspectorRequirementAutoRollback('empty', undefined),
        registerPreviewInspectorRequirementAutoRollback('empty-snapshot', { hooks: [], requests: [] }),
      ];
      for (let index = 0; index < 65; index += 1) {
        const snapshot = capturePreviewInspectorRequirementAutoRollback({ key: index % 2 ? 'page:Other' : state.key }, batch);
        registerPreviewInspectorRequirementAutoRollback('trace-' + String(index), snapshot);
      }
      const size = previewInspectorSession.requirementAutoRollbackByTraceId.size;
      const oldest = previewInspectorSession.requirementAutoRollbackByTraceId.has('trace-0');
      const newest = previewInspectorSession.requirementAutoRollbackByTraceId.has('trace-64');
      const keyed = clearPreviewInspectorRequirementAutoRollbacks(state.key);
      const onlyOther = [...previewInspectorSession.requirementAutoRollbackByTraceId.values()].every((entry) => entry.reachabilityKey === 'page:Other');
      const all = clearPreviewInspectorRequirementAutoRollbacks();
      const second = clearPreviewInspectorRequirementAutoRollbacks();
      globalThis.__result = {
        all, consumed, invalid, keyed, mismatch, newest, oldest, onlyOther, second, size,
        retainedUnsafe: previewInspectorSession.runtimeFallbackValues.get('session-hook') === retainedUnsafe,
        effects: [clearedResources.length, commits, health.length, notifications, persists, treeRefreshes, warnings.length],
        flags: [previewInspectorSession.dataAutoEnabled, previewInspectorSession.fallbackValuesEnabled, previewInspectorSession.dataRevision, previewInspectorSession.renderConditionRevision],
      };
    `);
    expect(result).toEqual({
      all: true,
      consumed: false,
      invalid: [false, false, false],
      keyed: true,
      mismatch: false,
      newest: true,
      oldest: false,
      onlyOther: true,
      second: false,
      size: 64,
      retainedUnsafe: true,
      effects: [0, 0, 0, 0, 0, 0, 0],
      flags: [false, false, 3, 6],
    });
  });
});
