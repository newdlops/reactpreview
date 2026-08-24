/** Verifies that an authored early-return child on the selected path outranks generic continuation metadata. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

describe('Preview Inspector returned path condition runtime', () => {
  it('enters a nested Skeleton early return proven by the selected page path', () => {
    const context: {
      __result?: {
        readonly genericContinuation: boolean;
        readonly path: readonly string[];
        readonly returnedSkeleton: boolean;
        readonly selectedGate: string;
        readonly selectedGateValue: boolean;
        readonly sharedWrapper: boolean;
      };
    } = {};

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
        ${createPreviewInspectorTargetReachabilityRuntimeSource()}
        ${createPreviewInspectorTargetPathIdentityRuntimeSource()}
        const descriptor = { inspector: {
          renderChainsByExport: { Skeleton: { paths: [], target: {
            exportName: 'Skeleton', sourcePath: '/components/common/Skeleton.tsx',
          } } },
          target: { exportName: 'Skeleton', sourcePath: '/components/common/Skeleton.tsx' },
        } };
        const candidate = {
          edges: [],
          id: 'explore-sheet-skeleton',
          renderPath: { id: 'explore-sheet-skeleton-path', steps: [
            { label: 'Skeleton', sourcePath: '/components/common/Skeleton.tsx', wrapperNames: [] },
            { label: 'DetailBottomSheetSkeleton', sourcePath: '/components/explore/DetailBottomSheetSkeleton.tsx', wrapperNames: [] },
            { label: 'DetailBottomSheetContent', sourcePath: '/components/explore/DetailBottomSheetContent.tsx', wrapperNames: ['SheetContent', 'Sheet'] },
            { label: 'PosterCardsGrid', sourcePath: '/components/explore/PosterCardsGrid.tsx', wrapperNames: [] },
            { label: 'ExplorePage', sourcePath: '/app/explore/page.tsx', wrapperNames: [] },
          ] },
          root: { exportName: 'ExplorePage' },
          target: { exportName: 'Skeleton', sourcePath: '/components/common/Skeleton.tsx' },
        };
        const state = createPreviewInspectorTargetReachabilityState(descriptor, candidate);
        const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
        previewInspectorSession.renderConditions.set('pending-skeleton', {
          effectiveEnabled: false,
          falsyLabel: 'continue <DetailBottomSheetContent>',
          id: 'pending-skeleton',
          kind: 'early-return',
          ownerName: 'DetailBottomSheetContent',
          reachabilityDiscoveryOrder: 0,
          reachabilityKey: state.key,
          sourcePath: '/components/explore/DetailBottomSheetContent.tsx',
          targetBranch: 'falsy',
          truthyLabel: '<DetailBottomSheetSkeleton>',
        });
        const selectedGate = selectPreviewInspectorNextTargetGate(descriptor, candidate, state);
        globalThis.__result = {
          genericContinuation: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <ExplorePage>',
            targetBranch: 'falsy',
            truthyLabel: '<LoginPage>',
          }, evidence),
          path: state.applicationPath,
          returnedSkeleton: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <DetailBottomSheetContent>',
            kind: 'early-return',
            targetBranch: 'falsy',
            truthyLabel: '<DetailBottomSheetSkeleton>',
          }, evidence),
          selectedGate: selectedGate?.condition?.id ?? 'none',
          selectedGateValue: selectedGate?.desiredValue,
          sharedWrapper: readPreviewInspectorTargetConditionValue({
            falsyLabel: 'continue <DetailBottomSheetContent>',
            targetBranch: 'falsy',
            truthyLabel: '<Sheet>',
          }, evidence),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      genericContinuation: false,
      path: [
        'ExplorePage',
        'PosterCardsGrid',
        'Sheet',
        'SheetContent',
        'DetailBottomSheetContent',
        'DetailBottomSheetSkeleton',
        'Skeleton',
      ],
      returnedSkeleton: true,
      selectedGate: 'pending-skeleton',
      selectedGateValue: true,
      sharedWrapper: false,
    });
  });
});
