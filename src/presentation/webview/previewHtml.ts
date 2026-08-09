/**
 * Produces complete, reloadable webview documents for loading, success, and failure states.
 * All dynamic text and URI values are escaped, authored scripts are external ESM files, and the CSP
 * blocks active network connections, frames, workers, forms, untrusted inline scripts, and dynamic
 * code evaluation. Host-owned inline bootstrap scripts use per-document nonces.
 * Passive HTTPS images remain available because authored page visuals often live on a CDN.
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
  /** Browser import-map bindings for shared package modules loaded before the preview entry. */
  readonly moduleImports?: readonly {
    readonly specifier: string;
    readonly uri: string;
  }[];
  /** Safe display name of the active source document. */
  readonly documentName: string;
  /** Internal pre-entry browser host shim used only by opt-in headless execution. */
  readonly hostBridgeScriptUri?: string;
  /** Validated loopback origin used only for authored root-relative iframe documents. */
  readonly publicApplicationOrigin?: string;
  /** Host-authorized URI for the compiler-selected project `public` directory. */
  readonly publicAssetBaseUri?: string;
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
  /** Optional host-authorized retry action for transient build or bootstrap failures. */
  readonly retry?: {
    /** Current panel revision that owns this action. */
    readonly revision: number;
    /** Opaque host-generated action token. */
    readonly token: string;
  };
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
  const retryNonce =
    state.kind === 'error' && state.retry !== undefined ? createRetryNonce(state) : undefined;
  const readyScriptNonce = state.kind === 'ready' ? createReadyScriptNonce(state) : undefined;
  const publicApplicationOrigin =
    state.kind === 'ready'
      ? normalizePreviewPublicApplicationOrigin(state.publicApplicationOrigin)
      : undefined;
  const csp = [
    "default-src 'none'",
    `script-src ${cspSource}${retryNonce === undefined ? '' : ` 'nonce-${retryNonce}'`}${readyScriptNonce === undefined ? '' : ` 'nonce-${readyScriptNonce}'`}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob: https:`,
    `font-src ${cspSource} data: https:`,
    "connect-src 'none'",
    `media-src ${cspSource} data: blob:`,
    "worker-src 'none'",
    publicApplicationOrigin === undefined
      ? "frame-src 'none'"
      : `frame-src ${publicApplicationOrigin}`,
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
    body { margin: 0; }
    body:not([data-react-preview-state='ready']) { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    :where(body[data-react-preview-state='ready']) { color: #111; background: #fff; }
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
<body data-react-preview-state="${state.kind}">
  ${createBody(state, retryNonce, readyScriptNonce, publicApplicationOrigin)}
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
function createBody(
  state: PreviewHtmlState,
  retryNonce: string | undefined,
  readyScriptNonce: string | undefined,
  publicApplicationOrigin: string | undefined,
): string {
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
      const retry = state.retry === undefined ? '' : createRetryAction(state.retry, retryNonce);
      return `<main class="react-preview-status">
  <h1>${escapeHtml(state.title)}</h1>
  <p>${escapeHtml(state.message)}</p>
  ${details}
  ${retry}
</main>`;
    }
    case 'ready':
      return `${createReadyProgressHost(createPreviewProgressSnapshot('loading-preview'))}
<div id="react-preview-root" data-react-preview-mount aria-busy="true"${createRuntimeHandshakeAttributes(state)}></div>
${createModuleImportMapElement(state, readyScriptNonce)}${createPublicAssetCompatibilityScriptElement(state, readyScriptNonce)}${createApplicationFrameCompatibilityScriptElement(publicApplicationOrigin, readyScriptNonce)}${createGlobalCompatibilityScriptElement(readyScriptNonce)}${createHostBridgeScriptElement(state)}<script type="module" src="${escapeHtml(state.scriptUri)}"></script>`;
  }
}

/** Keeps presentation callers from widening frame navigation beyond a local development server. */
function normalizePreviewPublicApplicationOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const candidate = new URL(value);
    if (
      (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') ||
      candidate.username.length > 0 ||
      candidate.password.length > 0 ||
      !['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname)
    ) {
      return undefined;
    }
    return candidate.origin;
  } catch {
    return undefined;
  }
}

/** Creates the CSP-authorized import map required by externalized package modules. */
function createModuleImportMapElement(state: ReadyPreviewState, nonce: string | undefined): string {
  const moduleImports = state.moduleImports ?? [];
  if (moduleImports.length === 0 || nonce === undefined) return '';
  const imports = Object.fromEntries(
    [...moduleImports]
      .sort((left, right) => left.specifier.localeCompare(right.specifier))
      .map(({ specifier, uri }) => [specifier, uri]),
  );
  const json = JSON.stringify({ imports }).replaceAll('<', '\\u003c');
  return `<script type="importmap" nonce="${nonce}">${json}</script>\n`;
}

/** Derives a markup-safe nonce from the host-owned runtime correlation token. */
function createReadyScriptNonce(state: ReadyPreviewState): string {
  const token =
    state.runtimeToken ??
    `${(state.runtimeRevision ?? 0).toString()}:${state.scriptUri.length.toString()}`;
  return `module${token.replace(/[^A-Za-z0-9]/gu, '').slice(0, 32)}`;
}

/**
 * Rewrites only passive root-relative resource attributes to the project public directory.
 * React normally commits these values through `setAttribute`; property setters and an observer
 * cover imperative libraries without changing anchors, router locations, or remote/data URLs.
 */
function createPublicAssetCompatibilityScriptElement(
  state: ReadyPreviewState,
  nonce: string | undefined,
): string {
  if (nonce === undefined || state.publicAssetBaseUri === undefined) return '';
  const encodedBaseUri = JSON.stringify(state.publicAssetBaseUri).replaceAll('<', '\\u003c');
  const encodedRevision = JSON.stringify((state.runtimeRevision ?? 0).toString());
  return `<script nonce="${nonce}">
  (() => {
    const publicAssetBase = new URL(${encodedBaseUri});
    const previewRevision = ${encodedRevision};
    const resolveRootAsset = (value) => {
      if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\\\')) return value;
      try {
        const resolved = new URL(value.slice(1), publicAssetBase);
        if (resolved.origin !== publicAssetBase.origin || !resolved.pathname.startsWith(publicAssetBase.pathname)) return value;
        if (previewRevision !== '' && !resolved.searchParams.has('__react_preview_revision')) {
          resolved.searchParams.set('__react_preview_revision', previewRevision);
        }
        return resolved.toString();
      } catch { return value; }
    };
    const resolveSourceSet = (value) => typeof value !== 'string' ? value : value
      .split(',')
      .map((entry) => {
        const match = /^(\\s*)(\\/(?!\\/)\\S+)([\\s\\S]*)$/u.exec(entry);
        return match === null ? entry : match[1] + resolveRootAsset(match[2]) + match[3];
      })
      .join(',');
    const resourceKind = (element, attributeName) => {
      const name = String(attributeName).toLowerCase();
      const tagName = String(element?.localName ?? '').toLowerCase();
      if (name === 'srcset' && (tagName === 'img' || tagName === 'source')) return 'source-set';
      if (name === 'src' && ['audio', 'img', 'input', 'source', 'video'].includes(tagName)) return 'single';
      if (name === 'poster' && tagName === 'video') return 'single';
      if ((name === 'href' || name === 'xlink:href') && (tagName === 'image' || tagName === 'use')) return 'single';
      if (name === 'href' && tagName === 'link' && String(element.getAttribute('as')).toLowerCase() === 'image') return 'single';
      return undefined;
    };
    const resolveAttribute = (element, name, value) => {
      const kind = resourceKind(element, name);
      return kind === 'source-set' ? resolveSourceSet(value) : kind === 'single' ? resolveRootAsset(value) : value;
    };
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      return nativeSetAttribute.call(this, name, resolveAttribute(this, name, String(value)));
    };
    const nativeSetAttributeNS = Element.prototype.setAttributeNS;
    Element.prototype.setAttributeNS = function(namespace, name, value) {
      return nativeSetAttributeNS.call(this, namespace, name, resolveAttribute(this, name, String(value)));
    };
    const patchProperty = (constructorName, propertyName, kind) => {
      const Constructor = globalThis[constructorName];
      const descriptor = typeof Constructor === 'function'
        ? Object.getOwnPropertyDescriptor(Constructor.prototype, propertyName)
        : undefined;
      if (descriptor?.get === undefined || descriptor.set === undefined) return;
      try {
        Object.defineProperty(Constructor.prototype, propertyName, {
          ...descriptor,
          set(value) {
            descriptor.set.call(this, kind === 'source-set' ? resolveSourceSet(String(value)) : resolveRootAsset(String(value)));
          },
        });
      } catch {}
    };
    [
      ['HTMLImageElement', 'src', 'single'],
      ['HTMLImageElement', 'srcset', 'source-set'],
      ['HTMLSourceElement', 'src', 'single'],
      ['HTMLSourceElement', 'srcset', 'source-set'],
      ['HTMLVideoElement', 'src', 'single'],
      ['HTMLVideoElement', 'poster', 'single'],
      ['HTMLAudioElement', 'src', 'single'],
      ['HTMLInputElement', 'src', 'single'],
    ].forEach(([constructorName, propertyName, kind]) => patchProperty(constructorName, propertyName, kind));
    const rewriteElement = (element) => {
      if (!(element instanceof Element)) return;
      for (const name of ['src', 'srcset', 'poster', 'href', 'xlink:href']) {
        const value = element.getAttribute(name);
        if (value === null) continue;
        const resolved = resolveAttribute(element, name, value);
        if (resolved !== value) nativeSetAttribute.call(element, name, resolved);
      }
    };
    const rewriteTree = (root) => {
      rewriteElement(root);
      root?.querySelectorAll?.('[src],[srcset],[poster],[href]').forEach(rewriteElement);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') rewriteElement(record.target);
        for (const node of record.addedNodes ?? []) rewriteTree(node);
      }
    }).observe(document, {
      attributeFilter: ['src', 'srcset', 'poster', 'href', 'xlink:href'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    rewriteTree(document);
  })();
</script>
`;
}

/**
 * Rehomes only root-relative iframe documents onto a compiler-proven loopback application origin.
 * Every other URL and element retains the webview's isolated navigation behavior.
 */
function createApplicationFrameCompatibilityScriptElement(
  publicApplicationOrigin: string | undefined,
  nonce: string | undefined,
): string {
  if (publicApplicationOrigin === undefined || nonce === undefined) return '';
  const encodedOrigin = JSON.stringify(publicApplicationOrigin).replaceAll('<', '\\u003c');
  return `<script nonce="${nonce}">
  (() => {
    const applicationOrigin = new URL(${encodedOrigin});
    const bridgedFrames = new WeakSet();
    const frameWindowFacades = new WeakMap();
    const resolveRootFrame = (value) => {
      if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\\\')) return value;
      try {
        const resolved = new URL(value, applicationOrigin);
        return resolved.origin === applicationOrigin.origin ? resolved.toString() : value;
      } catch { return value; }
    };
    const markBridgedFrame = (element, value, resolved) => {
      if (element instanceof HTMLIFrameElement && resolved !== value) bridgedFrames.add(element);
      return resolved;
    };
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      const stringValue = String(value);
      const nextValue = String(name).toLowerCase() === 'src' && String(this.localName).toLowerCase() === 'iframe'
        ? markBridgedFrame(this, stringValue, resolveRootFrame(stringValue))
        : stringValue;
      return nativeSetAttribute.call(this, name, nextValue);
    };
    const srcDescriptor = typeof HTMLIFrameElement === 'function'
      ? Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
      : undefined;
    if (srcDescriptor?.get !== undefined && srcDescriptor.set !== undefined) {
      try {
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
          ...srcDescriptor,
          set(value) {
            const stringValue = String(value);
            srcDescriptor.set.call(
              this,
              markBridgedFrame(this, stringValue, resolveRootFrame(stringValue))
            );
          },
        });
      } catch {}
    }
    const contentWindowDescriptor = typeof HTMLIFrameElement === 'function'
      ? Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
      : undefined;
    const createFrameWindowFacade = (frame, targetWindow) => {
      const cached = frameWindowFacades.get(frame);
      if (cached?.targetWindow === targetWindow) return cached.facade;
      const bridgedPostMessage = (message, targetOrigin, transfer) => {
        let nextTargetOrigin = targetOrigin;
        if (targetOrigin === window.location.origin) {
          nextTargetOrigin = applicationOrigin.origin;
        } else if (
          targetOrigin !== null &&
          typeof targetOrigin === 'object' &&
          targetOrigin.targetOrigin === window.location.origin
        ) {
          nextTargetOrigin = { ...targetOrigin, targetOrigin: applicationOrigin.origin };
        }
        const postMessage = targetWindow.postMessage;
        return transfer === undefined
          ? postMessage.call(targetWindow, message, nextTargetOrigin)
          : postMessage.call(targetWindow, message, nextTargetOrigin, transfer);
      };
      const facade = new Proxy(Object.create(null), {
        get(_target, property) {
          if (property === 'postMessage') return bridgedPostMessage;
          const value = Reflect.get(targetWindow, property);
          return typeof value === 'function' ? value.bind(targetWindow) : value;
        },
        has(_target, property) { return Reflect.has(targetWindow, property); },
        set(_target, property, value) { return Reflect.set(targetWindow, property, value); },
      });
      frameWindowFacades.set(frame, { facade, targetWindow });
      return facade;
    };
    if (contentWindowDescriptor?.get !== undefined) {
      try {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          ...contentWindowDescriptor,
          get() {
            const targetWindow = contentWindowDescriptor.get.call(this);
            return targetWindow === null || !bridgedFrames.has(this)
              ? targetWindow
              : createFrameWindowFacade(this, targetWindow);
          },
        });
      } catch {}
    }
    const rewriteFrame = (element) => {
      if (!(element instanceof HTMLIFrameElement)) return;
      const value = element.getAttribute('src');
      if (value === null) return;
      const resolved = resolveRootFrame(value);
      if (resolved !== value) {
        bridgedFrames.add(element);
        nativeSetAttribute.call(element, 'src', resolved);
      }
    };
    const rewriteTree = (root) => {
      rewriteFrame(root);
      root?.querySelectorAll?.('iframe[src]').forEach(rewriteFrame);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') rewriteFrame(record.target);
        for (const node of record.addedNodes ?? []) rewriteTree(node);
      }
    }).observe(document, {
      attributeFilter: ['src'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    rewriteTree(document);
  })();
</script>
`;
}

/** Installs the legacy browser `global` alias before any static ESM dependency can evaluate. */
function createGlobalCompatibilityScriptElement(nonce: string | undefined): string {
  if (nonce === undefined) return '';
  return `<script nonce="${nonce}">
  (() => {
    if (Object.getOwnPropertyDescriptor(globalThis, 'global') !== undefined) return;
    try {
      Object.defineProperty(globalThis, 'global', {
        configurable: true,
        enumerable: false,
        value: globalThis,
        writable: true,
      });
    } catch {}
  })();
</script>
`;
}

/** Creates the optional headless host bridge immediately before the authored runtime entry. */
function createHostBridgeScriptElement(state: ReadyPreviewState): string {
  return state.hostBridgeScriptUri === undefined
    ? ''
    : `<script src="${escapeHtml(state.hostBridgeScriptUri)}"></script>
`;
}

/** Creates a host-only recovery button whose inline handler is authorized by a unique CSP nonce. */
function createRetryAction(
  retry: NonNullable<ErrorPreviewState['retry']>,
  nonce: string | undefined,
): string {
  if (nonce === undefined) return '';
  const token = escapeHtml(retry.token);
  return `<button type="button" data-react-preview-retry data-react-preview-retry-token="${token}" data-react-preview-retry-revision="${retry.revision.toString()}">Retry preview</button>
<script nonce="${nonce}">
  (() => {
    const button = document.querySelector('[data-react-preview-retry]');
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Retrying…';
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
      vscode?.postMessage({ type: 'react-preview-retry', token: button.dataset.reactPreviewRetryToken, revision: Number(button.dataset.reactPreviewRetryRevision) });
    });
  })();
</script>`;
}

/** Derives a CSP-safe opaque nonce from values already private to this one error document. */
function createRetryNonce(state: ErrorPreviewState): string {
  const retry = state.retry;
  if (retry === undefined) return '';
  return `${retry.revision.toString(36)}${retry.token.replace(/[^A-Za-z0-9]/gu, '').slice(0, 24)}`;
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
