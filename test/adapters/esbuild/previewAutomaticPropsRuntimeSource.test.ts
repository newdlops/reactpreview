/** Verifies browser materialization of data-only inferred prop shapes without project execution. */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewAutomaticPropsRuntimeSource } from '../../../src/adapters/esbuild/previewAutomaticPropsRuntimeSource';

describe('createPreviewAutomaticPropsRuntimeSource', () => {
  /** Creates nested neutral values and lets real partial values win at the deepest supplied path. */
  it('materializes and overlays bounded automatic props', () => {
    const context: { result?: Record<string, unknown> } = {};
    const shape = {
      kind: 'object',
      properties: {
        field: {
          kind: 'object',
          properties: {
            value: {
              kind: 'object',
              properties: { addressInput: { kind: 'object', properties: {} } },
            },
          },
        },
        helpers: {
          kind: 'object',
          properties: { setValue: { kind: 'function' } },
        },
      },
    };
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        `const value = createPreviewPropsFromLayers(${JSON.stringify(shape)}, { field: { value: { name: 'office' } } });`,
        'globalThis.result = {',
        '  addressInput: value.field.value.addressInput,',
        '  helperResult: value.helpers.setValue(),',
        '  name: value.field.value.name,',
        '};',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ addressInput: {}, helperResult: undefined, name: 'office' });
  });

  /** Rejects prototype keys and lets authored null remain an intentional semantic value. */
  it('bounds unsafe shapes and preserves explicit null', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { safe: { kind: 'string' }, constructor: { kind: 'object' } } };",
        'const value = createPreviewPropsFromLayers(shape, { safe: null });',
        'globalThis.result = { keys: Object.keys(value), safe: value.safe };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ keys: ['safe'], safe: null });
  });

  /** Does not execute an authored accessor while overlaying otherwise plain setup props. */
  it('ignores accessor properties instead of evaluating project getters', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { value: { kind: 'string' } } };",
        'let getterCalls = 0;',
        'const authored = {};',
        "Object.defineProperty(authored, 'value', { enumerable: true, get() { getterCalls += 1; return 'effect'; } });",
        'const value = createPreviewPropsFromLayers(shape, authored);',
        'globalThis.result = { getterCalls, value: value.value };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ getterCalls: 0, value: '' });
  });
});
