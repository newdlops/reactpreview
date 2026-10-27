/** Covers materialization behavior for previewInspectorDataRuntimeSource. */
/** Verifies authored-source previewInspectorDataRuntimeSource invariants. */
import { describe, expect, it } from 'vitest';

import {
  cloneJson,
  evaluateDataRuntime,
  graphqlOperationDocument,
} from './previewInspectorDataRuntimeSourceFixtures';

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
          name: 'Name',
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
        { active: true, id: 'preview-1', name: 'Name', salary: 1 },
        { active: true, id: 'preview-2', name: 'Name', salary: 2 },
        { active: true, id: 'preview-3', name: 'Name', salary: 3 },
      ],
    });
    expect(cloneJson(runtime.requests())[0]).toMatchObject({ mode: 'auto' });

    runtime.smart('employees');
    expect(cloneJson(runtime.requests())[0]).toMatchObject({
      mode: 'smart',
      payload: {
        employees: [{ active: true, id: 'preview-1', name: 'Name', salary: 1 }],
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
            date: '2026-01-14T09:00:00.000Z',
            eventType: 'PREVIEW',
          },
          {
            appointmentDirectorType: 'PREVIEW',
            date: '2026-01-13T09:00:00.000Z',
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
      ['data.history.events.[]', 'data.history.events.[].date', 'data.history.events.[].eventType'],
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
  it.each([['authored-page', undefined, 'corridor-auto', []], ['file-components', undefined, 'auto', ['Value', 'Value', 'Value']], ['file-components', 'page:Target', 'corridor-auto', []]])('uses %s with active key %s', (scenario, activeKey, profile, payload) => {
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

    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(['Value', 'Value', 'Value']);
    runtime.target('page:Target');
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual([]);
    runtime.target(undefined);
    expect(cloneJson(runtime.resolve(metadata, []))).toEqual(['Value', 'Value', 'Value']);
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
      address: 'Address',
      description: 'Description',
      [longKey]: 'This field name would otherwise…',
    });
  });
});
