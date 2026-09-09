/** Verifies shell-prop recovery without target attribution, hidden errors, or authored-value changes. */
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createPreviewAutomaticPropsRuntimeSource } from '../../../../src/adapters/esbuild/previewAutomaticPropsRuntimeSource';
import {
  createPreviewInspectorPageSurfacePropsRuntimeSource,
  PREVIEW_INSPECTOR_PAGE_SURFACE_PROPS_KEY,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageSurfacePropsRuntimeSource';

/** Runs the real materializer and React wrapper in a realm containing no project module loader. */
function render(expression: string, enabled = true): string {
  const context: { React: typeof React; result?: React.ReactNode } = { React };
  runInNewContext(
    [
      createPreviewAutomaticPropsRuntimeSource(),
      'function usePreviewInspectorStore() {}',
      `function readPreviewInspectorFallbackValuesEnabled() { return ${String(enabled)}; }`,
      createPreviewInspectorPageSurfacePropsRuntimeSource(),
      `const createSurface = globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_PAGE_SURFACE_PROPS_KEY)})];`,
      `const shape = { kind: 'object', properties: { record: { kind: 'object', properties: {
      fullName: { kind: 'string', value: 'PREVIEW_NAME' }, id: { kind: 'string', value: 'preview-id' },
    } } } };`,
      'function Header({ record }) { return React.createElement("header", null, record.fullName); }',
      `globalThis.result = ${expression};`,
    ].join('\n'),
    context,
  );
  return renderToStaticMarkup(context.result);
}

describe('page surface props bridge', () => {
  it('renders required nested shell data instead of aborting the entire page', () => {
    expect(render('createSurface(Header, shape, undefined)')).toBe('<header>PREVIEW_NAME</header>');
  });
  it('preserves actual authored values', () => {
    expect(render('createSurface(Header, shape, { record: { fullName: "Authored" } })')).toBe(
      '<header>Authored</header>',
    );
  });
  it('does not synthesize values when the Inspector fallback policy is disabled', () => {
    expect(() => render('createSurface(Header, shape, undefined)', false)).toThrow(/fullName/u);
    expect(render('createSurface(Header, shape, { record: { fullName: "Actual" } })', false)).toBe(
      '<header>Actual</header>',
    );
  });
  it('preserves explicit null and lets failures reach the normal page error boundary', () => {
    expect(() => render('createSurface(Header, shape, { record: null })')).toThrow(/fullName/u);
    expect(() =>
      render('createSurface(() => { throw new Error("real render failure"); }, shape, {})'),
    ).toThrow('real render failure');
  });
  it('handles an authored element without replacing its content', () => {
    expect(
      render(
        'createSurface(React.createElement("header", null, "Authored element"), undefined, {})',
      ),
    ).toBe('<header>Authored element</header>');
  });
  it('does not register shell output as an exact target or manufacture a success event', () => {
    const source = createPreviewInspectorPageSurfacePropsRuntimeSource();
    expect(source).not.toMatch(
      /registerTarget|TargetRenderer|runtime-ready|targetHasOutput|catch\s*\{/u,
    );
    expect(source).toContain('React.useMemo(');
    expect(source).not.toContain('React.useEffect(');
  });
});
