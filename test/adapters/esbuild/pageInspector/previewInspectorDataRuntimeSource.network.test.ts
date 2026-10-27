/** Covers network behavior for previewInspectorDataRuntimeSource. */
/** Verifies authored-source previewInspectorDataRuntimeSource invariants. */
import { describe, expect, it } from 'vitest';

import { cloneJson, evaluateDataRuntime } from './previewInspectorDataRuntimeSourceFixtures';

describe('Page Inspector data runtime source', () => {
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
          { id: 'preview-1', isActive: true, name: 'Name' },
          { id: 'preview-2', isActive: true, name: 'Name' },
          { id: 'preview-3', isActive: true, name: 'Name' },
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
          { id: 'preview-1', isRecommendedForCompanyCreate: false, name: 'Name' },
          { id: 'preview-2', isRecommendedForCompanyCreate: false, name: 'Name' },
          { id: 'preview-3', isRecommendedForCompanyCreate: false, name: 'Name' },
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
            investorsUnderIrReview: Array.from({ length: 3 }, () => ({ name: 'Name' })),
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
            { id: 'preview-1', title: 'Title' },
            { id: 'preview-2', title: 'Title' },
            { id: 'preview-3', title: 'Title' },
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
        description: 'Description',
        id: 'preview-1',
        name: 'Name',
      },
      {
        active: true,
        description: 'Description',
        id: 'preview-2',
        name: 'Name',
      },
      {
        active: true,
        description: 'Description',
        id: 'preview-3',
        name: 'Name',
      },
    ]);
  });
});
