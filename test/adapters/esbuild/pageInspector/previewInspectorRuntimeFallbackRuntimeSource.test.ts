/** Verifies render-only hook recovery without loading a project React package. */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimeFallbackRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';

/** One record returned from the generated browser registry. */
interface TestRuntimeFallbackRecord {
  readonly error: string;
  readonly fallbackPreview: string;
  readonly generatedPaths: readonly string[];
  readonly hookName: string;
  readonly mode: string;
  readonly ownerName?: string;
  readonly reason: string;
  readonly requiredPaths: readonly string[];
}

/** Functions exported from the isolated VM solely for behavior assertions. */
interface TestRuntimeFallbackApi {
  auto(fallbackId: string): void;
  draft(fallbackId: string): unknown;
  read(): TestRuntimeFallbackRecord[];
  reset(fallbackId: string): void;
  resolve(
    readHook: () => unknown,
    createFallback: () => unknown,
    metadata: object,
    readGraphqlDocument?: () => unknown,
    readGraphqlOptions?: () => unknown,
  ): unknown;
  set(fallbackId: string, value: unknown): void;
  smart(fallbackId: string): void;
  smartReachability(
    reachabilityKey: string,
    options?: { readonly preserveUserValues?: boolean },
  ): boolean;
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

  /** Settles a reached GraphQL hook immediately from its authored selection without an error page. */
  it('uses selection-shaped GraphQL data for an unresolved query wrapper', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['data.company.id', 'loading', 'fallback', 'refetch()'],
    };

    const resolved = fixture.api.resolve(
      () => ({ data: undefined, fallback: { type: 'error-page' }, loading: true }),
      () => ({ data: {}, fallback: null, loading: false, refetch: () => undefined }),
      metadata,
      () => ({
        definitions: [{ kind: 'OperationDefinition', name: { value: 'CompanyPreview' } }],
        loc: { source: { body: 'query CompanyPreview { company { id } }' } },
      }),
    ) as {
      data: { company: { id: string } };
      fallback: unknown;
      loading: boolean;
      refetch: () => unknown;
    };

    expect(resolved.data).toEqual({ company: { id: 'preview-1' } });
    expect(resolved.loading).toBe(false);
    expect(resolved.fallback).toBeNull();
    expect(typeof resolved.refetch).toBe('function');
    expect(fixture.api.read()[0]).toMatchObject({ reason: 'partial' });
  });

  /** Uses a unique query ID variable to satisfy the route/entity equality guard automatically. */
  it('aligns generated GraphQL entity IDs with query variables without user input', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const resolved = fixture.api.resolve(
      () => ({ data: undefined, loading: true }),
      () => null,
      { ...createMetadata(), requiredPaths: ['<root>'] },
      () => ({
        definitions: [{ kind: 'OperationDefinition', name: { value: 'CompanyPreview' } }],
        loc: {
          source: {
            body: 'query CompanyPreview($companyId: ID!) { companyWithDeletionStatus(id: $companyId) { id } }',
          },
        },
      }),
      () => ({ variables: { companyId: '1' } }),
    ) as { data: { company: { id: string } } };

    expect(resolved.data).toEqual({ company: { id: '1' } });
  });

  /** Recovers direct-return query wrappers whose local syntax supplied no object fallback shape. */
  it('creates a minimal settled QueryResult when a GraphQL hook fallback was null', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const resolved = fixture.api.resolve(
      () => ({ data: undefined, loading: true }),
      () => null,
      { ...createMetadata(), requiredPaths: ['<root>'] },
      () => ({
        definitions: [{ kind: 'OperationDefinition', name: { value: 'CompanyPreview' } }],
        loc: { source: { body: 'query CompanyPreview { company { id } }' } },
      }),
    ) as {
      data: { company: { id: string } };
      error: unknown;
      fallback: unknown;
      loading: boolean;
      refetch: () => Promise<{ data: object }>;
    };

    expect(resolved.data).toEqual({ company: { id: 'preview-1' } });
    expect(resolved.loading).toBe(false);
    expect(resolved.fallback).toBeNull();
    expect(resolved.error).toBeNull();
    expect(typeof resolved.refetch).toBe('function');
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

  /** Gives explicit user JSON precedence and restores compiler-inferred Auto data on demand. */
  it('edits one blocker pass value without changing unrelated hook sites', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = createMetadata();
    const autoValue = { page: 1, rows: [] };

    expect(
      fixture.api.resolve(
        () => null,
        () => autoValue,
        metadata,
      ),
    ).toBe(autoValue);
    fixture.api.set('hook-1', { page: 7, rows: ['manual'] });
    expect(
      fixture.api.resolve(
        () => null,
        () => autoValue,
        metadata,
      ),
    ).toEqual({
      page: 7,
      rows: ['manual'],
    });
    expect(fixture.api.read()[0]?.mode).toBe('manual');
    fixture.api.auto('hook-1');
    expect(
      fixture.api.resolve(
        () => null,
        () => autoValue,
        metadata,
      ),
    ).toBe(autoValue);
    expect(fixture.api.read()[0]?.mode).toBe('auto');
  });

  /** Keeps inferred callbacks and deep required fields visible instead of collapsing the editor to `{}`. */
  it('creates a JSON-visible pass-value template and rematerializes callback sentinels', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      ownerName: 'MeetingFormField',
      requiredPaths: ['formikProps.values.employeeName', 'formikProps.setFieldValue()'],
    };

    const automatic = fixture.api.resolve(
      () => {
        throw new Error('Formik provider missing');
      },
      () => ({ formikProps: {} }),
      metadata,
    ) as { formikProps: { setFieldValue: () => unknown; values: { employeeName: string } } };

    expect(automatic.formikProps.values.employeeName).toBe('Preview User 1');
    expect(typeof automatic.formikProps.setFieldValue).toBe('function');

    expect(JSON.parse(JSON.stringify(fixture.api.draft('hook-1')))).toEqual({
      formikProps: {
        setFieldValue: '[Preview no-op function]',
        values: { employeeName: 'Preview User 1' },
      },
    });
    expect(fixture.api.read()[0]).toMatchObject({
      ownerName: 'MeetingFormField',
      requiredPaths: ['formikProps.values.employeeName', 'formikProps.setFieldValue()'],
    });

    fixture.api.set('hook-1', fixture.api.draft('hook-1'));
    const manual = fixture.api.resolve(
      () => null,
      () => ({}),
      metadata,
    ) as { formikProps: { setFieldValue: () => unknown } };
    expect(typeof manual.formikProps.setFieldValue).toBe('function');
    expect(manual.formikProps.setFieldValue()).toBeUndefined();
  });

  /** Expands array-item paths into one shaped record so list rendering reaches deeper fields. */
  it('materializes array-item evidence into the actual automatic hook value', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['employees[].id', 'employees[].profile.email', 'refresh()'],
    };

    const automatic = fixture.api.resolve(
      () => undefined,
      () => ({ employees: [] }),
      metadata,
    ) as {
      employees: { id: string; profile: { email: string } }[];
      refresh: () => unknown;
    };

    expect(automatic.employees).toEqual([
      { id: 'preview-1', profile: { email: 'preview@example.invalid' } },
    ]);
    expect(typeof automatic.refresh).toBe('function');
    expect(fixture.api.draft('hook-1')).toEqual({
      employees: [{ id: 'preview-1', profile: { email: 'preview@example.invalid' } }],
      refresh: '[Preview no-op function]',
    });
  });

  /** Removes unrelated inferred siblings and retains exactly one semantic leaf per demanded path. */
  it('smart-fills the minimum compiler-proven hook result shape', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['employees[].id', 'employees[].profile.email', 'refresh()'],
    };

    fixture.api.resolve(
      () => undefined,
      () => ({
        employees: [],
        featureFlags: { unrelated: true },
        pagination: { page: 1, total: 99 },
      }),
      metadata,
    );
    fixture.api.smart('hook-1');
    const smart = fixture.api.resolve(
      () => undefined,
      () => ({ ignoredAfterStableFallbackCreation: true }),
      metadata,
    ) as {
      employees: { id: string; profile: { email: string } }[];
      refresh: () => unknown;
    };

    expect(smart.employees).toEqual([
      { id: 'preview-1', profile: { email: 'preview@example.invalid' } },
    ]);
    expect(typeof smart.refresh).toBe('function');
    expect(Object.keys(smart).sort()).toEqual(['employees', 'refresh']);
    expect(fixture.api.read()[0]?.mode).toBe('smart');
    expect(fixture.api.draft('hook-1')).toEqual({
      employees: [{ id: 'preview-1', profile: { email: 'preview@example.invalid' } }],
      refresh: '[Preview no-op function]',
    });
  });

  /** Replaces neutral proxy objects at text/link leaves before React receives them as children. */
  it('uses scalar property semantics over object-shaped placeholder leaves', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['favorites[].label', 'favorites[].link'],
    };
    fixture.api.resolve(
      () => undefined,
      () => ({ favorites: [{ label: {}, link: {} }] }),
      metadata,
    );

    fixture.api.smart('hook-1');
    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({}),
      metadata,
    ) as { favorites: { label: string; link: string }[] };

    expect(resolved.favorites).toEqual([
      {
        label: 'Preview generated value',
        link: 'https://example.invalid/preview/1',
      },
    ]);
  });

  /** Uses the Array intrinsic when a generated value shadows its own `map` property. */
  it('materializes array overrides without trusting a shadowed map method', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const shadowedMap: unknown[] = [];
    Object.defineProperty(shadowedMap, 'map', {
      configurable: true,
      enumerable: true,
      value: undefined,
      writable: true,
    });

    expect(() => {
      fixture.api.set('hook-1', shadowedMap);
    }).not.toThrow();
    expect(
      fixture.api.resolve(
        () => undefined,
        () => [],
        { ...createMetadata(), requiredPaths: [] },
      ),
    ).toEqual([]);
  });

  /** Keeps a compiler-proven neutral guard value while reducing an object to demanded paths. */
  it('retains null fallback sentinels during minimum-path Smart fill', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['data.company', 'fallback', 'refetch()'],
    };
    fixture.api.resolve(
      () => undefined,
      () => ({ data: { company: {} }, fallback: null, refetch: () => undefined }),
      metadata,
    );

    fixture.api.smart('hook-1');
    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({}),
      metadata,
    ) as { data: { company: object }; fallback: unknown; refetch: () => unknown };

    expect(resolved.data).toEqual({ company: {} });
    expect(resolved.fallback).toBeNull();
    expect(typeof resolved.refetch).toBe('function');
  });

  /** Reports a corridor change only once so bounded discovery does not remount stable hook values. */
  it('settles repeated corridor Smart fill for the same hook edge', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.resolve(
      () => undefined,
      () => ({ refresh: () => undefined }),
      { ...createMetadata(), requiredPaths: ['refresh()'] },
    );

    expect(fixture.api.smartReachability('page:Target')).toBe(true);
    expect(fixture.api.smartReachability('page:Target')).toBe(false);
  });

  /** Completes explicit user JSON instead of replacing authored leaves during Smart fill. */
  it('preserves manual pass values while smart-filling their missing demanded paths', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['formikProps.values.employeeName', 'formikProps.setFieldValue()'],
    };
    fixture.api.resolve(
      () => undefined,
      () => ({ formikProps: {} }),
      metadata,
    );
    fixture.api.set('hook-1', {
      formikProps: {
        customFlag: 'authored',
        values: { employeeName: 'Authored employee' },
      },
    });

    fixture.api.smart('hook-1');
    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({}),
      metadata,
    ) as {
      formikProps: {
        customFlag: string;
        setFieldValue: () => unknown;
        values: { employeeName: string };
      };
    };

    expect(resolved.formikProps.customFlag).toBe('authored');
    expect(resolved.formikProps.values.employeeName).toBe('Authored employee');
    expect(typeof resolved.formikProps.setFieldValue).toBe('function');
    expect(fixture.api.read()[0]?.mode).toBe('smart-manual');
  });

  /** Automatic page-path convergence cannot amend an explicit hook override behind the user. */
  it('preserves manual hook values during deterministic background convergence', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = { ...createMetadata(), requiredPaths: ['profile.name'] };
    fixture.api.resolve(
      () => undefined,
      () => ({ profile: { name: 'Preview name' } }),
      metadata,
    );
    fixture.api.set('hook-1', { profile: { name: 'Authored name' } });
    fixture.api.resolve(
      () => undefined,
      () => ({ profile: { name: 'Ignored generated name' } }),
      metadata,
    );

    expect(fixture.api.smartReachability('page:Target', { preserveUserValues: true })).toBe(false);
    expect(fixture.api.read()[0]?.mode).toBe('manual');
    expect(fixture.api.draft('hook-1')).toEqual({ profile: { name: 'Authored name' } });
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
    generatePreviewInspectorDataValue(): object {
      return { company: { id: 'preview-1' } };
    },
    inferPreviewInspectorGraphqlQueryShape(): object {
      return {
        fields: { company: { fields: { id: { kind: 'string' } }, kind: 'object' } },
        kind: 'object',
      };
    },
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
    notifyPreviewInspector(): undefined {
      return undefined;
    },
    persistPreviewInspectorState(): undefined {
      return undefined;
    },
    readPersistedPreviewInspectorState(): object {
      return {};
    },
    schedulePreviewInspectorCommitRefresh(): undefined {
      return undefined;
    },
    schedulePreviewInspectorTreeRefresh(): undefined {
      return undefined;
    },
    previewInspectorSession: { activeTargetReachabilityKey: 'page:Target' },
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
    `${createPreviewInspectorFailureEvidenceRuntimeSource()}\n` +
      `${createPreviewInspectorRuntimeFallbackRuntimeSource()}\n` +
      'globalThis.__runtimeFallbackApi = {' +
      ' auto: autoPassPreviewInspectorRuntimeFallback,' +
      ' draft: readPreviewInspectorRuntimeFallbackDraft,' +
      ' read: readPreviewInspectorRuntimeFallbacks,' +
      ' reset: resetPreviewInspectorRuntimeFallbackOverride,' +
      ' resolve: resolvePreviewInspectorRuntimeHook,' +
      ' set: setPreviewInspectorRuntimeFallbackOverride,' +
      ' smart: smartFillPreviewInspectorRuntimeFallback,' +
      ' smartReachability: smartFillPreviewInspectorRuntimeFallbacksForReachability,' +
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
    ownerName: 'List',
    requiredPaths: ['0', '1()'],
    sourcePath: '/workspace/List.tsx',
  };
}
