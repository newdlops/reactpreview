/** Exercises target-guided DFS selection without mounting project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRequirementFrontierRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementFrontierRuntimeSource';
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Composes the identity helper required by the standalone target runtime fixture. */
function createTargetReachabilityFixtureSource(): string {
  return (
    createPreviewInspectorTargetReachabilityRuntimeSource() +
    createPreviewInspectorTargetPathIdentityRuntimeSource() +
    createPreviewInspectorTargetAttemptRuntimeSource()
  );
}

/** Minimal pure helper result exposed by the generated runtime fixture. */
interface ReachabilityResult {
  readonly blockerPath: readonly string[];
  readonly desiredValue: boolean;
  readonly expression: string;
  readonly fallbackBeforeTargetMount: string;
  readonly fallbackExpression: string;
  readonly key: string;
  readonly overlayPathLocal: boolean;
  readonly overlayTargetValue: boolean;
  readonly returnedTargetValue: boolean;
  readonly runtimeOwnerNameOnlyPathLocal: boolean;
  readonly sharedModalExactSourcePathLocal: boolean;
  readonly sharedModalNameOnlyPathLocal: boolean;
  readonly targetNameOnlyPathLocal: boolean;
  readonly targetSourceScore: number;
  readonly targetExportName: string;
  readonly twoSidedTargetValue: boolean;
}

describe('Preview Inspector target reachability runtime source', () => {
  /** Recovers a nested HOC guard from the exact target Fiber without admitting a shell sibling. */
  it('remembers the selected target single-child owner chain and settles its cold retry', () => {
    const context: {
      __result?: {
        readonly firstNames: readonly string[];
        readonly notifications: number;
        readonly retainedNames: readonly string[];
        readonly revision: number;
        readonly secondNames: readonly string[];
      };
    } = {};
    vm.runInNewContext(
      `
        let notifications = 0;
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          fallbackValuesEnabled: true,
          renderConditionRevision: 0,
        };
        const readPreviewInspectorBoundaryFiber = (boundary) => boundary.fiber;
        const readPreviewInspectorFiberLink = (fiber, propertyName) => fiber?.[propertyName];
        const classifyPreviewInspectorFiber = (fiber) => fiber?.kind ?? 'other';
        const namePreviewInspectorFiber = (fiber) => fiber?.name ?? 'Anonymous';
        const isPreviewInspectorOwnedFiber = () => false;
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        ${createTargetReachabilityFixtureSource()}
        const navigate = { kind: 'function', name: 'Navigate' };
        const guardedPage = { child: navigate, kind: 'function', name: 'GuardedPage' };
        const pageComponent = { child: guardedPage, kind: 'function', name: 'PageComponent' };
        const unrelatedShell = { kind: 'function', name: 'TruncatableParagraph' };
        const boundary = { fiber: { child: pageComponent, sibling: unrelatedShell } };
        rememberPreviewInspectorTargetRuntimeOwner('default', { name: 'PageComponent' });
        const firstNames = rememberPreviewInspectorTargetMountedOwnerChain('default', boundary);
        const secondNames = rememberPreviewInspectorTargetMountedOwnerChain('default', boundary);
        globalThis.__result = {
          firstNames,
          notifications,
          retainedNames: [...previewInspectorSession.directTargetRuntimeOwnerNamesByExport.get('default')],
          revision: previewInspectorSession.renderConditionRevision,
          secondNames,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      firstNames: ['PageComponent', 'GuardedPage', 'Navigate'],
      notifications: 1,
      retainedNames: ['PageComponent', 'GuardedPage', 'Navigate'],
      revision: 1,
      secondNames: ['PageComponent', 'GuardedPage', 'Navigate'],
    });
  });

  /** Adds nested HOC owners to an active full-page DFS state without forcing a cold remount. */
  it('promotes the mounted owner chain into the active page corridor', () => {
    const context: { __result?: { readonly names: readonly string[]; readonly revision: number } } =
      {};
    vm.runInNewContext(
      `
        const state = { runtimeOwnerNames: [], targetExportName: 'Target' };
        const previewInspectorSession = {
          activeTargetReachabilityKey: 'page:Target',
          fallbackValuesEnabled: true,
          renderConditionRevision: 4,
          targetReachabilityByKey: new Map([['page:Target', state]]),
        };
        const readPreviewInspectorBoundaryFiber = (boundary) => boundary.fiber;
        const readPreviewInspectorFiberLink = (fiber, propertyName) => fiber?.[propertyName];
        const classifyPreviewInspectorFiber = (fiber) => fiber?.kind ?? 'other';
        const namePreviewInspectorFiber = (fiber) => fiber?.name ?? 'Anonymous';
        const isPreviewInspectorOwnedFiber = () => false;
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorCommitRefresh = () => undefined;
        ${createTargetReachabilityFixtureSource()}
        const guarded = { kind: 'function', name: 'GuardedPage' };
        const page = { child: guarded, kind: 'function', name: 'PageComponent' };
        rememberPreviewInspectorTargetMountedOwnerChain('Target', { fiber: { child: page } });
        globalThis.__result = { names: state.runtimeOwnerNames, revision: previewInspectorSession.renderConditionRevision };
      `,
      context,
    );

    expect(context.__result).toEqual({
      names: ['PageComponent', 'GuardedPage'],
      revision: 4,
    });
  });

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
          reachabilityDiscoveryOrder: 0,
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
        rememberPreviewInspectorTargetRuntimeOwnerNames('DashboardPanel', ['Modal', 'PageComponent']);
        state.targetMounted = true;
        const fallbackNext = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
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
          runtimeOwnerNameOnlyPathLocal: isPreviewInspectorConditionOnTargetPath({
            id: 'another-page-component-condition',
            ownerName: 'PageComponent',
            sourcePath: '/workspace/another-unrelated-page.tsx',
          }, evidence),
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
      fallbackBeforeTargetMount: 'none',
      fallbackExpression: '<GuardedPage> gate: !isStaffMode',
      key: 'application-path:DashboardPanel',
      overlayPathLocal: true,
      overlayTargetValue: true,
      returnedTargetValue: true,
      runtimeOwnerNameOnlyPathLocal: false,
      sharedModalExactSourcePathLocal: true,
      sharedModalNameOnlyPathLocal: false,
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
    expect(source).toContain('retryPreviewInspectorTargetApplicationPath');
  });

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
        const descriptor = { inspector: {
          renderChainsByExport: { Target: { paths: [] } },
          target: { exportName: 'Target' },
        } };
        const candidate = {
          edges: [], id: 'page', root: { exportName: 'Page' },
          renderPath: { id: 'path', steps: [
            { label: 'Target', sourcePath: '/Target.tsx', wrapperNames: [] },
            { label: 'Page', sourcePath: '/Page.tsx', wrapperNames: [] },
          ] },
        };
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
    const context: {
      __result?: {
        readonly calls: readonly string[];
        readonly dataRevision: number;
        readonly fallbackValuesEnabled: boolean;
        readonly gateRetained: boolean;
        readonly observedPathCount: number;
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
        const readPreviewInspectorRuntimeFallbacks = () => [{
          hookName: 'useQuery', id: 'query', mode: 'auto', passive: false,
          reachabilityKey: 'page:Target', requiredPaths: ['data'],
        }];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createTargetReachabilityFixtureSource()}
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
      calls: ['runtime:page:Target', 'data:page:Target', 'persist', 'notify', 'tree', 'commit'],
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
          boundariesByExport: new Map([['Target', new Set([{}])]]),
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

  /** Starts a one-answer compiler-shaped requirement pass without waiting for an Inspector click. */
  it('auto-starts deterministic minimum requirements and preserves user-value policy', () => {
    const context: {
      __result?: {
        readonly calls: readonly string[];
        readonly origin: string;
        readonly pass: number;
        readonly status: string;
      };
    } = {};
    vm.runInNewContext(
      `
        const calls = [];
        let activeKey = '';
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          dataRevision: 0,
          renderConditionOverrides: new Map(),
          renderConditionRevision: 0,
          renderConditions: new Map(),
          selectedExportName: 'Target',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [{
          id: 'session-hook',
          mode: 'auto',
          reachabilityKey: activeKey,
          requiredPaths: ['session.user.id'],
        }];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        let filled = false;
        const smartFillPreviewInspectorRuntimeFallbacksForReachability = (key, options) => {
          calls.push('runtime:' + key + ':' + String(options?.preserveUserValues));
          if (filled) return false;
          filled = true;
          return true;
        };
        const smartFillPreviewInspectorDataPayloadsForReachability = (key, options) => {
          calls.push('data:' + key + ':' + String(options?.preserveUserValues));
          return false;
        };
        const persistPreviewInspectorState = () => calls.push('persist');
        const notifyPreviewInspector = () => calls.push('notify');
        const schedulePreviewInspectorTreeRefresh = () => calls.push('tree');
        const schedulePreviewInspectorCommitRefresh = () => calls.push('commit');
        const collectPreviewInspectorFiberElements = () => [];
        const setPreviewInspectorTargetGuidedConditionOverride = () => undefined;
        const recordPreviewInspectorConsoleEntry = () => undefined;
        const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });
        ${createTargetReachabilityFixtureSource()}
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
        activeKey = state.key;
        state.pageRootCommitted = true;
        evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
        const search = readPreviewInspectorMinimumRequirementSearch(state);
        globalThis.__result = {
          calls,
          origin: search.origin,
          pass: search.pass,
          status: state.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      calls: [
        'runtime:page:Target:true',
        'data:page:Target:true',
        'persist',
        'notify',
        'tree',
        'commit',
      ],
      origin: 'deterministic-auto',
      pass: 1,
      status: 'filling-requirements',
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
          return true;
        };
        ${createTargetReachabilityFixtureSource()}
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
        previewInspectorSession.renderConditions.set('unrelated-shell-gate', {
          effectiveEnabled: true,
          expression: '<TruncatableParagraph> gate: typeof content === "string"',
          id: 'unrelated-shell-gate',
          ownerName: 'TruncatableParagraph',
          reachabilityDiscoveryOrder: 0,
          reachabilityKey: state.key,
          sourcePath: '/shell/truncatable-paragraph.tsx',
          targetBranch: 'falsy',
        });
        previewInspectorSession.activeTargetReachabilityKey = state.key;
        previewInspectorSession.directTargetConditionIdsByExport = new Map([
          ['Target', new Set(['guard'])],
        ]);
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
      targetMounted: true,
    });
  });

  /** Retains a short target commit after Navigate removes it before the delayed DFS observation. */
  it('advances a latched HOC guard after its redirect unmounts the target boundary', () => {
    const context: { __result?: { readonly applied: readonly [string, boolean][] } } = {};
    vm.runInNewContext(
      `
        const applied = [];
        const previewInspectorSession = {
          boundariesByExport: new Map(),
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
        ${createTargetReachabilityFixtureSource()}
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
        previewInspectorSession.renderConditions.set('unrelated-shell-gate', {
          effectiveEnabled: true,
          expression: '<TruncatableParagraph> gate: typeof content === "string"',
          id: 'unrelated-shell-gate',
          ownerName: 'TruncatableParagraph',
          reachabilityDiscoveryOrder: 0,
          reachabilityKey: state.key,
          sourcePath: '/shell/truncatable-paragraph.tsx',
          targetBranch: 'falsy',
        });
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
        ${createTargetReachabilityFixtureSource()}
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
