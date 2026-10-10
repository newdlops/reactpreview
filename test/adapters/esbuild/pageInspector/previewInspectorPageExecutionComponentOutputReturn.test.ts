/**
 * Replays a full page blocked -> target-only reached -> full-page replay with the real webview
 * runtime and the real VS Code host selection classes. The webview session survives each artifact,
 * as it does across a VS Code hot reload when the browser import map is unchanged.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';
import { PreviewPanelInspectorSelectionController } from '../../../../src/presentation/previewPanelInspectorSelectionController';
import { PreviewPanelPageCandidateSelection } from '../../../../src/presentation/previewPanelPageCandidateSelection';

interface ReplayResult {
  readonly hostResults: readonly string[];
  readonly live: string;
  readonly needsChoice: readonly string[];
  readonly record: string | undefined;
  readonly status: string;
}

/**
 * Runs rounds until the webview stops requesting artifacts.
 *
 * @param fullPageContextComplete What the page-context observation reports for a blocked full page.
 * @param replayRecovers Whether the full page reaches the target once the recipe is replayed.
 * @param order Compiler order of the execution candidates; the failure walk follows it.
 * @param failedBuilds Executions whose host build fails after admission (`build-failed`).
 */
async function replay(
  fullPageContextComplete: boolean,
  replayRecovers: boolean,
  order: readonly string[] = ['A', 'S', 'T'],
  failedBuilds: readonly string[] = [],
): Promise<ReplayResult> {
  return (await vm.runInNewContext(
    `(async () => {
    const React = { Component: class {} };
    let previewEntryRevision = 7;
    const previewRuntimeRevision = 7;
    const Date = { now: () => 1000 };
    const candidate = { complete: true, id: 'page', root: { exportName: 'Page' },
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' } };
    let descriptor = { inspector: { executablePageCandidateId: 'page',
      pageCandidates: [candidate], target: candidate.target, pageExecutionCandidateId: 'A',
      pageExecutionCandidates: ${JSON.stringify(order)}.map((id) => ({ id,
        fidelity: { A: 'page-authentic', S: 'page-sliced', T: 'target-only' }[id],
        executionRootExportName: id === 'T' ? 'Target' : 'Page', pageRootExportName: 'Page' })) } };
    const state = { key: 'page:Target', candidateId: 'page', targetExportName: 'Target',
      targetSourcePath: '/workspace/Target.tsx', status: 'blocked', targetHasOutput: false };
    const previewInspectorSession = { interactionSequence: 0, selectedExportName: 'Target',
      selectedPageCandidateId: 'page', neuralHumanControlRevision: 0 };
    const posted = [], needsChoice = [], hostResults = [];
    const setTimeout = () => 1;
    const clearTimeout = () => undefined;
    const findSelectedPreviewInspectorDescriptor = () => descriptor;
    const readPreviewInspectorTargetReachabilityState = () => state;
    const isPreviewInspectorNeuralAssistancePaused = () => false;
    const notifyPreviewInspector = () => undefined;
    const persistPreviewInspectorState = () => undefined;
    const resetPreviewInspectorTargetReachability = () => undefined;
    const schedulePreviewInspectorCommitRefresh = () => undefined;
    const restorePreviewInspectorNeuralPageGenerationBaseline = () => true;
    const setPreviewInspectorNeuralNeedsChoiceStatus = (reason) => needsChoice.push(reason);
    const previewInspectorPostHostMessage = (message) => { posted.push(message); };
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorPageCandidateRuntimeSource()}
    readPreviewInspectorPageExecutionContextObservation = () => {
      const fidelity = readSelectedPreviewInspectorPageExecutionCandidate(descriptor)?.fidelity;
      const componentOnly = fidelity === 'target-only';
      return { componentOnly, contextComplete: !componentOnly && ${String(fullPageContextComplete)},
        fidelity, missingOwnerNames: componentOnly ? ['Page'] : [], pageCandidateComplete: true };
    };
    // PreviewPanelSession.selectInspectorPageExecutionRetry, its rollback, and a hot-reload commit.
    const controller = new HostController();
    const pageSelection = new PageSelection();
    let buildRevision = 8, displayedRevision = 7, live = 'A';
    pageSelection.applyTo({ request: {} });
    const host = () => {
      const message = posted.pop();
      if (message?.type !== 'react-preview-inspector-page-execution-retry') return undefined;
      buildRevision += 1;
      const admission = controller.beginPageCandidate({ candidateId: message.candidateId,
        interactionId: message.interactionId, runtimeRevision: message.runtimeRevision,
        type: 'react-preview-inspector-page-candidate-selected' }, buildRevision);
      admission.statuses.forEach(handlePreviewInspectorSelectionStatus);
      if (!pageSelection.beginExecutionCandidate(message.executionCandidateId, message.candidateId,
        message.restore === true)) {
        const terminal = controller.failBuild(buildRevision, 'already-active', displayedRevision);
        pageSelection.rollback();
        if (terminal.status !== undefined) handlePreviewInspectorSelectionStatus(terminal.status);
        return 'rejected ' + message.executionCandidateId;
      }
      if (message.restore !== true && ${JSON.stringify(failedBuilds)}.includes(message.executionCandidateId)) {
        const terminal = controller.failBuild(buildRevision, 'build-failed', displayedRevision);
        pageSelection.rollback();
        if (terminal.status !== undefined) handlePreviewInspectorSelectionStatus(terminal.status);
        return 'build-failed ' + message.executionCandidateId;
      }
      const applicationId = 'app-' + buildRevision;
      const bound = controller.bindPreparedApplication(buildRevision, applicationId, displayedRevision);
      if (bound.status !== undefined) handlePreviewInspectorSelectionStatus(bound.status);
      pageSelection.commit();
      descriptor = { ...descriptor, inspector: { ...descriptor.inspector,
        pageExecutionCandidateId: message.executionCandidateId } };
      previewEntryRevision += 1;
      displayedRevision = buildRevision;
      live = message.executionCandidateId;
      const committed = controller.commitApplication(applicationId, displayedRevision);
      if (committed.status !== undefined) handlePreviewInspectorSelectionStatus(committed.status);
      activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor);
      reconcilePreviewInspectorPageExecutionPreparation(descriptor);
      return (message.restore === true ? 'restored ' : 'applied ') + message.executionCandidateId;
    };
    // Reachability judges each applied artifact once; a failed host build leaves it on screen.
    let evaluatedRevision;
    for (let round = 1; round <= 10; round += 1) {
      if (evaluatedRevision === previewEntryRevision) {
        // The same artifact is still displayed: only already scheduled work may continue.
      } else if (live === 'T') {
        state.status = 'reached'; state.targetHasOutput = true;
        requestPreviewInspectorNeuralPageExecutionContextRecovery(descriptor, candidate, state,
          { fingerprint: 'target-only-success' });
      } else if (live === 'A' && round > 1 && ${String(replayRecovers)}) {
        state.status = 'reached'; state.targetHasOutput = true;
      } else {
        state.status = 'blocked'; state.targetHasOutput = false;
        requestPreviewInspectorPageExecutionRetry(descriptor, candidate);
      }
      evaluatedRevision = previewEntryRevision;
      await Promise.resolve(); await Promise.resolve();
      const result = host();
      if (result === undefined) break;
      hostResults.push(result);
      await Promise.resolve(); await Promise.resolve();
    }
    const record = readPreviewInspectorPageExecutionContextRecoveryRecord(state);
    return { hostResults, live, needsChoice, record: record?.status, status: state.status };
  })()`,
    {
      HostController: PreviewPanelInspectorSelectionController,
      PageSelection: PreviewPanelPageCandidateSelection,
    },
    { timeout: 5_000 },
  )) as ReplayResult;
}

describe('page execution component output return', () => {
  /** The recipe replay is still tried; when it fails again the verified component output returns. */
  it.each([true, false])(
    'returns to target-only after the full-page replay fails (full-page context observed: %s)',
    async (fullPageContextComplete) => {
      expect(await replay(fullPageContextComplete, false)).toEqual({
        hostResults: ['applied S', 'applied T', 'applied A', 'rejected S', 'restored T'],
        live: 'T',
        needsChoice: [
          'page-execution-preparation-already-active',
          'full-page-context-paths-exhausted',
        ],
        record: 'exhausted',
        status: 'page-context-incomplete',
      });
    },
  );

  /** A retryable host build failure of the next full page cannot strand the failed replay either. */
  it.each([true, false])(
    'returns to target-only when the next full-page build fails (full-page context observed: %s)',
    async (fullPageContextComplete) => {
      expect(await replay(fullPageContextComplete, false, ['A', 'T', 'S'], ['S'])).toEqual({
        hostResults: ['applied T', 'applied A', 'build-failed S', 'restored T'],
        live: 'T',
        needsChoice: [
          'page-execution-preparation-build-failed',
          'full-page-context-paths-exhausted',
        ],
        record: 'exhausted',
        status: 'page-context-incomplete',
      });
    },
  );

  it('keeps the full page when the replayed recipe reaches the target there', async () => {
    expect(await replay(true, true)).toEqual({
      hostResults: ['applied S', 'applied T', 'applied A'],
      live: 'A',
      needsChoice: [],
      record: 'verifying',
      status: 'reached',
    });
  });
});
