/** Keeps ancestor factory context available at the root without reparenting it as a child route. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteBranchPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import { collectPreviewInspectorRouteLocationInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocation';
import {
  FACTORY_ROUTE_SOURCE_ROOT,
  createFactoryProviderRouteOptions,
} from './previewInspectorRouteBranchFactoryOwnerFixtures';

const areaPattern = String.raw`/root/:areaId(\d+)`;
const detailPattern = areaPattern + String.raw`/detail/:kind/:detailId(\d+)`;

describe('factory route context ownership', () => {
  it('retains ancestor entry choices when exploration starts from a shared Provider', async () => {
    const inventory = await collectPreviewInspectorRouteLocationInventory(
      createFactoryProviderRouteOptions(),
    );
    expect(inventory.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'AreaApp', pattern: areaPattern }),
        expect.objectContaining({ componentName: 'DetailApp', pattern: detailPattern }),
      ]),
    );
  });

  it("offers a factory owner's pages without presenting its containing apps as children", async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan(createFactoryProviderRouteOptions());
    expect(plan.branches.filter((branch) => branch.depth > 0)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ componentName: 'AreaApp' })]),
    );
    expect(plan.branches.filter((branch) => branch.componentName === 'AreaApp')).toEqual([
      expect.objectContaining({ depth: 0, pattern: areaPattern }),
    ]);
    expect(plan.branches.filter((branch) => branch.componentName === 'PreviewPage')).toEqual([
      expect.objectContaining({ depth: 1, pattern: detailPattern + '/preview', selectable: true }),
    ]);
  });

  it('keeps an explicit ancestor prefix exact while descending to its source-proven default page', async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...createFactoryProviderRouteOptions(),
      selection: [{ componentName: 'AreaApp', pattern: areaPattern }],
    });
    expect(plan.selectionResolution).toBe('exact');
    expect(plan.activeLocation).toMatchObject({
      componentName: 'EditPage',
      componentSourcePath: `${FACTORY_ROUTE_SOURCE_ROOT}/edit-page.tsx`,
      pattern: detailPattern + '/edit',
    });
    expect(plan.branches.filter((branch) => branch.depth > 0)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ componentName: 'AreaApp' })]),
    );
  });
});
