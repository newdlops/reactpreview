/** Verifies App Router's implicit layout-to-descendant-page candidate expansion. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorNextAppDescendantPages } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppDescendantPages';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';

const ROOT_LAYOUT = '/workspace/app/layout.tsx';
const PREVIEW_LAYOUT = '/workspace/app/(view)/preview/layout.tsx';

/** Creates the generic nearest-owner candidate produced before filesystem edges are restored. */
function createLayoutCandidate(): PreviewInspectorPageCandidate {
  return {
    complete: true,
    dependencyPaths: [PREVIEW_LAYOUT],
    edges: [],
    id: 'nearest-layout',
    root: { exportName: 'default', sourcePath: PREVIEW_LAYOUT },
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    stopReason: 'root-reached',
    targetAutomaticProps: {},
  };
}

describe('collectPreviewInspectorNextAppDescendantPages', () => {
  /** Finds ordinary grouped/dynamic leaves while excluding sibling and parallel route branches. */
  it('creates bounded nearest page candidates below the selected layout', async () => {
    const dynamicPage = '/workspace/app/(view)/preview/[base]/[name]/page.tsx';
    const registryPath = '/workspace/app/(view)/preview/[base]/[name]/registry.ts';
    const typesetLayout = '/workspace/app/(view)/preview/typeset/layout.tsx';
    const typesetPage = '/workspace/app/(view)/preview/typeset/[name]/page.tsx';
    const parallelPage = '/workspace/app/(view)/preview/@modal/(.)item/[id]/page.tsx';
    const unrelatedPage = '/workspace/app/(app)/page.tsx';
    const sourceByPath: Record<string, string> = {
      [dynamicPage]: [
        `import { BASES } from './registry';`,
        `const ITEMS = ['preview', 'preview-02'] as const;`,
        'export function generateStaticParams() {',
        '  return BASES.flatMap((base) => ITEMS.map((name) => ({ base: base.name, name })));',
        '}',
        'export default function Page() { return <main />; }',
      ].join('\n'),
      [registryPath]: `export const BASES = [{ name: 'radix' }] as const;`,
      [typesetPage]: 'export default function TypesetPage() { return <article />; }',
    };

    const candidates = await collectPreviewInspectorNextAppDescendantPages({
      base: createLayoutCandidate(),
      maximumCount: 2,
      readSource: (sourcePath) => Promise.resolve(sourceByPath[sourcePath]),
      sourcePaths: [
        ROOT_LAYOUT,
        PREVIEW_LAYOUT,
        dynamicPage,
        registryPath,
        typesetLayout,
        typesetPage,
        parallelPage,
        unrelatedPage,
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.root.sourcePath)).toEqual([
      dynamicPage,
      typesetPage,
    ]);
    expect(candidates[0]).toMatchObject({
      complete: true,
      routeLocation: {
        evidenceKind: 'next-app-filesystem',
        params: { base: 'radix', name: 'preview' },
        pathname: '/preview/radix/preview',
      },
      stopReason: 'root-reached',
    });
    expect(candidates[0]?.nextAppLayoutChain?.map((layout) => layout.sourcePath)).toEqual([
      ROOT_LAYOUT,
      PREVIEW_LAYOUT,
    ]);
    expect(candidates[1]?.nextAppLayoutChain?.map((layout) => layout.sourcePath)).toEqual([
      ROOT_LAYOUT,
      PREVIEW_LAYOUT,
      typesetLayout,
    ]);
    expect(candidates.flatMap((candidate) => candidate.dependencyPaths)).not.toContain(
      parallelPage,
    );
    expect(candidates.flatMap((candidate) => candidate.dependencyPaths)).not.toContain(
      unrelatedPage,
    );
    expect(candidates[0]?.dependencyPaths).toContain(registryPath);
  });

  /** Refuses a similarly named generic layout without a default App Router export contract. */
  it('does not expand named or non-layout roots', async () => {
    const base = createLayoutCandidate();
    await expect(
      collectPreviewInspectorNextAppDescendantPages({
        base: { ...base, root: { exportName: 'PreviewLayout', sourcePath: PREVIEW_LAYOUT } },
        maximumCount: 2,
        readSource: () => Promise.resolve(undefined),
        sourcePaths: [ROOT_LAYOUT, PREVIEW_LAYOUT, '/workspace/app/page.tsx'],
      }),
    ).resolves.toEqual([]);
  });

  /** A template owns the same implicit descendant page edge as its neighboring layout. */
  it('expands a selected template into its ordinary descendant page', async () => {
    const templatePath = '/workspace/app/(view)/preview/template.tsx';
    const pagePath = '/workspace/app/(view)/preview/details/page.tsx';
    const base = createLayoutCandidate();
    const candidates = await collectPreviewInspectorNextAppDescendantPages({
      base: {
        ...base,
        dependencyPaths: [templatePath],
        root: { exportName: 'default', sourcePath: templatePath },
      },
      maximumCount: 1,
      readSource: () => Promise.resolve(undefined),
      sourcePaths: [ROOT_LAYOUT, PREVIEW_LAYOUT, templatePath, pagePath],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.root.sourcePath).toBe(pagePath);
    expect(candidates[0]?.nextAppLayoutChain?.map((wrapper) => wrapper.sourcePath)).toEqual([
      ROOT_LAYOUT,
      PREVIEW_LAYOUT,
      templatePath,
    ]);
  });
});
