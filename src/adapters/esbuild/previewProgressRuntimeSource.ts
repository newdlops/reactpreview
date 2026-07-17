/**
 * Generates the browser-side progress protocol used after a preview document is already mounted.
 * The runtime validates extension messages, rejects stale revisions, and updates extension-owned
 * Shadow DOM so project selectors cannot restyle or hide preparation feedback.
 */
import {
  PREVIEW_PROGRESS_MESSAGE_TYPE,
  PREVIEW_PROGRESS_STAGES,
} from '../../domain/previewProgress';

/**
 * Creates self-contained JavaScript interpolated into the generated preview entry.
 *
 * The source expects `previewHotRuntime` and `mountNode` from the surrounding entry. It deliberately
 * uses DOM text nodes instead of HTML parsing, performs no network work, and exposes no workspace
 * paths or project values.
 *
 * @returns Browser JavaScript that installs one revision-aware progress message listener.
 */
export function createPreviewProgressRuntimeSource(): string {
  const encodedMessageType = JSON.stringify(PREVIEW_PROGRESS_MESSAGE_TYPE);
  const encodedStages = JSON.stringify(PREVIEW_PROGRESS_STAGES);
  return `
const PREVIEW_PROGRESS_MESSAGE_TYPE = ${encodedMessageType};
const PREVIEW_PROGRESS_STAGES = ${encodedStages};
const PREVIEW_PROGRESS_HOST_ID = 'react-preview-progress-host';
const PREVIEW_PROGRESS_PANEL_ID = 'react-preview-progress-panel';

/** Accepts only bounded extension-owned progress snapshots. */
function readPreviewProgressMessage(value) {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const { complete, detail, label, revision, stage, step, total, type } = value;
  const stageIndex = PREVIEW_PROGRESS_STAGES.indexOf(stage);
  const expectedTotal = PREVIEW_PROGRESS_STAGES.length - 1;
  const expectedStep = Math.min(stageIndex + 1, expectedTotal);
  if (
    type !== PREVIEW_PROGRESS_MESSAGE_TYPE ||
    typeof complete !== 'boolean' ||
    typeof detail !== 'string' ||
    detail.length === 0 ||
    detail.length > 320 ||
    typeof label !== 'string' ||
    label.length === 0 ||
    label.length > 160 ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof stage !== 'string' ||
    stageIndex < 0 ||
    !Number.isSafeInteger(step) ||
    !Number.isSafeInteger(total) ||
    step < 1 ||
    total < 1 ||
    total > 32 ||
    step > total ||
    total !== expectedTotal ||
    step !== expectedStep ||
    complete !== (stage === 'ready')
  ) {
    return undefined;
  }
  return { complete, detail, label, revision, stage, step, total };
}

/** Builds isolated fallback chrome when a complete document did not provide declarative Shadow DOM. */
function createPreviewProgressShadowContent(shadowRoot) {
  const style = document.createElement('style');
  style.textContent =
    ':host { all: initial !important; position: fixed !important; inset: 12px 12px auto auto !important; ' +
    'z-index: 2147483647 !important; max-width: min(360px, calc(100vw - 24px)) !important; color-scheme: light dark !important; } ' +
    ':host([hidden]) { display: none !important; } ' +
    '#react-preview-progress-panel { display: grid; box-sizing: border-box; min-width: 260px; gap: 6px; padding: 10px 12px; ' +
    'border: 1px solid var(--vscode-panel-border); border-radius: 6px; color: var(--vscode-editor-foreground); ' +
    'background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); box-shadow: 0 6px 20px rgba(0,0,0,.18); ' +
    'font: 12px/1.45 var(--vscode-font-family); } ' +
    '#react-preview-progress-label { font-weight: 600; } ' +
    '#react-preview-progress-detail, #react-preview-progress-step { color: var(--vscode-descriptionForeground); } ' +
    '#react-preview-progress-track { position: relative; height: 2px; overflow: hidden; border-radius: 999px; background: var(--vscode-panel-border); } ' +
    '#react-preview-progress-track > span { position: absolute; inset: 0 auto 0 -35%; width: 35%; border-radius: inherit; ' +
    'background: var(--vscode-progressBar-background, var(--vscode-button-background)); animation: slide 1.2s ease-in-out infinite; } ' +
    '@keyframes slide { 0% { transform: translateX(0); } 50% { transform: translateX(285%); } 100% { transform: translateX(0); } } ' +
    '@media (prefers-reduced-motion: reduce) { #react-preview-progress-track > span { animation: none; inset-inline-start: 32.5%; } }';
  const panel = document.createElement('section');
  panel.id = PREVIEW_PROGRESS_PANEL_ID;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-atomic', 'true');
  panel.setAttribute('aria-busy', 'true');
  panel.setAttribute('aria-live', 'polite');
  const label = document.createElement('div');
  label.id = 'react-preview-progress-label';
  const detail = document.createElement('div');
  detail.id = 'react-preview-progress-detail';
  const track = document.createElement('div');
  track.id = 'react-preview-progress-track';
  track.setAttribute('role', 'progressbar');
  track.append(document.createElement('span'));
  const step = document.createElement('div');
  step.id = 'react-preview-progress-step';
  panel.append(label, detail, track, step);
  shadowRoot.replaceChildren(style, panel);
}

/** Returns extension chrome, adopting a declarative template on older Chromium when necessary. */
function ensurePreviewProgressPanel() {
  let host = document.getElementById(PREVIEW_PROGRESS_HOST_ID);
  if (host === null || typeof host.attachShadow !== 'function') {
    host = document.createElement('aside');
    host.id = PREVIEW_PROGRESS_HOST_ID;
    document.body.append(host);
  }
  let shadowRoot = host.shadowRoot;
  if (shadowRoot === null) {
    const declarativeTemplate = host.querySelector('template[shadowrootmode]');
    shadowRoot = host.attachShadow({ mode: 'open' });
    if (
      declarativeTemplate !== null &&
      declarativeTemplate.content !== undefined &&
      typeof declarativeTemplate.content.cloneNode === 'function'
    ) {
      shadowRoot.append(declarativeTemplate.content.cloneNode(true));
      declarativeTemplate.remove();
    }
  }
  if (shadowRoot.getElementById(PREVIEW_PROGRESS_PANEL_ID) === null) {
    createPreviewProgressShadowContent(shadowRoot);
  }
  return { host, shadowRoot };
}

/** Applies a monotonic progress snapshot without allowing an older build to overwrite a newer one. */
function applyPreviewProgressMessage(message) {
  const currentRevision = Number.isSafeInteger(previewHotRuntime.progressRevision)
    ? previewHotRuntime.progressRevision
    : -1;
  const currentStep = Number.isSafeInteger(previewHotRuntime.progressStep)
    ? previewHotRuntime.progressStep
    : 0;
  const completedRevision = Number.isSafeInteger(previewHotRuntime.progressCompletedRevision)
    ? previewHotRuntime.progressCompletedRevision
    : -1;
  if (
    message.revision < currentRevision ||
    (!message.complete && message.revision <= completedRevision) ||
    (message.revision === currentRevision && !message.complete && message.step < currentStep)
  ) {
    return;
  }
  previewHotRuntime.progressRevision = message.revision;
  previewHotRuntime.progressStep = message.step;
  if (message.complete) {
    completePreviewProgress(message.revision);
    return;
  }
  const { host, shadowRoot } = ensurePreviewProgressPanel();
  host.hidden = false;
  const labelElement = shadowRoot.getElementById('react-preview-progress-label');
  const detailElement = shadowRoot.getElementById('react-preview-progress-detail');
  const stepElement = shadowRoot.getElementById('react-preview-progress-step');
  if (labelElement !== null) {
    labelElement.textContent = message.label;
  }
  if (detailElement !== null) {
    detailElement.textContent = message.detail;
  }
  const track = shadowRoot.getElementById('react-preview-progress-track');
  track?.setAttribute('aria-label', message.label);
  if (stepElement !== null) {
    stepElement.textContent = 'Step ' + String(message.step) + ' of ' + String(message.total);
  }
  if (typeof mountNode.setAttribute === 'function') {
    mountNode.setAttribute('aria-busy', 'true');
  }
}

/** Updates browser-bootstrap detail while retaining the extension-owned build milestone title. */
function updatePreviewProgressRuntimeDetail(detail) {
  if (typeof detail !== 'string' || detail.length === 0 || detail.length > 320) {
    return;
  }
  const host = document.getElementById(PREVIEW_PROGRESS_HOST_ID);
  const detailElement = host?.shadowRoot?.getElementById('react-preview-progress-detail');
  if (detailElement !== null && detailElement !== undefined && host !== null && !host.hidden) {
    detailElement.textContent = detail;
  }
}

/** Hides progress only when the completing module does not predate the latest build revision. */
function completePreviewProgress(revision) {
  const currentRevision = Number.isSafeInteger(previewHotRuntime.progressRevision)
    ? previewHotRuntime.progressRevision
    : -1;
  const completedRevision = Number.isSafeInteger(revision) ? revision : currentRevision;
  if (completedRevision < currentRevision) {
    return;
  }
  previewHotRuntime.progressRevision = completedRevision;
  previewHotRuntime.progressStep = PREVIEW_PROGRESS_STAGES.length - 1;
  previewHotRuntime.progressCompletedRevision = Math.max(
    Number.isSafeInteger(previewHotRuntime.progressCompletedRevision)
      ? previewHotRuntime.progressCompletedRevision
      : -1,
    completedRevision,
  );
  const host = document.getElementById(PREVIEW_PROGRESS_HOST_ID);
  if (host !== null && typeof host === 'object') {
    host.hidden = true;
  }
  if (typeof mountNode.setAttribute === 'function') {
    mountNode.setAttribute('aria-busy', 'false');
  }
}

if (!previewHotRuntime.progressMessageListenerInstalled) {
  window.addEventListener('message', (event) => {
    const message = readPreviewProgressMessage(event.data);
    if (message !== undefined) {
      try {
        applyPreviewProgressMessage(message);
      } catch (error) {
        console.warn('React Preview could not update its progress indicator.', error);
      }
    }
  });
  previewHotRuntime.progressMessageListenerInstalled = true;
}
`;
}
