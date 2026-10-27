/** Generic authored factory/Provider sources with two selectable page exports and no project code. */
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorTypes';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';
import { createFactoryProviderRouteOptions } from './previewInspectorRouteBranchFactoryOwnerFixtures';

/** Source-only collaborators shared by frontier and real esbuild admission checks. */
export interface ActiveFactoryLeafFixture {
  /** Directory that esbuild uses to resolve this isolated fixture's authored modules. */
  readonly workspaceRoot: string;
  /** Full factory source used as the native compilation entry. */
  readonly appPath: string;
  /** Current-file ownership must remain pinned to this Provider. */
  readonly providerPath: string;
  /** The named export module shared by both route choices. */
  readonly pagesPath: string;
  /** The two real page bodies, which must never be conflated by source memo reuse. */
  readonly leafPaths: Readonly<Record<'EditPage' | 'PreviewPage', string>>;
  /** Reads only inert fixture text without executing any authored module. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Resolves only fixture-local source references; external packages remain ordinary externals. */
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  /** Uses the production ancestor analyzer, preserving automatic and explicit route selection. */
  readonly createPlan: (selected?: 'PreviewPage') => Promise<PreviewInspectorAncestorPlan>;
}

/** Writes one bounded test workspace and derives the same nested owner context as the native case. */
export async function createActiveFactoryLeafFixture(
  workspaceRoot: string,
  exportStyle: 'lazy' | 'reexport' = 'lazy',
): Promise<ActiveFactoryLeafFixture> {
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const sourceRoot = path.join(canonicalWorkspaceRoot, 'src');
  const original = createFactoryProviderRouteOptions();
  const entries: Record<string, string> = {};
  for (const sourcePath of original.sourcePaths) {
    const source = await original.readSource(sourcePath);
    if (source !== undefined) entries[path.basename(sourcePath)] = source;
  }
  entries['detail-app.tsx'] = (entries['detail-app.tsx'] ?? '')
    .replace('import { PreviewPage } from "./preview-page";', '')
    .replace(
      'import { EditPage } from "./edit-page";',
      'import { EditPage, PreviewPage } from "./pages";',
    );
  entries['detail-provider.tsx'] = [
    'import { createContext } from "react";',
    'const Context = createContext({});',
    'export function DetailProvider({ children }) { return <Context.Provider value={{}}>{children}</Context.Provider>; }',
  ].join('\n');
  entries['pages.ts'] =
    exportStyle === 'lazy'
      ? 'import { lazy } from "react"; export const EditPage = lazy(() => import("./edit-page")); export const PreviewPage = lazy(() => import("./preview-page"));'
      : 'export { default as EditPage } from "./edit-page"; export { default as PreviewPage } from "./preview-page";';
  entries['edit-page.tsx'] =
    'export default function EditPageBody() { return <main>ACTIVE_EDIT_BODY</main>; }';
  entries['preview-page.tsx'] =
    'export default function PreviewPageBody() { return <main>ACTIVE_PREVIEW_BODY</main>; }';
  entries['main.tsx'] =
    'import { createRoot } from "react-dom/client"; import { RootApp } from "./root-app"; createRoot(document.getElementById("root")).render(<RootApp />);';
  const sources = new Map(
    Object.entries(entries).map(([name, text]) => [path.join(sourceRoot, name), text]),
  );
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all(
    [...sources].map(([sourcePath, sourceText]) => writeFile(sourcePath, sourceText)),
  );
  const providerPath = path.join(sourceRoot, 'detail-provider.tsx');
  const chain: PreviewRenderChainPlan = {
    dependencyPaths: [...sources.keys()],
    paths: [
      {
        id: 'generic-provider-owner-path',
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 0,
          sourcePath: path.join(sourceRoot, 'main.tsx'),
          wrapperNames: [],
        },
        steps: (
          [
            ['DetailProvider', 'detail-provider.tsx'],
            ['DetailApp', 'detail-app.tsx'],
            ['AreaApp', 'area-app.tsx'],
            ['RootApp', 'root-app.tsx'],
          ] as const
        ).map(([label, name]) => ({
          certainty: 'confirmed' as const,
          kind: 'component-render' as const,
          label,
          occurrenceStart: 0,
          sourcePath: path.join(sourceRoot, name),
          wrapperNames: [],
        })),
      },
    ],
    reachability: 'entry-connected',
    target: { exportName: 'DetailProvider', sourcePath: providerPath },
    truncated: false,
  };
  const readSource = (sourcePath: string): Promise<string | undefined> =>
    Promise.resolve(sources.get(sourcePath));
  const resolveModule = (specifier: string, importer: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    const base = path.resolve(path.dirname(importer), specifier);
    return ['', '.ts', '.tsx', '.json']
      .map((suffix) => base + suffix)
      .find((candidate) => sources.has(candidate));
  };
  return {
    workspaceRoot: canonicalWorkspaceRoot,
    providerPath,
    appPath: path.join(sourceRoot, 'detail-app.tsx'),
    pagesPath: path.join(sourceRoot, 'pages.ts'),
    leafPaths: {
      EditPage: path.join(sourceRoot, 'edit-page.tsx'),
      PreviewPage: path.join(sourceRoot, 'preview-page.tsx'),
    },
    readSource,
    resolveModule,
    createPlan: (selected) =>
      createPreviewInspectorAncestorPlan({
        documentPath: providerPath,
        exportName: 'DetailProvider',
        readSource,
        resolveModule,
        sourcePaths: [...sources.keys()],
        renderChainsByExport: { DetailProvider: chain },
        ...(selected === undefined
          ? {}
          : {
              routeSelection: [
                { componentName: 'AreaApp', pattern: '/root/:areaId(\\d+)' },
                {
                  componentName: 'DetailApp',
                  pattern: '/root/:areaId(\\d+)/detail/:kind/:detailId(\\d+)',
                },
                {
                  componentName: 'PreviewPage',
                  pattern: '/root/:areaId(\\d+)/detail/:kind/:detailId(\\d+)/preview',
                },
              ],
            }),
      }),
  };
}
