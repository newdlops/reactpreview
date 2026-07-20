/** Verifies syntax-only multi-way React render instrumentation and its conservative safety bounds. */
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';
import { instrumentReactSwitchRendering } from '../../../../src/adapters/esbuild/staticResources/reactSwitchRendering';

describe('React switch rendering instrumentation', () => {
  /** Registers literal cases/default and evaluates the authored discriminant exactly once. */
  it('instruments a component switch with selectable literal render branches', () => {
    const source = [
      'export function Dashboard() {',
      '  switch (readMode()) {',
      "    case 'summary': return <SummaryPanel />;",
      '    case 2: return <DetailPanel><Metric /></DetailPanel>;',
      '    default: return null;',
      '  }',
      '}',
    ].join('\n');

    const transformed = instrumentReactSwitchRendering('/workspace/Dashboard.tsx', source);

    expect(transformed.match(/\.resolveRenderChoice\(/gu)).toHaveLength(1);
    expect(transformed.match(/\(readMode\(\)\)/gu)).toHaveLength(1);
    expect(transformed).toContain('"kind":"switch"');
    expect(transformed).toContain('"ownerName":"Dashboard"');
    expect(transformed).toContain("case 'summary' → <SummaryPanel>");
    expect(transformed).toContain('"calls":["DetailPanel","Metric"]');
    expect(transformed).toContain('"default":true');
    expect(transformed.match(/"selectable":true/gu)).toHaveLength(3);
  });

  /** Keeps dynamic cases visible but prevents unsafe forcing across their evaluation order. */
  it('marks dynamic and shadowed later cases as read-only flow evidence', () => {
    const source = [
      'export const RoutedPage = memo(function RoutedPageInner({ route }) {',
      '  switch (route) {',
      "    case 'safe': return <SafePage />;",
      '    case resolvePrivateRoute(): return <PrivatePage />;',
      "    case 'later': return <LaterPage />;",
      '    default: return <MissingPage />;',
      '  }',
      '});',
    ].join('\n');

    const transformed = instrumentReactSwitchRendering('/workspace/RoutedPage.tsx', source);

    expect(transformed).toContain('"ownerName":"RoutedPageInner"');
    expect(transformed).toContain('case resolvePrivateRoute() → <PrivatePage>');
    expect(transformed.match(/"selectable":true/gu)).toHaveLength(1);
    expect(transformed.match(/"selectable":false/gu)).toHaveLength(3);
  });

  /** Accepts exact imported portals and null while composing with existing boolean JSX controls. */
  it('composes portal switch choices with boolean conditional instrumentation', () => {
    const source = [
      "import { createPortal as portal } from 'react-dom';",
      'export function OverlayPage({ mode, visible }) {',
      '  if (visible) {',
      '    switch (mode) {',
      "      case 'dialog': return portal(<ConfirmDialog open={visible} />, document.body);",
      '      default: return null;',
      '    }',
      '  }',
      '  return <Empty />;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/OverlayPage.tsx', source);

    expect(transformed.match(/\.resolveRenderChoice\(/gu)).toHaveLength(1);
    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain("case 'dialog' → <Portal: ConfirmDialog>");
    expect(transformed).toContain('default → empty return');
  });

  /** Fails closed for helper functions, fall-through, side effects, and non-render returns. */
  it('preserves switches that cannot be represented as bounded component render choices', () => {
    const helper = [
      'export function readStatus(value) {',
      '  switch (value) {',
      "    case 'ok': return <Okay />;",
      '    default: return null;',
      '  }',
      '}',
    ].join('\n');
    const sideEffect = [
      'export function Page({ mode }) {',
      '  switch (mode) {',
      "    case 'ok': track(mode); return <Okay />;",
      '    default: return null;',
      '  }',
      '}',
    ].join('\n');
    const nonRender = [
      'export function Page({ mode }) {',
      '  switch (mode) {',
      "    case 'ok': return computeResult();",
      '    default: return null;',
      '  }',
      '}',
    ].join('\n');

    expect(instrumentReactSwitchRendering('/workspace/helper.tsx', helper)).toBe(helper);
    expect(instrumentReactSwitchRendering('/workspace/Page.tsx', sideEffect)).toBe(sideEffect);
    expect(instrumentReactSwitchRendering('/workspace/Page.tsx', nonRender)).toBe(nonRender);
  });
});
