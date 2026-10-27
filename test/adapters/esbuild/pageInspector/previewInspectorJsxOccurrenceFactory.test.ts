/** Real React JSX factories retain public element semantics while private site metadata is removed. */
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimePlugin } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimePlugin';
import { createPreviewInspectorJsxOccurrenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorJsxOccurrenceRuntimeSource';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const ID = 'rpi:0123456789abcdef0123456789abcdef';

/** Runs the original React factory through the production automatic-JSX adapter, with no DOM. */
async function createElements(reactPackage: string): Promise<Record<string, unknown>> {
  const result = await build({
    absWorkingDir: ROOT,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    jsxDev: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: { react: path.join(ROOT, 'node_modules', reactPackage) },
    plugins: [createPreviewInspectorRuntimePlugin({ projectRoot: ROOT })],
    stdin: {
      loader: 'tsx',
      resolveDir: ROOT,
      sourcefile: path.join(ROOT, 'OccurrenceProbe.tsx'),
      contents: `import * as React from 'react';
        export const ref = () => {};
        export function Child() { return null; }
        export const Memo = React.memo(Child);
        export const Forward = React.forwardRef(Child);
        export const plain = <Child __reactPreviewInspectorOccurrence="${ID}" key="same" ref={ref} tone="original" />;
        export const memo = <Memo __reactPreviewInspectorOccurrence="${ID}" key="memo" ref={ref} />;
        export const forward = <Forward __reactPreviewInspectorOccurrence="${ID}" ref={ref} />;
        export const authored = <Child __reactPreviewInspectorOccurrence="authored-value" />;`,
    },
  });
  const context = vm.createContext({ console, module: { exports: {} } });
  vm.runInContext(
    `
    const readPreviewInspectorOwnData = (value, key) => value && Object.getOwnPropertyDescriptor(value, key)?.value;
    const findSelectedPreviewInspectorDescriptor = () => ({});
    const readSelectedPreviewInspectorPageCandidate = () => ({ selectedJsxOccurrenceIds: [${JSON.stringify(ID)}] });
    ${createPreviewInspectorJsxOccurrenceRuntimeSource()}
    globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')] = {
      prepareJsxOccurrenceProps: preparePreviewInspectorJsxOccurrenceProps,
      registerJsxOccurrenceProps: registerPreviewInspectorJsxOccurrenceProps,
    };
    ${result.outputFiles[0]?.text ?? ''}
    globalThis.probe = module.exports;
    globalThis.probe.siteIds = ['plain', 'memo', 'forward'].map((key) =>
      previewInspectorJsxOccurrenceProps.get(module.exports[key].props));
  `,
    context,
  );
  return context.probe as Record<string, unknown>;
}

describe('JSX occurrence original React factory contract', () => {
  for (const [label, reactPackage] of [
    ['React 19', 'react'],
    ['React 18', 'react-preview-react-18'],
  ] as const) {
    it(`preserves component, memo, forwardRef, key and ref semantics on ${label}`, async () => {
      const probe = await createElements(reactPackage);
      const plain = probe.plain as {
        type: unknown;
        key: string;
        ref: unknown;
        props: Record<string, unknown>;
      };
      const memo = probe.memo as { type: unknown; key: string; props: Record<string, unknown> };
      const forward = probe.forward as { type: unknown; props: Record<string, unknown> };
      const authored = probe.authored as { props: Record<string, unknown> };
      expect(plain.type).toBe(probe.Child);
      expect(memo.type).toBe(probe.Memo);
      expect(forward.type).toBe(probe.Forward);
      expect(plain.key).toBe('same');
      expect(memo.key).toBe('memo');
      expect(label === 'React 19' ? plain.props.ref : plain.ref).toBe(probe.ref);
      expect(plain.props.tone).toBe('original');
      for (const element of [plain, memo, forward]) {
        expect(element.props).not.toHaveProperty('__reactPreviewInspectorOccurrence');
      }
      expect(authored.props.__reactPreviewInspectorOccurrence).toBe('authored-value');
      expect(probe.siteIds).toEqual([ID, ID, ID]);
    });
  }
});
