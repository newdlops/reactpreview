/** Provides a fake-clock trace realm and committed blocker snapshots shared by protocol suites. */
import vm from 'node:vm';
import { createPreviewInspectorBlockerTraceRuntimeSource } from '../../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerTraceRuntimeSource';

/** Minimal event envelope posted by the generated trace runtime. */
export interface TraceMessage {
  readonly artifactId?: string;
  readonly event: {
    readonly auto?: {
      readonly action?: string;
      readonly mode: string;
      readonly selectedValue?: unknown;
    };
    readonly blocker?: {
      readonly id: string;
      readonly outcome?: string;
      readonly source?: { readonly sourcePath: string };
    };
    readonly error?: { readonly message: string };
    readonly event: string;
    readonly result?: {
      readonly changedBlockerIds: readonly string[];
      readonly outcome?: string;
      readonly remainingBlockerIds: readonly string[];
      readonly resolvedBlockerIds: readonly string[];
    };
    readonly traceId: string;
  };
  readonly runtimeRevision?: number;
  readonly runtimeSessionId?: string;
  readonly type: string;
}

/** Pure trace functions deliberately exposed only inside the VM fixture. */
interface TraceRuntime {
  readonly advance: (milliseconds: number) => void;
  readonly automaticAssistanceEvents: {
    readonly detail: { readonly blockerCount: number; readonly blockerIds: readonly string[] };
    readonly event: string;
  }[];
  readonly decide: (candidate: Record<string, unknown>) => string | undefined;
  readonly error: (entry: Record<string, unknown>) => void;
  readonly flush: () => void;
  readonly messages: TraceMessage[];
  readonly rollbackCalls: string[];
  readonly requirementRollbackCalls: string[];
  readonly resumeEffects: string[];
  readonly restCollectionWithdrawals: string[];
  readonly resumeHandledAtCall: boolean[];
  readonly rollbacks: string[];
  readonly serveRestCollectionRows: () => void;
  readonly setReachability: (key: string, state: Record<string, unknown>) => void;
  readonly snapshot: (snapshot: Record<string, unknown>) => void;
}

/** Creates one blocker tree snapshot whose mode change represents a post-Auto remount. */
export function createSnapshot(mode: string): Record<string, unknown> {
  return {
    roots: [
      {
        children: [],
        blocker: { id: 'hook-form', mode, ownerName: 'ProfileForm' },
        blockerId: 'hook-form',
        blockerKind: 'runtime-fallback',
        id: 'runtime-blocker:hook-form',
        kind: 'blocker',
        name: 'Missing hook value · useFormContext',
        props: { mode, requiredPaths: ['formikProps.values.name'] },
        source: { line: 3, path: '/workspace/ProfileForm.tsx' },
        state: { generated: '{"formikProps":{"values":{"name":"Preview name"}}}' },
      },
    ],
  };
}

/** Creates the committed error-boundary evidence used to keep one fatal signature active. */
export function createTargetErrorSnapshot(
  exportName: string,
  message: string,
): Record<string, unknown> {
  return {
    roots: [
      {
        blocker: { headline: 'TypeError: ' + message, requiredPaths: [] },
        blockerId: 'target-error:' + exportName,
        blockerKind: 'target-error',
        children: [],
        id: 'target-error:' + exportName,
        kind: 'blocker',
        name: 'Component error · ' + exportName,
        ownerExportName: exportName,
      },
    ],
  };
}

/** Evaluates the generated browser source against inert session and postMessage primitives. */
export function createTraceRuntime(): TraceRuntime {
  const context: { __runtime?: TraceRuntime } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        targetReachabilityByKey: new Map(),
        renderScenario: 'authored-page',
        selectedExportName: 'ProfileForm',
        selectedPageCandidateId: 'app-path',
      };
      const previewEntryRevision = 2;
      let currentTime = 1_000;
      const scheduledTimers = [];
      Date.now = () => currentTime;
      globalThis.setTimeout = (callback, delay = 0) => {
        scheduledTimers.push({ callback, dueAt: currentTime + Math.max(0, Number(delay) || 0) });
        return scheduledTimers.length;
      };
      const advanceClock = (milliseconds) => {
        const targetTime = currentTime + milliseconds;
        while (true) {
          scheduledTimers.sort((left, right) => left.dueAt - right.dueAt);
          const next = scheduledTimers[0];
          if (next === undefined || next.dueAt > targetTime) break;
          scheduledTimers.shift();
          currentTime = next.dueAt;
          next.callback();
        }
        currentTime = targetTime;
      };
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS = 160;
      const messages = [];
      const automaticAssistanceEvents = [];
      const rollbackCalls = [];
      const requirementRollbackCalls = [];
      const rollbacks = [];
      const resumeHandledAtCall = [];
      const resumeEffects = [];
      const previewInspectorPostHostMessage = (message) => { messages.push(message); };
      const schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth = (event, detail) => {
        automaticAssistanceEvents.push({ detail, event });
        return true;
      };
      const readPreviewInspectorRuntimeCorrelation = () => ({
        artifactId: '0123456789abcdef',
        runtimeRevision: 2,
        runtimeSessionId: 'rp-0123456789abcdef01234567',
      });
      const rollbackPreviewInspectorFailedAutoDecision = (traceId) => {
        rollbackCalls.push(traceId);
        const selection = messages.find(
          (message) => message?.event?.event === 'auto-selection' &&
            message?.event?.traceId === traceId,
        );
        if (selection?.event?.auto?.mode !== 'target-guided-auto') return false;
        rollbacks.push(traceId);
        return true;
      };
      const resumePreviewInspectorTargetReachabilityAfterConditionAttempt = (attempt) => {
        resumeHandledAtCall.push(attempt?.targetReachabilityResumeHandled === true);
        if (attempt?.targetReachabilityResumeHandled === true) return false;
        attempt.targetReachabilityResumeHandled = true;
        resumeEffects.push(attempt.traceId);
        return true;
      };
      const rollbackPreviewInspectorRequirementAutoDecision = (traceId) => {
        requirementRollbackCalls.push(traceId); return true;
      };
      const restCollectionWithdrawals = [];
      const withdrawPreviewInspectorRestCollectionFillAfterError = (fingerprint) => {
        restCollectionWithdrawals.push(fingerprint);
        return previewInspectorSession.restCollectionRowsServed === true;
      };
      const inferPreviewInspectorTargetAutoAttemptReachabilityKey = (candidate) =>
        candidate?.targetReachabilityKey;
      const isPreviewInspectorBlockingNode = (node) => node?.blocker?.mode !== 'assisted';
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      ${createPreviewInspectorBlockerTraceRuntimeSource()}
      globalThis.__runtime = {
        advance: advanceClock,
        automaticAssistanceEvents,
        decide: recordPreviewInspectorBlockerAutoDecision,
        error: recordPreviewInspectorBlockerTraceError,
        flush: flushPreviewInspectorBlockerTraceAutoDecisions,
        messages,
        rollbackCalls,
        requirementRollbackCalls,
        restCollectionWithdrawals,
        resumeEffects,
        resumeHandledAtCall,
        rollbacks,
        serveRestCollectionRows: () => {
          previewInspectorSession.restCollectionRowsServed = true;
        },
        setReachability: (key, state) => {
          previewInspectorSession.targetReachabilityByKey.set(key, state);
        },
        snapshot: publishPreviewInspectorBlockerTraceSnapshot,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Blocker trace fixture did not initialize.');
  return context.__runtime;
}
