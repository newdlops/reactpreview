/**
 * Generates the browser-side runtime error formatter embedded in every preview entry.
 * The formatter accepts arbitrary cross-realm thrown values, preserves React's component stack,
 * and decodes Apollo's compact invariant payload without contacting a backend or documentation
 * service. Output is deliberately bounded so one hostile error cannot freeze the VS Code webview.
 */
import {
  PREVIEW_RUNTIME_DIAGNOSTIC_FALLBACK,
  PREVIEW_RUNTIME_DIAGNOSTIC_RULES,
} from './previewRuntimeDiagnostics';

/** Immutable target metadata written into one generated error formatter. */
export interface PreviewRuntimeErrorSourceOptions {
  /** Workspace-relative target label safe to display in the preview surface. */
  readonly documentName: string;
  /** Setup mode selected before the target module is evaluated. */
  readonly setupKind: 'custom' | 'none' | 'storybook';
}

/**
 * Creates repository-independent JavaScript helpers for detailed browser error reports.
 * The returned source intentionally uses property guards instead of `instanceof Error` because
 * errors can originate in another iframe realm or from libraries that throw plain objects.
 *
 * @param options Target metadata displayed alongside the original failure.
 * @returns JavaScript declarations inserted before the generated React boundaries.
 */
export function createPreviewRuntimeErrorSource(options: PreviewRuntimeErrorSourceOptions): string {
  const encodedDocumentName = JSON.stringify(options.documentName);
  const encodedSetupKind = JSON.stringify(options.setupKind);
  const encodedRuntimeDiagnosticFallback = JSON.stringify(PREVIEW_RUNTIME_DIAGNOSTIC_FALLBACK);
  const encodedRuntimeDiagnosticRules = JSON.stringify(PREVIEW_RUNTIME_DIAGNOSTIC_RULES);

  return String.raw`
const runtimeDiagnosticRules = ${encodedRuntimeDiagnosticRules};
const runtimeDiagnosticFallback = ${encodedRuntimeDiagnosticFallback};
const MAX_RUNTIME_ERROR_DETAILS = 12000;
const MAX_RUNTIME_REPORT_DETAILS = 24000;
const MAX_REACT_COMPONENT_STACK_DETAILS = 8000;
const MAX_RUNTIME_CAUSE_DEPTH = 4;
const MAX_AGGREGATE_ERROR_ITEMS = 5;
const MAX_RUNTIME_CLASSIFICATION_MESSAGES = 16;
const MAX_THROWN_VALUE_FIELDS = 8;
const APOLLO_INVARIANT_URL_PREFIX = 'https://go.apollo.dev/c/err#';
const previewRuntimeCapabilityReaders = new Map();

/** Registers an inert status reader exported by one optional automatic runtime bridge. */
function registerPreviewRuntimeCapability(label, bridgeModule) {
  const statusReader = bridgeModule?.readPreviewRuntimeStatus;
  previewRuntimeCapabilityReaders.set(
    label,
    typeof statusReader === 'function'
      ? statusReader
      : () => 'status unavailable from this bridge version',
  );
}

/** Reads provider decisions lazily so render-time errors include the final composed state. */
function describePreviewRuntimeCapabilities() {
  if (previewRuntimeCapabilityReaders.size === 0) {
    return ['  Runtime bridges were not loaded before this failure.'];
  }
  const descriptions = [];
  for (const [label, readStatus] of previewRuntimeCapabilityReaders) {
    let status;
    try {
      status = readStatus();
    } catch {
      status = 'status reader failed';
    }
    descriptions.push(
      '  ' + label + ': ' +
        (typeof status === 'string' && status.length > 0 ? status : 'unknown'),
    );
  }
  return descriptions;
}

/** Reads one property from an unknown thrown value without allowing a getter to hide the report. */
function readRuntimeErrorProperty(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    return value[propertyName];
  } catch {
    return undefined;
  }
}

/** Converts a primitive to bounded text without calling project-owned object serialization hooks. */
function readRuntimePrimitiveText(value) {
  try {
    if (typeof value === 'string') {
      return value;
    }
    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean' ||
      typeof value === 'symbol'
    ) {
      return String(value);
    }
  } catch {
    return '[unreadable value]';
  }
  return undefined;
}

/** Reads the direct message used for stable, repository-independent error classification. */
function readRuntimeErrorMessage(error) {
  const message = readRuntimeErrorProperty(error, 'message');
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  return readRuntimePrimitiveText(error) ?? 'Unknown runtime error';
}

/** Reads an Error-like name while rejecting object coercion and project-defined toString methods. */
function readRuntimeErrorName(error) {
  const name = readRuntimeErrorProperty(error, 'name');
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Creates the concise first line that stays visible above all recovery guidance. */
function createRuntimeErrorHeadline(error) {
  const message = readRuntimeErrorMessage(error);
  const name = readRuntimeErrorName(error);
  if (name === undefined || message.startsWith(name + ':')) {
    return message;
  }
  return name + ': ' + message;
}

/** Collects direct messages from a bounded cause tree without using any generated stack paths. */
function collectRuntimeErrorMessages(error, depth, seenErrors, messages) {
  if (messages.length >= MAX_RUNTIME_CLASSIFICATION_MESSAGES || depth > MAX_RUNTIME_CAUSE_DEPTH) {
    return;
  }
  if ((typeof error === 'object' || typeof error === 'function') && error !== null) {
    if (seenErrors.has(error)) {
      return;
    }
    seenErrors.add(error);
  }
  messages.push(readRuntimeErrorMessage(error));
  const cause = readRuntimeErrorProperty(error, 'cause');
  if (cause !== undefined) {
    collectRuntimeErrorMessages(cause, depth + 1, seenErrors, messages);
  }
  const aggregateErrors = readRuntimeErrorProperty(error, 'errors');
  if (!Array.isArray(aggregateErrors)) {
    return;
  }
  for (const aggregateError of aggregateErrors.slice(0, MAX_AGGREGATE_ERROR_ITEMS)) {
    collectRuntimeErrorMessages(aggregateError, depth + 1, seenErrors, messages);
  }
}

/** Returns the bounded direct-message inventory shared by classification and metadata decoding. */
function readRuntimeErrorMessages(error) {
  const messages = [];
  collectRuntimeErrorMessages(error, 0, new Set(), messages);
  return messages;
}

/** Selects a library-branded diagnostic from direct root, cause, and aggregate messages. */
function classifyRuntimeError(error) {
  const messages = readRuntimeErrorMessages(error).map((message) => message.toLowerCase());
  return runtimeDiagnosticRules.find((rule) =>
    rule.messageIncludes.some((fragment) =>
      messages.some((message) => message.includes(fragment)),
    ),
  ) ?? runtimeDiagnosticFallback;
}

/** Returns a cross-realm stack only when it is directly available as inert string data. */
function readRuntimeErrorStack(error) {
  const stack = readRuntimeErrorProperty(error, 'stack');
  return typeof stack === 'string' && stack.trim().length > 0 ? stack : undefined;
}

/** Lists a few primitive own fields that often carry status codes or failed operation names. */
function readRuntimeErrorOwnFields(error) {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return [];
  }
  let fieldNames;
  try {
    fieldNames = Object.keys(error);
  } catch {
    return [];
  }
  const ignoredNames = new Set(['cause', 'errors', 'message', 'name', 'stack']);
  const fields = [];
  for (const fieldName of fieldNames) {
    if (ignoredNames.has(fieldName)) {
      continue;
    }
    const fieldText = readRuntimePrimitiveText(readRuntimeErrorProperty(error, fieldName));
    if (fieldText === undefined) {
      continue;
    }
    fields.push(fieldName + ': ' + fieldText.slice(0, 1000));
    if (fields.length >= MAX_THROWN_VALUE_FIELDS) {
      break;
    }
  }
  return fields;
}

/** Appends one Error-like node plus bounded cause and AggregateError descendants. */
function appendRuntimeErrorDetails(lines, error, label, depth, seenErrors) {
  lines.push(label + ':');
  if ((typeof error === 'object' || typeof error === 'function') && error !== null) {
    if (seenErrors.has(error)) {
      lines.push('[circular thrown value]');
      return;
    }
    seenErrors.add(error);
  }

  const stack = readRuntimeErrorStack(error);
  if (stack === undefined) {
    lines.push('Thrown value:', createRuntimeErrorHeadline(error));
  } else {
    lines.push('JavaScript stack:', stack.slice(0, MAX_RUNTIME_ERROR_DETAILS));
  }
  const ownFields = readRuntimeErrorOwnFields(error);
  if (ownFields.length > 0) {
    lines.push('Own fields:');
    lines.push(...ownFields.map((field) => '  ' + field));
  }
  if (depth >= MAX_RUNTIME_CAUSE_DEPTH) {
    return;
  }

  const cause = readRuntimeErrorProperty(error, 'cause');
  if (cause !== undefined) {
    lines.push('');
    appendRuntimeErrorDetails(lines, cause, 'Cause ' + (depth + 1).toString(), depth + 1, seenErrors);
  }

  const aggregateErrors = readRuntimeErrorProperty(error, 'errors');
  if (!Array.isArray(aggregateErrors)) {
    return;
  }
  for (const [index, aggregateError] of aggregateErrors
    .slice(0, MAX_AGGREGATE_ERROR_ITEMS)
    .entries()) {
    lines.push('');
    appendRuntimeErrorDetails(
      lines,
      aggregateError,
      'Aggregate error ' + (index + 1).toString(),
      depth + 1,
      seenErrors,
    );
  }
}

/**
 * Decodes Apollo's version, invariant code, and arguments from its compact public error URL.
 * The payload is metadata only; no version-specific semantic claim is made and no request occurs.
 */
function describeApolloInvariantPayload(message) {
  const prefixIndex = message.indexOf(APOLLO_INVARIANT_URL_PREFIX);
  if (prefixIndex < 0) {
    return undefined;
  }
  const payloadStart = prefixIndex + APOLLO_INVARIANT_URL_PREFIX.length;
  let payloadEnd = payloadStart;
  while (payloadEnd < message.length && !/\s/u.test(message[payloadEnd])) {
    payloadEnd += 1;
  }
  const encodedPayload = message.slice(payloadStart, payloadEnd).replace(/[),.;\]]+$/u, '');
  try {
    const payload = JSON.parse(decodeURIComponent(encodedPayload));
    if (payload === null || typeof payload !== 'object') {
      return undefined;
    }
    const details = [];
    if (typeof payload.version === 'string' || typeof payload.version === 'number') {
      details.push('  Apollo Client version: ' + String(payload.version));
    }
    if (typeof payload.message === 'string' || typeof payload.message === 'number') {
      details.push('  Invariant message code: ' + String(payload.message));
    }
    if (Array.isArray(payload.args)) {
      details.push('  Arguments: ' + JSON.stringify(payload.args).slice(0, 2000));
    }
    return details.length > 0
      ? ['Apollo invariant payload (decoded locally):', ...details].join('\n')
      : undefined;
  } catch {
    return undefined;
  }
}

/** Normalizes React's component stack while retaining component and source-frame ordering. */
function readReactComponentStack(runtimeContext) {
  const componentStack = runtimeContext?.componentStack;
  return typeof componentStack === 'string' && componentStack.trim().length > 0
    ? componentStack.trim().slice(0, MAX_REACT_COMPONENT_STACK_DETAILS)
    : undefined;
}

/** Converts an unknown browser failure into bounded actionable text plus original details. */
function describeRuntimeError(error, runtimeContext = {}) {
  const diagnostic = classifyRuntimeError(error);
  const setupDescription = ${encodedSetupKind} === 'none' ? 'none' : ${encodedSetupKind};
  const componentStack = readReactComponentStack(runtimeContext);
  const apolloMessage = readRuntimeErrorMessages(error).find((message) =>
    message.includes(APOLLO_INVARIANT_URL_PREFIX),
  );
  const apolloPayload = apolloMessage === undefined
    ? undefined
    : describeApolloInvariantPayload(apolloMessage);
  const originalDetails = [];
  const parentSlice = runtimeContext.parentSlice;
  const parentSliceDescription =
    parentSlice !== null && typeof parentSlice === 'object' &&
    Number.isInteger(parentSlice.frameCount) && parentSlice.frameCount > 0
      ? '  Parent render slice: ' + String(parentSlice.frameCount) + ' wrapper(s), ' +
        (parentSlice.complete === true ? 'complete owner path' : 'safe partial path')
      : undefined;
  appendRuntimeErrorDetails(originalDetails, error, 'Original error', 0, new Set());
  const lines = [
    diagnostic.title,
    '',
    'Direct error:',
    createRuntimeErrorHeadline(error),
    '',
    'Failure context:',
    '  Phase: ' + (runtimeContext.phase ?? 'browser runtime'),
    '  Target: ' + ${encodedDocumentName},
    ...(typeof runtimeContext.exportName === 'string'
      ? ['  Export: ' + runtimeContext.exportName]
      : []),
    ...(parentSliceDescription === undefined ? [] : [parentSliceDescription]),
    '  Preview setup: ' + setupDescription,
    '  Classification: ' + diagnostic.kind,
    '',
    'Automatic runtime boundaries:',
    ...describePreviewRuntimeCapabilities(),
    '',
    'Interpretation:',
    diagnostic.summary,
    diagnostic.recovery,
  ];
  if (typeof runtimeContext.location === 'string' && runtimeContext.location.length > 0) {
    lines.push('', 'Browser location:', runtimeContext.location.slice(0, 2000));
  }
  if (componentStack !== undefined) {
    lines.push('', 'React component stack:', componentStack);
  }
  if (apolloPayload !== undefined) {
    lines.push('', apolloPayload);
  }
  lines.push('', ...originalDetails);
  return lines.join('\n').slice(0, MAX_RUNTIME_REPORT_DETAILS);
}
`;
}
