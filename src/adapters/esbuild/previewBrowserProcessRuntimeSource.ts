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
 * @param publicEnvironment Browser-public values admitted from bounded project dotenv files.
 * @returns JavaScript source embedded directly into the generated browser entry.
 */
export function createPreviewBrowserProcessRuntimeSource(
  publicEnvironment: Readonly<Record<string, string>> = {},
): string {
  const encodedPublicEnvironment = JSON.stringify(publicEnvironment);
  return String.raw`
const PREVIEW_BROWSER_PROCESS_STATE_KEY = Symbol.for(
  'newdlops.react-file-preview.browser-process-state',
);
const PREVIEW_PUBLIC_ENVIRONMENT = Object.freeze(${encodedPublicEnvironment});
const PREVIEW_PUBLIC_ENVIRONMENT_URL = 'https://react-preview.invalid/';
const PREVIEW_PUBLIC_ENVIRONMENT_PREFIXES = Object.freeze([
  'NEXT_PUBLIC_',
  'VITE_',
  'REACT_APP_',
  'PUBLIC_',
]);
const PREVIEW_URL_ENVIRONMENT_SEGMENT = /(?:^|_)(?:URL|URI|ORIGIN|HOST|HOSTNAME|ENDPOINT)(?:_|$)/u;

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

/** Reports whether a missing key is both browser-public and structurally URL-shaped. */
function isPreviewPublicUrlEnvironmentKey(property) {
  return typeof property === 'string' &&
    PREVIEW_PUBLIC_ENVIRONMENT_PREFIXES.some((prefix) => property.startsWith(prefix)) &&
    PREVIEW_URL_ENVIRONMENT_SEGMENT.test(property);
}

/**
 * Creates a mutable public environment facade with one narrow URL fallback.
 * Non-URL feature flags and server-only keys remain undefined. A missing browser-public URL read
 * intentionally becomes a truthy reserved origin so top-level URL construction can continue.
 */
function createPreviewPublicEnvironment(initialValues) {
  const target = { NODE_ENV: 'development', ...initialValues };
  const environment = new Proxy(target, {
    get(currentTarget, property, receiver) {
      if (Reflect.has(currentTarget, property)) {
        return Reflect.get(currentTarget, property, receiver);
      }
      return isPreviewPublicUrlEnvironmentKey(property)
        ? PREVIEW_PUBLIC_ENVIRONMENT_URL
        : undefined;
    },
  });
  return { environment, target };
}

/**
 * Proves that the owned plain target can remove stale keys and write every next value atomically.
 * The preflight prevents a sealed/frozen target from being partially changed before replacement.
 */
function canUpdatePreviewPublicEnvironment(target, previousKeys, nextValues) {
  try {
    const nextKeys = Object.keys(nextValues);
    const needsNewProperty = [...nextKeys, 'NODE_ENV'].some(
      (key) => !Object.prototype.hasOwnProperty.call(target, key),
    );
    if (needsNewProperty && !Object.isExtensible(target)) return false;
    for (const key of previousKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor !== undefined && descriptor.configurable !== true) return false;
    }
    for (const key of nextKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (
        descriptor !== undefined &&
        !('value' in descriptor ? descriptor.writable === true : typeof descriptor.set === 'function')
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Replaces only compiler-injected keys after the mutation preflight has proved it is safe. */
function tryUpdatePreviewPublicEnvironment(target, previousKeys, nextValues) {
  if (!canUpdatePreviewPublicEnvironment(target, previousKeys, nextValues)) return undefined;
  try {
    for (const key of previousKeys) delete target[key];
    for (const [key, value] of Object.entries(nextValues)) target[key] = value;
    target.NODE_ENV ??= 'development';
    return Object.keys(nextValues);
  } catch {
    return undefined;
  }
}

/** Copies unrelated package mutations without retaining stale compiler-owned public keys. */
function copyPreviewEnvironmentValues(environment, previousKeys) {
  try {
    const previousKeySet = new Set(previousKeys);
    const values = {};
    for (const key of Object.keys(environment)) {
      if (!previousKeySet.has(key)) values[key] = environment[key];
    }
    return values;
  } catch {
    return undefined;
  }
}

/** Installs one replacement environment only when the process property remains writable. */
function tryReplacePreviewPublicEnvironment(previewProcess, initialValues) {
  const publicEnvironment = createPreviewPublicEnvironment(initialValues);
  try {
    previewProcess.env = publicEnvironment.environment;
    if (previewProcess.env !== publicEnvironment.environment) return undefined;
  } catch {
    return undefined;
  }
  return {
    environment: publicEnvironment.environment,
    environmentTarget: publicEnvironment.target,
    outcome: 'replaced',
    publicEnvironmentKeys: Object.keys(PREVIEW_PUBLIC_ENVIRONMENT),
  };
}

/** Retains previous ownership metadata when a hardened process rejects a safe hot update. */
function preservePreviewPublicEnvironmentState(previousState) {
  return {
    ...(previousState?.environment === undefined
      ? {}
      : { environment: previousState.environment }),
    ...(previousState?.environmentTarget === undefined
      ? {}
      : { environmentTarget: previousState.environmentTarget }),
    outcome: 'preserved',
    publicEnvironmentKeys: previousState?.publicEnvironmentKeys ?? [],
  };
}

/** Upgrades or replaces the owned environment without ever throwing from a hot entry. */
function upgradePreviewPublicEnvironment(previewProcess, previousState) {
  try {
    const existingEnvironment = previewProcess.env;
    if (
      previousState?.environmentTarget !== undefined &&
      previousState?.environment === existingEnvironment
    ) {
      const publicEnvironmentKeys = tryUpdatePreviewPublicEnvironment(
        previousState.environmentTarget,
        previousState.publicEnvironmentKeys ?? [],
        PREVIEW_PUBLIC_ENVIRONMENT,
      );
      if (publicEnvironmentKeys !== undefined) {
        return {
          environment: previousState.environment,
          environmentTarget: previousState.environmentTarget,
          outcome: 'updated',
          publicEnvironmentKeys,
        };
      }
    }

    const copiedValues =
      existingEnvironment !== null && typeof existingEnvironment === 'object'
        ? copyPreviewEnvironmentValues(
            existingEnvironment,
            previousState?.publicEnvironmentKeys ?? [],
          )
        : {};
    if (copiedValues === undefined) return preservePreviewPublicEnvironmentState(previousState);
    return (
      tryReplacePreviewPublicEnvironment(previewProcess, {
        ...copiedValues,
        ...PREVIEW_PUBLIC_ENVIRONMENT,
      }) ?? preservePreviewPublicEnvironmentState(previousState)
    );
  } catch {
    return preservePreviewPublicEnvironmentState(previousState);
  }
}

/**
 * Creates the small Browserify-compatible surface required by browser packages such as path.
 * Mutable containers intentionally match the widely used process/browser contract. Unsupported
 * Node capabilities remain absent so a package cannot accidentally gain filesystem or transport
 * authority from the preview.
 */
function createPreviewBrowserProcess() {
  const publicEnvironment = createPreviewPublicEnvironment(PREVIEW_PUBLIC_ENVIRONMENT);
  const previewProcess = {
    argv: [],
    browser: true,
    cwd: () => '/',
    env: publicEnvironment.environment,
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

  return { previewProcess, publicEnvironment };
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
function initializePreviewBrowserProcessInternal() {
  const existingProcess = readExistingPreviewProcess();
  const previousState = readPreviewProcessState();
  if (isPreviewProcessObject(existingProcess)) {
    const isOwnedFallback =
      previousState?.kind === 'fallback' && previousState.value === existingProcess;
    const publicEnvironment = isOwnedFallback
      ? upgradePreviewPublicEnvironment(existingProcess, previousState)
      : undefined;
    const status =
      publicEnvironment?.outcome === 'updated'
        ? 'process: active: reused the bounded browser compatibility object with public environment fallback'
        : publicEnvironment?.outcome === 'replaced'
          ? 'process: active: reused the bounded browser compatibility object and replaced a locked public environment fallback'
          : isOwnedFallback
            ? 'process: active: preserved the bounded browser compatibility object; public environment refresh was skipped because process.env is locked'
        : 'process: active: preserved an existing host or project process object';
    writePreviewProcessState({
      ...(publicEnvironment ?? {}),
      kind: isOwnedFallback ? 'fallback' : 'preserved',
      status,
      value: existingProcess,
    });
    return status;
  }

  const { previewProcess, publicEnvironment } = createPreviewBrowserProcess();
  if (!installPreviewBrowserProcess(previewProcess)) {
    const status =
      'process: unavailable: the browser host rejected the bounded compatibility object';
    writePreviewProcessState({ kind: 'unavailable', status });
    return status;
  }

  const status =
    'process: active: bounded browser metadata and scheduling; Node I/O remains unavailable';
  writePreviewProcessState({
    environment: publicEnvironment.environment,
    environmentTarget: publicEnvironment.target,
    kind: 'fallback',
    publicEnvironmentKeys: Object.keys(PREVIEW_PUBLIC_ENVIRONMENT),
    status,
    value: previewProcess,
  });
  return status;
}

/** Keeps preview entry evaluation alive even when a hostile host object rejects every probe. */
function initializePreviewBrowserProcess() {
  try {
    return initializePreviewBrowserProcessInternal();
  } catch {
    return 'process: unavailable: browser compatibility initialization was rejected by the host';
  }
}
`;
}
