/**
 * Verifies that modal outcome choices and automatic visibility recovery form one bounded traversal.
 *
 * These tests compose the generated browser runtimes in a VM because the regression crosses the
 * static outcome registry, boolean condition registry, and target-reachability state machine. No
 * project React component or network adapter is executed by the fixture.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';
import { createPreviewInspectorRenderOutcomeRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderOutcomeRuntimeSource';
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Result captured after an explicit hidden modal outcome reaches the DFS selector. */
interface HiddenOutcomeResult {
  readonly appliedConditionIds: readonly string[];
  readonly attempt: number;
  readonly autoOverrideCount: number;
  readonly commits: number;
  readonly controlledByOutcome: boolean;
  readonly desiredValue: boolean;
  readonly effectiveEnabled: boolean;
  readonly nextGateId?: string;
  readonly setterChanged: boolean;
}

/** Result captured across two evaluations of the same mounted-but-empty overlay state. */
interface RepeatedRevealResult {
  readonly attempted: boolean;
  readonly commitCountAfterFirst: number;
  readonly commitCountAfterSecond: number;
  readonly gateMutationsAfterError: number;
  readonly keys: readonly string[];
  readonly revealCallsAfterFirst: number;
  readonly revealCallsAfterSecond: number;
  readonly statusAfterFirst: string;
  readonly statusAfterTargetError: string;
}

/** Composes the target runtime with its shared path-identity and pending-attempt helpers. */
function createTargetReachabilityFixtureSource(): string {
  return (
    createPreviewInspectorTargetReachabilityRuntimeSource() +
    createPreviewInspectorTargetPathIdentityRuntimeSource() +
    createPreviewInspectorTargetAttemptRuntimeSource()
  );
}

describe('Preview Inspector overlay outcome convergence runtime', () => {
  /** Keeps an explicit render-nothing scenario authoritative instead of reopening it through DFS. */
  it('excludes a selected hidden modal outcome from target-guided overlay gates', () => {
    const context: { __result?: HiddenOutcomeResult } = {};
    vm.runInNewContext(
      `
        let commits = 0;
        const descriptor = {
          exportName: 'DeleteModal',
          inspector: {
            renderChainsByExport: { DeleteModal: { paths: [] } },
            renderOutcomesByExport: {
              DeleteModal: {
                outcomes: [{
                  conditions: [{
                    branch: 'truthy',
                    column: 7,
                    expression: '!open',
                    line: 2,
                    sourcePath: '/workspace/DeleteModal.tsx',
                  }],
                  id: 'render-nothing',
                  kind: 'empty',
                  label: 'render nothing',
                }],
              },
            },
            target: { exportName: 'DeleteModal' },
          },
        };
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          descriptors: [descriptor],
          devtoolsState: {
            renderOutcomeSelectionByExport: { DeleteModal: 'render-nothing' },
          },
          fallbackValuesEnabled: true,
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'DeleteModal',
        };
        const findSelectedPreviewInspectorDescriptor = () => descriptor;
        const normalizePreviewInspectorConditionSourcePath = (value) =>
          typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
        const matchesPreviewInspectorConditionSourcePath = (left, right) => left === right;
        const readPersistedPreviewInspectorState = () => ({});
        const persistPreviewInspectorState = () => undefined;
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorHighlight = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => { commits += 1; };
        const recordPreviewInspectorBlockerAutoDecision = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = () => false;
        const smartFillPreviewInspectorDataPayloadsForReachability = () => false;
        const collectPreviewInspectorFiberElements = () => [];
        const autoRevealPreviewInspectorOverlayTarget = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        ${createPreviewInspectorRenderOutcomeRuntimeSource()}
        ${createPreviewInspectorConditionRuntimeSource()}
        ${createTargetReachabilityFixtureSource()}
        const candidate = {
          edges: [],
          id: 'modal-page',
          renderPath: { id: 'modal-path', steps: [
            {
              label: 'DeleteModal',
              sourcePath: '/workspace/DeleteModal.tsx',
              wrapperNames: [],
            },
            { label: 'Page', sourcePath: '/workspace/Page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Page' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        const metadata = {
          authoredExpression: '!open',
          authoredExpressionNegated: true,
          column: 7,
          expression: '<DeleteModal> visibility: !open',
          falsyLabel: 'hidden <DeleteModal> overlay',
          kind: 'overlay-visibility',
          line: 2,
          ownerName: 'DeleteModal',
          role: 'overlay',
          sourcePath: '/workspace/DeleteModal.tsx',
          truthyLabel: 'visible <DeleteModal> overlay',
        };
        resolvePreviewInspectorRenderCondition('modal-visibility', false, metadata);
        const condition = previewInspectorSession.renderConditions.get('modal-visibility');
        const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
        const desiredValue = readPreviewInspectorTargetConditionValue(condition, evidence);
        const controlledByOutcome = isPreviewInspectorRenderConditionControlledByOutcome(condition);
        const nextGate = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
        const setterChanged = setPreviewInspectorTargetGuidedConditionOverride(
          'modal-visibility',
          true,
        );
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = {
          appliedConditionIds: state.appliedConditions.map((entry) => entry.id),
          attempt: state.attempt,
          autoOverrideCount: previewInspectorSession.renderConditionAutoOverrides.size,
          commits,
          controlledByOutcome,
          desiredValue,
          effectiveEnabled: condition.effectiveEnabled,
          nextGateId: nextGate?.condition?.id,
          setterChanged,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      appliedConditionIds: [],
      attempt: 0,
      autoOverrideCount: 0,
      commits: 0,
      controlledByOutcome: true,
      desiredValue: true,
      effectiveEnabled: false,
      nextGateId: undefined,
      setterChanged: false,
    });
  });

  /** Remembers a successful reveal probe so later observations cannot reopen the same modal. */
  it('attempts automatic overlay visibility once for one retained reachability state', () => {
    const context: { __result?: RepeatedRevealResult } = {};
    vm.runInNewContext(
      `
        let commitCount = 0;
        let gateMutations = 0;
        let revealCalls = 0;
        const keys = [];
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'DeleteModal',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const isPreviewInspectorRenderConditionControlledByOutcome = () => false;
        const isPreviewInspectorTargetGuidedConditionRejected = () => false;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = () => false;
        const smartFillPreviewInspectorDataPayloadsForReachability = () => false;
        const persistPreviewInspectorState = () => undefined;
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        const setPreviewInspectorTargetGuidedConditionOverride = () => {
          gateMutations += 1;
          return true;
        };
        const recordPreviewInspectorBlockerAutoDecision = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        const collectPreviewInspectorFiberElements = () => [];
        const autoRevealPreviewInspectorOverlayTarget = (_exportName, key) => {
          revealCalls += 1;
          keys.push(key);
          commitCount += 1;
          return 'show';
        };
        ${createTargetReachabilityFixtureSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { DeleteModal: { paths: [] } },
          target: { exportName: 'DeleteModal' },
        } };
        const candidate = {
          edges: [],
          id: 'modal-page',
          renderPath: { id: 'modal-path', steps: [
            { label: 'DeleteModal', sourcePath: '/DeleteModal.tsx', wrapperNames: [] },
            { label: 'Page', sourcePath: '/Page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Page' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        state.pageRootCommitted = true;
        state.targetWasMounted = true;
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const first = {
          commitCount: commitCount,
          revealCalls: revealCalls,
          status: state.status,
        };
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        previewInspectorSession.boundariesByExport.set('DeleteModal', new Set([{
          state: { error: new Error('modal child failed') },
        }]));
        previewInspectorSession.renderConditions.set('downstream-gate', {
          effectiveEnabled: false,
          expression: 'showDetails',
          id: 'downstream-gate',
          ownerName: 'DeleteModal',
          reachabilityKey: state.key,
          sourcePath: '/DeleteModal.tsx',
          truthyLabel: '<DeleteModal>',
        });
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        globalThis.__result = {
          attempted: state.overlayVisibilityAttempted,
          commitCountAfterFirst: first.commitCount,
          commitCountAfterSecond: commitCount,
          gateMutationsAfterError: gateMutations,
          keys,
          revealCallsAfterFirst: first.revealCalls,
          revealCallsAfterSecond: revealCalls,
          statusAfterFirst: first.status,
          statusAfterTargetError: state.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      attempted: true,
      commitCountAfterFirst: 1,
      commitCountAfterSecond: 1,
      gateMutationsAfterError: 0,
      keys: ['modal-page:DeleteModal'],
      revealCallsAfterFirst: 1,
      revealCallsAfterSecond: 1,
      statusAfterFirst: 'revealing-overlay',
      statusAfterTargetError: 'target-error',
    });
  });
});
