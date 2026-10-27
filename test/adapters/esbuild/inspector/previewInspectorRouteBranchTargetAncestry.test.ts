/** Keeps automatic route descent on the selected descendant's exact authored render path. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteBranchPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import {
  createFactoryProviderRouteOptions,
  FACTORY_ROUTE_SOURCE_ROOT,
} from './previewInspectorRouteBranchFactoryOwnerFixtures';

/** Adds one concrete page/target path while retaining the fixture's shared Provider and catalog. */
function createDescendantOptions(): ReturnType<typeof createFactoryProviderRouteOptions> {
  const base = createFactoryProviderRouteOptions();
  const targetPath = `${FACTORY_ROUTE_SOURCE_ROOT}/tax-modal.tsx`;
  const pagePath = `${FACTORY_ROUTE_SOURCE_ROOT}/preview-page.tsx`;
  const target = { exportName: 'TaxModal', sourcePath: targetPath };
  return {
    ...base,
    documentPath: targetPath,
    exportName: target.exportName,
    readSource: async (sourcePath) => {
      if (sourcePath === targetPath) return 'export const TaxModal = () => <dialog>tax</dialog>;';
      if (sourcePath === pagePath)
        return 'import { TaxModal } from "./tax-modal"; export const PreviewPage = () => <main><TaxModal /></main>;';
      if (sourcePath === `${FACTORY_ROUTE_SOURCE_ROOT}/pages.json`)
        return (await base.readSource(sourcePath))?.replace(
          '"preview":"PreviewPage"',
          '"":"PreviewPage"',
        );
      return base.readSource(sourcePath);
    },
    renderChain: {
      ...base.renderChain,
      target,
      paths: base.renderChain.paths.map((renderPath) => ({
        ...renderPath,
        steps: [
          ...[
            { label: 'TaxModal', sourcePath: targetPath },
            { label: 'PreviewPage', sourcePath: pagePath },
          ].map((step) => ({
            ...step,
            certainty: 'confirmed' as const,
            kind: 'component-render' as const,
            occurrenceStart: 0,
            wrapperNames: [],
          })),
          ...renderPath.steps,
        ],
      })),
    },
    sourcePaths: [...base.sourcePaths, targetPath],
  };
}

describe('automatic route selection for an authored descendant', () => {
  /** Lexical catalog order must not move a modal from its detail page into an unrelated editor. */
  it('prefers the exact page ancestor over the router owner default', async () => {
    const plan = await collectPreviewInspectorRouteBranchPlan(createDescendantOptions());

    expect(plan.selectionResolution).toBe('automatic');
    expect(plan.activeLocation).toMatchObject({
      componentName: 'PreviewPage',
      componentSourcePath: `${FACTORY_ROUTE_SOURCE_ROOT}/preview-page.tsx`,
    });
    expect(plan.activeLocation?.pathname).toBe(plan.primary?.pathname);
  });

  /** Explicit page choices still take precedence over inferred target affinity. */
  it('retains an explicitly selected sibling route', async () => {
    const base = createFactoryProviderRouteOptions();
    const defaultPlan = await collectPreviewInspectorRouteBranchPlan(base);
    const editBranch = defaultPlan.branches.find((branch) => branch.componentName === 'EditPage');
    if (editBranch === undefined) throw new Error('Fixture edit branch is missing.');
    const plan = await collectPreviewInspectorRouteBranchPlan({
      ...createDescendantOptions(),
      selection: editBranch.selectionPath,
    });

    expect(plan.selectionResolution).toBe('exact');
    expect(plan.activeLocation?.componentName).toBe('EditPage');
  });
});
