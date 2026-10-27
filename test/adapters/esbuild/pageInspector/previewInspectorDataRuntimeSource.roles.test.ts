/** Covers roles behavior for previewInspectorDataRuntimeSource. */
/** Verifies authored-source previewInspectorDataRuntimeSource invariants. */
import { describe, expect, it } from 'vitest';

import { cloneJson, evaluateDataRuntime } from './previewInspectorDataRuntimeSourceFixtures';

describe('Page Inspector data runtime source', () => {
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
      initialPage: 'Initial page',
      metadata: {},
      results: [],
      siblingItems: [{}, {}, {}],
      sum: 0,
      title: 'Title',
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

    expect(payload).toEqual({ called: false, currentPage: 1, initialPage: 'Initial page', sum: 0 });
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
        name: 'Name',
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
      companyWithDeletionStatus: { id: '42', name: 'Name' },
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
});
