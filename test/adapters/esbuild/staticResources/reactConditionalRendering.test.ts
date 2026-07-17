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

  /** Fails closed on incomplete editor syntax rather than applying parser-recovery offsets. */
  it('preserves incomplete TSX snapshots', () => {
    const source = 'export function Page() { return ready && <Panel>; }';

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });
});
