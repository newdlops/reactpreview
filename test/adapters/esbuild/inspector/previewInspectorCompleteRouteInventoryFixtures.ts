/** Shared deterministic fixtures for previewInspectorCompleteRouteInventory regression scenarios. */
import path from 'node:path';
import type { PreviewInspectorBundleDiagnostics } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';
import {
  collectPreviewInspectorCompleteRouteInventory,
  type CollectPreviewInspectorCompleteRouteInventoryOptions,
  type PreviewInspectorCompleteRouteInventory,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import type {
  CollectPreviewInspectorRouteBranchPlanOptions,
  PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import { createPreviewRouteExecutionPlanFixture } from '../../../support/previewRouteExecutionPlanFixture';

export const ZERO_BUNDLE_DIAGNOSTICS: PreviewInspectorBundleDiagnostics = Object.freeze({
  diagnosticsVersion: 1,
  bundleMeasuredMicros: 0,
  frontierCount: 0,
  rawSourceReadCount: 0,
  rawSourceReadMicros: 0,
  inventoryReadRequestCount: 0,
  inventoryReadPathCacheHitCount: 0,
  sliceRequestCount: 0,
  sliceComputationCount: 0,
  sliceHitCount: 0,
  sliceLookupMicros: 0,
  inventoryRequestCount: 0,
  inventoryComputationCount: 0,
  inventoryHitCount: 0,
  inventoryLookupMicros: 0,
  queueIterationCount: 0,
  queuePeakLength: 0,
  queueSortCount: 0,
  queueSortMicros: 0,
  edgeVisitCount: 0,
  optionalClosureProbeCount: 0,
  optionalClosureMicros: 0,
  resolveModuleCount: 0,
  resolveModuleMicros: 0,
  authoredPathCheckCount: 0,
  authoredPathCheckMicros: 0,
  frontierFinalizeMicros: 0,
  frontierIdentityMicros: 0,
  candidateSelectionSortCount: 0,
  candidateSelectionMicros: 0,
});

export interface OwnerMemoAudit {
  branchPlans: number;
  hits: number;
  identities: Set<string>;
  misses: number;
  provider?: PreviewInspectorRouteOwnerLocationInventoryMemo;
  releases: number;
  requests: number;
}

export type PrefixProvider = NonNullable<
  CollectPreviewInspectorRouteBranchPlanOptions['selectionPrefixProvider']
>;

export interface PrefixProviderAudit {
  createdAfterPreviousRelease: boolean;
  postReleaseStatistics?: ReturnType<PrefixProvider['getStatistics']>;
  preReleaseStatistics?: ReturnType<PrefixProvider['getStatistics']>;
  provider?: PrefixProvider;
  releases: number;
}

export const ROOT = path.join(path.sep, 'workspace', 'src', 'App.tsx');

export const NESTED = path.join(path.sep, 'workspace', 'src', 'Nested.tsx');

export const LEAF = path.join(path.sep, 'workspace', 'src', 'Leaf.tsx');

/** Collects the reusable nested-route fixture under optional explicit traversal bounds. */
export async function collectFixtureInventory(
  limits?: Parameters<typeof collectPreviewInspectorCompleteRouteInventory>[0]['limits'],
): Promise<PreviewInspectorCompleteRouteInventory> {
  return collectPreviewInspectorCompleteRouteInventory(createFixtureOptions(limits));
}

/** Creates inert inventory inputs plus deterministic execution-plan artifacts. */
export function createFixtureOptions(
  limits?: CollectPreviewInspectorCompleteRouteInventoryOptions['limits'],
): CollectPreviewInspectorCompleteRouteInventoryOptions {
  const sources = new Map<string, string>([
    [
      ROOT,
      `
        import { Route, Routes } from 'react-router-dom';
        import Leaf from './Leaf';
        import Nested from './Nested';
        export default function App() {
          return <Routes>
            <Route index element={<Leaf />} />
            <Route path="/items/:itemId(\\\\d+)?" element={<Leaf />} />
            <Route path="/section/*" element={<Nested />} />
          </Routes>;
        }
      `,
    ],
    [
      NESTED,
      `
        import { Route, Routes } from 'react-router-dom';
        import Leaf from './Leaf';
        export default function Nested() {
          return <Routes>
            <Route index element={<Leaf />} />
            <Route path="details/*" element={<Leaf />} />
          </Routes>;
        }
      `,
    ],
    [LEAF, 'export default function Leaf() { return <main>leaf</main>; }'],
  ]);
  return {
    documentPath: ROOT,
    exportName: 'default',
    ...(limits === undefined ? {} : { limits }),
    prepareExecutionPlan: (entry) =>
      Promise.resolve(
        createPreviewRouteExecutionPlanFixture({
          componentName: entry.componentName,
          ...(entry.exportName === undefined ? {} : { exportName: entry.exportName }),
          pathname: entry.pathname,
          pattern: entry.pattern,
          routeId: entry.id,
          selection: entry.selection,
          sourcePath: entry.sourcePath ?? ROOT,
        }),
      ),
    readSource: (sourcePath) => Promise.resolve(sources.get(path.normalize(sourcePath))),
    renderChain: Object.freeze({
      dependencyPaths: Object.freeze([ROOT]),
      paths: Object.freeze([]),
      reachability: 'entry-unreachable',
      stopReason: 'entry-not-found',
      target: Object.freeze({ exportName: 'default', sourcePath: ROOT }),
      truncated: false,
    }),
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importer), `${specifier}.tsx`);
      return sources.has(candidate) ? candidate : undefined;
    },
    sourcePaths: Object.freeze([...sources.keys()]),
  };
}

/** Creates complete-inventory options for one self-contained immutable virtual source graph. */
export function createOptionsFromSources(
  sources: ReadonlyMap<string, string>,
): CollectPreviewInspectorCompleteRouteInventoryOptions {
  return {
    documentPath: ROOT,
    exportName: 'default',
    prepareExecutionPlan: (entry) =>
      Promise.resolve(
        createPreviewRouteExecutionPlanFixture({
          componentName: entry.componentName,
          ...(entry.exportName === undefined ? {} : { exportName: entry.exportName }),
          pathname: entry.pathname,
          pattern: entry.pattern,
          routeId: entry.id,
          selection: entry.selection,
          sourcePath: entry.sourcePath ?? ROOT,
        }),
      ),
    readSource: (sourcePath) => Promise.resolve(sources.get(path.normalize(sourcePath))),
    renderChain: Object.freeze({
      dependencyPaths: Object.freeze([ROOT]),
      paths: Object.freeze([]),
      reachability: 'entry-unreachable',
      stopReason: 'entry-not-found',
      target: Object.freeze({ exportName: 'default', sourcePath: ROOT }),
      truncated: false,
    }),
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importer), specifier);
      return [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.json`].find(
        (sourcePath) => sources.has(sourcePath),
      );
    },
    sourcePaths: Object.freeze(
      [...sources.keys()].filter((sourcePath) => !sourcePath.endsWith('.json')),
    ),
  };
}
