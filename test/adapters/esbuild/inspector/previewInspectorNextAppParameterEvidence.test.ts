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

  /** Selects one deterministic tuple from nested imperative loops without running route code. */
  it('refines nested for-of pushes from imported and local literal collections', async () => {
    const pagePath = '/workspace/app/(view)/view/[style]/[name]/page.tsx';
    const stylesPath = '/workspace/app/(view)/view/[style]/[name]/styles.ts';
    const sources = new Map<string, string>([
      [
        pagePath,
        [
          `import { LEGACY_STYLES } from './styles';`,
          `const COMPONENT_NAMES = ['accordion', 'alert-dialog'] as const;`,
          'export function generateStaticParams() {',
          '  const params: Array<{ style: string; name: string }> = [];',
          '  for (const style of LEGACY_STYLES) {',
          '    for (const name of COMPONENT_NAMES) {',
          '      params.push({ style: style.name, name });',
          '    }',
          '  }',
          '  return params;',
          '}',
          'export default function Page() { return <main />; }',
        ].join('\n'),
      ],
      [
        stylesPath,
        `export const LEGACY_STYLES = [{ name: 'new-york-v4' }, { name: 'base-nova' }] as const;`,
      ],
    ]);

    const result = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) => (specifier === './styles' ? stylesPath : undefined),
      sourcePaths: [pagePath, stylesPath, '/workspace/app/layout.tsx'],
    });

    expect(result?.shell.routeLocation).toMatchObject({
      params: { style: 'new-york-v4', name: 'accordion' },
      pathname: '/view/new-york-v4/accordion',
      pattern: '/view/[style]/[name]',
    });
    expect(result?.dependencyPaths).toEqual([pagePath, stylesPath]);
  });

  /** Follows a generated registry through an awaited import and a filtered `for...in` push. */
  it('selects the first allowed registry value as one coherent imperative route tuple', async () => {
    const pagePath = '/workspace/app/view/[style]/[name]/page.tsx';
    const stylesPath = '/workspace/registry/styles.ts';
    const indexPath = '/workspace/registry/index.ts';
    const sources = new Map<string, string>([
      [
        pagePath,
        [
          `import { legacyStyles } from '@/registry/styles';`,
          'export async function generateStaticParams() {',
          `  const { Index } = await import('@/registry/index');`,
          '  const params: Array<{ style: string; name: string }> = [];',
          '  for (const style of legacyStyles) {',
          '    const styleIndex = Index[style.name];',
          '    for (const itemName in styleIndex) {',
          '      const item = styleIndex[itemName];',
          "      if (['registry:block', 'registry:component'].includes(item.type)) {",
          '        params.push({ style: style.name, name: item.name });',
          '      }',
          '    }',
          '  }',
          '  return params;',
          '}',
          'export default function Page() { return <main />; }',
        ].join('\n'),
      ],
      [stylesPath, `export const legacyStyles = [{ name: 'new-york-v4' }] as const;`],
      [
        indexPath,
        [
          'export const Index = {',
          "  'new-york-v4': {",
          "    accordion: { name: 'accordion', type: 'registry:ui' },",
          "    'dashboard-01': { name: 'dashboard-01', type: 'registry:block' },",
          '  },',
          '} as const;',
        ].join('\n'),
      ],
    ]);

    const result = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) =>
        specifier === '@/registry/styles'
          ? stylesPath
          : specifier === '@/registry/index'
            ? indexPath
            : undefined,
      sourcePaths: [pagePath, '/workspace/app/layout.tsx'],
      staticParameterSourceBoundary: '/workspace',
    });

    expect(result?.shell.routeLocation).toMatchObject({
      params: { style: 'new-york-v4', name: 'dashboard-01' },
      pathname: '/view/new-york-v4/dashboard-01',
    });
    expect(result?.dependencyPaths).toEqual([pagePath, indexPath, stylesPath].sort());
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
