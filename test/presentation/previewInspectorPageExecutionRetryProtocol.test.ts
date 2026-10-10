import { describe, expect, it } from 'vitest';
import { readPreviewInspectorPageExecutionRetryRequest } from '../../src/presentation/previewInspectorPageExecutionRetryProtocol';

describe('readPreviewInspectorPageExecutionRetryRequest', () => {
  it('accepts one bounded opaque retry request', () => {
    expect(
      readPreviewInspectorPageExecutionRetryRequest({
        candidateId:
          'f6e52c46e96e0950:root:8:route-choice:VcmCompanyIrContactRequestPage:' +
          '/company/ir/contact-request/:contactRequestId(\\d+):0',
        executionCandidateId: 'execution-inner',
        interactionId: 'execution:7:1',
        runtimeRevision: 7,
        type: 'react-preview-inspector-page-execution-retry',
      }),
    ).toEqual({
      candidateId:
        'f6e52c46e96e0950:root:8:route-choice:VcmCompanyIrContactRequestPage:' +
        '/company/ir/contact-request/:contactRequestId(\\d+):0',
      executionCandidateId: 'execution-inner',
      interactionId: 'execution:7:1',
      runtimeRevision: 7,
      type: 'react-preview-inspector-page-execution-retry',
    });
  });

  /** Only a literal true asks the host to restore an artifact it already committed. */
  it('keeps a restore flag and rejects any other restore value', () => {
    const request = {
      candidateId: 'page-auto',
      executionCandidateId: 'execution-target',
      interactionId: 'execution:7:3',
      runtimeRevision: 7,
      type: 'react-preview-inspector-page-execution-retry',
    };

    expect(readPreviewInspectorPageExecutionRetryRequest({ ...request, restore: true })).toEqual({
      ...request,
      restore: true,
    });
    expect(
      readPreviewInspectorPageExecutionRetryRequest({ ...request, restore: 'yes' }),
    ).toBeUndefined();
    expect(readPreviewInspectorPageExecutionRetryRequest(request)).not.toHaveProperty('restore');
  });

  it('rejects paths and non-execution interaction ids', () => {
    expect(
      readPreviewInspectorPageExecutionRetryRequest({
        candidateId: '/workspace/Page.tsx',
        executionCandidateId: 'execution-inner',
        interactionId: 'execution:7:2',
        runtimeRevision: 7,
        type: 'react-preview-inspector-page-execution-retry',
      }),
    ).toBeUndefined();
  });
});
