/** Exercises the automatic requirement circuit without mounting project-owned React components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRequirementConvergenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementConvergenceRuntimeSource';

/** Runs one browser-runtime scenario with stable hook/request registries and captured diagnostics. */
function runConvergenceScenario(scenario: string): unknown {
  const context: { __result?: unknown } = {};
  vm.runInNewContext(
    `
      const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const previewEntryRevision = 4;
      const warnings = [];
      const health = [];
      let notifications = 0;
      let treeRefreshes = 0;
      const hookRecord = {
        id: 'session-hook',
        reachabilityKey: 'page:Target',
        requiredPaths: ['session.user.id'],
      };
      const previewInspectorSession = {
        dataPayloadOverrides: new Map(),
        minimumRequirementSearchByKey: new Map(),
        runtimeFallbackOverrides: new Map(),
        runtimeFallbackValues: new Map([['session-hook', { session: { user: { id: 'A' } } }]]),
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
      const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
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
});
