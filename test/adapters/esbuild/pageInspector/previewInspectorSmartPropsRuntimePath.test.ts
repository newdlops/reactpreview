/** Checks exact-path edits preserve opaque runtime siblings rather than round-tripping JSON. */
import vm from 'node:vm';
import { createElement, isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorSmartPropsRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorSmartPropsRuntimeSource';

/** Evaluates the production mutation without replacing the generated-value copier with a mock. */
function edit(value: unknown, path: string, next: unknown): Record<string, unknown> | undefined {
  return vm.runInNewContext(
    `${createPreviewInspectorGeneratedValueRuntimeSource()}
     ${createPreviewInspectorBlockerValueRuntimeSource()}
     ${createPreviewInspectorSmartPropsRuntimeSource()}
     setPreviewInspectorSmartPropPathValue(value, path, next)`,
    { value, path, next },
  ) as Record<string, unknown> | undefined;
}

describe('Smart props runtime path mutation', () => {
  it('retains real React children, callbacks and late array entries while changing one leaf', () => {
    const children = createElement('strong', null, 'Actual child');
    const pattern = /valid/gi;
    const onChange = (): string => 'kept';
    const rows = Array.from({ length: 512 }, (_, id) => ({ id }));
    const value = Object.freeze({ children, pattern, onChange, rows, options: { mode: 'list' } });
    const changed = edit(value, 'options.mode', 'grid');
    expect(changed).toMatchObject({ options: { mode: 'grid' } });
    expect(value.options.mode).toBe('list');
    expect(changed?.children).toBe(children);
    expect(isValidElement(changed?.children)).toBe(true);
    expect(changed?.pattern).toBe(pattern);
    expect(changed?.onChange).toBe(onChange);
    expect(changed?.rows).toBe(rows);
    expect(rows[511]).toEqual({ id: 511 });
  });

  it('copies sibling accessors without invoking them and rejects a changed accessor or class path', () => {
    let reads = 0;
    const value = {
      options: { mode: 'list' },
      get privateValue() {
        reads += 1;
        return {};
      },
    };
    const changed = edit(value, 'options.mode', 'grid');
    expect(Object.getOwnPropertyDescriptor(changed, 'privateValue')).toEqual(
      Object.getOwnPropertyDescriptor(value, 'privateValue'),
    );
    expect(edit(value, 'privateValue.mode', 'grid')).toBeUndefined();
    expect(edit({ options: /valid/ }, 'options.mode', 'grid')).toBeUndefined();
    expect(edit(value, '__proto__.polluted', true)).toBeUndefined();
    expect(reads).toBe(0);
  });
});
