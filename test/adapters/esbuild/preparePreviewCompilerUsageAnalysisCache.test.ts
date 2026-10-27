/** Real fast ancestry must reuse inert facts while unsaved edits retain exact current evidence. */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { preparePreviewCompilerUsage } from '../../../src/adapters/esbuild/preparePreviewCompilerUsage';
import { preparePreviewCompilerTarget } from '../../../src/adapters/esbuild/previewImperativeEntryTarget';
import { PreviewProjectFileAnalysisCache } from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';
import { PreviewProjectUsageCache } from '../../../src/adapters/esbuild/previewProjectUsageCache';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

it('reuses named-export render facts and invalidates the edited consumer without stale ancestry', async () => {
  const projectRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'preview-fast-analysis-cache-')),
  );
  const targetPath = path.join(projectRoot, 'src/components/Section.tsx');
  const pagePath = path.join(projectRoot, 'src/pages/Dashboard.tsx');
  const sources = {
    'src/main.tsx':
      "import { createRoot } from 'react-dom/client'; import App from './App'; createRoot(document.body).render(<App />);",
    'src/App.tsx':
      "import Dashboard from './pages/Dashboard'; export default function App() { return <Dashboard />; }",
    'src/pages/Dashboard.tsx':
      "import { SectionHeader, SectionBody } from '../components/Section'; export default function Dashboard() { return <main><SectionHeader title='saved' /><SectionBody /></main>; }",
    'src/components/Section.tsx':
      'export const SectionHeader = ({title}) => <h2>{title}</h2>; export const SectionBody = () => <section>Body</section>;',
  };
  try {
    await Promise.all(
      Object.entries(sources).map(async ([relative, text]) => {
        const sourcePath = path.join(projectRoot, relative);
        await mkdir(path.dirname(sourcePath), { recursive: true });
        await writeFile(sourcePath, text);
      }),
    );
    const fileCache = new PreviewProjectFileAnalysisCache();
    const analyze = vi.spyOn(fileCache, 'analyzeRenderSource');
    const imports = vi.spyOn(fileCache, 'collectModuleSpecifiers');
    const cache = new PreviewProjectUsageCache({ fileAnalysisCache: fileCache });
    const request: PreviewBuildRequest = {
      dependencySnapshots: [],
      documentPath: targetPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText: sources['src/components/Section.tsx'],
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    };
    const prepare = (
      current: PreviewBuildRequest,
      usageCache = cache,
    ): ReturnType<typeof preparePreviewCompilerUsage> =>
      preparePreviewCompilerUsage({
        cache: usageCache,
        projectRoot,
        projectUsesNextRuntime: false,
        request: current,
        resolver: createPreviewStaticModuleResolver({ workspaceRoot: projectRoot }),
        setupKind: 'none',
        targetSelection: preparePreviewCompilerTarget(current),
        workspaceRoot: projectRoot,
      });
    const first = await prepare(request);
    const second = await prepare(request);
    expect(second).toEqual(first);
    expect(analyze).toHaveBeenCalled();
    expect(imports).toHaveBeenCalled();
    const unchangedResults = analyze.mock.calls.flatMap(
      ([sourcePath], index): readonly unknown[] => {
        const value: unknown = analyze.mock.results[index]?.value;
        return sourcePath === pagePath ? [value] : [];
      },
    );
    expect(unchangedResults.length).toBeGreaterThan(1);
    expect(unchangedResults.every((value) => value === unchangedResults[0])).toBe(true);
    const plan = first.packageTargetUsageProps.inspectorPlan;
    expect(plan?.pageCandidates.map((candidate) => candidate.target?.exportName)).toEqual(
      expect.arrayContaining(['SectionHeader', 'SectionBody']),
    );

    const edited = sources['src/pages/Dashboard.tsx']
      .replace('function Dashboard()', 'function EditedDashboard()')
      .replace("title='saved'", "title='unsaved'");
    const changedRequest = {
      ...request,
      dependencySnapshots: [
        { documentPath: pagePath, language: 'tsx' as const, sourceText: edited },
      ],
    };
    const changed = await prepare(changedRequest);
    const fresh = await prepare(changedRequest, new PreviewProjectUsageCache());
    expect(changed).toEqual(fresh);
    expect(changed).not.toEqual(first);
    expect(JSON.stringify(changed)).toContain('EditedDashboard');
    expect(
      analyze.mock.calls.some(([sourcePath, text]) => sourcePath === pagePath && text === edited),
    ).toBe(true);
    expect(await readFile(pagePath, 'utf8')).toBe(sources['src/pages/Dashboard.tsx']);
    const reverted = await prepare(request);
    expect(reverted).toEqual(first);
    cache.clear();
    expect(await prepare(request)).toEqual(first);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
