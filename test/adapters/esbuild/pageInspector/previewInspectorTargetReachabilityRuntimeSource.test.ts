/** Covers ownership behavior for previewInspectorTargetReachabilityRuntimeSource. */
/** Verifies authored-source previewInspectorTargetReachabilityRuntimeSource invariants. */
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';
import { createPreviewInspectorPageCompositionHealthRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCompositionHealthRuntimeSource';

import { createTargetReachabilityFixtureSource } from './previewInspectorTargetReachabilityRuntimeSourceFixtures';

describe('Preview Inspector target reachability runtime source', () => {
  /** A late ownership recheck must publish the same output result that its caller just observed. */
  it('keeps page health consistent when an independent probe recovers or loses target output', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const boundary = { state: {} };
        const state = { status: 'reached', targetHasOutput: false, targetMounted: true };
        let verified = false;
        const hasPreviewInspectorResolvedTargetOutput = (_boundary, outputState) => {
          outputState.targetOutputKind = verified ? 'target-output' : 'fallback-output';
          return verified;
        };
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        ${createPreviewInspectorPageCompositionHealthRuntimeSource()}
        readPreviewInspectorTargetResolutionBoundaries = () => new Set([boundary]);
        hasPreviewInspectorIntentionalNavigationTargetOutput = () => false;
        const observe = () => ({
          result: hasPreviewInspectorTargetHostOutput(state),
          hasOutput: state.targetHasOutput,
          stage: readPreviewInspectorCompositionTargetStage(state, {}),
        });
        const absent = observe();
        verified = true;
        const recovered = observe();
        verified = false;
        const lost = observe();
        boundary.state.error = new Error('contained target error');
        verified = true;
        const failed = observe();
        globalThis.__result = { absent, recovered, lost, failed };
      `,
      context,
    );

    expect(context.__result).toEqual({
      absent: { hasOutput: false, result: false, stage: 'fallback-output' },
      recovered: { hasOutput: true, result: true, stage: 'target-output' },
      lost: { hasOutput: false, result: false, stage: 'fallback-output' },
      failed: { hasOutput: false, result: false, stage: 'target-mounted-no-output' },
    });
  });

  /** An intentional route transition keeps its existing exact-output proof and empty semantics. */
  it('publishes navigation output and clears it when its proof no longer applies', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const state = { targetHasOutput: false, targetWasMounted: true };
        let navigationProven = true;
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        readPreviewInspectorTargetResolutionBoundaries = () => new Set();
        hasPreviewInspectorIntentionalNavigationTargetOutput = () => navigationProven;
        const first = hasPreviewInspectorTargetHostOutput(state);
        const reached = { hasOutput: state.targetHasOutput, empty: state.targetRenderedEmpty };
        navigationProven = false;
        const second = hasPreviewInspectorTargetHostOutput(state);
        globalThis.__result = { first, reached, second, hasOutput: state.targetHasOutput };
      `,
      context,
    );

    expect(context.__result).toEqual({
      first: true,
      reached: { hasOutput: true, empty: true },
      second: false,
      hasOutput: false,
    });
  });

  it.each(['deterministic-minimum-auto', 'minimum-requirement-dfs'])(
    'layers the next %s requirement through one retained baseline exception',
    (mode) => {
      const context: { __result?: Record<string, unknown> } = {};
      vm.runInNewContext(
        `
          let advances = 0;
          const state = {
            key: 'page:Target',
            targetExportName: 'Target',
            targetOutputError: { message: 'existing missing value' },
          };
          const attempt = {
            autoMode: ${JSON.stringify(mode)},
            retainedBaselineFatalError: { message: 'existing missing value' },
            settledAt: 200,
            targetReachabilityKey: state.key,
            traceId: 'trace-requirement',
          };
          const previewInspectorSession = {
            blockerTraceActiveAttempt: attempt,
            renderConditionAutoAttempts: new Map(),
            renderConditions: new Map(),
          };
          const schedulePreviewInspectorTreeRefresh = () => undefined;
          ${createTargetReachabilityFixtureSource()}
          hasMountedPreviewInspectorTarget = () => false;
          hasPreviewInspectorTargetRenderError = () => true;
          hasPreviewInspectorTargetHostOutput = () => false;
          advancePreviewInspectorMinimumRequirementSearch = () => {
            advances += 1;
            return true;
          };
          evaluatePreviewInspectorTargetReachability({}, {}, state);
          globalThis.__result = { advances };
        `,
        context,
      );

      expect(context.__result).toEqual({ advances: 1 });
    },
  );

  /** A learned exact-source state can revive the original target after contextual probing began. */
  it('rechecks exact target boundaries after neural state supersedes contextual fallback', () => {
    const context: { __result?: readonly string[] } = {};
    vm.runInNewContext(
      `
        const exactBoundary = {
          props: { exportName: 'Panel', sourcePath: '/workspace/Panel.tsx' },
        };
        const previewInspectorSession = {
          boundariesByExport: new Map([['Panel', new Set([exactBoundary])]]),
          runtimeFallbackSharedNeuralRecommendationsByContract: new Map([['Panel#usePanel', {
            sharedGuardPaths: ['state.status'],
            smartPathCandidateId: 'render-state:string:open',
            sourcePath: '/workspace/Panel.tsx',
            value: { state: { status: 'open' } },
          }]]),
        };
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        globalThis.__result = [...readPreviewInspectorTargetResolutionBoundaries({
          contextualTargetFallbackRequested: true,
          targetExportName: 'Panel',
          targetSourcePath: '/workspace/Panel.tsx',
        })].map((boundary) => boundary.props.sourcePath);
      `,
      context,
    );

    expect(context.__result).toEqual(['/workspace/Panel.tsx']);
  });

  /** Keeps condition DFS consistent with the scalar state selected by the neural residual head. */
  it('does not activate a JSX branch that contradicts the learned render state', () => {
    const context: {
      __result?: {
        readonly iframe: boolean;
        readonly loading: boolean;
        readonly selectedGate: string;
      };
    } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          runtimeFallbackSharedNeuralRecommendationsByContract: new Map([['panel#usePanel', {
            sharedGuardPaths: ['state.status'],
            smartPathCandidateId: 'render-state:string:open',
            sourcePath: '/workspace/Panel.tsx',
            value: { state: { status: 'open' } },
          }]]),
          selectedExportName: 'Panel',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createTargetReachabilityFixtureSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { Panel: { paths: [] } },
          target: { exportName: 'Panel', sourcePath: '/workspace/Panel.tsx' },
        } };
        const candidate = {
          edges: [], id: 'panel-page',
          renderPath: { id: 'path', steps: [
            { label: 'Panel', sourcePath: '/workspace/Panel.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'Panel' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        const comparison = (value) => ({
          kind: 'comparison', operator: '===', path: 'state.status', value,
        });
        const loading = {
          effectiveEnabled: false,
          id: 'loading',
          kind: 'logical-and',
          ownerName: 'Panel',
          reachabilityDiscoveryOrder: 1,
          reachabilityKey: state.key,
          scalarExpression: comparison('loading'),
          sourcePath: '/workspace/Panel.tsx',
        };
        const iframe = {
          ...loading,
          effectiveEnabled: true,
          id: 'iframe',
          scalarExpression: { kind: 'or', left: comparison('open'), right: comparison('closing') },
        };
        previewInspectorSession.renderConditions.set(loading.id, loading);
        previewInspectorSession.renderConditions.set(iframe.id, iframe);
        const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
        globalThis.__result = {
          iframe: readPreviewInspectorTargetConditionValue(iframe, evidence),
          loading: readPreviewInspectorTargetConditionValue(loading, evidence),
          selectedGate:
            selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none',
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      iframe: true,
      loading: false,
      selectedGate: 'none',
    });
  });

  /** Selects a modal passed through a render-local component alias without opening its sibling. */
  it('keeps nested local component owners on the exact overlay corridor', () => {
    const context: {
      __result?: {
        readonly applicationPath: readonly string[];
        readonly selectedConditionId: string;
      };
    } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'TaxTypeBadge',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createTargetReachabilityFixtureSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { TaxTypeBadge: { paths: [] } },
          target: { exportName: 'TaxTypeBadge', sourcePath: '/meeting/tax-type-badge.tsx' },
        } };
        const candidate = {
          edges: [],
          id: 'payment-page',
          renderPath: { id: 'tax-type-path', steps: [
            { label: 'TaxTypeBadge', sourcePath: '/meeting/tax-type-badge.tsx', wrapperNames: [] },
            {
              invocation: { localOwnerNames: ['TaxDetailsModal'] },
              label: 'DetailsModal',
              sourcePath: '/meeting/details-modal.tsx',
              wrapperNames: ['ModalBody', 'Modal'],
            },
            { label: 'PaymentPage', sourcePath: '/meeting/payment-page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'PaymentPage' },
          target: { exportName: 'TaxTypeBadge', sourcePath: '/meeting/tax-type-badge.tsx' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        const overlayBase = {
          effectiveEnabled: false,
          kind: 'overlay-visibility',
          reachabilityKey: state.key,
          role: 'overlay',
          targetBranch: 'truthy',
        };
        previewInspectorSession.renderConditions.set('sibling-modal', {
          ...overlayBase,
          id: 'sibling-modal',
          ownerName: 'DeleteModal',
          reachabilityDiscoveryOrder: 1,
          sourcePath: '/meeting/tax-fee-table.tsx',
        });
        previewInspectorSession.renderConditions.set('tax-details-modal', {
          ...overlayBase,
          id: 'tax-details-modal',
          ownerName: 'TaxDetailsModal',
          reachabilityDiscoveryOrder: 2,
          sourcePath: '/meeting/tax-fee-table.tsx',
        });
        globalThis.__result = {
          applicationPath: state.applicationPath,
          selectedConditionId:
            selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none',
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      applicationPath: [
        'PaymentPage',
        'Modal',
        'ModalBody',
        'TaxDetailsModal',
        'DetailsModal',
        'TaxTypeBadge',
      ],
      selectedConditionId: 'tax-details-modal',
    });
  });

  /** Uses the enclosing component to distinguish repeated generic overlay primitives. */
  it('selects the corridor Sheet when sibling Sheets share the same tag owner', () => {
    const context: { __result?: { readonly before: string; readonly after: string } } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          boundariesByExport: new Map(),
          renderConditionOverrides: new Map(),
          renderConditions: new Map(),
          selectedExportName: 'Skeleton',
        };
        const initializePreviewInspectorConditionState = () => undefined;
        const readPreviewInspectorRuntimeFallbacks = () => [];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createTargetReachabilityFixtureSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { Skeleton: { paths: [] } },
          target: { exportName: 'Skeleton', sourcePath: '/common/Skeleton.tsx' },
        } };
        const candidate = {
          edges: [], id: 'explore-page',
          renderPath: { id: 'skeleton-path', steps: [
            { label: 'Skeleton', sourcePath: '/common/Skeleton.tsx', wrapperNames: [] },
            { label: 'DetailBottomSheetSkeleton', sourcePath: '/explore/DetailBottomSheetSkeleton.tsx', wrapperNames: ['Sheet'] },
            { label: 'ExplorePageCarousel', sourcePath: '/explore/ExplorePageCarousel.tsx', wrapperNames: [] },
            { label: 'ExplorePage', sourcePath: '/app/explore/page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'ExplorePage' },
          target: { exportName: 'Skeleton', sourcePath: '/common/Skeleton.tsx' },
        };
        const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
        const overlay = {
          authoredEnabled: false,
          authoredValueKind: 'boolean',
          effectiveEnabled: false,
          kind: 'overlay-visibility',
          ownerName: 'Sheet',
          reachabilityKey: state.key,
          role: 'overlay',
          targetBranch: 'truthy',
        };
        previewInspectorSession.renderConditions.set('filter-sheet', {
          ...overlay, id: 'filter-sheet', reachabilityDiscoveryOrder: 1,
          runtimeOwnerName: 'FilterRadioButtonGroup', sourcePath: '/explore/FilterRadioButtonGroup.tsx',
        });
        const before =
          selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none';
        previewInspectorSession.renderConditions.set('detail-sheet', {
          ...overlay, id: 'detail-sheet', reachabilityDiscoveryOrder: 2,
          runtimeOwnerName: 'ExplorePageCarousel', sourcePath: '/explore/ExplorePageCarousel.tsx',
        });
        globalThis.__result = {
          after: selectPreviewInspectorNextTargetGate(descriptor, candidate, state)?.condition?.id ?? 'none',
          before,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({ after: 'detail-sheet', before: 'none' });
  });

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
});
