/** Covers replay behavior for previewInspectorCompleteRouteInventory. */
/** Verifies authored-source previewInspectorCompleteRouteInventory invariants. */
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CollectPreviewInspectorRouteBranchPlanOptions,
  PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';

import {
  collectPreviewInspectorCompleteRouteInventory,
  replayPreviewInspectorCompleteRouteEntry,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';

import {
  createFixtureOptions,
  createOptionsFromSources,
  ROOT,
  type OwnerMemoAudit,
  type PrefixProvider,
  type PrefixProviderAudit,
} from './previewInspectorCompleteRouteInventoryFixtures';

const ownerMemoAudit = vi.hoisted(() => ({
  instances: [] as OwnerMemoAudit[],
  prefixInstances: [] as PrefixProviderAudit[],
  providerDisabledOracle: false,
  publicBranchPlans: 0,
}));

vi.mock(
  '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan')
      >();
    return {
      ...actual,
      collectPreviewInspectorRouteBranchPlan(
        options: CollectPreviewInspectorRouteBranchPlanOptions,
      ) {
        const audit = ownerMemoAudit.instances.find(
          (candidate) => candidate.provider === options.ownerLocationInventoryMemo,
        );
        if (audit === undefined) {
          ownerMemoAudit.publicBranchPlans += 1;
        } else {
          audit.branchPlans += 1;
        }
        if (!ownerMemoAudit.providerDisabledOracle) {
          return actual.collectPreviewInspectorRouteBranchPlan(options);
        }
        const { selectionPrefixProvider: _selectionPrefixProvider, ...oracleOptions } = options;
        void _selectionPrefixProvider;
        return actual.collectPreviewInspectorRouteBranchPlan(oracleOptions);
      },
      createPreviewInspectorRouteBranchSelectionPrefixProvider() {
        const retained = actual.createPreviewInspectorRouteBranchSelectionPrefixProvider();
        const audit: PrefixProviderAudit = {
          createdAfterPreviousRelease: ownerMemoAudit.prefixInstances.every(
            (candidate) => candidate.releases === 1,
          ),
          releases: 0,
        };
        const provider: PrefixProvider = Object.freeze({
          ...retained,
          release: () => {
            audit.preReleaseStatistics = retained.getStatistics();
            retained.release();
            audit.postReleaseStatistics = retained.getStatistics();
            audit.releases += 1;
          },
        });
        audit.provider = provider;
        ownerMemoAudit.prefixInstances.push(audit);
        return provider;
      },
      createPreviewInspectorRouteOwnerLocationInventoryMemo(
        options: Parameters<typeof actual.createPreviewInspectorRouteOwnerLocationInventoryMemo>[0],
      ) {
        const retained = actual.createPreviewInspectorRouteOwnerLocationInventoryMemo(options);
        const audit: OwnerMemoAudit = {
          branchPlans: 0,
          hits: 0,
          identities: new Set<string>(),
          misses: 0,
          releases: 0,
          requests: 0,
        };
        const provider: PreviewInspectorRouteOwnerLocationInventoryMemo = Object.freeze({
          collect: (documentPath: string, exportName: string) => {
            audit.requests += 1;
            const identity = JSON.stringify([path.normalize(documentPath), exportName]);
            if (audit.identities.has(identity)) {
              audit.hits += 1;
            } else {
              audit.identities.add(identity);
              audit.misses += 1;
            }
            return retained.collect(documentPath, exportName);
          },
          release: () => {
            retained.release();
            audit.releases += 1;
          },
        });
        audit.provider = provider;
        ownerMemoAudit.instances.push(audit);
        return provider;
      },
    };
  },
);

describe('complete Preview Inspector route inventory', () => {
  beforeEach(() => {
    ownerMemoAudit.instances.length = 0;
    ownerMemoAudit.prefixInstances.length = 0;
    ownerMemoAudit.providerDisabledOracle = false;
    ownerMemoAudit.publicBranchPlans = 0;
  });

  it('demotes inert exact routes when the real fast planner cannot reproduce them', async () => {
    const inventory = await collectPreviewInspectorCompleteRouteInventory({
      ...createFixtureOptions(),
      prepareExecutionPlan: () => Promise.resolve(undefined),
    });

    expect(inventory.counts.runnable).toBe(0);
    expect(
      inventory.entries.some(
        (entry) =>
          entry.disposition === 'unresolved' && entry.reason === 'execution-plan-unavailable',
      ),
    ).toBe(true);
  });

  it('accounts an unprovable dynamic direct route as unresolved instead of dropping it', async () => {
    const dynamicLeaf = path.join(path.sep, 'workspace', 'src', 'DynamicLeaf.tsx');
    const sources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import DynamicLeaf from './DynamicLeaf';
          export default function App() {
            return <Routes><Route path={readPath()} element={<DynamicLeaf />} /></Routes>;
          }
        `,
      ],
      [dynamicLeaf, 'export default function DynamicLeaf() { return <main />; }'],
    ]);
    const options = createOptionsFromSources(sources);
    const inventory = await collectPreviewInspectorCompleteRouteInventory(options);

    expect(inventory.complete).toBe(true);
    expect(inventory.entries).toEqual([
      expect.objectContaining({
        componentName: 'DynamicLeaf',
        disposition: 'unresolved',
        reason: 'catalog-unresolved',
      }),
    ]);
    expect(inventory.counts.total).toBe(
      inventory.counts.runnable + inventory.counts.unresolved + inventory.counts.duplicate,
    );
  });

  it('expands an exact component-base owner through factory pages and a nested submodule', async () => {
    const sectionApp = path.join(path.sep, 'workspace', 'src', 'SectionApp.tsx');
    const managementApp = path.join(path.sep, 'workspace', 'src', 'ManagementApp.tsx');
    const listPage = path.join(path.sep, 'workspace', 'src', 'ListPage.tsx');
    const detailsPage = path.join(path.sep, 'workspace', 'src', 'DetailsPage.tsx');
    const createModule = path.join(path.sep, 'workspace', 'src', 'create-section-module.ts');
    const createModuleBase = path.join(
      path.sep,
      'workspace',
      'src',
      'create-section-module-base.tsx',
    );
    const registry = path.join(path.sep, 'workspace', 'src', 'route-registry.ts');
    const catalog = path.join(path.sep, 'workspace', 'src', 'routes.json');
    const sources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import { SectionApp } from './SectionApp';
          export default function App() {
            return <Routes>
              <Route path={normalize(\`\${SectionApp.basePath}/*\`)} element={<SectionApp />} />
            </Routes>;
          }
        `,
      ],
      [
        sectionApp,
        `
          import { createSectionModule } from './create-section-module';
          import { ListPage } from './ListPage';
          import { ManagementApp } from './ManagementApp';
          export const SectionApp = createSectionModule(
            '/section',
            { ListPage },
            [ManagementApp],
            ({ generatedPages, generatedModules }) =>
              <Routes>{generatedPages}{generatedModules}</Routes>,
          );
        `,
      ],
      [
        managementApp,
        `
          import { createSectionModule } from './create-section-module';
          import { DetailsPage } from './DetailsPage';
          export const ManagementApp = createSectionModule(
            '/section/manage',
            { DetailsPage },
            [],
            ({ generatedPages, generatedModules }) =>
              <Routes>{generatedPages}{generatedModules}</Routes>,
          );
        `,
      ],
      [
        createModule,
        `
          import { createSectionModuleBase } from './create-section-module-base';
          import { routeNamePathMap } from './route-registry';
          export const createSectionModule = createSectionModuleBase(routeNamePathMap);
        `,
      ],
      [
        createModuleBase,
        `
          export const createSectionModuleBase = (catalog) =>
            (basePath, pages, subModules, Component) =>
              withProps({
                generatedPages: Object.entries(pages).map(([name, Page]) => <Route />),
                generatedModules: subModules.map((App) => <Route />),
              })(Component);
        `,
      ],
      [
        registry,
        `
          import routeData from './routes.json';
          const pathNameMap = normalizeCatalog(routeData);
          export const routeNamePathMap = invert(pathNameMap);
        `,
      ],
      [
        catalog,
        JSON.stringify({
          section: {
            index: 'ListPage',
            manage: { details: 'DetailsPage' },
          },
        }),
      ],
      [listPage, 'export function ListPage() { return <main />; }'],
      [detailsPage, 'export function DetailsPage() { return <main />; }'],
    ]);
    const options = createOptionsFromSources(sources);
    const inventory = await collectPreviewInspectorCompleteRouteInventory(options);
    const runnable = inventory.entries.filter((entry) => entry.disposition === 'runnable');
    const nested = runnable.find((entry) => entry.componentName === 'DetailsPage');

    expect(runnable.map((entry) => entry.pattern)).toEqual(
      expect.arrayContaining(['/section', '/section/manage/details']),
    );
    expect(nested?.selection).toHaveLength(3);
    expect(
      inventory.entries.some(
        (entry) =>
          entry.disposition === 'duplicate' &&
          entry.componentName === 'SectionApp' &&
          entry.reason === 'expanded-owner',
      ),
    ).toBe(true);
    expect(
      inventory.entries.some(
        (entry) =>
          entry.disposition === 'duplicate' &&
          entry.componentName === 'ManagementApp' &&
          entry.reason === 'expanded-owner',
      ),
    ).toBe(true);
    expect(inventory.counts.total).toBe(
      inventory.counts.runnable + inventory.counts.unresolved + inventory.counts.duplicate,
    );
    expect(nested?.disposition).toBe('runnable');
    if (nested?.disposition !== 'runnable') {
      throw new Error('Factory fixture did not produce its nested page.');
    }
    await expect(replayPreviewInspectorCompleteRouteEntry(options, nested)).resolves.toEqual({
      exact: true,
      replay: nested.replay,
    });
    expect(nested.executionPlan.routeId).toBe(nested.id);
  });
});
