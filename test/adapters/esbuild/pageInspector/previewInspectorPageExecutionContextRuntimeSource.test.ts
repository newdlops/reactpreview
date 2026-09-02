/** Verifies full-page owner recovery independently from React and project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageExecutionContextRuntimeSource';

describe('Preview Inspector page execution context runtime source', () => {
  it('recovers component-only output through a full-page execution candidate', () => {
    expect(evaluatePageExecutionContextRecovery()).toEqual({
      checkpoint: {
        contextComplete: false,
        pageCandidateComplete: false,
        pageRootObserved: true,
      },
      full: {
        componentOnly: false,
        contextComplete: true,
        executionRootObserved: true,
        fidelity: 'page-authentic',
        pageRootObserved: true,
      },
      frameworkPage: {
        contextComplete: true,
        pageCandidateCompilerComplete: false,
        pageCandidateComplete: true,
      },
      generatedRouteForm: {
        contextComplete: false,
        generatedRouteContextObserved: true,
        pageRootObserved: false,
        transientTarget: false,
      },
      generatedRouteOwnerForm: {
        contextComplete: true,
        generatedRouteContextObserved: true,
        pageRootObserved: true,
      },
      partial: {
        componentOnly: true,
        contextComplete: false,
        fidelity: 'target-contextual',
        missingOwnerNames: [
          'ExplorePage',
          'ExplorePageCarousel',
          'Sheet',
          'SheetContent',
          'DetailBottomSheetContent',
        ],
        pageRootObserved: false,
      },
      postedExecutionCandidateId: 'execution-page-authentic',
      recoveryRequested: true,
      recoveryStatus: 'verifying',
      stateStatus: 'recovering-page-context',
      transientGeneratedRoute: {
        contextComplete: false,
        generatedRouteContextObserved: false,
        pageRootObserved: false,
        transientTarget: true,
      },
      transitionPendingAfterActivation: false,
      transitionPendingBeforeActivation: true,
    });
  });

  /** Prevents a missed deferred activation from leaving the committed artifact pending forever. */
  it('reconciles a committed incomplete candidate when deferred activation loses its race', () => {
    expect(evaluateCurrentPageExecutionSelection()).toEqual({
      attemptedExecutionCandidateIds: ['execution-page-authentic', 'execution-page-sliced'],
      postedExecutionCandidateId: 'execution-page-sliced',
      recoveryStatus: 'exhausted',
      repeatedExecutionCandidate: false,
      transitionPending: false,
    });
  });
});

/** Executes the page-context observation and recovery selector against a synthetic Fiber chain. */
function evaluatePageExecutionContextRecovery(): {
  readonly checkpoint: {
    readonly contextComplete: boolean;
    readonly pageCandidateComplete: boolean;
    readonly pageRootObserved: boolean;
  };
  readonly full: {
    readonly componentOnly: boolean;
    readonly contextComplete: boolean;
    readonly executionRootObserved: boolean;
    readonly fidelity: string;
    readonly pageRootObserved: boolean;
  };
  readonly frameworkPage: {
    readonly contextComplete: boolean;
    readonly pageCandidateCompilerComplete: boolean;
    readonly pageCandidateComplete: boolean;
  };
  readonly generatedRouteForm: {
    readonly contextComplete: boolean;
    readonly generatedRouteContextObserved: boolean;
    readonly pageRootObserved: boolean;
    readonly transientTarget: boolean;
  };
  readonly generatedRouteOwnerForm: {
    readonly contextComplete: boolean;
    readonly generatedRouteContextObserved: boolean;
    readonly pageRootObserved: boolean;
  };
  readonly partial: {
    readonly componentOnly: boolean;
    readonly contextComplete: boolean;
    readonly fidelity: string;
    readonly missingOwnerNames: readonly string[];
    readonly pageRootObserved: boolean;
  };
  readonly postedExecutionCandidateId: string;
  readonly recoveryRequested: boolean;
  readonly recoveryStatus: string;
  readonly stateStatus: string;
  readonly transientGeneratedRoute: {
    readonly contextComplete: boolean;
    readonly generatedRouteContextObserved: boolean;
    readonly pageRootObserved: boolean;
    readonly transientTarget: boolean;
  };
  readonly transitionPendingAfterActivation: boolean;
  readonly transitionPendingBeforeActivation: boolean;
} {
  const context: {
    __result?: ReturnType<typeof evaluatePageExecutionContextRecovery>;
  } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageExecutionContextRuntimeSource()}
const previewEntryRevision = 7;
function hashPreviewInspectorNeuralPageContextCandidateId(value) {
  return String(value).length * 2654435761 >>> 0;
}
function readPreviewInspectorHostRuntimeRevision() { return 7; }
function readSelectedPreviewInspectorPageExecutionCandidate(value) {
  return value?.inspector?.pageExecutionCandidates?.find(
    (item) => item.id === value.inspector.pageExecutionCandidateId,
  );
}
const applicationPath = [
  'ExplorePage',
  'ExplorePageCarousel',
  'Sheet',
  'SheetContent',
  'DetailBottomSheetContent',
  'DetailBottomSheetSkeleton',
  'Skeleton',
];
const candidate = {
  complete: true,
  id: 'page-candidate',
  renderPath: {},
  root: { exportName: 'ExplorePage', sourcePath: '/workspace/ExplorePage.tsx' },
  stopReason: 'root-reached',
  target: { exportName: 'Skeleton', sourcePath: '/workspace/Skeleton.tsx' },
};
const descriptor = {
  displayName: 'Skeleton.tsx',
  inspector: {
    executablePageCandidateId: candidate.id,
    pageExecutionCandidateId: 'execution-contextual',
    pageExecutionCandidates: [
      {
        authoredOwnerDepth: 7,
        executionRootExportName: 'ExplorePage',
        fidelity: 'page-authentic',
        id: 'execution-page-authentic',
        nestedMountCount: 1,
        ownsGeneratedRouter: true,
        pageRootExportName: 'ExplorePage',
        targetRole: 'element',
      },
      {
        authoredOwnerDepth: 7,
        executionRootExportName: 'DetailBottomSheetSkeleton',
        fidelity: 'target-contextual',
        id: 'execution-contextual',
        nestedMountCount: 0,
        pageRootExportName: 'ExplorePage',
      },
    ],
    target: candidate.target,
  },
};
const state = {
  applicationPath,
  key: 'page-candidate:Skeleton',
  pageRootCommitted: true,
  status: 'reached',
  targetDirectElementOutput: true,
  targetExportName: 'Skeleton',
  targetHasOutput: true,
  targetWasMounted: true,
};
const previewInspectorSession = {
  interactionSequence: 0,
  selectedExportName: 'Skeleton',
  selectedPageCandidateId: candidate.id,
};
let posted;
let boundaryFiber = {
  return: {
    kind: 'function',
    name: 'DetailBottomSheetSkeleton',
  },
};
function readPreviewInspectorTargetBoundaries() { return new Set([{}]); }
function readPreviewInspectorBoundaryFiber() { return boundaryFiber; }
function readPreviewInspectorFiberLink(fiber, propertyName) { return fiber?.[propertyName]; }
function classifyPreviewInspectorFiber(fiber) { return fiber.kind ?? 'other'; }
function namePreviewInspectorFiber(fiber) { return fiber.name ?? 'Anonymous'; }
function isPreviewInspectorOwnedFiber() { return false; }
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function readSelectedPreviewInspectorPageCandidate() { return candidate; }
function previewInspectorPostHostMessage(message) { posted = message; }
const partialObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
const recoveryRequested = requestPreviewInspectorNeuralPageExecutionContextRecovery(
  descriptor,
  candidate,
  state,
  { fingerprint: 'component-repair-recipe' },
);
const recoveryRecord = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
const transitionPendingBeforeActivation =
  isPreviewInspectorNeuralPageExecutionContextTransitionPending(state);
descriptor.inspector.pageExecutionCandidateId = 'execution-page-authentic';
activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor);
const transitionPendingAfterActivation =
  isPreviewInspectorNeuralPageExecutionContextTransitionPending(state);
boundaryFiber = {
  return: {
    kind: 'function',
    name: 'DetailBottomSheetSkeleton',
    return: {
      kind: 'function',
      name: 'DetailBottomSheetContent',
      return: {
        kind: 'function',
        name: 'SheetContent',
        return: {
          kind: 'function',
          name: 'Sheet',
          return: {
            kind: 'function',
            name: 'ExplorePageCarousel',
            return: { kind: 'function', name: 'ExplorePage' },
          },
        },
      },
    },
  },
};
const fullObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
candidate.complete = false;
candidate.stopReason = 'render-path-checkpoint';
const checkpointObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
candidate.routeLocation = { evidenceKind: 'next-app-filesystem', pathname: '/explore' };
candidate.virtualPage = { mode: 'next-app-filesystem' };
const frameworkPageObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
candidate.routeLocation = { evidenceKind: 'route-jsx', pathname: '/appointments' };
candidate.virtualPage = { mode: 'static-page-checkpoint' };
candidate.renderPath = { entryPoint: { kind: 'legacy-render' } };
candidate.target = {
  exportName: 'default',
  sourcePath: '/workspace/AppointmentDetailForm.tsx',
};
candidate.root = {
  exportName: 'default',
  sourcePath: '/workspace/HospitalRun.tsx',
};
descriptor.displayName = 'AppointmentDetailForm.tsx';
descriptor.inspector.target = candidate.target;
descriptor.inspector.pageExecutionCandidates[0].executionRootExportName = 'default';
descriptor.inspector.pageExecutionCandidates[0].executionRootSourcePath =
  '/workspace/HospitalRun.tsx';
descriptor.inspector.pageExecutionCandidates[0].pageRootExportName = 'default';
descriptor.inspector.pageExecutionCandidates[0].pageRootSourcePath = '/workspace/HospitalRun.tsx';
state.applicationPath = [
  'App',
  'HospitalRun',
  'Appointments',
  'EditAppointment',
  'AppointmentDetailForm (default)',
  'default',
];
state.targetExportName = 'default';
boundaryFiber = {
  return: { kind: 'function', name: 'AppointmentDetailForm' },
};
const generatedRouteFormObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
boundaryFiber = {
  return: {
    kind: 'function',
    name: 'AppointmentDetailForm',
    return: { kind: 'function', name: 'HospitalRun' },
  },
};
const generatedRouteOwnerFormObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
candidate.target = {
  exportName: 'default',
  sourcePath: '/workspace/DetailBottomSheetSkeleton.tsx',
};
descriptor.displayName = 'DetailBottomSheetSkeleton.tsx';
descriptor.inspector.target = candidate.target;
state.applicationPath = [
  'ExplorePage',
  'DetailBottomSheetSkeleton',
  'default',
];
boundaryFiber = {
  return: { kind: 'function', name: 'DetailBottomSheetSkeleton' },
};
const transientGeneratedRouteObservation = readPreviewInspectorPageExecutionContextObservation(
  descriptor,
  candidate,
  state,
);
globalThis.__result = {
  checkpoint: {
    contextComplete: checkpointObservation.contextComplete,
    pageCandidateComplete: checkpointObservation.pageCandidateComplete,
    pageRootObserved: checkpointObservation.pageRootObserved,
  },
  full: {
    componentOnly: fullObservation.componentOnly,
    contextComplete: fullObservation.contextComplete,
    executionRootObserved: fullObservation.executionRootObserved,
    fidelity: fullObservation.fidelity,
    pageRootObserved: fullObservation.pageRootObserved,
  },
  frameworkPage: {
    contextComplete: frameworkPageObservation.contextComplete,
    pageCandidateCompilerComplete: frameworkPageObservation.pageCandidateCompilerComplete,
    pageCandidateComplete: frameworkPageObservation.pageCandidateComplete,
  },
  generatedRouteForm: {
    contextComplete: generatedRouteFormObservation.contextComplete,
    generatedRouteContextObserved:
      generatedRouteFormObservation.generatedRouteContextObserved,
    pageRootObserved: generatedRouteFormObservation.pageRootObserved,
    transientTarget: generatedRouteFormObservation.transientTarget,
  },
  generatedRouteOwnerForm: {
    contextComplete: generatedRouteOwnerFormObservation.contextComplete,
    generatedRouteContextObserved:
      generatedRouteOwnerFormObservation.generatedRouteContextObserved,
    pageRootObserved: generatedRouteOwnerFormObservation.pageRootObserved,
  },
  partial: {
    componentOnly: partialObservation.componentOnly,
    contextComplete: partialObservation.contextComplete,
    fidelity: partialObservation.fidelity,
    missingOwnerNames: partialObservation.missingOwnerNames,
    pageRootObserved: partialObservation.pageRootObserved,
  },
  postedExecutionCandidateId: posted.executionCandidateId,
  recoveryRequested,
  recoveryStatus: recoveryRecord.status,
  stateStatus: state.status,
  transientGeneratedRoute: {
    contextComplete: transientGeneratedRouteObservation.contextComplete,
    generatedRouteContextObserved:
      transientGeneratedRouteObservation.generatedRouteContextObserved,
    pageRootObserved: transientGeneratedRouteObservation.pageRootObserved,
    transientTarget: transientGeneratedRouteObservation.transientTarget,
  },
  transitionPendingAfterActivation,
  transitionPendingBeforeActivation,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Page execution context recovery fixture did not expose its result.');
  }
  return context.__result;
}

/** Executes recovery when the initial compiler choice is already a full-page artifact. */
function evaluateCurrentPageExecutionSelection(): {
  readonly attemptedExecutionCandidateIds: readonly string[];
  readonly postedExecutionCandidateId: string;
  readonly recoveryStatus: string;
  readonly repeatedExecutionCandidate: boolean;
  readonly transitionPending: boolean;
} {
  const context: {
    __result?: ReturnType<typeof evaluateCurrentPageExecutionSelection>;
  } = {};
  vm.runInNewContext(
    `const React = { Component: class {} };
${createPreviewInspectorPageExecutionContextRuntimeSource()}
const previewEntryRevision = 3;
function hashPreviewInspectorNeuralPageContextCandidateId(value) {
  return String(value).length * 2654435761 >>> 0;
}
function readPreviewInspectorHostRuntimeRevision() { return 3; }
function readSelectedPreviewInspectorPageExecutionCandidate(value) {
  return value?.inspector?.pageExecutionCandidates?.find(
    (item) => item.id === value.inspector.pageExecutionCandidateId,
  );
}
const candidate = {
  complete: true,
  id: 'page-candidate',
  renderPath: {},
  root: { exportName: 'PageRoot', sourcePath: '/workspace/PageRoot.tsx' },
  target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
};
const descriptor = {
  displayName: 'Target.tsx',
  inspector: {
    executablePageCandidateId: candidate.id,
    pageExecutionCandidateId: 'execution-page-authentic',
    pageExecutionCandidates: [
      {
        authoredOwnerDepth: 2,
        executionRootExportName: 'PageRoot',
        fidelity: 'page-authentic',
        id: 'execution-page-authentic',
        nestedMountCount: 0,
        pageRootExportName: 'PageRoot',
      },
      {
        authoredOwnerDepth: 2,
        executionRootExportName: 'PageRoot',
        fidelity: 'page-sliced',
        id: 'execution-page-sliced',
        nestedMountCount: 0,
        pageRootExportName: 'PageRoot',
      },
    ],
    target: candidate.target,
  },
};
const state = {
  applicationPath: ['PageRoot', 'Target'],
  key: 'page-candidate:Target',
  pageRootCommitted: true,
  status: 'reached',
  targetDirectElementOutput: true,
  targetExportName: 'Target',
  targetHasOutput: true,
  targetWasMounted: true,
};
const previewInspectorSession = {
  interactionSequence: 0,
  selectedExportName: 'Target',
  selectedPageCandidateId: candidate.id,
};
let posted;
function readPreviewInspectorTargetBoundaries() { return new Set([{}]); }
function readPreviewInspectorBoundaryFiber() {
  return { return: { kind: 'function', name: 'Target' } };
}
function readPreviewInspectorFiberLink(fiber, propertyName) { return fiber?.[propertyName]; }
function classifyPreviewInspectorFiber(fiber) { return fiber.kind ?? 'other'; }
function namePreviewInspectorFiber(fiber) { return fiber.name ?? 'Anonymous'; }
function isPreviewInspectorOwnedFiber() { return false; }
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function previewInspectorPostHostMessage(message) { posted = message; }
requestPreviewInspectorNeuralPageExecutionContextRecovery(
  descriptor,
  candidate,
  state,
  { fingerprint: 'current-page-recipe' },
);
const postedExecutionCandidateId = posted.executionCandidateId;
descriptor.inspector.pageExecutionCandidateId = postedExecutionCandidateId;
posted = undefined;
requestPreviewInspectorNeuralPageExecutionContextRecovery(
  descriptor,
  candidate,
  state,
  { fingerprint: 'current-page-recipe' },
);
const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
globalThis.__result = {
  attemptedExecutionCandidateIds: [...record.attemptedExecutionCandidateIds].sort(),
  postedExecutionCandidateId,
  recoveryStatus: record.status,
  repeatedExecutionCandidate: posted !== undefined,
  transitionPending: isPreviewInspectorNeuralPageExecutionContextTransitionPending(state),
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Current Page Execution recovery fixture did not expose its result.');
  }
  return context.__result;
}
