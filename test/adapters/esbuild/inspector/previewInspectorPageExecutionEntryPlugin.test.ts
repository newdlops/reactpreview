import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_INSPECTOR_PAGE_EXECUTION_SPECIFIER,
  registerPreviewInspectorPageExecutionEntryPlugin,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionEntryPlugin';
import { createPreviewInspectorExecutionRootModuleContract } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutionRootModuleContract';
import { createPreviewInspectorPageExecutionSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionSource';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('registerPreviewInspectorPageExecutionEntryPlugin', () => {
  it('bundles route-state setup before the selected target facade is evaluated', async () => {
    const candidate = {
      browserCandidate: {
        id: 'selected',
        root: { exportName: 'default', sourcePath: '/workspace/Target.tsx' },
        target: { exportName: 'default', sourcePath: '/workspace/Target.tsx' },
      },
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
      executionRootSurfaceId: 'target',
      executionRootContract: {
        exportName: 'default',
        sourcePath: '/workspace/Target.tsx',
        surfaceId: 'target',
      },
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
      runtimeTargetSurfaceId: 'target',
      runtimeTargetContract: {
        exportName: 'default',
        sourcePath: '/workspace/Target.tsx',
        surfaceId: 'target',
      },
      watchSourcePaths: ['/workspace/Target.tsx'],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const executionRootModuleContract = createPreviewInspectorExecutionRootModuleContract({
      exportName: 'default',
      preparedSourceText: 'export default function Target() { return null; }',
      sourcePath: '/workspace/Target.tsx',
      surfaceId: 'target',
    });
    const plugin: Plugin = {
      name: 'test-page-execution-entry',
      setup(build_): void {
        registerPreviewInspectorPageExecutionEntryPlugin(build_, {
          candidate,
          executionRootModuleContract,
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

  it('bundles a compiler-proven named execution root without a default-export fallback', async () => {
    const candidate = createNamedRootCandidate();
    const ownerSource = [
      "import React from 'react';",
      "import Target from 'react-preview:inspector-target-facade';",
      'export function NamedOwner() {',
      "  return React.createElement('section', { 'data-owner': 'named' }, React.createElement(Target));",
      '}',
    ].join('\n');
    const executionRootModuleContract = createPreviewInspectorExecutionRootModuleContract({
      exportName: 'NamedOwner',
      preparedSourceText: ownerSource,
      sourcePath: '/workspace/NamedOwner.tsx',
      surfaceId: 'owner',
    });
    const generatedSource = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract,
      target: { exportName: 'SelectedTarget', sourcePath: '/workspace/SelectedTarget.tsx' },
    });

    expect(generatedSource).toContain(
      'import { NamedOwner as Surface0 } from "/workspace/NamedOwner.tsx";',
    );
    expect(generatedSource).not.toContain('NamedOwnerModule');
    expect(generatedSource).not.toContain('?? NamedOwnerModule.default');

    const result = await buildNamedRoot({
      candidate,
      executionRootModuleContract,
      ownerSource,
    });
    const output = result.outputFiles[0]?.text ?? '';

    expect(result.warnings).toEqual([]);
    expect(output).toContain('data-owner');
    expect(output).toContain('function SelectedTarget');
  });

  it('fails the real bundle when prepared named-root evidence drifts from the loaded module', async () => {
    const candidate = createNamedRootCandidate();
    const executionRootModuleContract = createPreviewInspectorExecutionRootModuleContract({
      exportName: 'NamedOwner',
      preparedSourceText: 'export function NamedOwner() { return null; }',
      sourcePath: '/workspace/NamedOwner.tsx',
      surfaceId: 'owner',
    });

    await expect(
      buildNamedRoot({
        candidate,
        executionRootModuleContract,
        ownerSource: 'export function DifferentOwner() { return null; }',
      }),
    ).rejects.toThrow('No matching export');
  });
});

function createNamedRootCandidate(): PreviewInspectorPageExecutionCandidate {
  return {
    browserCandidate: {
      id: 'named-root',
      root: { exportName: 'NamedOwner', sourcePath: '/workspace/NamedOwner.tsx' },
      target: { exportName: 'SelectedTarget', sourcePath: '/workspace/SelectedTarget.tsx' },
    },
    compositionEdges: [
      {
        childSurfaceId: 'target',
        mode: 'contains-authored-child',
        parentSurfaceId: 'owner',
        placementIndex: 0,
      },
    ],
    criticalSurfaces: [
      {
        bypassedWrapperNames: [],
        exportName: 'NamedOwner',
        id: 'owner',
        omittedTopLevelEffectCount: 0,
        sourcePath: '/workspace/NamedOwner.tsx',
        strategy: 'selected-route-surface',
        watchSourcePaths: ['/workspace/NamedOwner.tsx'],
      },
      {
        bypassedWrapperNames: [],
        exportName: 'SelectedTarget',
        id: 'target',
        omittedTopLevelEffectCount: 0,
        sourcePath: '/workspace/SelectedTarget.tsx',
        strategy: 'authentic-module-export',
        watchSourcePaths: ['/workspace/SelectedTarget.tsx'],
      },
    ],
    evidenceSourcePaths: [],
    executionRootContract: {
      exportName: 'NamedOwner',
      sourcePath: '/workspace/NamedOwner.tsx',
      surfaceId: 'owner',
    },
    executionRootSurfaceId: 'owner',
    fidelity: 'page-authentic',
    id: 'named-root',
    optionalSurfaces: [],
    runtimeTargetContract: {
      exportName: 'SelectedTarget',
      sourcePath: '/workspace/SelectedTarget.tsx',
      surfaceId: 'target',
    },
    runtimeTargetSurfaceId: 'target',
    watchSourcePaths: ['/workspace/NamedOwner.tsx', '/workspace/SelectedTarget.tsx'],
  } as unknown as PreviewInspectorPageExecutionCandidate;
}

async function buildNamedRoot(options: {
  readonly candidate: PreviewInspectorPageExecutionCandidate;
  readonly executionRootModuleContract: ReturnType<
    typeof createPreviewInspectorExecutionRootModuleContract
  >;
  readonly ownerSource: string;
}) {
  const plugin: Plugin = {
    name: 'test-named-page-execution-entry',
    setup(build_): void {
      registerPreviewInspectorPageExecutionEntryPlugin(build_, {
        candidate: options.candidate,
        executionRootModuleContract: options.executionRootModuleContract,
        target: {
          exportName: 'SelectedTarget',
          sourcePath: '/workspace/SelectedTarget.tsx',
        },
      });
      build_.onResolve({ filter: /^\/workspace\/NamedOwner\.tsx$/ }, () => ({
        namespace: 'test-named-owner',
        path: 'owner',
      }));
      build_.onLoad({ filter: /^owner$/, namespace: 'test-named-owner' }, () => ({
        contents: options.ownerSource,
        loader: 'tsx',
      }));
      build_.onResolve({ filter: /^react-preview:inspector-target-facade$/ }, () => ({
        namespace: 'test-target-facade',
        path: 'target',
      }));
      build_.onLoad({ filter: /^target$/, namespace: 'test-target-facade' }, () => ({
        contents: [
          'function SelectedTarget() { return null; }',
          'export { SelectedTarget };',
          'export default SelectedTarget;',
        ].join('\n'),
        loader: 'js',
      }));
    },
  };
  return build({
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
}
