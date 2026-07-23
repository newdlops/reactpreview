/**
 * Verifies fast entry-to-page discovery across a production-shaped lazy application hierarchy.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewInspectorFastPageCorridor } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCorridor';

const temporaryRoots: string[] = [];

/** Removes every fixture tree even when an assertion interrupts a test. */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

/** Writes one authored module and returns its normalized absolute identity. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return path.normalize(sourcePath);
}

/** Resolves relative fixture requests with the same extension/barrel choices used by the compiler. */
function createResolver(sourcePaths: readonly string[]) {
  const knownPaths = new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  return (specifier: string, importerPath: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    const candidate = path.resolve(path.dirname(importerPath), specifier);
    return [
      candidate,
      `${candidate}.tsx`,
      `${candidate}.ts`,
      path.join(candidate, 'index.tsx'),
      path.join(candidate, 'index.ts'),
    ]
      .map((sourcePath) => path.normalize(sourcePath))
      .find((sourcePath) => knownPaths.has(sourcePath));
  };
}

describe('fast application page corridor', () => {
  it('connects a lazy build target through the app router and nested company subapps', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'fast-authored-app-path-'));
    temporaryRoots.push(projectRoot);
    const siblingSources = await Promise.all(
      Array.from({ length: 49 }, (_, index) =>
        writeSource(
          projectRoot,
          `src/legal/pages/Sibling${index.toString()}.tsx`,
          `export default function Sibling${index.toString()}() { return null; }`,
        ),
      ),
    );
    const sources = [
      ...(await Promise.all([
        writeSource(
          projectRoot,
          'src/index.tsx',
          [
            "import { lazy } from 'react';",
            "import { createRoot } from 'react-dom/client';",
            "const BUILD_TARGETS = { legal: lazy(() => import('./legal/app')) };",
            "const LoadableApp = BUILD_TARGETS['legal'];",
            'createRoot(document.body).render(<LoadableApp />);',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/legal/app.tsx',
          [
            "import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';",
            "import RootLayout from './RootLayout';",
            "import { pagesMap } from './config/pages-map';",
            "import { CompanyApp } from './company/CompanyApp';",
            ...Array.from(
              { length: 49 },
              (_, index) =>
                `import Sibling${index.toString()} from './pages/Sibling${index.toString()}';`,
            ),
            'void pagesMap;',
            'const router = createBrowserRouter(createRoutesFromElements(',
            '<Route element={<RootLayout />}>',
            '<Route path={`${CompanyApp.basePath}/*`} element={<CompanyApp />} />',
            ...Array.from(
              { length: 49 },
              (_, index) =>
                `<Route path="sibling-${index.toString()}" element={<Sibling${index.toString()} />} />`,
            ),
            '</Route>));',
            'export default function AppRouter() { return <RouterProvider router={router} />; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/legal/RootLayout.tsx',
          'export default function RootLayout() { return <main>Root shell</main>; }',
        ),
        writeSource(
          projectRoot,
          'src/legal/config/pages-map.ts',
          'export const pagesMap = { upload: "/company/upload" };',
        ),
        writeSource(
          projectRoot,
          'src/legal/company/CompanyApp.tsx',
          [
            "import CompanyOwnerApp from './CompanyOwnerApp';",
            'export function CompanyApp() { return <CompanyOwnerApp />; }',
            "CompanyApp.basePath = '/company';",
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/legal/company/CompanyOwnerApp.tsx',
          "import SelectedSubApp from '../selected/SelectedSubApp'; export default function CompanyOwnerApp() { return <SelectedSubApp />; }",
        ),
        writeSource(
          projectRoot,
          'src/legal/selected/SelectedSubApp.tsx',
          "import { UploadPage } from './pages'; export default function SelectedSubApp() { return <UploadPage />; }",
        ),
        writeSource(
          projectRoot,
          'src/legal/selected/pages/index.ts',
          "import { lazy } from 'react'; export const UploadPage = lazy(() => import('./UploadPage'));",
        ),
        writeSource(
          projectRoot,
          'src/legal/selected/pages/UploadPage.tsx',
          "import TargetPanel from '../TargetPanel'; export default function UploadPage() { return <TargetPanel />; }",
        ),
        writeSource(
          projectRoot,
          'src/legal/selected/TargetPanel.tsx',
          'export default function TargetPanel() { return <section>Selected</section>; }',
        ),
      ])),
      ...siblingSources,
    ];
    const targetPath = path.join(projectRoot, 'src/legal/selected/TargetPanel.tsx');

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath.map((sourcePath) => path.basename(sourcePath))).toEqual([
      'index.tsx',
      'app.tsx',
      'CompanyApp.tsx',
      'CompanyOwnerApp.tsx',
      'SelectedSubApp.tsx',
      'index.ts',
      'UploadPage.tsx',
      'TargetPanel.tsx',
    ]);
    expect(corridor?.sourcePaths).toContain(path.join(projectRoot, 'src/legal/RootLayout.tsx'));
    expect(corridor?.sourcePaths).toContain(
      path.join(projectRoot, 'src/legal/config/pages-map.ts'),
    );
    expect(
      corridor?.sourcePaths.some((sourcePath) => path.basename(sourcePath).startsWith('Sibling')),
    ).toBe(false);
  });
});
