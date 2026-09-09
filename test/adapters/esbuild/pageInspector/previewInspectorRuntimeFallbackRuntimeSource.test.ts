/** Verifies render-only hook recovery without loading a project React package. */
import { describe, expect, it } from 'vitest';
import { PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector runtime fallback source', () => {
  /** Logs a side-effect failure without creating a meaningless editable payload blocker. */
  it('isolates effect and cleanup failures while keeping hook blockers separate', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'useEffect',
      id: 'effect-1',
      requiredPaths: [],
    };

    expect(
      fixture.api.effect(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'onReconnected')");
      }, metadata),
    ).toBeUndefined();
    const cleanup = fixture.api.effect(
      () => () => {
        throw new Error('cleanup bridge unavailable');
      },
      { ...metadata, id: 'effect-2' },
    );
    expect(cleanup).toBeTypeOf('function');
    expect(() => {
      (cleanup as () => void)();
    }).not.toThrow();

    expect(fixture.api.read()).toEqual([]);
    expect(fixture.consoleEntries).toHaveLength(2);
    expect(fixture.consoleEntries[0]).toMatchObject({
      level: 'warn',
      phase: 'render-only effect isolation',
      source: 'runtime-effect',
    });
    expect(fixture.warnings[0]).toContain('onReconnected');
    expect(fixture.api.status()).toContain('2 render-only effect failure(s) isolated');
  });

  /** Cuts a successful-but-self-triggering effect before React reaches its update-depth failure. */
  it('isolates a repeated effect execution burst at its exact source site', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'useEffect',
      id: 'repeating-effect',
      requiredPaths: [],
    };
    let executions = 0;

    for (let index = 0; index < PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT + 3; index += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
    }

    expect(executions).toBe(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT);
    expect(fixture.consoleEntries).toHaveLength(1);
    expect(fixture.consoleEntries[0]).toMatchObject({
      level: 'warn',
      phase: 'render-only effect isolation',
      source: 'runtime-effect',
    });
    expect(fixture.warnings[0]).toContain('further executions were disabled');
  });

  /** Converts a provider-hook exception into a stable value and a warning record. */
  it('bypasses non-thenable hook failures while Auto values is enabled', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createMetadata();
    const fallback = Object.freeze({ filters: Object.freeze({}) });

    const first = fixture.api.resolve(
      () => {
        throw new Error('useQueryParams must be used within a QueryParamProvider');
      },
      () => fallback,
      metadata,
    );
    const second = fixture.api.resolve(
      () => {
        throw new Error('useQueryParams must be used within a QueryParamProvider');
      },
      () => ({ different: true }),
      metadata,
    );

    expect(first).toBe(fallback);
    expect(second).toBe(fallback);
    expect(fixture.api.read()).toHaveLength(1);
    expect(fixture.api.read()[0]).toMatchObject({
      error: 'useQueryParams must be used within a QueryParamProvider',
      hookName: 'useQueryParam',
      reason: 'threw',
    });
    expect(fixture.warnings).toHaveLength(1);
    expect(fixture.consoleEntries[0]?.level).toBe('warn');
    expect(fixture.api.status()).toContain('1 render-blocking hook edge');
  });

  /** Call counters belong to a render attempt and cannot independently manufacture success. */
  it('selects a generated predicate but leaves learning to the target render verifier', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'useRoundFilter',
      id: 'round-filter',
      requiredPaths: ['matches()', 'hasSelection'],
      smartPathValues: [
        {
          path: 'matches()',
          role: 'collection-filter-predicate',
          value: true,
        },
      ],
    };

    const value = fixture.api.resolve(
      () => {
        throw new Error('round filter provider unavailable');
      },
      () => ({ hasSelection: false, matches: () => undefined }),
      metadata,
    ) as { hasSelection: boolean; matches(value: unknown): boolean };

    expect(value.hasSelection).toBe(false);
    expect(value.matches({ round: 1 })).toBe(true);
    expect(fixture.api.read()[0]?.neuralRecommendation).toMatchObject({
      candidateId: 'retain-generated-collection',
      strategy: 'retain-generated-collection',
    });

    fixture.flushEffectFrame();

    expect(fixture.api.neuralModel().updates).toBe(0);
    expect(fixture.autoDecisions.at(-1)).toMatchObject({
      neuralDataFlowSignal: { calls: 1, truthyReturns: 1 },
      startsRenderAttempt: true,
      targetReachabilityKey: 'page:Target',
    });
  });

  /** Uses a required fallback for nullish results and clears it when a real value appears. */
  it('retains real non-nullish values and removes stale blocker records', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createMetadata();

    expect(
      fixture.api.resolve(
        () => null,
        () => 'Preview value',
        metadata,
      ),
    ).toBe('Preview value');
    expect(fixture.api.read()[0]?.reason).toBe('nullish');
    const realValue = { source: 'application' };
    expect(
      fixture.api.resolve(
        () => realValue,
        () => 'unused',
        metadata,
      ),
    ).toBe(realValue);
    expect(fixture.api.read()).toEqual([]);
  });

  /** Replaces only an exact invalid discriminator that would enter an exhaustive throw. */
  it('applies a compiler-proven Context render guard over a non-nullish generated scalar', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      renderGuardPaths: ['workflow.stage'],
      requiredPaths: ['workflow.stage'],
    };
    const authored = { workflow: { retained: 'application', stage: 'stage' } };
    const fallback = { workflow: { stage: 'basic' } };

    expect(
      fixture.api.resolve(
        () => authored,
        () => fallback,
        metadata,
      ),
    ).toEqual({
      workflow: { retained: 'application', stage: 'basic' },
    });
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['workflow.stage'],
      reason: 'partial',
    });
  });

  /** Keeps a compiler-proven optional sentinel without exposing a meaningless user decision. */
  it('auto-resolves optional-only nullish hook results by preserving the authored sentinel', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      preserveNullish: true,
      requiredPaths: [],
    };

    expect(
      fixture.api.resolve(
        () => undefined,
        () => ({ initialState: { search: 'Preview search' } }),
        metadata,
      ),
    ).toBeUndefined();
    expect(fixture.api.read()).toEqual([]);
    expect(fixture.warnings).toEqual([]);
  });

  /** Uses failure-only optional paths when the hook throws without completing a real empty value. */
  it('reports and returns the compiler-shaped optional fallback after a hook exception', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      failurePaths: ['timeSeconds', 'day'],
      preserveNullish: true,
      requiredPaths: [],
    };
    const fallback = { day: {}, timeSeconds: 0 };

    expect(
      fixture.api.resolve(
        () => {
          throw new Error('selector unavailable');
        },
        () => fallback,
        metadata,
      ),
    ).toEqual(fallback);
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['timeSeconds', 'day'],
      reason: 'threw',
      requiredPaths: ['timeSeconds', 'day'],
    });
    expect(
      fixture.api.resolve(
        () => null,
        () => fallback,
        metadata,
      ),
    ).toBeNull();
  });

  /** Supplements only missing nested leaves and keeps one stable completed identity per hook site. */
  it('completes partial plain values without replacing authored sibling fields', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createMetadata();
    const realValue = {
      filters: { status: 'AUTHORED' },
      rows: undefined,
    };
    const fallback = Object.freeze({
      filters: Object.freeze({ query: 'Preview search', status: 'PREVIEW' }),
      rows: Object.freeze([]),
    });

    const first = fixture.api.resolve(
      () => realValue,
      () => fallback,
      metadata,
    ) as { filters: { query: string; status: string }; rows: unknown[] };
    const second = fixture.api.resolve(
      () => realValue,
      () => ({ ignored: true }),
      metadata,
    );

    expect(first).not.toBe(realValue);
    expect(second).toBe(first);
    expect(first.filters).toEqual({ query: 'Preview search', status: 'AUTHORED' });
    expect(first.rows).toEqual([]);
    expect(realValue).toEqual({ filters: { status: 'AUTHORED' }, rows: undefined });
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['filters.query', 'rows'],
      reason: 'partial',
    });
    expect(fixture.warnings[0]).toContain('missing required fields');
  });

  /** Replaces a neutral empty selector record when local collection use admits only one valid kind. */
  it('auto-resolves an empty neutral record to a compiler-proven collection', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['[].id', '[].title'],
    };

    const resolved = fixture.api.resolve(
      () => Object.freeze({}),
      () => Object.freeze([Object.freeze({ id: 'preview-id', title: 'Preview title' })]),
      metadata,
    ) as { id: string; title: string }[];

    expect(Array.isArray(resolved)).toBe(true);
    expect(resolved).toEqual([{ id: 'preview-id', title: 'Preview title' }]);
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['<root>'],
      reason: 'partial',
    });
  });

  /** Replaces Redux's path-container placeholder when downstream usage proves a scalar leaf. */
  it('auto-resolves an empty neutral record to a compiler-proven string', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['company.shortName'],
    };

    const resolved = fixture.api.resolve(
      () => ({ company: { shortName: Object.freeze({}) } }),
      () => ({ company: { shortName: 'Preview company' } }),
      metadata,
    ) as { company: { shortName: string } };

    expect(resolved.company.shortName).toBe('Preview company');
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['company.shortName'],
      reason: 'partial',
    });
  });

  /** Keeps compiler-authored neutral leaves falsy while still replacing an absent hook field. */
  it('preserves direct null sentinels used by fallback and error branches', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['data', 'fallback', 'refetch()', 'loading'],
    };
    const authored = {
      data: undefined,
      fallback: undefined,
      loading: false,
      refetch: () => undefined,
    };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ data: {}, fallback: null, loading: false, refetch: () => undefined }),
      metadata,
    ) as { data: object; fallback: unknown; loading: boolean; refetch: () => unknown };

    expect(resolved.data).toEqual({});
    expect(resolved.fallback).toBeNull();
    expect(resolved.loading).toBe(false);
    expect(resolved.refetch).toBe(authored.refetch);
    expect(fixture.api.read()[0]?.generatedPaths).toEqual(['data', 'fallback']);
  });

  /** Does not rewrite an application's existing null guard value to a generated scalar. */
  it('keeps authored null leaves when only scalar branch evidence is available', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const authored = { fallback: null, status: 'NONE' };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ fallback: false, status: 'COMPLETED' }),
      { ...createMetadata(), requiredPaths: ['fallback', 'status'] },
    );

    expect(resolved).toBe(authored);
    expect(fixture.api.read()).toEqual([]);
  });

  /** Leaves accessors, class instances, complete arrays, and authored callbacks untouched. */
  it('fails closed around executable or non-plain authored values', () => {
    const fixture = createRuntimeFallbackFixture(true);
    let getterCalls = 0;
    const authoredCallback = (): string => 'authored';
    /** Represents a project-owned non-plain hook result that completion must preserve. */
    class ServiceState {
      public readonly ready = true;
    }
    const value = Object.defineProperty(
      {
        callback: authoredCallback,
        service: new ServiceState(),
        tuple: ['authored', authoredCallback],
      },
      'profile',
      {
        enumerable: true,
        get(): object {
          getterCalls += 1;
          return {};
        },
      },
    );
    const fallback = Object.freeze({
      callback: Object.freeze(() => undefined),
      profile: Object.freeze({ name: 'Preview name' }),
      service: Object.freeze({ missing: 'Preview value' }),
      tuple: Object.freeze(['preview', Object.freeze(() => undefined)]),
    });

    const resolved = fixture.api.resolve(
      () => value,
      () => fallback,
      createMetadata(),
    ) as typeof value;

    expect(resolved).toBe(value);
    expect(resolved.callback).toBe(authoredCallback);
    expect(resolved.service).toBeInstanceOf(ServiceState);
    expect(resolved.tuple).toBe(value.tuple);
    expect(getterCalls).toBe(0);
    expect(fixture.api.read()).toEqual([]);
  });

  /** Fills only undefined tuple slots while preserving the application's callable slot. */
  it('completes bounded arrays without replacing present indexes', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const setter = (): string => 'authored setter';
    const tuple = [undefined, setter];
    const fallback = Object.freeze([Object.freeze({ page: 0 }), Object.freeze(() => undefined)]);

    const resolved = fixture.api.resolve(
      () => tuple,
      () => fallback,
      createMetadata(),
    ) as unknown[];

    expect(resolved).not.toBe(tuple);
    expect(resolved[0]).toEqual({ page: 0 });
    expect(resolved[1]).toBe(setter);
    expect(tuple[0]).toBeUndefined();
    expect(fixture.api.read()[0]?.generatedPaths).toEqual(['0']);
  });

  /** Restores authored exceptions when disabled and never consumes React Suspense thenables. */
  it('rethrows disabled failures and Suspense thenables', () => {
    const disabled = createRuntimeFallbackFixture(false);
    const error = new Error('authored failure');
    expect(() =>
      disabled.api.resolve(
        () => {
          throw error;
        },
        () => false,
        createMetadata(),
      ),
    ).toThrow(error);

    const enabled = createRuntimeFallbackFixture(true);
    const thenable = Object.assign(new Error('Suspense thenable'), {
      then: (): undefined => undefined,
    });
    expect(() =>
      enabled.api.resolve(
        () => {
          throw thenable;
        },
        () => false,
        createMetadata(),
      ),
    ).toThrow(thenable);
    expect(enabled.api.read()).toEqual([]);
  });

  /** Does not allocate or evaluate a generated fallback while Auto values is disabled. */
  it('preserves partial authored identities when Auto values is disabled', () => {
    const fixture = createRuntimeFallbackFixture(false);
    const partial = { nested: {} };
    let fallbackReads = 0;

    expect(
      fixture.api.resolve(
        () => partial,
        () => {
          fallbackReads += 1;
          return { nested: { value: 'Preview value' } };
        },
        createMetadata(),
      ),
    ).toBe(partial);
    expect(fallbackReads).toBe(0);
    expect(fixture.api.read()).toEqual([]);
  });
});
