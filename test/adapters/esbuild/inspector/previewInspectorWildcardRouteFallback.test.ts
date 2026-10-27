/** Preserves authored catch-all UI while pruning independent route alternatives. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import { preparePreviewInspectorBundleFrontier } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import { createPreviewInspectorCorridorPlugin } from '../../../../src/adapters/esbuild/inspector/previewInspectorCorridorPlugin';
import { createPreviewInspectorPageExecutionCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates';
import { collectPreviewStaticRouteProjectionInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorStaticRouteProjection';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('authored wildcard route fallbacks', () => {
  it.each([
    '<Route path="*" element={<Fallback />} />',
    '<Route path="/*" element={<Fallback />} />',
    '<Route path={"*"} element={<Fallback />} />',
    '<Router.Route path="*" component={Fallback}></Router.Route>',
    '({ path: "*", element: <Fallback /> })',
    '({ "path": "/*", Component: Fallback })',
    '({ path: "*", errorElement: <Fallback />, element: null })',
  ])('keeps the fallback import authentic: %s', (fallback) => {
    const inventory = collectPreviewStaticRouteProjectionInventory(
      '/workspace/routes.tsx',
      `import Fallback from './Fallback';
       import Sibling from './Sibling';
       export const fallback = ${fallback};
       export const ordinary = <Route path="/sibling" element={<Sibling />} />;`,
    );
    expect(inventory.projectionsBySpecifier.has('./Fallback')).toBe(false);
    expect(inventory.projectionsBySpecifier.has('./Sibling')).toBe(true);
  });

  it('preserves one import shared by an ordinary route and its catch-all route', () => {
    const inventory = collectPreviewStaticRouteProjectionInventory(
      '/workspace/routes.tsx',
      `import Shared from './Shared';
       export const routes = <Routes>
         <Route path="/ordinary" element={<Shared />} />
         <Route path="*" element={<Shared />} />
       </Routes>;`,
    );
    expect(inventory.projectionsBySpecifier.has('./Shared')).toBe(false);
  });

  it('keeps the factory callback fallback while projecting its page-map alternatives', () => {
    const inventory = collectPreviewStaticRouteProjectionInventory(
      '/workspace/FeatureApp.tsx',
      `import Fallback from './Fallback';
       import ListPage from './ListPage';
       import OtherPage from './OtherPage';
       export const FeatureApp = createAppModule('/feature', { ListPage, OtherPage }, [],
         ({ entries: routes }) => <Routes>{routes}<Route path="*" element={<Fallback />} /></Routes>);`,
    );
    expect([...inventory.projectionsBySpecifier.keys()]).toEqual(['./ListPage', './OtherPage']);
  });

  it.each([false, true])(
    'retains fallback bytes through the actual corridor build (frozen frontier: %s)',
    async (frozen) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'react-preview-wildcard-fallback-'));
      const appPath = path.join(root, 'src/App.tsx');
      const selectedPath = path.join(root, 'src/Selected.tsx');
      const fallbackPath = path.join(root, 'src/Fallback.tsx');
      const sources = new Map([
        [
          appPath,
          `import { Route, Routes } from 'react-router-dom';
          import Selected from './Selected'; import Sibling from './Sibling'; import Fallback from './Fallback';
          export function App() { return <Routes><Route path="/selected" element={<Selected />} />
          <Route path="/sibling" element={<Sibling />} /><Route path="*" element={<Fallback />} /></Routes>; }`,
        ],
        [
          selectedPath,
          'export default function Selected() { return <p>SELECTED_PAGE_MARKER</p>; }',
        ],
        [
          path.join(root, 'src/Sibling.tsx'),
          "globalThis.unused = 'SIBLING_MODULE_MARKER'; export default function Sibling() { return <p>Sibling</p>; }",
        ],
        [
          fallbackPath,
          'export default function Fallback() { return <p>AUTHORED_FALLBACK_MARKER</p>; }',
        ],
      ]);
      try {
        await mkdir(path.join(root, 'src'));
        await Promise.all([
          writeFile(
            path.join(root, 'package.json'),
            '{"private":true,"dependencies":{"react-router-dom":"6.30.1"}}',
          ),
          ...[...sources].map(([file, source]) => writeFile(file, source)),
        ]);
        const plan = createPlan(appPath, selectedPath);
        const resolveModule = createPreviewStaticModuleResolver({ workspaceRoot: root }).resolve;
        const policy = createPreviewCompilerFrontierPolicy('fast');
        if (policy === undefined) throw new Error('Expected the automatic fast frontier.');
        const executionCandidate = createPreviewInspectorPageExecutionCandidates({ plan })[0];
        if (executionCandidate === undefined)
          throw new Error('Expected the source-backed page execution.');
        const prepared = frozen
          ? await preparePreviewInspectorBundleFrontier({
              executionCandidate,
              plan,
              policy,
              workspaceRoot: root,
              resolveModule,
              readSource: (file) => Promise.resolve(sources.get(file)),
            })
          : undefined;
        expect(prepared?.rejected ?? false).toBe(false);
        const result = await build({
          absWorkingDir: root,
          entryPoints: [appPath],
          bundle: true,
          write: false,
          format: 'esm',
          jsx: 'automatic',
          metafile: true,
          external: ['react-router-dom', 'react/jsx-runtime'],
          plugins: [
            createPreviewInspectorCorridorPlugin({
              plan,
              projectRoot: root,
              workspaceRoot: root,
              resolveModule,
              ...(prepared === undefined
                ? {}
                : {
                    frozenAuthenticSourcePaths: prepared.frontier.authenticSourcePaths,
                    authenticComponentExports: prepared.frontier.authenticComponentExports,
                    projectedEdges: prepared.frontier.projectedEdges,
                  }),
            }),
          ],
        });
        const output = result.outputFiles.map((file) => file.text).join('\n');
        expect(output).toContain('SELECTED_PAGE_MARKER');
        expect(output).toContain('AUTHORED_FALLBACK_MARKER');
        expect(output).not.toContain('SIBLING_MODULE_MARKER');
        expect(
          Object.keys(result.metafile.inputs).some((file) => file.endsWith('src/Fallback.tsx')),
        ).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

/** Creates exact selected-page evidence for an authored owner that must retain its catch-all UI. */
function createPlan(appPath: string, selectedPath: string): PreviewInspectorAncestorPlan {
  const root = { exportName: 'App', sourcePath: appPath };
  const target = { exportName: 'default', sourcePath: selectedPath };
  const edges = [
    {
      child: target,
      owner: root,
      childAutomaticProps: {},
      localOwnerDepth: 0,
      localOwnerNames: [],
      occurrenceStart: 1,
    },
  ];
  const renderPath = {
    id: 'selected-page',
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: appPath,
      wrapperNames: [],
    },
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'route-branch' as const,
        label: 'Selected',
        occurrenceStart: 1,
        sourcePath: selectedPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'component-render' as const,
        label: 'App',
        occurrenceStart: 0,
        sourcePath: appPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [appPath, selectedPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const candidate = {
    complete: true,
    dependencyPaths: [appPath, selectedPath],
    edges,
    id: 'selected-page',
    root,
    target,
    rootAutomaticProps: {},
    targetAutomaticProps: {},
    rootOwnsRouter: false,
    rootStepIndex: 1,
    routeLocation: {
      componentName: 'Selected',
      componentExportName: 'default',
      componentSourcePath: selectedPath,
      dependencyPaths: [appPath, selectedPath],
      evidenceKind: 'route-jsx' as const,
      pathname: '/selected',
      pattern: '/selected',
      sourcePath: appPath,
    },
    renderPath,
    stopReason: 'root-reached' as const,
  };
  return {
    ...candidate,
    renderChain,
    renderChainsByExport: { default: renderChain },
    pageCandidates: [candidate],
  };
}
