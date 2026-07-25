/** Verifies the provisional dependency shortcut without invoking the filesystem or esbuild. */
import { describe, expect, it } from 'vitest';
import { canUsePreviewFastDependencyPassThrough } from '../../../../src/adapters/esbuild/staticResources/previewFastDependencyPassThroughPolicy';

describe('preview fast dependency pass-through policy', () => {
  /** Ordinary syntax can use esbuild directly only during the provisional preparation pass. */
  it('admits a compatible fast dependency and rejects the same module during full preparation', () => {
    const source = 'export const value = 1;';

    expect(
      canUsePreviewFastDependencyPassThrough('/workspace/src/value.ts', source, {
        fastPreparation: true,
      }),
    ).toBe(true);
    expect(
      canUsePreviewFastDependencyPassThrough('/workspace/src/value.ts', source, {
        fastPreparation: false,
      }),
    ).toBe(false);
  });

  /** The selected editor document always receives scenario registrations and runtime adapters. */
  it('rejects the selected document after normalizing equivalent path spellings', () => {
    expect(
      canUsePreviewFastDependencyPassThrough(
        '/workspace/src/Card.tsx',
        'export const Card = () => <div />;',
        {
          documentPath: '/workspace/src/./Card.tsx',
          fastPreparation: true,
        },
      ),
    ).toBe(false);
  });

  /** Framework and resource syntax retains the complete compatibility transform. */
  it('rejects a dependency whose source requires fast compatibility handling', () => {
    expect(
      canUsePreviewFastDependencyPassThrough(
        '/workspace/src/routes.tsx',
        'const pages = import.meta.glob("./pages/*.tsx");',
        { fastPreparation: true },
      ),
    ).toBe(false);
  });
});
