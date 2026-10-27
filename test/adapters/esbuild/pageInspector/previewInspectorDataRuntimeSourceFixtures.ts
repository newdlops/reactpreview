/** Shared deterministic fixtures for previewInspectorDataRuntimeSource regression scenarios. */
import vm from 'node:vm';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewGeneratedListRuntimeSource } from '../../../../src/adapters/esbuild/previewGeneratedListRuntimeSource';

/** Creates the bounded DocumentNode evidence emitted by graphql-tag for one named query. */
export function graphqlOperationDocument(operationName: string, source: string): object {
  return {
    definitions: [
      {
        kind: 'OperationDefinition',
        name: { value: operationName },
        selectionSet: { selections: [] },
      },
    ],
    loc: { source: { body: source } },
  };
}

/** Callable subset exposed from one generated-runtime VM fixture. */
export interface EvaluatedDataRuntime {
  readonly auto: (enabled: boolean) => void;
  readonly axios: (
    method: string,
    url: string,
    extraArguments: readonly unknown[],
    metadata: unknown,
  ) => Promise<unknown>;
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
  ) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;
  readonly generate: (shape: unknown) => unknown;
  readonly generatedCacheState: () => {
    readonly hookResets: number;
    readonly resolverProps: number;
  };
  readonly inferGraphql: (source: string, operationName: string) => unknown;
  readonly lorem: (id: string) => void;
  readonly listSampleCount: () => number;
  readonly paths: (shape: unknown) => readonly string[];
  readonly registerGraphqlDemand: (
    document: object,
    paths: readonly string[],
    literalDemands: readonly unknown[],
  ) => unknown;
  readonly requests: () => readonly unknown[];
  readonly resolve: (metadata: unknown, seed: unknown, requestContext?: unknown) => unknown;
  readonly scenario: (id: string, scenario: unknown) => void;
  readonly scenarios: () => Readonly<Record<string, unknown>>;
  readonly set: (id: string, payload: unknown, mode: string) => void;
  readonly setListSampleCount: (value: number) => boolean;
  readonly smart: (id: string) => void;
  readonly target: (reachabilityKey?: string) => void;
  readonly temporalScenario: (id: string) => void;
  readonly smartReachability: (
    reachabilityKey: string,
    options?: {
      readonly applicationPath?: readonly string[];
      readonly preserveUserValues?: boolean;
    },
  ) => boolean;
}

/** Evaluates the generated source with only its documented lexical dependencies. */
export function evaluateDataRuntime(
  nativeFetch?: (...arguments_: unknown[]) => unknown,
  activeTargetReachabilityKey?: string,
  renderScenario = 'file-components',
  transientTarget = false,
): EvaluatedDataRuntime {
  const source = `
const previewHotRuntime = { inspectorNativeFetch: globalThis.__nativeFetch };
const previewInspectorSession = {
  activeTargetReachabilityKey: ${JSON.stringify(activeTargetReachabilityKey)},
  resolverPropsByExport: new Map([['GeneratedTarget', { items: [1, 2, 3] }]]),
};
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
let persistedState = {};
function readPersistedPreviewInspectorState() { return persistedState; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value, null, 2) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function schedulePreviewInspectorTreeRefresh() {}
function readPreviewInspectorRenderScenario() { return ${JSON.stringify(renderScenario)}; }
function shouldHoldPreviewInspectorNeuralTransientTargetRequest() {
  return ${JSON.stringify(transientTarget)};
}
let generatedRuntimeFallbackResetCount = 0;
function resetPreviewInspectorGeneratedRuntimeFallbackValues() {
  generatedRuntimeFallbackResetCount += 1;
}
${createPreviewGeneratedListRuntimeSource()}
${createPreviewInspectorDataRuntimeSource()}
// Generated rows count back from the preview's current day; pin that day for stable payloads.
previewInspectorSampleDates.baseOverride = new Date(2026, 0, 15, 12);
${createPreviewInspectorNeuralResidualRuntimeSource()}
${createPreviewInspectorHookGraphqlRuntimeSource()}
globalThis.__dataRuntime = {
  auto: setPreviewInspectorDataAutoEnabled,
  axios: previewInspectorAxiosRequest,
  createXhr: () => new PreviewInspectorXmlHttpRequest(),
  fetch: previewInspectorFetch,
  generate: (shape) => generatePreviewInspectorDataValue(shape, '', 'smart'),
  generatedCacheState: () => ({
    hookResets: generatedRuntimeFallbackResetCount,
    resolverProps: previewInspectorSession.resolverPropsByExport.size,
  }),
  inferGraphql: inferPreviewInspectorGraphqlQueryShape,
  lorem: generatePreviewInspectorLoremPayload,
  listSampleCount: readPreviewInspectorDataListSampleCount,
  paths: readPreviewInspectorDataShapePaths,
  registerGraphqlDemand: registerPreviewInspectorGraphqlRenderPropUsage,
  requests: readPreviewInspectorDataRequests,
  resolve: resolvePreviewInspectorDataPayload,
  scenario: setPreviewInspectorVirtualBackendScenario,
  scenarios: serializePreviewInspectorVirtualBackendScenarios,
  set: setPreviewInspectorDataPayload,
  setListSampleCount: setPreviewInspectorDataListSampleCount,
  smart: smartFillPreviewInspectorDataPayload,
  smartReachability: smartFillPreviewInspectorDataPayloadsForReachability,
  target: (reachabilityKey) => {
    previewInspectorSession.activeTargetReachabilityKey = reachabilityKey;
  },
  temporalScenario: (id) => {
    initializePreviewInspectorVirtualBackendState();
    previewInspectorSession.temporalBackendScenarioOverrides.set(id, {
      latencyMs: 0,
      mode: 'pending',
      status: 200,
    });
  },
};`;
  const context = vm.createContext({
    URL,
    URLSearchParams,
    __nativeFetch: nativeFetch,
    location: { href: 'https://preview.invalid/' },
    queueMicrotask,
    setTimeout,
  });
  vm.runInContext(source, context);
  return context.__dataRuntime as EvaluatedDataRuntime;
}

/** Removes VM realm prototypes before structural assertions. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
