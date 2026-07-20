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
 * @param portalHostIds Exact reached ReactDOM host IDs created only when currently absent.
 * @returns Browser JavaScript defining `initializePreviewDocumentShell` for the generated entry.
 */
export function createPreviewDocumentShellRuntimeSource(
  shell: PreviewDocumentShell | undefined,
  portalHostIds: readonly string[] = [],
): string {
  const encodedShell = JSON.stringify(shell ?? createEmptyDocumentShell());
  const encodedPortalHostIds = JSON.stringify(normalizePreviewPortalHostIds(portalHostIds));
  return `
const previewDocumentShell = ${encodedShell};
const previewPortalHostIds = ${encodedPortalHostIds};
const previewDocumentShellStateKey = Symbol.for('newdlops.react-file-preview.document-shell');
const previewPortalHostMarker = 'data-react-preview-portal-host';
const previewPortalHostOwner = 'newdlops.react-file-preview';

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
    bodyAttributes: [], htmlAttributes: [], rootAttributes: [], portalHosts: [],
  };
  applyPreviewDocumentAttributes(document.documentElement, previewDocumentShell.htmlAttributes, previous.htmlAttributes);
  applyPreviewDocumentAttributes(document.body, previewDocumentShell.bodyAttributes, previous.bodyAttributes);
  applyPreviewDocumentAttributes(mountNode, previewDocumentShell.rootAttributes, previous.rootAttributes);
  const portalHosts = initializePreviewPortalHosts(previous.portalHosts ?? []);
  globalThis[previewDocumentShellStateKey] = { ...previewDocumentShell, portalHosts };
}

/**
 * Reconciles only nodes created and retained by this adapter across hot runtime revisions.
 * Project nodes are never recorded, so an authored replacement with the same ID cannot be removed.
 */
function initializePreviewPortalHosts(previousPortalHosts) {
  if (document.body === null) return [];
  const nextIds = new Set(previewPortalHostIds);
  const retainedHosts = [];
  const previousRecords = Array.isArray(previousPortalHosts) ? previousPortalHosts : [];
  for (const record of previousRecords) {
    const element = record?.element;
    const owned =
      typeof record?.id === 'string' &&
      element?.getAttribute?.(previewPortalHostMarker) === previewPortalHostOwner;
    if (!owned) continue;
    if (nextIds.has(record.id) && document.getElementById(record.id) === element) {
      retainedHosts.push(record);
      continue;
    }
    if (!nextIds.has(record.id)) element.remove?.();
  }
  for (const hostId of previewPortalHostIds) {
    if (retainedHosts.some((record) => record.id === hostId)) continue;
    if (document.getElementById(hostId) !== null) continue;
    const host = document.createElement?.('div');
    if (host === undefined || host === null) continue;
    host.setAttribute?.('id', hostId);
    host.setAttribute?.(previewPortalHostMarker, previewPortalHostOwner);
    document.body.append?.(host);
    retainedHosts.push({ element: host, id: hostId });
  }
  return retainedHosts;
}
`;
}

/** De-duplicates and bounds IDs before they are serialized into the trusted browser entry. */
function normalizePreviewPortalHostIds(hostIds: readonly string[]): readonly string[] {
  return [
    ...new Set(
      hostIds.filter(
        (hostId) =>
          hostId.length > 0 && hostId.length <= 256 && !/[\u0000-\u0020\u007f]/u.test(hostId),
      ),
    ),
  ]
    .sort()
    .slice(0, 64);
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
