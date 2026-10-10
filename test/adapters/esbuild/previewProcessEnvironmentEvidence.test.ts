/** Verifies that only public build-time `process.env` reads count as browser-safe evidence. */
import { describe, expect, it } from 'vitest';
import { readPreviewProcessEnvironmentEvidence } from '../../../src/adapters/esbuild/previewProcessEnvironmentEvidence';

describe('readPreviewProcessEnvironmentEvidence', () => {
  it('reports no evidence without a process.env read', () => {
    expect(
      readPreviewProcessEnvironmentEvidence('export const url = import.meta.env.VITE_API;'),
    ).toBe('none');
  });

  it('accepts public build-time names in dot, optional and literal-bracket form', () => {
    expect(
      readPreviewProcessEnvironmentEvidence(
        [
          'const mode = process.env.NODE_ENV;',
          'const api = process.env.NEXT_PUBLIC_API_BASE_URL;',
          'const app = process.env?.REACT_APP_HOSPITALRUN_API;',
          "const vite = process.env['VITE_SENTRY_DSN'];",
          'const url = process.env.PUBLIC_URL;',
        ].join('\n'),
      ),
    ).toBe('public');
  });

  it('treats private names, computed keys and whole-object reads as server evidence', () => {
    expect(
      readPreviewProcessEnvironmentEvidence(
        'const api = process.env.NEXT_PUBLIC_API; const secret = process.env.JWT_SECRET;',
      ),
    ).toBe('private');
    expect(readPreviewProcessEnvironmentEvidence('const value = process.env[name];')).toBe(
      'private',
    );
    expect(readPreviewProcessEnvironmentEvidence('const { REACT_APP_API } = process.env;')).toBe(
      'private',
    );
    expect(readPreviewProcessEnvironmentEvidence('const level = process.env.LOG_LEVEL;')).toBe(
      'private',
    );
  });
});
