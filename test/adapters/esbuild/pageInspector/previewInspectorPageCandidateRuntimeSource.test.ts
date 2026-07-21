/** Verifies authored page-candidate selection without importing React or application modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';

/** Minimal serializable candidate shape used by the generated runtime's pure selection helpers. */
interface CandidateFixture {
  readonly complete?: boolean;
  readonly id: string;
  readonly renderPath?: {
    readonly entryPoint?: { readonly sourcePath: string };
    readonly steps?: readonly {
      readonly label: string;
      readonly wrapperNames?: readonly string[];
    }[];
  };
  readonly root: { readonly exportName: string; readonly sourcePath: string };
  readonly rootStepIndex?: number;
  readonly rootOwnsRouter?: boolean;
  readonly routeLocation?: { readonly pathname: string };
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
    expect(result.labels).toEqual([
      '1. PublicPage › ApplicationShell › AppRouter · application root · /company/1/dashboard',
      '2. StaffPage · partial context',
    ]);
  });

  /** Keeps candidate loading behind generated callbacks and reports a clear loading state. */
  it('contains a selection-aware asynchronous module loader boundary', () => {
    const source = createPreviewInspectorPageCandidateRuntimeSource();

    expect(source).toContain('function PreviewInspectorPageCandidateLoader');
    expect(source).toContain('function PreviewInspectorAuthoredPageLoader');
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
    expect(source).toContain("event: 'page-context-selected'");
    expect(source).toContain("evidenceKind: routeLocation?.evidenceKind ?? 'none'");
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

  /** Seeds a full application BrowserRouter before its dynamically imported module evaluates. */
  it('moves browser history only for an owned Router with a proven safe route', () => {
    expect(evaluateOwnedRouterLocationPreparation()).toEqual({
      accepted: true,
      directTarget: false,
      paths: ['/company/1/dashboard'],
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

  /** Keeps invocation and connected host output as separate user-facing page states. */
  it('labels a mounted target without host output as TARGET EMPTY', () => {
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'resolver-cycle-detected',
        targetHasOutput: false,
        targetMounted: true,
      }),
    ).toEqual({
      action: 'Inspect missing output',
      badge: 'TARGET EMPTY',
      revealed: 'target-reachability:fixture',
      selected: 'target-reachability:fixture',
      title: 'Current file mounted without output',
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
      badge: 'TARGET EMPTY',
      title: 'Current file stopped at wrapper or fallback output',
    });
    expect(
      evaluatePageCandidateUiStatus({
        pageRootCommitted: true,
        status: 'page-blocked',
        targetHasOutput: false,
        targetMounted: false,
      }),
    ).toMatchObject({ badge: 'TARGET ABSENT' });
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
  readonly revealed?: string;
  readonly selected?: string;
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
if (status.action === 'Inspect missing output') status.onAction();
globalThis.__result = {
  action: status.action,
  badge: formatPreviewInspectorPageCorridorStatus(globalThis.reachability),
  revealed,
  selected,
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
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Page candidate runtime did not expose its test result.');
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

/** Executes the owned-Router history boundary without loading a React or project module. */
function evaluateOwnedRouterLocationPreparation(): {
  readonly accepted: boolean;
  readonly directTarget: boolean;
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
const rejectedAuthority = preparePreviewInspectorOwnedRouterLocation({
  rootOwnsRouter: true,
  routeLocation: { pathname: '//foreign.invalid/path' },
}, false);
const unowned = preparePreviewInspectorOwnedRouterLocation({
  rootOwnsRouter: false,
  routeLocation: { pathname: '/unowned' },
}, false);
globalThis.__result = { accepted, directTarget, paths, rejectedAuthority, unowned };`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Owned Router location helper did not expose its test result.');
  }
  return context.__result;
}
