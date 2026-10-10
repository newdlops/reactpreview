/** Verifies which Tailwind compiler package a declared project version needs from the store. */
import { describe, expect, it } from 'vitest';
import { selectPreviewTailwindCompilerPackage } from '../../../src/adapters/esbuild/previewTailwindImplementation';
import type { PreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';

describe('selectPreviewTailwindCompilerPackage', () => {
  /** Tailwind v4 compiles through its PostCSS adapter; v2/v3 are their own PostCSS plugin. */
  it('follows the declared Tailwind generation', () => {
    expect(selectPreviewTailwindCompilerPackage(createProfile({ tailwindcss: '^3.4.1' }))).toBe(
      'tailwindcss',
    );
    expect(selectPreviewTailwindCompilerPackage(createProfile({ tailwindcss: '~2.2.19' }))).toBe(
      'tailwindcss',
    );
    expect(
      selectPreviewTailwindCompilerPackage(
        createProfile({ '@tailwindcss/postcss': '^4', tailwindcss: '^4' }),
      ),
    ).toBe('@tailwindcss/postcss');
  });

  /** Never guesses an adapter for v4 without its PostCSS package or for unversioned ranges. */
  it('acquires nothing without a provable compiler package', () => {
    expect(selectPreviewTailwindCompilerPackage(undefined)).toBeUndefined();
    expect(selectPreviewTailwindCompilerPackage(createProfile({ tailwindcss: '^4.1.0' }))).toBe(
      undefined,
    );
    expect(selectPreviewTailwindCompilerPackage(createProfile({ tailwindcss: 'latest' }))).toBe(
      undefined,
    );
    expect(
      selectPreviewTailwindCompilerPackage({
        ...createProfile({ tailwindcss: '^3.4.1' }),
        hasReusableLockEvidence: false,
        lockfileEvidenceStatus: 'absent',
      }),
    ).toBeUndefined();
  });
});

/** Builds a lock-backed profile whose development dependencies declare the given packages. */
function createProfile(
  devDependencies: Readonly<Record<string, string>>,
): PreviewDependencyProfile {
  return {
    dependencyPaths: ['/workspace/package.json', '/workspace/package-lock.json'],
    fingerprint: 'profile',
    hasReusableLockEvidence: true,
    lockfileDigests: { 'package-lock.json': 'lock' },
    lockfileEvidenceStatus: 'reusable',
    manifestPath: '/workspace/package.json',
    requirementsByField: {
      dependencies: { react: '^19.0.0' },
      devDependencies,
      optionalDependencies: {},
      peerDependencies: {},
    },
    schemaVersion: 2,
  };
}
