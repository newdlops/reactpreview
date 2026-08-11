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

  /** Observes static members in authored order and admits stacked render cases with an opaque default. */
  it('selects static-member cases without evaluating them ahead of the authored switch', () => {
    const source = [
      'export function AgendaField({ agenda }) {',
      '  switch (agenda) {',
      '    case AGENDA.FINANCIAL_STATEMENTS: return <FinancialStatementsField />;',
      '    case AgendaCeoAddressChange.type: return <CeoAddressChangeField />;',
      "    case 'empty-a':",
      "    case 'empty-b': return null;",
      '    default:',
      '      console.warn(agenda);',
      '      return null;',
      '  }',
      '}',
    ].join('\n');

    const transformed = instrumentReactSwitchRendering('/workspace/AgendaField.tsx', source);

    expect(transformed.match(/\.resolveRenderChoice\(/gu)).toHaveLength(1);
    expect(transformed.match(/\.observeRenderChoiceCase\(/gu)).toHaveLength(2);
    expect(transformed).toContain('observeRenderChoiceCase');
    expect(transformed).toContain('(AGENDA.FINANCIAL_STATEMENTS)');
    expect(transformed).toContain('(AgendaCeoAddressChange.type)');
    expect(transformed).toContain('"calls":["CeoAddressChangeField"]');
    expect(transformed).toContain("case 'empty-a' \u2192 empty return");
    expect(transformed).toContain('default \u2192 authored branch');
    expect(transformed.match(/"observedValueKey":"[a-f0-9]{16}"/gu)).toHaveLength(2);
    expect(transformed.match(/"selectable":true/gu)).toHaveLength(4);
    expect(transformed.match(/"selectable":false/gu)).toHaveLength(1);
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
