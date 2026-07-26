import { describe, expect, it } from 'vitest';
import { createPreviewStyledComponentsCompilerPlan } from '../../../src/adapters/esbuild/previewStyledComponentsCompilerPlan';
import { createPreviewStyledComponentsPlan } from '../../../src/adapters/esbuild/previewStyledComponentsPlan';

describe('createPreviewStyledComponentsCompilerPlan', () => {
  it('keeps the build identity source-free while selecting the shared package strategy', () => {
    const styledComponentsPlan = createPreviewStyledComponentsPlan({
      available: true,
      dependencyPaths: ['/workspace/node_modules/styled-components/package.json'],
      evidence: 'synthetic',
      ignoredReasons: [],
      layers: [],
      sharedRuntimeChunk: true,
    });
    const plan = createPreviewStyledComponentsCompilerPlan(styledComponentsPlan);

    expect(plan.buildIdentity).toEqual({
      entryStrategy: { kind: 'shared-styled-runtime', version: 1 },
      styledComponentsPlan,
    });
    expect(plan.dependencyPaths).toEqual(styledComponentsPlan.dependencyPaths);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(
      plan.createEntryStrategy({
        entrySource: 'export const preview = true;',
        reactDomRootKind: 'client',
        renderMode: 'component',
        resolveDir: '/workspace/src',
        singleEntryPoint: 'src/<react-preview-entry>',
      }).kind,
    ).toBe('shared-styled-runtime');
  });
});
