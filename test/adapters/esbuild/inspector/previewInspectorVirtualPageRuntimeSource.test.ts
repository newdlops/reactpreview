/** Executes generated composition to verify metadata safety, real React output, and shell placement. */
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorVirtualPageRuntimeSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource';

interface FixtureProps {
  /** Ordinary input that must reach the authored component unchanged. */
  readonly marker?: string;
  /** Children consumed only by an authored wrapper. */
  readonly children?: React.ReactNode;
}

interface FixtureRecipe {
  /** Authored content identity used for readable anonymous/default export names. */
  readonly contentRoot: { readonly exportName: string; readonly sourcePath: string };
  /** Exact outer-to-inner shell relationships used by the production composer. */
  readonly shells: readonly {
    readonly relation: string;
    readonly placement?: string;
    readonly root: { readonly sourcePath: string };
  }[];
}

type ComposedPage = React.ComponentType<FixtureProps> & {
  readonly basePath?: unknown;
  readonly allPages?: unknown;
  readonly pageNames?: unknown;
  readonly virtualPageRecipe?: unknown;
};

/** Narrow controlled VM exports; no authored project module is loaded by the tests. */
interface CompositionRuntime {
  /** Creates the actual generated wrapper from explicit controlled component exports. */
  readonly compose: (
    modules: readonly Readonly<Record<string, unknown>>[],
    exportName: string,
    shells: readonly string[],
    recipe: FixtureRecipe,
  ) => ComposedPage;
  /** Exercises individual descriptor failures without changing the production helper's visibility. */
  readonly copyStatics: (target: object, source: object) => void;
}

/** Supplies one inert recipe whose identity should survive composition and become frozen. */
function recipe(exportName = 'Page', sourcePath = '/workspace/feature-page.tsx'): FixtureRecipe {
  return { contentRoot: { exportName, sourcePath }, shells: [] };
}

/** Evaluates only emitted browser statements against real React and controlled timer capabilities. */
function createRuntime(): CompositionRuntime & {
  readonly source: string;
  readonly timers: ReturnType<typeof vi.fn>;
} {
  const timers = vi.fn();
  const context = {
    React,
    console,
    setTimeout: timers,
    clearTimeout: vi.fn(),
    runtime: undefined as CompositionRuntime | undefined,
  };
  const source = createPreviewInspectorVirtualPageRuntimeSource().join('\n');
  runInNewContext(
    source +
      '\nglobalThis.runtime = { compose: __reactPreviewComposeVirtualPage, copyStatics: __reactPreviewCopyVirtualPageRouteStatics };',
    context,
  );
  if (context.runtime === undefined) throw new Error('The generated runtime exports are missing.');
  return { ...context.runtime, source, timers };
}

/** Returns real React output so wrapper tests cannot pass by selecting metadata alone. */
function Page({ marker = 'SELECTED_PAGE_MARKER' }: FixtureProps): React.ReactNode {
  return React.createElement('p', { 'data-page': true }, marker);
}

describe('VirtualPage composition runtime', () => {
  it('preserves own data descriptors, array identities, display name, and the recipe', () => {
    const runtime = createRuntime();
    const Content = (props: FixtureProps): React.ReactNode => React.createElement(Page, props);
    const allPages = [Page];
    const pageNames = ['Page'];
    Object.defineProperties(Content, {
      basePath: { configurable: false, enumerable: false, writable: false, value: '/feature' },
      allPages: { configurable: true, enumerable: true, writable: false, value: allPages },
      pageNames: { configurable: true, enumerable: false, writable: true, value: pageNames },
    });
    const contract = recipe();
    const Wrapped = runtime.compose([{ Page: Content }], 'Page', [], contract);

    expect(renderToStaticMarkup(React.createElement(Wrapped, { marker: 'FORWARDED_MARKER' }))).toBe(
      '<p data-page="true">FORWARDED_MARKER</p>',
    );
    for (const key of ['basePath', 'allPages', 'pageNames']) {
      expect(Object.getOwnPropertyDescriptor(Wrapped, key)).toEqual(
        Object.getOwnPropertyDescriptor(Content, key),
      );
    }
    expect(Wrapped.allPages).toBe(allPages);
    expect(Wrapped.pageNames).toBe(pageNames);
    expect(Wrapped.displayName).toBe('PagePreview(Page)');
    expect(Wrapped.virtualPageRecipe).toBe(contract);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(Wrapped, 'virtualPageRecipe')?.enumerable).toBe(false);
    expect(runtime.timers).not.toHaveBeenCalled();
    expect(runtime.source).toContain(
      'function __reactPreviewComposeVirtualPage(modules, exportName, shellExportNames, recipe)',
    );
    expect(runtime.source).toContain('function __reactPreviewReadPageName(recipe, exportName)');
    expect(runtime.source).toContain(
      'displayName: { value: `PagePreview(${__reactPreviewReadPageName(recipe, exportName)})` }',
    );
    expect(runtime.source).not.toContain('displayName: { value: `VirtualPage(');
  });

  it('skips accessor descriptors without executing their getters', () => {
    const runtime = createRuntime();
    const getter = vi.fn(() => {
      throw new Error('Route getter must stay inert');
    });
    const Content = (props: FixtureProps): React.ReactNode => React.createElement(Page, props);
    for (const key of ['basePath', 'allPages', 'pageNames'])
      Object.defineProperty(Content, key, { get: getter });

    const Wrapped = runtime.compose([{ Page: Content }], 'Page', [], recipe());

    expect(renderToStaticMarkup(React.createElement(Wrapped))).toContain('SELECTED_PAGE_MARKER');
    expect(getter).not.toHaveBeenCalled();
    for (const key of ['basePath', 'allPages', 'pageNames'])
      expect(Object.hasOwn(Wrapped, key)).toBe(false);
  });

  it('does not follow inherited metadata or enumerate unlisted and symbol properties', () => {
    const runtime = createRuntime();
    const getter = vi.fn(() => {
      throw new Error('Inherited or unlisted getter was read');
    });
    const Content = (props: FixtureProps): React.ReactNode => React.createElement(Page, props);
    const inherited = {};
    for (const key of ['basePath', 'allPages', 'pageNames'])
      Object.defineProperty(inherited, key, { get: getter });
    Object.setPrototypeOf(Content, inherited);
    Object.defineProperty(Content, 'unlistedStatic', { get: getter });
    const symbol = Symbol('private route metadata');
    Object.defineProperty(Content, symbol, { get: getter });

    const Wrapped = runtime.compose([{ Page: Content }], 'Page', [], recipe());

    expect(renderToStaticMarkup(React.createElement(Wrapped))).toContain('SELECTED_PAGE_MARKER');
    expect(getter).not.toHaveBeenCalled();
    for (const key of ['basePath', 'allPages', 'pageNames', 'unlistedStatic', symbol])
      expect(Object.hasOwn(Wrapped, key)).toBe(false);
  });

  it('continues with later fields when one source descriptor cannot be inspected', () => {
    const runtime = createRuntime();
    const allPages = [Page];
    const pageNames = ['Page'];
    const Content = Object.assign(
      (props: FixtureProps): React.ReactNode => React.createElement(Page, props),
      { allPages, pageNames },
    );
    const guarded = new Proxy(Content, {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'basePath') throw new Error('Unavailable source descriptor');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    const Wrapped = runtime.compose([{ Page: guarded }], 'Page', [], recipe());

    expect(Object.hasOwn(Wrapped, 'basePath')).toBe(false);
    expect(Wrapped.allPages).toBe(allPages);
    expect(Wrapped.pageNames).toBe(pageNames);
    expect(Wrapped.displayName).toBe('PagePreview(Page)');
  });

  it('preserves an existing target descriptor while copying other safe fields', () => {
    const runtime = createRuntime();
    const allPages = [Page];
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'basePath', { configurable: false, value: '/existing' });

    runtime.copyStatics(target, { basePath: '/new', allPages, pageNames: ['Page'] });

    expect(target.basePath).toBe('/existing');
    expect(target.allPages).toBe(allPages);
    expect(target.pageNames).toEqual(['Page']);
  });

  it('renders authored wrappers in order without installing browser recovery timers during SSR', () => {
    const runtime = createRuntime();
    const Shell = ({ children }: FixtureProps): React.ReactNode =>
      React.createElement('section', { 'data-shell': true }, children);
    const Wrapped = runtime.compose([{ Page }, { Shell }], 'Page', ['Shell'], {
      ...recipe(),
      shells: [{ relation: 'wrapper', root: { sourcePath: '/workspace/Shell.tsx' } }],
    });

    expect(renderToStaticMarkup(React.createElement(Wrapped))).toBe(
      '<section data-shell="true"><p data-page="true">SELECTED_PAGE_MARKER</p></section>',
    );
    expect(runtime.timers).not.toHaveBeenCalled();
    expect(runtime.source).toContain(
      'class __reactPreviewVirtualPageShellBoundary extends React.Component',
    );
    expect(runtime.source).toContain(
      'return React.createElement(Shell, { children: this.props.children });',
    );
    expect(runtime.source).toContain('if (shellRecipe?.relation === "sibling")');
    expect(runtime.source).toContain('} else if (shellRecipe?.relation === "owner") {');
    expect(runtime.source).toContain('shellRecipe?.placement === "after"');
    expect(runtime.source).toContain('this.bypassTimer = globalThis.setTimeout(() => {');
    expect(runtime.source).toContain('}, 1800);');
  });

  it.each(['before', 'after'])('keeps a standalone sibling %s the selected page', (placement) => {
    const runtime = createRuntime();
    const Shell = (): React.ReactNode => React.createElement('nav', null, 'SIBLING_SHELL_MARKER');
    const Wrapped = runtime.compose([{ Page }, { Shell }], 'Page', ['Shell'], {
      ...recipe(),
      shells: [{ relation: 'sibling', placement, root: { sourcePath: '/workspace/Shell.tsx' } }],
    });
    const html = renderToStaticMarkup(React.createElement(Wrapped));

    expect(html).toBe(
      placement === 'after'
        ? '<p data-page="true">SELECTED_PAGE_MARKER</p><nav>SIBLING_SHELL_MARKER</nav>'
        : '<nav>SIBLING_SHELL_MARKER</nav><p data-page="true">SELECTED_PAGE_MARKER</p>',
    );
    expect(runtime.timers).not.toHaveBeenCalled();
  });

  it.each([
    ['/workspace/pages/billing-summary.tsx', 'BillingSummary'],
    ['/workspace/pages/account-settings/index.tsx', 'AccountSettings'],
    ['C:\\workspace\\pages\\billing-summary.tsx', 'BillingSummary'],
  ])('gives the default export at %s a readable authored name', (sourcePath, name) => {
    const Wrapped = createRuntime().compose(
      [{ default: Page }],
      'default',
      [],
      recipe('default', sourcePath),
    );

    expect(Wrapped.displayName).toBe(`PagePreview(${name})`);
    expect(renderToStaticMarkup(React.createElement(Wrapped))).toContain('SELECTED_PAGE_MARKER');
  });

  it.each([null, undefined, 42])(
    'rejects unavailable content %s instead of manufacturing a page',
    (content) => {
      const runtime = createRuntime();

      expect(() => runtime.compose([{ Page: content }], 'Page', [], recipe())).toThrow(
        'VirtualPage content export is unavailable: Page',
      );
    },
  );
});
