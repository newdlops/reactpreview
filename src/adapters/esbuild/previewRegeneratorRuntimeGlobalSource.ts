/**
 * Generates the CSP-safe browser bootstrap slot expected by legacy Babel regenerator bundles.
 *
 * Older compiled packages first assign their runtime to the free `regeneratorRuntime` identifier.
 * When a bundler places that code in an ESM strict-mode scope, the assignment throws unless the
 * browser global binding already exists. Their recovery branch commonly calls `Function(...)`,
 * which a trusted VS Code webview correctly rejects because dynamic code evaluation is disabled.
 * This compatibility boundary creates only the missing writable slot; the reached package still
 * installs its own exact runtime and no project code, polyfill, or dynamic string is evaluated.
 */

/** Returns self-contained browser source that prepares one optional legacy runtime global. */
export function createPreviewRegeneratorRuntimeGlobalSource(): string {
  return String.raw`
/** Reads the host descriptor without allowing a hardened global object to abort preview startup. */
function readPreviewRegeneratorRuntimeDescriptor() {
  try {
    return Object.getOwnPropertyDescriptor(globalThis, 'regeneratorRuntime');
  } catch {
    return undefined;
  }
}

/** Reports whether an inherited host binding must remain authoritative. */
function hasInheritedPreviewRegeneratorRuntime() {
  try {
    return !Object.prototype.hasOwnProperty.call(globalThis, 'regeneratorRuntime') &&
      'regeneratorRuntime' in globalThis;
  } catch {
    return false;
  }
}

/**
 * Installs an undefined writable data property before any setup or target module is imported.
 * Defining the property creates the browser global binding that a strict free assignment resolves;
 * the package then replaces the empty slot with its runtime without entering the dynamic fallback.
 */
function initializePreviewRegeneratorRuntimeGlobal() {
  if (
    readPreviewRegeneratorRuntimeDescriptor() !== undefined ||
    hasInheritedPreviewRegeneratorRuntime()
  ) {
    return 'regeneratorRuntime: active: preserved an existing browser runtime binding';
  }
  try {
    Object.defineProperty(globalThis, 'regeneratorRuntime', {
      configurable: true,
      enumerable: false,
      value: undefined,
      writable: true,
    });
  } catch {
    return 'regeneratorRuntime: unavailable: the browser host rejected a compatibility slot';
  }
  const descriptor = readPreviewRegeneratorRuntimeDescriptor();
  return descriptor !== undefined && 'value' in descriptor && descriptor.writable === true
    ? 'regeneratorRuntime: active: writable CSP-safe bootstrap slot installed'
    : 'regeneratorRuntime: unavailable: the browser host rejected a compatibility slot';
}
`;
}
