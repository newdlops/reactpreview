/** Covers navigation behavior for previewInspectorTargetReachabilityRuntimeSource. */
/** Verifies authored-source previewInspectorTargetReachabilityRuntimeSource invariants. */
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';

import { createPreviewInspectorTargetOutputRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetOutputRuntimeSource';

import {
  createDashboardDescriptorCandidateFixtureSource,
  createDashboardRuntimeDependenciesFixtureSource,
  createEmptyPageTargetRuntimePreambleSource,
  createPageTargetDescriptorCandidateFixtureSource,
  createTargetReachabilityFixtureSource,
  createUnrelatedShellGateFixtureSource,
} from './previewInspectorTargetReachabilityRuntimeSourceFixtures';

describe('Preview Inspector target reachability runtime source', () => {
  /** An exact facade HOC can expose its redirect guard before the selected boundary ever mounts. */
  it('continues through an off-graph facade guard while the target remains unmounted', () => {
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
        ${createEmptyPageTargetRuntimePreambleSource()}
        const setPreviewInspectorTargetGuidedConditionOverride = (id, enabled) => {
          applied.push([id, enabled]);
          return true;
        };
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
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
        ${createUnrelatedShellGateFixtureSource()}
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        rememberPreviewInspectorTargetRuntimeOwner('Target', { name: 'GuardedPage' });
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
      targetMounted: false,
    });
  });

  /** Waits for the page's real selection callback instead of mounting a detached target facade. */
  it('parks traversal on an authored-state gate while the selection screen is active', () => {
    const context: {
      __result?: {
        readonly conditionId: string;
        readonly contextualFallback: boolean;
        readonly selectedGate: string;
        readonly status: string;
      };
    } = {};
    vm.runInNewContext(
      `
        ${createEmptyPageTargetRuntimePreambleSource()}
        const setPreviewInspectorTargetGuidedConditionOverride = () => {
          throw new Error('Authored state must not be replaced by a Boolean override.');
        };
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.renderConditions.set('signup-target-gate', {
          effectiveEnabled: true,
          expression: '<Page> gate: !target',
          fallbackBranch: 'truthy',
          id: 'signup-target-gate',
          kind: 'early-return',
          ownerName: 'Page',
          reachabilityDiscoveryOrder: 1,
          reachabilityKey: state.key,
          requiresAuthoredState: true,
          sourcePath: '/Page.tsx',
          targetBranch: 'falsy',
        });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = {
          conditionId: state.awaitingAuthoredStateConditionId,
          contextualFallback: state.contextualTargetFallbackRequested,
          selectedGate:
            selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none',
          status: state.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      conditionId: 'signup-target-gate',
      contextualFallback: false,
      selectedGate: 'none',
      status: 'awaiting-authored-state',
    });
  });

  /** Lets a mounted authored callback satisfy a non-Boolean state gate inside the real page. */
  it('replays a page-local state transition before parking on an unrendered target gate', () => {
    const context: {
      __result?: {
        readonly activations: number;
        readonly conditionId: string;
        readonly probeRevision: number;
        readonly status: string;
      };
    } = {};
    vm.runInNewContext(
      `
        ${createEmptyPageTargetRuntimePreambleSource()}
        let activations = 0;
        const canPreviewInspectorTargetGuideCondition = () => false;
        const autoInvokePreviewInspectorAuthoredStateTrigger = () => {
          activations += 1;
          return { metadata: { stateName: 'selectedContent' } };
        };
        const setPreviewInspectorTargetGuidedConditionOverride = () => {
          throw new Error('A local state transition must run before Boolean override fallback.');
        };
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.renderConditions.set('selected-content-gate', {
          effectiveEnabled: false,
          expression: '<Page> gate: selectedContent',
          id: 'selected-content-gate',
          ownerName: 'Page',
          reachabilityDiscoveryOrder: 1,
          reachabilityKey: state.key,
          sourcePath: '/Page.tsx',
          targetBranch: 'truthy',
        });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = {
          activations,
          conditionId: state.awaitingAuthoredStateConditionId,
          probeRevision: state.probeRevision,
          status: state.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      activations: 1,
      conditionId: 'selected-content-gate',
      probeRevision: 1,
      status: 'activating-authored-state',
    });
  });

  /** Retains a short target commit after Navigate removes it before the delayed DFS observation. */
  it('advances a latched HOC guard after its redirect unmounts the target boundary', () => {
    const context: { __result?: { readonly applied: readonly [string, boolean][] } } = {};
    vm.runInNewContext(
      `
        const applied = [];
        ${createEmptyPageTargetRuntimePreambleSource()}
        const setPreviewInspectorTargetGuidedConditionOverride = (id, enabled) => {
          applied.push([id, enabled]);
        };
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.renderConditions.set('guard', {
          effectiveEnabled: true,
          expression: '<GuardedPage> gate: !isStaffMode',
          id: 'guard',
          ownerName: 'GuardedPage',
          reachabilityDiscoveryOrder: 1,
          reachabilityKey: state.key,
          sourcePath: '/with-staff-page.tsx',
          targetBranch: 'falsy',
        });
        ${createUnrelatedShellGateFixtureSource()}
        previewInspectorSession.directTargetConditionIdsByExport = new Map([
          ['Target', new Set(['guard'])],
        ]);
        rememberPreviewInspectorTargetRuntimeOwner('Target', { name: 'GuardedPage' });
        markPreviewInspectorTargetReachabilityMount('Target');
        previewInspectorSession.minimumRequirementSearchByKey.set(state.key, {
          origin: 'user', pass: 1, status: 'searching',
        });
        state.exhausted = true;
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = { applied };
      `,
      context,
    );

    expect(context.__result?.applied).toEqual([['guard', false]]);
  });

  /** Navigation-only completion still requires an exact source/export commit before departure. */
  it.each([
    ['/Target.tsx', true],
    ['/OtherTarget.tsx', false],
  ])('checks a navigation-only target after the boundary from %s leaves', (sourcePath, exact) => {
    const context: {
      __result?: {
        readonly blockers: number;
        readonly status: string;
        readonly targetHasOutput: boolean;
        readonly targetMounted: boolean;
        readonly targetOutputKind: string;
        readonly targetRenderedEmpty: boolean;
      };
    } = {};
    vm.runInNewContext(
      `
        ${createEmptyPageTargetRuntimePreambleSource()}
        ${createPreviewInspectorTargetOutputRuntimeSource()}
        const hasPreviewInspectorResolvedTargetOutput = createPreviewInspectorTargetOutputFactory();
        ${createTargetReachabilityFixtureSource()}
        ${createPageTargetDescriptorCandidateFixtureSource()}
        descriptor.inspector.renderOutcomesByExport = { Target: { outcomes: [
          { componentTree: [{ children: [], name: 'Navigate' }], kind: 'jsx' },
          { componentTree: [{ children: [], name: 'Navigate' }], kind: 'jsx' },
        ] } };
        const findSelectedPreviewInspectorDescriptor = () => descriptor;
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.boundariesByExport.set('Target', new Set([
          { props: { exportName: 'Target', sourcePath: ${JSON.stringify(sourcePath)} } },
        ]));
        markPreviewInspectorTargetReachabilityMount('Target');
        previewInspectorSession.boundariesByExport.get('Target').clear();
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        previewInspectorSession.targetReachabilityByKey.set('stale-page:Target', {
          ...state,
          key: 'stale-page:Target',
          status: 'probing',
          targetHasOutput: false,
          targetMounted: false,
        });
        globalThis.__result = {
          blockers: readPreviewInspectorTargetReachabilityBlockers().length,
          status: state.status,
          targetHasOutput: state.targetHasOutput,
          targetMounted: state.targetMounted,
          targetOutputKind: state.targetOutputKind,
          targetRenderedEmpty: state.targetRenderedEmpty,
        };
      `,
      context,
    );

    expect(context.__result).toEqual(
      exact
        ? {
            blockers: 0,
            status: 'reached',
            targetHasOutput: true,
            targetMounted: true,
            targetOutputKind: 'target-output',
            targetRenderedEmpty: true,
          }
        : {
            blockers: 1,
            status: 'blocked',
            targetHasOutput: false,
            targetMounted: false,
            targetOutputKind: 'none',
            targetRenderedEmpty: false,
          },
    );
  });

  /** Reopens an exhausted authored corridor without discarding its proven branch history. */
  it('resumes page traversal after a neural recommendation supersedes the target error', () => {
    const context: {
      __result?: {
        readonly appliedConditionCount: number;
        readonly attempt: number;
        readonly clearedExport: string;
        readonly exhausted: boolean;
        readonly probeRevision: number;
        readonly resumed: boolean;
        readonly status: string;
        readonly targetWasMounted: boolean;
        readonly targetOutputError: unknown;
      };
    } = {};
    vm.runInNewContext(
      `
        ${createEmptyPageTargetRuntimePreambleSource()}
        let clearedExport = '';
        const clearPreviewInspectorRuntimeHealthTargetError = (exportName) => {
          clearedExport = exportName;
          return true;
        };
        ${createTargetReachabilityFixtureSource()}
        const state = {
          appliedConditions: [{ id: 'page-gate' }],
          attempt: 16,
          blockedWarningReported: true,
          directTarget: false,
          exhausted: true,
          idlePasses: 2,
          key: 'page:Target',
          pageRootCommitted: false,
          probeRevision: 4,
          status: 'retrying-page-execution',
          targetExportName: 'Target',
          targetHasOutput: false,
          targetOutputError: { message: 'stale failure' },
          targetOutputRecoveryPending: true,
          targetWasMounted: true,
        };
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.targetReachabilityByKey = new Map([[state.key, state]]);
        const resumed = resumePreviewInspectorTargetReachabilityAfterNeuralRecommendation(state.key);
        globalThis.__result = {
          appliedConditionCount: state.appliedConditions.length,
          attempt: state.attempt,
          clearedExport,
          exhausted: state.exhausted,
          probeRevision: state.probeRevision,
          resumed,
          status: state.status,
          targetOutputError: state.targetOutputError,
          targetWasMounted: state.targetWasMounted,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      appliedConditionCount: 1,
      attempt: 0,
      clearedExport: 'Target',
      exhausted: false,
      probeRevision: 5,
      resumed: true,
      status: 'probing-after-neural-recommendation',
      targetOutputError: undefined,
      targetWasMounted: false,
    });
  });

  /** Lets the transaction that discovered a recommendation settle before restarting its corridor. */
  it('commits a deferred neural retry from the settled Auto attempt', () => {
    const context: {
      __result?: {
        readonly committedExport: string;
        readonly committedKey: string;
        readonly handled: boolean;
        readonly resumed: boolean;
        readonly retryCleared: boolean;
      };
    } = {};
    vm.runInNewContext(
      `
        let committedExport = '';
        let committedKey = '';
        const state = { key: 'page:Target' };
        const attempt = {
          autoMode: 'deterministic-minimum-auto',
          runtimeFallbackNeuralRetry: {
            exportName: 'Target',
            reachabilityKey: state.key,
          },
          settledAt: Date.now(),
          targetReachabilityKey: state.key,
          traceId: 'trace-neural',
        };
        const previewInspectorSession = {
          blockerTraceActiveAttempt: attempt,
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        const commitPreviewInspectorRuntimeNeuralRecommendationRetry = (exportName, key) => {
          committedExport = exportName;
          committedKey = key;
          return true;
        };
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        const resumed = resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt);
        globalThis.__result = {
          committedExport,
          committedKey,
          handled: attempt.targetReachabilityResumeHandled,
          resumed,
          retryCleared: attempt.runtimeFallbackNeuralRetry === undefined,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      committedExport: 'Target',
      committedKey: 'page:Target',
      handled: true,
      resumed: true,
      retryCleared: true,
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
        ${createDashboardRuntimeDependenciesFixtureSource()}
        ${createTargetReachabilityFixtureSource()}
        ${createDashboardDescriptorCandidateFixtureSource()}
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        previewInspectorSession.boundariesByExport.set('DashboardPanel', new Set([{
          host: true,
          props: {
            exportName: 'DashboardPanel',
            sourcePath: '/workspace/Dashboard.tsx',
          },
        }]));
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
