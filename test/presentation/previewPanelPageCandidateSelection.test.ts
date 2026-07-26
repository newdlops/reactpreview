import { describe, expect, it } from 'vitest';
import { PreviewPanelPageCandidateSelection } from '../../src/presentation/previewPanelPageCandidateSelection';

describe('PreviewPanelPageCandidateSelection', () => {
  it('commits one host-owned inner execution retry without changing the browser page candidate', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;

    expect(selection.begin('page-a')).toBe(true);
    selection.commit();
    expect(selection.beginExecutionCandidate('execution-inner')).toBe(true);
    expect(selection.applyTo(target).request).toMatchObject({
      inspectorPageCandidateId: 'page-a',
      inspectorPageExecutionCandidateId: 'execution-inner',
    });

    selection.commit();
    expect(selection.current()).toBe('page-a');
    expect(selection.currentExecutionCandidate()).toBe('execution-inner');
    expect(selection.applyTo(target).request.inspectorPageCandidateId).toBe('page-a');
  });

  it('rolls back an inner execution retry while retaining the previously applied request', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;

    selection.begin('page-a');
    selection.commit();
    selection.beginExecutionCandidate('execution-inner');
    selection.rollback();

    expect(selection.applyTo(target).request).toMatchObject({
      inspectorPageCandidateId: 'page-a',
    });
    expect(selection.currentExecutionCandidate()).toBeUndefined();
  });
});
