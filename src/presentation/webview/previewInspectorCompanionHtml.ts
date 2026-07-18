/**
 * Creates the extension-owned document shown in the separate React Inspector editor tab.
 * The document never evaluates project JavaScript: it accepts a bounded UI mirror, removes active
 * content, applies VS Code-native styling, and forwards only explicit form/tree interactions.
 */

/** Complete state needed to render one independently reloadable Inspector companion document. */
export interface PreviewInspectorCompanionHtmlOptions {
  /** VS Code local-resource source token retained for a restrictive default policy. */
  readonly cspSource: string;
  /** Basename-only source label shown while the preview runtime prepares its first snapshot. */
  readonly documentName: string;
  /** Per-document random nonce authorizing only the bridge script emitted below. */
  readonly nonce: string;
}

/**
 * Produces one CSP-restricted Inspector tab whose markup remains inert until a preview snapshot.
 *
 * @param options Webview CSP token, source label, and random inline-script nonce.
 * @returns Complete HTML assigned to the companion `Webview.html` property.
 */
export function createPreviewInspectorCompanionHtml(
  options: PreviewInspectorCompanionHtmlOptions,
): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${options.nonce}'`,
    "style-src 'unsafe-inline'",
    `img-src ${options.cspSource} data:`,
    `font-src ${options.cspSource} data:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React Inspector: ${escapeHtml(options.documentName)}</title>
  <style>
    :root { color-scheme: light dark; }
    html, body { box-sizing: border-box; height: 100%; }
    body { margin: 0; overflow: hidden; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    #react-preview-inspector-status { display: grid; box-sizing: border-box; min-height: 100%; gap: 8px; padding: 32px; place-content: center; text-align: center; }
    #react-preview-inspector-status h1 { margin: 0; font: 600 18px/1.4 var(--vscode-font-family); }
    #react-preview-inspector-status p { max-width: 560px; margin: 0; color: var(--vscode-descriptionForeground); font: 13px/1.55 var(--vscode-font-family); }
    #react-preview-inspector-mirror { box-sizing: border-box; height: 100%; max-width: 100%; min-height: 0; min-width: 0; overflow: hidden; width: 100%; }
    #react-preview-inspector-mirror[hidden], #react-preview-inspector-status[hidden] { display: none; }
  </style>
</head>
<body>
  <main id="react-preview-inspector-status" role="status" aria-live="polite">
    <h1>React Page Inspector</h1>
    <p>Waiting for ${escapeHtml(options.documentName)} to finish its first render.</p>
    <p>The preview remains the single project runtime; this tab receives only Inspector controls.</p>
  </main>
  <section id="react-preview-inspector-mirror" aria-label="React Page Inspector" hidden></section>
  <script nonce="${escapeHtml(options.nonce)}">
    (() => {
      'use strict';
      const vscode = acquireVsCodeApi();
      const mirror = document.getElementById('react-preview-inspector-mirror');
      const status = document.getElementById('react-preview-inspector-status');
      const allowedTags = new Set([
        'ASIDE', 'BUTTON', 'CODE', 'DETAILS', 'DIV', 'INPUT', 'LABEL', 'LI', 'OL',
        'OPTION', 'P', 'PRE', 'SECTION', 'SELECT', 'SPAN', 'STRONG', 'SUMMARY',
        'TEXTAREA', 'UL'
      ]);
      const simpleAttributes = new Set([
        'checked', 'class', 'disabled', 'id', 'open', 'placeholder', 'readonly', 'role',
        'selected', 'spellcheck', 'tabindex', 'title', 'type', 'value'
      ]);
      const navigationKeys = new Set([
        ' ', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter'
      ]);
      let latestSequence = 0;

      /** Removes executable or resource-loading markup before a preview mirror reaches the DOM. */
      function sanitizeInspectorMarkup(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        for (const element of [...template.content.querySelectorAll('*')]) {
          if (!allowedTags.has(element.tagName)) {
            element.replaceWith(...element.childNodes);
            continue;
          }
          for (const attribute of [...element.attributes]) {
            const name = attribute.name.toLowerCase();
            const retained = simpleAttributes.has(name) || name.startsWith('aria-') ||
              name.startsWith('data-rpi-') || name.startsWith('data-react-preview-');
            if (!retained) element.removeAttribute(attribute.name);
          }
        }
        return template.content;
      }

      /** Removes network-bearing CSS constructs while retaining the extension-generated rules. */
      function sanitizeInspectorCss(css) {
        return css
          .replace(/@import[^;]*(?:;|$)/giu, '')
          .replace(/url\\s*\\([^)]*\\)/giu, 'none');
      }

      /** Forces the formerly floating shell to occupy only this dedicated editor document. */
      function createCompanionOverrideStyle() {
        const style = document.createElement('style');
        style.textContent = [
          ':host{display:block;height:100%}',
          '.rpi-shell[data-react-preview-companion-source="true"]{',
          'border:0!important;box-shadow:none!important;display:grid!important;',
          'grid-template-rows:auto auto minmax(0,1fr)!important;height:100%!important;',
          'inset:auto!important;max-width:100%!important;min-width:0!important;position:relative!important;',
          'transform:none!important;width:100%!important}',
          '.rpi-shell[data-collapsed="true"] .rpi-page-context{display:grid!important}',
          '.rpi-shell[data-collapsed="true"] .rpi-workbench{display:grid!important}',
          '.rpi-page-context,.rpi-workbench,.rpi-pane,.rpi-pane-heading{max-width:100%!important;min-width:0!important}',
          '.rpi-workbench{min-height:0!important;overflow:hidden!important}',
          '.rpi-wireframe-layer,.rpi-resize-handle,.rpi-move-handle{display:none!important}',
          '.rpi-toolbar select[aria-label="Inspector position"]{display:none!important}',
          '.rpi-toolbar button[title="Collapse inspector"],',
          '.rpi-toolbar button[title="Expand inspector"]{display:none!important}'
        ].join('');
        return style;
      }

      /** Restores focus and a text selection after a semantic snapshot replaces mirrored markup. */
      function restoreControlFocus(remoteId, selectionStart, selectionEnd) {
        if (remoteId === undefined) return;
        const control = mirror.querySelector('[data-rpi-remote-id="' + remoteId + '"]');
        control?.focus?.({ preventScroll: true });
        if (typeof control?.setSelectionRange !== 'function') return;
        try { control.setSelectionRange(selectionStart, selectionEnd); } catch { /* Not a text control. */ }
      }

      /** Commits one newer inert Inspector snapshot while preserving an actively edited control. */
      function renderSnapshot(message) {
        if (message.sequence === 1) latestSequence = 0;
        if (!Number.isSafeInteger(message.sequence) || message.sequence <= latestSequence) return;
        latestSequence = message.sequence;
        const active = document.activeElement?.closest?.('[data-rpi-remote-id]');
        const activeId = active?.getAttribute?.('data-rpi-remote-id') ?? undefined;
        const selectionStart = active?.selectionStart;
        const selectionEnd = active?.selectionEnd;
        const fragment = sanitizeInspectorMarkup(message.html);
        const style = document.createElement('style');
        style.textContent = sanitizeInspectorCss(message.css);
        mirror.replaceChildren(style, createCompanionOverrideStyle(), fragment);
        status.hidden = true;
        mirror.hidden = false;
        restoreControlFocus(activeId, selectionStart, selectionEnd);
      }

      /** Returns the nearest preview-minted interaction identity for one delegated browser event. */
      function findRemoteControl(event) {
        return event.target instanceof Element
          ? event.target.closest('[data-rpi-remote-id]')
          : null;
      }

      /** Sends source metadata only from a real click in this extension-owned companion document. */
      function postSourceClick(control) {
        if (control?.getAttribute?.('data-react-preview-source-open') !== 'true') return false;
        const sourcePath = control.getAttribute('data-rpi-source-path');
        if (sourcePath === null || sourcePath.length === 0) return true;
        const message = {
          sourcePath,
          type: 'react-preview-inspector-companion-open-source'
        };
        for (const [attribute, property] of [
          ['data-rpi-source-line', 'line'],
          ['data-rpi-source-column', 'column'],
          ['data-rpi-source-offset', 'occurrenceStart']
        ]) {
          const rawValue = control.getAttribute(attribute);
          if (rawValue === null) continue;
          const numericValue = Number(rawValue);
          if (Number.isSafeInteger(numericValue)) message[property] = numericValue;
        }
        vscode.postMessage(message);
        return true;
      }

      /** Sends only the serializable control state needed to reconstruct one preview-side event. */
      function postControlEvent(control, eventType, key) {
        const remoteId = control?.getAttribute?.('data-rpi-remote-id');
        if (remoteId === null || remoteId === undefined) return;
        const message = {
          eventType,
          remoteId,
          type: 'react-preview-inspector-companion-action'
        };
        if ('value' in control && typeof control.value === 'string') message.value = control.value;
        if ('checked' in control && typeof control.checked === 'boolean') {
          message.checked = control.checked;
        }
        if (key !== undefined) message.key = key;
        vscode.postMessage(message);
      }

      mirror.addEventListener('click', (event) => {
        const control = findRemoteControl(event);
        if (control === null || control instanceof HTMLSelectElement ||
          control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        if (postSourceClick(control)) return;
        postControlEvent(control, 'click');
      });
      mirror.addEventListener('dblclick', (event) => {
        const control = findRemoteControl(event);
        if (control === null || control.matches('input,textarea,select')) return;
        event.preventDefault();
        postControlEvent(control, 'dblclick');
      });
      mirror.addEventListener('input', (event) => {
        const control = findRemoteControl(event);
        if (control !== null && !(control instanceof HTMLSelectElement)) {
          postControlEvent(control, 'input');
        }
      });
      mirror.addEventListener('change', (event) => {
        const control = findRemoteControl(event);
        if (control !== null) postControlEvent(control, 'change');
      });
      mirror.addEventListener('keydown', (event) => {
        if (!navigationKeys.has(event.key)) return;
        const control = findRemoteControl(event);
        if (control === null || control.matches('input,textarea,select')) return;
        event.preventDefault();
        postControlEvent(control, 'keydown', event.key);
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === 'react-preview-inspector-companion-snapshot') {
          renderSnapshot(message);
        }
      });
      vscode.postMessage({ type: 'react-preview-inspector-companion-ready' });
    })();
  </script>
</body>
</html>`;
}

/** Escapes dynamic CSP, title, and nonce values before inserting them into document markup. */
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
