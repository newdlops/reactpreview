/** Child contracts inside .map must address the real response item, including nested collections. */
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';
import { createPreviewGraphqlRenderPropUsageReplacements } from '../../../../src/adapters/esbuild/staticResources/previewGraphqlRenderPropUsageInstrumentation';

describe('GraphQL mapped item demand paths', () => {
  it.each([
    {
      name: 'captured item in a nested callback',
      body: 'people.map(person => <Capture render={() => <Card status={person.status} />} />)',
      expectedStatus: 'active',
    },
    {
      name: 'shadowed item in a nested callback',
      body: 'people.map(person => <Capture render={person => <Card status={person.status} />} />)',
      expectedStatus: 'inactive',
    },
    {
      name: 'unrelated same-named value after the map',
      body: '<>{people.map(person => <span />)}<Card status={person.status} /></>',
      expectedStatus: 'inactive',
    },
    {
      name: 'outer item restored after a same-named nested map',
      body: 'people.map(person => <>{people.map(person => <span />)}<Card status={person.status} /></>)',
      expectedStatus: 'active',
    },
    {
      name: 'block-local item shadow',
      body: 'people.map(person => { if (true) { const person = { status: "inactive" }; return <Card status={person.status} />; } return null; })',
      expectedStatus: 'inactive',
    },
    {
      name: 'reassigned item parameter',
      body: 'people.map(person => { person = { status: "inactive" }; return <Card status={person.status} />; })',
      expectedStatus: 'inactive',
    },
    {
      name: 'item reassigned in a captured callback',
      body: 'people.map(person => { const replace = () => { person = { status: "inactive" }; }; replace(); return <Card status={person.status} />; })',
      expectedStatus: 'inactive',
    },
    {
      name: 'destructuring assignment to the item',
      body: 'people.map(person => { ({ person } = { person: { status: "inactive" } }); return <Card status={person.status} />; })',
      expectedStatus: 'inactive',
    },
    {
      name: 'rest argument tuple',
      body: 'people.map((...person) => <Card status={person.status} />)',
      expectedStatus: 'inactive',
    },
    {
      name: 'provided item with an authored default parameter',
      body: 'people.map((person = { status: "inactive" }) => <Card status={person.status} />)',
      expectedStatus: 'active',
    },
    {
      name: 'JSX evaluated only in a parameter default',
      body: 'people.map((person = <Card status={person.status} />) => <span />)',
      expectedStatus: 'inactive',
    },
    {
      name: 'shadowed collection receiver',
      body: '<>{people.map(item => <span />)}<Capture render={people => people.map(person => <Card status={person.status} />)} /></>',
      expectedStatus: 'inactive',
    },
    {
      name: 'assignment to a nested callback shadow',
      body: 'people.map(person => { const replace = person => { person = { status: "inactive" }; }; return <Card status={person.status} />; })',
      expectedStatus: 'active',
    },
  ])('keeps provenance for $name', ({ body, expectedStatus }) => {
    const source = `const person = { status: 'inactive' }; <Query query={QUERY}>{({ data: { people } }) => (${body})}</Query>`;
    const catalog = new Map([
      [
        'Card',
        new Map([
          ['status', { kind: 'string' as const, exactValue: true as const, value: 'active' }],
        ]),
      ],
    ]);
    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/Scopes.tsx',
      source,
      catalog,
    );
    expect(replacements).toHaveLength(1);
    const document = { kind: 'Document' };
    const runtime: { QUERY: object; overlay?: (response: unknown, read: () => object) => unknown } =
      { QUERY: document };
    const context = createContext(runtime);
    runInContext(
      [
        "const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);",
        createPreviewInspectorGeneratedValueRuntimeSource(),
        createPreviewInspectorHookGraphqlRuntimeSource(),
        "globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')] = { registerGraphqlRenderPropUsage: registerPreviewInspectorGraphqlRenderPropUsage };",
        'globalThis.overlay = overlayPreviewInspectorHookGraphqlLiteralDemands;',
      ].join('\n'),
      context,
    );
    expect(runInContext(replacements[0]?.replacement ?? '', context)).toBe(document);
    if (runtime.overlay === undefined) throw new Error('GraphQL runtime was not initialized');
    const response = { data: { people: [{ status: 'inactive' }] } };
    expect(runtime.overlay(response, () => document)).toEqual({
      data: { people: [{ status: expectedStatus }] },
    });
    expect(response).toEqual({ data: { people: [{ status: 'inactive' }] } });
  });

  it('applies the mapped child status to the actual GraphQL response item', () => {
    const source =
      '<Query query={QUERY}>{({ data: { people } }) => people.map(person => <Card status={person.status} />)}</Query>';
    const catalog = new Map([
      [
        'Card',
        new Map([
          ['status', { kind: 'string' as const, exactValue: true as const, value: 'active' }],
        ]),
      ],
    ]);
    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/People.tsx',
      source,
      catalog,
    );
    expect(replacements).toHaveLength(1);
    const document = { kind: 'Document' };
    const runtime: {
      QUERY: object;
      overlay?: (response: unknown, readDocument: () => object) => unknown;
    } = { QUERY: document };
    const context = createContext(runtime);
    runInContext(
      [
        "const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);",
        createPreviewInspectorGeneratedValueRuntimeSource(),
        createPreviewInspectorHookGraphqlRuntimeSource(),
        "globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')] = { registerGraphqlRenderPropUsage: registerPreviewInspectorGraphqlRenderPropUsage };",
        'globalThis.overlay = overlayPreviewInspectorHookGraphqlLiteralDemands;',
      ].join('\n'),
      context,
    );
    expect(runInContext(replacements[0]?.replacement ?? '', context)).toBe(document);
    if (runtime.overlay === undefined) throw new Error('GraphQL runtime was not initialized');
    const response = { data: { people: [{ status: 'inactive' }] } };
    expect(runtime.overlay(response, () => document)).toEqual({
      data: { people: [{ status: 'active' }] },
    });
    expect(response).toEqual({ data: { people: [{ status: 'inactive' }] } });
  });

  it.each([
    {
      name: 'direct item prop',
      binding: 'data: { people }',
      list: 'people',
      prop: 'person',
      paths: ['data.people.[]', 'data.people.[].roles.[]'],
      literalPath: 'data.people.[].status',
    },
    {
      name: 'nested item prop',
      binding: 'data: { team: { members } }',
      list: 'members',
      prop: 'person.profile',
      paths: ['data.team.members.[]', 'data.team.members.[].profile.roles.[]'],
      literalPath: 'data.team.members.[].profile.status',
    },
    {
      name: 'connection item prop',
      binding: 'data: { accounts: { objectList } }',
      list: 'objectList',
      prop: 'person.profile',
      paths: ['@connection.objectList.[]', '@connection.objectList.[].profile.roles.[]'],
      literalPath: '@connection.objectList.[].profile.status',
    },
    {
      name: 'item parameter shadowing the query binding',
      binding: 'data: { person }',
      list: 'person',
      prop: 'person',
      paths: ['data.person.[]', 'data.person.[].roles.[]'],
      literalPath: 'data.person.[].status',
    },
  ])('registers one collection prefix for $name', ({ binding, list, prop, paths, literalPath }) => {
    const source = `<Query query={QUERY}>{({ ${binding} }) => ${list}.map(person => <Card model={${prop}} />)}</Query>`;
    const catalog = new Map([
      [
        'Card',
        new Map([
          [
            'model',
            {
              kind: 'object' as const,
              properties: {
                roles: { kind: 'array' as const, items: { kind: 'string' as const } },
                status: { kind: 'string' as const, exactValue: true as const, value: 'active' },
              },
            },
          ],
        ]),
      ],
    ]);
    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/Page.tsx',
      source,
      catalog,
    );
    expect(replacements).toHaveLength(1);
    const document = { kind: 'Document' };
    const calls: unknown[][] = [];
    const sandbox = {
      QUERY: document,
      [Symbol.for('newdlops.react-file-preview.page-inspector')]: {
        registerGraphqlRenderPropUsage(...args: unknown[]) {
          calls.push(args);
          return args[0];
        },
      },
    };
    expect(runInNewContext(replacements[0]?.replacement ?? '', sandbox)).toBe(document);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([document, paths, [{ path: literalPath, value: 'active' }]]);
  });
});
