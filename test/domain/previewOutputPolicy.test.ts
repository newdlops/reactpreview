/** Verifies normalization of the local preview output setting before compiler allocation checks. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_OUTPUT_MEBIBYTES,
  MAX_PREVIEW_OUTPUT_MEBIBYTES,
  MIN_PREVIEW_OUTPUT_MEBIBYTES,
  normalizePreviewOutputMebibytes,
  resolvePreviewOutputLimitBytes,
} from '../../src/domain/previewOutputPolicy';

describe('preview output policy', () => {
  /** Uses a monorepo-sized default and clamps explicit values to the documented safety range. */
  it('normalizes invalid, fractional, small, and oversized settings', () => {
    expect(normalizePreviewOutputMebibytes(undefined)).toBe(DEFAULT_PREVIEW_OUTPUT_MEBIBYTES);
    expect(normalizePreviewOutputMebibytes(Number.NaN)).toBe(DEFAULT_PREVIEW_OUTPUT_MEBIBYTES);
    expect(normalizePreviewOutputMebibytes(16)).toBe(MIN_PREVIEW_OUTPUT_MEBIBYTES);
    expect(normalizePreviewOutputMebibytes(192.9)).toBe(192);
    expect(normalizePreviewOutputMebibytes(4096)).toBe(MAX_PREVIEW_OUTPUT_MEBIBYTES);
  });

  /** Converts the normalized whole-number setting to the exact byte boundary used by esbuild. */
  it('resolves mebibytes to bytes after normalization', () => {
    expect(resolvePreviewOutputLimitBytes(256)).toBe(256 * 1024 * 1024);
    expect(resolvePreviewOutputLimitBytes(1)).toBe(MIN_PREVIEW_OUTPUT_MEBIBYTES * 1024 * 1024);
  });
});
