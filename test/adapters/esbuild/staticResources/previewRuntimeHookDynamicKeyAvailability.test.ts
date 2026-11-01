/** Executes synthetic transformed fixtures to catch eager reads of later or out-of-scope keys. */
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('computed hook fallback key availability', () => {
  it('keeps a later const key behind its authored guard without a temporal-dead-zone read', () => {
    const source = [
      'import { useLookup } from "./lookup-hook";',
      'export function Panel() {',
      '  const data = useLookup();',
      '  const key = "rows";',
      '  const rows = (key && data?.[key]) || [];',
      '  return <span>{rows.length}</span>;',
      '}',
    ].join('\n');

    expect(render(source)).toBe(0);
    expect(render(source, { rows: [1, 2] })).toBe(2);
  });

  it('does not lift a block-local key into a fallback created outside that block', () => {
    const source = [
      'import { useLookup } from "./lookup-hook";',
      'export function Panel() {',
      '  const data = useLookup();',
      '  { const key = "rows"; return <span>{(data?.[key] || []).length}</span>; }',
      '}',
    ].join('\n');

    expect(render(source)).toBe(0);
    expect(render(source, { rows: [1, 2, 3] })).toBe(3);
  });

  it.each([
    ['prior const', 'const key = "rows";', '', ''],
    ['parameter', '', '{ key }', ''],
    ['initialized module binding', '', '', 'const key = "rows";'],
  ])(
    'preserves an available %s key and its collection contract',
    (_label, before, parameter, after) => {
      const source = [
        'import { useLookup } from "./lookup-hook";',
        `export function Panel(${parameter}) {`,
        before,
        '  const data = useLookup();',
        '  return <span>{data[key].map((row) => row).length}</span>;',
        '}',
        after,
      ].join('\n');

      expect(render(source)).toBe(0);
      expect(render(source, { rows: [1, 2] })).toBe(2);
    },
  );
});

/** Runs only this test's own JSX fixture; application modules and project configuration are absent. */
function render(source: string, authoredValue?: unknown): unknown {
  let transformed = source;
  const replacements = createPreviewRuntimeHookReplacements('/workspace/Fixture.tsx', source);
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.replacement +
      transformed.slice(replacement.end);
  }
  const compiled = ts.transpileModule(transformed, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = vm.createContext({
    exports: {},
    require: (specifier: string) =>
      specifier === 'react/jsx-runtime'
        ? { jsx: (_type: unknown, props: { readonly children?: unknown }) => props.children }
        : {
            useLookup: () => {
              if (authoredValue === undefined) throw new Error('Fixture hook unavailable');
              return authoredValue;
            },
          },
    resolve: (original: () => unknown, fallback: () => unknown) => {
      const generated = fallback();
      try {
        return original() ?? generated;
      } catch {
        return generated;
      }
    },
  });
  return vm.runInContext(
    [
      'globalThis[Symbol.for("newdlops.react-file-preview.page-inspector")] = { resolveRuntimeHook: resolve };',
      compiled,
      'exports.Panel({ key: "rows" });',
    ].join('\n'),
    context,
  );
}
