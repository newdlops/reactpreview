/** Verifies the readable sample label shared by compile-time and browser generators. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewSampleLabel,
  createPreviewSampleLabelRuntimeSource,
} from '../../../src/adapters/esbuild/previewSampleLabel';

const CASES: readonly (readonly [string, string])[] = [
  ['sku_name', 'Sku name'],
  ['customerName', 'Customer name'],
  ['grade', 'Grade'],
  ['HTMLContent', 'Html content'],
  ['item-title', 'Item title'],
  ['line2', 'Line2'],
  ['user.profile.displayName', 'Display name'],
  ['rows[0].label', 'Label'],
  ['상품명', '상품명'],
  ['thisFieldNameWouldOtherwiseExpandTheEntireCard', 'This field name would otherwise…'],
  ['', 'Preview'],
  ['  ', 'Preview'],
];

describe('preview sample labels', () => {
  /** Tables showed raw keys such as sku_name; the label reads like text but stays key-derived. */
  it('writes a key as a short readable label', () => {
    for (const [key, label] of CASES) expect(createPreviewSampleLabel(key)).toBe(label);
    expect(createPreviewSampleLabel('', 'Value')).toBe('Value');
  });

  /** Browser generators must produce exactly the compile-time text so generated values still match. */
  it('installs the same behavior in browser runtimes under a chosen name', () => {
    const context: { readonly label?: (key: string, fallback?: string) => string } = {};
    vm.runInNewContext(
      `${createPreviewSampleLabelRuntimeSource('sampleLabel')}\nglobalThis.label = sampleLabel;`,
      context,
    );
    for (const [key, label] of CASES) expect(context.label?.(key)).toBe(label);
    expect(context.label?.('', 'Value')).toBe('Value');
  });
});
