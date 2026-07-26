import { describe, expect, it } from 'vitest';
import { PreviewPanelInspectorSelectionController } from '../../src/presentation/previewPanelInspectorSelectionController';

describe('PreviewPanelInspectorSelectionController', () => {
  it('commits a route only after its exact bound browser application applies', () => {
    const controller = new PreviewPanelInspectorSelectionController();
    const request = {
      branchId: 'route-0123456789abcdef0123',
      interactionId: 'route:7:1',
      runtimeRevision: 7,
      selectionPath: [],
      type: 'react-preview-inspector-route-selected' as const,
    };

    expect(controller.beginRoute(request, 8)).toMatchObject({ accepted: true, shouldBuild: true });
    expect(controller.bindPreparedApplication(8, 'application:8', 7).accepted).toBe(true);
    expect(controller.commitApplication('application:other', 8)).toEqual({ committed: false });
    expect(controller.commitApplication('application:8', 8)).toMatchObject({
      committed: true,
      status: { interactionId: 'route:7:1', status: 'committed' },
    });
  });

  it('keeps a retained browser failure terminal and does not admit a second build for its replay', () => {
    const controller = new PreviewPanelInspectorSelectionController();
    const request = {
      candidateId: 'page:settings',
      interactionId: 'page:3:1',
      runtimeRevision: 3,
      type: 'react-preview-inspector-page-candidate-selected' as const,
    };

    controller.beginPageCandidate(request, 4);
    controller.bindPreparedApplication(4, 'application:4', 3);
    expect(controller.failApplication('application:4', 'hot-reload-retained', 3)).toMatchObject({
      committed: false,
      status: { reason: 'hot-reload-retained', status: 'failed' },
    });
    expect(controller.beginPageCandidate(request, 5)).toMatchObject({
      accepted: false,
      shouldBuild: false,
      statuses: [{ reason: 'hot-reload-retained', status: 'failed' }],
    });
  });

  it('rejects competing interactions as busy without replacing the live transaction', () => {
    const controller = new PreviewPanelInspectorSelectionController();
    controller.beginRoute(
      {
        branchId: 'route-0123456789abcdef0123',
        interactionId: 'route:1:1',
        runtimeRevision: 1,
        selectionPath: [],
        type: 'react-preview-inspector-route-selected',
      },
      2,
    );

    expect(
      controller.beginPageCandidate(
        {
          candidateId: 'page:other',
          interactionId: 'page:1:2',
          runtimeRevision: 1,
          type: 'react-preview-inspector-page-candidate-selected',
        },
        3,
      ),
    ).toMatchObject({ accepted: false, shouldBuild: false, statuses: [{ reason: 'busy' }] });
    expect(controller.currentInteractionId()).toBe('route:1:1');
  });
});
