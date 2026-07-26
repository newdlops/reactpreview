import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorPagePathSegments,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

const TARGET = '/workspace/pages/Target.tsx';
const PAGE = '/workspace/pages/SelectedPage.tsx';
const ROUTE = '/workspace/routes/SelectedRoute.tsx';
const APP = '/workspace/App.tsx';
const ENTRY = '/workspace/main.tsx';

describe('createPreviewInspectorPagePathSegments', () => {
  it('retains application entry as evidence while marking the selected page path as mountable roles', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: { kind: 'create-root', occurrenceStart: 40, sourcePath: ENTRY, wrapperNames: [] },
      id: 'selected-route',
      steps: [
        {
          certainty: 'confirmed',
          evidenceSourcePaths: ['/workspace/hooks/useTarget.ts'],
          kind: 'component-render',
          label: 'Target',
          occurrenceStart: 1,
          sourcePath: TARGET,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedPage',
          occurrenceStart: 2,
          sourcePath: PAGE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedRoute',
          occurrenceStart: 3,
          sourcePath: ROUTE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'App',
          occurrenceStart: 4,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const candidate = {
      complete: true,
      dependencyPaths: [TARGET, PAGE, ROUTE, APP, ENTRY],
      edges: [],
      id: 'candidate',
      renderPath,
      root: { exportName: 'SelectedPage', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeLocation: {
        componentName: 'SelectedPage',
        dependencyPaths: [ROUTE],
        evidenceKind: 'route-jsx',
        pathname: '/selected',
        pattern: '/selected',
        routeMounts: [
          {
            basePath: '/',
            exportName: 'SelectedRoute',
            hasWildcardFallback: false,
            routeSlotCount: 1,
            sourcePath: ROUTE,
          },
        ],
        sourcePath: ROUTE,
      },
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Target: { paths: [renderPath] } },
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const segments = createPreviewInspectorPagePathSegments({ candidate, plan });

    expect(segments.map((segment) => [segment.sourcePath, segment.role])).toEqual([
      [TARGET, 'target'],
      [PAGE, 'page-content'],
      [ROUTE, 'route-layout'],
      [APP, 'application-shell'],
      [ENTRY, 'application-entry'],
    ]);
    expect(segments[0]?.evidenceSourcePaths).toEqual(['/workspace/hooks/useTarget.ts', TARGET]);
    expect(segments[0]?.reference).toEqual({ exportName: 'Target', sourcePath: TARGET });
    expect(segments[4]?.reference).toBeUndefined();
  });

  it('is deterministic and leaves an entry source out of mountable surface roles', () => {
    const plan = {
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;
    const candidate = {
      complete: false,
      dependencyPaths: [TARGET],
      edges: [],
      id: 'target-only',
      root: { exportName: 'Target', sourcePath: TARGET },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;

    const first = createPreviewInspectorPagePathSegments({ candidate, plan });
    const second = createPreviewInspectorPagePathSegments({ candidate, plan });

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ role: 'target', sourcePath: TARGET });
  });
});
