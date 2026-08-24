/** Locks manual page-path choice while automatic compiler work is already in flight. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';

interface QueuedSelectionResult {
  readonly pendingAfterChoice: string;
  readonly postedCandidateIds: readonly string[];
  readonly queuedAfterChoice: string;
  readonly queuedAfterCommit?: string;
  readonly selectedAfterChoice: string;
  readonly timeoutMs: number;
  readonly userSelectedAfterChoice: string;
}

interface WrapperChoiceResult {
  readonly accordionLabel: string;
  readonly buttonCount: number;
  readonly disabled: readonly boolean[];
  readonly scenario: string;
  readonly selectedCandidateIds: readonly string[];
}

interface PerspectiveChoiceResult {
  readonly applied: boolean;
  readonly postedCandidateIds: readonly string[];
  readonly scenario: string;
}

interface AdmissionTimeoutResult {
  readonly errorMessage: string;
  readonly pendingAfterTimeout?: string;
  readonly pendingBeforeTimeout: string;
  readonly timeoutMs: number;
}

describe('Preview Inspector page-candidate interaction runtime', () => {
  it('queues an explicit user path behind automatic work and applies it next', () => {
    expect(evaluateQueuedPageCandidateSelection()).toEqual({
      pendingAfterChoice: 'automatic-path',
      postedCandidateIds: ['user-path'],
      queuedAfterChoice: 'user-path',
      queuedAfterCommit: undefined,
      selectedAfterChoice: 'current-path',
      timeoutMs: 5_000,
      userSelectedAfterChoice: 'user-path',
    });
  });

  it('makes the complete wrapper row activate the next mount option', () => {
    expect(evaluateWrapperPathChoice()).toEqual({
      accordionLabel: 'Page context · 2 paths',
      buttonCount: 2,
      disabled: [false, false],
      scenario: 'authored-page',
      selectedCandidateIds: ['same-wrapper-next-mount'],
    });
  });

  it('keeps wrapper candidates visible in the file overview and returns to page flow on apply', () => {
    expect(evaluateWrapperPathChoice('file-components')).toEqual({
      accordionLabel: 'Page context · 2 paths',
      buttonCount: 2,
      disabled: [false, false],
      scenario: 'authored-page',
      selectedCandidateIds: ['same-wrapper-next-mount'],
    });
  });

  it('applies a page candidate while leaving the file-component perspective', () => {
    expect(evaluateFileComponentPageCandidateSelection()).toEqual({
      applied: true,
      postedCandidateIds: ['alternate-path'],
      scenario: 'authored-page',
    });
  });

  it('releases an unacknowledged page-path request instead of locking every choice', () => {
    expect(evaluatePageCandidateAdmissionTimeout()).toEqual({
      errorMessage: 'Page path request was not accepted. Choose the path again.',
      pendingAfterTimeout: undefined,
      pendingBeforeTimeout: 'alternate-path',
      timeoutMs: 5_000,
    });
  });

  it('keeps choice copy conditional on a genuinely available control', () => {
    const source = createPreviewInspectorPageCandidateUiRuntimeSource();

    expect(source).toContain('hasPreviewInspectorAlternativePageChoice');
    expect(source).toContain('No alternate source-proven page path is available');
    expect(source).toContain('\'[data-rpi-page-choice="true"]:not(:disabled)\'');
    expect(source).not.toContain(
      "disabled: candidates.length < 2 || scenario === 'file-components' ||",
    );
    expect(source).not.toContain(
      "readPreviewInspectorRenderScenario() === 'file-components' ||\n    typeof readPreviewInspectorPageContextPossibilities",
    );
  });
});

/** Verifies one candidate action changes perspective before asking the host for its artifact. */
function evaluateFileComponentPageCandidateSelection(): PerspectiveChoiceResult {
  const context: { __result?: PerspectiveChoiceResult } = {};
  vm.runInNewContext(
    `
const React = { Component: class {} };
const previewEntryRevision = 4;
const previewRuntimeRevision = 4;
const candidates = [
  { id: 'current-path', root: { exportName: 'App' }, target: { exportName: 'Target' } },
  { id: 'alternate-path', root: { exportName: 'OtherPage' }, target: { exportName: 'Target' } },
];
const descriptor = {
  exportName: 'Target',
  inspector: {
    executablePageCandidateId: 'current-path',
    pageCandidates: candidates,
    target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
  },
};
const postedCandidateIds = [];
const previewInspectorSession = {
  interactionSequence: 0,
  renderScenario: 'file-components',
  selectedExportName: 'Target',
  selectedPageCandidateId: 'current-path',
  userSelectedPageCandidateId: '',
};
function setTimeout() { return 1; }
function clearTimeout() {}
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function notifyPreviewInspector() {}
function persistPreviewInspectorState() {}
function previewInspectorPostHostMessage(message) { postedCandidateIds.push(message.candidateId); }
function resetPreviewInspectorTargetReachability() {}
function schedulePreviewInspectorCommitRefresh() {}
${createPreviewInspectorPageCandidateRuntimeSource()}
const applied = applyPreviewInspectorPageCandidateChoice('alternate-path');
globalThis.__result = {
  applied,
  postedCandidateIds,
  scenario: previewInspectorSession.renderScenario,
};
`,
    context,
  );
  if (context.__result === undefined) throw new Error('Perspective choice fixture did not load.');
  return context.__result;
}

/** Runs the admission watchdog that restores controls after a lost host response. */
function evaluatePageCandidateAdmissionTimeout(): AdmissionTimeoutResult {
  const context: { __result?: AdmissionTimeoutResult } = {};
  vm.runInNewContext(
    `
const React = { Component: class {} };
const previewEntryRevision = 3;
const previewRuntimeRevision = 3;
const candidates = [
  { id: 'current-path', renderPath: { id: 'current' }, root: { exportName: 'App' }, target: { exportName: 'Target' } },
  { id: 'alternate-path', renderPath: { id: 'alternate' }, root: { exportName: 'App' }, target: { exportName: 'Target' } },
];
const descriptor = {
  exportName: 'Target',
  sourcePath: '/workspace/Target.tsx',
  inspector: {
    executablePageCandidateId: 'current-path',
    pageCandidates: candidates,
    target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
  },
};
const previewInspectorSession = {
  interactionSequence: 0,
  selectedExportName: 'Target',
  selectedPageCandidateId: 'current-path',
  userSelectedPageCandidateId: '',
};
let admissionCallback;
let timeoutMs = 0;
function setTimeout(callback, delay) { admissionCallback = callback; timeoutMs = delay; return 1; }
function clearTimeout() {}
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function notifyPreviewInspector() {}
function persistPreviewInspectorState() {}
function previewInspectorPostHostMessage() {}
function resetPreviewInspectorTargetReachability() {}
function schedulePreviewInspectorCommitRefresh() {}
${createPreviewInspectorPageCandidateRuntimeSource()}
selectPreviewInspectorPageCandidate('alternate-path');
const pendingBeforeTimeout = previewInspectorSession.pendingPageCandidateId;
admissionCallback();
globalThis.__result = {
  errorMessage: previewInspectorSession.pendingPageCandidateError.message,
  pendingAfterTimeout: previewInspectorSession.pendingPageCandidateId,
  pendingBeforeTimeout,
  timeoutMs,
};
`,
    context,
  );
  if (context.__result === undefined) throw new Error('Admission timeout fixture did not load.');
  return context.__result;
}

/** Executes the generated user-priority transaction without React or application modules. */
function evaluateQueuedPageCandidateSelection(): QueuedSelectionResult {
  const context: { __result?: QueuedSelectionResult } = {};
  vm.runInNewContext(
    `
const React = { Component: class {} };
const previewEntryRevision = 7;
const previewRuntimeRevision = 7;
const candidates = [
  { id: 'current-path', renderPath: { id: 'current' }, root: { exportName: 'App' }, target: { exportName: 'Target' } },
  { id: 'automatic-path', renderPath: { id: 'automatic' }, root: { exportName: 'App' }, target: { exportName: 'Target' } },
  { id: 'user-path', renderPath: { id: 'user' }, root: { exportName: 'App' }, target: { exportName: 'Target' } },
];
const descriptor = {
  exportName: 'Target',
  sourcePath: '/workspace/Target.tsx',
  inspector: {
    executablePageCandidateId: 'current-path',
    pageCandidates: candidates,
    target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
  },
};
const previewInspectorSession = {
  interactionSequence: 1,
  pendingPageCandidateId: 'automatic-path',
  pendingPageCandidateInteractionId: 'page:7:1',
  pendingPageCandidateOrigin: 'neural-page-context',
  pendingPageCandidateTimeout: undefined,
  queuedPageCandidateId: undefined,
  selectedExportName: 'Target',
  selectedPageCandidateId: 'current-path',
  userSelectedPageCandidateId: '',
};
let timeoutMs = 0;
const postedCandidateIds = [];
function setTimeout(_callback, delay) { timeoutMs = delay; return 1; }
function clearTimeout() {}
function findSelectedPreviewInspectorDescriptor() { return descriptor; }
function notifyPreviewInspector() {}
function persistPreviewInspectorState() {}
function previewInspectorPostHostMessage(message) { postedCandidateIds.push(message.candidateId); }
function resetPreviewInspectorTargetReachability() {}
function schedulePreviewInspectorCommitRefresh() {}
${createPreviewInspectorPageCandidateRuntimeSource()}
selectPreviewInspectorPageCandidate('user-path');
const queuedAfterChoice = previewInspectorSession.queuedPageCandidateId;
const pendingAfterChoice = previewInspectorSession.pendingPageCandidateId;
const selectedAfterChoice = previewInspectorSession.selectedPageCandidateId;
const userSelectedAfterChoice = previewInspectorSession.userSelectedPageCandidateId;
handlePreviewInspectorPageCandidateSelectionStatus({
  buildRevision: 8,
  candidateId: 'automatic-path',
  interactionId: 'page:7:1',
  status: 'committed',
  type: 'react-preview-inspector-page-candidate-selection-status',
});
globalThis.__result = {
  pendingAfterChoice,
  postedCandidateIds,
  queuedAfterChoice,
  queuedAfterCommit: previewInspectorSession.queuedPageCandidateId,
  selectedAfterChoice,
  timeoutMs,
  userSelectedAfterChoice,
};
`,
    context,
  );
  if (context.__result === undefined) throw new Error('Queued selection fixture did not load.');
  return context.__result;
}

/** Renders only the grouped wrapper inventory and invokes its first native row button. */
function evaluateWrapperPathChoice(initialScenario = 'authored-page'): WrapperChoiceResult {
  const context: { __result?: WrapperChoiceResult } = {};
  vm.runInNewContext(
    `
const selectedCandidateIds = [];
let scenario = ${JSON.stringify(initialScenario)};
const React = {
  Fragment: 'fragment',
  createElement(type, props, ...children) {
    const nextProps = { ...(props ?? {}), children };
    return typeof type === 'function' ? type(nextProps) : { props: nextProps, type };
  },
};
const previewInspectorSession = { pendingPageCandidateId: undefined };
function readPreviewInspectorRenderScenario() { return scenario; }
function setPreviewInspectorRenderScenario(nextScenario) { scenario = nextScenario; }
function readPreviewInspectorPageContextPossibilities() {
  return [
    {
      active: true,
      candidateId: 'same-wrapper-next-mount',
      evaluatedVariantCount: 1,
      id: 'wrapper-a',
      index: 0,
      kinds: ['JSX wrapper'],
      pathSegments: ['Page', 'CardSkeleton', 'Skeleton'],
      pending: false,
      queued: false,
      selectable: true,
      state: 'active',
      statusLabel: 'ACTIVE',
      variantCount: 2,
      wrapperNames: ['CardSkeleton'],
    },
    {
      active: false,
      candidateId: 'other-wrapper',
      evaluatedVariantCount: 0,
      id: 'wrapper-b',
      index: 1,
      kinds: ['local owner'],
      pathSegments: ['Step3', 'Skeleton'],
      pending: false,
      queued: false,
      selectable: true,
      state: 'available',
      statusLabel: 'AVAILABLE',
      variantCount: 1,
      wrapperNames: ['Step3'],
    },
  ];
}
function readPreviewInspectorPageContextPathSurface() {
  const paths = readPreviewInspectorPageContextPossibilities();
  return {
    mountVariantCount: paths.reduce((count, path) => count + path.variantCount, 0),
    paths,
    summary: undefined,
  };
}
function readSelectedPreviewInspectorPageCandidate() { return undefined; }
function readPreviewInspectorTargetReachabilityState() { return undefined; }
function selectPreviewInspectorPageCandidate(candidateId) { selectedCandidateIds.push(candidateId); }
function applyPreviewInspectorPageCandidateChoice(candidateId) {
  if (readPreviewInspectorRenderScenario() === 'file-components') {
    setPreviewInspectorRenderScenario('authored-page');
  }
  selectPreviewInspectorPageCandidate(candidateId);
  return true;
}
${createPreviewInspectorPageCandidateUiRuntimeSource()}
function collectButtons(node, buttons = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, buttons);
    return buttons;
  }
  if (node === null || typeof node !== 'object') return buttons;
  if (node.type === 'button') buttons.push(node);
  collectButtons(node.props?.children, buttons);
  return buttons;
}
const tree = PreviewInspectorPagePathSurface({ descriptor: {} });
const buttons = collectButtons(tree);
buttons[0]?.props.onClick();
globalThis.__result = {
  accordionLabel: formatPreviewInspectorPageContextAccordionLabel({}),
  buttonCount: buttons.length,
  disabled: buttons.map((button) => button.props.disabled === true),
  scenario,
  selectedCandidateIds,
};
`,
    context,
  );
  if (context.__result === undefined) throw new Error('Wrapper choice fixture did not load.');
  return context.__result;
}
