/** Checks deepest exact-owner mount selection without executing authored factory code. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorTypes';
import type { PreviewInspectorRouteMountEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocation';
import { createPreviewInspectorVirtualPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import { APP_PATH, TARGET_PATH, createCandidate } from './previewInspectorVirtualPagePlanFixtures';

const owner = Object.freeze({ exportName: 'Application', sourcePath: APP_PATH });

/** Builds immutable metadata with distinct diagnostics so partial first-match selection is visible. */
function mount(
  basePath: string,
  overrides: Partial<PreviewInspectorRouteMountEvidence> = {},
): PreviewInspectorRouteMountEvidence {
  return Object.freeze({
    ...owner,
    basePath,
    hasWildcardFallback: false,
    routeSlotCount: 1,
    ...overrides,
  });
}

/** Uses the public candidate planner and preserves the supplied outer-to-inner array identity. */
function select(
  routeMounts: readonly PreviewInspectorRouteMountEvidence[],
): PreviewInspectorPageCandidate {
  const authored = createCandidate({
    complete: true,
    id: 'repeated-owner',
    root: owner,
    rootStepIndex: 2,
    stopReason: 'root-reached',
    routeLocation: {
      componentName: 'SelectedPage',
      componentExportName: 'default',
      componentSourcePath: TARGET_PATH,
      dependencyPaths: [APP_PATH, TARGET_PATH],
      evidenceKind: 'route-catalog',
      pathname: '/inner/leaf',
      pattern: '/inner/leaf',
      routeMounts,
      sourcePath: APP_PATH,
    },
  });
  const selected = createPreviewInspectorVirtualPageCandidates([authored])[0];
  if (selected === undefined) throw new Error('A proven standalone owner must remain available.');
  expect(selected.contentCandidate).toBe(authored);
  return selected.browserCandidate;
}

describe('VirtualPage exact-owner route mount selection', () => {
  it('uses the last matching mount and all of its scalar diagnostics', () => {
    const outer = mount('/longer/outer/prefix');
    const inner = mount('/inner', { hasWildcardFallback: true, routeSlotCount: 3 });
    const mounts = Object.freeze([outer, inner]);
    const selected = select(mounts);

    expect(selected).toMatchObject({
      routeMountBasePath: '/inner',
      routeSlotCount: 3,
      wildcardFallbackPresent: true,
    });
    const location = selected.routeLocation;
    expect(
      location !== undefined && 'routeMounts' in location ? location.routeMounts : undefined,
    ).toBe(mounts);
    expect(mounts).toEqual([outer, inner]);
  });

  it('normalizes source paths before selecting the deepest owner', () => {
    const normalizedAlias = path.dirname(APP_PATH) + '/nested/../' + path.basename(APP_PATH);
    const selected = select(
      Object.freeze([
        mount('/outer'),
        mount('/inner', { sourcePath: normalizedAlias, routeSlotCount: 2 }),
      ]),
    );

    expect(selected.routeMountBasePath).toBe('/inner');
    expect(selected.routeSlotCount).toBe(2);
  });

  it.each([
    ['different export', { exportName: 'OtherApplication' }],
    ['different source', { sourcePath: '/workspace/OtherApp.tsx' }],
  ])('skips a later %s while retaining the deepest exact match', (_label, mismatch) => {
    const selected = select(
      Object.freeze([
        mount('/outer'),
        mount('/inner', { hasWildcardFallback: true, routeSlotCount: 3 }),
        mount('/unrelated', { ...mismatch, routeSlotCount: 99 }),
      ]),
    );

    expect(selected).toMatchObject({
      routeMountBasePath: '/inner',
      routeSlotCount: 3,
      wildcardFallbackPresent: true,
    });
  });

  it.each([
    ['different export', { exportName: 'OtherApplication' }],
    ['different source', { sourcePath: '/workspace/OtherApp.tsx' }],
  ])('omits localization metadata when every mount has a %s', (_label, mismatch) => {
    const selected = select(Object.freeze([mount('/unrelated', mismatch)]));

    expect(selected.routeMountBasePath).toBeUndefined();
    expect(selected.routeSlotCount).toBeUndefined();
    expect(selected.wildcardFallbackPresent).toBeUndefined();
  });
});
