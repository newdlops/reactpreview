/** Preserves nested source proof and visible composition across an explicit route-leaf choice. */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates';
import { createPreviewInspectorExecutablePlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutablePlan';
import { mergeVirtualPageOwnerRouteMounts } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageOwnerRouteMount';
import { resolvePreviewInspectorRuntimeOwnershipTarget } from '../../../../src/adapters/esbuild/inspector/previewInspectorRuntimeOwnershipTarget';
import { createSelectedRouteMountFixture } from './previewInspectorSelectedRouteMountsFixtures';
import { renderSelectedRouteMounts } from './previewInspectorSelectedRouteMountsRender';
import type { SelectedRouteMountFixture } from './previewInspectorSelectedRouteMountsFixtures';

/** Creates isolated, canonical source-backed compiler-stage evidence. */
async function createFixture(): Promise<SelectedRouteMountFixture> {
  return createSelectedRouteMountFixture(
    await mkdtemp(path.join(os.tmpdir(), 'react-preview-selected-route-mounts-')),
  );
}

describe('selected route mounts across a shared page checkpoint', () => {
  it('keeps automatic ownership on the current-file Provider', async () => {
    const fixture = await createFixture();
    const candidate = createPreviewInspectorPageExecutionCandidates({ plan: fixture.plan })[0];
    expect(candidate?.runtimeTargetContract).toMatchObject({
      sourcePath: fixture.paths.DetailProvider,
      exportName: 'DetailProvider',
    });
    expect(candidate?.routeRecipe?.mounts).toHaveLength(1);
  });

  it('retains both owner mounts for every offered explicit leaf execution', async () => {
    const fixture = await createFixture();
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan: fixture.plan,
      targetMode: 'selected-route-leaf',
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const target = resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget: fixture.plan.target,
        candidate,
        diagnosticPath: fixture.paths.DetailProvider,
        routeSelection: fixture.selection,
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: fixture.sourceByPath.get(fixture.paths.PreviewPage) ?? '',
        targetMode: 'selected-route-leaf',
      });
      expect(target).toEqual({ exportName: 'PreviewPage', sourcePath: fixture.paths.PreviewPage });
      const owners = candidate.routeRecipe?.mounts.map(
        (mount) =>
          candidate.criticalSurfaces.find((surface) => surface.id === mount.parentSurfaceId)
            ?.exportName,
      );
      expect(owners).toEqual(['RootApp', 'DetailApp']);
    }
  });

  it('carries explicit route intent into the narrowed build plan without changing analysis ownership', async () => {
    const fixture = await createFixture();
    const plan = createPreviewInspectorExecutablePlan(
      fixture.plan,
      undefined,
      'selected-route-leaf',
    );
    expect(plan.target).toEqual(fixture.plan.target);
    expect(plan.root).toEqual({ sourcePath: fixture.paths.AreaApp, exportName: 'AreaApp' });
    const location = plan.pageCandidates[0]?.routeLocation;
    expect(
      location !== undefined && 'routeMounts' in location ? location.routeMounts : [],
    ).toHaveLength(1);
  });

  it('preserves existing mount provenance when an outer owner is repeated, equal-base, or unrelated', async () => {
    const fixture = await createFixture();
    const location = fixture.plan.pageCandidates[0]?.routeLocation;
    const mounts =
      location !== undefined && 'routeMounts' in location ? location.routeMounts : undefined;
    const mount = mounts?.[0];
    if (mounts === undefined || mount === undefined)
      throw new Error('Expected authored nested evidence.');
    for (const owner of [
      { ...mount, contextOrigin: 'virtual-page-owner' as const },
      { ...mount, sourcePath: fixture.paths.RootApp, exportName: 'RootApp' },
      {
        ...mount,
        sourcePath: fixture.paths.RootApp,
        exportName: 'RootApp',
        basePath: '/unrelated',
      },
    ]) {
      expect(mergeVirtualPageOwnerRouteMounts(mounts, owner)).toEqual(mounts);
    }
  });

  it('renders the root, authored checkpoint, inner owner and page once in order', async () => {
    const fixture = await createFixture();
    const candidate = createPreviewInspectorPageExecutionCandidates({
      plan: fixture.plan,
      targetMode: 'selected-route-leaf',
    })[0];
    if (candidate === undefined) throw new Error('Expected a selected page execution.');
    const html = await renderSelectedRouteMounts(fixture, candidate);
    expect(html).toBe(
      '<main data-root=""><section data-area=""><article data-detail=""><p data-leaf="">Selected page body</p></article></section></main>',
    );
  });

  it('keeps malformed route order rejected by the original ownership guard', async () => {
    const fixture = await createFixture();
    const candidate = createPreviewInspectorPageExecutionCandidates({
      plan: fixture.plan,
      targetMode: 'selected-route-leaf',
    })[0];
    if (candidate === undefined) throw new Error('Expected a selected page execution.');
    expect(() =>
      resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget: fixture.plan.target,
        candidate,
        diagnosticPath: fixture.paths.DetailProvider,
        routeSelection: [...fixture.selection].reverse(),
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: fixture.sourceByPath.get(fixture.paths.PreviewPage) ?? '',
        targetMode: 'selected-route-leaf',
      }),
    ).toThrow(/exact nested route selection|reordered nested mount edge/u);
  });
});
