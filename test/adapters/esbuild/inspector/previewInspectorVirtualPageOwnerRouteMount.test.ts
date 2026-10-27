/** Proves that lexical Route-slot evidence controls actual derived owner mounts, not page choices. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryChoices } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryChoices';
import { collectVirtualPageOwnerRouteMount } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageOwnerRouteMount';
import type { PreviewInspectorMountSurface } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import type { PreviewInspectorVirtualPageCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageModel';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';
import { createCandidate } from './previewInspectorVirtualPagePlanFixtures';

describe('derived VirtualPage owner route mount', () => {
  it.each([
    [
      'returned alias',
      '({ entries: routes }) => <Routes>{routes}<Route path="*" /></Routes>',
      true,
    ],
    [
      'captured alias',
      '({ entries: routes }) => <Layout render={() => <Routes>{routes}<Route path="*" /></Routes>} />',
      true,
    ],
    [
      'filtered nested slot',
      '({ entries: routes }) => { const grouped = routes.filter(isGroup); return <Routes><Route element={<GroupProvider />}>{grouped}</Route><Route path="*" /></Routes>; }',
      true,
    ],
    [
      'mapped values',
      '({ entries: routes }) => { const grouped = routes.map(replace); return <Routes><Route>{grouped}</Route></Routes>; }',
      false,
    ],
    [
      'mutable alias',
      '({ entries: routes }) => { let grouped = routes.filter(isGroup); return <Routes>{grouped}</Routes>; }',
      false,
    ],
    [
      'shadowed filtered alias',
      '({ entries: routes }) => { const grouped = routes.filter(isGroup); return <Layout render={(grouped) => <Routes>{grouped}</Routes>} />; }',
      false,
    ],
    [
      'unused JSX',
      '({ entries: routes }) => { const unused = <Routes>{routes}<Route path="*" /></Routes>; return <main />; }',
      false,
    ],
    [
      'shadowed alias',
      '({ entries: routes }) => <Layout render={(routes) => <Routes>{routes}</Routes>} />',
      false,
    ],
    ['rest object', '({ ...routes }) => <Routes>{routes}</Routes>', false],
  ] as const)(
    'admits only a returned, correctly bound Route slot: %s',
    async (_label, callback, admitted) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'react-preview-owner-slot-'));
      const ownerPath = path.join(root, 'FeatureApp.tsx');
      const pagePath = path.join(root, 'Leaf.tsx');
      const catalogPath = path.join(root, 'pages.json');
      const ownerSource = `import Leaf from './Leaf';
      export const FeatureApp = createAppModule('/feature', { Leaf }, [], ${callback});`;
      try {
        await writeFile(ownerPath, ownerSource);
        await writeFile(pagePath, 'export default function Leaf() { return <main>leaf</main>; }');
        const ownerRoot = { exportName: 'FeatureApp', sourcePath: ownerPath };
        const pageRoot = { exportName: 'default', sourcePath: pagePath };
        const renderPath: PreviewRenderChainCandidate = {
          id: 'leaf-to-owner',
          entryPoint: {
            kind: 'create-root',
            occurrenceStart: 30,
            sourcePath: path.join(root, 'main.tsx'),
            wrapperNames: [],
          },
          steps: [
            {
              certainty: 'confirmed',
              kind: 'route-branch',
              label: 'Leaf',
              occurrenceStart: 10,
              sourcePath: pagePath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'FeatureApp',
              occurrenceStart: 20,
              sourcePath: ownerPath,
              wrapperNames: [],
            },
          ],
        };
        const candidate = createCandidate({
          dependencyPaths: [ownerPath, pagePath],
          root: pageRoot,
          target: pageRoot,
          renderPath,
          routeLocation: {
            componentName: 'Leaf',
            dependencyPaths: [catalogPath, ownerPath, pagePath],
            evidenceKind: 'route-catalog',
            pathname: '/feature/item',
            pattern: '/feature/item',
            sourcePath: catalogPath,
          },
        });
        const virtualPage: PreviewInspectorVirtualPageCandidate = {
          authoredCandidate: createCandidate({ ...candidate, root: ownerRoot, rootStepIndex: 1 }),
          browserCandidate: candidate,
          contentCandidate: candidate,
          recipe: {
            authoredRoot: ownerRoot,
            contentRoot: pageRoot,
            bypassedStepCount: 1,
            mode: 'static-page-checkpoint',
            renderPathId: renderPath.id,
            omittedOuterPath: [
              {
                certainty: 'confirmed',
                kind: 'component-render',
                label: 'FeatureApp',
                sourcePath: ownerPath,
                wrapperNames: [],
              },
            ],
            shells: [{ importerPath: ownerPath, root: ownerRoot, relation: 'owner' }],
          },
        };
        const surface: PreviewInspectorMountSurface = {
          bypassedWrapperNames: [],
          exportName: 'FeatureApp',
          id: 'owner',
          omittedTopLevelEffectCount: 0,
          sourcePath: ownerPath,
          strategy: 'authentic-module-export',
          watchSourcePaths: [ownerPath],
        };
        const inventory = collectPreviewInspectorRouteFactoryChoices({
          sourcePath: ownerPath,
          sourceText: ownerSource,
          targetIdentities: new Set(['FeatureApp']),
        });
        expect(inventory.choices.map((choice) => choice.componentName)).toEqual(['Leaf']);
        expect(inventory.owner?.routeSlotCount).toBe(admitted ? 1 : 0);
        const mount = collectVirtualPageOwnerRouteMount(candidate, virtualPage, [surface]);
        if (admitted) {
          expect(mount?.surface).toBe(surface);
          expect(mount?.evidence).toMatchObject({
            basePath: '/feature',
            contextOrigin: 'virtual-page-owner',
            contextPattern: '/feature/*',
            exportName: 'FeatureApp',
            routeSlotCount: 1,
            hasWildcardFallback: true,
            sourcePath: ownerPath,
          });
        } else {
          expect(mount).toBeUndefined();
        }
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});
