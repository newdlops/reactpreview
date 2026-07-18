/**
 * Generates shared evidence readers for React render failures.
 *
 * React removes a failed subtree before the component collector can inspect it. These helpers turn
 * the error message and `componentStack` captured by an error boundary into bounded component and
 * property-path evidence. Both the inline placeholder and the Elements-like tree consume the same
 * functions so they cannot disagree about which authored component was blocked.
 */

/** Maximum component names or property paths retained for one local render failure. */
export const PREVIEW_INSPECTOR_FAILURE_EVIDENCE_LIMIT = 32;

/**
 * Creates dependency-free browser helpers for classifying a contained React failure.
 *
 * @returns Plain JavaScript source concatenated before the selected-target boundary is declared.
 */
export function createPreviewInspectorFailureEvidenceRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_FAILURE_EVIDENCE_LIMIT = ${PREVIEW_INSPECTOR_FAILURE_EVIDENCE_LIMIT};

/** Bounds and deduplicates property paths supplied by compiler or runtime error evidence. */
function normalizePreviewInspectorRequiredPropertyPaths(paths) {
  const normalized = [];
  const seen = new Set();
  for (const candidate of Array.isArray(paths) ? paths : []) {
    if (typeof candidate !== 'string') continue;
    const path = candidate.trim().slice(0, 240);
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
    if (normalized.length >= PREVIEW_INSPECTOR_FAILURE_EVIDENCE_LIMIT) break;
  }
  return normalized;
}

/** Reads the error text without requiring a same-realm Error instance. */
function readPreviewInspectorFailureMessage(error) {
  try {
    return typeof error?.message === 'string' ? error.message : String(error ?? 'Unknown error');
  } catch {
    return 'Unknown error';
  }
}

/** Extracts the missing field/call/global named by common JavaScript runtime diagnostics. */
function readPreviewInspectorErrorPropertyPaths(error) {
  const message = readPreviewInspectorFailureMessage(error);
  const paths = [];
  const add = (path) => {
    if (typeof path === 'string' && path.length > 0) paths.push(path);
  };
  for (const match of message.matchAll(/reading ['"]([^'"]+)['"]/gu)) add(match[1]);
  for (const match of message.matchAll(/read property ['"]([^'"]+)['"]/gu)) add(match[1]);
  for (const match of message.matchAll(/Cannot destructure property ['"]([^'"]+)['"]/gu)) {
    add(match[1]);
  }
  for (const match of message.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+) is not a function\b/gu)) {
    add(match[1] + '()');
  }
  for (const match of message.matchAll(/\b([A-Za-z_$][\w$]*) is not defined\b/gu)) add(match[1]);
  return normalizePreviewInspectorRequiredPropertyPaths(paths);
}

/** Reports whether a stack label belongs to Inspector chrome or a host element, not project React. */
function isPreviewInspectorInternalStackName(name) {
  return name.startsWith('Preview') ||
    name.startsWith('ReactPreviewInspector') ||
    /^[a-z][a-z0-9-]*$/u.test(name) ||
    name === 'Suspense' ||
    name === 'Fragment';
}

/** Converts React's innermost-first component stack into unique authored component labels. */
function readPreviewInspectorComponentStackNames(componentStack, fallbackName = '') {
  const names = [];
  const seen = new Set();
  const text = typeof componentStack === 'string' ? componentStack : '';
  for (const line of text.split(/\r?\n/gu)) {
    const match = line.match(/^\s*at\s+(.+?)(?:\s+\(|$)/u);
    if (match === null) continue;
    const rawName = match[1].trim();
    const wrapperMatch = rawName.match(/^(?:ForwardRef|Memo)\((.+)\)$/u);
    const name = (wrapperMatch?.[1] ?? rawName).slice(0, 180);
    if (name.length === 0 || isPreviewInspectorInternalStackName(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= PREVIEW_INSPECTOR_FAILURE_EVIDENCE_LIMIT) break;
  }
  if (names.length === 0 && typeof fallbackName === 'string' && fallbackName.length > 0) {
    names.push(fallbackName.slice(0, 180));
  }
  return names;
}

/** Selects the innermost authored component—the component whose render edge visibly stopped. */
function readPreviewInspectorBlockedComponentName(componentStack, fallbackName) {
  return readPreviewInspectorComponentStackNames(componentStack, fallbackName)[0] ?? fallbackName;
}
`;
}
