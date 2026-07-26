import { describe, expect, it } from 'vitest';
import { readPreviewInspectorPageExecutionRetryRequest } from '../../src/presentation/previewInspectorPageExecutionRetryProtocol';

describe('readPreviewInspectorPageExecutionRetryRequest', () => {
  it('accepts one bounded opaque retry request', () => {
    expect(
      readPreviewInspectorPageExecutionRetryRequest({
        candidateId: 'page-a',
        executionCandidateId: 'execution-inner',
        interactionId: 'execution:7:1',
        runtimeRevision: 7,
        type: 'react-preview-inspector-page-execution-retry',
      }),
    ).toEqual({
      candidateId: 'page-a',
      executionCandidateId: 'execution-inner',
      interactionId: 'execution:7:1',
      runtimeRevision: 7,
      type: 'react-preview-inspector-page-execution-retry',
    });
  });

  it('rejects paths and non-execution interaction ids', () => {
    expect(
      readPreviewInspectorPageExecutionRetryRequest({
        candidateId: '/workspace/Page.tsx',
        executionCandidateId: 'execution-inner',
        interactionId: 'page:7:1',
        runtimeRevision: 7,
        type: 'react-preview-inspector-page-execution-retry',
      }),
    ).toBeUndefined();
  });
});
