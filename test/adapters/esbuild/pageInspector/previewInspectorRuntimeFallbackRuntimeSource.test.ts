/** Verifies render-only hook recovery without loading a project React package. */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimeFallbackRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';

/** One record returned from the generated browser registry. */
interface TestRuntimeFallbackRecord {
  readonly error: string;
  readonly fallbackPreview: string;
  readonly generatedPaths: readonly string[];
  readonly hookName: string;
  readonly reason: string;
}

/** Functions exported from the isolated VM solely for behavior assertions. */
interface TestRuntimeFallbackApi {
  read(): TestRuntimeFallbackRecord[];
  resolve(readHook: () => unknown, createFallback: () => unknown, metadata: object): unknown;
  status(): string;
}

describe('Preview Inspector runtime fallback source', () => {
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

/** Complete observations exposed by one generated-runtime VM fixture. */
interface RuntimeFallbackFixture {
  readonly api: TestRuntimeFallbackApi;
  readonly consoleEntries: Record<string, unknown>[];
  readonly warnings: string[];
}

/** Creates the lexical browser bindings required by the generated fallback runtime. */
function createRuntimeFallbackFixture(enabled: boolean): RuntimeFallbackFixture {
  const consoleEntries: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  const sandbox = {
    boundPreviewInspectorConsoleText(value: string, limit: number): string {
      return value.slice(0, limit);
    },
    createRuntimeErrorHeadline(error: unknown): string {
      return error instanceof Error ? error.message : String(error);
    },
    formatPreviewInspectorConsoleValue(value: unknown): string {
      return JSON.stringify(value);
    },
    schedulePreviewInspectorTreeRefresh(): undefined {
      return undefined;
    },
    previewInspectorSession: {},
    readPreviewInspectorConsolePrimitives(): { warn(message: string): void } {
      return {
        warn: (message: string): void => {
          warnings.push(message);
        },
      };
    },
    readPreviewInspectorFallbackValuesEnabled(): boolean {
      return enabled;
    },
    recordPreviewInspectorConsoleEntry(candidate: Record<string, unknown>): void {
      consoleEntries.push(candidate);
    },
  };
  const context = createContext(sandbox);
  runInContext(
    `${createPreviewInspectorRuntimeFallbackRuntimeSource()}\n` +
      'globalThis.__runtimeFallbackApi = {' +
      ' read: readPreviewInspectorRuntimeFallbacks,' +
      ' resolve: resolvePreviewInspectorRuntimeHook,' +
      ' status: readPreviewInspectorRuntimeFallbackStatus' +
      '};',
    context,
  );
  const api = (sandbox as typeof sandbox & { __runtimeFallbackApi?: TestRuntimeFallbackApi })
    .__runtimeFallbackApi;
  if (api === undefined) throw new Error('Generated fallback runtime did not initialize.');
  return { api, consoleEntries, warnings };
}

/** Returns stable compiler-like metadata for one isolated hook site. */
function createMetadata(): object {
  return {
    evidence: 'query parameter default plus an inert local setter',
    fallbackLabel: 'static query value',
    hookName: 'useQueryParam',
    id: 'hook-1',
    line: 12,
    moduleSpecifier: 'use-query-params',
    sourcePath: '/workspace/List.tsx',
  };
}
