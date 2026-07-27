import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
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

  it('selects the highest-fidelity soft candidate before considering a smaller target-only slice', async () => {
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
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id,
      omittedTopLevelEffectCount: 0,
      sourcePath,
      strategy: 'authentic-module-export' as const,
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
    expect(selection.executionPlan.candidate.fidelity).toBe('page-authentic');
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

    const selection = await preparePreviewInspectorPageExecutionSelection({
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
  });
});
