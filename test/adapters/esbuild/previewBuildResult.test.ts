/** Exercises the final aggregate byte guard without allocating large buffers in the test process. */
import type { OutputFile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { assertOutputSize } from '../../../src/adapters/esbuild/previewBuildResult';

const MEBIBYTE = 1024 * 1024;

describe('assertOutputSize', () => {
  /** Accepts the expanded default budget and an explicitly larger resource-scoped budget. */
  it('accepts output within the default or configured local limit', () => {
    expect(() => {
      assertOutputSize(createOutputFiles(80));
    }).not.toThrow();
    expect(() => {
      assertOutputSize(createOutputFiles(200), 256);
    }).not.toThrow();
    expect(() => {
      assertOutputSize(createOutputFiles(32), 32);
    }).not.toThrow();
  });

  /** Reports actual size, active setting, and the exact recovery setting when the budget is exceeded. */
  it('returns an actionable error for oversized output', () => {
    expect(() => {
      assertOutputSize(createOutputFiles(40.25), 32);
    }).toThrow(
      'Preview output is 40.3 MiB and exceeds the configured 32 MiB limit. Increase reactPreview.maxOutputSizeMiB up to 512 MiB',
    );
  });

  /** Clamps direct compiler callers so even a malformed request cannot disable the hard guard. */
  it('retains the absolute maximum for out-of-range compiler requests', () => {
    expect(() => {
      assertOutputSize(createOutputFiles(513), 4096);
    }).toThrow('configured 512 MiB limit');
  });
});

/** Creates structural esbuild outputs whose byte lengths require no corresponding memory allocation. */
function createOutputFiles(...sizesInMebibytes: readonly number[]): readonly OutputFile[] {
  return sizesInMebibytes.map((sizeInMebibytes, index) => ({
    contents: { byteLength: sizeInMebibytes * MEBIBYTE },
    hash: `fake-${index.toString()}`,
    path: `/virtual/output-${index.toString()}.js`,
    text: '',
  })) as unknown as readonly OutputFile[];
}
