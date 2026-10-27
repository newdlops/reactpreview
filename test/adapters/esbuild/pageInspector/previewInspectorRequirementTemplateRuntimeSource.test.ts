/** Verifies required-path overlays cannot corrupt unrelated generated query fields at JSON limits. */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';

/** Production helper functions exposed from one isolated generated browser realm. */
interface RequirementRuntime {
  readonly require: (value: unknown, paths: readonly string[]) => unknown;
  readonly overlay: (
    value: unknown,
    demands: readonly { readonly path: string; readonly value: string }[],
  ) => unknown;
}

/** Composes the actual overlay and completion sources, keeping all project inputs inert. */
function createRequirementRuntime(): RequirementRuntime {
  const context = createContext({});
  runInContext(
    "const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);\n" +
      'const normalizePreviewInspectorRequiredPropertyPaths = (paths) => [...new Set(paths)];\n' +
      createPreviewInspectorGeneratedValueRuntimeSource() +
      createPreviewInspectorBlockerValueRuntimeSource() +
      createPreviewInspectorHookGraphqlRuntimeSource() +
      'globalThis.__requirements = { require: createPreviewInspectorRuntimeFallbackRequirementTemplate,' +
      ' overlay: overlayPreviewInspectorGraphqlLiteralDemands };',
    context,
  );
  return runInContext('globalThis.__requirements', context) as RequirementRuntime;
}

describe('runtime required-path templates', () => {
  /** A real dense query lost its late receipt array when an unrelated literal was applied. */
  it('retains late query arrays while completing and applying an earlier exact literal', () => {
    const runtime = createRequirementRuntime();
    const receipts = Object.freeze([{ id: 'receipt-1', url: 'https://example.invalid/receipt' }]);
    const meeting = Object.freeze({
      agendas: Object.freeze([{ kind: 'ACTIVE' }]),
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `field${index.toString()}`,
          { id: `item-${index.toString()}`, name: 'Name', active: true },
        ]),
      ),
      receipts,
    });
    const source = Object.freeze({ data: Object.freeze({ meeting }) });
    const result = runtime.overlay(source, [
      { path: 'data.meeting.agendas.[].kind', value: 'OPEN' },
    ]) as typeof source;

    expect(result.data.meeting.agendas[0]?.kind).toBe('OPEN');
    expect(result.data.meeting.receipts).toBe(receipts);
    expect(result.data.meeting.receipts[0]?.id).toBe('receipt-1');
    expect(source.data.meeting.agendas[0]?.kind).toBe('ACTIVE');
    expect(source.data.meeting.receipts).toBe(receipts);
  });

  /** Existing immutable siblings and their native/function behavior need no JSON round trip. */
  it('preserves existing siblings when only one missing field is required', () => {
    const runtime = createRequirementRuntime();
    const pattern = new RegExp('/company/');
    const callback = (): number => 7;
    const sibling = { pattern, callback, untouched: Object.freeze([{ id: 'one' }]) };
    const source = Object.freeze({ sibling });
    const result = runtime.require(source, ['data.owner.name']) as {
      sibling: typeof sibling;
      data: { owner: { name: string } };
    };

    expect(result.sibling).toBe(sibling);
    expect(result.sibling.pattern.test('/company/1')).toBe(true);
    expect(result.sibling.callback()).toBe(7);
    expect(result.data.owner.name).toBeTypeOf('string');
    expect(source).not.toHaveProperty('data');
  });

  /** Required-path generation must not invoke an unrelated application accessor. */
  it('does not evaluate getters or replace deliberate null sentinels', () => {
    const runtime = createRequirementRuntime();
    let reads = 0;
    const source = {
      selected: null,
      get secret(): never {
        reads += 1;
        throw new Error('Application getter must stay untouched');
      },
    };
    const result = runtime.require(source, ['selected', 'data.name']) as {
      selected: null;
      data: { name: string };
    };

    expect(reads).toBe(0);
    expect(result.selected).toBeNull();
    expect(result.data.name).toBeTypeOf('string');
  });

  /** An exact-path getter still belongs to the application, rather than template generation. */
  it('preserves a required accessor without evaluating it while repairing a sibling', () => {
    const runtime = createRequirementRuntime();
    let reads = 0;
    const source = Object.freeze({
      get data(): undefined {
        reads += 1;
        return undefined;
      },
      status: null,
    });
    const result = runtime.require(source, ['data.owner.name', 'status', 'ready']) as {
      readonly ready: boolean;
    };

    expect(reads).toBe(0);
    expect(Object.getOwnPropertyDescriptor(result, 'data')).toEqual(
      Object.getOwnPropertyDescriptor(source, 'data'),
    );
    expect(result.ready).toBe(true);
    expect(source).not.toHaveProperty('ready');
  });

  /** Parent and descendant requirements must preserve exact existing leaves on frozen containers. */
  it('keeps empty leaves and runtime-only siblings across overlapping array paths', () => {
    const runtime = createRequirementRuntime();
    const callback = (): number => 11;
    const data = Object.freeze({ rows: Object.freeze([Object.freeze({ data: {}, callback })]) });
    const source = Object.freeze({ data });
    const result = runtime.require(source, [
      'data',
      'data.rows.[].data',
      'data.rows.[].owner.name',
    ]) as { data: { rows: { callback: () => number; data: object; owner: { name: string } }[] } };

    expect(result.data.rows[0]?.data).toBe(data.rows[0]?.data);
    expect(result.data.rows[0]?.callback).toBe(callback);
    expect(result.data.rows[0]?.callback()).toBe(11);
    expect(result.data.rows[0]?.owner.name).toBeTypeOf('string');
    expect(data.rows[0]).not.toHaveProperty('owner');
  });
});
