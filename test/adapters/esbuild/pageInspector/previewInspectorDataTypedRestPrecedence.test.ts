/** Verifies that a call-site response type beats endpoint-name guesses and `as T` helper shapes. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewGeneratedListRuntimeSource } from '../../../../src/adapters/esbuild/previewGeneratedListRuntimeSource';

const SETTINGS_SHAPE = {
  fields: {
    locale: { kind: 'string' },
    theme: { fields: { primary: { kind: 'string' } }, kind: 'object' },
  },
  kind: 'object',
};

describe('typed REST registry precedence', () => {
  /** `fetchJson<Settings>('/api/settings')` answers with the declared object, not a list. */
  it('uses the registered shape when the compiler only knows `unknown`', async () => {
    const fetch = evaluate([['GET', '/api/settings', SETTINGS_SHAPE]]);

    const response = await fetch('/api/settings', undefined, {
      evidence: 'TypeScript: T',
      id: 'rest-settings',
      kind: 'rest',
      method: 'GET',
      shape: { kind: 'unknown' },
      url: '/api/settings',
    });
    const payload = (await response.json()) as Record<string, unknown>;

    expect(Array.isArray(payload)).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(['locale', 'theme']);
  });

  /** Without a registration the plural endpoint name still reads as a collection. */
  it('keeps the endpoint heuristic when nothing is registered', async () => {
    const fetch = evaluate([]);

    const response = await fetch('/api/settings');

    expect(Array.isArray(await response.json())).toBe(true);
  });
});

type PreviewFetch = (
  url: string,
  init?: unknown,
  metadata?: unknown,
) => Promise<{ json(): Promise<unknown> }>;

/** Evaluates the data runtime with a pre-filled typed REST registry. */
function evaluate(registry: readonly unknown[]): PreviewFetch {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    __nativeFetch: () => {
      throw new Error('backend transport must remain disabled');
    },
    __registry: registry,
    location: { href: 'https://preview.invalid/' },
    queueMicrotask,
    setTimeout,
  });
  vm.runInContext(
    `
globalThis[Symbol.for('newdlops.react-file-preview.typed-rest-endpoints')] = [...globalThis.__registry];
const previewHotRuntime = { inspectorNativeFetch: globalThis.__nativeFetch };
const previewInspectorSession = { resolverPropsByExport: new Map() };
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
function readPersistedPreviewInspectorState() { return {}; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value, null, 2) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function schedulePreviewInspectorTreeRefresh() {}
function readPreviewInspectorRenderScenario() { return 'file-components'; }
function shouldHoldPreviewInspectorNeuralTransientTargetRequest() { return false; }
function resetPreviewInspectorGeneratedRuntimeFallbackValues() {}
${createPreviewGeneratedListRuntimeSource()}
${createPreviewInspectorDataRuntimeSource()}
${createPreviewInspectorNeuralResidualRuntimeSource()}
${createPreviewInspectorHookGraphqlRuntimeSource()}
globalThis.__fetch = previewInspectorFetch;`,
    context,
  );
  return context.__fetch as PreviewFetch;
}
