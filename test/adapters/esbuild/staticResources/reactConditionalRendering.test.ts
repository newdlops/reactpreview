/** Verifies syntax-only JSX condition instrumentation without executing application expressions. */
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

describe('React conditional rendering instrumentation', () => {
  /** Exposes logical-and visibility and both authored ternary branches through stable runtime calls. */
  it('instruments direct JSX conditions and records readable branch metadata', () => {
    const sourcePath = '/workspace/src/Page.tsx';
    const source = [
      'export function Page({ ready, visible }) {',
      '  return (',
      '    <main>',
      '      {visible && <Panel />}',
      '      {ready ? <Content /> : <LoadingFallback />}',
      '    </main>',
      '  );',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(sourcePath, source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(2);
    expect(transformed).toContain(', (visible), {"column":8,"expression":"visible"');
    expect(transformed).toContain('"kind":"logical-and"');
    expect(transformed).toContain('"truthyLabel":"<Panel>"');
    expect(transformed).toContain(', (ready), {"column":8,"expression":"ready"');
    expect(transformed).toContain('"fallbackBranch":"falsy"');
    expect(transformed).toContain('"falsyLabel":"<LoadingFallback>"');
    expect(transformed).toContain('"kind":"ternary"');
    expect(transformed).toContain('"truthyLabel":"<Content>"');
  });

  /** Leaves ordinary boolean computation, comments, strings, and non-JSX ternaries untouched. */
  it('does not instrument conditions that do not directly select JSX', () => {
    const source = [
      "const example = 'ready && <Panel />';",
      'const enabled = ready && permission;',
      'const label = ready ? "ready" : "waiting";',
      'export { enabled, example, label };',
    ].join('\n');

    expect(instrumentReactConditionalRendering('/workspace/src/state.ts', source)).toBe(source);
  });

  /** Exposes controlled overlay props and exact ReactDOM portal branches as visibility controls. */
  it('instruments dormant modal props and createPortal render branches', () => {
    const source = [
      "import { createPortal as mountPortal } from 'react-dom';",
      'export function Page({ hidden, open }) {',
      '  return <main>',
      '    <DeleteModal open={open}><p>Delete?</p></DeleteModal>',
      '    <SideDrawer hidden={hidden} />',
      '    {open && mountPortal(<ConfirmDialog />, document.body)}',
      '  </main>;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(3);
    expect(transformed).toContain('"kind":"overlay-visibility"');
    expect(transformed).toContain('"role":"overlay"');
    expect(transformed).toContain('"expression":"<DeleteModal>.open: open"');
    expect(transformed).toContain('"truthyLabel":"visible <DeleteModal> overlay"');
    expect(transformed).toContain('hidden={!(');
    expect(transformed).toContain('"truthyLabel":"<ConfirmDialog> portal overlay"');
  });

  /** Avoids assigning overlay behavior from a generic prop name on an ordinary component. */
  it('does not instrument visibility-like props on non-overlay components', () => {
    const source = 'export const Page = ({ open }) => <Panel open={open} />;';

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });

  /** Makes an overlay component's early null return visible without changing its authored default. */
  it('instruments a modal-local hidden guard as visible-state control', () => {
    const source = [
      "import { createPortal } from 'react-dom';",
      'export function DeleteModal({ open }) {',
      '  if (!open) return null;',
      '  return createPortal(<div role="dialog" />, document.body);',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(
      '/workspace/src/DeleteModal.tsx',
      source,
    );

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain('"expression":"<DeleteModal> visibility: !open"');
    expect(transformed).toContain('"kind":"overlay-visibility"');
    expect(transformed).toContain('if (!(');
  });

  /** Fails closed on incomplete editor syntax rather than applying parser-recovery offsets. */
  it('preserves incomplete TSX snapshots', () => {
    const source = 'export function Page() { return ready && <Panel>; }';

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });
});
