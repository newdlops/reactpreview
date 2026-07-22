/**
 * Generates shared evidence readers for React render failures.
 *
 * React removes a failed subtree before the component collector can inspect it. These helpers turn
 * the error message and `componentStack` captured by an error boundary into bounded component and
 * property-path evidence. Both the inline placeholder and the Elements-like tree consume the same
 * functions so they cannot disagree about which authored component was blocked.
 */

import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';

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
const PREVIEW_INSPECTOR_FAILURE_COLLECTION_METHOD_NAMES = new Set(
  ${JSON.stringify(PREVIEW_COLLECTION_METHOD_NAMES)},
);
const PREVIEW_INSPECTOR_JSX_RUNTIME_GLOBAL_NAMES = new Set([
  'Fragment',
  'React',
  '_Fragment',
  '_jsx',
  '_jsxDEV',
  '_jsxs',
  'h',
  'jsx',
  'jsxDEV',
  'jsxs',
]);

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

/**
 * Extracts a missing lexical/runtime identifier without treating it as editable component data.
 * Reference errors describe JavaScript bindings, not property paths that Smart Fill can add to a
 * prop, hook result, or backend payload. Both real Error objects and serialized diagnostic strings
 * are accepted because browser and React boundaries may cross realms before Inspector sees them.
 */
function readPreviewInspectorMissingRuntimeGlobalName(error) {
  const message = readPreviewInspectorFailureMessage(error).trim();
  const explicitReferenceError = message.match(
    /(?:^|\b)ReferenceError:\s*([A-Za-z_$][\w$]*) is not defined\b/u,
  );
  if (explicitReferenceError !== null) return explicitReferenceError[1];
  let errorName = '';
  try { errorName = typeof error?.name === 'string' ? error.name : ''; } catch { errorName = ''; }
  if (errorName !== 'ReferenceError') return undefined;
  return message.match(/^([A-Za-z_$][\w$]*) is not defined\b/u)?.[1];
}

/** Identifies conventional classic and automatic JSX factory bindings for focused diagnostics. */
function isPreviewInspectorJsxRuntimeGlobalName(globalName) {
  return PREVIEW_INSPECTOR_JSX_RUNTIME_GLOBAL_NAMES.has(globalName);
}

/**
 * Normalizes compiler evidence without discarding its optional value-kind classification.
 * Callers may pass existing blocker path strings or richer path-and-kind records produced by
 * static prop analysis. Invalid project-owned values are ignored rather than
 * inspected recursively, keeping failure handling safe even after application code has thrown.
 */
function readPreviewInspectorFailureSourcePathRecords(sourceEvidence) {
  const records = [];
  const seen = new Set();
  for (const candidate of Array.isArray(sourceEvidence) ? sourceEvidence : []) {
    const path = typeof candidate === 'string'
      ? candidate
      : typeof candidate?.path === 'string'
        ? candidate.path
        : '';
    const normalizedPath = path.trim().slice(0, 240);
    if (normalizedPath.length === 0 || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    records.push({
      kind: typeof candidate?.kind === 'string' ? candidate.kind : '',
      path: normalizedPath,
    });
    if (records.length >= PREVIEW_INSPECTOR_FAILURE_EVIDENCE_LIMIT) break;
  }
  return records;
}

/**
 * Correlates a diagnostic's final property with one uniquely proven static receiver path.
 * A message such as "reading 'map'" omits its receiver. It is expanded only when source evidence
 * either contains that exact method call or identifies exactly one array receiver. Ambiguous
 * evidence deliberately returns the bare property so automatic recovery cannot populate a guessed
 * branch of application state.
 */
function correlatePreviewInspectorErrorPropertyPath(propertyName, sourceRecords) {
  const property = typeof propertyName === 'string' ? propertyName.trim() : '';
  if (!/^[A-Za-z_$][\w$]*$/u.test(property)) return undefined;
  const candidates = new Set();
  const collectionMethod = PREVIEW_INSPECTOR_FAILURE_COLLECTION_METHOD_NAMES.has(property);
  for (const record of sourceRecords) {
    const path = record.path.replaceAll('?.', '.').replace(/\?$/u, '');
    const calledPath = property + '()';
    if (path.endsWith('.' + calledPath) && path !== calledPath) candidates.add(path);
    if (path.endsWith('.' + property) && path !== property) {
      candidates.add(collectionMethod ? path + '()' : path);
    }
    if (
      collectionMethod && record.kind === 'array' &&
      path !== '<root>' && !path.endsWith('()')
    ) {
      candidates.add(path + '.' + calledPath);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/** Joins a destructured property to the simple receiver explicitly printed by the engine. */
function readPreviewInspectorDestructurePropertyPath(propertyName, receiverText) {
  const property = typeof propertyName === 'string' ? propertyName.trim() : '';
  const receiver = typeof receiverText === 'string' ? receiverText.trim() : '';
  if (!/^[A-Za-z_$][\w$]*$/u.test(property)) return undefined;
  if (!/^(?:[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*$/u.test(receiver)) return undefined;
  if (new Set(['false', 'null', 'true', 'undefined']).has(receiver)) return undefined;
  return receiver + '.' + property;
}

/**
 * Extracts the missing field/call/global named by common JavaScript runtime diagnostics.
 * Optional source evidence is used only for a unique correlation; the runtime message remains the
 * fallback so error reporting is useful even when no compiler metadata reaches the boundary.
 */
function readPreviewInspectorErrorPropertyPaths(error, sourceEvidence = []) {
  const message = readPreviewInspectorFailureMessage(error);
  const sourceRecords = readPreviewInspectorFailureSourcePathRecords(sourceEvidence);
  const paths = [];
  const add = (path) => {
    if (typeof path === 'string' && path.length > 0) paths.push(path);
  };
  const addObservedProperty = (propertyName) => {
    add(correlatePreviewInspectorErrorPropertyPath(propertyName, sourceRecords) ?? propertyName);
  };
  for (const match of message.matchAll(/reading ['"]([^'"]+)['"]/gu)) {
    addObservedProperty(match[1]);
  }
  for (const match of message.matchAll(/read property ['"]([^'"]+)['"]/gu)) {
    addObservedProperty(match[1]);
  }
  for (const match of message.matchAll(
    /Cannot destructure property ['"]([^'"]+)['"](?: of ['"]([^'"]+)['"])?/gu,
  )) {
    add(
      readPreviewInspectorDestructurePropertyPath(match[1], match[2]) ??
        correlatePreviewInspectorErrorPropertyPath(match[1], sourceRecords) ??
        match[1],
    );
  }
  for (const match of message.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+) is not a function\b/gu)) {
    add(match[1] + '()');
  }
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
