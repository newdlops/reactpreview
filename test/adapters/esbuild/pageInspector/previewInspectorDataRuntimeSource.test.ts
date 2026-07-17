/** Exercises generated payload state without importing a target project's React runtime. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';

describe('Page Inspector data runtime source', () => {
  /** Infers deterministic scalar/list values and records explicit generated provenance. */
  it('generates Auto, Lorem, and custom payloads from one shared type shape', () => {
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
        { active: true, id: 'preview-1', name: 'Preview User 1', salary: 1 },
        { active: true, id: 'preview-2', name: 'Preview User 2', salary: 2 },
      ],
    });
    expect(cloneJson(runtime.requests())[0]).toMatchObject({ mode: 'auto' });

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
          { id: 'preview-1', isActive: true, name: 'Preview User 1' },
          { id: 'preview-2', isActive: true, name: 'Preview User 2' },
        ],
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
        description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        id: 'preview-1',
        name: 'Preview User 1',
      },
      {
        active: true,
        description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        id: 'preview-2',
        name: 'Preview User 2',
      },
    ]);
  });
});

/** Callable subset exposed from one generated-runtime VM fixture. */
interface EvaluatedDataRuntime {
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
  ) => Promise<{ json(): Promise<unknown> }>;
  readonly lorem: (id: string) => void;
  readonly requests: () => readonly unknown[];
  readonly resolve: (metadata: unknown, seed: unknown) => unknown;
  readonly set: (id: string, payload: unknown, mode: string) => void;
}

/** Evaluates the generated source with only its documented lexical dependencies. */
function evaluateDataRuntime(
  nativeFetch?: (...arguments_: unknown[]) => unknown,
): EvaluatedDataRuntime {
  const source = `
const previewHotRuntime = { inspectorNativeFetch: globalThis.__nativeFetch };
const previewInspectorSession = {};
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
let persistedState = {};
function readPersistedPreviewInspectorState() { return persistedState; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value, null, 2) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function notifyPreviewInspectorTreeSubscribers() {}
${createPreviewInspectorDataRuntimeSource()}
globalThis.__dataRuntime = {
  createXhr: () => new PreviewInspectorXmlHttpRequest(),
  fetch: previewInspectorFetch,
  lorem: generatePreviewInspectorLoremPayload,
  requests: readPreviewInspectorDataRequests,
  resolve: resolvePreviewInspectorDataPayload,
  set: setPreviewInspectorDataPayload,
};`;
  const context = vm.createContext({
    URL,
    URLSearchParams,
    __nativeFetch: nativeFetch,
    location: { href: 'https://preview.invalid/' },
    queueMicrotask,
  });
  vm.runInContext(source, context);
  return context.__dataRuntime as EvaluatedDataRuntime;
}

/** Removes VM realm prototypes before structural assertions. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
