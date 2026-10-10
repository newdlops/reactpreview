/** Verifies explicit and minimum-shape hook values in the shared isolated fallback runtime. */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector runtime fallback Overrides', () => {
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

    expect(automatic.formikProps.values.employeeName).toBe('Employee name');
    expect(typeof automatic.formikProps.setFieldValue).toBe('function');

    expect(JSON.parse(JSON.stringify(fixture.api.draft('hook-1')))).toEqual({
      formikProps: {
        setFieldValue: '[Preview no-op function]',
        values: { employeeName: 'Employee name' },
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
    ).toEqual([{ id: 'preview-1', name: 'Name' }]);
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
    expect(resolved[0].template.replace('-monorepo', '')).toBe('Template');
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

  /** Keeps a proven router-style API when `replace` also appears in the String method vocabulary. */
  it('preserves an authored callable replace member during Smart completion', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = { ...createMetadata(), requiredPaths: ['replace()'] };

    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({ replace: () => undefined }),
      metadata,
    ) as { replace: () => unknown };

    expect(typeof resolved).toBe('object');
    expect(typeof resolved.replace).toBe('function');
    expect(resolved.replace()).toBeUndefined();
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

  /** Keeps a compiler-proven collection real and non-empty across nested neural retries. */
  it('preserves a collection whose length guards the rendered branch during Smart fill', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['status', 'data.length', 'refetch()'],
    };
    const fallback = {
      data: [{ id: 'preview-id', name: 'Name' }],
      refetch: () => undefined,
      status: 'PREVIEW',
    };

    fixture.api.resolve(
      () => undefined,
      () => fallback,
      metadata,
    );
    fixture.api.smart('hook-1');
    const smart = fixture.api.resolve(
      () => undefined,
      () => ({ ignoredAfterStableFallbackCreation: true }),
      metadata,
    ) as { data: unknown[]; refetch: () => unknown; status: string };

    expect(Array.isArray(smart.data)).toBe(true);
    expect(smart.data).toHaveLength(1);
    expect(smart.status).toBe('PREVIEW');
    expect(typeof smart.refetch).toBe('function');
  });

  /** Lets target-path time evidence override a residual that learned only the completed shape. */
  it('composes a nested neural shape with the compiler-proven pending state', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['data.title', 'status'],
      smartPathValues: [{ path: 'status', value: 'pending' }],
    };

    fixture.api.resolve(
      () => undefined,
      () => ({ data: { title: 'title' }, status: 'PREVIEW' }),
      metadata,
    );
    fixture.api.setNestedNeuralRecommendation('hook-1', {
      data: { title: 'title' },
      status: 'PREVIEW',
    });
    fixture.api.smart('hook-1');
    const smart = fixture.api.resolve(
      () => undefined,
      () => ({ ignoredAfterStableFallbackCreation: true }),
      metadata,
    ) as { data: { title: string }; status: string };

    expect(smart.status).toBe('pending');
    expect(smart.data.title).toBe('title');
  });

  /** A compiler-serialized initializer must not lose known fields during automatic retries. */
  it('preserves an authored static state tuple during Smart convergence', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      preserveSmartValue: true,
      requiredPaths: ['0', '1()'],
    };
    const fallback = [
      { searchTerm: '', userIds: [], myOnly: false, recent: false },
      () => undefined,
    ];

    fixture.api.resolve(
      () => undefined,
      () => fallback,
      metadata,
    );
    fixture.api.smart('hook-1');
    const resolved = fixture.api.resolve(
      () => undefined,
      () => [{ ignoredAfterStableFallbackCreation: true }, () => undefined],
      metadata,
    ) as [
      { searchTerm: string; userIds: unknown[]; myOnly: boolean; recent: boolean },
      () => unknown,
    ];

    expect(resolved[0]).toEqual({ searchTerm: '', userIds: [], myOnly: false, recent: false });
    expect(typeof resolved[1]).toBe('function');
    expect(fixture.api.read()[0]?.mode).toBe('smart');
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
        label: 'Label',
        link: 'https://example.invalid/preview/1',
      },
    ]);
  });

  /** Allows authored avatar initials/placeholders without a fabricated remote image request. */
  it('keeps repaired optional image sources network inert', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['user.avatarUrl', 'user.name'],
    };
    fixture.api.resolve(
      () => undefined,
      () => ({ user: {} }),
      metadata,
    );

    fixture.api.smart('hook-1');
    const resolved = fixture.api.resolve(
      () => undefined,
      () => ({}),
      metadata,
    ) as { user: { avatarUrl: string; name: string } };

    expect(resolved.user).toEqual({ avatarUrl: '', name: 'Name' });
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
