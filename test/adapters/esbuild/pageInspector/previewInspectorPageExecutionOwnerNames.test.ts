/**
 * Verifies how live page owners are proven: a default-exported root by the component name React
 * mounts (RootLayout in app/layout.tsx) rather than its file name, and a factory-made root (such as
 * recompose withProps) by the generated execution-root bridge rendered directly above it.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateSelectionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateSelectionRuntimeSource';
import {
  PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_KEY,
  PREVIEW_INSPECTOR_EXECUTION_SURFACES_KEY,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_KEY,
  createPreviewInspectorPageExecutionContextRuntimeSource,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageExecutionContextRuntimeSource';

interface Observation {
  readonly contextComplete: boolean;
  readonly executionRootMounted: boolean;
  readonly executionRootName?: string;
  readonly executionRootObserved: boolean;
  readonly pageFrameObserved: boolean;
  readonly pageRootNames: readonly string[];
  readonly pageRootObserved: boolean;
}

const LAYOUT = '/workspace/src/app/layout.tsx';
const APP_MODULE = '/workspace/src/app/investment-association-id-app.tsx';

describe('Page Execution owner names', () => {
  it('verifies a default-exported layout by its declared component name', () => {
    const observation = observe({
      execution: {
        executionRootComponentName: 'RootLayout',
        pageRootComponentName: 'RootLayout',
      },
    });

    expect(observation).toMatchObject({
      contextComplete: true,
      executionRootMounted: false,
      executionRootName: 'RootLayout',
      executionRootObserved: true,
      pageRootObserved: true,
    });
    expect(observation.pageRootNames).toEqual(['RootLayout', 'layout']);
  });

  it('keeps the file-name alias when the compiler could not prove a name', () => {
    expect(observe({})).toMatchObject({
      contextComplete: false,
      executionRootName: 'layout',
      executionRootObserved: false,
      pageRootNames: ['layout'],
      pageRootObserved: false,
    });
  });
});

describe('Page Execution root bridge', () => {
  /** A factory-made app module mounts as withProps(Component), never under its export name. */
  const appModule = {
    execution: {
      executionRootExportName: 'InvestmentAssociationIdApp',
      executionRootSourcePath: APP_MODULE,
      pageRootExportName: 'InvestmentAssociationIdApp',
      pageRootSourcePath: APP_MODULE,
    },
    owners: ['withProps(Component)', 'AppErrorBoundary'],
    root: { exportName: 'InvestmentAssociationIdApp', sourcePath: APP_MODULE },
    shells: [
      {
        relation: 'owner',
        root: { exportName: 'InvestmentAssociationIdApp', sourcePath: APP_MODULE },
      },
    ],
  };

  it('proves the execution root, its page root, and its page frame by the marked bridge', () => {
    expect(observe({ ...appModule, bridge: 'marked' })).toMatchObject({
      contextComplete: true,
      executionRootMounted: true,
      executionRootObserved: true,
      pageFrameObserved: true,
      pageRootObserved: true,
    });
  });

  it('keeps the name check without a marked bridge', () => {
    expect(observe({ ...appModule, bridge: 'unmarked' })).toMatchObject({
      contextComplete: false,
      executionRootMounted: false,
      executionRootObserved: false,
      pageFrameObserved: false,
      pageRootObserved: false,
    });
  });

  it('still requires the name of a page root that is not the execution root', () => {
    const observation = observe({
      ...appModule,
      bridge: 'marked',
      execution: {
        ...appModule.execution,
        pageRootExportName: 'IaInvestmentHistoryPage',
        pageRootSourcePath: '/workspace/src/app/ia-investment-history-page.tsx',
      },
    });

    expect(observation).toMatchObject({
      contextComplete: false,
      executionRootObserved: true,
      pageRootObserved: false,
    });
  });

  it('does not let a target-only execution prove its page owners', () => {
    expect(
      observe({
        ...appModule,
        bridge: 'marked',
        execution: { ...appModule.execution, fidelity: 'target-only' },
      }),
    ).toMatchObject({ contextComplete: false, executionRootMounted: false });
  });
});

describe('Page Execution owner surfaces', () => {
  /** A styled-components layout mounts as Styled(Component) above the bridge of an inner module. */
  const LAYOUT = '/workspace/src/app/layout/investment-association-layout.tsx';
  const HISTORY_APP = '/workspace/src/app/ia-investment-history-app-id.tsx';
  const historyApp = {
    bridge: 'marked' as const,
    execution: {
      executionRootExportName: 'IaInvestmentHistoryApp',
      executionRootSourcePath: HISTORY_APP,
      pageRootExportName: 'IaInvestmentHistoryApp',
      pageRootSourcePath: HISTORY_APP,
    },
    owners: ['withProps(Component)', 'IaInvestmentHistoryEditPage'],
    outerOwners: ['Styled(Component)', 'function'],
    root: { exportName: 'IaInvestmentHistoryApp', sourcePath: HISTORY_APP },
    shells: [
      {
        relation: 'wrapper',
        root: { exportName: 'InvestmentAssociationLayout', sourcePath: LAYOUT },
      },
      {
        relation: 'owner',
        root: { exportName: 'IaInvestmentHistoryApp', sourcePath: HISTORY_APP },
      },
    ],
  };

  it('proves a styled page frame by the identity of its imported component', () => {
    expect(
      observe({
        ...historyApp,
        registered: [
          {
            exportName: 'InvestmentAssociationLayout',
            owner: 'Styled(Component)',
            sourcePath: LAYOUT,
          },
        ],
      }),
    ).toMatchObject({ contextComplete: true, pageFrameObserved: true, pageRootObserved: true });
  });

  it('keeps the frame missing when its component is not registered or not mounted', () => {
    expect(observe(historyApp)).toMatchObject({ contextComplete: false, pageFrameObserved: false });
    expect(
      observe({
        ...historyApp,
        outerOwners: ['Other'],
        registered: [
          {
            exportName: 'InvestmentAssociationLayout',
            owner: 'Styled(Component)',
            sourcePath: LAYOUT,
          },
        ],
      }),
    ).toMatchObject({ contextComplete: false, pageFrameObserved: false });
  });
});

describe('Page Execution detached target owners', () => {
  /** Closed-modal content is mounted beside the page; its owners are siblings below the bridge. */
  const detached = {
    executionMarked: true,
    fidelity: 'page-authentic',
    placement: 'overlay-sibling',
  };

  it('proves the sibling page through the marked bridge inside the same execution', () => {
    expect(observeDetached(detached)).toMatchObject({
      contextComplete: true,
      executionRootMounted: true,
      pageRootObserved: true,
    });
  });

  it('keeps the ancestor-only proof for a target that is not detached', () => {
    expect(observeDetached({ ...detached, placement: undefined })).toMatchObject({
      contextComplete: false,
      executionRootMounted: false,
    });
  });

  /** The runtime's contextual-target fallback sets a state placement; it proves nothing. */
  it('ignores a placement set only by the contextual-target fallback', () => {
    expect(
      observeDetached({ ...detached, placement: undefined, statePlacement: 'deferred-sibling' }),
    ).toMatchObject({ contextComplete: false, executionRootMounted: false });
  });

  it('ignores a bridge outside a marked execution and target-only executions', () => {
    expect(observeDetached({ ...detached, executionMarked: false })).toMatchObject({
      contextComplete: false,
      executionRootMounted: false,
    });
    expect(observeDetached({ ...detached, fidelity: 'target-only' })).toMatchObject({
      contextComplete: false,
      executionRootMounted: false,
    });
  });
});

/**
 * Observes InventoryPage (a registered withProps owner, rendered by the marked bridge) with the
 * target mounted as a sibling of the bridge inside one generated Page Execution.
 */
function observeDetached(options: {
  readonly executionMarked: boolean;
  readonly fidelity: string;
  readonly placement: string | undefined;
  readonly statePlacement?: string;
}): Observation {
  const page = {
    exportName: 'InventoryPage',
    sourcePath: '/workspace/src/pages/InventoryPage.tsx',
  };
  const context: { __observation?: Observation } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
const setTimeout = () => 1;
const clearTimeout = () => undefined;
${createPreviewInspectorPageCandidateSelectionRuntimeSource()}
${createPreviewInspectorPageExecutionContextRuntimeSource()}
const previewEntryRevision = 7;
const previewInspectorSession = { interactionSequence: 0, selectedExportName: 'ColumnMappingTable' };
const page = ${JSON.stringify(page)};
const candidate = {
  complete: true,
  detachedTargetPlacement: ${JSON.stringify(options.placement ?? null)} ?? undefined,
  id: 'page-candidate',
  renderPath: {},
  root: page,
  stopReason: 'render-path-checkpoint',
  target: { exportName: 'ColumnMappingTable', sourcePath: '/workspace/src/ColumnMappingTable.tsx' },
};
const descriptor = {
  inspector: {
    executablePageCandidateId: candidate.id,
    pageExecutionCandidateId: 'execution',
    pageExecutionCandidates: [{
      executionRootExportName: page.exportName,
      executionRootSourcePath: page.sourcePath,
      fidelity: ${JSON.stringify(options.fidelity)},
      id: 'execution',
      pageRootExportName: page.exportName,
      pageRootSourcePath: page.sourcePath,
    }],
    target: candidate.target,
  },
};
const state = {
  detachedTargetPlacement: ${JSON.stringify(options.statePlacement ?? null)} ?? undefined,
  applicationPath: ['App', 'InventoryPage'],
  key: 'page:ColumnMappingTable',
  pageRootCommitted: true,
  status: 'reached',
  targetDirectElementOutput: true,
  targetExportName: 'ColumnMappingTable',
  targetHasOutput: true,
  targetWasMounted: true,
};
const pageComponent = function WithProps() { return null; };
globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_EXECUTION_SURFACES_KEY)})] = [
  { component: pageComponent, exportName: page.exportName, sourcePath: page.sourcePath },
];
function PreviewInspectorPageExecution() { return null; }
if (${JSON.stringify(options.executionMarked)}) {
  PreviewInspectorPageExecution[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_PAGE_EXECUTION_KEY)})] = true;
}
function PreviewInspectorExecutionRootBridge() { return null; }
PreviewInspectorExecutionRootBridge[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_KEY)})] = true;
const execution = { kind: 'function', name: 'PreviewInspectorPageExecution', type: PreviewInspectorPageExecution };
const route = { kind: 'function', name: 'RenderedRoute', return: execution, type: function RenderedRoute() {} };
const bridge = { kind: 'function', name: 'PreviewInspectorExecutionRootBridge', return: route, type: PreviewInspectorExecutionRootBridge };
const pageFiber = { elementType: pageComponent, kind: 'function', name: 'withProps(Component)', return: bridge, type: pageComponent };
const targetParent = { kind: 'function', name: 'ReactPreviewInspector(ColumnMappingTable)', return: route, type: function Target() {} };
execution.child = route;
route.child = bridge;
bridge.child = pageFiber;
bridge.sibling = targetParent;
const boundaryFiber = { return: targetParent };
function readSelectedPreviewInspectorPageExecutionCandidate(value) {
  return value?.inspector?.pageExecutionCandidates?.find(
    (item) => item.id === value.inspector.pageExecutionCandidateId,
  );
}
function readPreviewInspectorTargetBoundaries() { return new Set([{}]); }
function readPreviewInspectorBoundaryFiber() { return boundaryFiber; }
function readPreviewInspectorOwnData(owner, propertyName) { return owner?.[propertyName]; }
function readPreviewInspectorFiberLink(fiber, propertyName) {
  const value = fiber?.[propertyName];
  return value !== null && typeof value === 'object' ? value : undefined;
}
function classifyPreviewInspectorFiber(fiber) { return fiber.kind ?? 'other'; }
function namePreviewInspectorFiber(fiber) { return fiber.name ?? 'Anonymous'; }
function isPreviewInspectorOwnedFiber(fiber, name) { return name.startsWith('ReactPreviewInspector('); }
globalThis.__observation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);`,
    context,
  );
  if (context.__observation === undefined) throw new Error('observation did not run');
  return JSON.parse(JSON.stringify(context.__observation)) as Observation;
}

interface ObserveOptions {
  readonly bridge?: 'marked' | 'unmarked';
  readonly outerOwners?: readonly string[];
  readonly registered?: readonly {
    readonly exportName: string;
    readonly owner: string;
    readonly sourcePath: string;
  }[];
  readonly execution?: Readonly<Record<string, string>>;
  readonly owners?: readonly string[];
  readonly root?: { readonly exportName: string; readonly sourcePath: string };
  readonly shells?: readonly unknown[];
}

/** Observes one page whose owners are mounted (nearest last) above the target boundary. */
function observe(options: ObserveOptions): Observation {
  const owners = options.owners ?? ['RootLayout', 'Providers', 'LayoutWrapper'];
  const root = options.root ?? { exportName: 'default', sourcePath: LAYOUT };
  const context: { __observation?: Observation } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
const setTimeout = () => 1;
const clearTimeout = () => undefined;
${createPreviewInspectorPageCandidateSelectionRuntimeSource()}
${createPreviewInspectorPageExecutionContextRuntimeSource()}
const previewEntryRevision = 7;
const previewInspectorSession = { interactionSequence: 0, selectedExportName: 'default' };
const root = ${JSON.stringify(root)};
const candidate = {
  complete: true,
  id: 'page-candidate',
  renderPath: {},
  root,
  stopReason: 'render-path-checkpoint',
  target: { exportName: 'default', sourcePath: '/workspace/src/app/explore/page.tsx' },
  virtualPage: { shells: ${JSON.stringify(options.shells ?? [])} },
};
const descriptor = {
  inspector: {
    executablePageCandidateId: candidate.id,
    pageExecutionCandidateId: 'page-authentic',
    pageExecutionCandidates: [{
      executionRootExportName: root.exportName,
      executionRootSourcePath: root.sourcePath,
      fidelity: 'page-authentic',
      id: 'page-authentic',
      pageRootExportName: root.exportName,
      pageRootSourcePath: root.sourcePath,
      ...${JSON.stringify(options.execution ?? {})},
    }],
    target: candidate.target,
  },
};
const state = {
  applicationPath: ['default'],
  key: 'page:default',
  pageRootCommitted: true,
  status: 'reached',
  targetDirectElementOutput: true,
  targetExportName: 'default',
  targetHasOutput: true,
  targetWasMounted: true,
};
function PreviewInspectorExecutionRootBridge() { return null; }
if (${JSON.stringify(options.bridge)} === 'marked') {
  PreviewInspectorExecutionRootBridge[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_KEY)})] = true;
}
let boundaryFiber = {};
let current = boundaryFiber;
const registeredComponents = new Map();
globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_EXECUTION_SURFACES_KEY)})] = ${JSON.stringify(options.registered ?? [])}.map((entry) => {
  const component = { $$typeof: Symbol.for('react.forward_ref'), render() { return null; } };
  registeredComponents.set(entry.owner, component);
  return { component, exportName: entry.exportName, sourcePath: entry.sourcePath };
});
const typeOf = (name) => registeredComponents.get(name) ?? function Owner() { return null; };
for (const name of ${JSON.stringify(owners)}.slice().reverse()) {
  current.return = { kind: 'function', name, type: typeOf(name) };
  current = current.return;
}
if (${JSON.stringify(options.bridge)} !== undefined) {
  current.return = {
    kind: 'function',
    name: 'PreviewInspectorExecutionRootBridge',
    type: PreviewInspectorExecutionRootBridge,
  };
  current = current.return;
}
for (const name of ${JSON.stringify(options.outerOwners ?? [])}.slice().reverse()) {
  const type = typeOf(name);
  current.return = { elementType: type, kind: 'forward-ref', name, type };
  current = current.return;
}
function readSelectedPreviewInspectorPageExecutionCandidate(value) {
  return value?.inspector?.pageExecutionCandidates?.find(
    (item) => item.id === value.inspector.pageExecutionCandidateId,
  );
}
function readPreviewInspectorTargetBoundaries() { return new Set([{}]); }
function readPreviewInspectorBoundaryFiber() { return boundaryFiber; }
function readPreviewInspectorOwnData(owner, propertyName) { return owner?.[propertyName]; }
function readPreviewInspectorFiberLink(fiber, propertyName) {
  const value = fiber?.[propertyName];
  return value !== null && typeof value === 'object' ? value : undefined;
}
function classifyPreviewInspectorFiber(fiber) { return fiber.kind ?? 'other'; }
function namePreviewInspectorFiber(fiber) { return fiber.name ?? 'Anonymous'; }
function isPreviewInspectorOwnedFiber() { return false; }
globalThis.__observation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);`,
    context,
  );
  if (context.__observation === undefined) throw new Error('observation did not run');
  return JSON.parse(JSON.stringify(context.__observation)) as Observation;
}
