/**
 * Generates the browser adapter that applies statically proven project document attributes.
 * Application markup is never copied into the webview; values are JSON-encoded and applied through
 * DOM APIs before setup or target modules load, preserving CSS selector and root-layout contracts.
 */
import type { PreviewDocumentShell, PreviewDocumentShellAttribute } from './previewDocumentShell';

/**
 * Creates a small idempotent runtime for html, body, and React mount attributes.
 * A hot revision removes only attributes previously owned by this adapter. Class tokens are diffed
 * individually so screen-mode or modal code can retain classes it added after the initial mount.
 *
 * @param shell Optional exact shell evidence discovered from a bounded project HTML document.
 * @returns Browser JavaScript defining `initializePreviewDocumentShell` for the generated entry.
 */
export function createPreviewDocumentShellRuntimeSource(
  shell: PreviewDocumentShell | undefined,
): string {
  const encodedShell = JSON.stringify(shell ?? createEmptyDocumentShell());
  return `
const previewDocumentShell = ${encodedShell};
const previewDocumentShellStateKey = Symbol.for('newdlops.react-file-preview.document-shell');

/** Applies one static attribute set while retaining project-added class tokens across hot revisions. */
function applyPreviewDocumentAttributes(element, attributes, previousAttributes) {
  if (element === null || typeof element !== 'object') return;
  const previousNames = new Set(previousAttributes.map((attribute) => attribute.name));
  const nextNames = new Set(attributes.map((attribute) => attribute.name));
  for (const attribute of previousAttributes) {
    if (nextNames.has(attribute.name)) continue;
    if (attribute.name === 'class') {
      for (const token of attribute.value.split(/\\s+/u).filter(Boolean)) {
        element.classList?.remove(token);
      }
    } else {
      element.removeAttribute?.(attribute.name);
    }
  }
  for (const attribute of attributes) {
    if (attribute.name === 'class') {
      const previous = previousAttributes.find((entry) => entry.name === 'class');
      for (const token of previous?.value.split(/\\s+/u).filter(Boolean) ?? []) {
        element.classList?.remove(token);
      }
      for (const token of attribute.value.split(/\\s+/u).filter(Boolean)) {
        element.classList?.add(token);
      }
      continue;
    }
    if (!previousNames.has(attribute.name) || element.getAttribute?.(attribute.name) !== attribute.value) {
      element.setAttribute?.(attribute.name, attribute.value);
    }
  }
}

/** Restores selector-relevant HTML shell evidence before any project module can read the document. */
function initializePreviewDocumentShell(mountNode) {
  const previous = globalThis[previewDocumentShellStateKey] ?? {
    bodyAttributes: [], htmlAttributes: [], rootAttributes: [],
  };
  applyPreviewDocumentAttributes(document.documentElement, previewDocumentShell.htmlAttributes, previous.htmlAttributes);
  applyPreviewDocumentAttributes(document.body, previewDocumentShell.bodyAttributes, previous.bodyAttributes);
  applyPreviewDocumentAttributes(mountNode, previewDocumentShell.rootAttributes, previous.rootAttributes);
  globalThis[previewDocumentShellStateKey] = previewDocumentShell;
}
`;
}

/** Returns a frozen-shape-compatible empty shell when no project HTML evidence exists. */
function createEmptyDocumentShell(): PreviewDocumentShell {
  const emptyAttributes: readonly PreviewDocumentShellAttribute[] = [];
  return {
    bodyAttributes: emptyAttributes,
    htmlAttributes: emptyAttributes,
    rootAttributes: emptyAttributes,
  };
}
