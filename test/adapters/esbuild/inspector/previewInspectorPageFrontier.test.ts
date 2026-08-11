import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import {
  createPreviewInspectorBundleDiagnosticsCollector,
  type PreviewInspectorBundleDiagnosticsCollector,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';
import { createPreviewInspectorBundleSourceInventoryMemo } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import { preparePreviewInspectorPageExecutionSelection } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageFrontier';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('preparePreviewInspectorPageExecutionSelection', () => {
  it('accepts a page-sized 307-module closure through the fast soft envelope', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/Page.tsx';
    const helpers = Array.from({ length: 305 }, (_, index) => `/workspace/H${index.toString()}.ts`);
    const helperImports = helpers
      .map(
        (_, index) => `import { value as value${index.toString()} } from './H${index.toString()}';`,
      )
      .join(' ');
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [
        pagePath,
        `import { Target } from './Target'; ${helperImports} export const Page = () => <Target data-value={${helpers.map((_, index) => `value${index.toString()}`).join(' + ')}} />;`,
      ],
      ...helpers.map((sourcePath, index) => {
        if (index >= 154) return [sourcePath, `export const value = ${index.toString()};`] as const;
        return [
          sourcePath,
          [
            "import { value as left } from './H154';",
            "import { value as middle } from './H155';",
            "import { value as right } from './H156';",
            'export const value = left + middle + right;',
          ].join(' '),
        ] as const;
      }),
    ]);
    const surface = (
      id: string,
      sourcePath: string,
      exportName: string,
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id,
      omittedTopLevelEffectCount: 0,
      sourcePath,
      strategy: 'authentic-module-export' as const,
      watchSourcePaths: [sourcePath],
    });
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        surface('page', pagePath, 'Page'),
        surface('target', targetPath, 'Target'),
      ],
      evidenceSourcePaths: [],
      fidelity: 'page-authentic' as const,
      id: 'page',
      optionalSurfaces: [],
      watchSourcePaths: [pagePath, targetPath],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');

    const selection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [candidate],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) => {
        const name = specifier.slice(2);
        return specifier.startsWith('./')
          ? `/workspace/${name}${name === 'Target' ? '.tsx' : '.ts'}`
          : undefined;
      },
      workspaceRoot,
    });

    expect(selection?.disposition).toBe('accepted-unbounded');
    expect(selection?.prepared.frontier.summary.totalAuthoredModuleCount).toBe(307);
    expect(selection?.prepared.frontier.summary.authoredEdgeCount).toBe(768);
  });

  it('admits an app-sized 2,000-module closure without a graph budget', async () => {
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/AppPage.tsx';
    const helpers = Array.from(
      { length: 1_998 },
      (_, index) => `/workspace/A${index.toString()}.ts`,
    );
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [
        pagePath,
        "import { Target } from './Target'; import { value } from './A0'; export const Page = () => <Target data-value={value} />;",
      ],
      ...helpers.map(
        (sourcePath, index) =>
          [
            sourcePath,
            index === helpers.length - 1
              ? 'export const value = 1;'
              : `import { value as next } from './A${(index + 1).toString()}'; export const value = next;`,
          ] as const,
      ),
    ]);
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'Page',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: pagePath,
          strategy: 'authentic-module-export',
          watchSourcePaths: [pagePath],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Target',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: targetPath,
          strategy: 'authentic-module-export',
          watchSourcePaths: [targetPath],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'page-authentic',
      id: 'app-page',
      optionalSurfaces: [],
      watchSourcePaths: [pagePath, targetPath],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const policy = createPreviewCompilerFrontierPolicy('corridor');
    if (policy === undefined) throw new Error('Expected corridor frontier policy.');

    const selection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [candidate],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) =>
        specifier.startsWith('./')
          ? `/workspace/${specifier.slice(2)}${specifier === './Target' ? '.tsx' : '.ts'}`
          : undefined,
      workspaceRoot: '/workspace',
    });

    expect(selection).toMatchObject({ disposition: 'accepted-unbounded', kind: 'selected' });
    expect(selection?.prepared.frontier.summary.totalAuthoredModuleCount).toBe(2_000);
  });

  it('prefers selected-export context, then connected pages, before the target-only fallback', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/Page.tsx';
    const sources = new Map([
      [targetPath, 'export const Target = () => null;'],
      [pagePath, "import { Target } from './Target'; export const Page = () => <Target />;"],
    ]);
    const surface = (
      id: string,
      sourcePath: string,
      exportName: string,
      strategy: 'authentic-module-export' | 'selected-export-slice' = 'authentic-module-export',
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id,
      omittedTopLevelEffectCount: 0,
      sourcePath,
      strategy,
      watchSourcePaths: [sourcePath],
    });
    const candidate = (
      fidelity: PreviewInspectorPageExecutionCandidate['fidelity'],
      criticalSurfaces: PreviewInspectorPageExecutionCandidate['criticalSurfaces'],
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces,
        evidenceSourcePaths: [],
        fidelity,
        id: fidelity,
        optionalSurfaces: [],
        watchSourcePaths: criticalSurfaces.map((item) => item.sourcePath),
      }) as unknown as PreviewInspectorPageExecutionCandidate;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');

    const selection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [
        candidate('page-authentic', [
          surface('page', pagePath, 'Page'),
          surface('target', targetPath, 'Target'),
        ]),
        candidate('target-contextual', [
          surface('page-context', pagePath, 'Page'),
          surface('target', targetPath, 'Target'),
        ]),
        candidate('target-only', [surface('target', targetPath, 'Target')]),
      ],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === './Target' && importer === pagePath ? targetPath : undefined,
      workspaceRoot,
    });

    expect(selection?.disposition).toBe('accepted-unbounded');
    expect(selection?.kind).toBe('selected');
    if (selection?.kind !== 'selected') throw new Error('Expected selected Page Execution.');
    expect(selection.executionPlan.candidate.fidelity).toBe('target-contextual');
    expect(selection.executionPlan.alternatives).toEqual([
      { candidateId: 'page-authentic', fidelity: 'page-authentic' },
      { candidateId: 'target-contextual', fidelity: 'target-contextual' },
      { candidateId: 'target-only', fidelity: 'target-only' },
    ]);
    const connectedPageSelection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [
        candidate('route-page-authentic', [
          surface('page', pagePath, 'Page'),
          surface('target', targetPath, 'Target'),
        ]),
        candidate('target-only', [surface('target', targetPath, 'Target')]),
      ],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === './Target' && importer === pagePath ? targetPath : undefined,
      workspaceRoot,
    });

    expect(connectedPageSelection).toMatchObject({
      disposition: 'accepted-unbounded',
      executionPlan: { candidate: { fidelity: 'route-page-authentic' } },
      kind: 'selected',
    });
    const standaloneSelection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [candidate('target-only', [surface('target', targetPath, 'Target')])],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => undefined,
      workspaceRoot,
    });

    expect(standaloneSelection).toMatchObject({
      disposition: 'accepted-unbounded',
      executionPlan: { candidate: { fidelity: 'target-only' } },
      kind: 'selected',
    });
    const rejectedSelection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [
        candidate('page-authentic', [
          surface('page', pagePath, 'Page'),
          surface('target', targetPath, 'Target'),
        ]),
        candidate('target-only', [
          surface('target', targetPath, 'Missing', 'selected-export-slice'),
        ]),
      ],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === './Target' && importer === pagePath ? targetPath : undefined,
      workspaceRoot,
    });

    expect(rejectedSelection).toMatchObject({
      disposition: 'accepted-unbounded',
      kind: 'selected',
    });
    if (rejectedSelection?.kind !== 'selected')
      throw new Error('Expected selected Page Execution.');
    expect(rejectedSelection.executionPlan.candidate.fidelity).toBe('page-authentic');
    expect(rejectedSelection.executionPlan.alternatives).toEqual([
      { candidateId: 'page-authentic', fidelity: 'page-authentic' },
      { candidateId: 'target-only', fidelity: 'target-only', reason: 'slice-unavailable' },
    ]);
  });

  it('admits a critical support chain beyond the former fast depth contract', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/Page.tsx';
    const helpers = Array.from(
      { length: 41 },
      (_, index) => `/workspace/Depth${index.toString()}.ts`,
    );
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [pagePath, "import { value } from './Depth0'; export const Page = () => value;"],
      ...helpers.map(
        (sourcePath, index) =>
          [
            sourcePath,
            index === helpers.length - 1
              ? 'export const value = null;'
              : `import { value as next } from './Depth${(index + 1).toString()}'; export const value = next;`,
          ] as const,
      ),
    ]);
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'Page',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: pagePath,
          strategy: 'authentic-module-export',
          watchSourcePaths: [pagePath],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Target',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: targetPath,
          strategy: 'authentic-module-export',
          watchSourcePaths: [targetPath],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'page-authentic',
      id: 'page',
      optionalSurfaces: [],
      watchSourcePaths: [pagePath, targetPath],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');

    const selection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [candidate],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) =>
        specifier.startsWith('./') ? `/workspace/${specifier.slice(2)}.ts` : undefined,
      workspaceRoot,
    });

    expect(selection).toMatchObject({ disposition: 'accepted-unbounded', kind: 'selected' });
    expect(selection?.prepared.frontier.summary.maximumDepth).toBe(41);
  });

  it('shares source snapshots across candidate probes', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/Page.tsx';
    const sources = new Map([
      [targetPath, 'export const Target = () => null;'],
      [pagePath, "import { Target } from './Target'; export const Page = () => <Target />;"],
    ]);
    const surfaces = [
      {
        bypassedWrapperNames: [],
        exportName: 'Page',
        id: 'page',
        omittedTopLevelEffectCount: 0,
        sourcePath: pagePath,
        strategy: 'authentic-module-export',
        watchSourcePaths: [pagePath],
      },
      {
        bypassedWrapperNames: [],
        exportName: 'Target',
        id: 'target',
        omittedTopLevelEffectCount: 0,
        sourcePath: targetPath,
        strategy: 'authentic-module-export',
        watchSourcePaths: [targetPath],
      },
    ] as const;
    const candidates = ['page-authentic', 'page-sliced'].map((fidelity) => ({
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: surfaces,
      evidenceSourcePaths: [],
      fidelity,
      id: fidelity,
      optionalSurfaces: [],
      watchSourcePaths: [pagePath, targetPath],
    })) as unknown as readonly PreviewInspectorPageExecutionCandidate[];
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');
    let reads = 0;

    await preparePreviewInspectorPageExecutionSelection({
      candidates,
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: (sourcePath) => {
        reads += 1;
        return Promise.resolve(sources.get(sourcePath));
      },
      resolveModule: (specifier, importer) =>
        specifier === './Target' && importer === pagePath ? targetPath : undefined,
      workspaceRoot,
    });

    expect(reads).toBe(2);
  });

  it('rejects a selected-export candidate before native bundling when the slice is unavailable', async () => {
    const targetPath = '/workspace/Target.tsx';
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'Missing',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: targetPath,
          strategy: 'selected-export-slice',
          watchSourcePaths: [targetPath],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'target-only',
      id: 'target-only',
      optionalSurfaces: [],
      watchSourcePaths: [targetPath],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');

    const selection = await preparePreviewInspectorPageExecutionSelection({
      candidates: [candidate],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Missing', sourcePath: targetPath },
        target: { exportName: 'Missing', sourcePath: targetPath },
      } as never,
      policy,
      readSource: () => Promise.resolve('export const Other = null;'),
      resolveModule: () => undefined,
      workspaceRoot: '/workspace',
    });

    expect(selection).toMatchObject({
      disposition: 'rejected-structural',
      kind: 'rejected',
      prepared: { frontier: { summary: { truncationReasons: ['slice-unavailable'] } } },
    });
  });

  it('rejects ambiguous same-source slices instead of undercounting a duplicated module evaluation', async () => {
    const targetPath = '/workspace/Page.tsx';
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'Page',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: targetPath,
          strategy: 'selected-export-slice',
          watchSourcePaths: [targetPath],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Target',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: targetPath,
          strategy: 'selected-export-slice',
          watchSourcePaths: [targetPath],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'page-sliced',
      id: 'page-sliced',
      optionalSurfaces: [],
      watchSourcePaths: [targetPath],
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');

    const selection = await preparePreviewInspectorPageExecutionSelection({
      bundleDiagnostics,
      candidates: [candidate],
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Page', sourcePath: targetPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as never,
      policy,
      readSource: () =>
        Promise.resolve('export const Page = () => null; export const Target = () => null;'),
      resolveModule: () => undefined,
      workspaceRoot: '/workspace',
    });

    expect(selection).toMatchObject({
      disposition: 'rejected-structural',
      kind: 'rejected',
      prepared: { frontier: { summary: { truncationReasons: ['slice-unavailable'] } } },
    });
    expect(bundleDiagnostics.snapshot()).toMatchObject({
      candidateSelectionSortCount: 2,
      frontierCount: 1,
      rawSourceReadCount: 1,
    });
  });

  it('shares exact authentic and sliced inventories without changing candidate proof or traces', async () => {
    const workspaceRoot = '/workspace';
    const pagePath = '/workspace/Page.tsx';
    const targetPath = '/workspace/Target.tsx';
    const sources = new Map<string, string>([
      [
        pagePath,
        [
          "import { Target } from './Target';",
          'const Inner = () => <Target />;',
          'export const Page = () => <Inner />;',
          "export const Unused = () => import('./unused');",
        ].join('\n'),
      ],
      [targetPath, 'export const Target = () => null;'],
    ]);
    const surface = (
      id: string,
      sourcePath: string,
      exportName: string,
      strategy: 'authentic-module-export' | 'selected-export-slice' | 'inner-local-component-slice',
      localName?: string,
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id,
      ...(localName === undefined ? {} : { localName }),
      omittedTopLevelEffectCount: 0,
      sourcePath,
      strategy,
      watchSourcePaths: [sourcePath],
    });
    const candidates = [
      {
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          surface('authentic-page', pagePath, 'Page', 'authentic-module-export'),
          surface('authentic-target', targetPath, 'Target', 'authentic-module-export'),
        ],
        evidenceSourcePaths: [],
        fidelity: 'page-authentic',
        id: 'authentic',
        optionalSurfaces: [],
        watchSourcePaths: [pagePath, targetPath],
      },
      {
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          surface('local-page', pagePath, 'Page', 'inner-local-component-slice', 'Inner'),
          surface('local-target', targetPath, 'Target', 'authentic-module-export'),
        ],
        evidenceSourcePaths: [],
        fidelity: 'target-contextual',
        id: 'local',
        optionalSurfaces: [],
        watchSourcePaths: [pagePath, targetPath],
      },
      {
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          surface('sliced-page', pagePath, 'Page', 'selected-export-slice'),
          surface('sliced-target', targetPath, 'Target', 'authentic-module-export'),
        ],
        evidenceSourcePaths: [],
        fidelity: 'page-sliced',
        id: 'sliced',
        optionalSurfaces: [],
        watchSourcePaths: [pagePath, targetPath],
      },
    ] as unknown as readonly PreviewInspectorPageExecutionCandidate[];
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Page', sourcePath: pagePath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as never;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const run = async (
      withMemo: boolean,
      bundleDiagnostics?: PreviewInspectorBundleDiagnosticsCollector,
      sourceInventoryMemo = memo,
    ): Promise<{
      resolutions: string[];
      selection: Awaited<ReturnType<typeof preparePreviewInspectorPageExecutionSelection>>;
      sourceReads: string[];
    }> => {
      const sourceReads: string[] = [];
      const resolutions: string[] = [];
      const selection = await preparePreviewInspectorPageExecutionSelection({
        ...(bundleDiagnostics === undefined ? {} : { bundleDiagnostics }),
        candidates,
        plan,
        policy,
        readSource: (sourcePath) => {
          sourceReads.push(sourcePath);
          return Promise.resolve(sources.get(sourcePath));
        },
        resolveModule: (specifier, importer) => {
          resolutions.push(`${importer}\0${specifier}`);
          return specifier === './Target' && importer === pagePath ? targetPath : undefined;
        },
        ...(withMemo ? { sourceInventoryMemo } : {}),
        workspaceRoot,
      });
      return { resolutions, selection, sourceReads };
    };

    const withoutMemo = await run(false);
    const first = await run(true);
    const second = await run(true);
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const diagnosticsMemo = createPreviewInspectorBundleSourceInventoryMemo();
    const withDiagnostics = await run(true, bundleDiagnostics, diagnosticsMemo);
    const withDiagnosticsHit = await run(true, bundleDiagnostics, diagnosticsMemo);

    expect(JSON.stringify(first.selection)).toBe(JSON.stringify(withoutMemo.selection));
    expect(JSON.stringify(second.selection)).toBe(JSON.stringify(withoutMemo.selection));
    expect(first.sourceReads).toEqual(withoutMemo.sourceReads);
    expect(second.sourceReads).toEqual([]);
    expect(first.resolutions).toEqual([
      `${pagePath}\0./Target`,
      `${pagePath}\0./Target`,
      `${pagePath}\0./unused`,
      `${pagePath}\0./Target`,
    ]);
    expect(second.resolutions).toEqual([]);
    expect(JSON.stringify(withDiagnostics.selection)).toBe(JSON.stringify(withoutMemo.selection));
    expect(JSON.stringify(withDiagnosticsHit.selection)).toBe(
      JSON.stringify(withoutMemo.selection),
    );
    expect(withDiagnostics.sourceReads).toEqual(withoutMemo.sourceReads);
    expect(withDiagnostics.resolutions).toEqual(first.resolutions);
    expect(withDiagnosticsHit.sourceReads).toEqual([]);
    expect(withDiagnosticsHit.resolutions).toEqual([]);
    expect(first.selection?.kind).toBe('selected');
    if (first.selection?.kind !== 'selected') throw new Error('Expected selected Page Execution.');
    expect(first.selection.executionPlan.alternatives.map((item) => item.candidateId)).toEqual([
      'authentic',
      'local',
      'sliced',
    ]);
    expect(first.selection.executionPlan.candidate.id).toBe('authentic');
    expect(memo.getStatistics()).toEqual({
      computations: 4,
      entries: 4,
      hits: 0,
      released: false,
      requests: 4,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 2,
      sliceEntries: 2,
      sliceHits: 0,
      sliceRequests: 2,
    });
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 3,
      closureEntries: 3,
      closureHits: 3,
      closureRequests: 6,
      released: false,
    });
    // Each of the three candidates seeds Page and Target. Processing Page also enqueues its
    // resolved Target support before the already-seeded Target is admitted, so every frontier
    // performs three deterministic queue iterations (9 total). Authentic Page exposes its
    // static Target and unused dynamic edge; the local and selected slices expose only Target,
    // yielding four visited/resolved edges in total.
    expect(bundleDiagnostics.snapshot()).toMatchObject({
      authoredPathCheckCount: 9,
      authoredPathCheckMicros: 9,
      candidateSelectionMicros: 2,
      candidateSelectionSortCount: 2,
      edgeVisitCount: 4,
      frontierCount: 6,
      frontierFinalizeMicros: 18,
      frontierIdentityMicros: 6,
      inventoryComputationCount: 4,
      inventoryHitCount: 0,
      inventoryLookupMicros: 4,
      inventoryReadPathCacheHitCount: 0,
      inventoryReadRequestCount: 4,
      optionalClosureMicros: 0,
      optionalClosureProbeCount: 0,
      queueIterationCount: 9,
      queuePeakLength: 2,
      queueSortCount: 9,
      queueSortMicros: 9,
      rawSourceReadCount: 2,
      rawSourceReadMicros: 2,
      resolveModuleCount: 4,
      resolveModuleMicros: 4,
      sliceComputationCount: 2,
      sliceHitCount: 0,
      sliceLookupMicros: 2,
      sliceRequestCount: 2,
    });
    expect(diagnosticsMemo.getClosureStatistics()).toEqual({
      closureComputations: 3,
      closureEntries: 3,
      closureHits: 3,
      closureRequests: 6,
      released: false,
    });
    for (const requestMemo of [memo, diagnosticsMemo])
      expect(requestMemo.getGraphStatistics()).toMatchObject({
        dynamicResolutionEntries: 1,
        proposalEntries: 0,
        released: false,
        resolvedNodeComputations: 4,
        resolvedNodeEntries: 4,
        resolvedNodeHits: 2,
        resolvedNodeRequests: 6,
        rootedGraphEntries: 0,
      });
    memo.release();
    diagnosticsMemo.release();
    expect(memo.getClosureStatistics()).toMatchObject({ closureEntries: 0, released: true });
    expect(diagnosticsMemo.getClosureStatistics()).toMatchObject({
      closureEntries: 0,
      released: true,
    });
    for (const requestMemo of [memo, diagnosticsMemo])
      expect(requestMemo.getGraphStatistics()).toMatchObject({
        dynamicResolutionEntries: 0,
        proposalEntries: 0,
        released: true,
        resolvedNodeEntries: 0,
        rootedGraphEntries: 0,
      });
  });
});
