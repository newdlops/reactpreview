/** Verifies conservative compiler-owned page-context coverage classification. */
import { describe, expect, it } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import type { PreviewInspectorAncestorPlan } from '../../../src/adapters/esbuild/inspector';
import { resolvePreviewContextCoverage } from '../../../src/adapters/esbuild/previewContextCoverage';

const REQUEST: PreviewBuildRequest = Object.freeze({
  dependencySnapshots: Object.freeze([]),
  documentPath: '/workspace/app/dashboard/page.tsx',
  language: 'tsx',
  preparationMode: 'fast',
  renderMode: 'page-inspector',
  sourceText: 'export default function Page() { return <main />; }',
  workspaceRoot: '/workspace',
});

/** Creates the minimal immutable Inspector plan needed by coverage classification. */
function createPlan(
  overrides: Partial<PreviewInspectorAncestorPlan['pageCandidates'][number]> = {},
  reachability: PreviewInspectorAncestorPlan['renderChain']['reachability'] = 'entry-unreachable',
): PreviewInspectorAncestorPlan {
  const target = Object.freeze({ exportName: 'default', sourcePath: REQUEST.documentPath });
  const renderPath = overrides.renderPath;
  const renderChain = Object.freeze({
    dependencyPaths: Object.freeze([REQUEST.documentPath]),
    paths: Object.freeze(renderPath === undefined ? [] : [renderPath]),
    reachability,
    ...(reachability === 'entry-connected' ? {} : { stopReason: 'entry-unreachable' as const }),
    target,
    truncated: false,
  });
  const candidate = Object.freeze({
    complete: true,
    dependencyPaths: Object.freeze([REQUEST.documentPath]),
    edges: Object.freeze([]),
    id: 'candidate',
    root: target,
    rootAutomaticProps: Object.freeze({}),
    rootOwnsRouter: false,
    stopReason: 'root-reached' as const,
    targetAutomaticProps: Object.freeze({}),
    ...overrides,
  });
  return Object.freeze({
    complete: true,
    dependencyPaths: Object.freeze([REQUEST.documentPath]),
    edges: Object.freeze([]),
    pageCandidates: Object.freeze([candidate]),
    root: target,
    rootAutomaticProps: Object.freeze({}),
    renderChain,
    renderChainsByExport: Object.freeze({ default: renderChain }),
    stopReason: 'root-reached',
    target,
    targetAutomaticProps: Object.freeze({}),
  });
}

describe('resolvePreviewContextCoverage', () => {
  /** A successful standalone build cannot claim that App and route context were discovered. */
  it('keeps the generic direct-file fallback partial', () => {
    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan: undefined,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('partial');
    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan: createPlan(),
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('partial');
  });

  /** A mounted application checkpoint plus ReactDOM entry proves context without a URL registry. */
  it('accepts an entry-connected application checkpoint without route metadata', () => {
    const renderPath = Object.freeze({
      entryPoint: Object.freeze({
        kind: 'create-root' as const,
        occurrenceStart: 42,
        sourcePath: '/workspace/src/main.tsx',
        wrapperNames: Object.freeze(['App']),
      }),
      id: 'entry-to-target',
      steps: Object.freeze([
        Object.freeze({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'App',
          occurrenceStart: 12,
          sourcePath: '/workspace/src/App.tsx',
          wrapperNames: Object.freeze([]),
        }),
      ]),
    });
    const inspectorPlan = createPlan(
      {
        renderPath,
        root: Object.freeze({ exportName: 'default', sourcePath: '/workspace/src/App.tsx' }),
        rootStepIndex: 0,
      },
      'entry-connected',
    );

    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('complete');
  });

  /**
   * A useful fast shell remains publishable after a bounded search, but incomplete graph or runtime
   * evidence must still schedule the full-context replacement behind that first paint.
   */
  it('keeps an entry-connected shell partial when fast graph or global evidence is incomplete', () => {
    const renderPath = Object.freeze({
      entryPoint: Object.freeze({
        kind: 'create-root' as const,
        occurrenceStart: 42,
        sourcePath: '/workspace/src/main.tsx',
        wrapperNames: Object.freeze(['App']),
      }),
      id: 'entry-to-target',
      steps: Object.freeze([
        Object.freeze({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'App',
          occurrenceStart: 12,
          sourcePath: '/workspace/src/App.tsx',
          wrapperNames: Object.freeze([]),
        }),
      ]),
    });
    const inspectorPlan = createPlan(
      {
        renderPath,
        root: Object.freeze({ exportName: 'default', sourcePath: '/workspace/src/App.tsx' }),
        rootStepIndex: 0,
      },
      'entry-connected',
    );
    const baseOptions = {
      request: REQUEST,
      inspectorPlan,
      maximumPublishedPageCandidates: 1,
    } as const;

    expect(resolvePreviewContextCoverage({ ...baseOptions, fastContextTruncated: true })).toBe(
      'partial',
    );
    expect(
      resolvePreviewContextCoverage({
        ...baseOptions,
        implicitGlobalEvidence: Object.freeze({
          ambiguousGlobalNames: Object.freeze([]),
          dependencyPaths: Object.freeze([]),
          evidence: Object.freeze([]),
          unresolvedGlobalNames: Object.freeze([]),
          truncated: true,
        }),
      }),
    ).toBe('partial');
    expect(
      resolvePreviewContextCoverage({
        ...baseOptions,
        implicitGlobalEvidence: Object.freeze({
          ambiguousGlobalNames: Object.freeze([]),
          dependencyPaths: Object.freeze([]),
          evidence: Object.freeze([]),
          unresolvedGlobalNames: Object.freeze(['dayjs']),
          truncated: false,
        }),
      }),
    ).toBe('partial');
  });

  /** A nearby consumer does not inherit completeness merely because another graph node reaches App. */
  it('keeps an entry-connected nearby consumer partial until the App checkpoint is mounted', () => {
    const renderPath = Object.freeze({
      entryPoint: Object.freeze({
        kind: 'create-root' as const,
        occurrenceStart: 42,
        sourcePath: '/workspace/src/main.tsx',
        wrapperNames: Object.freeze(['App']),
      }),
      id: 'entry-to-target',
      steps: Object.freeze([
        Object.freeze({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'FeaturePanel',
          occurrenceStart: 8,
          sourcePath: '/workspace/src/FeaturePanel.tsx',
          wrapperNames: Object.freeze([]),
        }),
        Object.freeze({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'App',
          occurrenceStart: 12,
          sourcePath: '/workspace/src/App.tsx',
          wrapperNames: Object.freeze([]),
        }),
      ]),
    });
    const inspectorPlan = createPlan(
      {
        renderPath,
        root: Object.freeze({
          exportName: 'FeaturePage',
          sourcePath: '/workspace/src/FeaturePage.tsx',
        }),
      },
      'entry-connected',
    );

    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('partial');
  });

  /** A fast root that publishes one of several candidates must still request complete enrichment. */
  it('keeps candidate-capped fast page context partial', () => {
    const renderPath = Object.freeze({
      entryPoint: Object.freeze({
        kind: 'create-root' as const,
        occurrenceStart: 42,
        sourcePath: '/workspace/src/main.tsx',
        wrapperNames: Object.freeze(['App']),
      }),
      id: 'entry-to-target',
      steps: Object.freeze([
        Object.freeze({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'App',
          occurrenceStart: 12,
          sourcePath: '/workspace/src/App.tsx',
          wrapperNames: Object.freeze([]),
        }),
      ]),
    });
    const singleCandidatePlan = createPlan(
      {
        renderPath,
        root: Object.freeze({ exportName: 'default', sourcePath: '/workspace/src/App.tsx' }),
        rootStepIndex: 0,
      },
      'entry-connected',
    );
    const firstCandidate = singleCandidatePlan.pageCandidates[0];
    if (firstCandidate === undefined) throw new Error('Expected fixture page candidate.');
    const inspectorPlan = Object.freeze({
      ...singleCandidatePlan,
      pageCandidates: Object.freeze([
        firstCandidate,
        Object.freeze({ ...firstCandidate, id: 'alternate-page' }),
      ]),
    });

    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('partial');
  });

  /** Full preparation retains its proven coverage even when a caller supplies a candidate cap. */
  it('does not downgrade full page context because of a publication limit', () => {
    const renderPath = Object.freeze({
      entryPoint: Object.freeze({
        kind: 'create-root' as const,
        occurrenceStart: 42,
        sourcePath: '/workspace/src/main.tsx',
        wrapperNames: Object.freeze(['App']),
      }),
      id: 'entry-to-target',
      steps: Object.freeze([
        Object.freeze({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label: 'App',
          occurrenceStart: 12,
          sourcePath: '/workspace/src/App.tsx',
          wrapperNames: Object.freeze([]),
        }),
      ]),
    });
    const singleCandidatePlan = createPlan(
      {
        renderPath,
        root: Object.freeze({ exportName: 'default', sourcePath: '/workspace/src/App.tsx' }),
        rootStepIndex: 0,
      },
      'entry-connected',
    );
    const firstCandidate = singleCandidatePlan.pageCandidates[0];
    if (firstCandidate === undefined) throw new Error('Expected fixture page candidate.');
    const inspectorPlan = Object.freeze({
      ...singleCandidatePlan,
      pageCandidates: Object.freeze([
        firstCandidate,
        Object.freeze({ ...firstCandidate, id: 'alternate-page' }),
      ]),
    });

    expect(
      resolvePreviewContextCoverage({
        request: { ...REQUEST, preparationMode: 'full' },
        inspectorPlan,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('complete');
  });

  /** Next App filesystem route plus its root layout proves a complete authored page corridor. */
  it('accepts a complete Next App page and layout candidate', () => {
    const inspectorPlan = createPlan({
      nextAppLayoutChain: Object.freeze([
        Object.freeze({
          exportName: 'default',
          params: Object.freeze({}),
          sourcePath: '/workspace/app/layout.tsx',
        }),
      ]),
      routeLocation: Object.freeze({
        componentName: 'NextAppPage',
        evidenceKind: 'next-app-filesystem',
        params: Object.freeze({}),
        pathname: '/dashboard',
        pattern: '/dashboard',
        searchParams: Object.freeze({}),
        sourcePath: REQUEST.documentPath,
      }),
    });

    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('complete');
  });

  /** Route evidence without an application layout must continue deferred context discovery. */
  it('rejects an incomplete Next App shell', () => {
    const inspectorPlan = createPlan({
      nextAppLayoutChain: Object.freeze([]),
      routeLocation: Object.freeze({
        componentName: 'NextAppPage',
        evidenceKind: 'next-app-filesystem',
        params: Object.freeze({}),
        pathname: '/dashboard',
        pattern: '/dashboard',
        searchParams: Object.freeze({}),
        sourcePath: REQUEST.documentPath,
      }),
    });

    expect(
      resolvePreviewContextCoverage({
        request: REQUEST,
        inspectorPlan,
        maximumPublishedPageCandidates: 1,
      }),
    ).toBe('partial');
  });
});
