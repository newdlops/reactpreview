/** Verifies non-component source modules are promoted only through a proven Next page context. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNextAppModulePagePlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppModulePagePlan';

/** Creates a small extension-aware resolver over one in-memory authored source map. */
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

describe('createPreviewInspectorNextAppModulePagePlan', () => {
  /** Prefers a static consuming route over a synthetic catch-all and composes every layout. */
  it('mounts a lower-camel MDX component map through its closest static page', async () => {
    const modulePath = '/workspace/apps/site/mdx-components.tsx';
    const fixture = createFixture({
      '/workspace/apps/site/app/(docs)/docs/[[...slug]]/page.tsx': [
        "import { mdxComponents } from '../../../../mdx-components';",
        'export default function DocsPage() { return <main>{mdxComponents.Note}</main>; }',
      ].join('\n'),
      '/workspace/apps/site/app/(docs)/docs/changelog/page.tsx': [
        "import { mdxComponents } from '../../../../mdx-components';",
        'export default function ChangelogPage() { return <main>{mdxComponents.Note}</main>; }',
      ].join('\n'),
      '/workspace/apps/site/app/(docs)/docs/layout.tsx':
        'export default function DocsLayout({ children }) { return <section>{children}</section>; }',
      '/workspace/apps/site/app/layout.tsx':
        'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }',
      [modulePath]: "export const mdxComponents = { Note: 'note' };",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.contextModule).toEqual({
      evidenceKind: 'import-chain',
      importPath: ['/workspace/apps/site/app/(docs)/docs/changelog/page.tsx', modulePath],
      sourcePath: modulePath,
    });
    expect(plan?.root.sourcePath).toBe('/workspace/apps/site/app/(docs)/docs/changelog/page.tsx');
    expect(plan?.pageCandidates[0]?.nextAppLayoutChain?.map((item) => item.sourcePath)).toEqual([
      '/workspace/apps/site/app/layout.tsx',
      '/workspace/apps/site/app/(docs)/docs/layout.tsx',
    ]);
  });

  /** Follows a used runtime barrel while rejecting erased and unused import declarations. */
  it('requires a runtime-used import path and preserves the exact shortest dependencies', async () => {
    const modulePath = '/workspace/app-shared/registry.ts';
    const fixture = createFixture({
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      '/workspace/app/live/page.tsx': [
        "import { liveRegistry } from '../../features/live';",
        'export default function Page() { return <main>{liveRegistry.label}</main>; }',
      ].join('\n'),
      '/workspace/app/type-only/page.tsx': [
        "import type { Registry } from '../../app-shared/registry';",
        'export default function Page() { return <main>type only</main>; }',
      ].join('\n'),
      '/workspace/app/unused/page.tsx': [
        "import { registry } from '../../app-shared/registry';",
        'const labels = { registry: "property-key" };',
        'export default function Page({ registry = "shadow" }) {',
        '  return <main registry={labels.registry}>{registry}</main>;',
        '}',
      ].join('\n'),
      '/workspace/app-shared/registry.ts':
        "export interface Registry { label: string }\nexport const registry = { label: 'live' };",
      '/workspace/features/live.ts':
        "export { registry as liveRegistry } from '../app-shared/registry';",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.contextModule?.importPath).toEqual([
      '/workspace/app/live/page.tsx',
      '/workspace/features/live.ts',
      modulePath,
    ]);
    expect(plan?.dependencyPaths).not.toContain('/workspace/app/unused/page.tsx');
    expect(plan?.dependencyPaths).not.toContain('/workspace/app/type-only/page.tsx');
  });

  /** Does not invent a page merely because an ordinary helper is colocated below `app`. */
  it('returns no context for an unreferenced route-local helper', async () => {
    const modulePath = '/workspace/app/dashboard/unused-helper.tsx';
    const fixture = createFixture({
      '/workspace/app/dashboard/page.tsx':
        'export default function Page() { return <main>dashboard</main>; }',
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      [modulePath]: 'export const helperValue = 1;',
    });

    await expect(
      createPreviewInspectorNextAppModulePagePlan({ documentPath: modulePath, ...fixture }),
    ).resolves.toBeUndefined();
  });

  /** Bounds common-path comparison when the selected helper shares its consuming page directory. */
  it('selects a colocated imported module without looping during page ranking', async () => {
    const modulePath = '/workspace/app/dashboard/page-helper.ts';
    const fixture = createFixture({
      '/workspace/app/dashboard/page.tsx': [
        "import { label } from './page-helper';",
        'export default function Page() { return <main>{label}</main>; }',
      ].join('\n'),
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      '/workspace/app/profile/page.tsx':
        'export default function Page() { return <main>profile</main>; }',
      [modulePath]: "export const label = 'dashboard';",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.contextModule).toEqual({
      evidenceKind: 'import-chain',
      importPath: ['/workspace/app/dashboard/page.tsx', modulePath],
      sourcePath: modulePath,
    });
  });

  /** Treats Next's implicit page-to-layout composition as a real module-consumption path. */
  it('finds a helper imported only by the authored page layout', async () => {
    const modulePath = '/workspace/theme-registry.ts';
    const fixture = createFixture({
      '/workspace/app/dashboard/page.tsx':
        'export default function Page() { return <main>dashboard</main>; }',
      '/workspace/app/layout.tsx': [
        "import { themeName } from '../theme-registry';",
        'export default function Layout({ children }) { return <body data-theme={themeName}>{children}</body>; }',
      ].join('\n'),
      [modulePath]: "export const themeName = 'ocean';",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.contextModule?.importPath).toEqual([
      '/workspace/app/dashboard/page.tsx',
      '/workspace/app/layout.tsx',
      modulePath,
    ]);
  });

  /** Rejects invalid parallel pages and continues to an ordinary authored route. */
  it('skips a parallel-slot consumer when a valid page also imports the module', async () => {
    const modulePath = '/workspace/shared/navigation.ts';
    const fixture = createFixture({
      '/workspace/app/@modal/page.tsx': [
        "import { navigation } from '../../shared/navigation';",
        'export default function Modal() { return <aside>{navigation}</aside>; }',
      ].join('\n'),
      '/workspace/app/dashboard/page.tsx': [
        "import { navigation } from '../../shared/navigation';",
        'export default function Dashboard() { return <main>{navigation}</main>; }',
      ].join('\n'),
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      [modulePath]: "export const navigation = 'nav';",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.root.sourcePath).toBe('/workspace/app/dashboard/page.tsx');
  });

  /** A nested ordinary folder named app must not hide the real outer App Router root. */
  it('keeps pages below an ordinary nested app route segment', async () => {
    const modulePath = '/workspace/app/download/app/download-data.ts';
    const fixture = createFixture({
      '/workspace/app/download/app/page.tsx': [
        "import { downloadData } from './download-data';",
        'export default function Download() { return <main>{downloadData}</main>; }',
      ].join('\n'),
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      [modulePath]: "export const downloadData = 'ready';",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.root.sourcePath).toBe('/workspace/app/download/app/page.tsx');
    expect(plan?.pageCandidates[0]?.routeLocation?.pathname).toBe('/download/app');
  });

  /** A longer static chain outranks a shorter deferred import that may never execute. */
  it('prefers statically evaluated imports over dead dynamic loaders', async () => {
    const modulePath = '/workspace/shared/runtime-map.ts';
    const fixture = createFixture({
      '/workspace/app/deferred/page.tsx': [
        "const loadUnused = () => import('../../shared/runtime-map');",
        'export default function Deferred() { return <main>deferred</main>; }',
      ].join('\n'),
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      '/workspace/app/live/page.tsx': [
        "import { runtimeMap } from '../../features/runtime';",
        'export default function Live() { return <main>{runtimeMap.label}</main>; }',
      ].join('\n'),
      '/workspace/features/runtime.ts': "export { runtimeMap } from '../shared/runtime-map';",
      [modulePath]: "export const runtimeMap = { label: 'live' };",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.root.sourcePath).toBe('/workspace/app/live/page.tsx');
    expect(plan?.contextModule?.importPath).toEqual([
      '/workspace/app/live/page.tsx',
      '/workspace/features/runtime.ts',
      modulePath,
    ]);
  });

  /** Target affinity keeps one requested branch when a generated loader registry exceeds the cap. */
  it('finds the selected module beyond the first 512 deferred registry entries', async () => {
    const modulePath = '/workspace/registry/selected-preview.tsx';
    const generatedSources = Object.fromEntries(
      Array.from({ length: 520 }, (_, index) => [
        `/workspace/registry/generated-${index.toString()}.tsx`,
        `export default ${index.toString()};`,
      ]),
    );
    const loaders = [
      ...Object.keys(generatedSources).map(
        (sourcePath, index) =>
          `const loader${index.toString()} = () => import('../../registry/${path.basename(sourcePath, '.tsx')}');`,
      ),
      "const selectedLoader = () => import('../../registry/selected-preview');",
    ];
    const fixture = createFixture({
      '/workspace/app/generated/page.tsx': [
        ...loaders,
        'export default function Page() { return <main>generated</main>; }',
      ].join('\n'),
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      ...generatedSources,
      [modulePath]: "export const selected = 'selected';",
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.contextModule?.importPath).toEqual([
      '/workspace/app/generated/page.tsx',
      modulePath,
    ]);
  });

  /** Renders a conventional loading state inside its owned route layouts, not an ancestor page. */
  it('composes a Next route-state component with a descendant page shell', async () => {
    const modulePath = '/workspace/app/dashboard/loading.tsx';
    const fixture = createFixture({
      '/workspace/app/dashboard/page.tsx':
        'export default function Dashboard() { return <main>dashboard</main>; }',
      '/workspace/app/layout.tsx':
        'export default function Layout({ children }) { return <body>{children}</body>; }',
      '/workspace/app/page.tsx': 'export default function Home() { return <main>home</main>; }',
      [modulePath]: 'export default function Loading() { return <p>loading</p>; }',
    });

    const plan = await createPreviewInspectorNextAppModulePagePlan({
      documentPath: modulePath,
      ...fixture,
    });

    expect(plan?.contextModule).toBeUndefined();
    expect(plan?.root).toEqual({ exportName: 'default', sourcePath: modulePath });
    expect(plan?.pageCandidates[0]?.routeLocation?.pathname).toBe('/dashboard');
    expect(plan?.dependencyPaths).toContain('/workspace/app/dashboard/page.tsx');
  });
});
