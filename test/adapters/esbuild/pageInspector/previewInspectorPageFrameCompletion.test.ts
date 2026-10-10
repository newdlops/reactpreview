/** Prevents inner component output from closing an incomplete authored-page recovery corridor. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageExecutionContextRuntimeSource';
import { createPreviewInspectorNeuralAssistanceAutomationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceAutomationRuntimeSource';

/** Runs the production verifier and admission guard against a bounded, controlled Fiber corridor. */
function evaluate(body: string): unknown {
  return vm.runInNewContext(
    `
    ${createPreviewInspectorPageExecutionContextRuntimeSource()}
    ${createPreviewInspectorNeuralAssistanceAutomationRuntimeSource()}
    const previewEntryRevision = 1;
    const previewInspectorSession = { selectedExportName: 'Target', selectedPageCandidateId: 'page' };
    let paused = false, scans = 0, reads = 0;
    let owners = ['InnerPage'];
    const candidate = {
      id: 'page', complete: true,
      root: { exportName: 'InnerPage', sourcePath: '/workspace/InnerPage.tsx' },
      rootStepIndex: 0,
      renderPath: { entryPoint: {}, steps: [{ label: 'InnerPage', sourcePath: '/workspace/InnerPage.tsx' }] },
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
      virtualPage: { mode: 'static-page-checkpoint', shells: [] },
    };
    const execution = {
      id: 'execution', fidelity: 'page-authentic', pageRootExportName: 'InnerPage',
      pageRootSourcePath: '/workspace/InnerPage.tsx',
      executionRootExportName: 'InnerPage', ownsGeneratedRouter: true,
    };
    const descriptor = { inspector: { pageExecutionCandidates: [execution] } };
    const state = {
      key: 'page:Target', candidateId: 'page', targetExportName: 'Target',
      status: 'reached', pageRootCommitted: true, targetHasOutput: true,
      targetMounted: true, targetDirectElementOutput: true,
      applicationPath: ['OuterPage', 'InnerPage', 'Target'],
    };
    function readSelectedPreviewInspectorPageExecutionCandidate() { return execution; }
    function readSelectedPreviewInspectorPageCandidate() { return candidate; }
    function findSelectedPreviewInspectorDescriptor() { return descriptor; }
    function readPreviewInspectorTargetBoundaries() { scans++; return new Set([{}]); }
    function readPreviewInspectorBoundaryFiber() {
      return { return: owners.reduce((parent, name) => ({ name, return: parent }), undefined) };
    }
    function readPreviewInspectorFiberLink(fiber, key) { return fiber?.[key]; }
    function classifyPreviewInspectorFiber() { return 'function'; }
    function namePreviewInspectorFiber(fiber) { return fiber.name; }
    function isPreviewInspectorOwnedFiber() { return false; }
    function isPreviewInspectorNeuralAssistancePaused() { return paused; }
    function readPreviewInspectorNeuralAssistanceReachability() { reads++; return state; }
    function readPreviewInspectorNeuralAssistanceBlockers() { return { active: [] }; }
    function isPreviewInspectorNeuralSuccessCollectionSettled() { return true; }
    function observation() {
      return readPreviewInspectorPageExecutionContextObservation(descriptor, candidate, state);
    }
    ${body}
  `,
    {},
    { timeout: 5_000 },
  );
}

describe('page frame completion', () => {
  it.each(['InnerPageSkeleton', 'ArchivedInnerPage', 'Memo(ArchivedInnerPage)'])(
    'does not accept a similarly named %s as the page owner',
    (name) => {
      expect(evaluate(`owners = ['${name}']; observation().contextComplete;`)).toBe(false);
    },
  );

  it('keeps explicit HOC page owners and frame aliases executable', () => {
    expect(
      evaluate(`
        candidate.virtualPage.shells = [{ relation: 'wrapper', root: { exportName: 'PatientLayout' } }];
        owners = ['Memo(PatientLayout)', 'withRouter(InnerPage)'];
        observation().contextComplete;
      `),
    ).toBe(true);
  });

  it('does not accept an inner candidate alias for a different execution page root', () => {
    expect(
      evaluate(`
      execution.pageRootExportName = 'OuterPage';
      execution.pageRootSourcePath = '/workspace/OuterPage.tsx';
      const result = observation();
      ({ complete: result.contextComplete, roots: result.pageRootNames, observed: result.pageRootObserved });
    `),
    ).toEqual({ complete: false, roots: ['OuterPage'], observed: false });
  });

  it('does not accept a stale render-path step from another source as the live page', () => {
    expect(
      evaluate(`
      candidate.renderPath.steps[0] = { label: 'TableContainer', sourcePath: '/workspace/TableContainer.tsx' };
      owners = ['TableContainer'];
      observation().contextComplete;
    `),
    ).toBe(false);
  });

  it('does not mix two named page exports in the same source file', () => {
    expect(
      evaluate(`
      execution.pageRootExportName = 'OuterPage';
      execution.pageRootSourcePath = candidate.root.sourcePath;
      const result = observation();
      ({ complete: result.contextComplete, roots: result.pageRootNames });
    `),
    ).toEqual({ complete: false, roots: ['OuterPage'] });
  });

  it.each(['owner', 'wrapper'])('requires a proven %s frame above the target', (relation) => {
    expect(
      evaluate(`
      candidate.virtualPage.shells = [{ relation: '${relation}', root: {
        exportName: 'default', sourcePath: '/workspace/PatientLayout.tsx',
      } }];
      const result = observation();
      ({ complete: result.contextComplete, frame: result.pageFrameObserved, missing: result.missingOwnerNames });
    `),
    ).toEqual({ complete: false, frame: false, missing: ['PatientLayout', 'OuterPage'] });
  });

  it('accepts the actual frame without requiring entry bootstraps or sibling ancestors', () => {
    expect(
      evaluate(`
      candidate.virtualPage.shells = [
        { relation: 'wrapper', root: { exportName: 'PublicLayout', sourcePath: '/workspace/PatientLayout.tsx' } },
        { relation: 'sibling', root: { exportName: 'Header', sourcePath: '/workspace/Header.tsx' } },
      ];
      owners = ['PatientLayout', 'InnerPage'];
      observation().contextComplete;
    `),
    ).toBe(true);
  });

  it.each(['target-contextual', 'target-only'])(
    'never treats %s output as an authored page',
    (fidelity) => {
      expect(evaluate(`execution.fidelity = '${fidelity}'; observation().contextComplete;`)).toBe(
        false,
      );
    },
  );

  /** An App rendered by its entry is the page root: its target-only execution is the whole page. */
  it('accepts a target that is its own entry-rendered page root', () => {
    expect(
      evaluate(`
      candidate.root = { exportName: 'Target', sourcePath: '/workspace/Target.tsx' };
      Object.assign(execution, { fidelity: 'target-only', executionRootSurfaceId: 'target:app',
        runtimeTargetSurfaceId: 'target:app' });
      owners = [];
      const app = observation();
      // A standalone export (no entry consumer) and a framed page still need their owners.
      execution.standaloneTarget = true;
      const standalone = observation().contextComplete;
      execution.standaloneTarget = false;
      candidate.virtualPage.shells = [{ relation: 'wrapper', root: { exportName: 'Layout' } }];
      const framed = observation().contextComplete;
      ({ complete: app.contextComplete, pageRoot: app.targetIsPageRoot, standalone, framed });
    `),
    ).toEqual({ complete: true, framed: false, pageRoot: true, standalone: false });
  });

  it('keeps recovering missing page context despite a stale reached/settled flag', () => {
    expect(
      evaluate(`
      execution.pageRootSourcePath = '/workspace/OuterPage.tsx';
      execution.pageRootExportName = 'OuterPage';
      readPreviewInspectorAutomaticNeuralAssistanceCorridor() === state;
    `),
    ).toBe(true);
  });

  it('leaves a complete page settled', () => {
    expect(evaluate('readPreviewInspectorAutomaticNeuralAssistanceCorridor();')).toBeUndefined();
  });

  it('preserves explicit direct-component mode without checking page owners', () => {
    expect(
      evaluate(`
      state.directTarget = true;
      const corridor = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
      ({ complete: hasPreviewInspectorCompletePageExecutionContext(state), stopped: corridor === undefined, scans });
    `),
    ).toEqual({ complete: true, stopped: true, scans: 0 });
  });

  it('does not inspect or start a page recovery while the user has paused', () => {
    expect(
      evaluate(`
      paused = true;
      const corridor = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
      const requested = requestPreviewInspectorNeuralPageExecutionContextRecovery(descriptor, candidate, state, {});
      ({ stopped: corridor === undefined, requested, scans, reads });
    `),
    ).toEqual({ stopped: true, requested: false, scans: 0, reads: 0 });
  });
});
