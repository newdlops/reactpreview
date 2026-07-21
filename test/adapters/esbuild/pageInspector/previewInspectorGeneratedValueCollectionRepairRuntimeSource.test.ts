/**
 * Verifies evidence-gated collection repair in the Page Inspector hook fallback boundary.
 *
 * These cases stay separate from the broad runtime-fallback suite so both files remain below the
 * repository's 1,000-line limit while exercising the composed browser runtime, not an imitation.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import {
  createPreviewInspectorGeneratedValueRuntimeSource,
  PREVIEW_INSPECTOR_ARRAY_LENGTH_SAFE_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
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

/** Evaluates the exact Smart template builder used by the bounded target-reachability search. */
function createSmartDraftBuilder(): (value: unknown, paths: readonly string[]) => unknown {
  const sandbox = {
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
  };
  const context = createContext(sandbox);
  runInContext(
    'const normalizePreviewInspectorRequiredPropertyPaths = (paths) => [...new Set(paths)];\n' +
      `${createPreviewInspectorGeneratedValueRuntimeSource()}\n` +
      `${createPreviewInspectorBlockerValueRuntimeSource()}\n` +
      'globalThis.__createSmartDraft = createPreviewInspectorRuntimeFallbackSmartDraftTemplate;',
    context,
  );
  const createSmartDraft = (
    sandbox as typeof sandbox & {
      __createSmartDraft?: (value: unknown, paths: readonly string[]) => unknown;
    }
  ).__createSmartDraft;
  if (createSmartDraft === undefined) throw new Error('Smart draft builder did not initialize.');
  return createSmartDraft;
}

describe('Preview Inspector generated collection repair', () => {
  /** Replaces an application `-1` sentinel only where static syntax proves an Array length. */
  it('repairs a negative selector count before an Array constructor can throw', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      nonNegativeNumberPaths: ['rideCancelCount'],
      requiredPaths: ['rideCancelCount'],
    };
    const authored = { rideCancelCount: -1, status: 'authored' };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ rideCancelCount: 0, status: 'generated' }),
      metadata,
    ) as { rideCancelCount: number; status: string };

    expect(resolved).not.toBe(authored);
    expect(resolved).toEqual({ rideCancelCount: 0, status: 'authored' });
    expect(() => {
      new Array(Math.min(5, resolved.rideCancelCount));
    }).not.toThrow();
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['rideCancelCount'],
      reason: 'partial',
    });
  });

  /** Applies Array-length evidence when the hook itself returns the constrained primitive. */
  it('repairs a negative root hook value before an Array constructor can throw', () => {
    const fixture = createRuntimeFallbackFixture(true);

    const resolved = fixture.api.resolve(
      () => -1,
      () => 0,
      {
        ...createMetadata(),
        nonNegativeNumberPaths: ['<root>'],
        requiredPaths: ['<root>'],
      },
    );

    expect(resolved).toBe(0);
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['<root>'],
      reason: 'partial',
    });
  });

  /** Replaces both invalid native lengths and valid lengths that would stall a preview fill/map. */
  it('bounds authored Array lengths to the preview-safe allocation corridor', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const authored = {
      nativeInvalid: 2 ** 32,
      previewUnsafe: PREVIEW_INSPECTOR_ARRAY_LENGTH_SAFE_LIMIT + 1,
    };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ nativeInvalid: 0, previewUnsafe: 0 }),
      {
        ...createMetadata(),
        nonNegativeNumberPaths: ['nativeInvalid', 'previewUnsafe'],
        requiredPaths: ['nativeInvalid', 'previewUnsafe'],
      },
    ) as typeof authored;

    expect(resolved).toEqual({ nativeInvalid: 0, previewUnsafe: 0 });
    expect(() => {
      new Array(resolved.nativeInvalid);
    }).not.toThrow();
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['nativeInvalid', 'previewUnsafe'],
      reason: 'partial',
    });
  });

  /** Keeps a valid authored count so the preview never overwrites usable application state. */
  it('preserves a valid selector count in an Array-length corridor', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const authored = { rideCancelCount: 3 };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ rideCancelCount: 0 }),
      {
        ...createMetadata(),
        nonNegativeNumberPaths: ['rideCancelCount'],
        requiredPaths: ['rideCancelCount'],
      },
    );

    expect(resolved).toBe(authored);
    expect(fixture.api.read()).toEqual([]);
  });

  /** Keeps GraphQL selections that are statically hidden behind a top-level render-prop data key. */
  it('preserves bounded structured data while minimizing a query-result carrier', () => {
    const createSmartDraft = createSmartDraftBuilder();
    const draft = createSmartDraft(
      {
        data: { company: { id: 'company-1' }, directors: [{ id: 'director-1', name: 'Director' }] },
        error: null,
        loading: false,
        refetch: () => undefined,
        unrelated: 'discard me',
      },
      ['loading', 'data', 'error', 'refetch()'],
    );

    expect(draft).toEqual({
      data: { company: { id: 'company-1' }, directors: [{ id: 'director-1', name: 'Director' }] },
      error: null,
      loading: false,
      refetch: '[Preview no-op function]',
    });
  });

  /** Proves an actual GraphQL-aware hook fallback retains its selected fields after Smart Fill. */
  it('keeps selection-shaped query data across resolve, Smart Fill, and resolve', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const document = {
      definitions: [{ kind: 'OperationDefinition', name: { value: 'DirectorList' } }],
      loc: { source: { body: 'query DirectorList { company { id } }' } },
    };
    const metadata = {
      ...createMetadata(),
      hookName: 'useQuery',
      requiredPaths: ['loading', 'data', 'error', 'refetch()'],
    };
    const createQueryFallback = (): object => ({
      data: {},
      error: null,
      loading: false,
      refetch: () => undefined,
    });
    const first = fixture.api.resolve(
      () => undefined,
      createQueryFallback,
      metadata,
      () => document,
    ) as { data: { company: { id: string } } };
    const fallbackId = fixture.api.read()[0]?.id;
    if (fallbackId === undefined) throw new Error('GraphQL fallback record was not registered.');

    fixture.api.smart(fallbackId);
    const second = fixture.api.resolve(
      () => undefined,
      createQueryFallback,
      metadata,
      () => document,
    ) as { data: { company: { id: string } } };

    expect(first.data.company.id).toBe('preview-1');
    expect(second.data.company.id).toBe('preview-1');
  });

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

  /** Replaces a generated key-text scalar when a later hook boundary proves object descendants. */
  it('expands a selection-shaped JSON scalar from downstream property demand', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['data.userDetailedSurvey.surveyResult.data'],
    };

    const resolved = fixture.api.resolve(
      () => ({
        data: {
          userDetailedSurvey: {
            surveyResult: 'surveyResult',
          },
        },
      }),
      () => ({
        data: {
          userDetailedSurvey: {
            surveyResult: { data: {} },
          },
        },
      }),
      metadata,
    ) as { data: { userDetailedSurvey: { surveyResult: { data: object } } } };

    expect(resolved.data.userDetailedSurvey.surveyResult.data).toEqual({});
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['data.userDetailedSurvey.surveyResult'],
      reason: 'partial',
    });
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
