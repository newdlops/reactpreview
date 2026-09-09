/** Verifies selection-shaped GraphQL hook recovery in the shared isolated fallback runtime. */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector runtime fallback Graphql', () => {
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

  /** Exact renderer literals must replace an incompatible scalar already returned by a query. */
  it('applies a render-prop literal demand to partial authored GraphQL data', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const document = {
      definitions: [
        {
          kind: 'OperationDefinition',
          selectionSet: {
            selections: [
              {
                kind: 'Field',
                name: { value: 'documents' },
                selectionSet: {
                  selections: [{ kind: 'Field', name: { value: 'objectList' } }],
                },
              },
            ],
          },
        },
      ],
    };
    fixture.api.registerGraphql(
      document,
      ['@connection.objectList.[]'],
      [{ path: '@connection.objectList.[].status', value: 'requested' }],
    );
    const authored = {
      data: { documents: { objectList: [{ status: 'ACTIVE' }] } },
      fallback: null,
      loading: false,
      refetch: () => undefined,
    };

    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ data: {}, fallback: null, loading: false, refetch: () => undefined }),
      {
        ...createMetadata(),
        requiredPaths: ['data', 'fallback', 'loading', 'refetch()'],
      },
      () => document,
    ) as typeof authored;

    expect(resolved.data.documents.objectList[0]?.status).toBe('requested');
    expect(authored.data.documents.objectList[0]?.status).toBe('ACTIVE');
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
});
