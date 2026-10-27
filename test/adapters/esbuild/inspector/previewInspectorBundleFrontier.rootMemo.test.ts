/** Verifies resolved graph reuse respects authored-path and Vite glob root boundaries. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

/** Prepares real source inventories while callers vary only immutable path-resolution boundaries. */
async function createFixture(sources: ReadonlyMap<string, string>, sourcePath: string) {
  const readSource = (file: string): Promise<string | undefined> =>
    Promise.resolve(sources.get(file));
  const resolveModule = (specifier: string, importer: string): string | undefined => {
    if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return undefined;
    const resolved = path.resolve(path.dirname(importer), specifier);
    return [resolved, resolved + '.tsx', resolved + '.ts'].find((file) => sources.has(file));
  };
  const plan = await createPreviewInspectorAncestorPlan({
    documentPath: sourcePath,
    exportName: 'Root',
    readSource,
    resolveModule,
    sourcePaths: [...sources.keys()],
  });
  const browserCandidate = plan.pageCandidates[0];
  if (browserCandidate === undefined) throw new Error('Expected an authored root candidate.');
  const surface = {
    bypassedWrapperNames: [],
    exportName: 'Root',
    id: 'root',
    omittedTopLevelEffectCount: 0,
    sourcePath,
    strategy: 'authentic-module-export' as const,
    watchSourcePaths: [sourcePath],
  };
  const role = { exportName: 'Root', sourcePath, surfaceId: surface.id };
  const executionCandidate: PreviewInspectorPageExecutionCandidate = {
    browserCandidate,
    compositionEdges: [],
    criticalSurfaces: [surface],
    evidenceSourcePaths: [],
    executionRootContract: role,
    executionRootSurfaceId: surface.id,
    fidelity: 'page-authentic',
    id: 'selected',
    optionalSurfaces: [],
    runtimeTargetContract: role,
    runtimeTargetSurfaceId: surface.id,
    watchSourcePaths: [sourcePath],
  };
  const policy = createPreviewCompilerFrontierPolicy('fast');
  if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
  return (
    workspaceRoot: string,
    projectRoot?: string,
    sourceInventoryMemo?: PreviewInspectorBundleSourceInventoryMemo,
  ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
    preparePreviewInspectorBundleFrontier({
      executionCandidate,
      plan,
      policy,
      readSource,
      resolveModule,
      workspaceRoot,
      ...(projectRoot === undefined ? {} : { projectRoot }),
      ...(sourceInventoryMemo === undefined ? {} : { sourceInventoryMemo }),
    });
}

describe('Page Execution resolved graph root isolation', () => {
  it.each(['broad-first', 'narrow-first'] as const)(
    'rechecks authored import membership when workspace scope changes (%s)',
    async (order) => {
      const sourcePath = '/workspace/app/Root.tsx';
      const sharedPath = '/workspace/shared.ts';
      const prepare = await createFixture(
        new Map([
          [
            sourcePath,
            "import { value } from '../shared'; export function Root() { return <main>{value}</main>; }",
          ],
          [sharedPath, 'export const value = 1;'],
        ]),
        sourcePath,
      );
      const roots =
        order === 'broad-first'
          ? ['/workspace', '/workspace/app']
          : ['/workspace/app', '/workspace'];
      const memo = createPreviewInspectorBundleSourceInventoryMemo();
      try {
        const first = roots[0];
        const second = roots[1];
        if (first === undefined || second === undefined) throw new Error('Expected two roots.');
        await prepare(first, first, memo);
        const expected = await prepare(second, second);
        expect(expected.rejected).toBe(false);
        expect(expected.frontier.authenticSourcePaths.includes(sharedPath)).toBe(
          second === '/workspace',
        );
        expect(await prepare(second, second, memo)).toEqual(expected);
      } finally {
        memo.release();
      }
    },
  );

  it.each(['first', 'second'] as const)(
    'expands root-relative Vite glob imports for the current project (%s first)',
    async (initialProject) => {
      const workspace = await mkdtemp(path.join(os.tmpdir(), 'preview-root-memo-'));
      const memo = createPreviewInspectorBundleSourceInventoryMemo();
      try {
        const sourcePath = path.join(workspace, 'Root.tsx');
        const sources = new Map([
          [
            sourcePath,
            "export const modules = import.meta.glob('/assets/*.ts', { eager: true }); export function Root() { return null; }",
          ],
        ]);
        for (const project of ['first', 'second']) {
          const asset = path.join(workspace, project, 'assets', 'data.ts');
          const contents = 'export const value = ' + JSON.stringify(project) + ';';
          await mkdir(path.dirname(asset), { recursive: true });
          await writeFile(asset, contents);
          sources.set(asset, contents);
        }
        await writeFile(sourcePath, sources.get(sourcePath) ?? '');
        const prepare = await createFixture(sources, sourcePath);
        const nextProject = initialProject === 'first' ? 'second' : 'first';
        const initialRoot = path.join(workspace, initialProject);
        const nextRoot = path.join(workspace, nextProject);
        await prepare(workspace, initialRoot, memo);
        const expected = await prepare(workspace, nextRoot);
        expect(expected.rejected).toBe(false);
        expect(expected.frontier.authenticSourcePaths).toContain(
          path.join(nextRoot, 'assets', 'data.ts'),
        );
        expect(expected.frontier.authenticSourcePaths).not.toContain(
          path.join(initialRoot, 'assets', 'data.ts'),
        );
        expect(await prepare(workspace, nextRoot, memo)).toEqual(expected);
      } finally {
        memo.release();
        await rm(workspace, { recursive: true, force: true });
      }
    },
  );
});
