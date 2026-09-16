import { describe, expect, it } from 'vitest';
import { PreviewPanelPageCandidateSelection } from '../../src/presentation/previewPanelPageCandidateSelection';

describe('PreviewPanelPageCandidateSelection', () => {
  it('seeds the automatic page candidate when its first execution retry comes from the runtime', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;

    expect(selection.beginExecutionCandidate('execution-sliced', 'page-auto')).toBe(true);
    expect(selection.applyTo(target).request).toMatchObject({
      inspectorPageCandidateId: 'page-auto',
      inspectorPageExecutionCandidateId: 'execution-sliced',
    });

    selection.commit();
    expect(selection.current()).toBe('page-auto');
    expect(selection.currentExecutionCandidate()).toBe('execution-sliced');
    expect(selection.beginExecutionCandidate('execution-target', 'page-other')).toBe(false);
  });

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

  it('rejects an A-to-B-to-A cycle after browser replacement and selection commits', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;
    for (const executionId of ['execution-a', 'execution-b']) {
      expect(selection.beginExecutionCandidate(executionId, 'page-auto')).toBe(true);
      // A selection rebuild resolves a fresh request before replacing the webview document.
      selection.applyTo(target);
      selection.applyTo(target);
      selection.commit();
    }

    expect(selection.beginExecutionCandidate('execution-a', 'page-auto')).toBe(false);
    expect(selection.currentExecutionCandidate()).toBe('execution-b');
  });

  it('remembers failed preparations without preventing an untried alternative', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    expect(selection.beginExecutionCandidate('execution-a', 'page-auto')).toBe(true);
    selection.rollback();

    expect(selection.beginExecutionCandidate('execution-a', 'page-auto')).toBe(false);
    expect(selection.beginExecutionCandidate('execution-b', 'page-auto')).toBe(true);
  });

  it('starts a fresh recovery frontier for an ordinary source or manual refresh', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;
    for (const executionId of ['execution-a', 'execution-b']) {
      selection.beginExecutionCandidate(executionId, 'page-auto');
      selection.applyTo(target);
      selection.commit();
    }
    expect(selection.beginExecutionCandidate('execution-a', 'page-auto')).toBe(false);

    // No Inspector transaction is pending when the host prepares a normal input refresh.
    expect(selection.applyTo(target).request.inspectorPageExecutionCandidateId).toBe('execution-b');
    expect(selection.beginExecutionCandidate('execution-a', 'page-auto')).toBe(true);
  });

  it('keeps per-page identities without forgetting attempts when public candidates change', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;
    for (const candidateId of ['page-a', 'page-b']) {
      expect(selection.begin(candidateId)).toBe(true);
      selection.applyTo(target);
      selection.commit();
      expect(selection.beginExecutionCandidate('execution', candidateId)).toBe(true);
      selection.applyTo(target);
      selection.commit();
    }
    expect(selection.begin('page-a')).toBe(true);
    selection.applyTo(target);
    selection.commit();
    expect(selection.beginExecutionCandidate('execution', 'page-a')).toBe(false);
  });

  it('bounds novel identities without eviction or blocking manual page changes', () => {
    const selection = new PreviewPanelPageCandidateSelection();
    const target = { request: { documentPath: '/workspace/Target.tsx' } } as never;
    for (let index = 0; index < 12; index += 1) {
      expect(selection.beginExecutionCandidate(`execution-${String(index)}`, 'page-auto')).toBe(
        true,
      );
      selection.applyTo(target);
      selection.commit();
    }

    expect(selection.beginExecutionCandidate('execution-12', 'page-auto')).toBe(false);
    expect(selection.beginExecutionCandidate('execution-0', 'page-auto')).toBe(false);
    expect(selection.begin('page-manual')).toBe(true);
    selection.applyTo(target);
    selection.commit();
    expect(selection.beginExecutionCandidate('execution-new', 'page-manual')).toBe(false);

    selection.clear();
    expect(selection.beginExecutionCandidate('execution-0', 'page-auto')).toBe(true);
  });

  it('does not share attempts across independent preview panels', () => {
    const first = new PreviewPanelPageCandidateSelection();
    const second = new PreviewPanelPageCandidateSelection();
    expect(first.beginExecutionCandidate('execution-a', 'page-auto')).toBe(true);
    first.rollback();
    expect(second.beginExecutionCandidate('execution-a', 'page-auto')).toBe(true);
    expect(first.beginExecutionCandidate('execution-a', 'page-auto')).toBe(false);
  });
});
