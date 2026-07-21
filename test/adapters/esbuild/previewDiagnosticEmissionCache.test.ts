/** Verifies bounded one-time admission for informational compiler warnings. */
import { describe, expect, it } from 'vitest';
import { PreviewDiagnosticEmissionCache } from '../../../src/adapters/esbuild/previewDiagnosticEmissionCache';

describe('PreviewDiagnosticEmissionCache', () => {
  /** Emits each identity once until compiler shutdown clears the host-session memory. */
  it('suppresses repeated advisories and resets explicitly', () => {
    const cache = new PreviewDiagnosticEmissionCache();

    expect(cache.admit('missing-ancestor:target')).toBe(true);
    expect(cache.admit('missing-ancestor:target')).toBe(false);
    expect(cache.admit('missing-ancestor:other')).toBe(true);
    cache.clear();
    expect(cache.admit('missing-ancestor:target')).toBe(true);
  });

  /** Deduplicates stable esbuild warnings while retaining another file or source position. */
  it('admits an esbuild warning once across hot rebuilds', () => {
    const cache = new PreviewDiagnosticEmissionCache();
    const warning = {
      detail: undefined,
      id: 'unsupported-jsx-comment',
      location: {
        column: 9,
        file: 'node_modules/react-spinners/BarLoader.js',
        length: 3,
        line: 40,
        lineText: '/** @jsx jsx */',
        namespace: 'file',
        suggestion: '',
      },
      notes: [],
      pluginName: '',
      text: 'The JSX factory cannot be set when using the automatic JSX transform',
    };

    expect(cache.admitBuildWarning(warning)).toBe(true);
    expect(cache.admitBuildWarning({ ...warning, detail: new Error('new build') })).toBe(false);
    expect(
      cache.admitBuildWarning({
        ...warning,
        location: { ...warning.location, file: 'node_modules/react-spinners/BeatLoader.js' },
      }),
    ).toBe(true);
  });
});
