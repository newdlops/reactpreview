/** Verifies authored page-candidate selection without importing React or application modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';

/** Minimal serializable candidate shape used by the generated runtime's pure selection helpers. */
interface CandidateFixture {
  readonly complete?: boolean;
  readonly id: string;
  readonly renderPath?: {
    readonly entryPoint?: { readonly sourcePath: string };
    readonly steps?: readonly {
      readonly label: string;
      readonly wrapperNames?: readonly string[];
    }[];
  };
  readonly root: { readonly exportName: string; readonly sourcePath: string };
  readonly rootStepIndex?: number;
}

describe('Preview Inspector page-candidate runtime source', () => {
  /** Persists a valid caller choice and rejects identities outside the current descriptor. */
  it('switches only among descriptor-owned page candidates', () => {
    const candidates: readonly CandidateFixture[] = [
      {
        complete: true,
        id: 'public-path',
        renderPath: {
          entryPoint: { sourcePath: '/workspace/public-main.tsx' },
          steps: [
            { label: 'PublicPage' },
            { label: 'AppRouter', wrapperNames: ['ApplicationShell'] },
          ],
        },
        root: { exportName: 'PublicPage', sourcePath: '/workspace/PublicPage.tsx' },
        rootStepIndex: 0,
      },
      {
        id: 'staff-path',
        root: { exportName: 'StaffPage', sourcePath: '/workspace/StaffPage.tsx' },
      },
    ];
    const result = evaluateCandidateSelection(candidates);

    expect(result.initialId).toBe('public-path');
    expect(result.selectedId).toBe('staff-path');
    expect(result.invalidId).toBe('staff-path');
    expect(result.notifications).toBe(1);
    expect(result.persisted).toBe(1);
    expect(result.scheduled).toBe(1);
    expect(result.labels).toEqual([
      '1. PublicPage › AppRouter › ApplicationShell · application root',
      '2. StaffPage · partial context',
    ]);
  });

  /** Keeps candidate loading behind generated callbacks and reports a clear loading state. */
  it('contains a selection-aware asynchronous module loader boundary', () => {
    const source = createPreviewInspectorPageCandidateRuntimeSource();

    expect(source).toContain('function PreviewInspectorPageCandidateLoader');
    expect(source).toContain('.then(() => definition.load())');
    expect(source).toContain('Loading authored page context…');
    expect(source).toContain('createPreviewCandidateRouterElement(rootElement');
    expect(source).toContain('ownsRouter: candidate?.rootOwnsRouter === true');
    expect(source).toContain('previewInspectorSession.selectedPageCandidateId = candidateId');
  });
});

/** Executes only pure helper calls; React-bearing component bodies remain inert in this VM. */
function evaluateCandidateSelection(candidates: readonly CandidateFixture[]): {
  readonly initialId: string;
  readonly invalidId: string;
  readonly labels: readonly string[];
  readonly notifications: number;
  readonly persisted: number;
  readonly scheduled: number;
  readonly selectedId: string;
} {
  const context: {
    __result?: ReturnType<typeof evaluateCandidateSelection>;
    candidates: readonly CandidateFixture[];
  } = { candidates };
  vm.runInNewContext(
    `${createPreviewInspectorPageCandidateRuntimeSource()}
const descriptor = { inspector: { pageCandidates: globalThis.candidates } };
const previewInspectorSession = {
  selectedPageCandidateId: '',
  selectedTreeNodeId: 'old-node',
};
let notifications = 0;
let persisted = 0;
let scheduled = 0;
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function notifyPreviewInspector() { notifications += 1; }
function persistPreviewInspectorState() { persisted += 1; }
function schedulePreviewInspectorCommitRefresh() { scheduled += 1; }
const initial = readSelectedPreviewInspectorPageCandidate(descriptor);
previewInspectorSession.selectedPageCandidateId = initial.id;
selectPreviewInspectorPageCandidate('staff-path');
const selectedId = previewInspectorSession.selectedPageCandidateId;
selectPreviewInspectorPageCandidate('unknown-path');
globalThis.__result = {
  initialId: initial.id,
  invalidId: previewInspectorSession.selectedPageCandidateId,
  labels: globalThis.candidates.map(formatPreviewInspectorPageCandidate),
  notifications,
  persisted,
  scheduled,
  selectedId,
};`,
    context,
  );
  if (context.__result === undefined) {
    throw new Error('Page candidate runtime did not expose its test result.');
  }
  return context.__result;
}
