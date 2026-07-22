/** Verifies that optional page-context inventories begin only from framework or callable evidence. */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { preparePreviewCompilerTarget } from '../../../src/adapters/esbuild/previewImperativeEntryTarget';
import { preparePreviewCompilerUsage } from '../../../src/adapters/esbuild/preparePreviewCompilerUsage';
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
  /** A framework-like basename alone must not turn an ordinary React package into a Next scan. */
  it('does not enumerate a lowercase App route filename without installed Next evidence', async () => {
    const request = createRequest(
      '/workspace/src/page.tsx',
      'export default function Page() { return <main>ordinary React page</main>; }',
    );

    const getSourcePaths = await prepareWithInventoryProbe(request, false);

    expect(getSourcePaths).not.toHaveBeenCalled();
  });

  /** Next's filesystem conventions are lowercase and must not capture generic Page.tsx modules. */
  it('does not treat an uppercase generic Page.tsx as an App Router route', async () => {
    const request = createRequest(
      '/workspace/src/Page.tsx',
      'export default function Page() { return <main>generic page</main>; }',
    );

    const getSourcePaths = await prepareWithInventoryProbe(request, true);

    expect(getSourcePaths).not.toHaveBeenCalled();
  });

  /** Fast first paint never scans every project source merely because a helper returns JSX. */
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
    'defers generic consumer discovery for %s during fast preparation',
    async (_name, documentPath, sourceText) => {
      const getSourcePaths = await prepareWithInventoryProbe(
        createRequest(documentPath, sourceText),
        false,
      );

      expect(getSourcePaths).not.toHaveBeenCalled();
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
