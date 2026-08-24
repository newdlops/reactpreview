/**
 * Verifies the structural child surface emitted beneath an authentic shallow page-shell root.
 *
 * The virtual child must keep host styling and accessibility props supplied by styled wrappers
 * while remaining visibly bounded when the authored child has neither styles nor content.
 */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRuntimeHookProjectionInventory,
  collectPreviewInspectorShallowProjectionInventory,
  createPreviewInspectorShallowProjectionSource,
  type PreviewInspectorShallowProjection,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowProjection';

/** Shared projection keeps assertions focused on generated host-prop behavior. */
const PROJECTION: PreviewInspectorShallowProjection = Object.freeze({
  exportNames: Object.freeze(['default']),
  moduleSpecifier: './DelegatedHost',
  runtimeHookExportNames: Object.freeze([]),
});

describe('createPreviewInspectorShallowProjectionSource', () => {
  it('forwards authored host style, accessibility data, and events without display: contents', () => {
    const source = createPreviewInspectorShallowProjectionSource(PROJECTION);

    expect(source).toContain("key === 'className'");
    expect(source).toContain("key.startsWith('data-')");
    expect(source).toContain("key.startsWith('aria-')");
    expect(source).toContain('const hostStyle = { ...fallbackStyle, ...authoredStyle };');
    expect(source).toContain("hostProps['data-react-preview-shallow-component'] = label;");
    expect(source).toContain(
      "const semanticContentKeys = ['content', 'label', 'text', 'message', 'description'];",
    );
    expect(source).toContain('const semanticContent = children != null');
    expect(source).toContain('React.isValidElement(value)');
    expect(source).toContain('props.componentType ?? props.as');
    expect(source).toContain('React.createElement(hostType, hostProps, content)');
    expect(source).toContain('styledComponentId: { value: selectorId }');
    expect(source).toContain('hostProps.className, selectorId');
    expect(source).toContain('const navigationLike =');
    expect(source).toContain("flex: '0 0 min(14rem, 24vw)'");
    expect(source).toContain("hostProps['aria-label'] = semanticLabel");
    expect(source).not.toContain("display: 'contents'");
  });

  /** Keeps custom hooks non-visual and lets the instrumented caller synthesize required values. */
  it('emits an undefined hook surface instead of a React element placeholder', () => {
    const source = createPreviewInspectorShallowProjectionSource({
      exportNames: ['useCompany'],
      moduleSpecifier: './use-company',
      runtimeHookExportNames: ['useCompany'],
    });

    expect(source).toContain('const ShallowRuntimeHook = (..._arguments) => undefined;');
    expect(source).toContain('createShallowRuntimeHook("./use-company:useCompany")');
    expect(source).not.toContain("import * as React from 'react'");
    expect(source).not.toContain('React.createElement');
  });
});

describe('collectPreviewInspectorRuntimeHookProjectionInventory', () => {
  /** Cuts hook-only project imports while preserving mixed modules and unshaped calls. */
  it('requires every imported binding and callsite to have fallback evidence', () => {
    const inventory = collectPreviewInspectorRuntimeHookProjectionInventory(
      '/workspace/src/SelectedRoute.tsx',
      [
        "import { useCompany, useSettings } from './runtime-hooks';",
        "import { useValue, runtimeLabel } from './mixed-runtime';",
        "import { useOpaque } from './opaque-hook';",
        'export function SelectedRoute() {',
        '  const company = useCompany();',
        '  const { settings } = useSettings();',
        '  const value = useValue();',
        '  const opaque = useOpaque();',
        '  return <main title={runtimeLabel}>{company.name}{settings.title}{String(value)}</main>;',
        '}',
      ].join('\n'),
    );

    expect(inventory.projectionsBySpecifier.get('./runtime-hooks')).toMatchObject({
      exportNames: ['useCompany', 'useSettings'],
      runtimeHookExportNames: ['useCompany', 'useSettings'],
    });
    expect(inventory.projectionsBySpecifier.has('./mixed-runtime')).toBe(false);
    expect(inventory.projectionsBySpecifier.has('./opaque-hook')).toBe(false);
  });
});

describe('collectPreviewInspectorShallowProjectionInventory', () => {
  /** Carries hook identity and aliases through a retained barrel to the concrete child module. */
  it('projects a demanded runtime-hook re-export as the next recursive edge', () => {
    const inventory = collectPreviewInspectorShallowProjectionInventory(
      '/workspace/src/hooks.ts',
      `export { useVisibleRows as useRows } from './use-visible-rows';`,
      new Set(['useRows']),
      new Set(['useRows']),
    );

    expect(inventory.projectionsBySpecifier.get('./use-visible-rows')).toMatchObject({
      exportNames: ['useVisibleRows'],
      runtimeHookExportNames: ['useVisibleRows'],
    });
  });

  /**
   * Keeps styled callback dependencies authentic while bounding only visual descendants.
   *
   * This mirrors application shells where a styled wrapper calls hooks and reads theme/config
   * constants before returning Header, Sidebar, and body components.
   */
  it('projects fallback-proven hooks and visual children but preserves runtime infrastructure', () => {
    const inventory = collectPreviewInspectorShallowProjectionInventory(
      '/workspace/src/PageShell.tsx',
      [
        "import styled from 'styled-components';",
        "import { useCompany } from './use-company';",
        "import { SCREEN_MODE } from './screen-mode';",
        "import { CompanyProvider } from './company-context';",
        "import { GlobalErrorBoundary } from './error-boundary';",
        "import { Header } from './Header';",
        "import { Sidebar } from './Sidebar';",
        'export const PageShell = styled(({ children }) => {',
        '  const company = useCompany();',
        '  return (',
        '    <GlobalErrorBoundary>',
        '      <CompanyProvider value={company}>',
        '        <main className={SCREEN_MODE}>',
        '          <Header />',
        '          <Sidebar />',
        '          {children}',
        '        </main>',
        '      </CompanyProvider>',
        '    </GlobalErrorBoundary>',
        '  );',
        '})``;',
      ].join('\n'),
      new Set(['PageShell']),
    );

    expect([...inventory.projectionsBySpecifier.keys()].sort()).toEqual([
      './Header',
      './Sidebar',
      './use-company',
    ]);
    expect(inventory.projectionsBySpecifier.get('./use-company')).toMatchObject({
      runtimeHookExportNames: ['useCompany'],
    });
    expect(inventory.projectionsBySpecifier.has('./screen-mode')).toBe(false);
    expect(inventory.projectionsBySpecifier.has('./company-context')).toBe(false);
    expect(inventory.projectionsBySpecifier.has('./error-boundary')).toBe(false);
  });

  /** Bounds both the visible child and a statically recoverable hook inside a memo callback. */
  it('projects a direct PascalCase HOC argument and its fallback-proven project hook', () => {
    const inventory = collectPreviewInspectorShallowProjectionInventory(
      '/workspace/src/MemoShell.tsx',
      [
        "import { memo } from 'react';",
        "import { VisualChild } from './VisualChild';",
        "import { useRuntimeValue } from './runtime-value';",
        'export const MemoShell = memo(() => {',
        '  const visible = useRuntimeValue();',
        '  return visible ? <VisualChild /> : null;',
        '});',
      ].join('\n'),
      new Set(['MemoShell']),
    );

    expect(inventory.projectionsBySpecifier.has('./VisualChild')).toBe(true);
    expect(inventory.projectionsBySpecifier.get('./runtime-value')).toMatchObject({
      runtimeHookExportNames: ['useRuntimeValue'],
    });
  });

  /** Keeps a styled component selector from invalidating the same binding's visual projection. */
  it('projects a rendered child that is also interpolated by the shell stylesheet', () => {
    const inventory = collectPreviewInspectorShallowProjectionInventory(
      '/workspace/src/StyledShell.tsx',
      [
        "import styled from 'styled-components';",
        "import { Navigation } from './Navigation';",
        'export const StyledShell = styled(() => <Navigation />)`',
        '  ${Navigation} { min-width: 12rem; }',
        '`;',
      ].join('\n'),
      new Set(['StyledShell']),
    );

    expect(inventory.projectionsBySpecifier.get('./Navigation')).toMatchObject({
      exportNames: ['Navigation'],
      runtimeHookExportNames: [],
    });
  });

  /** Fails open when local syntax cannot describe the value returned by a project hook. */
  it('keeps an unshaped project hook authentic', () => {
    const inventory = collectPreviewInspectorShallowProjectionInventory(
      '/workspace/src/OpaqueShell.tsx',
      [
        "import { useOpaque } from './use-opaque';",
        'export function OpaqueShell() {',
        '  const opaque = useOpaque();',
        '  return <main data-shell="opaque" />;',
        '}',
      ].join('\n'),
      new Set(['OpaqueShell']),
    );

    expect(inventory.projectionsBySpecifier.has('./use-opaque')).toBe(false);
  });
});
