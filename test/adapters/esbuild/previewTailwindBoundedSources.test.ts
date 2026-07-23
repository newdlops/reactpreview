/** Verifies that bounded Tailwind discovery preserves authored visual CSS and source locations. */
import { describe, expect, it } from 'vitest';
import { boundPreviewTailwindSourceDiscovery } from '../../../src/adapters/esbuild/previewTailwindBoundedSources';

describe('boundPreviewTailwindSourceDiscovery', () => {
  /** Keeps layout/theme CSS while replacing automatic and explicit filesystem candidate scans. */
  it('narrows discovery without removing visual rules or inline candidates', () => {
    const source = [
      '@import "tailwindcss";',
      '@source "../styles/**/*.tsx";',
      '@source inline("grid px-4");',
      '@theme { --color-brand: red; }',
      ':root { --surface: white; }',
      '@layer base { body { color: var(--color-brand); } }',
    ].join('\n');

    const result = boundPreviewTailwindSourceDiscovery(source);

    expect(result.changed).toBe(true);
    expect(result.source).toContain('@import "tailwindcss" source(none);');
    expect(result.source).not.toContain('../styles/**/*.tsx');
    expect(result.source).toContain('@source inline("grid px-4");');
    expect(result.source).toContain('@theme { --color-brand: red; }');
    expect(result.source).toContain(':root { --surface: white; }');
    expect(result.source).toContain('@layer base { body { color: var(--color-brand); } }');
    expect(result.source.split('\n')).toHaveLength(source.split('\n').length);
  });

  /** Leaves comments and an already bounded Tailwind import stable. */
  it('does not rewrite documentation or duplicate source(none)', () => {
    const source = [
      '/* @import "tailwindcss"; */',
      '@import "tailwindcss" source(none) layer(theme);',
      '/* @source "../docs/**/*.tsx"; */',
    ].join('\n');

    const result = boundPreviewTailwindSourceDiscovery(source);

    expect(result.changed).toBe(false);
    expect(result.source).toContain('/* @import "tailwindcss"; */');
    expect(result.source.match(/source\(none\)/gu)).toHaveLength(1);
  });

  /** Replaces an authored source modifier while preserving other Tailwind import modifiers. */
  it('normalizes a broad import source modifier', () => {
    const result = boundPreviewTailwindSourceDiscovery(
      '@import "tailwindcss" source("../app") layer(theme);',
    );

    expect(result.source).toBe('@import "tailwindcss" source(none) layer(theme);');
  });
});
