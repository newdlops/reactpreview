/**
 * Verifies that an explicit JSX switch change reopens bounded target/overlay convergence.
 *
 * The regression spans the condition registry and root-to-target path selector, but no project
 * component needs to render. VM fixtures exercise only the generated serializable runtime state.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

interface ManualRecoveryResult {
  readonly attempt: number;
  readonly autoAttemptCount: number;
  readonly exhausted: boolean;
  readonly idlePasses: number;
  readonly overlayVisibilityAttempted: boolean;
  readonly probeRevision: number;
  readonly rejected: boolean;
  readonly resumed: boolean;
  readonly searchStatus: string;
  readonly status: string;
}

interface CorridorOverlayResult {
  readonly corridorExact: boolean;
  readonly repeatedExact: boolean;
  readonly selectedId?: string;
  readonly siblingExact: boolean;
}

describe('Preview Inspector manual switch recovery runtime', () => {
  /** Reopens an exhausted overlay probe while retaining generated values and bounded history. */
  it('starts a new convergence epoch after a manual parent switch changes', () => {
    const context: { __result?: ManualRecoveryResult } = {};
    vm.runInNewContext(
      `
        const key = 'page:CurrentFile';
        const state = {
          attempt: 16,
          exhausted: true,
          idlePasses: 2,
          key,
          overlayVisibilityAttempted: true,
          probeRevision: 4,
          status: 'page-blocked',
        };
        const search = { pass: 3, status: 'stalled' };
        const previewInspectorSession = {
          activeTargetReachabilityKey: key,
          minimumRequirementSearchByKey: new Map([[key, search]]),
          renderConditionAutoAttempts: new Map([['old-attempt', {}]]),
          renderConditionRejectedAutoOverridesByKey: new Map([
            [key, new Set(['child-overlay'])],
          ]),
          renderConditions: new Map([
            ['parent-switch', { id: 'parent-switch', reachabilityKey: key }],
          ]),
          targetReachabilityByKey: new Map([[key, state]]),
        };
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        const resumed = resumePreviewInspectorTargetReachabilityAfterManualCondition(
          'parent-switch',
        );
        globalThis.__result = {
          attempt: state.attempt,
          autoAttemptCount: previewInspectorSession.renderConditionAutoAttempts.size,
          exhausted: state.exhausted,
          idlePasses: state.idlePasses,
          overlayVisibilityAttempted: state.overlayVisibilityAttempted,
          probeRevision: state.probeRevision,
          rejected: previewInspectorSession.renderConditionRejectedAutoOverridesByKey.has(key),
          resumed,
          searchStatus: search.status,
          status: state.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      attempt: 0,
      autoAttemptCount: 0,
      exhausted: false,
      idlePasses: 0,
      overlayVisibilityAttempted: false,
      probeRevision: 5,
      rejected: false,
      resumed: true,
      searchStatus: 'searching',
      status: 'probing-after-manual-condition',
    });
  });

  /** Admits an unambiguous overlay owner on the chosen path but excludes same-page siblings. */
  it('selects only the corridor overlay as the next automatic visible branch', () => {
    const context: { __result?: CorridorOverlayResult } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'CurrentFile',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorAmbiguousTargetOwnerNames = () => new Set();
        const readPreviewInspectorRepeatedTargetOwnerNames = () => new Set();
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { CurrentFile: { paths: [] } },
          target: { exportName: 'CurrentFile', sourcePath: '/CurrentFile.tsx' },
        } };
        const candidate = {
          edges: [],
          id: 'page',
          renderPath: { id: 'path', steps: [
            {
              label: 'CurrentFile',
              sourcePath: '/Page.tsx',
              wrapperNames: ['OverlayShell'],
            },
            { label: 'Application', sourcePath: '/Application.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Application' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        const base = {
          effectiveEnabled: false,
          kind: 'overlay-visibility',
          reachabilityKey: state.key,
          role: 'overlay',
          sourcePath: '/Page.tsx',
          targetBranch: 'truthy',
        };
        previewInspectorSession.renderConditions.set('sibling', {
          ...base,
          id: 'sibling',
          ownerName: 'SiblingDialog',
          reachabilityDiscoveryOrder: 1,
        });
        previewInspectorSession.renderConditions.set('corridor', {
          ...base,
          id: 'corridor',
          ownerName: 'OverlayShell',
          reachabilityDiscoveryOrder: 2,
        });
        const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
        globalThis.__result = {
          corridorExact: isPreviewInspectorExactTargetOverlayCondition(
            { ...base, ownerName: 'OverlayShell' },
            evidence,
          ),
          repeatedExact: isPreviewInspectorExactTargetOverlayCondition(
            { ...base, ownerName: 'OverlayShell' },
            { ...evidence, repeatedOwnerNames: new Set(['OverlayShell']) },
          ),
          selectedId: selectPreviewInspectorNextTargetGate(
            descriptor,
            candidate,
            state,
          )?.condition?.id,
          siblingExact: isPreviewInspectorExactTargetOverlayCondition(
            { ...base, ownerName: 'SiblingDialog' },
            evidence,
          ),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      corridorExact: true,
      repeatedExact: false,
      selectedId: 'corridor',
      siblingExact: false,
    });
  });

  /** Ensures both force and authored-value actions notify the recovery state machine. */
  it('connects condition mutations to the reachability recovery helper', () => {
    const source = createPreviewInspectorConditionRuntimeSource();
    const calls = source.match(
      /resumePreviewInspectorTargetReachabilityAfterManualCondition\(conditionId\)/gu,
    );

    expect(calls).toHaveLength(2);
  });
});
