/** Nine real syntax readers share work while retaining edges, routes, themes and source positions. */
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  clearPreviewAnalysisSourceFileCache,
  readPreviewAnalysisSourceFile,
} from '../../../src/adapters/esbuild/previewAnalysisSourceFile';
import { analyzePreviewRenderSource } from '../../../src/adapters/esbuild/renderGraph/previewRenderSourceAnalysis';
import { collectPreviewRenderModuleFacts } from '../../../src/adapters/esbuild/renderGraph/previewRenderModuleFacts';
import { collectPreviewInspectorBundleSourceInventory } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleSourceInventoryMemo';
import { collectPreviewInspectorRuntimeImportInventory } from '../../../src/adapters/esbuild/inspector/previewInspectorRuntimeImportInventory';
import { collectPreviewStaticRouteProjectionInventory } from '../../../src/adapters/esbuild/inspector/previewInspectorStaticRouteProjection';
import { collectPreviewInspectorRouteFactoryCatalog } from '../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryCatalog';
import { collectPreviewStyleSignals } from '../../../src/adapters/esbuild/previewStyleInventory';
import { collectPreviewDynamicImportInventory } from '../../../src/adapters/esbuild/staticResources/previewDynamicImportInventory';
import { selectPreviewStyleSheetManagerPlan } from '../../../src/adapters/esbuild/previewStyleSheetManagerSelection';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});

beforeEach(() => {
  clearPreviewAnalysisSourceFileCache();
  vi.mocked(ts.createSourceFile).mockClear();
});

it('shares one inert TSX parse across nine readers without changing their results or tree', async () => {
  const sourcePath = '/work/Page.tsx';
  const source = [
    'import React from "react";',
    'import styled from "styled-components";',
    'import { theme } from "./theme";',
    'import { Panel } from "./Panel";',
    'import { Route } from "react-router-dom";',
    'import rawCatalog from "./routes.json";',
    'const catalog = rawCatalog;',
    'export const Lazy = React.lazy(() => import("./Lazy"));',
    'export const Styled = styled.div``;',
    'export const Page = () => <Route path="/detail" element={<Panel />} />;',
  ].join('\n');
  const tree = readPreviewAnalysisSourceFile(sourcePath, source, ts.ScriptKind.TSX);
  const positions: { node: ts.Node; parent: ts.Node; pos: number; end: number }[] = [];
  const snapshot = (node: ts.Node): void => {
    positions.push({ node, parent: node.parent, pos: node.pos, end: node.end });
    ts.forEachChild(node, snapshot);
  };
  snapshot(tree);
  const analysis = analyzePreviewRenderSource(sourcePath, source);
  const facts = collectPreviewRenderModuleFacts(sourcePath, source);
  expect(facts).toEqual(analysis.moduleFacts);
  expect(facts.lazyImports).toEqual([
    expect.objectContaining({ moduleSpecifier: './Lazy', importedName: 'default' }),
  ]);
  expect(facts.exports.map((fact) => fact.exportName)).toEqual(['Lazy', 'Styled', 'Page']);
  const bundle = collectPreviewInspectorBundleSourceInventory(sourcePath, source);
  if (typeof bundle === 'string') throw new Error(bundle);
  expect(bundle.edges).toEqual(collectPreviewInspectorRuntimeImportInventory(sourcePath, source));
  expect(bundle.edges.map((edge) => edge.moduleSpecifier)).toEqual([
    'react',
    'styled-components',
    './theme',
    './Panel',
    'react-router-dom',
    './routes.json',
    './Lazy',
  ]);
  expect([
    ...collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      source,
    ).projectionsBySpecifier.keys(),
  ]).toEqual(['./Panel']);
  expect(collectPreviewStyleSignals(sourcePath, source)).toEqual([
    {
      confidence: 'value',
      exportName: 'theme',
      importerPath: sourcePath,
      moduleSpecifier: '/work/theme',
    },
  ]);
  expect(collectPreviewDynamicImportInventory(sourcePath, source)).toEqual({
    reliable: true,
    specifiers: ['./Lazy'],
    truncated: false,
  });
  const catalog = await collectPreviewInspectorRouteFactoryCatalog({
    catalogBindingName: 'catalog',
    expectedComponentNames: new Set(['Panel']),
    readSource: (file) =>
      Promise.resolve(
        file === sourcePath
          ? source
          : file === '/work/routes.json'
            ? '{"detail":"Panel"}'
            : undefined,
      ),
    resolveModule: (specifier) => (specifier === './routes.json' ? '/work/routes.json' : undefined),
    sourcePath,
  });
  expect(catalog.patternsByComponentName.get('Panel')).toEqual(['/detail']);
  expect(catalog.dependencyPaths).toEqual([sourcePath, '/work/routes.json']);
  const styleManager = await selectPreviewStyleSheetManagerPlan({
    availability: { available: true, dependencyPaths: [] },
    mountedRoot: { exportName: 'Inner', rootStepIndex: 0, sourcePath: '/work/Inner.tsx' },
    readSource: (file) => Promise.resolve(file === sourcePath ? source : undefined),
    renderPath: {
      id: 'style-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Inner',
          occurrenceStart: 0,
          sourcePath: '/work/Inner.tsx',
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'entry-render',
          label: 'Page',
          occurrenceStart: 1,
          sourcePath,
          wrapperNames: [],
        },
      ],
    },
    resolveModule: () => undefined,
  });
  expect(styleManager).toMatchObject({
    evidence: 'synthetic',
    layers: [{ sourceKind: 'synthetic' }],
  });
  for (const saved of positions) {
    expect(saved.node.parent).toBe(saved.parent);
    expect(saved.node.pos).toBe(saved.pos);
    expect(saved.node.end).toBe(saved.end);
  }
  expect(tree.text).toBe(source);
  expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
});
