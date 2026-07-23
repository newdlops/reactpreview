/**
 * Provides an isolated browser-like VM for Preview Inspector runtime-fallback tests.
 *
 * Keeping the generated-runtime bindings in one support module prevents individual behavior suites
 * from duplicating the same synthetic persistence, console, GraphQL-shape, and refresh boundaries.
 */
import { createContext, runInContext } from 'node:vm';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';
import { createPreviewInspectorRuntimeFallbackRuntimeSource } from '../../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import { createPreviewInspectorRuntimeFallbackScopeRuntimeSource } from '../../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackScopeRuntimeSource';

/** One record returned from the generated browser registry. */
export interface TestRuntimeFallbackRecord {
  readonly error: string;
  readonly fallbackPreview: string;
  readonly generatedPaths: readonly string[];
  readonly hookName: string;
  readonly id: string;
  readonly mode: string;
  readonly ownerName?: string;
  readonly reason: string;
  readonly requiredPaths: readonly string[];
}

/** Functions exported from the isolated VM solely for behavior assertions. */
export interface TestRuntimeFallbackApi {
  activateEffectiveScope(candidateId: string): boolean;
  activateScope(candidateId: string, directTarget: boolean): boolean;
  auto(fallbackId: string): void;
  draft(fallbackId: string): unknown;
  effect(readEffect: () => unknown, metadata: object): unknown;
  pathSignature(requiredPaths: readonly string[]): string;
  read(): TestRuntimeFallbackRecord[];
  readEffectiveDirectTarget(candidateId: string): boolean;
  reset(fallbackId: string): void;
  resolve(
    readHook: () => unknown,
    createFallback: () => unknown,
    metadata: object,
    readGraphqlDocument?: () => unknown,
    readGraphqlOptions?: () => unknown,
  ): unknown;
  resolveFragment(
    readFragment: () => unknown,
    readDocument: () => unknown,
    createFallback: () => unknown,
    metadata: object,
  ): unknown;
  set(fallbackId: string, value: unknown): void;
  setRevision(revision: number): void;
  setRouterOwned(owned: boolean): void;
  setSelectedExport(exportName: string): void;
  setTargetOnly(directTarget: boolean, available: boolean): void;
  smart(fallbackId: string): void;
  smartReachability(
    reachabilityKey: string,
    options?: { readonly preserveUserValues?: boolean },
  ): boolean;
  status(): string;
}

/** Complete observations exposed by one generated-runtime VM fixture. */
export interface RuntimeFallbackFixture {
  readonly api: TestRuntimeFallbackApi;
  readonly consoleEntries: Record<string, unknown>[];
  /** Runs the next browser-frame or timer-fallback callbacks queued by the generated runtime. */
  flushEffectFrame(): void;
  readonly warnings: string[];
}

/** Browser scheduling variant used to exercise both requestAnimationFrame and its timer fallback. */
export interface RuntimeFallbackFixtureOptions {
  readonly animationFrameSupported?: boolean;
}

/** Creates the lexical browser bindings required by the generated fallback runtime. */
export function createRuntimeFallbackFixture(
  enabled: boolean,
  options: RuntimeFallbackFixtureOptions = {},
): RuntimeFallbackFixture {
  const consoleEntries: Record<string, unknown>[] = [];
  const effectFrameCallbacks: (() => void)[] = [];
  const warnings: string[] = [];
  const previewInspectorSession = {
    activeTargetReachabilityKey: 'page:Target',
    renderScenario: 'authored-page',
    selectedExportName: 'Target',
    selectedRootOwnsRouter: false,
    testTargetReachabilityState: { directTarget: false, directTargetAvailable: true },
  };
  const sandbox = {
    boundPreviewInspectorConsoleText(value: string, limit: number): string {
      return value.slice(0, limit);
    },
    createRuntimeErrorHeadline(error: unknown): string {
      return error instanceof Error ? error.message : String(error);
    },
    formatPreviewInspectorConsoleValue(value: unknown): string {
      return JSON.stringify(value);
    },
    generatePreviewInspectorDataValue(shape: { fields?: Record<string, unknown> }): object {
      return Object.hasOwn(shape.fields ?? {}, 'name')
        ? { name: 'Preview name' }
        : { company: { id: 'preview-1' } };
    },
    inferPreviewInspectorGraphqlFragmentShape(): object {
      return { fields: { name: { kind: 'string' } }, kind: 'object' };
    },
    inferPreviewInspectorGraphqlQueryShape(): object {
      return {
        fields: { company: { fields: { id: { kind: 'string' } }, kind: 'object' } },
        kind: 'object',
      };
    },
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
    notifyPreviewInspector(): undefined {
      return undefined;
    },
    persistPreviewInspectorState(): undefined {
      return undefined;
    },
    readPersistedPreviewInspectorState(): object {
      return {};
    },
    schedulePreviewInspectorCommitRefresh(): undefined {
      return undefined;
    },
    schedulePreviewInspectorTreeRefresh(): undefined {
      return undefined;
    },
    requestAnimationFrame:
      options.animationFrameSupported === false
        ? undefined
        : (callback: () => void): number => effectFrameCallbacks.push(callback),
    setTimeout(callback: () => void): number {
      return effectFrameCallbacks.push(callback);
    },
    previewInspectorSession,
    doesSelectedPreviewInspectorPageCandidateOwnRouter(): boolean {
      return previewInspectorSession.selectedRootOwnsRouter;
    },
    readPreviewInspectorConsolePrimitives(): { warn(message: string): void } {
      return {
        warn: (message: string): void => {
          warnings.push(message);
        },
      };
    },
    readPreviewInspectorFallbackValuesEnabled(): boolean {
      return enabled;
    },
    readPreviewInspectorRenderScenario(): string {
      return previewInspectorSession.renderScenario;
    },
    readPreviewInspectorTargetReachabilityState(): object {
      return previewInspectorSession.testTargetReachabilityState;
    },
    recordPreviewInspectorConsoleEntry(candidate: Record<string, unknown>): void {
      consoleEntries.push(candidate);
    },
    recordPreviewInspectorRuntimeHealth(): undefined {
      return undefined;
    },
  };
  const context = createContext(sandbox);
  runInContext(
    'let previewEntryRevision = 0;\n' +
      `${createPreviewInspectorFailureEvidenceRuntimeSource()}\n` +
      `${createPreviewInspectorRuntimeFallbackRuntimeSource()}\n` +
      `${createPreviewInspectorRuntimeFallbackScopeRuntimeSource()}\n` +
      'globalThis.__runtimeFallbackApi = {' +
      ' activateEffectiveScope: (candidateId) => {' +
      'const candidate = { id: candidateId };' +
      'return activatePreviewInspectorRuntimeFallbackScope(' +
      'candidate, readPreviewInspectorRuntimeFallbackDirectTarget({}, candidate));' +
      '},' +
      ' activateScope: (candidateId, directTarget) => ' +
      'activatePreviewInspectorRuntimeFallbackScope({ id: candidateId }, directTarget),' +
      ' auto: autoPassPreviewInspectorRuntimeFallback,' +
      ' draft: readPreviewInspectorRuntimeFallbackDraft,' +
      ' effect: resolvePreviewInspectorRuntimeEffect,' +
      ' pathSignature: createPreviewInspectorRuntimeFallbackPathSignature,' +
      ' read: readPreviewInspectorRuntimeFallbacks,' +
      ' readEffectiveDirectTarget: (candidateId) => ' +
      'readPreviewInspectorRuntimeFallbackDirectTarget({}, { id: candidateId }),' +
      ' reset: resetPreviewInspectorRuntimeFallbackOverride,' +
      ' resolve: resolvePreviewInspectorScopedRuntimeHook,' +
      ' resolveFragment: resolvePreviewInspectorGraphqlFragmentValue,' +
      ' set: setPreviewInspectorRuntimeFallbackOverride,' +
      ' setRevision: (revision) => { previewEntryRevision = revision; },' +
      ' setRouterOwned: (owned) => {' +
      'previewInspectorSession.selectedRootOwnsRouter = owned;' +
      '},' +
      ' setSelectedExport: (exportName) => {' +
      'previewInspectorSession.selectedExportName = exportName;' +
      '},' +
      ' setTargetOnly: (directTarget, available) => {' +
      'previewInspectorSession.testTargetReachabilityState = {' +
      'directTarget, directTargetAvailable: available' +
      '};' +
      '},' +
      ' smart: smartFillPreviewInspectorRuntimeFallback,' +
      ' smartReachability: smartFillPreviewInspectorRuntimeFallbacksForReachability,' +
      ' status: readPreviewInspectorRuntimeFallbackStatus' +
      '};',
    context,
  );
  const api = (sandbox as typeof sandbox & { __runtimeFallbackApi?: TestRuntimeFallbackApi })
    .__runtimeFallbackApi;
  if (api === undefined) throw new Error('Generated fallback runtime did not initialize.');
  return {
    api,
    consoleEntries,
    flushEffectFrame(): void {
      const pending = effectFrameCallbacks.splice(0);
      for (const callback of pending) callback();
    },
    warnings,
  };
}

/** Returns stable compiler-like metadata for one isolated hook site. */
export function createMetadata(): object {
  return {
    evidence: 'query parameter default plus an inert local setter',
    fallbackLabel: 'static query value',
    hookName: 'useQueryParam',
    id: 'hook-1',
    line: 12,
    moduleSpecifier: 'use-query-params',
    ownerName: 'List',
    requiredPaths: ['0', '1()'],
    sourcePath: '/workspace/List.tsx',
  };
}
