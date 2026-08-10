/** Verifies that cached path inventories do not broaden into unrelated framework/source analysis. */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { preparePreviewCompilerTarget } from '../../../src/adapters/esbuild/previewImperativeEntryTarget';
import {
  createPreviewCompleteRouteUsageContext,
  preparePreviewCompilerUsage,
} from '../../../src/adapters/esbuild/preparePreviewCompilerUsage';
import type { PreviewProjectUsageCache } from '../../../src/adapters/esbuild/previewProjectUsageCache';
import type { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const WORKSPACE_ROOT = '/workspace';

/** Creates one Page Inspector request whose source remains entirely in memory. */
function createRequest(
  documentPath: string,
  sourceText: string,
  preparationMode: 'fast' | 'full' = 'fast',
): PreviewBuildRequest {
  return {
    dependencySnapshots: [],
    documentPath,
    language: 'tsx',
    preparationMode,
    renderMode: 'page-inspector',
    sourceText,
    useStorybookPreview: false,
    workspaceRoot: WORKSPACE_ROOT,
  };
}

/** Creates a resolver stub because early inventory policy must not need project configuration. */
function createResolverStub(): ReturnType<typeof createPreviewStaticModuleResolver> {
  return {
    getJsxImportSource: () => undefined,
    getMatchedSpecifiers: () => [],
    isSideEffectFree: () => false,
    matchesTarget: () => false,
    resolve: () => undefined,
    resolveMissingPathAliasCandidate: () => undefined,
    usesAlternativeJsxRuntime: () => false,
  };
}

/** Runs the policy with an observable inventory boundary and no filesystem implementation. */
async function prepareWithInventoryProbe(
  request: PreviewBuildRequest,
  projectUsesNextRuntime: boolean,
): Promise<ReturnType<typeof vi.fn>> {
  const getSourcePaths = vi.fn(() => Promise.resolve(Object.freeze<string[]>([])));
  const cache = {
    discover: vi.fn(),
    getSourcePaths,
    readSourceText: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as PreviewProjectUsageCache;
  await preparePreviewCompilerUsage({
    cache,
    projectRoot: WORKSPACE_ROOT,
    projectUsesNextRuntime,
    request,
    resolver: createResolverStub(),
    setupKind: 'none',
    targetSelection: preparePreviewCompilerTarget(request),
    workspaceRoot: WORKSPACE_ROOT,
  });
  return getSourcePaths;
}

describe('preparePreviewCompilerUsage inventory policy', () => {
  /** Direct fast previews retain path-only bootstrap evidence without doing parent usage analysis. */
  it('indexes conventional bootstrap sources for a component export gallery', async () => {
    const request: PreviewBuildRequest = {
      ...createRequest(
        '/workspace/src/components/TargetCard.tsx',
        'export function TargetCard() { return <main />; }',
      ),
      renderMode: 'component',
    };
    const sourcePaths = Object.freeze([
      '/workspace/src/index.tsx',
      '/workspace/src/components/TargetCard.tsx',
    ]);
    const getSourcePaths = vi.fn(() => Promise.resolve(sourcePaths));
    const discover = vi.fn();
    const cache = {
      discover,
      getSourcePaths,
      readSourceText: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as PreviewProjectUsageCache;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot: WORKSPACE_ROOT,
      projectUsesNextRuntime: false,
      request,
      resolver: createResolverStub(),
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(getSourcePaths).toHaveBeenCalledTimes(1);
    expect(discover).not.toHaveBeenCalled();
    expect(prepared.implicitGlobalSourcePaths).toBe(sourcePaths);
  });

  /** Failed invariant work remains retryable and terminal release rejects later access. */
  it('retains only successful route-usage context stages', async () => {
    const usageContext = createPreviewCompleteRouteUsageContext();
    const failure = new Error('invariant stage failed');
    await expect(usageContext.getFastContext(() => Promise.reject(failure))).rejects.toBe(failure);
    const retained = Object.freeze({
      corridor: undefined,
      packageSourcePaths: Object.freeze(['/workspace/src/App.tsx']),
    });
    await expect(usageContext.getFastContext(() => Promise.resolve(retained))).resolves.toBe(
      retained,
    );
    await expect(
      usageContext.getFastContext(() => Promise.reject(new Error('must not execute'))),
    ).resolves.toBe(retained);
    expect(usageContext.getStatistics()).toMatchObject({
      fastContextComputations: 2,
      fastContextHits: 1,
      released: false,
    });

    usageContext.release();
    expect(usageContext.getStatistics().released).toBe(true);
    await expect(usageContext.getFastContext(() => Promise.resolve(retained))).rejects.toThrow(
      'already released',
    );
  });

  /** A generic page may use path-only caller ranking without being classified as a Next route. */
  it('indexes a lowercase page filename without assuming installed Next evidence', async () => {
    const request = createRequest(
      '/workspace/src/page.tsx',
      'export default function Page() { return <main>ordinary React page</main>; }',
    );

    const getSourcePaths = await prepareWithInventoryProbe(request, false);

    expect(getSourcePaths).toHaveBeenCalledTimes(1);
  });

  /** Next evidence still leaves an uppercase generic Page.tsx in the framework-neutral corridor. */
  it('indexes an uppercase generic Page.tsx without treating it as an App Router route', async () => {
    const request = createRequest(
      '/workspace/src/Page.tsx',
      'export default function Page() { return <main>generic page</main>; }',
    );

    const getSourcePaths = await prepareWithInventoryProbe(request, true);

    expect(getSourcePaths).toHaveBeenCalledTimes(1);
  });

  /** Fast first paint indexes cached paths but never reads every source merely for returned JSX. */
  it.each([
    [
      'default JSX factory',
      '/workspace/src/create-dialog.tsx',
      'export default function makeDialog() { return () => <aside>dialog</aside>; }',
    ],
    [
      'mixed configuration and hook exports',
      '/workspace/src/use-dialog.tsx',
      [
        "export const DIALOG_OPTIONS = { placement: 'center' };",
        'export const useDialog = () => ({ render: () => <aside>dialog</aside> });',
      ].join('\n'),
    ],
  ])(
    'uses path-only generic consumer discovery for %s during fast preparation',
    async (_name, documentPath, sourceText) => {
      const getSourcePaths = await prepareWithInventoryProbe(
        createRequest(documentPath, sourceText),
        false,
      );

      expect(getSourcePaths).toHaveBeenCalledTimes(1);
    },
  );

  /** Full enrichment retains callable-consumer discovery after the initial preview is visible. */
  it('enumerates generic consumers during full preparation', async () => {
    const getSourcePaths = await prepareWithInventoryProbe(
      createRequest(
        '/workspace/src/use-dialog.tsx',
        'export const useDialog = () => ({ render: () => <aside>dialog</aside> });',
        'full',
      ),
      false,
    );

    expect(getSourcePaths).toHaveBeenCalledTimes(1);
  });

  /**
   * Keeps fast route discovery convention-bounded while allowing one exact reached parameter
   * collection elsewhere in the same package through the existing bounded source reader.
   */
  it('reads a parameter-only project import outside the direct Next route inventory', async () => {
    const projectRoot = '/workspace/apps/web';
    const pagePath = `${projectRoot}/app/[name]/page.tsx`;
    const rootLayoutPath = `${projectRoot}/app/layout.tsx`;
    const registryPath = `${projectRoot}/lib/route-names.ts`;
    const pageSource = [
      "import { ROUTE_NAMES } from '../../lib/route-names';",
      'export function generateStaticParams() {',
      '  return ROUTE_NAMES.map((name) => ({ name }));',
      '}',
      'export default function Page() { return <main />; }',
    ].join('\n');
    const request: PreviewBuildRequest = {
      ...createRequest(pagePath, pageSource),
      dependencySnapshots: [
        {
          documentPath: rootLayoutPath,
          language: 'tsx',
          sourceText:
            'export default function RootLayout({ children }) { return <body>{children}</body>; }',
        },
      ],
    };
    const readSourceText = vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
      Promise.resolve(
        path.normalize(sourcePath) === path.normalize(registryPath)
          ? "export const ROUTE_NAMES = ['authored'];"
          : undefined,
      ),
    );
    const getSourcePaths = vi.fn();
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText,
    } as unknown as PreviewProjectUsageCache;
    const resolver = {
      ...createResolverStub(),
      resolve: (specifier: string, consumer: string) =>
        specifier === '../../lib/route-names' &&
        path.normalize(consumer) === path.normalize(pagePath)
          ? registryPath
          : undefined,
    } as ReturnType<typeof createPreviewStaticModuleResolver>;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: true,
      request,
      resolver,
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(
      prepared.packageTargetUsageProps.inspectorPlan?.pageCandidates[0]?.routeLocation,
    ).toMatchObject({
      params: { name: 'authored' },
      pathname: '/authored',
    });
    expect(prepared.packageTargetUsageProps.dependencyPaths).toContain(registryPath);
    expect(readSourceText).toHaveBeenCalledWith({
      maximumBytes: 4 * 1024 * 1024,
      sourcePath: registryPath,
    });
    expect(getSourcePaths).not.toHaveBeenCalled();
  });

  /**
   * Pages Router supplies `_app` through framework props, so fast preparation must add that shell
   * and its dynamic route evidence without waiting for the later package inventory pass.
   */
  it('prepares a direct Next Pages route with its app shell on the first fast artifact', async () => {
    const projectRoot = '/workspace/apps/front-office';
    const pagePath = `${projectRoot}/pages/hotels/[hotelName]/callTada.tsx`;
    const appPath = `${projectRoot}/pages/_app.tsx`;
    const guardPath = `${projectRoot}/lib/guard.ts`;
    const constantsPath = `${projectRoot}/lib/constants.ts`;
    const pageSource = [
      "import { guardPage } from '../../../lib/guard';",
      'export default function CallTada() { return <main>Call</main>; }',
      'export const getServerSideProps = guardPage();',
    ].join('\n');
    const request: PreviewBuildRequest = {
      ...createRequest(pagePath, pageSource),
      dependencySnapshots: [
        {
          documentPath: appPath,
          language: 'tsx',
          sourceText: [
            "import { QueryClientProvider } from '@tanstack/react-query';",
            'export default function App({ Component, pageProps }) {',
            '  return <QueryClientProvider><Component {...pageProps} /></QueryClientProvider>;',
            '}',
          ].join('\n'),
        },
      ],
    };
    const sourceByPath = new Map<string, string>([
      [
        guardPath,
        [
          "import { REGISTERED_HOTELS } from './constants';",
          'export const guardPage = () => async ({ query }) => {',
          '  const hotelName = query.hotelName;',
          '  if (!Object.keys(REGISTERED_HOTELS).includes(hotelName)) return { notFound: true };',
          '  return { props: { hotelName } };',
          '};',
        ].join('\n'),
      ],
      [constantsPath, 'export const REGISTERED_HOTELS = { testHotel: {}, secondHotel: {} };'],
    ]);
    const getSourcePaths = vi.fn();
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText: vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
        Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      ),
    } as unknown as PreviewProjectUsageCache;
    const resolver = {
      ...createResolverStub(),
      resolve: (specifier: string, consumer: string) => {
        if (
          path.normalize(consumer) === path.normalize(pagePath) &&
          specifier === '../../../lib/guard'
        ) {
          return guardPath;
        }
        if (path.normalize(consumer) === path.normalize(guardPath) && specifier === './constants') {
          return constantsPath;
        }
        return undefined;
      },
    } as ReturnType<typeof createPreviewStaticModuleResolver>;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: true,
      request,
      resolver,
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(getSourcePaths).not.toHaveBeenCalled();
    expect(prepared.packageTargetUsageProps.inspectorPlan?.pageCandidates[0]).toMatchObject({
      id: `next-pages-direct:${pagePath}`,
      nextPagesShell: {
        app: { exportName: 'default', sourcePath: appPath },
        routeLocation: {
          pathname: '/hotels/testHotel/callTada',
          pattern: '/hotels/[hotelName]/callTada',
        },
      },
      root: { exportName: 'default', sourcePath: pagePath },
    });
    expect(prepared.implicitGlobalSourcePaths).toEqual(
      expect.arrayContaining([pagePath, appPath, guardPath, constantsPath]),
    );
  });

  /** A local story must not mask the entry-connected product page in a sibling app package. */
  it('compares a weak package-local callable consumer with the monorepo application path', async () => {
    const projectRoot = '/workspace/packages/dialog';
    const hookPath = `${projectRoot}/src/use-dialog.tsx`;
    const storyPath = `${projectRoot}/src/use-dialog.stories.tsx`;
    const pagePath = '/workspace/apps/web/src/DialogPage.tsx';
    const entryPath = '/workspace/apps/web/src/main.tsx';
    const sources = new Map<string, string>([
      [hookPath, 'export const useDialog = () => ({ render: () => <aside>dialog</aside> });'],
      [
        storyPath,
        [
          "import { useDialog } from './use-dialog';",
          'export function DialogStory() {',
          '  const dialog = useDialog();',
          '  return <section>{dialog.render()}</section>;',
          '}',
        ].join('\n'),
      ],
      [
        pagePath,
        [
          "import { useDialog } from '../../../packages/dialog/src/use-dialog';",
          'export default function DialogPage() {',
          '  const dialog = useDialog();',
          '  return <main>{dialog.render()}</main>;',
          '}',
        ].join('\n'),
      ],
      [
        entryPath,
        [
          "import { createRoot } from 'react-dom/client';",
          "import DialogPage from './DialogPage';",
          'createRoot(document.body).render(<DialogPage />);',
        ].join('\n'),
      ],
    ]);
    const localSourcePaths = Object.freeze([hookPath, storyPath]);
    const workspaceSourcePaths = Object.freeze([...sources.keys()]);
    const getSourcePaths = vi.fn((_workspaceRoot: string, inventoryRoot: string) =>
      Promise.resolve(inventoryRoot === projectRoot ? localSourcePaths : workspaceSourcePaths),
    );
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText: vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
        Promise.resolve(sources.get(path.normalize(sourcePath))),
      ),
    } as unknown as PreviewProjectUsageCache;
    const resolver = {
      ...createResolverStub(),
      resolve: (specifier: string, consumer: string) => {
        if (!specifier.startsWith('.')) return undefined;
        const basePath = path.resolve(path.dirname(consumer), specifier);
        return [basePath, `${basePath}.tsx`, `${basePath}.ts`].find((candidate) =>
          sources.has(path.normalize(candidate)),
        );
      },
    } as ReturnType<typeof createPreviewStaticModuleResolver>;
    const request = createRequest(hookPath, sources.get(hookPath) ?? '', 'full');

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: false,
      request,
      resolver,
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(getSourcePaths).toHaveBeenCalledTimes(2);
    expect(prepared.packageTargetUsageProps.inspectorPlan?.root.sourcePath).toBe(pagePath);
    expect(prepared.packageTargetUsageProps.inspectorPlan?.renderChain.reachability).toBe(
      'entry-connected',
    );
  });
});
