/** Exercises generated payload state without importing a target project's React runtime. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';

describe('Page Inspector data runtime source', () => {
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
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([{}, {}]);
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

    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(['value', 'value']);
    runtime.target('page:Target');
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([]);
    runtime.target(undefined);
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(['value', 'value']);
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
      siblingItems: [{}, {}],
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

    await expect(response.json()).resolves.toEqual([{ id: 'preview-1' }, { id: 'preview-2' }]);
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
        ],
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
      id: 'preview-3',
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
    expect(replayedCollection).toHaveLength(3);

    await runtime.fetch(
      '/api/employees/preview-3',
      { body: JSON.stringify({ name: 'Edited employee' }), method: 'PATCH' },
      {
        ...collectionMetadata,
        id: 'edit-employee',
        method: 'PATCH',
        shape: mutationShape,
        url: '/api/employees/preview-3',
      },
    );
    const editedCollection = await (
      await runtime.fetch('/api/employees', undefined, collectionMetadata)
    ).json();
    expect(editedCollection).toEqual(
      expect.arrayContaining([{ active: true, id: 'preview-3', name: 'Edited employee' }]),
    );

    await runtime.fetch(
      '/api/employees/preview-3',
      { method: 'DELETE' },
      {
        ...collectionMetadata,
        id: 'delete-employee',
        method: 'DELETE',
        shape: mutationShape,
        url: '/api/employees/preview-3',
      },
    );
    const deletedCollection = await (
      await runtime.fetch('/api/employees', undefined, collectionMetadata)
    ).json();
    expect(deletedCollection).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'preview-3' })]),
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
  readonly lorem: (id: string) => void;
  readonly paths: (shape: unknown) => readonly string[];
  readonly requests: () => readonly unknown[];
  readonly resolve: (metadata: unknown, seed: unknown, requestContext?: unknown) => unknown;
  readonly scenario: (id: string, scenario: unknown) => void;
  readonly set: (id: string, payload: unknown, mode: string) => void;
  readonly smart: (id: string) => void;
  readonly target: (reachabilityKey?: string) => void;
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
): EvaluatedDataRuntime {
  const source = `
const previewHotRuntime = { inspectorNativeFetch: globalThis.__nativeFetch };
const previewInspectorSession = {
  activeTargetReachabilityKey: ${JSON.stringify(activeTargetReachabilityKey)},
};
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
let persistedState = {};
function readPersistedPreviewInspectorState() { return persistedState; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value, null, 2) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function schedulePreviewInspectorTreeRefresh() {}
${createPreviewInspectorDataRuntimeSource()}
globalThis.__dataRuntime = {
  auto: setPreviewInspectorDataAutoEnabled,
  axios: previewInspectorAxiosRequest,
  createXhr: () => new PreviewInspectorXmlHttpRequest(),
  fetch: previewInspectorFetch,
  lorem: generatePreviewInspectorLoremPayload,
  paths: readPreviewInspectorDataShapePaths,
  requests: readPreviewInspectorDataRequests,
  resolve: resolvePreviewInspectorDataPayload,
  scenario: setPreviewInspectorVirtualBackendScenario,
  set: setPreviewInspectorDataPayload,
  smart: smartFillPreviewInspectorDataPayload,
  smartReachability: smartFillPreviewInspectorDataPayloadsForReachability,
  target: (reachabilityKey) => {
    previewInspectorSession.activeTargetReachabilityKey = reachabilityKey;
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
