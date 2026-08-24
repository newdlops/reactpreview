/** Exercises generated payload state without importing a target project's React runtime. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewGeneratedListRuntimeSource } from '../../../../src/adapters/esbuild/previewGeneratedListRuntimeSource';

describe('Page Inspector data runtime source', () => {
  /** Treats a singular Relations entity as an object and merges repeated GraphQL selections. */
  it('materializes the public investor-relations entity from its complete selection set', () => {
    const runtime = evaluateDataRuntime();
    const shape = runtime.inferGraphql(
      `query PublicInvestorRelationsPage {
        publicInvestorRelations {
          companyInfo { name }
          companyInfo { profileLogo { url } }
        }
      }`,
      'PublicInvestorRelationsPage',
    );

    expect(cloneJson(runtime.generate(shape))).toEqual({
      publicInvestorRelations: {
        companyInfo: {
          name: 'name',
          profileLogo: { url: 'https://example.com/preview/1' },
        },
      },
    });
  });

  /** Infers deterministic scalar/list values and records explicit generated provenance. */
  it('generates Auto, Smart minimum, Lorem, and custom payloads from one shared type shape', () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      evidence: 'GraphQL selection',
      id: 'employees',
      kind: 'graphql',
      label: 'EmployeesQuery',
      shape: {
        fields: {
          employees: {
            items: {
              fields: {
                active: { kind: 'boolean' },
                id: { kind: 'string' },
                name: { kind: 'string' },
                salary: { kind: 'number' },
              },
              kind: 'object',
            },
            kind: 'array',
          },
        },
        kind: 'object',
      },
    };

    const automatic = cloneJson(runtime.resolve(metadata, {}));
    expect(automatic).toEqual({
      employees: [
        { active: true, id: 'preview-1', name: 'name', salary: 1 },
        { active: true, id: 'preview-2', name: 'name', salary: 2 },
        { active: true, id: 'preview-3', name: 'name', salary: 3 },
      ],
    });
    expect(cloneJson(runtime.requests())[0]).toMatchObject({ mode: 'auto' });

    runtime.smart('employees');
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'smart',
      payload: {
        employees: [{ active: true, id: 'preview-1', name: 'name', salary: 1 }],
      },
    });

    runtime.lorem('employees');
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'lorem',
      payload: {
        employees: [
          { active: true, id: 'preview-1', name: 'Lorem Ipsum', salary: 1 },
          { active: true, id: 'preview-2', name: 'Lorem Ipsum', salary: 2 },
          { active: true, id: 'preview-3', name: 'Lorem Ipsum', salary: 3 },
        ],
      },
    });

    runtime.set('employees', { employees: [{ name: 'Authored fixture' }] }, 'custom');
    expect(cloneJson(runtime.resolve(metadata, {}))).toEqual({
      employees: [{ name: 'Authored fixture' }],
    });

    runtime.smart('employees');
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'smart-custom',
      payload: {
        employees: [
          {
            active: true,
            id: 'preview-1',
            name: 'Authored fixture',
            salary: 1,
          },
        ],
      },
    });
  });

  /** Keeps fabricated image sources offline while preserving ordinary URL fixture semantics. */
  it('uses an authored fallback instead of requesting a generated avatar asset', () => {
    const runtime = evaluateDataRuntime();
    const shape = {
      fields: {
        avatarUrl: { kind: 'string' },
        documentationUrl: { kind: 'string' },
      },
      kind: 'object',
    };

    expect(cloneJson(runtime.generate(shape))).toEqual({
      avatarUrl: '',
      documentationUrl: 'https://example.com/preview/1',
    });
  });

  /** Persists one shared sample policy while leaving user-authored payload cardinality untouched. */
  it('defaults generated lists to three and lets the user resize only generated fixtures', () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'projects',
      kind: 'rest',
      label: 'GET /projects',
      shape: {
        items: { fields: { id: { kind: 'string' } }, kind: 'object' },
        kind: 'array',
      },
    };

    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([
      { id: 'preview-1' },
      { id: 'preview-2' },
      { id: 'preview-3' },
    ]);
    expect(runtime.listSampleCount()).toBe(3);
    expect(runtime.setListSampleCount(5)).toBe(true);
    expect(cloneJson(runtime.resolve(metadata, []))).toHaveLength(5);
    expect(runtime.generatedCacheState()).toEqual({ hookResets: 1, resolverProps: 0 });

    runtime.set('projects', [{ id: 'authored-only' }], 'custom');
    expect(runtime.setListSampleCount(2)).toBe(true);
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([{ id: 'authored-only' }]);
  });

  /** Keeps sibling collections dormant until the target-path Smart frontier selects the request. */
  it('starts authored-page corridor arrays empty and opens one item through Smart fill', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    const metadata = {
      id: 'meeting-list',
      kind: 'graphql',
      label: 'MeetingList',
      shape: {
        fields: {
          meetings: {
            items: {
              fields: { id: { kind: 'string' }, status: { kind: 'string' } },
              kind: 'object',
            },
            kind: 'array',
          },
        },
        kind: 'object',
      },
    };

    expect(cloneJson(runtime.resolve(metadata, {}))).toEqual({ meetings: [] });
    expect(runtime.smartReachability('page:Target')).toBe(true);
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      payload: { meetings: [{ id: 'preview-1', status: 'ACTIVE' }] },
    });
  });

  /** Fills only the table-bound array and keeps exact filter literals to one diverse exemplar. */
  it('uses the neural residual to fill compiler-rendered GraphQL table rows in the page corridor', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:DirectorChangeLogPanel', 'authored-page');
    const source = `
      query DirectorPageDirector {
        director {
          userActivities { eventType date appointmentDirectorType }
          auditLogs { id message }
        }
      }
    `;
    const document = graphqlOperationDocument('DirectorPageDirector', source);
    runtime.registerGraphqlDemand(
      document,
      [
        'data.director.userActivities.[]',
        'data.director.userActivities.[].appointmentDirectorType',
        'data.director.userActivities.[].date',
        'data.director.userActivities.[].eventType',
      ],
      [
        {
          path: 'data.director.userActivities.[].eventType',
          value: 'directorcompensationdecisionevent',
        },
      ],
    );
    const shape = runtime.inferGraphql(source, 'DirectorPageDirector');
    const metadata = {
      id: 'director-page',
      kind: 'graphql',
      label: 'DirectorPageDirector',
      operationName: 'DirectorPageDirector',
      shape,
    };

    expect(cloneJson(runtime.resolve(metadata, {}))).toEqual({
      director: {
        auditLogs: [],
        userActivities: [
          {
            appointmentDirectorType: 'PREVIEW',
            date: '2026-01-15T09:00:00.000Z',
            eventType: 'directorcompensationdecisionevent',
          },
          {
            appointmentDirectorType: 'PREVIEW',
            date: '2026-01-16T09:00:00.000Z',
            eventType: 'PREVIEW',
          },
          {
            appointmentDirectorType: 'PREVIEW',
            date: '2026-01-17T09:00:00.000Z',
            eventType: 'PREVIEW',
          },
        ],
      },
    });
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      renderedCollectionRecommendation: {
        candidateId: 'configured-samples',
        collectionPaths: ['data.director.userActivities.[]'],
        neuralResidual: {
          holeKind: 'rendered-empty-collection-data',
          score: 0.5,
          version: 4,
        },
        rowCount: 3,
      },
    });
    expect(runtime.setListSampleCount(5)).toBe(true);
    const resized = cloneJson(runtime.resolve(metadata, {})) as {
      director: { auditLogs: unknown[]; userActivities: unknown[] };
    };
    expect(resized.director.auditLogs).toEqual([]);
    expect(resized.director.userActivities).toHaveLength(5);
    expect(
      (resized.director.userActivities as { eventType: string }[]).filter(
        ({ eventType }) => eventType !== 'directorcompensationdecisionevent',
      ),
    ).toHaveLength(4);
  });

  /** Places alternative renderer discriminator values in separate rows instead of overwriting row 0. */
  it('covers every compiler-proven table branch with a distinct generated row', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:HistoryPanel', 'authored-page');
    const source = `
      query HistoryPanel {
        history { events { eventType date } }
      }
    `;
    const document = graphqlOperationDocument('HistoryPanel', source);
    runtime.registerGraphqlDemand(
      document,
      [
        'data.history.events.[]',
        'data.history.events.[].date',
        'data.history.events.[].eventType',
      ],
      ['appointed', 'ended', 'co-ceo'].map((value) => ({
        path: 'data.history.events.[].eventType',
        value,
      })),
    );
    const shape = runtime.inferGraphql(source, 'HistoryPanel');
    const metadata = {
      id: 'history-panel',
      kind: 'graphql',
      label: 'HistoryPanel',
      operationName: 'HistoryPanel',
      shape,
    };

    const payload = cloneJson(runtime.resolve(metadata, {})) as {
      history: { events: { eventType: string }[] };
    };

    expect(payload.history.events.map(({ eventType }) => eventType)).toEqual([
      'appointed',
      'ended',
      'co-ceo',
    ]);
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      renderedCollectionRecommendation: {
        rowCount: 3,
      },
    });
  });

  // prettier-ignore
  it.each([['authored-page', undefined, 'corridor-auto', []], ['file-components', undefined, 'auto', ['value', 'value', 'value']], ['file-components', 'page:Target', 'corridor-auto', []]])('uses %s with active key %s', (scenario, activeKey, profile, payload) => {
    const runtime = evaluateDataRuntime(undefined, activeKey, scenario);
    const metadata: unknown = JSON.parse('{"id":"profile-race","kind":"graphql","label":"ProfileRace","shape":{"items":{"kind":"string"},"kind":"array"}}');
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(payload);
    expect(runtime.requests()[0]).toMatchObject({ autoPayloadProfile: profile });
  });

  /** Opens an unknown list conservatively only after the user/frontier selects its request. */
  it('uses neutral unknown items for Smart and Lorem while corridor Auto remains empty', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    const metadata = {
      id: 'unknown-list',
      kind: 'graphql',
      label: 'UnknownList',
      shape: { items: { kind: 'unknown' }, kind: 'array' },
    };

    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([]);
    runtime.smart('unknown-list');
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([{}]);
    runtime.lorem('unknown-list');
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([{}, {}, {}]);
  });

  /** Prevents cached gallery samples from leaking into an active root-to-target corridor. */
  it('invalidates inferred payload cache entries when the generation profile changes', () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'profile-sensitive-list',
      kind: 'graphql',
      label: 'ProfileSensitiveList',
      shape: { items: { kind: 'string' }, kind: 'array' },
    };

    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(['value', 'value', 'value']);
    runtime.target('page:Target');
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([]);
    runtime.target(undefined);
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(['value', 'value', 'value']);
  });

  /** Uses compact field keys for Auto text while leaving deliberate Lorem generation explicit. */
  it('keeps generated display strings tied to their bounded response keys', () => {
    const runtime = evaluateDataRuntime();
    const longKey = 'thisFieldNameWouldOtherwiseExpandTheEntireCard';

    const payload = cloneJson(
      runtime.resolve(
        {
          id: 'compact-text',
          kind: 'graphql',
          label: 'CompactTextQuery',
          shape: {
            fields: {
              address: { kind: 'string' },
              description: { kind: 'string' },
              [longKey]: { kind: 'string' },
            },
            kind: 'object',
          },
        },
        {},
      ),
    );

    expect(payload).toEqual({
      address: 'address',
      description: 'description',
      [longKey]: `${longKey.slice(0, 31)}…`,
    });
  });

  /**
   * Keeps weak field-name evidence conservative so Smart Fill does not enter unrelated page,
   * collection, or aggregate branches merely to make a payload look populated.
   */
  it('materializes weak semantic fields without inventing unsafe records or page numbers', () => {
    const runtime = evaluateDataRuntime();
    const payload = cloneJson(
      runtime.resolve(
        {
          id: 'weak-semantics',
          kind: 'graphql',
          label: 'WeakSemanticsQuery',
          shape: {
            fields: {
              called: { kind: 'unknown' },
              currentPage: { kind: 'unknown' },
              initialPage: { kind: 'unknown' },
              metadata: { fields: {}, kind: 'object' },
              results: { kind: 'unknown' },
              siblingItems: { items: { kind: 'unknown' }, kind: 'array' },
              sum: { kind: 'unknown' },
              title: { fields: {}, kind: 'object' },
              totalSum: { kind: 'number' },
            },
            kind: 'object',
          },
        },
        {},
      ),
    );

    expect(payload).toEqual({
      called: false,
      currentPage: 1,
      initialPage: 'initialPage',
      metadata: {},
      results: [],
      siblingItems: [{}, {}, {}],
      sum: 0,
      title: 'title',
      totalSum: 0,
    });
  });

  /** Verifies seed-only undefined values use the same field semantics as compiler descriptors. */
  it('does not classify every Page-suffixed seed field as a pagination number', () => {
    const runtime = evaluateDataRuntime();
    const payload = cloneJson(
      runtime.resolve(
        {
          id: 'seed-semantics',
          kind: 'graphql',
          label: 'SeedSemanticsQuery',
        },
        {
          called: undefined,
          currentPage: undefined,
          initialPage: undefined,
          sum: undefined,
        },
      ),
    );

    expect(payload).toEqual({ called: false, currentPage: 1, initialPage: 'initialPage', sum: 0 });
  });

  /** Reuses an unchanged response object so application memo/effect dependencies can settle. */
  it('keeps one stable payload identity for an unchanged request variant', () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'stable-company',
      kind: 'graphql',
      label: 'StableCompanyQuery',
      shape: {
        fields: { company: { fields: { id: { kind: 'string' } }, kind: 'object' } },
        kind: 'object',
      },
    };
    const requestContext = {
      body: { companyId: '1' },
      rawUrl: 'graphql://StableCompanyQuery',
    };

    const first = runtime.resolve(metadata, {}, requestContext);
    const second = runtime.resolve(metadata, {}, requestContext);

    expect(second).toBe(first);
  });

  /** Keeps disruptive lifecycle flags inactive while opening a statically selected access path. */
  it('generates least-disruptive semantic booleans for a normal page corridor', () => {
    const runtime = evaluateDataRuntime();
    const payload = cloneJson(
      runtime.resolve(
        {
          id: 'company-shell',
          kind: 'graphql',
          label: 'CompanyShellQuery',
          shape: {
            fields: {
              hasOwnerAccess: { kind: 'boolean' },
              isDeletionRequested: { kind: 'boolean' },
              isLoading: { kind: 'boolean' },
              isOwner: { kind: 'boolean' },
              shouldAuthenticateTwoFactor: { kind: 'boolean' },
              unknownFlag: { kind: 'boolean' },
            },
            kind: 'object',
          },
        },
        {},
      ),
    );

    expect(payload).toEqual({
      hasOwnerAccess: true,
      isDeletionRequested: false,
      isLoading: false,
      isOwner: true,
      shouldAuthenticateTwoFactor: false,
      unknownFlag: false,
    });
  });

  /** Opens one data-discriminated role branch instead of exhausting an all-false dispatcher. */
  it('selects one non-disruptive sibling role tied to its response container', () => {
    const runtime = evaluateDataRuntime();
    const payload = cloneJson(
      runtime.resolve(
        {
          id: 'active-partner',
          kind: 'graphql',
          label: 'ActivePartnerQuery',
          shape: {
            fields: {
              activeLegalPartner: {
                fields: {
                  isDeleted: { kind: 'boolean' },
                  isLegalServicePartner: { kind: 'boolean' },
                  isTaxServicePartner: { kind: 'boolean' },
                  name: { kind: 'string' },
                },
                kind: 'object',
              },
              user: {
                fields: { isLegalPartnerStaff: { kind: 'boolean' } },
                kind: 'object',
              },
            },
            kind: 'object',
          },
        },
        {},
      ),
    );

    expect(payload).toEqual({
      activeLegalPartner: {
        isDeleted: false,
        isLegalServicePartner: true,
        isTaxServicePartner: false,
        name: 'name',
      },
      user: { isLegalPartnerStaff: false },
    });
  });

  /** Aligns an unambiguous generated entity ID while preserving an explicit mismatch scenario. */
  it('satisfies GraphQL route identity guards without asking for a generated ID', () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'company-shell',
      kind: 'graphql',
      label: 'CompanyShellQuery',
      shape: {
        fields: {
          companyWithDeletionStatus: {
            fields: { id: { kind: 'string' }, name: { kind: 'string' } },
            kind: 'object',
          },
        },
        kind: 'object',
      },
    };
    const requestContext = {
      body: { companyId: '42' },
      rawUrl: 'graphql://CompanyShellQuery',
    };

    expect(cloneJson(runtime.resolve(metadata, {}, requestContext))).toEqual({
      companyWithDeletionStatus: { id: '42', name: 'name' },
    });
    runtime.set(
      'company-shell',
      { companyWithDeletionStatus: { id: 'intentional-mismatch', name: 'Error scenario' } },
      'custom',
    );
    expect(cloneJson(runtime.resolve(metadata, {}, requestContext))).toEqual({
      companyWithDeletionStatus: { id: 'intentional-mismatch', name: 'Error scenario' },
    });
  });

  /** Reports only newly applied payload shapes so corridor convergence avoids stable remount loops. */
  it('settles repeated corridor Smart fill for the same request shape', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    runtime.resolve(
      {
        id: 'profile',
        kind: 'rest',
        label: 'Profile',
        shape: { fields: { name: { kind: 'string' } }, kind: 'object' },
      },
      {},
    );

    expect(runtime.smartReachability('page:Target')).toBe(true);
    expect(runtime.smartReachability('page:Target')).toBe(false);
  });

  /** Opens login and role booleans that are semantically required by the selected page path. */
  it('guides Smart payload roles toward the selected application corridor', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    runtime.resolve(
      {
        id: 'staff-context',
        kind: 'graphql',
        label: 'StaffContext',
        shape: {
          fields: {
            user: {
              fields: {
                hasConcurrentSession: { kind: 'boolean' },
                isAuthenticated: { kind: 'boolean' },
                isLegalPartnerStaff: { kind: 'boolean' },
                isStaff: { kind: 'boolean' },
                isStaffLoading: { kind: 'boolean' },
                isSuperstaff: { kind: 'boolean' },
                shouldAuthenticateTwoFactor: { kind: 'boolean' },
              },
              kind: 'object',
            },
          },
          kind: 'object',
        },
      },
      {},
    );

    expect(
      runtime.smartReachability('page:Target', {
        applicationPath: ['StaffAppEntry', 'PartnerStaffApp', 'TargetPage'],
      }),
    ).toBe(true);
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      payload: {
        user: {
          hasConcurrentSession: false,
          isAuthenticated: true,
          isLegalPartnerStaff: true,
          isStaff: true,
          isStaffLoading: false,
          isSuperstaff: false,
          shouldAuthenticateTwoFactor: false,
        },
      },
    });
  });

  /** Does not mistake a page's subject for the current user role while retaining shell role evidence. */
  it('requires every compound role word from an application identity boundary', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    runtime.resolve(
      {
        id: 'owner-context',
        kind: 'graphql',
        label: 'OwnerContext',
        shape: {
          fields: {
            company: {
              fields: {
                hasOwnerAccess: { kind: 'boolean' },
                isOwner: { kind: 'boolean' },
              },
              kind: 'object',
            },
            user: {
              fields: {
                isAuthenticated: { kind: 'boolean' },
                isLegalPartnerStaff: { kind: 'boolean' },
              },
              kind: 'object',
            },
          },
          kind: 'object',
        },
      },
      {},
    );

    runtime.smartReachability('page:Target', {
      applicationPath: [
        'ApplicationRoot',
        'CompanyOwnerApp',
        'LegalPartnerSelectPage',
        'CompanyOwnerBreadcrumb',
      ],
    });

    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      payload: {
        company: { hasOwnerAccess: true, isOwner: true },
        user: { isAuthenticated: true, isLegalPartnerStaff: false },
      },
    });
  });

  /** Keeps authentication false when the inspected target is the login corridor itself. */
  it('does not bypass an explicitly selected login route', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    runtime.resolve(
      {
        id: 'login-context',
        kind: 'graphql',
        shape: {
          fields: { user: { fields: { isAuthenticated: { kind: 'boolean' } }, kind: 'object' } },
          kind: 'object',
        },
      },
      {},
    );

    runtime.smartReachability('page:Target', { applicationPath: ['App', 'LoginPage'] });
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      payload: { user: { isAuthenticated: false } },
    });
  });

  /** Deterministic background convergence never rewrites an explicit payload scenario. */
  it('preserves user payloads during automatic page-path convergence', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    runtime.resolve(
      {
        id: 'profile',
        kind: 'graphql',
        label: 'Profile',
        shape: { fields: { name: { kind: 'string' } }, kind: 'object' },
      },
      {},
    );
    runtime.set('profile', { name: 'Authored fixture' }, 'custom');

    expect(runtime.smartReachability('page:Target', { preserveUserValues: true })).toBe(false);
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'custom',
      payload: { name: 'Authored fixture' },
    });
  });

  /** Extends an earlier automatic Smart fixture when a later render reads additional fields. */
  it('completes stale Smart payloads while preserving user payload policy', () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Target');
    const metadata = {
      id: 'progressive-profile',
      kind: 'graphql',
      label: 'Progressive profile',
      shape: { fields: { name: { kind: 'string' } }, kind: 'object' },
    };
    runtime.resolve(metadata, {});
    expect(runtime.smartReachability('page:Target', { preserveUserValues: true })).toBe(true);

    runtime.resolve(
      {
        ...metadata,
        shape: {
          fields: {
            name: { kind: 'string' },
            profile: { fields: { id: { kind: 'string' } }, kind: 'object' },
          },
          kind: 'object',
        },
      },
      {},
    );

    expect(runtime.smartReachability('page:Target', { preserveUserValues: true })).toBe(true);
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'smart',
      payload: { profile: { id: 'preview-1' } },
    });
  });

  /** Returns a local Response-like object and never invokes the captured backend transport. */
  it('serves compiler-instrumented REST requests entirely in memory', async () => {
    let nativeFetchCalls = 0;
    const runtime = evaluateDataRuntime(() => {
      nativeFetchCalls += 1;
      throw new Error('backend transport must remain disabled');
    });

    const response = await runtime.fetch('/api/employees', undefined, {
      evidence: 'TypeScript: Employee[]',
      id: 'rest-employees',
      kind: 'rest',
      method: 'GET',
      shape: {
        items: { fields: { id: { kind: 'string' } }, kind: 'object' },
        kind: 'array',
      },
      url: '/api/employees',
    });

    await expect(response.json()).resolves.toEqual([
      { id: 'preview-1' },
      { id: 'preview-2' },
      { id: 'preview-3' },
    ]);
    expect(nativeFetchCalls).toBe(0);
  });

  /** Catches custom fetch clients on non-/api relative routes while retaining local fixture reads. */
  it('treats arbitrary relative runtime fetch routes as virtual backend requests', async () => {
    let nativeFetchCalls = 0;
    const runtime = evaluateDataRuntime(() => {
      nativeFetchCalls += 1;
      return { json: () => Promise.resolve({ fixture: true }) };
    });

    const backendResponse = await runtime.fetch('/v1/employees');
    await expect(backendResponse.json()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'preview-1' })]),
    );
    const fixtureResponse = await runtime.fetch('./fixtures/employees.json');
    await expect(fixtureResponse.json()).resolves.toEqual({ fixture: true });
    expect(nativeFetchCalls).toBe(1);
  });

  /** Infers serialized GraphQL selections for non-Apollo fetch-based clients. */
  it('builds GraphQL-over-HTTP data from aliases, lists, and fragments', async () => {
    const runtime = evaluateDataRuntime();
    const response = await runtime.fetch('/graphql', {
      body: JSON.stringify({
        operationName: 'Employees',
        query: `query Employees { staff: employees { id ...EmployeeName } }\nfragment EmployeeName on Employee { name isActive }`,
      }),
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        staff: [
          { id: 'preview-1', isActive: true, name: 'name' },
          { id: 'preview-2', isActive: true, name: 'name' },
          { id: 'preview-3', isActive: true, name: 'name' },
        ],
      },
    });
  });

  /** Recognizes a plural noun before a GraphQL qualifier such as `ForCompanyCreate`. */
  it('generates arrays for qualified plural GraphQL field names', async () => {
    const runtime = evaluateDataRuntime();
    const response = await runtime.fetch('/graphql', {
      body: JSON.stringify({
        operationName: 'CompanyCreateContext',
        query: `query CompanyCreateContext {
          legalPartnersForCompanyCreate { id name isRecommendedForCompanyCreate }
        }`,
      }),
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        legalPartnersForCompanyCreate: [
          { id: 'preview-1', isRecommendedForCompanyCreate: false, name: 'name' },
          { id: 'preview-2', isRecommendedForCompanyCreate: false, name: 'name' },
          { id: 'preview-3', isRecommendedForCompanyCreate: false, name: 'name' },
        ],
      },
    });
  });

  /** Recognizes a plural nested relation before `Under`, as used by investor review payloads. */
  it('generates arrays for plural GraphQL fields qualified by under', async () => {
    const runtime = evaluateDataRuntime();
    const response = await runtime.fetch('/graphql', {
      body: JSON.stringify({
        operationName: 'InvestorFeeds',
        query: `query InvestorFeeds {
          vcmInvestorCompanyFeeds {
            ir { investorsUnderIrReview { name } }
          }
        }`,
      }),
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        vcmInvestorCompanyFeeds: Array.from({ length: 3 }, () => ({
          ir: {
            investorsUnderIrReview: Array.from({ length: 3 }, () => ({ name: 'name' })),
          },
        })),
      },
    });
  });

  /** Keeps a pagination wrapper object-shaped even when its GraphQL field name ends in `List`. */
  it('distinguishes a paginated list wrapper from its nested object collection', async () => {
    const runtime = evaluateDataRuntime();
    const response = await runtime.fetch('/graphql', {
      body: JSON.stringify({
        operationName: 'RightToConsentOrConsultList',
        query: `query RightToConsentOrConsultList {
          rightToConsentOrConsultList {
            pageInfo { count hasNext }
            objectList { id title }
          }
        }`,
      }),
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        rightToConsentOrConsultList: {
          objectList: [
            { id: 'preview-1', title: 'title' },
            { id: 'preview-2', title: 'title' },
            { id: 'preview-3', title: 'title' },
          ],
          pageInfo: { count: 1, hasNext: false },
        },
      },
    });
  });

  /** Keeps a compact list wrapper object-shaped when only its canonical collection was selected. */
  it('does not turn an objectList wrapper into an outer array without pageInfo', async () => {
    const runtime = evaluateDataRuntime();
    const response = await runtime.fetch('/graphql', {
      body: JSON.stringify({
        operationName: 'OwnerMeetingList',
        query: `query OwnerMeetingList { meetingList { objectList { id status } } }`,
      }),
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        meetingList: {
          objectList: [
            { id: 'preview-1', status: 'ACTIVE' },
            { id: 'preview-2', status: 'ACTIVE' },
            { id: 'preview-3', status: 'ACTIVE' },
          ],
        },
      },
    });
  });

  /** Supports Axios-created instances that reach the browser through XMLHttpRequest. */
  it('completes XMLHttpRequest clients with the same generated registry payload', async () => {
    const runtime = evaluateDataRuntime();
    const request = runtime.createXhr();
    request.responseType = 'json';
    const completed = new Promise<void>((resolve) => {
      request.onloadend = () => {
        resolve();
      };
    });
    request.open('GET', 'https://api.example.com/employees');
    request.send();
    await completed;

    expect(request.status).toBe(200);
    expect(cloneJson(request.response)).toEqual([
      {
        active: true,
        description: 'description',
        id: 'preview-1',
        name: 'name',
      },
      {
        active: true,
        description: 'description',
        id: 'preview-2',
        name: 'name',
      },
      {
        active: true,
        description: 'description',
        id: 'preview-3',
        name: 'name',
      },
    ]);
  });

  /** Retains REST resources and applies POST, PATCH, and DELETE changes to later GET requests. */
  it('acts as a stateful in-memory CRUD backend for one REST resource', async () => {
    const runtime = evaluateDataRuntime();
    const collectionMetadata = {
      evidence: 'TypeScript: Employee[]',
      id: 'get-employees',
      kind: 'rest',
      method: 'GET',
      shape: {
        items: {
          fields: {
            active: { kind: 'boolean' },
            id: { kind: 'string' },
            name: { kind: 'string' },
          },
          kind: 'object',
        },
        kind: 'array',
      },
      url: '/api/employees',
    };
    await runtime.fetch('/api/employees', undefined, collectionMetadata);
    const mutationShape = {
      fields: {
        active: { kind: 'boolean' },
        id: { kind: 'string' },
        name: { kind: 'string' },
      },
      kind: 'object',
    };

    const createdResponse = await runtime.fetch(
      '/api/employees',
      { body: JSON.stringify({ name: 'Created employee' }), method: 'POST' },
      { ...collectionMetadata, id: 'create-employee', method: 'POST', shape: mutationShape },
    );
    await expect(createdResponse.json()).resolves.toMatchObject({
      id: 'preview-4',
      name: 'Created employee',
    });
    await runtime.fetch(
      '/api/employees',
      { body: JSON.stringify({ name: 'Created employee' }), method: 'POST' },
      { ...collectionMetadata, id: 'create-employee', method: 'POST', shape: mutationShape },
    );
    const replayedCollection = await (
      await runtime.fetch('/api/employees', undefined, collectionMetadata)
    ).json();
    expect(replayedCollection).toHaveLength(4);

    await runtime.fetch(
      '/api/employees/preview-4',
      { body: JSON.stringify({ name: 'Edited employee' }), method: 'PATCH' },
      {
        ...collectionMetadata,
        id: 'edit-employee',
        method: 'PATCH',
        shape: mutationShape,
        url: '/api/employees/preview-4',
      },
    );
    const editedCollection = await (
      await runtime.fetch('/api/employees', undefined, collectionMetadata)
    ).json();
    expect(editedCollection).toEqual(
      expect.arrayContaining([{ active: true, id: 'preview-4', name: 'Edited employee' }]),
    );

    await runtime.fetch(
      '/api/employees/preview-4',
      { method: 'DELETE' },
      {
        ...collectionMetadata,
        id: 'delete-employee',
        method: 'DELETE',
        shape: mutationShape,
        url: '/api/employees/preview-4',
      },
    );
    const deletedCollection = await (
      await runtime.fetch('/api/employees', undefined, collectionMetadata)
    ).json();
    expect(deletedCollection).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'preview-4' })]),
    );
  });

  /** Lets the Inspector select empty and HTTP-error outcomes without enabling real transport. */
  it('serves editable response scenarios from the same request registry', async () => {
    let nativeFetchCalls = 0;
    const runtime = evaluateDataRuntime(() => {
      nativeFetchCalls += 1;
      throw new Error('backend transport must remain disabled');
    });
    const metadata = {
      id: 'scenario-employees',
      kind: 'rest',
      method: 'GET',
      shape: { items: { kind: 'string' }, kind: 'array' },
      url: '/api/employees',
    };
    await runtime.fetch('/api/employees', undefined, metadata);

    runtime.scenario('scenario-employees', { latencyMs: 0, mode: 'empty', status: 200 });
    await expect(
      (await runtime.fetch('/api/employees', undefined, metadata)).json(),
    ).resolves.toEqual([]);

    runtime.scenario('scenario-employees', { latencyMs: 0, mode: 'error', status: 503 });
    const failed = await runtime.fetch('/api/employees', undefined, metadata);
    expect(failed.ok).toBe(false);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({ preview: true, status: 503 });
    expect(nativeFetchCalls).toBe(0);
  });

  /** Holds a loading checkpoint without leaking it into persisted user response scenarios. */
  it('releases a temporal pending response when the user resumes with a normal scenario', async () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'temporal-cards',
      kind: 'rest',
      method: 'GET',
      shape: { fields: { id: { kind: 'string' } }, kind: 'object' },
      url: '/api/cards',
    };
    await runtime.fetch('/api/cards', undefined, metadata);
    runtime.temporalScenario('temporal-cards');
    expect(runtime.scenarios()).toEqual({});

    let settled = false;
    const held = runtime.fetch('/api/cards', undefined, metadata).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    runtime.scenario('temporal-cards', { latencyMs: 0, mode: 'success', status: 200 });
    const response = await held;
    expect(response.status).toBe(200);
    expect(settled).toBe(true);
  });

  it('holds a transient target request before its first loading render settles', async () => {
    const runtime = evaluateDataRuntime(undefined, 'page:Skeleton', 'authored-page', true);
    const metadata = {
      id: 'initial-skeleton-request',
      kind: 'rest',
      method: 'GET',
      shape: { fields: { id: { kind: 'string' } }, kind: 'object' },
      url: '/api/skeleton',
    };
    let settled = false;
    const held = runtime.fetch('/api/skeleton', undefined, metadata).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      virtualBackend: { mode: 'pending' },
    });

    runtime.scenario('initial-skeleton-request', {
      latencyMs: 0,
      mode: 'success',
      status: 200,
    });
    expect((await held).status).toBe(200);
    expect(settled).toBe(true);
  });

  it('holds and releases XMLHttpRequest consumers with the same request time contract', async () => {
    const runtime = evaluateDataRuntime();
    const initial = runtime.createXhr();
    initial.open('GET', '/api/temporal-xhr');
    initial.send();
    await Promise.resolve();
    await Promise.resolve();
    const request = (
      runtime.requests() as readonly { readonly id: string; readonly url: string }[]
    ).find((record) => record.url === '/api/temporal-xhr');
    if (request === undefined) throw new Error('Expected the temporal XHR request to register.');
    runtime.temporalScenario(request.id);

    let loaded = false;
    const held = runtime.createXhr();
    held.onloadend = () => {
      loaded = true;
    };
    held.open('GET', '/api/temporal-xhr');
    held.send();
    await Promise.resolve();
    await Promise.resolve();
    expect(loaded).toBe(false);

    runtime.scenario(request.id, { latencyMs: 0, mode: 'success', status: 200 });
    await Promise.resolve();
    await Promise.resolve();
    expect(loaded).toBe(true);
    expect(held.status).toBe(200);
  });

  /** Rejects direct Axios instrumentation with a familiar local error object for error scenarios. */
  it('maps virtual backend failures to Axios-compatible rejections', async () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'axios-profile',
      kind: 'rest',
      method: 'GET',
      shape: { fields: { id: { kind: 'string' } }, kind: 'object' },
      url: '/api/profile',
    };
    await runtime.axios('GET', '/api/profile', [], metadata);
    runtime.scenario('axios-profile', { latencyMs: 0, mode: 'error', status: 401 });

    await expect(runtime.axios('GET', '/api/profile', [], metadata)).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 401 },
    });
  });

  /** Retains the inferred field template even when global Auto mode exposes an empty authored seed. */
  it('keeps a suggested payload and flattened property paths beside an empty seed', () => {
    const runtime = evaluateDataRuntime();
    const metadata = {
      id: 'profile',
      kind: 'rest',
      label: 'Profile',
      shape: {
        fields: {
          profile: {
            fields: { active: { kind: 'boolean' }, name: { kind: 'string' } },
            kind: 'object',
          },
        },
        kind: 'object',
      },
    };
    runtime.resolve(metadata, {});
    runtime.auto(false);

    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'seed',
      payload: {},
      suggestedPayload: { profile: { active: true, name: 'name' } },
    });
    expect(cloneJson(runtime.paths(metadata.shape))).toEqual(['profile.active', 'profile.name']);
  });
});

/** Creates the bounded DocumentNode evidence emitted by graphql-tag for one named query. */
function graphqlOperationDocument(operationName: string, source: string): object {
  return {
    definitions: [
      {
        kind: 'OperationDefinition',
        name: { value: operationName },
        selectionSet: { selections: [] },
      },
    ],
    loc: { source: { body: source } },
  };
}

/** Callable subset exposed from one generated-runtime VM fixture. */
interface EvaluatedDataRuntime {
  readonly auto: (enabled: boolean) => void;
  readonly axios: (
    method: string,
    url: string,
    extraArguments: readonly unknown[],
    metadata: unknown,
  ) => Promise<unknown>;
  readonly createXhr: () => {
    onloadend: (() => void) | null;
    open(method: string, url: string): void;
    readonly response: unknown;
    responseType: string;
    send(): void;
    readonly status: number;
  };
  readonly fetch: (
    input: string,
    init?: unknown,
    metadata?: unknown,
  ) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;
  readonly generate: (shape: unknown) => unknown;
  readonly generatedCacheState: () => {
    readonly hookResets: number;
    readonly resolverProps: number;
  };
  readonly inferGraphql: (source: string, operationName: string) => unknown;
  readonly lorem: (id: string) => void;
  readonly listSampleCount: () => number;
  readonly paths: (shape: unknown) => readonly string[];
  readonly registerGraphqlDemand: (
    document: object,
    paths: readonly string[],
    literalDemands: readonly unknown[],
  ) => unknown;
  readonly requests: () => readonly unknown[];
  readonly resolve: (metadata: unknown, seed: unknown, requestContext?: unknown) => unknown;
  readonly scenario: (id: string, scenario: unknown) => void;
  readonly scenarios: () => Readonly<Record<string, unknown>>;
  readonly set: (id: string, payload: unknown, mode: string) => void;
  readonly setListSampleCount: (value: number) => boolean;
  readonly smart: (id: string) => void;
  readonly target: (reachabilityKey?: string) => void;
  readonly temporalScenario: (id: string) => void;
  readonly smartReachability: (
    reachabilityKey: string,
    options?: {
      readonly applicationPath?: readonly string[];
      readonly preserveUserValues?: boolean;
    },
  ) => boolean;
}

/** Evaluates the generated source with only its documented lexical dependencies. */
function evaluateDataRuntime(
  nativeFetch?: (...arguments_: unknown[]) => unknown,
  activeTargetReachabilityKey?: string,
  renderScenario = 'file-components',
  transientTarget = false,
): EvaluatedDataRuntime {
  const source = `
const previewHotRuntime = { inspectorNativeFetch: globalThis.__nativeFetch };
const previewInspectorSession = {
  activeTargetReachabilityKey: ${JSON.stringify(activeTargetReachabilityKey)},
  resolverPropsByExport: new Map([['GeneratedTarget', { items: [1, 2, 3] }]]),
};
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
let persistedState = {};
function readPersistedPreviewInspectorState() { return persistedState; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value, null, 2) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function schedulePreviewInspectorTreeRefresh() {}
function readPreviewInspectorRenderScenario() { return ${JSON.stringify(renderScenario)}; }
function shouldHoldPreviewInspectorNeuralTransientTargetRequest() {
  return ${JSON.stringify(transientTarget)};
}
let generatedRuntimeFallbackResetCount = 0;
function resetPreviewInspectorGeneratedRuntimeFallbackValues() {
  generatedRuntimeFallbackResetCount += 1;
}
${createPreviewGeneratedListRuntimeSource()}
${createPreviewInspectorDataRuntimeSource()}
${createPreviewInspectorNeuralResidualRuntimeSource()}
${createPreviewInspectorHookGraphqlRuntimeSource()}
globalThis.__dataRuntime = {
  auto: setPreviewInspectorDataAutoEnabled,
  axios: previewInspectorAxiosRequest,
  createXhr: () => new PreviewInspectorXmlHttpRequest(),
  fetch: previewInspectorFetch,
  generate: (shape) => generatePreviewInspectorDataValue(shape, '', 'smart'),
  generatedCacheState: () => ({
    hookResets: generatedRuntimeFallbackResetCount,
    resolverProps: previewInspectorSession.resolverPropsByExport.size,
  }),
  inferGraphql: inferPreviewInspectorGraphqlQueryShape,
  lorem: generatePreviewInspectorLoremPayload,
  listSampleCount: readPreviewInspectorDataListSampleCount,
  paths: readPreviewInspectorDataShapePaths,
  registerGraphqlDemand: registerPreviewInspectorGraphqlRenderPropUsage,
  requests: readPreviewInspectorDataRequests,
  resolve: resolvePreviewInspectorDataPayload,
  scenario: setPreviewInspectorVirtualBackendScenario,
  scenarios: serializePreviewInspectorVirtualBackendScenarios,
  set: setPreviewInspectorDataPayload,
  setListSampleCount: setPreviewInspectorDataListSampleCount,
  smart: smartFillPreviewInspectorDataPayload,
  smartReachability: smartFillPreviewInspectorDataPayloadsForReachability,
  target: (reachabilityKey) => {
    previewInspectorSession.activeTargetReachabilityKey = reachabilityKey;
  },
  temporalScenario: (id) => {
    initializePreviewInspectorVirtualBackendState();
    previewInspectorSession.temporalBackendScenarioOverrides.set(id, {
      latencyMs: 0,
      mode: 'pending',
      status: 200,
    });
  },
};`;
  const context = vm.createContext({
    URL,
    URLSearchParams,
    __nativeFetch: nativeFetch,
    location: { href: 'https://preview.invalid/' },
    queueMicrotask,
    setTimeout,
  });
  vm.runInContext(source, context);
  return context.__dataRuntime as EvaluatedDataRuntime;
}

/** Removes VM realm prototypes before structural assertions. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
