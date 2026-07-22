/** Verifies static App Router parameter refinement without executing server route code. */
import { describe, expect, it } from 'vitest';
import { collectRefinedPreviewInspectorNextAppLayoutChain } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppParameterEvidence';

describe('collectRefinedPreviewInspectorNextAppLayoutChain', () => {
  /** Combines local map values with a bounded collection reached through a project barrel. */
  it('refines mapped local and re-exported literal values as one coherent dynamic route', async () => {
    const pagePath = '/workspace/app/(view)/preview/[base]/[name]/page.tsx';
    const registryPath = '/workspace/app/(view)/preview/[base]/[name]/registry.ts';
    const basesPath = '/workspace/app/(view)/preview/[base]/[name]/bases.ts';
    const sources = new Map<string, string>([
      [
        pagePath,
        [
          `import { BASES } from './registry';`,
          `const STATIC_PREVIEW_ITEMS = ['preview', 'preview-02'] as const;`,
          'export function generateStaticParams() {',
          '  return BASES.flatMap((base) =>',
          '    STATIC_PREVIEW_ITEMS.map((name) => ({ base: base.name, name }))',
          '  );',
          '}',
          'export default async function Page() { return <main />; }',
        ].join('\n'),
      ],
      [registryPath, `import { BASES } from './bases'; export { BASES };`],
      [basesPath, `export const BASES = [{ name: 'radix' }, { name: 'base' }] as const;`],
    ]);

    const result = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      sourcePaths: [
        pagePath,
        registryPath,
        basesPath,
        '/workspace/app/layout.tsx',
        '/workspace/app/(view)/preview/layout.tsx',
      ],
    });

    expect(result?.shell.routeLocation).toMatchObject({
      params: { base: 'radix', name: 'preview' },
      pathname: '/preview/radix/preview',
      pattern: '/preview/[base]/[name]',
    });
    expect(result?.dependencyPaths).toEqual([basesPath, pagePath, registryPath]);
  });

  /** Keeps values from the same returned object instead of independently mixing route variants. */
  it('selects one authored literal object for all dynamic keys', async () => {
    const pagePath = '/workspace/app/[locale]/items/[slug]/page.tsx';
    const source = [
      'export const generateStaticParams = () => [',
      '  { locale: "ko", slug: "first" },',
      '  { locale: "en", slug: "second" },',
      '];',
      'export default function Page() { return <main />; }',
    ].join('\n');
    const result = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: () => Promise.resolve(source),
      sourcePaths: [pagePath, '/workspace/app/layout.tsx'],
    });

    expect(result?.shell.routeLocation).toMatchObject({
      params: { locale: 'ko', slug: 'first' },
      pathname: '/ko/items/first',
    });
  });

  /** Parent layouts and the leaf may each provide only the dynamic keys owned by their segment. */
  it('merges parent-layout parameters with a leaf catch-all array', async () => {
    const rootLayout = '/workspace/app/layout.tsx';
    const localeLayout = '/workspace/app/[locale]/layout.tsx';
    const pagePath = '/workspace/app/[locale]/docs/[...slug]/page.tsx';
    const sources = new Map<string, string>([
      [
        localeLayout,
        [
          `export function generateStaticParams() { return [{ locale: 'ko' }]; }`,
          'export default function LocaleLayout({ children }) { return children; }',
        ].join('\n'),
      ],
      [
        pagePath,
        [
          `export function generateStaticParams() { return [{ slug: ['guide', 'intro'] }]; }`,
          'export default function Page() { return <main />; }',
        ].join('\n'),
      ],
    ]);
    const result = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      sourcePaths: [rootLayout, localeLayout, pagePath],
    });

    expect(result?.shell.routeLocation).toMatchObject({
      params: { locale: 'ko', slug: ['guide', 'intro'] },
      pathname: '/ko/docs/guide/intro',
    });
    expect(result?.shell.layouts).toMatchObject([
      { params: {}, sourcePath: rootLayout },
      { params: { locale: 'ko' }, sourcePath: localeLayout },
    ]);
    expect(result?.dependencyPaths).toEqual([pagePath, localeLayout]);
  });

  /** Reads an aliased fixture array without evaluating its environment-dependent condition. */
  it('follows an imported conditional spread collection for a dynamic leaf', async () => {
    const pagePath = '/workspace/app/(view)/preview/typeset/[name]/page.tsx';
    const fixturePath = '/workspace/app/(app)/(typeset)/lib/fixtures/index.ts';
    const sources = new Map<string, string>([
      [
        pagePath,
        [
          `import { AVAILABLE_CONTENT_OPTIONS } from '@/fixtures';`,
          'export function generateStaticParams() {',
          '  return AVAILABLE_CONTENT_OPTIONS.map((option) => ({ name: option.value }));',
          '}',
          'export default function Page() { return <main />; }',
        ].join('\n'),
      ],
      [
        fixturePath,
        [
          `const CONTENT_OPTIONS = [{ value: 'docs' }, { value: 'chat' }] as const;`,
          `const DEV_CONTENT_OPTIONS = [] as const;`,
          'export const AVAILABLE_CONTENT_OPTIONS =',
          "  process.env.NODE_ENV === 'development'",
          '    ? [...CONTENT_OPTIONS, ...DEV_CONTENT_OPTIONS]',
          '    : CONTENT_OPTIONS;',
        ].join('\n'),
      ],
    ]);

    const result = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) => (specifier === '@/fixtures' ? fixturePath : undefined),
      sourcePaths: [pagePath, fixturePath, '/workspace/app/layout.tsx'],
    });

    expect(result?.shell.routeLocation).toMatchObject({
      params: { name: 'docs' },
      pathname: '/preview/typeset/docs',
    });
    expect(result?.dependencyPaths).toEqual([fixturePath, pagePath]);
  });
});
