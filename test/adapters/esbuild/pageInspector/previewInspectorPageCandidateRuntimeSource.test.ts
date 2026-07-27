/** Verifies authored page-candidate selection without importing React or application modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';

/** Minimal serializable candidate shape used by the generated runtime's pure selection helpers. */
interface CandidateFixture {
  readonly complete?: boolean;
  readonly contextModule?: {
    readonly evidenceKind: string;
    readonly importPath: readonly string[];
    readonly sourcePath: string;
  };
  readonly id: string;
  readonly renderPath?: {
    readonly entryPoint?: { readonly sourcePath: string };
    readonly steps?: readonly {
      readonly label: string;
      readonly sourcePath?: string;
      readonly wrapperNames?: readonly string[];
    }[];
  };
  readonly root: { readonly exportName: string; readonly sourcePath: string };
  readonly rootStepIndex?: number;
  readonly rootOwnsRouter?: boolean;
  readonly routeLocation?: { readonly componentName?: string; readonly pathname: string };
  readonly stopReason?: string;
  readonly target?: { readonly exportName: string; readonly sourcePath: string };
}

describe('Preview Inspector page-candidate runtime source', () => {
  /** Persists a valid caller choice and rejects identities outside the current descriptor. */
  it('switches only among descriptor-owned page candidates', () => {
    const candidates: readonly CandidateFixture[] = [
      {
        complete: true,
        id: 'public-path',
        renderPath: {
          entryPoint: { sourcePath: '/workspace/public-main.tsx' },
          steps: [
            { label: 'PublicPage' },
            { label: 'AppRouter', wrapperNames: ['ApplicationShell'] },
          ],
        },
        root: { exportName: 'PublicPage', sourcePath: '/workspace/PublicPage.tsx' },
        rootStepIndex: 0,
        routeLocation: { pathname: '/company/1/dashboard' },
      },
      {
        id: 'staff-path',
        root: { exportName: 'StaffPage', sourcePath: '/workspace/StaffPage.tsx' },
      },
    ];
    const result = evaluateCandidateSelection(candidates);

    expect(result.initialId).toBe('public-path');
    expect(result.selectedId).toBe('staff-path');
    expect(result.invalidId).toBe('staff-path');
    expect(result.notifications).toBe(1);
    expect(result.persisted).toBe(1);
    expect(result.scheduled).toBe(1);
    expect(result.userSelectedId).toBe('staff-path');
    expect(result.labels).toEqual([
      '1. PublicPage › ApplicationShell › AppRouter · application root · /company/1/dashboard',
      '2. StaffPage · partial context',
    ]);
  });

  /** Names a concrete child page when the selectable root is a Provider/Routes owner. */
  it('labels a route-factory child view beside its browser path', () => {
    const candidates: readonly CandidateFixture[] = [
      {
        complete: true,
        id: 'feature-settings',
        renderPath: {
          entryPoint: { sourcePath: '/workspace/main.tsx' },
          steps: [{ label: 'FeatureApp' }],
        },
        root: { exportName: 'FeatureApp', sourcePath: '/workspace/FeatureApp.tsx' },
        routeLocation: {
          componentName: 'SettingsPage',
          pathname: '/workspace/1/feature/settings',
        },
      },
    ];

    expect(evaluateCandidateSelection(candidates).labels).toEqual([
      '1. FeatureApp · application root · view SettingsPage · /workspace/1/feature/settings',
    ]);
  });

  /** Keeps the promoted component and hook/HOC context attached to the selected caller page. */
  it('reads target and module context from the selected page candidate', () => {
    expect(evaluateCandidateOwnedContext()).toEqual({
      contextSourcePath: '/workspace/shared/use-shared-card.ts',
      importPath: [
        '/workspace/staff/StaffPage.tsx',
        '/workspace/staff/StaffCardOwner.tsx',
        '/workspace/shared/use-shared-card.ts',
      ],
      targetExportName: 'StaffCardOwner',
      targetSourcePath: '/workspace/staff/StaffCardOwner.tsx',
    });
  });

  /** Promotes a changed automatic choice, but restores a temporarily unavailable user choice. */
  it('distinguishes automatic candidate promotion from an explicit user choice', () => {
    expect(evaluateCandidateEnrichmentSelection()).toEqual({
      automaticFastId: 'near-target',
      automaticFullId: 'application-root',
      explicitFullId: 'near-target',
      persisted: 1,
      provisionalId: 'application-root',
      restoredExplicitId: 'near-target',
      userSelectedId: 'near-target',
    });
  });

  /** Keeps candidate loading behind generated callbacks and reports a clear loading state. */
  it('contains a selection-aware asynchronous module loader boundary', () => {
    const source = createPreviewInspectorPageCandidateRuntimeSource();

    expect(source).toContain('function PreviewInspectorPageCandidateLoader');
    expect(source).toContain('function PreviewInspectorAuthoredPageLoader');
    expect(source).toContain('function requestPreviewInspectorPageExecutionRetry');
    expect(source).toContain("type: 'react-preview-inspector-page-execution-retry'");
    expect(source).toContain('pageExecutionRetryRevision === previewEntryRevision');
    expect(source).toContain('return definition.load();');
    expect(source).toContain('Loading authored page context…');
    expect(source).toContain('createPreviewCandidateRouterElement(rootElement');
    expect(source).toContain(
      'ownsRouter: directTarget ? false : candidate?.rootOwnsRouter === true',
    );
    expect(source).toContain('function createPreviewInspectorCandidateInitialEntry');
    expect(source).toContain('function preparePreviewInspectorOwnedRouterLocation');
    expect(source).toContain('owned-router-location-seeded');
    expect(source).toContain('initialEntry: candidateInitialEntry');
    expect(source).toContain('routerPathname: candidateInitialEntry');
    expect(source).toContain('requestedRouterPathname: candidateInitialEntry');
    expect(source).toContain("routeLocation?.evidenceKind === 'next-app-filesystem'");
    expect(source).toContain("event: 'page-context-selected'");
    expect(source).toContain('function createPreviewInspectorPageCandidateHealthSummary');
    expect(source).toContain('applicationPath: (reachability.applicationPath ?? []).slice(0, 32)');
    expect(source).toContain('candidateSummaries');
    expect(source).toContain('candidatesOmitted');
    expect(source).toContain('routeComponentName: candidate?.routeLocation?.componentName');
    expect(source).toContain("stopReason: candidate?.stopReason ?? 'unknown'");
    expect(source).toContain("evidenceKind: routeLocation?.evidenceKind ?? 'none'");
    expect(source).toContain('nextAppLayoutPaths: (candidate?.nextAppLayoutChain ?? [])');
    expect(source).toContain('nextPagesAppPath: candidate?.nextPagesShell?.app?.sourcePath');
    expect(source).toContain('rootSourcePath: candidate?.root?.sourcePath');
    expect(source).toContain('PreviewInspectorTargetReachabilityProbe');
    expect(source).toContain('class PreviewInspectorPageRootCommitBoundary');
    expect(source).toContain('state.pageRootCommitted = true');
    expect(source).toContain('pageCorridorElement');
    expect(source).toContain(
      'activatePreviewInspectorRuntimeFallbackScope(candidate, directTarget)',
    );
    expect(source).toContain(
      'readPreviewInspectorRuntimeFallbackDirectTarget(descriptor, candidate)',
    );
    expect(source).toContain('doesSelectedPreviewInspectorPageCandidateOwnRouter');
    expect(source).toContain('previewInspectorSession.selectedPageCandidateId = candidateId');
    expect(source).toContain('function readPreviewInspectorRouteBranches');
    expect(source).toContain('function selectPreviewInspectorRouteBranch');
    expect(source).toContain("type: 'react-preview-inspector-route-selected'");
    expect(source).toContain(
      'previewInspectorSession.pendingRouteSelectionPath = branch.selectionPath',
    );
    expect(source).toContain(
      'previewInspectorSession.pendingRouteBuildRevision = message.revision',
    );
    expect(source).toContain("message?.type === 'react-preview-progress'");
    expect(source).toContain('PREVIEW_INSPECTOR_ROUTE_SELECTION_TIMEOUT_MS = 10 * 60 * 1000');
    expect(source).toContain('Route preparation is taking longer than expected. Retry when ready.');
    expect(source).toContain(
      'previewInspectorSession.lastRequestedRouteSelectionPath = branch.selectionPath',
    );
  });

  /** Organizes a large App route inventory into searchable folders instead of one flat selector. */
  it('generates a bounded hierarchical route explorer', () => {
    const source = createPreviewInspectorPageCandidateUiRuntimeSource();

    expect(source).toContain('function PreviewInspectorRouteExplorer');
    expect(source).toContain('function collectPreviewInspectorRouteCommonPrefix');
    expect(source).toContain('function createPreviewInspectorRouteBranchIndex');
    expect(source).toContain('function collectPreviewInspectorRouteOwnerTrail');
    expect(source).toContain('function PreviewInspectorRouteOwnerFolderButton');
    expect(source).toContain('branch.parentId === ownerId');
    expect(source).toContain('Filter paths or components');
    expect(source).toContain('PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT = 80');
    expect(source).toContain("'data-rpi-scroll-key': 'route-browser'");
    expect(source).toContain("'data-rpi-scroll-transaction': 'route-selection:' + branch.id");
    expect(source).toContain("'data-rpi-scroll-transaction-state': pending");
    expect(source).toContain('React.createElement(PreviewInspectorRouteExplorer, { descriptor })');
    expect(source).toContain('function previewInspectorRouteSelectionPathStartsWith');
    expect(source).toContain(
      'previewInspectorRouteSelectionPathStartsWith(selectedBranch?.selectionPath, pendingSelectionPath)',
    );
    expect(source).toContain("'No application routes match this filter.'");
    expect(source).toContain("'Retry route'");
    expect(source).toContain("autoComplete: 'off'");
    expect(source).toContain("name: 'route-filter'");
    expect(source).toContain("' · default child'");
    expect(source).toContain(
      'const visibleChildFolders = [...childFolderCounts].slice(0, PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT);',
    );
    expect(source).toContain(
      'const visibleImmediateBranches = immediateBranches.slice(0, PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT);',
    );
  });

  it('emits syntactically valid route-selection runtime for the browser', () => {
    expect(
      () =>
        new vm.Script(
          createPreviewInspectorPageCandidateRuntimeSource() +
            createPreviewInspectorPageCandidateUiRuntimeSource(),
        ),
    ).not.toThrow();
  });

  /** A matching host-ready milestone clears a route transaction even if its terminal status was lost. */
  it('uses the matching ready revision as a terminal route-selection fallback', () => {
    expect(evaluateRouteSelectionReadyFallback()).toEqual({
      afterAccepted: 'route-selected',
      afterStaleReady: 'route-selected',
      afterMatchingReady: undefined,
      notifications: 2,
    });
  });

  /** Strips only a proven app-module mount prefix and leaves direct component routes untouched. */
  it('maps an absolute route into the selected app root coordinate system', () => {
    expect(evaluateCandidateInitialEntries()).toEqual({
      directTarget: '/company/1/credit',
      noBasePath: '/company/1/credit',
      rootIndex: '/',
      rootedModule: '/1/credit',
    });
  });

  /** Seeds an owned BrowserRouter or framework-owned Next Pages route before module evaluation. */
  it('moves browser history only for an owned or implicit Router with a safe route', () => {
    expect(evaluateOwnedRouterLocationPreparation()).toEqual({
      accepted: true,
      directTarget: false,
      nextPages: true,
      nextPagesState: { pathname: '/driver/callBlock', pattern: '/driver/[screen]' },
      paths: ['/company/1/dashboard', '/driver/callBlock'],
      rejectedAuthority: false,
      unowned: false,
    });
  });

  /** Exposes a neutral all-export perspective without interpreting authored fallback screens. */
  it('keeps page flow and the current-file component overview as explicit user scenarios', () => {
    const source = createPreviewInspectorPageCandidateRuntimeSource();

    expect(source).toContain('function readPreviewInspectorRenderScenario');
    expect(source).toContain('function setPreviewInspectorRenderScenario');
    expect(source).toContain('function PreviewInspectorFileComponentOverview');
    expect(source).toContain('definitions.filter((item) => item?.directTarget === true)');
    expect(source).toContain('PreviewInspectorFileComponentItem');
    expect(source).toContain('PreviewExportErrorBoundary');
    expect(source).toContain(
      '{ exportName, key: exportName, resetKey: String(conditionRevision) }',
    );
    expect(source).toContain("'data-react-preview-render-scenario': 'file-components'");
    expect(source).toContain('including any fallback UI that path legitimately renders');
    expect(source).not.toMatch(/ErrorPage|NotFound|status\s*===\s*500/u);
  });

  /** Persists only the two supported perspectives and ignores unknown application labels. */
  it('switches rendering perspective without classifying project output', () => {
    const result = evaluateRenderScenarioSelection();

    expect(result).toEqual({
      notifications: 2,
      persisted: 2,
      resets: 2,
      scenario: 'authored-page',
      scheduled: 2,
    });
  });

  /** Explains an invoked-but-invisible file as a three-step visibility path. */
  it('labels a reached file with no visible element in user language', () => {
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'resolver-cycle-detected',
        targetHasOutput: false,
        targetMounted: true,
      }),
    ).toEqual({
      action: 'Find what hides it',
      badge: 'NOT VISIBLE',
      description:
        'The page reached this file, but its current branch returned no visible element. Common causes are an OFF condition, missing data, or an intentional null return.',
      revealed: 'target-reachability:fixture',
      selected: 'target-reachability:fixture',
      steps: ['Page loaded', 'File ran', 'Nothing visible'],
      title: 'This file ran, but nothing is visible',
    });
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'reached',
        targetHasAnyHostOutput: true,
        targetHasOutput: false,
        targetMounted: true,
      }),
    ).toMatchObject({
      action: 'Find replaced content',
      badge: 'FALLBACK SHOWN',
      steps: ['Page loaded', 'File ran', 'Fallback shown'],
      title: 'A fallback is shown instead of this file',
    });
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'resolver-cycle-detected',
        targetDeferredCallbackPending: true,
        targetHasOutput: false,
        targetMounted: true,
      }),
    ).toMatchObject({
      action: 'Find callback requirement',
      badge: 'CALLBACK WAITING',
      steps: ['Page loaded', 'File connected', 'Callback waiting'],
      title: 'Waiting for the parent to render this file',
    });
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
        targetMounted: false,
      }),
    ).toMatchObject({ badge: 'NOT ON THIS PATH' });
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'reached',
        targetHasOutput: true,
        targetMounted: true,
      }),
    ).toMatchObject({ badge: 'PAGE READY' });
  });
});

/** Executes the pure page-status helpers without mounting the companion UI or project React tree. */
function evaluatePageCandidateUiStatus(reachability: Record<string, unknown>): {
  readonly action?: string;
  readonly badge: string;
  readonly description: string;
  readonly revealed?: string;
  readonly selected?: string;
  readonly steps?: readonly string[];
  readonly title: string;
} {
  const context: {
    __result?: ReturnType<typeof evaluatePageCandidateUiStatus>;
    reachability: Record<string, unknown>;
  } = { reachability };
  vm.runInNewContext(
    `${createPreviewInspectorPageCandidateUiRuntimeSource()}
function readPreviewInspectorRenderScenario() { return 'authored-page'; }
function readPreviewInspectorActiveBlockerSummary() {
  return {
    active: [{ blockerKind: 'target-reachability', id: 'target' }],
    count: 1,
    first: { blockerKind: 'target-reachability', id: 'target', name: 'Target path' },
  };
}
const descriptor = {};
const candidate = {};
const previewInspectorSession = { selectedExportName: 'default' };
let revealed;
let selected;
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function readSelectedPreviewInspectorPageCandidate() { return candidate; }
function readPreviewInspectorTargetReachabilityState() {
  return { ...globalThis.reachability, key: 'fixture', targetExportName: 'default' };
}
function readPreviewInspectorTargetReachabilityBlockers() {
  return [{ ...globalThis.reachability, id: 'target-reachability:fixture', key: 'fixture' }];
}
function createPreviewInspectorTargetReachabilityTreeNode(blocker) {
  return { id: blocker.id, name: 'Target output' };
}
function requestPreviewInspectorTreeReveal(nodeId) { revealed = nodeId; }
function selectPreviewInspectorUiNode(node) { selected = node.id; }
const status = readPreviewInspectorFriendlyPageStatus(globalThis.reachability);
if (status.onAction === revealPreviewInspectorMissingTargetOutput) status.onAction();
globalThis.__result = {
  action: status.action,
  badge: formatPreviewInspectorPageCorridorStatus(globalThis.reachability),
  description: status.description,
  revealed,
  selected,
  steps: status.steps?.map((step) => step.label),
  title: status.title,
};`,
    context,
  );
  if (context.__result === undefined) throw new Error('Page status fixture did not initialize.');
  return context.__result;
}

/** Runs the generated scenario state machine while leaving every React component body inert. */
function evaluateRenderScenarioSelection(): {
  readonly notifications: number;
  readonly persisted: number;
  readonly resets: number;
  readonly scenario: string;
  readonly scheduled: number;
} {
  const context: {
    __result?: ReturnType<typeof evaluateRenderScenarioSelection>;
  } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const previewInspectorSession = {
  renderScenario: 'authored-page',
  selectedTreeNodeId: 'old-node',
};
let notifications = 0;
let persisted = 0;
let resets = 0;
let scheduled = 0;
function notifyPreviewInspector() { notifications += 1; }
function persistPreviewInspectorState() { persisted += 1; }
function resetPreviewInspectorTargetReachability() { resets += 1; }
function schedulePreviewInspectorCommitRefresh() { scheduled += 1; }
setPreviewInspectorRenderScenario('file-components');
setPreviewInspectorRenderScenario('file-components');
setPreviewInspectorRenderScenario('project-error-screen');
setPreviewInspectorRenderScenario('authored-page');
globalThis.__result = {
  notifications,
  persisted,
  resets,
  scenario: previewInspectorSession.renderScenario,
  scheduled,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Render scenario runtime did not expose its test result.');
  }
  return context.__result;
}

/** Executes only pure helper calls; React-bearing component bodies remain inert in this VM. */
function evaluateCandidateSelection(candidates: readonly CandidateFixture[]): {
  readonly initialId: string;
  readonly invalidId: string;
  readonly labels: readonly string[];
  readonly notifications: number;
  readonly persisted: number;
  readonly scheduled: number;
  readonly selectedId: string;
  readonly userSelectedId: string;
} {
  const context: {
    __result?: ReturnType<typeof evaluateCandidateSelection>;
    candidates: readonly CandidateFixture[];
  } = { candidates };
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const descriptor = { inspector: { pageCandidates: globalThis.candidates } };
const previewInspectorSession = {
  selectedPageCandidateId: '',
  selectedTreeNodeId: 'old-node',
  userSelectedPageCandidateId: '',
};
let notifications = 0;
let persisted = 0;
let scheduled = 0;
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function notifyPreviewInspector() { notifications += 1; }
function persistPreviewInspectorState() { persisted += 1; }
function schedulePreviewInspectorCommitRefresh() { scheduled += 1; }
function resetPreviewInspectorTargetReachability() { /* composed runtime owns traversal reset */ }
const initial = readSelectedPreviewInspectorPageCandidate(descriptor);
previewInspectorSession.selectedPageCandidateId = initial.id;
selectPreviewInspectorPageCandidate('staff-path');
const selectedId = previewInspectorSession.selectedPageCandidateId;
selectPreviewInspectorPageCandidate('unknown-path');
globalThis.__result = {
  initialId: initial.id,
  invalidId: previewInspectorSession.selectedPageCandidateId,
  labels: globalThis.candidates.map(formatPreviewInspectorPageCandidate),
  notifications,
  persisted,
  scheduled,
  selectedId,
  userSelectedId: previewInspectorSession.userSelectedPageCandidateId,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Page candidate runtime did not expose its test result.');
  }
  return context.__result;
}

/** Selects a secondary page and reads the candidate-local target/context rather than plan defaults. */
function evaluateCandidateOwnedContext(): {
  readonly contextSourcePath: string;
  readonly importPath: readonly string[];
  readonly targetExportName: string;
  readonly targetSourcePath: string;
} {
  const candidates: readonly CandidateFixture[] = [
    {
      contextModule: {
        evidenceKind: 'import-chain',
        importPath: [
          '/workspace/customer/PublicPage.tsx',
          '/workspace/customer/PublicCardOwner.tsx',
          '/workspace/shared/use-shared-card.ts',
        ],
        sourcePath: '/workspace/shared/use-shared-card.ts',
      },
      id: 'public-path',
      root: { exportName: 'PublicPage', sourcePath: '/workspace/customer/PublicPage.tsx' },
      target: {
        exportName: 'PublicCardOwner',
        sourcePath: '/workspace/customer/PublicCardOwner.tsx',
      },
    },
    {
      contextModule: {
        evidenceKind: 'import-chain',
        importPath: [
          '/workspace/staff/StaffPage.tsx',
          '/workspace/staff/StaffCardOwner.tsx',
          '/workspace/shared/use-shared-card.ts',
        ],
        sourcePath: '/workspace/shared/use-shared-card.ts',
      },
      id: 'staff-path',
      root: { exportName: 'StaffPage', sourcePath: '/workspace/staff/StaffPage.tsx' },
      target: {
        exportName: 'StaffCardOwner',
        sourcePath: '/workspace/staff/StaffCardOwner.tsx',
      },
    },
  ];
  const context: {
    __result?: ReturnType<typeof evaluateCandidateOwnedContext>;
    candidates: readonly CandidateFixture[];
  } = { candidates };
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const descriptor = {
  inspector: {
    contextModule: {
      evidenceKind: 'import-chain',
      importPath: ['/workspace/legacy.tsx'],
      sourcePath: '/workspace/legacy.tsx',
    },
    pageCandidates: globalThis.candidates,
    target: { exportName: 'LegacyTarget', sourcePath: '/workspace/legacy.tsx' },
  },
};
const previewInspectorSession = { selectedPageCandidateId: 'staff-path' };
const moduleContext = readSelectedPreviewInspectorModuleContext(descriptor);
const target = readSelectedPreviewInspectorCandidateTarget(descriptor);
globalThis.__result = {
  contextSourcePath: moduleContext.sourcePath,
  importPath: moduleContext.importPath,
  targetExportName: target.exportName,
  targetSourcePath: target.sourcePath,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Candidate-owned context runtime did not expose its test result.');
  }
  return context.__result;
}

/** Runs a fast-to-full candidate sequence without loading React or application modules. */
function evaluateCandidateEnrichmentSelection(): {
  readonly automaticFastId: string;
  readonly automaticFullId: string;
  readonly explicitFullId: string;
  readonly persisted: number;
  readonly provisionalId: string;
  readonly restoredExplicitId: string;
  readonly userSelectedId: string;
} {
  const context: { __result?: ReturnType<typeof evaluateCandidateEnrichmentSelection> } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const applicationRoot = { id: 'application-root', root: { exportName: 'App' } };
const nearTarget = { id: 'near-target', root: { exportName: 'TargetPage' } };
let candidates = [nearTarget];
const descriptor = { inspector: { get pageCandidates() { return candidates; } } };
const previewInspectorSession = {
  selectedPageCandidateId: '',
  selectedTreeNodeId: undefined,
  userSelectedPageCandidateId: '',
};
let persisted = 0;
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function notifyPreviewInspector() {}
function persistPreviewInspectorState() { persisted += 1; }
function schedulePreviewInspectorCommitRefresh() {}
function resetPreviewInspectorTargetReachability() {}
reconcilePreviewInspectorPageCandidateSelection(candidates.map((candidate) => candidate.id));
const automaticFastId = previewInspectorSession.selectedPageCandidateId;
candidates = [applicationRoot, nearTarget];
reconcilePreviewInspectorPageCandidateSelection(candidates.map((candidate) => candidate.id));
const automaticFullId = previewInspectorSession.selectedPageCandidateId;
selectPreviewInspectorPageCandidate('near-target');
const explicitFullId = previewInspectorSession.selectedPageCandidateId;
candidates = [applicationRoot];
reconcilePreviewInspectorPageCandidateSelection(candidates.map((candidate) => candidate.id));
const provisionalId = previewInspectorSession.selectedPageCandidateId;
candidates = [applicationRoot, nearTarget];
reconcilePreviewInspectorPageCandidateSelection(candidates.map((candidate) => candidate.id));
globalThis.__result = {
  automaticFastId,
  automaticFullId,
  explicitFullId,
  persisted,
  provisionalId,
  restoredExplicitId: previewInspectorSession.selectedPageCandidateId,
  userSelectedId: previewInspectorSession.userSelectedPageCandidateId,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Page candidate enrichment runtime did not expose its test result.');
  }
  return context.__result;
}

/** Executes the generated route-coordinate helper with inert component functions. */
function evaluateCandidateInitialEntries(): Record<string, string> {
  const context: { __result?: Record<string, string> } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const AppModule = Object.assign(() => undefined, { basePath: '/company' });
const PlainRoot = () => undefined;
const route = { routeLocation: { pathname: '/company/1/credit' } };
globalThis.__result = {
  directTarget: createPreviewInspectorCandidateInitialEntry(route, AppModule, true),
  noBasePath: createPreviewInspectorCandidateInitialEntry(route, PlainRoot, false),
  rootIndex: createPreviewInspectorCandidateInitialEntry(
    { routeLocation: { pathname: '/company' } },
    AppModule,
    false,
  ),
  rootedModule: createPreviewInspectorCandidateInitialEntry(route, AppModule, false),
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Page candidate route helper did not expose its test result.');
  }
  return context.__result;
}

/** Exercises the generated progress fallback without loading React or a project route module. */
function evaluateRouteSelectionReadyFallback(): {
  readonly afterAccepted: string | undefined;
  readonly afterMatchingReady: string | undefined;
  readonly afterStaleReady: string | undefined;
  readonly notifications: number;
} {
  const context: {
    __result?: ReturnType<typeof evaluateRouteSelectionReadyFallback>;
  } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const previewInspectorSession = {
  pendingRouteBranchId: 'route-selected',
  pendingRouteBuildRevision: undefined,
  pendingRouteInteractionId: 'route:7:1',
  pendingRouteSelectionPath: [{ componentName: 'SelectedPage', pattern: '/selected' }],
  pendingRouteTimeout: undefined,
};
let notifications = 0;
function notifyPreviewInspector() { notifications += 1; }
handlePreviewInspectorSelectionStatus({
  branchId: 'route-selected',
  buildRevision: 8,
  displayedRuntimeRevision: 7,
  interactionId: 'route:7:1',
  status: 'accepted',
  type: 'react-preview-inspector-route-selection-status',
});
const afterAccepted = previewInspectorSession.pendingRouteBranchId;
handlePreviewInspectorSelectionStatus({
  complete: true,
  revision: 7,
  stage: 'ready',
  type: 'react-preview-progress',
});
const afterStaleReady = previewInspectorSession.pendingRouteBranchId;
handlePreviewInspectorSelectionStatus({
  complete: true,
  revision: 8,
  stage: 'ready',
  type: 'react-preview-progress',
});
globalThis.__result = {
  afterAccepted,
  afterMatchingReady: previewInspectorSession.pendingRouteBranchId,
  afterStaleReady,
  notifications,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Route ready fallback did not expose its test result.');
  }
  return context.__result;
}

/** Executes the owned-Router history boundary without loading a React or project module. */
function evaluateOwnedRouterLocationPreparation(): {
  readonly accepted: boolean;
  readonly directTarget: boolean;
  readonly nextPages: boolean;
  readonly nextPagesState: { readonly pathname: string; readonly pattern: string };
  readonly paths: readonly string[];
  readonly rejectedAuthority: boolean;
  readonly unowned: boolean;
} {
  const context: {
    __result?: ReturnType<typeof evaluateOwnedRouterLocationPreparation>;
  } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageCandidateRuntimeSource()}
const paths = [];
globalThis.location = { pathname: '/preview-artifact' };
globalThis.history = {
  state: { retained: true },
  replaceState(_state, _title, pathname) {
    paths.push(pathname);
    globalThis.location.pathname = pathname;
  },
};
function recordPreviewInspectorRuntimeHealth() { /* runtime diagnostics are inert in this test */ }
const accepted = preparePreviewInspectorOwnedRouterLocation({
  id: 'application-root',
  rootOwnsRouter: true,
  routeLocation: { pathname: '/company/1/dashboard' },
}, false);
const directTarget = preparePreviewInspectorOwnedRouterLocation({
  rootOwnsRouter: true,
  routeLocation: { pathname: '/direct' },
}, true);
const nextPages = preparePreviewInspectorOwnedRouterLocation({
  nextPagesShell: { app: { exportName: 'default', sourcePath: '/workspace/pages/_app.tsx' } },
  rootOwnsRouter: false,
  routeLocation: {
    evidenceKind: 'next-pages-filesystem',
    pathname: '/driver/callBlock',
    pattern: '/driver/[screen]',
  },
}, false);
const nextPagesState = globalThis[
  Symbol.for('newdlops.react-file-preview.next-pages-router-state')
];
const rejectedAuthority = preparePreviewInspectorOwnedRouterLocation({
  rootOwnsRouter: true,
  routeLocation: { pathname: '//foreign.invalid/path' },
}, false);
const unowned = preparePreviewInspectorOwnedRouterLocation({
  rootOwnsRouter: false,
  routeLocation: { pathname: '/unowned' },
}, false);
globalThis.__result = {
  accepted, directTarget, nextPages, nextPagesState, paths, rejectedAuthority, unowned,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Owned Router location helper did not expose its test result.');
  }
  return context.__result;
}
