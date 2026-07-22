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

  /** Retains query data and transport callbacks so application effects see unchanged dependencies. */
  it('keeps a selection-shaped GraphQL fallback referentially stable across renders', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const document = {
      definitions: [{ kind: 'OperationDefinition', name: { value: 'CompanyPreview' } }],
      loc: { source: { body: 'query CompanyPreview { company { id } }' } },
    };
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['data.company.id', 'refetch()'],
    };

    const first = fixture.api.resolve(
      () => ({ data: undefined, loading: true }),
      () => ({ data: {}, refetch: () => undefined }),
      metadata,
      () => document,
    ) as { data: object; refetch: () => unknown };
    const second = fixture.api.resolve(
      () => ({ data: undefined, loading: true }),
      () => ({ data: {}, refetch: () => undefined }),
      metadata,
      () => document,
    ) as { data: object; refetch: () => unknown };

    expect(second).toBe(first);
    expect(second.data).toBe(first.data);
    expect(second.refetch).toBe(first.refetch);
  });

  /** Completes an empty Codegen fragment carrier from its exact authored fragment selection. */
  it('uses selection-shaped data for a generated fragment-unmasking helper', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'getFragmentData',
      requiredPaths: ['name'],
    };

    const resolved = fixture.api.resolveFragment(
      () => Object.freeze({}),
      () => ({
        definitions: [{ kind: 'FragmentDefinition', name: { value: 'CompanyFields' } }],
        loc: { source: { body: 'fragment CompanyFields on Company { name }' } },
      }),
      () => Object.freeze({}),
      metadata,
    ) as { name: string };

    expect(resolved).toEqual({ name: 'Preview name' });
    expect(fixture.api.read()[0]).toMatchObject({
      generatedPaths: ['name'],
      hookName: 'getFragmentData',
      reason: 'partial',
    });
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

  /** Keeps a shared wrapper callsite from reusing another GraphQL operation's generated payload. */
  it('scopes fallback identity by the reached GraphQL document and ID variables', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const firstDocument = {
      definitions: [{ kind: 'OperationDefinition', name: { value: 'CompanyPreview' } }],
      loc: { source: { body: 'query CompanyPreview { company { id } }' } },
    };
    const secondDocument = {
      definitions: [{ kind: 'OperationDefinition', name: { value: 'UserPreview' } }],
      loc: { source: { body: 'query UserPreview($userId: ID!) { user(id: $userId) { id } }' } },
    };

    fixture.api.resolve(
      () => ({ data: undefined, loading: true }),
      () => null,
      createMetadata(),
      () => firstDocument,
    );
    fixture.api.resolve(
      () => ({ data: undefined, loading: true }),
      () => null,
      createMetadata(),
      () => secondDocument,
      () => ({ variables: { userId: 'user-7' } }),
    );

    const records = fixture.api.read();
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
    expect(records.every((record) => record.id.startsWith('hook-1:graphql:'))).toBe(true);
    expect(fixture.warnings).toHaveLength(2);
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

    expect(automatic.formikProps.values.employeeName).toBe('employeeName');
    expect(typeof automatic.formikProps.setFieldValue).toBe('function');

    expect(JSON.parse(JSON.stringify(fixture.api.draft('hook-1')))).toEqual({
      formikProps: {
        setFieldValue: '[Preview no-op function]',
        values: { employeeName: 'employeeName' },
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

  /** Converts a called Array prototype method into receiver-kind evidence, not an own callback. */
  it('materializes collection-method evidence as an actual array', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: [
        'data.legalPartnersForCompanyCreate.filter()',
        'data.legalPartnersForCompanyCreate[].id',
      ],
    };

    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({ data: { legalPartnersForCompanyCreate: { filter: () => undefined } } }),
      metadata,
    ) as { data: { legalPartnersForCompanyCreate: { id: string }[] } };

    expect(Array.isArray(resolved.data.legalPartnersForCompanyCreate)).toBe(true);
    expect(
      resolved.data.legalPartnersForCompanyCreate.filter((item) => item.id === 'preview-1'),
    ).toEqual([{ id: 'preview-1', name: 'name' }]);
  });

  /** Repairs an older syntax placeholder when a String method proves the receiver's real kind. */
  it('materializes string-method evidence as an actual string inside a tuple', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['0.template', '0.template.endsWith()', '1()'],
    };

    const resolved = fixture.api.resolve(
      () => undefined,
      () => [{ template: { endsWith: () => undefined } }, () => undefined],
      metadata,
    ) as [{ template: string }, () => unknown];

    expect(typeof resolved[0].template).toBe('string');
    expect(resolved[0].template.replace('-monorepo', '')).toBe('template');
    expect(typeof resolved[1]).toBe('function');
  });

  /** Preserves router-style push APIs because the verb alone does not prove an Array receiver. */
  it('materializes an ambiguous push call as an object method', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['push()'],
    };

    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({}),
      metadata,
    ) as { push: () => unknown };

    expect(Array.isArray(resolved)).toBe(false);
    expect(typeof resolved.push).toBe('function');
    expect(resolved.push()).toBeUndefined();
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
    expect(fixture.api.read()[0]?.mode).toBe('smart');
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
        label: 'label',
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

  /** Reopens a settled edge when a later render or hot edit proves another demanded hook path. */
  it('smart-fills newly discovered paths on an existing hook identity', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const initial = { ...createMetadata(), requiredPaths: ['profile.name'] };
    fixture.api.resolve(
      () => undefined,
      () => ({ profile: { name: 'Preview name' } }),
      initial,
    );
    expect(fixture.api.smartReachability('page:Target')).toBe(true);

    const expanded = {
      ...initial,
      requiredPaths: ['profile.name', 'profile.email'],
    };
    fixture.api.resolve(
      () => undefined,
      () => ({ ignoredAfterStableCreation: true }),
      expanded,
    );
    expect(fixture.api.read()[0]).toMatchObject({
      mode: 'auto',
      requiredPaths: expanded.requiredPaths,
    });
    expect(fixture.api.smartReachability('page:Target')).toBe(true);

    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({}),
      expanded,
    ) as { profile: { email: string; name: string } };
    expect(resolved.profile).toMatchObject({
      email: 'preview@example.invalid',
      name: 'Preview name',
    });
    expect(fixture.api.smartReachability('page:Target')).toBe(false);
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
