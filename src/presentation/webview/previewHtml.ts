/**
 * Produces complete, reloadable webview documents for loading, success, and failure states.
 * All dynamic text and URI values are escaped, scripts are external ESM files, and the CSP blocks
 * network connections, frames, workers, forms, inline scripts, and dynamic code evaluation.
 */

/** UI state rendered while the current component is being bundled. */
export interface LoadingPreviewState {
  /** Discriminant used for exhaustive state rendering. */
  readonly kind: 'loading';
  /** Safe display name of the active source document. */
  readonly documentName: string;
}

/** UI state rendered after a preview bundle has been published. */
export interface ReadyPreviewState {
  /** Discriminant used for exhaustive state rendering. */
  readonly kind: 'ready';
  /** Safe display name of the active source document. */
  readonly documentName: string;
  /** Webview URI for the generated ESM entry bundle. */
  readonly scriptUri: string;
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
    .react-preview-status { display: grid; min-height: 100vh; padding: 32px; place-content: center; text-align: center; }
    .react-preview-status h1 { margin: 0 0 8px; font: 600 18px/1.4 var(--vscode-font-family); }
    .react-preview-status p { margin: 0; color: var(--vscode-descriptionForeground); font: 13px/1.6 var(--vscode-font-family); }
    .react-preview-status pre { max-width: min(900px, 90vw); overflow: auto; padding: 16px; border: 1px solid var(--vscode-panel-border); text-align: left; white-space: pre-wrap; }
    #react-preview-root .react-preview-runtime-error { all: initial !important; display: block !important; box-sizing: border-box !important; max-width: min(1100px, calc(100vw - 32px)) !important; max-height: calc(100vh - 32px) !important; margin: 16px !important; overflow: auto !important; padding: 16px !important; border: 1px solid var(--vscode-panel-border) !important; border-radius: 4px !important; color: var(--vscode-errorForeground) !important; background: var(--vscode-editor-background) !important; font: 12px/1.55 var(--vscode-editor-font-family) !important; text-align: left !important; white-space: pre-wrap !important; }
    .react-preview-gallery { display: grid; gap: 24px; min-width: 0; counter-reset: react-preview-export; }
    .react-preview-export-label { all: initial; display: block; box-sizing: border-box; width: max-content; max-width: 100%; margin: 8px 0 4px; padding: 2px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); font: 11px/1.4 var(--vscode-font-family); counter-increment: react-preview-export; }
    .react-preview-export-label::before { content: counter(react-preview-export) ". "; color: var(--vscode-disabledForeground); }
    #react-preview-root .react-preview-export-error { all: initial !important; display: block !important; box-sizing: border-box !important; max-width: min(1100px, 100%) !important; overflow: auto !important; padding: 16px !important; border: 1px solid var(--vscode-panel-border) !important; border-radius: 4px !important; color: var(--vscode-errorForeground) !important; background: var(--vscode-editor-background) !important; font: 12px/1.55 var(--vscode-editor-font-family) !important; text-align: left !important; white-space: pre-wrap !important; }
    .react-preview-empty-gallery { display: grid; min-height: 100vh; place-content: center; text-align: center; }
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
    case 'loading':
      return `<main class="react-preview-status">
  <h1>Building ${escapeHtml(state.documentName)}</h1>
  <p>Bundling the current editor without starting a web server…</p>
</main>`;
    case 'error': {
      const details = state.details === undefined ? '' : `<pre>${escapeHtml(state.details)}</pre>`;
      return `<main class="react-preview-status">
  <h1>${escapeHtml(state.title)}</h1>
  <p>${escapeHtml(state.message)}</p>
  ${details}
</main>`;
    }
    case 'ready':
      return `<div id="react-preview-root"></div>
<script type="module" src="${escapeHtml(state.scriptUri)}"></script>`;
  }
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
