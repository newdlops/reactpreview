/** Prevents generated query lists from rejecting their own selected route identity. */
import { describe, expect, it } from 'vitest';
import { evaluateDataRuntime } from './previewInspectorDataRuntimeSourceFixtures';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('generated GraphQL route membership', () => {
  /** The delayed Apollo response must agree with the hook's immediate selection-shaped result. */
  it('retains route membership when the virtual backend response arrives and is read again', () => {
    const runtime = evaluateDataRuntime();
    const metadata = routeBackendMetadata();
    const context = {
      body: { companyId: 'company-7', irId: 'ir-3' },
      rawUrl: 'graphql://CompanyIrPage',
    };
    const first = runtime.resolve(metadata, {}, context) as {
      vcmIr: { id: string };
      vcmIrs: { id: string }[];
    };
    const second = runtime.resolve(metadata, {}, context);

    expect(first.vcmIr.id).toBe('ir-3');
    expect(first.vcmIrs.some((item) => item.id === 'ir-3')).toBe(true);
    expect(first.vcmIrs[1]?.id).not.toBe('ir-3');
    expect(second).toBe(first);
  });

  it.each(['custom', 'smart-custom'])(
    'keeps a %s payload as an exact intentional route mismatch',
    (mode) => {
      const runtime = evaluateDataRuntime();
      const metadata = routeBackendMetadata();
      const payload = { vcmIr: { id: 'authored' }, vcmIrs: [{ id: 'authored' }] };
      runtime.resolve(metadata, {}, { body: { irId: 'ir-3' } });
      runtime.set(metadata.id, payload, mode);
      expect(runtime.resolve(metadata, {}, { body: { irId: 'ir-3' } })).toEqual(payload);
    },
  );

  /** A declared Error object is shape evidence, not an actual failed transport response. */
  it('keeps a settled generated query out of the compiler-inferred error branch', () => {
    const fixture = createRouteFixture();
    const resolved = fixture.api.resolve(
      () => ({ loading: true, data: undefined }),
      () => ({
        data: {},
        error: { name: 'Error', message: 'Compiler shape' },
        fallback: { type: 'ErrorPage' },
      }),
      { ...createMetadata(), requiredPaths: ['loading', 'error', 'fallback', 'data.vcmIrs.[]'] },
      () => ({ loc: { source: { body: 'query Page { vcmIrs { id name } }' } } }),
      () => ({ variables: { irId: 'ir-3' } }),
    ) as { error: unknown; fallback: unknown; loading: boolean };

    expect(resolved.error).toBeNull();
    expect(resolved.fallback).toBeNull();
    expect(resolved.loading).toBe(false);
  });

  /** The same query returns a selected entity and the list used by its authored route guard. */
  it('keeps a generated selected entity inside its generated list', () => {
    const fixture = createRouteFixture();
    const document = {
      definitions: [{ kind: 'OperationDefinition', name: { value: 'CompanyIrPage' } }],
      loc: {
        source: {
          body: 'query CompanyIrPage($companyId: ID!, $irId: ID!) { vcmCompany { id } vcmIrs { id name } vcmIr { id name } }',
        },
      },
    };
    const resolved = fixture.api.resolve(
      () => ({ loading: true, data: undefined }),
      () => ({ data: { vcmIrs: [{ id: 'generated' }] } }),
      { ...createMetadata(), requiredPaths: ['data.vcmIrs.[]', 'data.vcmIr.id'] },
      () => document,
      () => ({ variables: { companyId: 'company-7', irId: 'ir-3' } }),
    ) as { data: { vcmCompany: { id: string }; vcmIr: { id: string }; vcmIrs: { id: string }[] } };

    expect(resolved.data.vcmCompany.id).toBe('company-7');
    expect(resolved.data.vcmIr.id).toBe('ir-3');
    expect(resolved.data.vcmIrs.some((item) => item.id === 'ir-3')).toBe(true);
    expect(resolved.data.vcmIrs[1]?.id).toBe('second-ir');
  });

  /** Generated identity alignment never mutates or replaces already usable application data. */
  it('preserves an authored query result whose list intentionally excludes the route', () => {
    const fixture = createRouteFixture();
    const data = {
      vcmIrs: [
        { id: 'different', name: 'Authored' },
        { id: 'other', name: 'Other' },
      ],
      vcmIr: { id: 'different', name: 'Authored' },
      vcmCompany: { id: 'authored-company' },
    };
    const real = {
      data,
      loading: false,
      error: null,
      fallback: null,
      networkStatus: 7,
      refetch: () => undefined,
    };
    const resolved = fixture.api.resolve(
      () => real,
      () => ({ data: {} }),
      { ...createMetadata(), requiredPaths: ['data.vcmIrs.[]', 'data.vcmIr.id'] },
      () => ({ loc: { source: { body: 'query Page { vcmIrs { id } vcmIr { id } }' } } }),
      () => ({ variables: { irId: 'ir-3' } }),
    );

    expect(resolved).toBe(real);
    expect(data.vcmIrs.map((item) => item.id)).toEqual(['different', 'other']);
  });
});

/** Minimal response schema shared by the initial and delayed selected-page requests. */
function routeBackendMetadata(): Record<string, unknown> & { id: string } {
  const entity = { kind: 'object', fields: { id: { kind: 'string' } } };
  return {
    id: 'company-ir-page',
    kind: 'graphql',
    operationName: 'CompanyIrPage',
    shape: {
      kind: 'object',
      fields: { vcmCompany: entity, vcmIr: entity, vcmIrs: { kind: 'array', items: entity } },
    },
  };
}

/** Reuses the production recovery pipeline with a selected-entity/list result shape. */
function createRouteFixture(): ReturnType<typeof createRuntimeFallbackFixture> {
  const fixture = createRuntimeFallbackFixture(true);
  fixture.evaluate(`
    inferPreviewInspectorGraphqlQueryShape = () => ({ kind: 'object', fields: {
      vcmCompany: { kind: 'object', fields: { id: { kind: 'string' } } },
      vcmIr: { kind: 'object', fields: { id: { kind: 'string' }, name: { kind: 'string' } } },
      vcmIrs: { kind: 'array', items: { kind: 'object', fields: { id: { kind: 'string' }, name: { kind: 'string' } } } },
    } });
    generatePreviewInspectorDataValue = () => ({
      vcmCompany: { id: 'generated-company' }, vcmIr: { id: 'generated-ir', name: 'Generated' },
      vcmIrs: [{ id: 'generated-ir', name: 'Generated' }, { id: 'second-ir', name: 'Second' }],
    });
  `);
  return fixture;
}
