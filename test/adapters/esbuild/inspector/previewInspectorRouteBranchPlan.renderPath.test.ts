/** Keeps automatic route selection on its ranked caller path while preserving manual choices. */
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  collectPreviewInspectorRouteBranchPlan,
  type CollectPreviewInspectorRouteBranchPlanOptions,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import type {
  PreviewInspectorRouteLocation,
  PreviewInspectorRouteLocationInventory,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocation';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

const TARGET = '/workspace/src/SharedModal.tsx';
const DETAILS = '/workspace/src/DetailsPage.tsx';
const EDIT = '/workspace/src/EditPage.tsx';
const SHELL = '/workspace/src/CompanyApp.tsx';

/** Supplies exact immutable source identities without reading or executing workspace files. */
function createFixture(): {
  collect: Mock<(documentPath: string) => Promise<PreviewInspectorRouteLocationInventory>>;
  details: PreviewInspectorRouteLocation;
  edit: PreviewInspectorRouteLocation;
  options: CollectPreviewInspectorRouteBranchPlanOptions;
  renderPath: PreviewRenderChainCandidate;
} {
  const renderPath: PreviewRenderChainCandidate = {
    id: 'details-caller',
    steps: [
      { sourcePath: TARGET, label: 'SharedModal' },
      { sourcePath: DETAILS, label: 'DetailsPage' },
      { sourcePath: SHELL, label: 'CompanyApp' },
    ].map((step) => ({
      ...step,
      certainty: 'confirmed' as const,
      kind: 'component-render' as const,
      occurrenceStart: 0,
      wrapperNames: [],
    })),
  };
  const location = (
    componentName: string,
    componentSourcePath: string,
    pattern: string,
  ): PreviewInspectorRouteLocation => ({
    componentExportName: componentName,
    componentName,
    componentSourcePath,
    dependencyPaths: [TARGET, componentSourcePath],
    evidenceKind: 'route-catalog',
    pathname: pattern,
    pattern,
    sourcePath: SHELL,
  });
  const edit = location('EditPage', EDIT, '/company/meeting/edit');
  const details = location('DetailsPage', DETAILS, '/company/meeting');
  const shell = location('CompanyApp', SHELL, '/company');
  const collect = vi.fn<(documentPath: string) => Promise<PreviewInspectorRouteLocationInventory>>(
    (documentPath) =>
      Promise.resolve({
        ...(documentPath === TARGET ? { primary: edit } : {}),
        choices: documentPath === TARGET ? [edit, shell, details] : [],
        fallbackCount: 0,
        unresolvedFactoryRoutes: false,
      }),
  );
  const options: CollectPreviewInspectorRouteBranchPlanOptions = {
    documentPath: TARGET,
    exportName: 'SharedModal',
    readSource: () => Promise.resolve(undefined),
    renderChain: {
      dependencyPaths: [TARGET, DETAILS, EDIT, SHELL],
      paths: [renderPath],
      reachability: 'entry-connected',
      target: { sourcePath: TARGET, exportName: 'SharedModal' },
      truncated: false,
    },
    sourcePaths: [TARGET, DETAILS, EDIT, SHELL],
    ownerLocationInventoryMemo: { collect, release: () => undefined },
    preferredRenderPath: renderPath,
  };
  return { collect, details, edit, options, renderPath };
}

describe('route selection for a ranked consuming path', () => {
  it('keeps the same caller through a context-only intermediate module', async () => {
    const { collect, options } = createFixture();
    const inventory = await collect(TARGET);
    collect.mockImplementation((documentPath) =>
      Promise.resolve(
        documentPath === TARGET || documentPath === DETAILS
          ? inventory
          : { choices: [], fallbackCount: 0, unresolvedFactoryRoutes: false },
      ),
    );

    const plan = await collectPreviewInspectorRouteBranchPlan(options);

    expect(plan.activeLocation?.componentName).toBe('DetailsPage');
    expect(plan.branches.find((branch) => branch.id === plan.selectedBranchId)?.childState).toBe(
      'leaf',
    );
  });

  it("preserves a nested router's owned child default instead of promoting its own self route", async () => {
    const { collect, options } = createFixture();
    const inventory = await collect(TARGET);
    const owned = inventory.choices
      .filter((choice) => choice.componentName !== 'CompanyApp')
      .map((choice) => ({
        ...choice,
        routeMounts: [
          {
            basePath: '/company/meeting',
            contextOrigin: 'virtual-page-owner' as const,
            contextPattern: '/company/meeting/*',
            exportName: 'DetailsPage',
            hasWildcardFallback: false,
            routeSlotCount: 2,
            sourcePath: DETAILS,
          },
        ],
      }));
    collect.mockImplementation((documentPath) =>
      Promise.resolve(
        documentPath === TARGET
          ? inventory
          : documentPath === DETAILS
            ? { ...inventory, choices: owned }
            : { choices: [], fallbackCount: 0, unresolvedFactoryRoutes: false },
      ),
    );

    const plan = await collectPreviewInspectorRouteBranchPlan(options);

    expect(plan.activeLocation?.componentName).toBe('EditPage');
  });

  it('selects the nearest exact caller instead of an earlier sibling or shorter shell', async () => {
    const { collect, options } = createFixture();
    const plan = await collectPreviewInspectorRouteBranchPlan(options);

    expect(plan.activeLocation?.componentName).toBe('DetailsPage');
    expect(plan.selectionResolution).toBe('automatic');
    expect(
      plan.branches.filter((branch) => branch.depth === 0).map((branch) => branch.componentName),
    ).toEqual(['EditPage', 'CompanyApp', 'DetailsPage']);
    expect(collect.mock.calls.map(([sourcePath]) => sourcePath)).toEqual([TARGET, DETAILS]);
  });

  it('preserves an explicit sibling selection even when it is outside the preferred path', async () => {
    const { edit, options } = createFixture();
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...options,
      selection: [{ componentName: edit.componentName, pattern: edit.pattern }],
    });

    expect(plan.activeLocation?.componentName).toBe('EditPage');
    expect(plan.selectionResolution).toBe('exact');
  });

  it('keeps the historical default when no ranked render path is available', async () => {
    const { options } = createFixture();
    const { preferredRenderPath, ...withoutPreference } = options;
    expect(preferredRenderPath).toBeDefined();
    const plan = await collectPreviewInspectorRouteBranchPlan(withoutPreference);

    expect(plan.activeLocation?.componentName).toBe('EditPage');
  });

  it('does not admit a same-named component from another source', async () => {
    const { options, renderPath } = createFixture();
    const differentSource: PreviewRenderChainCandidate = {
      ...renderPath,
      steps: renderPath.steps.map((step) => ({ ...step, sourcePath: '/other/' + step.label })),
    };
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...options,
      preferredRenderPath: differentSource,
      renderChain: { ...options.renderChain, paths: [differentSource] },
    });

    expect(plan.activeLocation?.componentName).toBe('EditPage');
  });

  it("ignores a path that is not part of this request's proven render evidence", async () => {
    const { options, renderPath } = createFixture();
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...options,
      preferredRenderPath: { ...renderPath },
    });

    expect(plan.activeLocation?.componentName).toBe('EditPage');
  });
});
