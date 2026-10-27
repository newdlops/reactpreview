/** Retains the selected child page below an instrumented Provider without admitting route siblings. */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import { createPreviewInspectorExecutablePlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutablePlan';
import { createPreviewInspectorPageExecutionCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates';
import { createPreviewInspectorCorridorPlugin } from '../../../../src/adapters/esbuild/inspector/previewInspectorCorridorPlugin';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import { createActiveFactoryLeafFixture } from './previewInspectorActiveFactoryLeafFixtures';

describe('active page content below an inspected factory Provider', () => {
  it.each(['lazy', 'reexport'] as const)(
    'retains automatic selected content through a %s export',
    async (style) => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), 'react-preview-active-factory-leaf-'),
      );
      const fixture = await createActiveFactoryLeafFixture(workspaceRoot, style);
      const plan = createPreviewInspectorExecutablePlan(await fixture.createPlan(), undefined);
      expect(plan.pageCandidates[0]?.routeLocation).toMatchObject({ componentName: 'EditPage' });
      const candidate = createPreviewInspectorPageExecutionCandidates({ plan })[0];
      if (candidate === undefined) throw new Error('Expected an authored factory execution.');
      expect(candidate.runtimeTargetContract).toMatchObject({
        exportName: 'DetailProvider',
        sourcePath: fixture.providerPath,
      });
      const policy = createPreviewCompilerFrontierPolicy('corridor');
      if (policy === undefined) throw new Error('Expected a corridor policy.');
      const prepared = await preparePreviewInspectorBundleFrontier({
        plan,
        executionCandidate: candidate,
        policy,
        ...fixture,
      });
      expect(prepared.rejected).toBe(false);
      expect(prepared.frontier.authenticSourcePaths).toContain(fixture.leafPaths.EditPage);
      expect(prepared.frontier.authenticSourcePaths).not.toContain(fixture.leafPaths.PreviewPage);
      const result = await build({
        absWorkingDir: fixture.workspaceRoot,
        bundle: true,
        entryPoints: [fixture.appPath],
        format: 'esm',
        jsx: 'automatic',
        metafile: true,
        external: ['react', 'react/jsx-runtime'],
        write: false,
        plugins: [
          createPreviewInspectorCorridorPlugin({
            plan,
            workspaceRoot: fixture.workspaceRoot,
            projectRoot: fixture.workspaceRoot,
            resolveModule: fixture.resolveModule,
            frozenAuthenticSourcePaths: prepared.frontier.authenticSourcePaths,
            authenticComponentExports: prepared.frontier.authenticComponentExports,
            projectedEdges: prepared.frontier.projectedEdges,
            optimizeSelectedPackageBarrels: false,
          }),
        ],
      });
      const source = result.outputFiles.map((file) => file.text).join('\n');
      expect(source).toContain('ACTIVE_EDIT_BODY');
      expect(source).not.toContain('ACTIVE_PREVIEW_BODY');
      const inputs = Object.keys(result.metafile.inputs);
      expect(
        inputs.some(
          (key) => path.resolve(fixture.workspaceRoot, key) === fixture.leafPaths.EditPage,
        ),
      ).toBe(true);
      expect(
        inputs.some(
          (key) => path.resolve(fixture.workspaceRoot, key) === fixture.leafPaths.PreviewPage,
        ),
      ).toBe(false);
    },
  );

  it('changes same-module selected content when reusing one source inventory memo', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'react-preview-active-factory-leaf-'),
    );
    const fixture = await createActiveFactoryLeafFixture(workspaceRoot);
    const sourceInventoryMemo = createPreviewInspectorBundleSourceInventoryMemo();
    const policy = createPreviewCompilerFrontierPolicy('corridor');
    if (policy === undefined) throw new Error('Expected a corridor policy.');
    for (const selected of [undefined, 'PreviewPage', undefined] as const) {
      const plan = createPreviewInspectorExecutablePlan(
        await fixture.createPlan(selected),
        undefined,
      );
      const candidate = createPreviewInspectorPageExecutionCandidates({ plan })[0];
      if (candidate === undefined) throw new Error('Expected an authored factory execution.');
      const active = selected ?? 'EditPage';
      const inactive = active === 'EditPage' ? 'PreviewPage' : 'EditPage';
      const prepared = await preparePreviewInspectorBundleFrontier({
        plan,
        executionCandidate: candidate,
        policy,
        sourceInventoryMemo,
        ...fixture,
      });
      expect(prepared.frontier.authenticSourcePaths).toContain(fixture.leafPaths[active]);
      expect(prepared.frontier.authenticSourcePaths).not.toContain(fixture.leafPaths[inactive]);
    }
  });
});
