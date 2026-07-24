/**
 * Verifies that fast VirtualPage compilation keeps every proven authored consumer of a shared
 * component instead of publishing only the highest-ranked page.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { preparePreviewCompilerTarget } from '../../../src/adapters/esbuild/previewImperativeEntryTarget';
import { PreviewProjectUsageCache } from '../../../src/adapters/esbuild/previewProjectUsageCache';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';
import { preparePreviewCompilerUsage } from '../../../src/adapters/esbuild/preparePreviewCompilerUsage';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Writes one fixture module while preserving its absolute identity for descriptor assertions. */
async function writeFixtureSource(
  projectRoot: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return sourcePath;
}

/** Decodes the entry and lazy chunks because alternate VirtualPages remain asynchronous. */
function decodeCompleteArtifact(bundle: {
  readonly chunks: readonly { readonly contents: Uint8Array }[];
  readonly javascript: Uint8Array;
}): string {
  return Buffer.concat([
    Buffer.from(bundle.javascript),
    ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
  ]).toString('utf8');
}

describe('EsbuildPreviewCompiler shared-component page candidates', () => {
  /** Publishes both real pages during fast preparation and leaves browser selection lazy. */
  it('keeps independently selectable pages that consume the same component', async () => {
    const fixtureParent = path.join(REPOSITORY_ROOT, '.tmp');
    await mkdir(fixtureParent, { recursive: true });
    const projectRoot = await mkdtemp(path.join(fixtureParent, 'multiple-page-candidates-'));
    const compiler = new EsbuildPreviewCompiler();
    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
      const targetSource =
        'export function SharedCard() { return <article>SHARED_CARD_MARKER</article>; }';
      const targetPath = await writeFixtureSource(
        projectRoot,
        'src/components/SharedCard.tsx',
        targetSource,
      );
      const publicPagePath = await writeFixtureSource(
        projectRoot,
        'src/features/customer/pages/PublicPage.tsx',
        [
          "import { SharedCard } from '../../../components/SharedCard';",
          'export function PublicPage() {',
          '  return <main>PUBLIC_PAGE_MARKER<SharedCard /></main>;',
          '}',
        ].join('\n'),
      );
      const staffPagePath = await writeFixtureSource(
        projectRoot,
        'src/features/staff/pages/StaffPage.tsx',
        [
          "import { SharedCard } from '../../../components/SharedCard';",
          'export function StaffPage() {',
          '  return <main>STAFF_PAGE_MARKER<SharedCard /></main>;',
          '}',
        ].join('\n'),
      );
      await Promise.all([
        writeFixtureSource(
          projectRoot,
          'src/portal/main.tsx',
          [
            "import { createRoot } from 'react-dom/client';",
            "import { PublicPage } from '../features/customer/pages/PublicPage';",
            'createRoot(document.body).render(<PublicPage />);',
          ].join('\n'),
        ),
        writeFixtureSource(
          projectRoot,
          'src/staff/main.tsx',
          [
            "import { createRoot } from 'react-dom/client';",
            "import { StaffPage } from '../features/staff/pages/StaffPage';",
            'createRoot(document.body).render(<StaffPage />);',
          ].join('\n'),
        ),
      ]);
      const resolver = createPreviewStaticModuleResolver({ workspaceRoot: projectRoot });
      const preparedUsage = await preparePreviewCompilerUsage({
        cache: new PreviewProjectUsageCache(),
        projectRoot,
        projectUsesNextRuntime: false,
        request: {
          dependencySnapshots: [],
          documentPath: targetPath,
          language: 'tsx',
          preparationMode: 'fast',
          renderMode: 'page-inspector',
          sourceText: targetSource,
          useStorybookPreview: false,
          workspaceRoot: projectRoot,
        },
        resolver,
        setupKind: 'none',
        targetSelection: preparePreviewCompilerTarget({
          documentPath: targetPath,
          renderMode: 'page-inspector',
          sourceText: targetSource,
        }),
        workspaceRoot: projectRoot,
      });
      expect(
        preparedUsage.packageTargetUsageProps.inspectorPlan?.pageCandidates.map(
          (candidate) => candidate.root.sourcePath,
        ),
      ).toEqual(expect.arrayContaining([publicPagePath, staffPagePath]));

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeCompleteArtifact(bundle);

      expect(javascript).toContain('PUBLIC_PAGE_MARKER');
      expect(javascript).toContain('STAFF_PAGE_MARKER');
      expect(javascript).toContain('SHARED_CARD_MARKER');
      expect(javascript).toContain(publicPagePath);
      expect(javascript).toContain(staffPagePath);
      expect(bundle.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);
});
