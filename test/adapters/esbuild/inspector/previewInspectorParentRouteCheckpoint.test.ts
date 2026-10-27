/** Verifies that an ancestor prefix retains every owner without promoting the outer app body. */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates';
import { resolvePreviewInspectorRuntimeOwnershipTarget } from '../../../../src/adapters/esbuild/inspector/previewInspectorRuntimeOwnershipTarget';
import { createSelectedRouteMountFixture } from './previewInspectorSelectedRouteMountsFixtures';
import { withParentRoutePrefix } from './previewInspectorParentRouteCheckpointFixtures';
import { renderSelectedRouteMounts } from './previewInspectorSelectedRouteMountsRender';
import { createPreviewInspectorVirtualPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import type { SelectedRouteMountFixture } from './previewInspectorSelectedRouteMountsFixtures';

/** Creates a source-backed parent choice with an already-resolved visible child page. */
async function createFixture(): Promise<SelectedRouteMountFixture> {
  return withParentRoutePrefix(
    await createSelectedRouteMountFixture(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-parent-route-checkpoint-')),
    ),
  );
}

describe('selected parent route checkpoints', () => {
  it('uses the nearer proven checkpoint while retaining the outer owner and all nested mounts', async () => {
    const fixture = await createFixture();
    const virtualPage = createPreviewInspectorVirtualPageCandidates(
      fixture.plan.pageCandidates,
      fixture.plan.pageCandidates.length,
      fixture.plan.shallowVisualPaths ?? [],
      'selected-route-leaf',
    )[0];
    expect(virtualPage?.contentCandidate.root).toEqual({
      exportName: 'AreaApp',
      sourcePath: fixture.paths.AreaApp,
    });
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan: fixture.plan,
      targetMode: 'selected-route-leaf',
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.browserCandidate.root).toEqual({
        exportName: 'RootApp',
        sourcePath: fixture.paths.RootApp,
      });
      expect(candidate.criticalSurfaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ exportName: 'RootApp', strategy: 'selected-route-surface' }),
          expect.objectContaining({ exportName: 'AreaApp' }),
          expect.objectContaining({ exportName: 'DetailApp' }),
          expect.objectContaining({ exportName: 'PreviewPage' }),
        ]),
      );
      expect(candidate.routeRecipe?.mounts).toHaveLength(3);
      const surfaceIds = new Set(candidate.criticalSurfaces.map((surface) => surface.id));
      expect(
        candidate.compositionEdges.every(
          (edge) => surfaceIds.has(edge.parentSurfaceId) && surfaceIds.has(edge.childSurfaceId),
        ),
      ).toBe(true);
      expect(
        resolvePreviewInspectorRuntimeOwnershipTarget({
          analysisTarget: fixture.plan.target,
          candidate,
          diagnosticPath: fixture.paths.DetailProvider,
          routeSelection: fixture.selection,
          routeSelectionResolution: 'exact',
          selectedLeafSourceText: fixture.sourceByPath.get(fixture.paths.PreviewPage) ?? '',
          targetMode: 'selected-route-leaf',
        }),
      ).toEqual({ exportName: 'PreviewPage', sourcePath: fixture.paths.PreviewPage });
    }
  });

  it('renders the outer frame, nearer owner, Provider and selected child exactly once', async () => {
    const fixture = await createFixture();
    const candidate = createPreviewInspectorPageExecutionCandidates({
      plan: fixture.plan,
      targetMode: 'selected-route-leaf',
    })[0];
    if (candidate === undefined) throw new Error('Expected a source-proven parent execution.');
    expect(await renderSelectedRouteMounts(fixture, candidate)).toBe(
      '<main data-root=""><section data-area=""><article data-detail=""><p data-leaf="">Selected page body</p></article></section></main>',
    );
  });

  it('keeps the outer owner when no source proof can retain it around a nearer checkpoint', async () => {
    const fixture = await createFixture();
    const candidate = createPreviewInspectorPageExecutionCandidates({
      plan: { ...fixture.plan, shallowVisualPaths: [] },
      targetMode: 'selected-route-leaf',
    })[0];
    expect(candidate?.browserCandidate.root).toEqual({
      exportName: 'RootApp',
      sourcePath: fixture.paths.RootApp,
    });
  });

  it('preserves automatic current-file ownership for the same nested corridor', async () => {
    const fixture = await createFixture();
    const candidate = createPreviewInspectorPageExecutionCandidates({ plan: fixture.plan })[0];
    expect(candidate?.runtimeTargetContract).toMatchObject({
      exportName: 'DetailProvider',
      sourcePath: fixture.paths.DetailProvider,
    });
  });

  it('does not borrow a matching owner checkpoint from a different render path', async () => {
    const fixture = await createFixture();
    const plan = {
      ...fixture.plan,
      pageCandidates: fixture.plan.pageCandidates.map((candidate) =>
        candidate.root.exportName === 'AreaApp' && candidate.renderPath !== undefined
          ? { ...candidate, renderPath: { ...candidate.renderPath, id: 'another-entry-path' } }
          : candidate,
      ),
    };
    const virtualPage = createPreviewInspectorVirtualPageCandidates(
      plan.pageCandidates,
      plan.pageCandidates.length,
      plan.shallowVisualPaths ?? [],
      'selected-route-leaf',
    )[0];
    expect(virtualPage?.contentCandidate.root).toEqual({
      exportName: 'RootApp',
      sourcePath: fixture.paths.RootApp,
    });
  });
});
