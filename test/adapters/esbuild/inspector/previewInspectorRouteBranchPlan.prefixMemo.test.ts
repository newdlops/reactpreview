/** Covers prefixMemo behavior for previewInspectorRouteBranchPlan. */
/** Verifies authored-source previewInspectorRouteBranchPlan invariants. */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectPreviewInspectorRouteBranchPlan } from '../../../../src/adapters/esbuild/inspector';

import {
  createPreviewInspectorRouteBranchSelectionPrefixProvider,
  createPreviewInspectorRouteOwnerLocationInventoryMemo,
  type PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';

import {
  APP_PATH,
  createAppRenderChain,
  createNestedRouterSources,
  resolveFixtureModule,
} from './previewInspectorRouteBranchPlanFixtures';

describe('preview Inspector hierarchical route branches', () => {
  it('memoizes exact owners while composing repeated parent mounts independently', async () => {
    const sharedOwnerPath = '/workspace/src/SharedOwner.tsx';
    const childPath = '/workspace/src/Child.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Route, Routes } from "react-router-dom";',
        'import SharedOwner from "./SharedOwner";',
        'export default function App() {',
        '  return <Routes>',
        '    <Route path="/left/*" element={<SharedOwner />} />',
        '    <Route path="/right/*" element={<SharedOwner />} />',
        '  </Routes>;',
        '}',
      ].join('\n'),
      [sharedOwnerPath]: [
        'import { useRoutes } from "react-router-dom";',
        'import Child from "./Child";',
        'export default function SharedOwner() {',
        '  return useRoutes([{ path: "child", element: <Child /> }]);',
        '}',
        'export function NamedOwner() {',
        '  return useRoutes([{ path: "named", element: <Child /> }]);',
        '}',
      ].join('\n'),
      [childPath]: 'export default function Child() { return <main>child</main>; }',
    };
    const resolveModule = (moduleSpecifier: string, consumerPath: string): string | undefined =>
      new Map([
        [`${APP_PATH}\0./SharedOwner`, sharedOwnerPath],
        [`${sharedOwnerPath}\0./Child`, childPath],
      ]).get(`${consumerPath}\0${moduleSpecifier}`);
    const fixedOptions = Object.freeze({
      readSource: (sourcePath: string) => Promise.resolve(sources[path.normalize(sourcePath)]),
      renderChain: createAppRenderChain(),
      resolveModule,
      sourcePaths: Object.freeze(Object.keys(sources)),
    });
    const retainedMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo(fixedOptions);
    const counts = { hits: 0, misses: 0, requests: 0 };
    const identities = new Set<string>();
    const countingMemo: PreviewInspectorRouteOwnerLocationInventoryMemo = Object.freeze({
      collect: (documentPath: string, exportName: string) => {
        counts.requests += 1;
        const identity = JSON.stringify([path.normalize(documentPath), exportName]);
        if (identities.has(identity)) {
          counts.hits += 1;
        } else {
          identities.add(identity);
          counts.misses += 1;
        }
        return retainedMemo.collect(documentPath, exportName);
      },
      release: () => {
        retainedMemo.release();
      },
    });
    const selections = [
      [
        { componentName: 'SharedOwner', pattern: '/left/*' },
        { componentName: 'Child', pattern: '/left/child' },
      ],
      [
        { componentName: 'SharedOwner', pattern: '/right/*' },
        { componentName: 'Child', pattern: '/right/child' },
      ],
    ] as const;
    const uncachedPlans = [];
    const cachedPlans = [];
    for (const selection of selections) {
      uncachedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...fixedOptions,
          documentPath: APP_PATH,
          exportName: 'default',
          selection,
        }),
      );
      cachedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...fixedOptions,
          documentPath: APP_PATH,
          exportName: 'default',
          ownerLocationInventoryMemo: countingMemo,
          selection,
        }),
      );
    }

    expect(JSON.stringify(cachedPlans)).toBe(JSON.stringify(uncachedPlans));
    expect(cachedPlans).toEqual(uncachedPlans);
    expect(counts).toEqual({ hits: 3, misses: 3, requests: 6 });
    expect(counts.requests).toBe(counts.hits + counts.misses);
    expect(counts.misses).toBe(identities.size);
    expect(counts.misses).toBeLessThan(6);
    expect(cachedPlans.map((plan) => plan.activeLocation?.pattern)).toEqual([
      '/left/child',
      '/right/child',
    ]);
    expect(cachedPlans[0]?.activeLocation?.routeMounts?.[0]?.basePath).toBe('/left');
    expect(cachedPlans[1]?.activeLocation?.routeMounts?.[0]?.basePath).toBe('/right');
    expect(cachedPlans.every((plan) => plan.dependencyPaths.includes(sharedOwnerPath))).toBe(true);
    expect(cachedPlans.every((plan) => plan.dependencyPaths.includes(childPath))).toBe(true);

    countingMemo.release();
    await expect(countingMemo.collect(APP_PATH, 'default')).rejects.toThrow(
      'owner-location inventory memo was already released',
    );

    let ownerReads = 0;
    const exportMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo({
      ...fixedOptions,
      readSource: (sourcePath) => {
        if (path.normalize(sourcePath) === sharedOwnerPath) ownerReads += 1;
        return Promise.resolve(sources[path.normalize(sourcePath)]);
      },
    });
    const defaultInventory = await exportMemo.collect(sharedOwnerPath, 'default');
    const namedInventory = await exportMemo.collect(sharedOwnerPath, 'NamedOwner');
    const repeatedDefaultInventory = await exportMemo.collect(sharedOwnerPath, 'default');
    expect(repeatedDefaultInventory).toBe(defaultInventory);
    expect(namedInventory).not.toBe(defaultInventory);
    expect(ownerReads).toBe(2);
    exportMemo.release();
  });

  it('reuses only exact nonterminal prefixes while preserving complete plans byte-for-byte', async () => {
    const sources = createNestedRouterSources();
    const provider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    let phase: 'oracle' | 'retained' = 'oracle';
    const reads = { oracle: 0, retained: 0 };
    const resolutions = { oracle: 0, retained: 0 };
    const sharedOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath: string) => {
        reads[phase] += 1;
        return Promise.resolve(sources[sourcePath]);
      },
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier: string, consumerPath: string) => {
        resolutions[phase] += 1;
        return resolveFixtureModule(moduleSpecifier, consumerPath);
      },
      sourcePaths: Object.keys(sources),
    };
    const selections = [
      [
        { componentName: 'FeatureApp', pattern: '/feature/*' },
        { componentName: 'SettingsPage', pattern: '/feature/settings' },
      ],
      [
        { componentName: 'FeatureApp', pattern: '/feature/*' },
        { componentName: 'DashboardPage', pattern: '/feature/dashboard' },
      ],
    ] as const;
    const oraclePlans = await Promise.all(
      selections.map((selection) =>
        collectPreviewInspectorRouteBranchPlan({ ...sharedOptions, selection }),
      ),
    );
    phase = 'retained';
    const retainedPlans = [];
    for (const selection of selections) {
      retainedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...sharedOptions,
          selection,
          selectionPrefixProvider: provider,
        }),
      );
    }

    expect(retainedPlans).toEqual(oraclePlans);
    expect(JSON.stringify(retainedPlans)).toBe(JSON.stringify(oraclePlans));
    expect(reads.retained).toBeLessThan(reads.oracle);
    expect(resolutions.retained).toBeLessThan(resolutions.oracle);
    expect(provider.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 1,
      released: false,
      requests: 2,
    });
    expect(Object.isFrozen(retainedPlans[0]?.branches)).toBe(true);
    expect(retainedPlans[0]).toEqual(oraclePlans[0]);
    expect(retainedPlans[1]?.branches).not.toBe(retainedPlans[0]?.branches);
    expect(retainedPlans[1]?.branches[0]).not.toBe(retainedPlans[0]?.branches[0]);

    const uncacheableProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const fallbackSelection = [
      { componentName: 'MissingOwner', pattern: '/missing/*' },
      { componentName: 'MissingLeaf', pattern: '/missing/leaf' },
    ];
    const fallbackOracle = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      selection: fallbackSelection,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fallback = await collectPreviewInspectorRouteBranchPlan({
        ...sharedOptions,
        selection: fallbackSelection,
        selectionPrefixProvider: uncacheableProvider,
      });
      expect(fallback).toEqual(fallbackOracle);
      expect(JSON.stringify(fallback)).toBe(JSON.stringify(fallbackOracle));
      expect(fallback.selectionResolution).toBe('fallback');
    }
    const finalSelection = [selections[0][0]];
    const finalOracle = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      selection: finalSelection,
    });
    const finalWithProvider = await collectPreviewInspectorRouteBranchPlan({
      ...sharedOptions,
      selection: finalSelection,
      selectionPrefixProvider: uncacheableProvider,
    });
    expect(finalWithProvider).toEqual(finalOracle);
    expect(uncacheableProvider.getStatistics()).toEqual({
      computations: 2,
      entries: 0,
      hits: 0,
      released: false,
      requests: 2,
    });

    const nonretainedProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const nonretainedSelections = [
      undefined,
      [{ componentName: 'AboutPage', pattern: '/about' }],
      [{ componentName: 'FeatureApp', pattern: '/feature/*' }],
    ] as const;
    for (const selection of nonretainedSelections) {
      const oracle = await collectPreviewInspectorRouteBranchPlan({
        ...sharedOptions,
        ...(selection === undefined ? {} : { selection }),
      });
      const retained = await collectPreviewInspectorRouteBranchPlan({
        ...sharedOptions,
        ...(selection === undefined ? {} : { selection }),
        selectionPrefixProvider: nonretainedProvider,
      });
      expect(retained).toEqual(oracle);
      expect(JSON.stringify(retained)).toBe(JSON.stringify(oracle));
    }
    expect(nonretainedProvider.getStatistics()).toEqual({
      computations: 0,
      entries: 0,
      hits: 0,
      released: false,
      requests: 0,
    });

    provider.release();
    uncacheableProvider.release();
    nonretainedProvider.release();
    expect(provider.getStatistics().entries).toBe(0);
    expect(uncacheableProvider.getStatistics().entries).toBe(0);
  });

  it('preserves generic deep divergence, duplicate, unresolved, and export-sensitive plans', async () => {
    const ownerAPath = '/workspace/src/OwnerA.tsx';
    const ownerBPath = '/workspace/src/OwnerB.tsx';
    const sidesPath = '/workspace/src/Sides.tsx';
    const leafPath = '/workspace/src/DeepLeaf.tsx';
    const sources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Route, Routes } from "react-router-dom";',
        'import OwnerA from "./OwnerA";',
        'export default function App() {',
        '  return <Routes><Route path="/root/*" element={<OwnerA />} /></Routes>;',
        '}',
      ].join('\n'),
      [ownerAPath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import OwnerB from "./OwnerB";',
        'export default function OwnerA() {',
        '  return <Routes><Route path="branch/*" element={<OwnerB />} /></Routes>;',
        '}',
      ].join('\n'),
      [ownerBPath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import DefaultSide, { NamedSide } from "./Sides";',
        'const dynamicPath = getPath();',
        'export default function OwnerB() {',
        '  return <Routes>',
        '    <Route path="left/*" element={<DefaultSide />} />',
        '    <Route path="left/*" element={<DefaultSide />} />',
        '    <Route path="right/*" element={<NamedSide />} />',
        '    <Route path={dynamicPath} element={<UnknownPage />} />',
        '  </Routes>;',
        '}',
      ].join('\n'),
      [sidesPath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import DeepLeaf from "./DeepLeaf";',
        'export default function DefaultSide() {',
        '  return <Routes><Route path="end" element={<DeepLeaf />} /></Routes>;',
        '}',
        'export function NamedSide() {',
        '  return <Routes><Route path="end" element={<DeepLeaf />} /></Routes>;',
        '}',
      ].join('\n'),
      [leafPath]: 'export default function DeepLeaf() { return <main>leaf</main>; }',
    };
    const resolutions = new Map([
      [`${APP_PATH}\0./OwnerA`, ownerAPath],
      [`${ownerAPath}\0./OwnerB`, ownerBPath],
      [`${ownerBPath}\0./Sides`, sidesPath],
      [`${sidesPath}\0./DeepLeaf`, leafPath],
    ]);
    let phase: 'oracle' | 'retained' = 'oracle';
    const readCounts = { oracle: 0, retained: 0 };
    const resolveCounts = { oracle: 0, retained: 0 };
    const options = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath: string) => {
        readCounts[phase] += 1;
        return Promise.resolve(sources[sourcePath]);
      },
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier: string, consumerPath: string) => {
        resolveCounts[phase] += 1;
        return resolutions.get(`${consumerPath}\0${moduleSpecifier}`);
      },
      sourcePaths: Object.keys(sources),
    };
    const selections = [
      [
        { componentName: 'OwnerA', pattern: '/root/*' },
        { componentName: 'OwnerB', pattern: '/root/branch/*' },
        { componentName: 'DefaultSide', pattern: '/root/branch/left/*' },
        { componentName: 'DeepLeaf', pattern: '/root/branch/left/end' },
      ],
      [
        { componentName: 'OwnerA', pattern: '/root/*' },
        { componentName: 'OwnerB', pattern: '/root/branch/*' },
        { componentName: 'NamedSide', pattern: '/root/branch/right/*' },
        { componentName: 'DeepLeaf', pattern: '/root/branch/right/end' },
      ],
    ] as const;
    const oraclePlans: Awaited<ReturnType<typeof collectPreviewInspectorRouteBranchPlan>>[] = [];
    for (const selection of selections) {
      oraclePlans.push(await collectPreviewInspectorRouteBranchPlan({ ...options, selection }));
    }
    phase = 'retained';
    const provider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const retainedPlans: Awaited<ReturnType<typeof collectPreviewInspectorRouteBranchPlan>>[] = [];
    for (const selection of selections) {
      retainedPlans.push(
        await collectPreviewInspectorRouteBranchPlan({
          ...options,
          selection,
          selectionPrefixProvider: provider,
        }),
      );
    }

    retainedPlans.forEach((plan, index) => {
      expect(plan).toEqual(oraclePlans[index]);
      expect(JSON.stringify(plan)).toBe(JSON.stringify(oraclePlans[index]));
      expect(plan.branches.some((branch) => branch.componentName === 'UnknownPage')).toBe(true);
      expect(plan.branches.some((branch) => branch.duplicateOf !== undefined)).toBe(true);
    });
    const leftOwner = retainedPlans[0]?.branches.find(
      (branch) => branch.componentName === 'DefaultSide',
    );
    const rightOwner = retainedPlans[1]?.branches.find(
      (branch) => branch.componentName === 'NamedSide',
    );
    expect(leftOwner).toMatchObject({ exportName: 'default', sourcePath: sidesPath });
    expect(rightOwner).toMatchObject({ exportName: 'NamedSide', sourcePath: sidesPath });
    expect(provider.getStatistics()).toEqual({
      computations: 4,
      entries: 4,
      hits: 2,
      released: false,
      requests: 6,
    });
    expect(readCounts.retained).toBeLessThan(readCounts.oracle);
    expect(resolveCounts.retained).toBeLessThan(resolveCounts.oracle);
    expect(retainedPlans[1]?.branches).not.toBe(retainedPlans[0]?.branches);
    expect(retainedPlans[1]?.branches[0]).not.toBe(retainedPlans[0]?.branches[0]);
    provider.release();
    expect(provider.getStatistics().entries).toBe(0);
  });

  it('preserves cycle and rejection identity without retaining failed prefix work', async () => {
    const cyclePath = '/workspace/src/Cycle.tsx';
    const cycleSources: Readonly<Record<string, string>> = {
      [APP_PATH]: [
        'import { Route, Routes } from "react-router-dom";',
        'import Cycle from "./Cycle";',
        'export default function App() {',
        '  return <Routes><Route path="/cycle/*" element={<Cycle />} /></Routes>;',
        '}',
      ].join('\n'),
      [cyclePath]: [
        'import { Route, Routes } from "react-router-dom";',
        'import App from "./App";',
        'export default function Cycle() {',
        '  return <Routes><Route path="back/*" element={<App />} /></Routes>;',
        '}',
      ].join('\n'),
    };
    const selection = [
      { componentName: 'Cycle', pattern: '/cycle/*' },
      { componentName: 'App', pattern: '/cycle/back/*' },
    ];
    const fixedOptions = {
      documentPath: APP_PATH,
      exportName: 'default',
      readSource: (sourcePath: string) => Promise.resolve(cycleSources[sourcePath]),
      renderChain: createAppRenderChain(),
      resolveModule: (moduleSpecifier: string, consumerPath: string) =>
        new Map([
          [`${APP_PATH}\0./Cycle`, cyclePath],
          [`${cyclePath}\0./App`, APP_PATH],
        ]).get(`${consumerPath}\0${moduleSpecifier}`),
      selection,
      sourcePaths: Object.keys(cycleSources),
    };
    const oracle = await collectPreviewInspectorRouteBranchPlan(fixedOptions);
    const provider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const retained = await collectPreviewInspectorRouteBranchPlan({
      ...fixedOptions,
      selectionPrefixProvider: provider,
    });
    const hit = await collectPreviewInspectorRouteBranchPlan({
      ...fixedOptions,
      selectionPrefixProvider: provider,
    });
    expect(retained).toEqual(oracle);
    expect(hit).toEqual(oracle);
    expect(JSON.stringify(retained)).toBe(JSON.stringify(oracle));
    expect(JSON.stringify(hit)).toBe(JSON.stringify(oracle));
    expect(provider.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 1,
      released: false,
      requests: 2,
    });

    const rejection = new Error('synthetic prefix computation rejection');
    const rejectingProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
    const rejectingOptions = {
      ...fixedOptions,
      readSource: (sourcePath: string) =>
        sourcePath === APP_PATH
          ? Promise.reject(rejection)
          : Promise.resolve(cycleSources[sourcePath]),
      selectionPrefixProvider: rejectingProvider,
    };
    await expect(collectPreviewInspectorRouteBranchPlan(rejectingOptions)).rejects.toBe(rejection);
    await expect(collectPreviewInspectorRouteBranchPlan(rejectingOptions)).rejects.toBe(rejection);
    expect(rejectingProvider.getStatistics()).toEqual({
      computations: 2,
      entries: 0,
      hits: 0,
      released: false,
      requests: 2,
    });
    provider.release();
    rejectingProvider.release();
  });
});
