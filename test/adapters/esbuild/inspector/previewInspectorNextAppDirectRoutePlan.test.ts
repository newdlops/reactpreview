/** Verifies the cold-build Next App route plan remains bounded to one authored page corridor. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNextAppDirectRoutePlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppDirectRoutePlan';

/** Creates one normalized in-memory source inventory and a relative-import resolver for fixtures. */
function createFixture(sources: Readonly<Record<string, string>>): {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, consumer: string) => string | undefined;
  readonly sourcePaths: readonly string[];
} {
  const sourceByPath = new Map(
    Object.entries(sources).map(([sourcePath, sourceText]) => [
      path.normalize(sourcePath),
      sourceText,
    ]),
  );
  return {
    readSource: (sourcePath) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
    resolveModule: (specifier, consumer) => {
      if (!specifier.startsWith('.')) return undefined;
      const base = path.resolve(path.dirname(consumer), specifier);
      return [base, ...['.tsx', '.ts', '.jsx', '.js'].map((extension) => base + extension)].find(
        (candidate) => sourceByPath.has(path.normalize(candidate)),
      );
    },
    sourcePaths: Object.freeze([...sourceByPath.keys()]),
  };
}

describe('createPreviewInspectorNextAppDirectRoutePlan', () => {
  /** Keeps the selected dynamic page, its shells, and reached parameter registry only. */
  it('creates a bounded direct-page corridor with refined route parameters', async () => {
    const pagePath = '/workspace/app/(view)/preview/[base]/[name]/page.tsx';
    const rootLayoutPath = '/workspace/app/layout.tsx';
    const previewLayoutPath = '/workspace/app/(view)/preview/layout.tsx';
    const parameterRegistryPath = '/workspace/app/(view)/preview/[base]/[name]/bases.ts';
    const unrelatedPagePath = '/workspace/app/(view)/preview/unrelated/page.tsx';
    const unrelatedRegistryPath = '/workspace/generated/all-components.ts';
    const fixture = createFixture({
      [pagePath]: [
        "import { BASES } from './bases';",
        "const NAMES = ['preview', 'preview-02'] as const;",
        'export function generateStaticParams() {',
        '  return BASES.flatMap((base) => NAMES.map((name) => ({ base: base.name, name })));',
        '}',
        'export default function Page() { return <main />; }',
      ].join('\n'),
      [parameterRegistryPath]: "export const BASES = [{ name: 'radix' }] as const;",
      [previewLayoutPath]:
        'export default function PreviewLayout({ children }) { return <section>{children}</section>; }',
      [rootLayoutPath]:
        'export default function RootLayout({ children }) { return <body>{children}</body>; }',
      [unrelatedPagePath]: 'export default function Unrelated() { return <main />; }',
      [unrelatedRegistryPath]: "export const unrelated = 'UNRELATED_REGISTRY';",
    });

    const plan = await createPreviewInspectorNextAppDirectRoutePlan({
      documentPath: pagePath,
      ...fixture,
    });

    expect(plan?.root.sourcePath).toBe(pagePath);
    expect(plan?.pageCandidates).toHaveLength(1);
    expect(plan?.pageCandidates[0]).toMatchObject({
      id: `next-app-direct:${pagePath}`,
      routeLocation: {
        evidenceKind: 'next-app-filesystem',
        params: { base: 'radix', name: 'preview' },
        pathname: '/preview/radix/preview',
      },
    });
    expect(plan?.pageCandidates[0]?.nextAppLayoutChain?.map((item) => item.sourcePath)).toEqual([
      rootLayoutPath,
      previewLayoutPath,
    ]);
    expect(plan?.dependencyPaths).toEqual(
      expect.arrayContaining([pagePath, parameterRegistryPath, previewLayoutPath, rootLayoutPath]),
    );
    expect(plan?.dependencyPaths).not.toContain(unrelatedPagePath);
    expect(plan?.dependencyPaths).not.toContain(unrelatedRegistryPath);
  });

  /** Converts a selected layout to exactly one closest descendant page instead of every sibling. */
  it('selects one nearest page for a direct layout corridor', async () => {
    const rootLayoutPath = '/workspace/app/layout.tsx';
    const selectedLayoutPath = '/workspace/app/(docs)/layout.tsx';
    const nearestPagePath = '/workspace/app/(docs)/page.tsx';
    const nestedPagePath = '/workspace/app/(docs)/guides/page.tsx';
    const siblingPagePath = '/workspace/app/account/page.tsx';
    const fixture = createFixture({
      [rootLayoutPath]:
        'export default function RootLayout({ children }) { return <body>{children}</body>; }',
      [selectedLayoutPath]:
        'export default function DocsLayout({ children }) { return <section>{children}</section>; }',
      [nearestPagePath]: 'export default function DocsPage() { return <main>docs</main>; }',
      [nestedPagePath]: 'export default function GuidePage() { return <main>guide</main>; }',
      [siblingPagePath]: 'export default function AccountPage() { return <main>account</main>; }',
    });

    const plan = await createPreviewInspectorNextAppDirectRoutePlan({
      documentPath: selectedLayoutPath,
      ...fixture,
    });

    expect(plan?.target.sourcePath).toBe(selectedLayoutPath);
    expect(plan?.root.sourcePath).toBe(nearestPagePath);
    expect(plan?.pageCandidates).toHaveLength(1);
    expect(plan?.pageCandidates[0]?.nextAppLayoutChain?.map((item) => item.sourcePath)).toEqual([
      rootLayoutPath,
      selectedLayoutPath,
    ]);
    expect(plan?.dependencyPaths).toEqual(
      expect.arrayContaining([rootLayoutPath, selectedLayoutPath, nearestPagePath]),
    );
    expect(plan?.dependencyPaths).not.toContain(nestedPagePath);
    expect(plan?.dependencyPaths).not.toContain(siblingPagePath);
  });
});
