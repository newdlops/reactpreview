/** Verifies selected-corridor dependency pass-through without invoking the filesystem or esbuild. */
import { describe, expect, it } from 'vitest';
import { canPassThroughPreviewDependency } from '../../../../src/adapters/esbuild/staticResources/previewDependencyPassThroughPolicy';

describe('preview dependency pass-through policy', () => {
  /** Ordinary syntax can use esbuild directly only inside a selected-corridor preparation. */
  it('admits a compatible corridor dependency and rejects workspace-complete preparation', () => {
    const source = 'export const value = 1;';

    expect(
      canPassThroughPreviewDependency('/workspace/src/value.ts', source, {
        selectiveDependencyPassThrough: true,
      }),
    ).toBe(true);
    expect(
      canPassThroughPreviewDependency('/workspace/src/value.ts', source, {
        selectiveDependencyPassThrough: false,
      }),
    ).toBe(false);
  });

  /** The selected editor document always receives scenario registrations and runtime adapters. */
  it('rejects the selected document after normalizing equivalent path spellings', () => {
    expect(
      canPassThroughPreviewDependency(
        '/workspace/src/Card.tsx',
        'export const Card = () => <div />;',
        {
          documentPath: '/workspace/src/./Card.tsx',
          selectiveDependencyPassThrough: true,
        },
      ),
    ).toBe(false);
  });

  /** Framework and resource syntax retains the complete compatibility transform. */
  it('rejects a dependency whose source requires fast compatibility handling', () => {
    expect(
      canPassThroughPreviewDependency(
        '/workspace/src/routes.tsx',
        'const pages = import.meta.glob("./pages/*.tsx");',
        { selectiveDependencyPassThrough: true },
      ),
    ).toBe(false);
  });
});
