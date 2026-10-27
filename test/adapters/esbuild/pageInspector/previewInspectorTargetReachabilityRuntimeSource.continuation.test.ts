/** Covers continuation behavior for previewInspectorTargetReachabilityRuntimeSource. */
/** Verifies authored-source previewInspectorTargetReachabilityRuntimeSource invariants. */
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

import {
  createTargetReachabilityFixtureSource,
  type ReachabilityResult,
} from './previewInspectorTargetReachabilityRuntimeSourceFixtures';

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
        const isPreviewInspectorTargetGuidedConditionRejected = (conditionId) =>
          conditionId === 'rejected-path-gate';
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createTargetReachabilityFixtureSource()}
        const descriptor = { inspector: {
          contextModule: {
            importPath: ['/workspace/Application.tsx', '/workspace/with-staff-page.tsx'],
            sourcePath: '/workspace/with-staff-page.tsx',
          },
          renderChainsByExport: { DashboardPanel: { paths: [] } },
          target: { exportName: 'DashboardPanel' },
        } };
        const candidate = {
          edges: [],
          id: 'application-path',
          renderPath: { id: 'path', steps: [
            { label: 'DashboardPanel', sourcePath: '/workspace/Dashboard.tsx', wrapperNames: ['Modal'] },
            { label: 'Application', sourcePath: '/workspace/Application.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Application' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        previewInspectorSession.renderConditions.set('rejected-path-gate', {
          effectiveEnabled: true,
          expression: '<Application> rejected retry',
          id: 'rejected-path-gate',
          kind: 'early-return',
          ownerName: 'Application',
          reachabilityDiscoveryOrder: 0,
          reachabilityKey: state.key,
          sourcePath: '/workspace/Application.tsx',
          targetBranch: 'falsy',
        });
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
          reachabilityDiscoveryOrder: 2,
          reachabilityKey: state.key,
          sourcePath: '/workspace/with-staff-page.tsx',
          targetBranch: 'falsy',
        });
        const next = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
        previewInspectorSession.renderConditions.delete('login');
        const fallbackBeforeTargetMount = selectPreviewInspectorNextTargetGate(
          descriptor,
          candidate,
          state,
        );
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.directTargetConditionIdsByExport = new Map([
          ['DashboardPanel', new Set(['hoc-guard'])],
        ]);
        rememberPreviewInspectorTargetRuntimeOwner('DashboardPanel', { name: 'GuardedPage' });
        rememberPreviewInspectorTargetRuntimeOwnerNames(
          'DashboardPanel',
          ['Modal', 'PageComponent', 'Navigate'],
        );
        state.targetMounted = true;
        const fallbackNext = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
        previewInspectorSession.renderConditions.delete('hoc-guard');
        const overlayConditionBase = {
          effectiveEnabled: false, kind: 'overlay-visibility',
          reachabilityKey: state.key, role: 'overlay', targetBranch: 'truthy',
        };
        previewInspectorSession.renderConditions.set('sibling-overlay', {
          ...overlayConditionBase, id: 'sibling-overlay', ownerName: 'DeleteModal',
          reachabilityDiscoveryOrder: 3, sourcePath: '/workspace/Dashboard.tsx',
        });
        previewInspectorSession.renderConditions.set('target-overlay', {
          ...overlayConditionBase, id: 'target-overlay', ownerName: 'DashboardPanel',
          reachabilityDiscoveryOrder: 4, sourcePath: '/workspace/modal-factory.tsx',
        });
        const targetOverlaySelection =
          selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none';
        previewInspectorSession.renderConditions.delete('target-overlay');
        const siblingOverlaySelection =
          selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none';
        previewInspectorSession.renderConditions.set('unrelated-page-component', {
          id: 'unrelated-page-component',
          ownerName: 'PageComponent',
          reachabilityKey: state.key,
          sourcePath: '/workspace/unrelated-page.tsx',
        });
        const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
        const duplicateSourceEvidence = readPreviewInspectorTargetPathEvidence(
          descriptor,
          { ...candidate, renderPath: { ...candidate.renderPath, steps: [
            ...candidate.renderPath.steps,
            { label: 'DashboardWrapper', sourcePath: '/workspace/Dashboard.tsx', wrapperNames: [] },
          ] } },
          state,
        );
        const overlayCondition = {
          falsyLabel: 'hidden <DashboardPanel> overlay',
          kind: 'overlay-visibility',
          role: 'overlay',
          sourcePath: '/workspace/modal-factory.tsx',
          truthyLabel: 'visible <DashboardPanel> overlay',
        };
        globalThis.__result = {
          blockerPath: state.applicationPath,
          desiredValue: next.desiredValue,
          expression: next.condition.expression,
          fallbackBeforeTargetMount: fallbackBeforeTargetMount?.condition?.expression ?? 'none',
          fallbackExpression: fallbackNext.condition.expression,
          key: state.key,
          overlayPathLocal: isPreviewInspectorConditionOnTargetPath(overlayCondition, evidence),
          overlayTargetValue: readPreviewInspectorTargetConditionValue(overlayCondition, evidence),
          returnedTargetValue: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <Application>',
            targetBranch: 'falsy',
            truthyLabel: '<DashboardPanel>',
          }, evidence),
          runtimeRedirectTargetValue: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <GuardedPage>',
            targetBranch: 'falsy',
            truthyLabel: '<Navigate>',
          }, evidence),
          runtimeOwnerNameOnlyPathLocal: isPreviewInspectorConditionOnTargetPath({
            id: 'another-page-component-condition',
            ownerName: 'PageComponent',
            sourcePath: '/workspace/another-unrelated-page.tsx',
          }, evidence),
          siblingOverlaySelection,
          sharedModalExactSourcePathLocal: isPreviewInspectorConditionOnTargetPath({
            ownerName: 'Modal',
            sourcePath: '/workspace/Dashboard.tsx',
          }, evidence),
          sharedModalNameOnlyPathLocal: isPreviewInspectorConditionOnTargetPath({
            ownerName: 'Modal',
            role: 'overlay',
            sourcePath: '/workspace/unrelated-document-preview-modal.tsx',
            truthyLabel: 'visible <Modal>',
          }, evidence),
          sharedWrapperTargetValue: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <DashboardFlow>',
            targetBranch: 'falsy',
            truthyLabel: '<Modal>',
          }, evidence),
          targetOverlaySelection,
          targetNameOnlyPathLocal: isPreviewInspectorConditionOnTargetPath({
            ownerName: 'DashboardPanel',
            sourcePath: '/workspace/generated-target-facade.tsx',
          }, evidence),
          targetSourceScore: duplicateSourceEvidence.pathScores.get('/workspace/Dashboard.tsx'),
          targetExportName: state.targetExportName,
          twoSidedTargetValue: readPreviewInspectorTargetConditionValue({
            fallbackBranch: 'truthy',
            falsyLabel: '<PermissionFallback>',
            truthyLabel: '<DashboardPanel>',
          }, evidence),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      blockerPath: ['Application', 'Modal', 'DashboardPanel'],
      desiredValue: false,
      expression: '<Application> gate: !session',
      fallbackBeforeTargetMount: '<GuardedPage> gate: !isStaffMode',
      fallbackExpression: '<GuardedPage> gate: !isStaffMode',
      key: 'application-path:DashboardPanel',
      overlayPathLocal: true,
      overlayTargetValue: true,
      returnedTargetValue: true,
      runtimeRedirectTargetValue: false,
      runtimeOwnerNameOnlyPathLocal: false,
      siblingOverlaySelection: 'none',
      sharedModalExactSourcePathLocal: true,
      sharedModalNameOnlyPathLocal: false,
      sharedWrapperTargetValue: false,
      targetOverlaySelection: 'target-overlay',
      targetNameOnlyPathLocal: true,
      targetSourceScore: 800,
      targetExportName: 'DashboardPanel',
      twoSidedTargetValue: true,
    });
  });

  /** Keeps direct-target fallback, payload inventory, and user recovery actions in one module. */
  it('emits bounded target assertion and direct fallback controls', () => {
    const source = createPreviewInspectorTargetReachabilityRuntimeSource();

    expect(source).toContain('PREVIEW_INSPECTOR_TARGET_REACHABILITY_PASS_LIMIT = 16');
    expect(source).toContain('PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8');
    expect(source).toContain('PREVIEW_INSPECTOR_TARGET_INITIAL_PROBE_DELAY_MS = 160');
    expect(source).toContain('PREVIEW_INSPECTOR_TARGET_CONTINUATION_PROBE_DELAY_MS = 48');
    expect(source).toContain('PREVIEW_INSPECTOR_TARGET_NEURAL_RENDER_SETTLE_DELAY_MS = 96');
    expect(source).toContain('PREVIEW_INSPECTOR_TARGET_VIEWPORT_REVEAL_DELAY_MS = 900');
    expect(source).toContain('hasMountedPreviewInspectorTarget(state)');
    expect(source).toContain('activatePreviewInspectorDirectTarget(state)');
    expect(source).toContain('readPreviewInspectorTargetReachabilityRequiredPaths');
    expect(source).toContain('smartFillPreviewInspectorTargetApplicationPath');
    expect(source).toContain('smartFillPreviewInspectorRuntimeFallbacksForReachability');
    expect(source).toContain('smartFillPreviewInspectorDataPayloadsForReachability');
    expect(source).toContain(
      'autoRevealPreviewInspectorOverlayTarget(state.targetExportName, state.key)',
    );
    expect(source).not.toContain('OVERLAY_TARGET_NAME_PATTERN');
    expect(source).toContain('startPreviewInspectorDeterministicRequirementSearch');
    expect(source).toContain('readPreviewInspectorNeuralLearningModelUpdates() > 0');
    expect(source).toContain("search.origin === 'automatic-neural'");
    expect(source).toContain('settlePreviewInspectorNeuralRenderStateTarget(state)');
    expect(source).toContain('requestPreviewInspectorPageExecutionRetry(descriptor, candidate)');
    expect(source).toContain("state.status = 'retrying-page-execution'");
    expect(source).toContain(
      'revealPreviewInspectorMountedTargetViewport(descriptor, candidate, state)',
    );
    expect(source).toContain('retryPreviewInspectorTargetApplicationPath');
  });

  it('hands a settled empty contextual fallback back to Page Execution retry', () => {
    const context: { __result?: boolean } = {};
    vm.runInNewContext(
      `
        const owner = {};
        const roleToken = {};
        const state = {
          contextualTargetFallbackRequested: true,
          directTarget: false,
          idlePasses: 2,
          key: 'page:Skeleton',
          pageRootCommitted: true,
          targetHasOutput: false,
          targetMounted: true,
        };
        const previewInspectorSession = {
          activeTargetReachabilityKey: state.key,
          boundariesByExport: new Map(),
          contextualTargetFallbackCapabilitiesByKey: new Map([
            [state.key, new Map([['ordinary-contextual-fallback', 1]])],
          ]),
          contextualTargetFallbackClaimsByKey: new Map([
            [state.key, { key: state.key, owner, roleToken, status: 'committed' }],
          ]),
          contextualTargetFallbackCountByKey: new Map([[state.key, 1]]),
          contextualTargetFallbackRolesByKey: new Map([
            [state.key, new Map([[roleToken, owner]])],
          ]),
        };
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        globalThis.__result = requestPreviewInspectorContextualTargetFallback(state);
      `,
      context,
    );

    expect(context.__result).toBe(false);
  });

  /** Reveals only exact mounted target DOM waiting behind authored scroll-triggered animation. */
  it('scrolls an opacity-gated exact target into view only once', () => {
    const context: {
      __result?: {
        readonly attempted: boolean;
        readonly first: boolean;
        readonly options: unknown;
        readonly scrollCount: number;
        readonly second: boolean;
      };
    } = {};
    vm.runInNewContext(
      `
        let scrollCount = 0;
        let options;
        const mountNode = {
          getBoundingClientRect: () => ({ bottom: 600, left: 0, right: 800, top: 0 }),
          parentElement: null,
        };
        const opacityGate = {
          getBoundingClientRect: () => ({ bottom: 900, left: 0, right: 800, top: 700 }),
          parentElement: mountNode,
        };
        const targetElement = {
          closest: () => null,
          getBoundingClientRect: () => ({ bottom: 760, left: 40, right: 240, top: 720 }),
          hidden: false,
          isConnected: true,
          nodeType: 1,
          parentElement: opacityGate,
          scrollIntoView: (value) => { scrollCount += 1; options = value; },
        };
        const boundary = {
          props: { exportName: 'Target', sourcePath: '/Target.tsx' },
        };
        const previewInspectorSession = {
          activeTargetReachabilityKey: 'page:Target',
          boundariesByExport: new Map([['Target', new Set([boundary])]]),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'Target',
          targetReachabilityByKey: new Map(),
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        const collectPreviewInspectorFiberElements = () => [targetElement];
        const isPreviewInspectorUiElement = () => false;
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        const findSelectedPreviewInspectorDescriptor = () => undefined;
        const readSelectedPreviewInspectorPageCandidate = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        globalThis.innerHeight = 600;
        globalThis.innerWidth = 800;
        globalThis.getComputedStyle = (element) => ({
          display: 'block',
          opacity: element === opacityGate ? '0' : '1',
          overflow: 'visible',
          visibility: 'visible',
        });
        globalThis.setTimeout = () => 1;
        ${createTargetReachabilityFixtureSource()}
        const descriptor = { inspector: { target: { exportName: 'Target' } } };
        const candidate = { id: 'page' };
        const state = {
          directTarget: false,
          key: 'page:Target',
          pageRootCommitted: true,
          probeRevision: 0,
          targetExportName: 'Target',
          targetSourcePath: '/Target.tsx',
          viewportRevealAttempted: false,
          viewportRevealPending: false,
        };
        previewInspectorSession.targetReachabilityByKey.set(state.key, state);
        const first = revealPreviewInspectorMountedTargetViewport(descriptor, candidate, state);
        const second = revealPreviewInspectorMountedTargetViewport(descriptor, candidate, state);
        globalThis.__result = {
          attempted: state.viewportRevealAttempted,
          first,
          options,
          scrollCount,
          second,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      attempted: true,
      first: true,
      options: { behavior: 'auto', block: 'nearest', inline: 'nearest' },
      scrollCount: 1,
      second: false,
    });
  });
});
