import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';

describe('Preview Inspector GraphQL render-prop runtime', () => {
  it('expands one aliased connection root and overlays its exact generated status', () => {
    const runtime = createRuntime();
    const document = documentWithRoot('documents');
    runtime.register(
      document,
      ['@connection.objectList.[]'],
      [{ path: '@connection.objectList.[].status', value: 'requested' }],
    );

    expect(runtime.paths(document)).toEqual(['data.documents.objectList.[]']);
    expect(
      runtime.overlay(
        { data: { documents: { objectList: [{ status: 'ACTIVE' }] } } },
        () => document,
      ),
    ).toMatchObject({ data: { documents: { objectList: [{ status: 'requested' }] } } });
  });

  it('routes fixed renderer collection demand to its exact GraphQL fallback', () => {
    const runtime = createRuntime();
    const document = personalDataHandlersDocument();
    const renderer = (): undefined => undefined;
    const factoryResult = [renderer, () => undefined] as const;

    expect(runtime.associate(factoryResult, document)).toBe(factoryResult);
    expect(runtime.usage(renderer, ['data.vcUserRelations.[]'], [])).toBe(renderer);
    expect(runtime.paths(document)).toEqual(['data.vcUserRelations.[]']);

    const fallback = runtime.fallback(
      { data: {} },
      () => document,
      () => ({ variables: { ventureCapitalId: 'vc-1' } }),
    ) as {
      data: {
        vcUserRelations: { id: string; isPersonalDataHandler: boolean }[];
      };
    };

    expect(Array.isArray(fallback.data.vcUserRelations)).toBe(true);
    expect(
      fallback.data.vcUserRelations
        .filter(({ isPersonalDataHandler }) => isPersonalDataHandler)
        .map(({ id }) => id),
    ).toEqual(['vc-1']);
  });

  it('fails closed for multi-root documents and leaves real payloads untouched', () => {
    const runtime = createRuntime();
    const document = {
      definitions: [
        {
          kind: 'OperationDefinition',
          selectionSet: {
            selections: [
              {
                kind: 'Field',
                name: { value: 'first' },
                selectionSet: { selections: [{ kind: 'Field', name: { value: 'objectList' } }] },
              },
              {
                kind: 'Field',
                name: { value: 'second' },
                selectionSet: { selections: [{ kind: 'Field', name: { value: 'objectList' } }] },
              },
            ],
          },
        },
      ],
    };
    runtime.register(
      document,
      ['@connection.objectList.[]'],
      [{ path: '@connection.objectList.[].status', value: 'requested' }],
    );

    const real = { data: { first: { objectList: [{ status: 'approved' }] } } };
    expect(runtime.paths(document)).toEqual([]);
    expect(runtime.overlay(real, () => document)).toBe(real);
  });
});

describe('Preview Inspector typed GraphQL hook recovery', () => {
  /** A registered declared result keeps generated rows inside the declared literal set. */
  it('applies declared literals and list-ness to the first loading render', () => {
    const document = {
      definitions: [{ kind: 'OperationDefinition', name: { value: 'InvestmentList' } }],
      loc: { source: { body: 'query InvestmentList { investments { status round } }' } },
    };
    const context = vm.createContext({});
    vm.runInContext(
      `
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const inferPreviewInspectorGraphqlQueryShape = () => ({
        fields: {
          investments: {
            fields: { round: { kind: 'string' }, status: { kind: 'string' } },
            kind: 'object',
          },
        },
        kind: 'object',
      });
      const generatePreviewInspectorDataValue = () => ({
        investments: { round: 'round', status: 'ACTIVE' },
      });
      const createPreviewInspectorRuntimeFallbackRequirementTemplate = (value) => value;
      ${createPreviewInspectorGeneratedValueRuntimeSource()}
      ${createPreviewInspectorHookGraphqlRuntimeSource()}
      globalThis.__fallback = createPreviewInspectorHookGraphqlFallback;
    `,
      context,
    );
    const registry = vm.runInContext(
      "globalThis[Symbol.for('newdlops.react-file-preview.typed-graphql-documents')] = []",
      context,
    ) as unknown[];
    registry.push([
      document,
      {
        fields: {
          investments: {
            items: {
              fields: {
                round: { kind: 'number' },
                status: { kind: 'literal', value: 'NOT_WILLING_TO_SELL' },
              },
              kind: 'object',
            },
            kind: 'array',
          },
        },
        kind: 'object',
      },
    ]);
    const fallback = (
      vm.runInContext('globalThis.__fallback', context) as (...args: unknown[]) => unknown
    )(
      { data: {} },
      () => document,
      () => ({}),
    );

    expect(JSON.parse(JSON.stringify(fallback))).toMatchObject({
      data: { investments: [{ round: 0, status: 'NOT_WILLING_TO_SELL' }] },
    });
  });
});

describe('Preview Inspector GraphQL hook row evidence', () => {
  /** Only collections without compiler render demand may later be served with sample rows. */
  it('remembers the result shape only for documents without render demand', () => {
    const runtime = createRuntime();
    const plain = personalDataHandlersDocument();
    const demanded = personalDataHandlersDocument();
    runtime.register(demanded, ['data.vcUserRelations.[]'], []);
    const plainValue = { data: {} };
    const demandedValue = { data: {} };

    runtime.remember(plainValue, () => plain);
    runtime.remember(demandedValue, () => demanded);

    expect(runtime.evidence(plainValue)).toMatchObject({
      operationName: 'EditPersonalDataHandlersModalForm',
      shape: { fields: { vcUserRelations: { kind: 'object' } }, kind: 'object' },
      typed: false,
    });
    expect(runtime.evidence(demandedValue)).toBeUndefined();
    expect(runtime.evidence({ data: {} })).toBeUndefined();
  });
});

/** Creates one GraphQL operation with a single connection-bearing root field. */
function documentWithRoot(alias: string): object {
  return {
    definitions: [
      {
        kind: 'OperationDefinition',
        selectionSet: {
          selections: [
            {
              alias: { value: alias },
              kind: 'Field',
              name: { value: 'employmentDocumentList' },
              selectionSet: { selections: [{ kind: 'Field', name: { value: 'objectList' } }] },
            },
          ],
        },
      },
    ],
  };
}

/** Creates the fixed renderer's schema-less relation query with runtime source evidence. */
function personalDataHandlersDocument(): object {
  return {
    definitions: [
      {
        kind: 'OperationDefinition',
        name: { value: 'EditPersonalDataHandlersModalForm' },
        selectionSet: {
          selections: [
            {
              kind: 'Field',
              name: { value: 'vcUserRelations' },
              selectionSet: { selections: [{ kind: 'Field', name: { value: 'id' } }] },
            },
          ],
        },
      },
    ],
    loc: {
      source: {
        body: 'query EditPersonalDataHandlersModalForm { vcUserRelations { id } }',
      },
    },
  };
}

/** Evaluates the generated browser runtime in a minimal isolated registry harness. */
function createRuntime(): {
  associate: (factoryResult: unknown, document: object) => unknown;
  evidence: (fallback: object) => unknown;
  fallback: (fallback: unknown, readDocument: () => unknown, readOptions: () => unknown) => unknown;
  overlay: (fallback: unknown, readDocument: () => unknown) => unknown;
  paths: (document: object) => readonly string[];
  register: (document: object, paths: readonly string[], demands: readonly unknown[]) => unknown;
  remember: (fallback: object, readDocument: () => unknown) => unknown;
  usage: (renderer: object, paths: readonly string[], demands: readonly unknown[]) => unknown;
} {
  const context: { __runtime?: Record<string, (...args: never[]) => unknown> } = {};
  vm.runInNewContext(
    `
    const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
    const inferPreviewInspectorGraphqlQueryShape = () => ({
      fields: {
        vcUserRelations: {
          fields: {
            id: { kind: 'string' },
            isPersonalDataHandler: { kind: 'boolean' },
          },
          kind: 'object',
        },
      },
      kind: 'object',
    });
    const generatePreviewInspectorDataValue = () => ({
      vcUserRelations: { id: 'preview-relation', isPersonalDataHandler: true },
    });
    const createPreviewInspectorRuntimeFallbackRequirementTemplate = (value, paths) => {
      if (!Array.isArray(paths) || !paths.includes('vcUserRelations.[]')) return value;
      const seed = value !== null && typeof value === 'object' ? value : {};
      const relation = seed.vcUserRelations;
      return {
        ...seed,
        vcUserRelations: Array.isArray(relation) ? relation : [relation ?? {}],
      };
    };
    ${createPreviewInspectorGeneratedValueRuntimeSource()}
    ${createPreviewInspectorHookGraphqlRuntimeSource()}
    globalThis.__runtime = {
      associate: registerPreviewInspectorGraphqlFixedRenderer,
      evidence: readPreviewInspectorHookGraphqlRowEvidence,
      fallback: createPreviewInspectorHookGraphqlFallback,
      register: registerPreviewInspectorGraphqlRenderPropUsage,
      paths: (document) => previewInspectorHookGraphqlRenderPropUsages.get(document) ?? [],
      overlay: overlayPreviewInspectorHookGraphqlLiteralDemands,
      remember: rememberPreviewInspectorHookGraphqlRowEvidence,
      usage: registerPreviewInspectorGraphqlFixedRendererUsage,
    };
  `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('runtime did not initialize');
  return context.__runtime as unknown as {
    associate: (factoryResult: unknown, document: object) => unknown;
    evidence: (fallback: object) => unknown;
    fallback: (
      fallback: unknown,
      readDocument: () => unknown,
      readOptions: () => unknown,
    ) => unknown;
    overlay: (fallback: unknown, readDocument: () => unknown) => unknown;
    paths: (document: object) => readonly string[];
    register: (document: object, paths: readonly string[], demands: readonly unknown[]) => unknown;
    remember: (fallback: object, readDocument: () => unknown) => unknown;
    usage: (renderer: object, paths: readonly string[], demands: readonly unknown[]) => unknown;
  };
}
