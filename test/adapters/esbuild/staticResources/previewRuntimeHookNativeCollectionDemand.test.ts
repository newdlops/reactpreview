/** Verifies native collection contracts survive transitive child-prop demand in authored shells. */
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import { createRuntimeFallbackFixture } from '../pageInspector/support/previewInspectorRuntimeFallbackFixture';

describe('native collection contracts in child-prop demand', () => {
  /** The local spread receiver proves RegExp behavior even when an imported child adds fields. */
  it('retains native route items when transitive child fields share the same collection', () => {
    const parentPath = '/workspace/Navigation.tsx';
    const childPath = '/workspace/NavigationCategories.tsx';
    const typesPath = '/workspace/navigation-types.ts';
    const parentSource = [
      `import { useNavigationData } from './use-navigation-data';`,
      `import { NavigationCategories } from './NavigationCategories';`,
      'export function Navigation() {',
      '  const categories = useNavigationData();',
      '  const selected = categories.find((category) => {',
      '    const routes: (RegExp | string)[] = [];',
      '    category.pageGroups.forEach((group) => {',
      '      group.pages.forEach((page) => {',
      '        if (page.activeRoutes) routes.push(...page.activeRoutes);',
      '      });',
      '    });',
      `    return routes.some((route) => typeof route === 'string' ? route === '/company/1' : route.test('/company/1'));`,
      '  });',
      '  return <NavigationCategories categories={categories.filter(Boolean)} selected={selected?.name} />;',
      '}',
    ].join('\n');
    const sources = new Map([
      [
        childPath,
        [
          `import type { Category } from './navigation-types';`,
          'type Props = { categories: readonly Category[]; selected?: string };',
          'export const NavigationCategories = ({ categories }: Props) => (',
          '  <nav>{categories.map((category) => <span key={category.name}>{category.name}</span>)}</nav>',
          ');',
        ].join('\n'),
      ],
      [
        typesPath,
        [
          'export type Page = { label: string; pageNameOrUrl: string; activeRoutes?: readonly (RegExp | string)[] };',
          'export type Group = { label?: string; pages: readonly Page[] };',
          'export type Category = { name: string; icon: string; pageGroups: readonly Group[] };',
        ].join('\n'),
      ],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (specifier, consumerPath) => {
        if (consumerPath === parentPath && specifier === './NavigationCategories') return childPath;
        if (consumerPath === childPath && specifier === './navigation-types') return typesPath;
        return undefined;
      },
      workspaceRoot: '/workspace',
    });
    let transformed = parentSource;
    for (const replacement of [
      ...createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    ].sort((left, right) => right.start - left.start)) {
      transformed =
        transformed.slice(0, replacement.start) +
        replacement.replacement +
        transformed.slice(replacement.end);
    }

    expect(transformed).toContain('new RegExp(".*")');
    expect(transformed).toContain('[].pageGroups[].pages[].pageNameOrUrl');

    const fixture = createRuntimeFallbackFixture(true);
    const module = {
      exports: {} as { Navigation?: () => { categories: unknown[]; selected: string } },
    };
    const code = transformSync(transformed.replace(/^import .*$/gm, ''), {
      loader: 'tsx',
      format: 'cjs',
      jsxFactory: 'createElement',
    }).code;
    runInNewContext(code, {
      module,
      exports: module.exports,
      createElement: (_component: unknown, props: unknown) => props,
      NavigationCategories: () => null,
      useNavigationData: () => undefined,
      [Symbol.for('newdlops.react-file-preview.page-inspector')]: {
        resolveRuntimeHook: fixture.api.resolve.bind(fixture.api),
      },
    });
    const render = module.exports.Navigation;
    if (render === undefined) throw new Error('Navigation fixture did not export its component.');
    const first = render();
    expect(first.selected).toBeTypeOf('string');
    expect(first.categories).toHaveLength(3);
    const fallbackId = fixture.api.read()[0]?.id;
    if (fallbackId === undefined)
      throw new Error('Generated navigation fallback was not registered.');
    fixture.api.smart(fallbackId);
    const second = render();
    expect(second.selected).toBe(first.selected);
    expect(second.categories).toHaveLength(3);
  });
});
