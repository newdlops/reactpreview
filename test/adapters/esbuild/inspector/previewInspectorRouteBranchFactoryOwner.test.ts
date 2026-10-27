/** Keeps contextual owner routes from hiding a selected factory's source-proven child pages. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteBranchPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import {
  FACTORY_ROUTE_SOURCE_ROOT,
  createFactoryProviderRouteOptions,
} from './previewInspectorRouteBranchFactoryOwnerFixtures';

describe('factory owner route descent', () => {
  it('automatically reaches a real child page when starting from its Provider', async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan(createFactoryProviderRouteOptions());

    expect(plan.activeLocation).toMatchObject({
      componentName: 'EditPage',
      componentSourcePath: `${FACTORY_ROUTE_SOURCE_ROOT}/edit-page.tsx`,
    });
    expect(plan.selectionResolution).toBe('automatic');
    expect(plan.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'DetailApp', childState: 'expanded', depth: 0 }),
        expect.objectContaining({ componentName: 'PreviewPage', selectable: true, depth: 1 }),
        expect.objectContaining({ componentName: 'EditPage', selectable: true, depth: 1 }),
      ]),
    );
    expect(plan.branches.some((branch) => branch.componentName === 'NotFound')).toBe(false);
  });

  it('descends through every factory owner despite contextual parent route evidence', async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...createFactoryProviderRouteOptions(),
      documentPath: `${FACTORY_ROUTE_SOURCE_ROOT}/root-app.tsx`,
      exportName: 'RootApp',
    });

    expect(plan.activeLocation?.componentName).toBe('EditPage');
    expect(plan.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'AreaApp', childState: 'expanded', depth: 0 }),
        expect.objectContaining({ componentName: 'DetailApp', childState: 'expanded', depth: 1 }),
        expect.objectContaining({ componentName: 'EditPage', childState: 'leaf', depth: 2 }),
      ]),
    );
  });

  it('preserves an exact explicit leaf selection and inert sibling metadata', async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...createFactoryProviderRouteOptions(),
      selection: [
        { componentName: 'AreaApp', pattern: '/root/:areaId(\\d+)' },
        { componentName: 'DetailApp', pattern: '/root/:areaId(\\d+)/detail/:kind/:detailId(\\d+)' },
        {
          componentName: 'PreviewPage',
          pattern: '/root/:areaId(\\d+)/detail/:kind/:detailId(\\d+)/preview',
        },
      ],
    });

    expect(plan.selectionResolution).toBe('exact');
    expect(plan.activeLocation?.componentName).toBe('PreviewPage');
    expect(plan.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentName: 'PreviewPage', childState: 'leaf', depth: 2 }),
        expect.objectContaining({
          componentName: 'EditPage',
          childState: 'unknown',
          selectable: true,
          depth: 2,
        }),
      ]),
    );
  });

  it('still terminates at a leaf rediscovering only its containing route', async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...createFactoryProviderRouteOptions(),
      documentPath: `${FACTORY_ROUTE_SOURCE_ROOT}/edit-page.tsx`,
      exportName: 'EditPage',
    });

    expect(plan.activeLocation?.componentName).toBe('EditPage');
    expect(plan.branches.filter((branch) => branch.componentName === 'EditPage')).toEqual([
      expect.objectContaining({ componentName: 'EditPage', depth: 0 }),
    ]);
    expect(plan.branches.every((branch) => branch.depth === 0)).toBe(true);
  });
});
