/** Verifies static and lazy sibling demands retain every component export of a shared module. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreparedPreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import { collectPreviewInspectorOneHopContext } from '../../../../src/adapters/esbuild/inspector/previewInspectorOneHopContext';
import { createPreviewInspectorPageExecutionCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

/** Exposes the real candidate and both descriptor-backed and candidate-only frontier requests. */
interface SharedExportsFixture {
  readonly widgetsPath: string;
  readonly loaderPath: string;
  readonly optionalSurfaces: PreviewInspectorPageExecutionCandidate['optionalSurfaces'];
  readonly prepare: (
    maximumAuthoredModules?: number,
  ) => Promise<PreparedPreviewInspectorBundleFrontier>;
  readonly prepareFrozen: (
    optionalOrder: 'planned' | 'reverse',
    sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo,
  ) => Promise<PreparedPreviewInspectorBundleFrontier>;
}

/** Uses actual ancestry, visual evidence, and execution planners for direct and intermediate owners. */
async function createFixture(
  order: 'lazy-first' | 'static-first',
  owner: 'intermediate' | 'direct' = 'intermediate',
): Promise<SharedExportsFixture> {
  const workspaceRoot = path.resolve('/workspace');
  const file = (name: string): string => path.join(workspaceRoot, name + '.tsx');
  const pagePath = file('Page');
  const corridorPath = file('Corridor');
  const targetPath = file('Target');
  const loaderPath = file('Loader');
  const widgetsPath = file('Widgets');
  const siblings = order === 'lazy-first' ? '<Loader/><Widget/>' : '<Widget/><Loader/>';
  const sources = new Map([
    [
      file('main'),
      "import { createRoot } from 'react-dom/client'; import { Page } from './Page'; createRoot(document.body).render(<Page/>);",
    ],
    [
      pagePath,
      "import { Corridor } from './Corridor'; export function Page(){return <Corridor/>;}",
    ],
    [
      corridorPath,
      "import { Loader } from './Loader'; import { Widget } from './Widgets'; import { Target } from './Target'; export function Corridor(){return <>" +
        siblings +
        '<Target/></>;}',
    ],
    [
      loaderPath,
      "import { lazy } from 'react'; const LazyWidget=lazy(()=>import('./Widgets')); export function Loader(){return <LazyWidget/>;}",
    ],
    [
      widgetsPath,
      'export function Widget(){return <h1>static</h1>;} export function Footer(){return <footer/>;} export default function LazyWidget(){return <p>lazy</p>;}',
    ],
    [targetPath, 'export function Target(){return <main>target</main>;}'],
  ]);
  if (owner === 'direct') {
    sources.delete(corridorPath);
    sources.set(
      pagePath,
      "import { Loader } from './Loader'; import { Widget, Footer } from './Widgets'; import { Target } from './Target'; export function Page(){return <>" +
        siblings +
        '<Footer/><Target/></>;}',
    );
  }
  const readSource = (sourcePath: string): Promise<string | undefined> =>
    Promise.resolve(sources.get(sourcePath));
  const resolveModule = (specifier: string, importer: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    const resolved = path.resolve(path.dirname(importer), specifier);
    return [resolved, resolved + '.tsx'].find((candidate) => sources.has(candidate));
  };
  const ancestor = await createPreviewInspectorAncestorPlan({
    documentPath: targetPath,
    exportName: 'Target',
    readSource,
    resolveModule,
    sourcePaths: [...sources.keys()],
  });
  expect(ancestor.root.sourcePath).toBe(pagePath);
  const importPath = [...ancestor.edges]
    .reverse()
    .map((edge) => edge.owner.sourcePath)
    .concat(targetPath);
  expect(importPath).toEqual(
    owner === 'direct' ? [pagePath, targetPath] : [pagePath, corridorPath, targetPath],
  );
  const visual = await collectPreviewInspectorOneHopContext({
    importPath,
    maximumFiles: 32,
    readSource,
    resolveModule,
    workspaceRoot,
  });
  expect(visual.truncated).toBe(false);
  expect(visual.shallowVisualPaths).toContainEqual(
    expect.objectContaining({
      importerPath: owner === 'direct' ? pagePath : corridorPath,
      sourcePath: widgetsPath,
      exportName: 'Widget',
    }),
  );
  const plan = { ...ancestor, shallowVisualPaths: visual.shallowVisualPaths };
  const candidates = createPreviewInspectorPageExecutionCandidates({ plan });
  const executionCandidate = candidates.find((candidate) =>
    candidate.criticalSurfaces.some(
      (surface) =>
        surface.id === candidate.executionRootSurfaceId &&
        surface.sourcePath === pagePath &&
        surface.strategy === 'authentic-module-export',
    ),
  );
  if (executionCandidate === undefined)
    throw new Error(
      'Expected authentic page candidate: ' +
        JSON.stringify(
          candidates.map((candidate) => ({
            fidelity: candidate.fidelity,
            root: candidate.executionRootContract,
          })),
        ),
    );
  const policy = createPreviewCompilerFrontierPolicy('fast');
  if (policy === undefined) throw new Error('Expected fast frontier policy.');
  return {
    widgetsPath,
    loaderPath,
    optionalSurfaces: executionCandidate.optionalSurfaces,
    prepare: (maximumAuthoredModules = policy.maximumAuthoredModules) =>
      preparePreviewInspectorBundleFrontier({
        plan,
        executionCandidate,
        policy: { ...policy, maximumAuthoredModules },
        readSource,
        resolveModule,
        workspaceRoot,
      }),
    prepareFrozen: (
      optionalOrder: 'planned' | 'reverse',
      sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo,
    ) =>
      preparePreviewInspectorBundleFrontier({
        plan: { ...plan, shallowVisualPaths: [] },
        executionCandidate: Object.freeze({
          ...executionCandidate,
          optionalSurfaces: Object.freeze(
            optionalOrder === 'planned'
              ? [...executionCandidate.optionalSurfaces]
              : [...executionCandidate.optionalSurfaces].reverse(),
          ),
        }),
        policy,
        readSource,
        resolveModule,
        workspaceRoot,
        ...(sourceInventoryMemo === undefined ? {} : { sourceInventoryMemo }),
      }),
  };
}

describe('Page Execution shared component exports', () => {
  it.each(['lazy-first', 'static-first'] as const)(
    'retains static and default exports through an intermediate owner (%s)',
    async (order) => {
      const fixture = await createFixture(order);
      const result = await fixture.prepare();
      expect(result.rejected).toBe(false);
      expect(result.frontier.authenticSourcePaths).toContain(fixture.widgetsPath);
      expect(result.frontier.authenticSourcePaths).toContain(fixture.loaderPath);
      expect(
        result.frontier.authenticComponentExports.find(
          (item) => item.sourcePath === fixture.widgetsPath,
        )?.exportNames,
      ).toEqual(['Widget', 'default']);
    },
  );

  it.each(['lazy-first', 'static-first'] as const)(
    'keeps optional component admission within the module budget (%s)',
    async (order) => {
      const fixture = await createFixture(order);
      const result = await fixture.prepare(3);
      expect(result.frontier.authenticSourcePaths).not.toContain(fixture.widgetsPath);
      expect(result.frontier.authenticSourcePaths).not.toContain(fixture.loaderPath);
      expect(result.frontier.summary.totalAuthoredModuleCount).toBe(3);
      expect(
        result.frontier.authenticComponentExports.find(
          (item) => item.sourcePath === fixture.widgetsPath,
        ),
      ).toBeUndefined();
    },
  );

  it.each(['planned', 'reverse'] as const)(
    'preserves every export of a frozen optional module without descriptor visual evidence (%s)',
    async (optionalOrder) => {
      const fixture = await createFixture('lazy-first', 'direct');
      expect(
        fixture.optionalSurfaces
          .filter((surface) => surface.sourcePath === fixture.widgetsPath)
          .map((surface) => surface.exportName)
          .sort(),
      ).toEqual(['Footer', 'Widget']);
      const result = await fixture.prepareFrozen(optionalOrder);
      expect(result.rejected).toBe(false);
      expect(result.frontier.authenticSourcePaths).toContain(fixture.widgetsPath);
      expect(
        result.frontier.authenticComponentExports.find(
          (item) => item.sourcePath === fixture.widgetsPath,
        )?.exportNames,
      ).toEqual(['Footer', 'Widget', 'default']);
    },
  );

  it('keeps cached and fresh export contracts equal after optional-surface reordering', async () => {
    const fixture = await createFixture('lazy-first', 'direct');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    try {
      await fixture.prepareFrozen('planned', memo);
      const expected = await fixture.prepareFrozen('reverse');
      expect(await fixture.prepareFrozen('reverse', memo)).toEqual(expected);
      expect(memo.getClosureStatistics()).toMatchObject({ closureComputations: 1, closureHits: 1 });
    } finally {
      memo.release();
    }
  });
});
