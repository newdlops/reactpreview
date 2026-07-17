/**
 * Generates the bounded browser-console registry used by React Page Inspector.
 *
 * Project modules keep writing to the real webview console. The generated runtime mirrors those
 * calls into an Inspector-owned session so provider/hook failures remain visible without opening
 * VS Code's developer tools. Entries are normalized before storage and never persist into webview
 * state, which avoids retaining arbitrary application objects or credentials across page reloads.
 */

/** Maximum console rows retained by one pinned preview tab. */
export const PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT = 250;

/**
 * Creates browser source for console interception, React-boundary diagnostics, and bounded reads.
 *
 * Expected lexical bindings are `previewHotRuntime`, `previewInspectorSession`,
 * `notifyPreviewInspector`, `createRuntimeErrorHeadline`, and `describeRuntimeError`. Original
 * console methods are captured once on the hot runtime so bundle replacements never wrap wrappers.
 *
 * @returns Plain JavaScript source concatenated before project modules are dynamically imported.
 */
export function createPreviewInspectorConsoleRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT = ${PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT};
const PREVIEW_INSPECTOR_CONSOLE_MESSAGE_LIMIT = 4_000;
const PREVIEW_INSPECTOR_CONSOLE_DETAILS_LIMIT = 16_000;
const previewInspectorConsoleLevels = new Set(['debug', 'error', 'info', 'log', 'warn']);

/** Returns initialized ephemeral console state without adding it to persisted Inspector state. */
function ensurePreviewInspectorConsoleState() {
  if (!Array.isArray(previewInspectorSession.consoleEntries)) {
    previewInspectorSession.consoleEntries = [];
  }
  if (!Number.isSafeInteger(previewInspectorSession.consoleSequence)) {
    previewInspectorSession.consoleSequence = 0;
  }
  return previewInspectorSession.consoleEntries;
}

/** Truncates diagnostic text at a stable boundary so one exception cannot dominate the panel. */
function boundPreviewInspectorConsoleText(value, limit) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(0, Math.max(0, limit - 14)) + '\n… [truncated]';
}

/** Reads one own data property without invoking application-defined getters or proxy fallbacks. */
function readPreviewInspectorConsoleOwnValue(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Detects ordinary Error-shaped values while avoiding instanceof and custom Symbol hooks. */
function isPreviewInspectorConsoleErrorLike(value) {
  const message = readPreviewInspectorConsoleOwnValue(value, 'message');
  const stack = readPreviewInspectorConsoleOwnValue(value, 'stack');
  return typeof message === 'string' || typeof stack === 'string';
}

/** Returns a readable function label without evaluating the function or its custom properties. */
function describePreviewInspectorConsoleFunction(value) {
  const name = readPreviewInspectorConsoleOwnValue(value, 'name');
  return '[Function' + (typeof name === 'string' && name.length > 0 ? ' ' + name : '') + ']';
}

/**
 * Converts an arbitrary console argument into bounded text using own data descriptors only.
 * Getters, functions, symbols, cycles, deep graphs, and large collections receive explicit labels.
 */
function formatPreviewInspectorConsoleValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return String(value) + 'n';
  if (typeof value === 'symbol') {
    try { return String(value); } catch { return '[Symbol]'; }
  }
  if (typeof value === 'function') return describePreviewInspectorConsoleFunction(value);
  if (typeof value !== 'object') return '[' + typeof value + ']';
  if (isPreviewInspectorConsoleErrorLike(value)) {
    try {
      return createRuntimeErrorHeadline(value);
    } catch {
      const message = readPreviewInspectorConsoleOwnValue(value, 'message');
      return typeof message === 'string' ? message : '[Error]';
    }
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (depth >= 3) return '[Object]';
  let isArray = false;
  try { isArray = Array.isArray(value); } catch { return '[Uninspectable object]'; }
  let propertyKeys;
  try { propertyKeys = Reflect.ownKeys(value).slice(0, 24); } catch { return '[Uninspectable object]'; }
  const parts = [];
  for (const propertyKey of propertyKeys) {
    const displayKey = typeof propertyKey === 'symbol' ? '[symbol]' : propertyKey;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, propertyKey); } catch { descriptor = undefined; }
    if (descriptor === undefined) continue;
    if (!('value' in descriptor)) {
      parts.push(String(displayKey) + ': [Getter]');
      continue;
    }
    parts.push(
      (isArray ? '' : String(displayKey) + ': ') +
        formatPreviewInspectorConsoleValue(descriptor.value, depth + 1, seen),
    );
  }
  let propertyCount = propertyKeys.length;
  try { propertyCount = Reflect.ownKeys(value).length; } catch { /* The bounded keys remain useful. */ }
  if (propertyCount > propertyKeys.length) parts.push('…');
  return (isArray ? '[' : '{') + parts.join(', ') + (isArray ? ']' : '}');
}

/** Formats the arguments passed to a console method without retaining their object identities. */
function formatPreviewInspectorConsoleArguments(args) {
  const values = Array.isArray(args) ? args.slice(0, 12) : [];
  const formatted = values.map((value) => formatPreviewInspectorConsoleValue(value));
  if (Array.isArray(args) && args.length > values.length) formatted.push('…');
  return boundPreviewInspectorConsoleText(
    formatted.join(' '),
    PREVIEW_INSPECTOR_CONSOLE_MESSAGE_LIMIT,
  );
}

/** Captures stable native console methods once so hot reload cannot create recursive wrappers. */
function readPreviewInspectorConsolePrimitives() {
  if (previewHotRuntime.inspectorConsolePrimitives !== undefined) {
    return previewHotRuntime.inspectorConsolePrimitives;
  }
  const consoleObject = globalThis.console;
  const noop = () => undefined;
  const primitives = {};
  for (const level of previewInspectorConsoleLevels) {
    let method;
    try { method = consoleObject?.[level]; } catch { method = undefined; }
    primitives[level] = typeof method === 'function' ? method.bind(consoleObject) : noop;
  }
  previewHotRuntime.inspectorConsolePrimitives = Object.freeze(primitives);
  return previewHotRuntime.inspectorConsolePrimitives;
}

/** Schedules one store notification outside an application render or error-boundary lifecycle. */
function schedulePreviewInspectorConsoleNotification() {
  if (previewInspectorSession.consoleNotifyQueued === true) return;
  previewInspectorSession.consoleNotifyQueued = true;
  const notify = () => {
    previewInspectorSession.consoleNotifyQueued = false;
    try { notifyPreviewInspector(); } catch { /* Console capture must never affect project code. */ }
  };
  if (typeof globalThis.queueMicrotask === 'function') {
    globalThis.queueMicrotask(notify);
  } else {
    Promise.resolve().then(notify, notify);
  }
}

/** Normalizes and stores one untrusted console/boundary event, coalescing adjacent duplicates. */
function recordPreviewInspectorConsoleEntry(candidate = {}) {
  const entries = ensurePreviewInspectorConsoleState();
  const level = previewInspectorConsoleLevels.has(candidate?.level) ? candidate.level : 'error';
  const args = Array.isArray(candidate?.args) ? candidate.args : [];
  const error = candidate?.error ?? args.find((value) => isPreviewInspectorConsoleErrorLike(value));
  let message = typeof candidate?.message === 'string'
    ? candidate.message
    : formatPreviewInspectorConsoleArguments(args);
  if (message.length === 0 && error !== undefined) {
    try { message = createRuntimeErrorHeadline(error); } catch { message = '[Runtime error]'; }
  }
  if (message.length === 0) message = '[' + level + ']';
  message = boundPreviewInspectorConsoleText(message, PREVIEW_INSPECTOR_CONSOLE_MESSAGE_LIMIT);
  const context = {
    componentStack: typeof candidate?.componentStack === 'string' ? candidate.componentStack : undefined,
    exportName: typeof candidate?.exportName === 'string' ? candidate.exportName : undefined,
    location: typeof candidate?.location === 'string' ? candidate.location : undefined,
    phase: typeof candidate?.phase === 'string' ? candidate.phase : undefined,
  };
  let details = typeof candidate?.details === 'string' ? candidate.details : '';
  if (details.length === 0 && error !== undefined) {
    try { details = describeRuntimeError(error, context); } catch { details = message; }
  }
  details = boundPreviewInspectorConsoleText(details, PREVIEW_INSPECTOR_CONSOLE_DETAILS_LIMIT);
  const source = boundPreviewInspectorConsoleText(
    typeof candidate?.source === 'string' ? candidate.source : 'console',
    80,
  );
  const fingerprint = [level, source, context.exportName ?? '', message, details].join('\u0000');
  const previous = entries[entries.length - 1];
  const timestamp = new Date().toISOString();
  if (previous?.fingerprint === fingerprint) {
    previous.count += 1;
    previous.timestamp = timestamp;
    schedulePreviewInspectorConsoleNotification();
    return previous;
  }
  previewInspectorSession.consoleSequence += 1;
  const entry = {
    componentStack: context.componentStack,
    count: 1,
    details,
    exportName: context.exportName,
    fingerprint,
    id: 'console-' + String(previewInspectorSession.consoleSequence),
    level,
    location: context.location,
    message,
    phase: context.phase,
    source,
    timestamp,
  };
  entries.push(entry);
  if (entries.length > PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT) {
    entries.splice(0, entries.length - PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT);
  }
  schedulePreviewInspectorConsoleNotification();
  return entry;
}

/** Returns a copied chronological snapshot so UI code cannot mutate the registry array. */
function readPreviewInspectorConsoleEntries() {
  return ensurePreviewInspectorConsoleState().slice();
}

/** Clears only this preview tab's ephemeral logs and leaves the browser console untouched. */
function clearPreviewInspectorConsoleEntries() {
  ensurePreviewInspectorConsoleState().splice(0);
  schedulePreviewInspectorConsoleNotification();
}

/** Records an exact selected-target failure and writes it once through the original warning method. */
function reportPreviewInspectorTargetFailure(error, context = {}) {
  let headline = '[React target failed]';
  try { headline = createRuntimeErrorHeadline(error); } catch { /* Keep the neutral headline. */ }
  let details = headline;
  try { details = describeRuntimeError(error, context); } catch { /* Keep the safe headline. */ }
  recordPreviewInspectorConsoleEntry({
    ...context,
    details,
    error,
    level: 'error',
    message: headline,
    source: 'react-boundary',
  });
  readPreviewInspectorConsolePrimitives().warn(
    '[React Preview] Selected target failed.\n' + details,
  );
}

/** Installs transparent console mirrors before setup and target modules are evaluated. */
function installPreviewInspectorConsoleCapture() {
  const consoleObject = globalThis.console;
  if (consoleObject === null || (typeof consoleObject !== 'object' && typeof consoleObject !== 'function')) {
    return;
  }
  const primitives = readPreviewInspectorConsolePrimitives();
  for (const level of previewInspectorConsoleLevels) {
    const original = primitives[level];
    const mirror = (...args) => {
      try { recordPreviewInspectorConsoleEntry({ args, level, source: 'console' }); } catch {
        /* Diagnostics must never change console call behavior. */
      }
      return original(...args);
    };
    try { consoleObject[level] = mirror; } catch { /* A frozen console remains usable natively. */ }
  }
}
`;
}
