import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER,
  registerPreviewInspectorPageExecutionEntryPlugin,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionEntryPlugin';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('registerPreviewInspectorPageExecutionEntryPlugin', () => {
  it('bundles route-state setup before the selected target facade is evaluated', async () => {
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Target.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: ['/workspace/Target.tsx'],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'target-only',
      id: 'target-only',
      optionalSurfaces: [],
      routeRecipe: {
        kind: 'generic-memory-location',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: {},
        pattern: '/orders/:id',
        pathname: '/orders/42',
        rootOwnsRouter: false,
        searchParams: {},
      },
      watchSourcePaths: ['/workspace/Target.tsx'],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const plugin: Plugin = {
      name: 'test-page-execution-entry',
      setup(build_): void {
        registerPreviewInspectorPageExecutionEntryPlugin(build_, {
          candidate,
          target: { exportName: 'default', sourcePath: '/workspace/Target.tsx' },
        });
        build_.onResolve({ filter: /^react-preview:inspector-target-facade$/ }, () => ({
          namespace: 'test-target-facade',
          path: 'target',
        }));
        build_.onLoad({ filter: /^target$/, namespace: 'test-target-facade' }, () => ({
          contents: 'export default function Target() { return null; }',
          loader: 'js',
        }));
      },
    };

    const result = await build({
      bundle: true,
      external: ['react'],
      format: 'esm',
      plugins: [plugin],
      stdin: {
        contents: `export { default } from ${JSON.stringify(PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER)};`,
        loader: 'js',
        resolveDir: '/workspace',
      },
      write: false,
    });
    const output = result.outputFiles[0]?.text ?? '';

    expect(output).toContain('replaceState');
    expect(output).toContain('function Target');
    expect(output.indexOf('replaceState')).toBeLessThan(output.indexOf('function Target'));
  });
});
