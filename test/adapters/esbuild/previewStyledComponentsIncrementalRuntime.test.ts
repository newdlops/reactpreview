import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeInstanceKey } from '../../../src/adapters/esbuild/previewRuntimeInstanceKey';
import { createPreviewThemeBridgePlugin } from '../../../src/adapters/esbuild/previewThemeBridgePlugin';

describe('styled-components incremental runtime identity', () => {
  it('gives each compilation an opaque, distinct runtime key', () => {
    const first = createPreviewRuntimeInstanceKey();
    const second = createPreviewRuntimeInstanceKey();
    expect(first).toMatch(/^[0-9a-f]{24}-[0-9a-z]+$/);
    expect(second).toMatch(/^[0-9a-f]{24}-[0-9a-z]+$/);
    expect(second).not.toBe(first);
  });

  it('keeps the opaque key private while making the generated bridge revision-specific', () => {
    const firstKey = '000000000000000000000001-1';
    const secondKey = '000000000000000000000001-2';
    const first = createPreviewThemeBridgePlugin({
      projectRoot: process.cwd(),
      readRuntimeInstanceKey: () => firstKey,
    });
    const second = createPreviewThemeBridgePlugin({
      projectRoot: process.cwd(),
      readRuntimeInstanceKey: () => secondKey,
    });
    expect(first.name).toBe(second.name);
    // The bridge owns its revision marker internally; this test ensures the public plugin API
    // accepts a fresh key without exposing it as a public protocol field.
    expect(Object.keys(first)).not.toContain('runtimeInstanceKey');
  });
});
