/** Checks selected-route source isolation when multiple candidates share a closure memo. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

/** Scalar and catch-all values used by the existing selected-branch admission policy. */
type RouteParameters = Readonly<Record<string, string | readonly string[]>>;

/** Builds one broad literal registry whose admitted lazy branch depends on Next route params. */
function createRouteRegistryFixture(): {
  readonly branchPaths: readonly string[];
  readonly prepare: (
    params: RouteParameters,
    memo?: PreviewInspectorBundleSourceInventoryMemo,
  ) => ReturnType<typeof preparePreviewInspectorBundleFrontier>;
} {
  const pagePath = '/workspace/page.tsx';
  const registryPath = '/workspace/registry.tsx';
  const branchPaths = Array.from(
    { length: 10 },
    (_, index) => `/workspace/registry/neutral/branch-${index.toString()}/page.tsx`,
  );
  const sources = new Map<string, string>([
    [
      pagePath,
      "import { getComponent } from './registry'; export default function Page() { const Component = getComponent(); return <Component />; }",
    ],
    [
      registryPath,
      [
        "import * as React from 'react';",
        `const components = {${branchPaths
          .map(
            (_sourcePath, index) =>
              `${index.toString()}: React.lazy(() => import(${JSON.stringify(`./registry/neutral/branch-${index.toString()}/page`)}))`,
          )
          .join(',')}};`,
        'export function getComponent() { return components[0]; }',
      ].join('\n'),
    ],
    ...branchPaths.map(
      (sourcePath, index) =>
        [
          sourcePath,
          `export default function Branch() { return <main>${index.toString()}</main>; }`,
        ] as const,
    ),
  ]);
  const surface = {
    bypassedWrapperNames: [],
    exportName: 'default',
    id: 'page',
    omittedTopLevelEffectCount: 0,
    sourcePath: pagePath,
    strategy: 'authentic-module-export',
    watchSourcePaths: [pagePath],
  } as const;
  const plan = {
    edges: [],
    pageCandidates: [],
    root: { exportName: 'default', sourcePath: pagePath },
    target: { exportName: 'default', sourcePath: pagePath },
  } as unknown as PreviewInspectorAncestorPlan;
  const policy = createPreviewCompilerFrontierPolicy('fast');
  if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
  return {
    branchPaths,
    prepare: (params, sourceInventoryMemo) => {
      const role = { exportName: 'default', sourcePath: pagePath, surfaceId: surface.id };
      const executionCandidate: PreviewInspectorPageExecutionCandidate = {
        browserCandidate: {
          id: 'selected',
        } as PreviewInspectorPageExecutionCandidate['browserCandidate'],
        compositionEdges: [],
        criticalSurfaces: [surface],
        evidenceSourcePaths: [],
        executionRootContract: role,
        executionRootSurfaceId: surface.id,
        fidelity: 'page-authentic',
        id: `route-${JSON.stringify(params)}`,
        optionalSurfaces: [],
        routeRecipe: {
          kind: 'next-app',
          loaderPolicy: 'never-execute',
          mounts: [],
          params,
          pathname: '/',
          pattern: '/[...segments]',
          rootOwnsRouter: false,
          searchParams: {},
        },
        runtimeTargetContract: role,
        runtimeTargetSurfaceId: surface.id,
        watchSourcePaths: [pagePath],
      };
      return preparePreviewInspectorBundleFrontier({
        executionCandidate,
        plan,
        policy,
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
        resolveModule: (specifier, importer) => {
          if (!specifier.startsWith('.')) return undefined;
          const unresolved = path.resolve(path.dirname(importer), specifier);
          return [unresolved, `${unresolved}.tsx`].find((candidate) => sources.has(candidate));
        },
        ...(sourceInventoryMemo === undefined ? {} : { sourceInventoryMemo }),
        workspaceRoot: '/workspace',
      });
    },
  };
}

describe('Page Execution route closure memo', () => {
  it.each<{ name: string; first: RouteParameters; second: RouteParameters }>([
    {
      name: 'scalar',
      first: { style: 'neutral', name: 'branch-0' },
      second: { style: 'neutral', name: 'branch-1' },
    },
    {
      name: 'catch-all',
      first: { segments: ['neutral', 'branch-0'] },
      second: { segments: ['neutral', 'branch-1'] },
    },
  ])(
    'retains only the selected $name route branch after another candidate warms the memo',
    async ({ first, second }) => {
      const fixture = createRouteRegistryFixture();
      const memo = createPreviewInspectorBundleSourceInventoryMemo();
      const firstFrontier = await fixture.prepare(first, memo);
      const expected = await fixture.prepare(second);
      const actual = await fixture.prepare(second, memo);

      expect(firstFrontier.rejected).toBe(false);
      expect(expected.rejected).toBe(false);
      expect(
        expected.frontier.authenticSourcePaths.filter((sourcePath) =>
          fixture.branchPaths.includes(sourcePath),
        ),
      ).toEqual([fixture.branchPaths[1]]);
      expect(
        firstFrontier.frontier.authenticSourcePaths.filter((sourcePath) =>
          fixture.branchPaths.includes(sourcePath),
        ),
      ).toEqual([fixture.branchPaths[0]]);
      expect(actual).toEqual(expected);

      const equivalentParams = Object.fromEntries(
        Object.entries(second)
          .reverse()
          .map(([name, value]) => [name, typeof value === 'string' ? value : [...value].reverse()]),
      );
      expect(await fixture.prepare(equivalentParams, memo)).toMatchObject({
        frontier: { authenticSourcePaths: expected.frontier.authenticSourcePaths },
      });
      expect(memo.getClosureStatistics()).toMatchObject({ closureComputations: 2, closureHits: 1 });
      memo.release();
    },
  );
});
