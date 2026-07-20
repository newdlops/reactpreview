/**
 * Verifies evidence-gated collection repair in the Page Inspector hook fallback boundary.
 *
 * These cases stay separate from the broad runtime-fallback suite so both files remain below the
 * repository's 1,000-line limit while exercising the composed browser runtime, not an imitation.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Evaluates the generated value helpers and exposes only the required-path materializer. */
function createRequiredPathMaterializer(): (template: unknown, path: string) => unknown {
  const sandbox = {
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
  };
  const context = createContext(sandbox);
  runInContext(
    `${createPreviewInspectorGeneratedValueRuntimeSource()}\n` +
      `${createPreviewInspectorBlockerValueRuntimeSource()}\n` +
      'globalThis.__materializeRequiredPath = materializePreviewInspectorRequiredPath;',
    context,
  );
  const materialize = (
    sandbox as typeof sandbox & {
      __materializeRequiredPath?: (template: unknown, path: string) => unknown;
    }
  ).__materializeRequiredPath;
  if (materialize === undefined) throw new Error('Required-path materializer did not initialize.');
  return materialize;
}

describe('Preview Inspector generated collection repair', () => {
  /** Repairs a populated Context placeholder only when item access proves the exact Array path. */
  it('repairs a non-empty record at a compiler-proven nested collection path', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['options.[].isStaffOnly', 'options.[].hidden'],
    };
    const authored = {
      options: { source: 'context-placeholder' },
      title: 'Authored title',
    };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({
        options: { source: 'compiler-placeholder' },
        title: 'Generated title',
      }),
      metadata,
    ) as { options: { hidden: boolean; isStaffOnly: boolean }[]; title: string };

    expect(Array.isArray(resolved.options)).toBe(true);
    expect(resolved.options.filter((option) => !option.hidden)).toEqual([
      { hidden: false, isStaffOnly: true },
    ]);
    expect(resolved.title).toBe('Authored title');
    expect(authored).toEqual({
      options: { source: 'context-placeholder' },
      title: 'Authored title',
    });
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['options'],
      reason: 'partial',
    });
  });

  /** Treats an unambiguous filter call as collection evidence even without inferred item fields. */
  it('repairs the receiver of a compiler-proven Array method call', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['options.filter()'],
    };

    const resolved = fixture.api.resolve(
      () => ({ options: { stale: true } }),
      () => ({ options: [] }),
      metadata,
    ) as { options: unknown[] };

    expect(Array.isArray(resolved.options)).toBe(true);
    expect(resolved.options.filter(Boolean)).toEqual([]);
  });

  /** Preserves a scalar receiver because several allowlisted collection methods also exist on text. */
  it('does not replace an authored string from method-name evidence alone', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['label.slice()'],
    };
    const authored = { label: 'authored label' };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ label: [] }),
      metadata,
    );

    expect(resolved).toBe(authored);
  });

  /** Matches runtime numeric indices back to static array markers for nested collection fields. */
  it('repairs a nested collection below an authored array item', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['groups.[].options.[].hidden'],
    };
    const authored = {
      groups: [{ name: 'Authored group', options: { source: 'placeholder' } }],
    };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ groups: [{ options: {} }] }),
      metadata,
    ) as { groups: { name: string; options: { hidden: boolean }[] }[] };

    expect(resolved.groups[0]?.name).toBe('Authored group');
    expect(Array.isArray(resolved.groups[0]?.options)).toBe(true);
    expect(resolved.groups[0]?.options[0]).toEqual({ hidden: false });
  });

  /** Preserves an existing collection when a named descendant such as length is required. */
  it('keeps an authored array while materializing a non-index descendant', () => {
    const materialize = createRequiredPathMaterializer();
    const template = { items: [{ id: 'authored-1' }] };

    const materialized = materialize(template, 'items.length') as {
      items: { id: string }[];
    };

    expect(Array.isArray(materialized.items)).toBe(true);
    expect(materialized.items).toEqual([{ id: 'authored-1' }]);
  });

  /** Keeps a real object when naming alone suggests a list but no collection operation was proven. */
  it('preserves a non-empty options object without collection-path evidence', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['options'],
    };
    const authored = { options: { density: 'compact' } };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ options: [{ id: 'preview-1' }] }),
      metadata,
    );

    expect(resolved).toBe(authored);
    expect(fixture.api.read()).toEqual([]);
  });
});
