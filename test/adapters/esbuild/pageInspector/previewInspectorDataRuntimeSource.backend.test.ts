/** Covers backend behavior for previewInspectorDataRuntimeSource. */
/** Verifies authored-source previewInspectorDataRuntimeSource invariants. */
import { describe, expect, it } from 'vitest';

import { cloneJson, evaluateDataRuntime } from './previewInspectorDataRuntimeSourceFixtures';

describe('Page Inspector data runtime source', () => {
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
      suggestedPayload: { profile: { active: true, name: 'Name' } },
    });
    expect(cloneJson(runtime.paths(metadata.shape))).toEqual(['profile.active', 'profile.name']);
  });
});
