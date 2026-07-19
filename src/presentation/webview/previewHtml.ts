/**
 * Produces complete, reloadable webview documents for loading, success, and failure states.
 * All dynamic text and URI values are escaped, scripts are external ESM files, and the CSP blocks
 * network connections, frames, workers, forms, inline scripts, and dynamic code evaluation.
 */
import type { PreviewProgressStage } from '../../domain/previewProgress';
import {
  createPreviewProgressSnapshot,
  PREVIEW_PROGRESS_STEPS,
  type PreviewProgressSnapshot,
} from '../previewProgress';

/** UI state rendered while the current component is being bundled. */
export interface LoadingPreviewState {
  /** Discriminant used for exhaustive state rendering. */
  readonly kind: 'loading';
  /** Safe display name of the active source document. */
  readonly documentName: string;
  /** Latest preparation milestone accepted for the current panel revision. */
  readonly stage: Exclude<PreviewProgressStage, 'ready'>;
}

/** UI state rendered after a preview bundle has been published. */
export interface ReadyPreviewState {
  /** Discriminant used for exhaustive state rendering. */
  readonly kind: 'ready';
  /** Safe display name of the active source document. */
  readonly documentName: string;
  /** Webview URI for the generated ESM entry bundle. */
  readonly scriptUri: string;
  /** Session-owned acknowledgement token read by the generated entry after the document starts. */
  readonly runtimeToken?: string;
  /** Session revision correlated with the startup token without changing shared bundle bytes. */
  readonly runtimeRevision?: number;
  /** Optional webview URI for generated component CSS. */
  readonly stylesheetUri?: string;
}

/** UI state rendered for unsupported documents, compilation failures, or trust failures. */
export interface ErrorPreviewState {
  /** Optional escaped diagnostic detail shown in a preformatted block. */
  readonly details?: string;
  /** Discriminant used for exhaustive state rendering. */
  readonly kind: 'error';
  /** Concise explanation that helps the user recover. */
  readonly message: string;
  /** Short error heading. */
  readonly title: string;
}

/** Every complete state that can replace the preview webview document. */
export type PreviewHtmlState = ErrorPreviewState | LoadingPreviewState | ReadyPreviewState;

/**
 * Creates a secure standalone HTML document for one preview state.
 *
 * @param cspSource VS Code-provided local-resource source token for this webview.
 * @param state Loading, ready, or error content to render.
 * @returns Complete HTML assigned to `Webview.html`.
 */
export function createPreviewHtml(cspSource: string, state: PreviewHtmlState): string {
  const csp = [
    "default-src 'none'",
    `script-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    "connect-src 'none'",
    `media-src ${cspSource} data: blob:`,
    "worker-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(getDocumentTitle(state))}</title>
  <style>
    :root { color-scheme: light dark; }
    html, body, #react-preview-root { box-sizing: border-box; min-height: 100%; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    .react-preview-status { display: grid; min-height: 100vh; box-sizing: border-box; padding: 32px; place-content: center; text-align: center; }
    .react-preview-progress-card { display: grid; width: min(520px, calc(100vw - 48px)); gap: 10px; }
    .react-preview-progress-kicker { margin: 0; color: var(--vscode-descriptionForeground); font: 600 11px/1.4 var(--vscode-font-family); letter-spacing: .08em; text-transform: uppercase; }
    .react-preview-status h1 { margin: 0 0 8px; font: 600 18px/1.4 var(--vscode-font-family); }
    .react-preview-status p { margin: 0; color: var(--vscode-descriptionForeground); font: 13px/1.6 var(--vscode-font-family); }
    .react-preview-progress-track { position: relative; height: 3px; overflow: hidden; border-radius: 999px; background: var(--vscode-progressBar-background, var(--vscode-button-background)); opacity: .35; }
    .react-preview-progress-track > span { position: absolute; inset: 0 auto 0 -35%; width: 35%; border-radius: inherit; background: var(--vscode-progressBar-background, var(--vscode-button-background)); animation: react-preview-progress-slide 1.2s ease-in-out infinite; opacity: 1; }
    .react-preview-progress-active { color: var(--vscode-editor-foreground) !important; font-weight: 600 !important; }
    .react-preview-progress-steps { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
    .react-preview-progress-steps li { height: 3px; overflow: hidden; border-radius: 999px; background: var(--vscode-panel-border); text-indent: -9999px; }
    .react-preview-progress-steps li[data-state='complete'], .react-preview-progress-steps li[aria-current='step'] { background: var(--vscode-progressBar-background, var(--vscode-button-background)); }
    .react-preview-status pre { max-width: min(900px, 90vw); overflow: auto; padding: 16px; border: 1px solid var(--vscode-panel-border); text-align: left; white-space: pre-wrap; }
    [data-react-preview-mount] .react-preview-runtime-error { all: initial !important; display: block !important; box-sizing: border-box !important; max-width: min(1100px, calc(100vw - 32px)) !important; max-height: calc(100vh - 32px) !important; margin: 16px !important; overflow: auto !important; padding: 16px !important; border: 1px solid var(--vscode-panel-border) !important; border-radius: 4px !important; color: var(--vscode-errorForeground) !important; background: var(--vscode-editor-background) !important; font: 12px/1.55 var(--vscode-editor-font-family) !important; text-align: left !important; white-space: pre-wrap !important; }
    .react-preview-gallery { display: grid; gap: 24px; min-width: 0; counter-reset: react-preview-export; }
    .react-preview-export-label { all: initial; display: block; box-sizing: border-box; width: max-content; max-width: 100%; margin: 8px 0 4px; padding: 2px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); font: 11px/1.4 var(--vscode-font-family); counter-increment: react-preview-export; }
    .react-preview-export-label::before { content: counter(react-preview-export) ". "; color: var(--vscode-disabledForeground); }
    [data-react-preview-mount] .react-preview-export-error { all: initial !important; display: grid !important; box-sizing: border-box !important; max-width: min(720px, 100%) !important; gap: 4px !important; overflow: auto !important; padding: 10px 12px !important; border: 1px dashed var(--vscode-editorWarning-foreground) !important; border-radius: 4px !important; color: var(--vscode-descriptionForeground) !important; background: var(--vscode-editor-background) !important; font: 12px/1.45 var(--vscode-font-family) !important; text-align: left !important; white-space: normal !important; }
    [data-react-preview-mount] .react-preview-export-error strong { color: var(--vscode-editorWarning-foreground) !important; font-weight: 600 !important; }
    .react-preview-empty-gallery { display: grid; min-height: 100vh; place-content: center; text-align: center; }
    @keyframes react-preview-progress-slide { 0% { transform: translateX(0); } 50% { transform: translateX(285%); } 100% { transform: translateX(0); } }
    @media (prefers-reduced-motion: reduce) { .react-preview-progress-track > span { animation: none; inset-inline-start: 32.5%; } }
  </style>
  ${createStylesheetElement(state)}
</head>
<body>
  ${createBody(state)}
</body>
</html>`;
}

/**
 * Selects the browser-tab title for a complete preview state.
 *
 * @param state Current preview UI state.
 * @returns Human-readable title that is escaped by the caller.
 */
function getDocumentTitle(state: PreviewHtmlState): string {
  return state.kind === 'error' ? state.title : `React Preview: ${state.documentName}`;
}

/**
 * Creates the optional external stylesheet link for a successful build.
 *
 * @param state Current preview UI state.
 * @returns Escaped link element or an empty string when no stylesheet exists.
 */
function createStylesheetElement(state: PreviewHtmlState): string {
  if (state.kind !== 'ready' || state.stylesheetUri === undefined) {
    return '';
  }

  return `<link id="react-preview-stylesheet" rel="stylesheet" href="${escapeHtml(state.stylesheetUri)}">`;
}

/**
 * Creates the state-specific webview body and external module script.
 *
 * @param state Current preview UI state.
 * @returns HTML fragment whose dynamic values have already been escaped.
 */
function createBody(state: PreviewHtmlState): string {
  switch (state.kind) {
    case 'loading': {
      const progress = createPreviewProgressSnapshot(state.stage);
      return `<main class="react-preview-status" aria-busy="true">
  <section class="react-preview-progress-card" role="status" aria-live="polite">
    <p class="react-preview-progress-kicker">Preparing React Preview</p>
    <h1>${escapeHtml(state.documentName)}</h1>
    ${createProgressTrack(progress)}
    <p class="react-preview-progress-active">Step ${progress.step.toString()} of ${progress.total.toString()} · ${escapeHtml(progress.label)}</p>
    <p>${escapeHtml(progress.detail)}</p>
    ${createProgressSteps(progress)}
  </section>
</main>`;
    }
    case 'error': {
      const details = state.details === undefined ? '' : `<pre>${escapeHtml(state.details)}</pre>`;
      return `<main class="react-preview-status">
  <h1>${escapeHtml(state.title)}</h1>
  <p>${escapeHtml(state.message)}</p>
  ${details}
</main>`;
    }
    case 'ready':
      return `${createReadyProgressHost(createPreviewProgressSnapshot('loading-preview'))}
<div id="react-preview-root" data-react-preview-mount aria-busy="true"${createRuntimeHandshakeAttributes(state)}></div>
<script type="module" src="${escapeHtml(state.scriptUri)}"></script>`;
  }
}

/** Encodes optional startup correlation data without supplying it to project component props. */
function createRuntimeHandshakeAttributes(state: ReadyPreviewState): string {
  const tokenAttribute =
    state.runtimeToken === undefined
      ? ''
      : ` data-react-preview-runtime-token="${escapeHtml(state.runtimeToken)}"`;
  const revisionAttribute =
    state.runtimeRevision === undefined
      ? ''
      : ` data-react-preview-runtime-revision="${state.runtimeRevision.toString()}"`;
  return tokenAttribute + revisionAttribute;
}

/** Creates an indeterminate accessible activity bar without inventing time-based completion. */
function createProgressTrack(progress: PreviewProgressSnapshot): string {
  return `<div class="react-preview-progress-track" role="progressbar" aria-label="${escapeHtml(progress.label)}"><span></span></div>`;
}

/** Creates one compact marker per real preparation milestone for full-screen loading documents. */
function createProgressSteps(progress: PreviewProgressSnapshot): string {
  const steps = PREVIEW_PROGRESS_STEPS.map((step, index) => {
    const position = index + 1;
    const state =
      position < progress.step ? 'complete' : position === progress.step ? 'active' : 'pending';
    const current = state === 'active' ? ' aria-current="step"' : '';
    return `<li data-state="${state}"${current}>${escapeHtml(step.label)}</li>`;
  }).join('');
  return `<ol class="react-preview-progress-steps" aria-label="Preview preparation steps">${steps}</ol>`;
}

/**
 * Creates extension-owned ready-document chrome inside declarative Shadow DOM. Project CSS cannot
 * restyle the panel while the generated module is still loading; the runtime removes it on mount.
 */
function createReadyProgressHost(progress: PreviewProgressSnapshot): string {
  return `<aside id="react-preview-progress-host">
  <template shadowrootmode="open">
    <style>
      :host { all: initial !important; position: fixed !important; inset: 12px 12px auto auto !important; z-index: 2147483647 !important; max-width: min(360px, calc(100vw - 24px)) !important; color-scheme: light dark !important; }
      :host([hidden]) { display: none !important; }
      #react-preview-progress-panel { display: grid; box-sizing: border-box; min-width: 260px; gap: 6px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; color: var(--vscode-editor-foreground); background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); box-shadow: 0 6px 20px rgba(0,0,0,.18); font: 12px/1.45 var(--vscode-font-family); }
      #react-preview-progress-label { font-weight: 600; }
      #react-preview-progress-detail, #react-preview-progress-step { color: var(--vscode-descriptionForeground); }
      #react-preview-progress-track { position: relative; height: 2px; overflow: hidden; border-radius: 999px; background: var(--vscode-panel-border); }
      #react-preview-progress-track > span { position: absolute; inset: 0 auto 0 -35%; width: 35%; border-radius: inherit; background: var(--vscode-progressBar-background, var(--vscode-button-background)); animation: slide 1.2s ease-in-out infinite; }
      @keyframes slide { 0% { transform: translateX(0); } 50% { transform: translateX(285%); } 100% { transform: translateX(0); } }
      @media (prefers-reduced-motion: reduce) { #react-preview-progress-track > span { animation: none; inset-inline-start: 32.5%; } }
    </style>
    <section id="react-preview-progress-panel" role="status" aria-atomic="true" aria-busy="true" aria-live="polite">
      <div id="react-preview-progress-label">${escapeHtml(progress.label)}</div>
      <div id="react-preview-progress-detail">${escapeHtml(progress.detail)}</div>
      <div id="react-preview-progress-track" role="progressbar" aria-label="${escapeHtml(progress.label)}"><span></span></div>
      <div id="react-preview-progress-step">Step ${progress.step.toString()} of ${progress.total.toString()}</div>
    </section>
  </template>
</aside>`;
}

/**
 * Encodes untrusted values for HTML text and quoted-attribute contexts.
 *
 * @param value Dynamic string originating from paths, diagnostics, or generated URIs.
 * @returns HTML-safe representation that cannot create tags or attributes.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}
