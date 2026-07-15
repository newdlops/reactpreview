/**
 * Verifies the pure filename policy that keeps supported preview formats independent from VS Code.
 */
import { describe, expect, it } from 'vitest';
import { getPreviewSourceLanguage, isPreviewSourcePath } from '../../src/domain/previewTarget';

describe('preview target policy', () => {
  /** Confirms each documented source extension maps to the corresponding esbuild loader. */
  it.each([
    ['Component.tsx', 'tsx'],
    ['Component.JSX', 'jsx'],
    ['component.ts', 'ts'],
    ['component.js', 'jsx'],
  ] as const)('maps %s to %s', (filePath, expectedLanguage) => {
    expect(getPreviewSourceLanguage(filePath)).toBe(expectedLanguage);
    expect(isPreviewSourcePath(filePath)).toBe(true);
  });

  /** Rejects unrelated files instead of guessing a source loader. */
  it('rejects unsupported file extensions', () => {
    expect(getPreviewSourceLanguage('Component.vue')).toBeUndefined();
    expect(isPreviewSourcePath('README.md')).toBe(false);
  });
});
