/** Verifies that a store hook created in the same module joins the hook fallback boundary. */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

/** Applies non-overlapping replacements from the end so earlier offsets stay valid. */
function transform(sourcePath: string, source: string): string {
  return [...createPreviewRuntimeHookReplacements(sourcePath, source)]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, replacement) =>
        text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end),
      source,
    );
}

/** A toast host reading the list of a store its own module creates. */
function toastModule(importLine: string, factoryCall: string): string {
  return [
    importLine,
    'interface Toast { id: number; text: string }',
    `export const useToastStore = ${factoryCall}((set) => ({ items: [] as Toast[] }));`,
    'export function ToastHost() {',
    '  const items = useToastStore((s) => s.items);',
    '  return <div>{items.map((item) => <p key={item.id}>{item.text}</p>)}</div>;',
    '}',
  ].join('\n');
}

describe('same-module store hooks', () => {
  /** An empty store list left the toast host without visible output in the preview. */
  it.each([
    ["import { create } from 'zustand';", 'create<{ items: Toast[] }>'],
    ["import { create as createStore } from 'zustand';", 'createStore<{ items: Toast[] }>()'],
    ["import { createWithEqualityFn } from 'zustand/traditional';", 'createWithEqualityFn'],
  ])('instruments a store created by %s', (importLine, factoryCall) => {
    const transformed = transform('/workspace/Toast.tsx', toastModule(importLine, factoryCall));

    expect(transformed).toContain('.resolveRuntimeHook(() => (useToastStore((s) => s.items))');
    expect(transformed).toContain('"requiredPaths":["[].id","[].text"]');
    expect(transformed).toContain('"moduleSpecifier":"local-store"');
  });

  /** A project factory named `create` is not a zustand store and keeps its authored call. */
  it('leaves stores of other factories untouched', () => {
    const transformed = transform(
      '/workspace/Toast.tsx',
      toastModule("import { create } from './storeFactory';", 'create'),
    );

    expect(transformed).not.toContain('resolveRuntimeHook(() => (useToastStore(');
  });
});
