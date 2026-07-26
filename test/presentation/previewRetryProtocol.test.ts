/** Verifies that the retry protocol carries only a host-minted token and current revision. */
import { describe, expect, it } from 'vitest';
import { readPreviewRetryRequest } from '../../src/presentation/previewRetryProtocol';

describe('readPreviewRetryRequest', () => {
  /** Accepts one bounded opaque recovery action. */
  it('accepts a valid retry request', () => {
    expect(
      readPreviewRetryRequest({
        revision: 3,
        token: '3.2.abcdefgh',
        type: 'react-preview-retry',
      }),
    ).toEqual({ revision: 3, token: '3.2.abcdefgh', type: 'react-preview-retry' });
  });

  /** Rejects browser-provided source or build settings by requiring the minimal exact envelope. */
  it('rejects malformed action values', () => {
    expect(
      readPreviewRetryRequest({ type: 'react-preview-retry', revision: -1, token: 'short' }),
    ).toBeUndefined();
    expect(
      readPreviewRetryRequest({
        type: 'react-preview-retry',
        revision: 1,
        token: '../unsafe-token',
      }),
    ).toBeUndefined();
  });
});
