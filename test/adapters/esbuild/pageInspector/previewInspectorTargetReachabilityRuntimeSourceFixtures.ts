/** Shared deterministic fixtures for previewInspectorTargetReachabilityRuntimeSource regression scenarios. */
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Composes the identity helper required by the standalone target runtime fixture. */
export function createTargetReachabilityFixtureSource(): string {
  return (
    createPreviewInspectorTargetReachabilityRuntimeSource() +
    createPreviewInspectorTargetPathIdentityRuntimeSource() +
    createPreviewInspectorTargetAttemptRuntimeSource()
  );
}

/** Reuses the byte-identical page/target corridor declarations in VM scenarios. */
export function createPageTargetDescriptorCandidateFixtureSource(): string {
  return `const descriptor = { inspector: { renderChainsByExport: { Target: { paths: [], target: { exportName: 'Target', sourcePath: '/Target.tsx' } } }, target: { exportName: 'Target', sourcePath: '/Target.tsx' } } }; const candidate = { edges: [], id: 'page', renderPath: { id: 'path', steps: [{ label: 'Target', sourcePath: '/Target.tsx', wrapperNames: [] }, { label: 'Page', sourcePath: '/Page.tsx', wrapperNames: [] }] }, root: { exportName: 'Page' } };`;
}

/** Shares only the byte-equivalent empty target-runtime VM preamble. */
export function createEmptyPageTargetRuntimePreambleSource(): string {
  return `const previewInspectorSession = { boundariesByExport: new Map(), renderConditionOverrides: new Map(), renderConditions: new Map(), selectedExportName: 'Target' }; const initializePreviewInspectorConditionState = () => undefined; const readPreviewInspectorRuntimeFallbacks = () => []; const readPreviewInspectorDataRequests = () => []; const readPreviewInspectorDataShapePaths = () => []; const collectPreviewInspectorFiberElements = () => []; const notifyPreviewInspector = () => undefined; const schedulePreviewInspectorTreeRefresh = () => undefined; const schedulePreviewInspectorCommitRefresh = () => undefined; const recordPreviewInspectorConsoleEntry = () => undefined; const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined });`;
}

/** Reuses the unrelated shell gate that must never enter the target corridor. */
export function createUnrelatedShellGateFixtureSource(): string {
  return `previewInspectorSession.renderConditions.set('unrelated-shell-gate', { effectiveEnabled: true, expression: '<TruncatableParagraph> gate: typeof content === "string"', id: 'unrelated-shell-gate', ownerName: 'TruncatableParagraph', reachabilityDiscoveryOrder: 0, reachabilityKey: state.key, sourcePath: '/shell/truncatable-paragraph.tsx', targetBranch: 'falsy' });`;
}

/** Shares Dashboard VM dependencies without changing host-aware output observation. */
export function createDashboardRuntimeDependenciesFixtureSource(): string {
  return `const previewInspectorSession = { boundariesByExport: new Map(), renderConditionOverrides: new Map(), renderConditions: new Map(), selectedExportName: 'DashboardPanel' }; const initializePreviewInspectorConditionState = () => undefined; const readPreviewInspectorRuntimeFallbacks = () => []; const readPreviewInspectorDataRequests = () => []; const readPreviewInspectorDataShapePaths = () => []; const notifyPreviewInspector = () => undefined; const schedulePreviewInspectorTreeRefresh = () => undefined; const schedulePreviewInspectorCommitRefresh = () => undefined; const setPreviewInspectorTargetGuidedConditionOverride = () => undefined; const clearPreviewInspectorTargetGuidedConditionOverrides = () => false; const recordPreviewInspectorConsoleEntry = () => undefined; const readPreviewInspectorConsolePrimitives = () => ({ warn: () => undefined }); const collectPreviewInspectorFiberElements = (boundary) => boundary?.host === true ? [{}] : [];`;
}

/** Shares the Dashboard target descriptor and page candidate declarations. */
export function createDashboardDescriptorCandidateFixtureSource(): string {
  return `const descriptor = { inspector: { renderChainsByExport: { DashboardPanel: { paths: [], target: { exportName: 'DashboardPanel', sourcePath: '/workspace/Dashboard.tsx' } } }, target: { exportName: 'DashboardPanel', sourcePath: '/workspace/Dashboard.tsx' } } }; const candidate = { edges: [], id: 'dashboard-page', renderPath: { id: 'path', steps: [{ label: 'DashboardPanel', sourcePath: '/workspace/Dashboard.tsx', wrapperNames: [] }, { label: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx', wrapperNames: [] }] }, root: { exportName: 'DashboardPage' } };`;
}

/** Minimal pure helper result exposed by the generated runtime fixture. */
export interface ReachabilityResult {
  readonly blockerPath: readonly string[];
  readonly desiredValue: boolean;
  readonly expression: string;
  readonly fallbackBeforeTargetMount: string;
  readonly fallbackExpression: string;
  readonly key: string;
  readonly overlayPathLocal: boolean;
  readonly overlayTargetValue: boolean;
  readonly returnedTargetValue: boolean;
  readonly runtimeRedirectTargetValue: boolean;
  readonly runtimeOwnerNameOnlyPathLocal: boolean;
  readonly siblingOverlaySelection: string;
  readonly sharedModalExactSourcePathLocal: boolean;
  readonly sharedModalNameOnlyPathLocal: boolean;
  readonly sharedWrapperTargetValue: boolean;
  readonly targetOverlaySelection: string;
  readonly targetNameOnlyPathLocal: boolean;
  readonly targetSourceScore: number;
  readonly targetExportName: string;
  readonly twoSidedTargetValue: boolean;
}
