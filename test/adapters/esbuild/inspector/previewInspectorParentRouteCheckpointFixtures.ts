/** Adds the source-proven owner corridor produced by an explicit ancestor-prefix selection. */
import type { SelectedRouteMountFixture } from './previewInspectorSelectedRouteMountsFixtures';

/** Preserves the existing fixture sources while modeling the full outer-to-inner route proof. */
export function withParentRoutePrefix(
  fixture: SelectedRouteMountFixture,
): SelectedRouteMountFixture {
  const areaPattern = String.raw`/root/:areaId(\d+)`;
  const pageCandidates = fixture.plan.pageCandidates.map((candidate) => {
    const location = candidate.routeLocation;
    if (location === undefined || !('routeMounts' in location)) {
      throw new Error('The parent-prefix model requires generic nested route evidence.');
    }
    return {
      ...candidate,
      routeLocation: {
        ...location,
        routeMounts: [
          {
            basePath: '/root',
            contextOrigin: 'virtual-page-owner' as const,
            contextPattern: '/root/*',
            exportName: 'RootApp',
            hasWildcardFallback: false,
            routeSlotCount: 1,
            sourcePath: fixture.paths.RootApp,
          },
          {
            basePath: areaPattern,
            contextPattern: areaPattern,
            exportName: 'AreaApp',
            hasWildcardFallback: false,
            routeSlotCount: 1,
            sourcePath: fixture.paths.AreaApp,
          },
          ...(location.routeMounts ?? []),
        ],
      },
    };
  });
  return {
    ...fixture,
    plan: { ...fixture.plan, pageCandidates },
    selection: [{ componentName: 'AreaApp', pattern: areaPattern }],
  };
}
