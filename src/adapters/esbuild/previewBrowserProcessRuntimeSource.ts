/**
 * Generates the bounded browser-side `process` compatibility boundary used by preview entries.
 *
 * Older browser-oriented packages were commonly authored for Browserify, which injected a
 * `process/browser` object whenever a module referenced the free `process` identifier. esbuild's
 * browser platform deliberately does not provide that implicit global. The preview installs only
 * neutral browser metadata and scheduling helpers before importing project modules; it does not
 * emulate Node filesystem, networking, native bindings, signals, or process termination.
 */

/**
 * Creates self-contained JavaScript that installs or preserves one webview-local process object.
 *
 * A symbol-backed state record makes cache-busted hot entries idempotent. An object already
 * supplied by the host or preview setup remains authoritative. The fallback stays writable so an
 * explicit setup can replace it and so packages that append harmless environment flags continue to
 * work like they do with the conventional `process/browser` shim.
 *
 * @returns JavaScript source embedded directly into the generated browser entry.
 */
export function createPreviewBrowserProcessRuntimeSource(): string {
  return String.raw`
const PREVIEW_BROWSER_PROCESS_STATE_KEY = Symbol.for(
  'newdlops.react-file-preview.browser-process-state',
);

/** Reports whether a value can represent a project- or host-owned process object. */
function isPreviewProcessObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/** Reads a possibly host-defined global without allowing an accessor failure to abort preview. */
function readExistingPreviewProcess() {
  try {
    return globalThis.process;
  } catch {
    return undefined;
  }
}

/** Stores hot-entry ownership metadata without making preview startup depend on an extensible host. */
function writePreviewProcessState(state) {
  try {
    Object.defineProperty(globalThis, PREVIEW_BROWSER_PROCESS_STATE_KEY, {
      configurable: true,
      enumerable: false,
      value: state,
      writable: true,
    });
  } catch {
    // The process object itself can still work when a hardened host rejects the optional marker.
  }
}

/** Reads a state written by an earlier cache-busted entry without trusting arbitrary host values. */
function readPreviewProcessState() {
  try {
    const state = globalThis[PREVIEW_BROWSER_PROCESS_STATE_KEY];
    return state !== null && typeof state === 'object' ? state : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates the small Browserify-compatible surface required by browser packages such as path.
 * Mutable containers intentionally match the widely used process/browser contract. Unsupported
 * Node capabilities remain absent so a package cannot accidentally gain filesystem or transport
 * authority from the preview.
 */
function createPreviewBrowserProcess() {
  const previewProcess = {
    argv: [],
    browser: true,
    cwd: () => '/',
    env: { NODE_ENV: 'development' },
    pid: 0,
    platform: 'browser',
    release: { name: 'browser' },
    title: 'browser',
    umask: () => 0,
    version: '',
    versions: {},
  };

  /** Schedules callbacks without exposing Node's event loop or timer internals. */
  previewProcess.nextTick = (callback, ...arguments_) => {
    if (typeof callback !== 'function') {
      throw new TypeError('process.nextTick requires a callback function.');
    }
    const invoke = () => callback(...arguments_);
    if (typeof globalThis.queueMicrotask === 'function') {
      globalThis.queueMicrotask(invoke);
      return;
    }
    Promise.resolve().then(invoke);
  };

  /** Keeps optional event-registration probes inert and chainable in a browser-only preview. */
  const returnPreviewProcess = () => previewProcess;
  previewProcess.addListener = returnPreviewProcess;
  previewProcess.off = returnPreviewProcess;
  previewProcess.on = returnPreviewProcess;
  previewProcess.once = returnPreviewProcess;
  previewProcess.prependListener = returnPreviewProcess;
  previewProcess.prependOnceListener = returnPreviewProcess;
  previewProcess.removeAllListeners = returnPreviewProcess;
  previewProcess.removeListener = returnPreviewProcess;
  previewProcess.emit = () => false;
  previewProcess.listeners = () => [];

  return previewProcess;
}

/** Installs a data property while respecting a non-configurable host-owned descriptor. */
function installPreviewBrowserProcess(previewProcess) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  } catch {
    return false;
  }

  try {
    if (descriptor === undefined || descriptor.configurable === true) {
      Object.defineProperty(globalThis, 'process', {
        configurable: true,
        enumerable: false,
        value: previewProcess,
        writable: true,
      });
      return true;
    }
    if ('value' in descriptor && descriptor.writable === true) {
      globalThis.process = previewProcess;
      return globalThis.process === previewProcess;
    }
    if (!('value' in descriptor) && typeof descriptor.set === 'function') {
      globalThis.process = previewProcess;
      return globalThis.process === previewProcess;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Preserves a real process object or installs one neutral compatibility value before dynamic
 * project imports. The returned sentence is included in runtime-boundary diagnostics.
 */
function initializePreviewBrowserProcess() {
  const existingProcess = readExistingPreviewProcess();
  const previousState = readPreviewProcessState();
  if (isPreviewProcessObject(existingProcess)) {
    const status =
      previousState?.kind === 'fallback' && previousState.value === existingProcess
        ? 'process: active: reused the bounded browser compatibility object'
        : 'process: active: preserved an existing host or project process object';
    writePreviewProcessState({
      kind:
        previousState?.kind === 'fallback' && previousState.value === existingProcess
          ? 'fallback'
          : 'preserved',
      status,
      value: existingProcess,
    });
    return status;
  }

  const previewProcess = createPreviewBrowserProcess();
  if (!installPreviewBrowserProcess(previewProcess)) {
    const status =
      'process: unavailable: the browser host rejected the bounded compatibility object';
    writePreviewProcessState({ kind: 'unavailable', status });
    return status;
  }

  const status =
    'process: active: bounded browser metadata and scheduling; Node I/O remains unavailable';
  writePreviewProcessState({ kind: 'fallback', status, value: previewProcess });
  return status;
}
`;
}
