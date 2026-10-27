/** Verifies bounded browser diagnostics preserve UTF-8 across real Node stream boundaries. */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { captureBoundedStream } from '../../../src/adapters/node/previewHeadlessLifecycle';
import { MAX_CAPTURE_BYTES } from '../../../src/adapters/node/previewHeadlessModel';

describe('headless bounded stream capture', () => {
  it.each([1, 2, 4])(
    'preserves Korean and emoji diagnostics across %i-byte chunks',
    (chunkSize) => {
      const stream = new PassThrough();
      try {
        const snapshot = captureBoundedStream(stream);
        const expected = '미리보기 오류: café 📦\n';
        const encoded = Buffer.from(expected);
        for (let index = 0; index < encoded.length; index += chunkSize)
          stream.write(encoded.subarray(index, index + chunkSize));
        expect(snapshot()).toBe(expected);
      } finally {
        stream.destroy();
      }
    },
  );

  it('retains the existing diagnostic prefix cap when later chunks arrive', () => {
    const stream = new PassThrough();
    try {
      const snapshot = captureBoundedStream(stream);
      stream.write(Buffer.alloc(MAX_CAPTURE_BYTES, 'a'));
      stream.write(Buffer.from('한글 📦'));
      expect(snapshot()).toBe('a'.repeat(MAX_CAPTURE_BYTES));
    } finally {
      stream.destroy();
    }
  });
});
