/**
 * Generates the browser-resident hot-reload coordinator shared by every cache-busted preview entry.
 * The coordinator validates private artifact URLs, prepares a replacement while the old React root
 * remains visible, rejects stale revisions, and reports enough acknowledgement state for the host to
 * transfer artifact leases without guessing which tree is still mounted.
 */

/**
 * Creates JavaScript interpolated into the generated preview entry.
 *
 * The returned source expects `mountNode`, `showRuntimeError`, and the progress helpers from the
 * surrounding entry. It defines `previewHotRuntime`, `previewEntryRevision`, and runtime handshake
 * values consumed by the later React bootstrap source.
 *
 * @param progressRuntimeSource Generated Shadow DOM progress protocol placed inside the coordinator.
 * @returns Self-contained browser JavaScript for secure, revision-aware hot replacement.
 */
export function createPreviewHotReloadRuntimeSource(progressRuntimeSource: string): string {
  return `
const PREVIEW_HOT_RUNTIME_KEY = Symbol.for('newdlops.react-file-preview.hot-runtime');

/** Creates the one webview-owned runtime that survives cache-busted entry-module imports. */
function createPreviewHotRuntime() {
  let vscodeApi;
  try {
    vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  } catch {
    vscodeApi = undefined;
  }
  return {
    bootstrapPromise: undefined,
    eventListeners: new Map(),
    latestReloadRequest: undefined,
    reloadOutcomeByToken: new Map(),
    reloadQueue: Promise.resolve(),
    requestSequence: 0,
    root: undefined,
    vscodeApi,
  };
}

const previewHotRuntime =
  globalThis[PREVIEW_HOT_RUNTIME_KEY] ?? createPreviewHotRuntime();
globalThis[PREVIEW_HOT_RUNTIME_KEY] = previewHotRuntime;
const previewEntryRevision = Number.isSafeInteger(previewHotRuntime.activeReloadRevision)
  ? previewHotRuntime.activeReloadRevision
  : 0;
const previewRuntimeToken = mountNode.dataset?.reactPreviewRuntimeToken;
const previewRuntimeRevisionValue = Number(mountNode.dataset?.reactPreviewRuntimeRevision);
const previewRuntimeRevision =
  Number.isSafeInteger(previewRuntimeRevisionValue) && previewRuntimeRevisionValue >= 0
    ? previewRuntimeRevisionValue
    : previewEntryRevision;

${progressRuntimeSource}

/** Replaces one module-owned global listener so hot imports cannot accumulate stale closures. */
function replacePreviewRuntimeListener(type, listener) {
  const previousListener = previewHotRuntime.eventListeners.get(type);
  if (typeof previousListener === 'function') {
    window.removeEventListener(type, previousListener);
  }
  window.addEventListener(type, listener);
  previewHotRuntime.eventListeners.set(type, listener);
}

/** Returns the content-addressed session root containing the currently evaluated entry. */
function readPreviewArtifactSession() {
  const current = new URL(import.meta.url);
  const finalSeparator = current.pathname.lastIndexOf('/');
  return {
    directory: current.pathname.slice(0, finalSeparator + 1),
    origin: current.origin,
  };
}

/** Reads the exact bounded query used to re-evaluate a stable content-addressed JS entry. */
function readPreviewEntryQuery(candidate) {
  const revisionValues = candidate.searchParams.getAll('reactPreviewRevision');
  const artifactValues = candidate.searchParams.getAll('reactPreviewArtifact');
  if (
    [...candidate.searchParams.keys()].length !== 2 ||
    revisionValues.length !== 1 ||
    artifactValues.length !== 1 ||
    !/^(?:0|[1-9][0-9]*)$/.test(revisionValues[0] ?? '') ||
    !/^[0-9a-f]{16}$/.test(artifactValues[0] ?? '')
  ) {
    return undefined;
  }
  const revision = Number(revisionValues[0]);
  return Number.isSafeInteger(revision) ? { artifactHash: artifactValues[0], revision } : undefined;
}

/** Validates one URL against the current private artifact session and expected relative path. */
function readPreviewArtifactUrl(value, relativePattern, allowEntryQuery) {
  try {
    const candidate = new URL(value, import.meta.url);
    const session = readPreviewArtifactSession();
    if (
      candidate.origin !== session.origin ||
      candidate.username !== '' ||
      candidate.password !== '' ||
      candidate.hash !== '' ||
      !candidate.pathname.startsWith(session.directory)
    ) {
      return undefined;
    }
    const relativePath = candidate.pathname.slice(session.directory.length);
    if (!relativePattern.test(relativePath)) {
      return undefined;
    }
    if (!allowEntryQuery) {
      return candidate.search === '' ? candidate : undefined;
    }
    const entryIdentity = readPreviewEntryQuery(candidate);
    return entryIdentity === undefined ? undefined : { candidate, ...entryIdentity };
  } catch {
    return undefined;
  }
}

/** Restricts reloads to a content-addressed root entry below this webview's artifact session. */
function readPreviewEntryScriptUri(scriptUri) {
  return readPreviewArtifactUrl(scriptUri, /^entry-[0-9a-f]{64}\\.js$/, true);
}

/** Restricts generated styles to their content-addressed session-local namespace. */
function isPreviewStylesheetUri(stylesheetUri) {
  return readPreviewArtifactUrl(
    stylesheetUri,
    /^styles\\/[0-9a-f]{64}\\.css$/,
    false,
  ) !== undefined;
}

/** Preloads an optional stylesheet and exposes an atomic commit used after the old root unmounts. */
function preparePreviewStylesheet(stylesheetUri) {
  const currentLink = document.getElementById('react-preview-stylesheet');
  if (typeof stylesheetUri !== 'string' || stylesheetUri.length === 0) {
    return {
      commit: () => currentLink?.remove(),
      dispose: () => undefined,
      ready: Promise.resolve(),
    };
  }
  if (currentLink instanceof HTMLLinkElement && currentLink.href === stylesheetUri) {
    return { commit: () => undefined, dispose: () => undefined, ready: Promise.resolve() };
  }
  const nextLink = document.createElement('link');
  nextLink.rel = 'stylesheet';
  nextLink.href = stylesheetUri;
  nextLink.media = 'not all';
  let committed = false;
  const loaded = new Promise((resolve, reject) => {
    nextLink.addEventListener('load', resolve, { once: true });
    nextLink.addEventListener(
      'error',
      () => reject(new Error('React Preview could not preload the replacement stylesheet.')),
      { once: true },
    );
  });
  document.head.append(nextLink);
  return {
    /** Activates only CSS that completed a successful browser load. */
    commit() {
      committed = true;
      nextLink.id = 'react-preview-stylesheet';
      nextLink.media = 'all';
      if (currentLink !== null) {
        currentLink.replaceWith(nextLink);
      }
    },
    /** Removes a speculative link when module preparation fails before the atomic swap. */
    dispose() {
      if (!committed) {
        nextLink.remove();
      }
    },
    ready: loaded,
  };
}

/** Starts a CSP-governed modulepreload without evaluating the replacement entry. */
function preparePreviewModule(scriptUri) {
  const preloadLink = document.createElement('link');
  preloadLink.rel = 'modulepreload';
  preloadLink.href = scriptUri;
  const ready = new Promise((resolve, reject) => {
    preloadLink.addEventListener('load', resolve, { once: true });
    preloadLink.addEventListener(
      'error',
      () => reject(new Error('React Preview could not preload the replacement module.')),
      { once: true },
    );
  });
  document.head.append(preloadLink);
  return { dispose: () => preloadLink.remove(), ready };
}

/** Validates an extension-owned hot revision message before loading another local ESM entry. */
function readHotReloadMessage(value) {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const { revision, scriptUri, stylesheetUri, token, type } = value;
  const entryIdentity = typeof scriptUri === 'string'
    ? readPreviewEntryScriptUri(scriptUri)
    : undefined;
  if (
    type !== 'react-preview-hot-reload' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    entryIdentity === undefined ||
    entryIdentity.revision !== revision ||
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 256 ||
    (stylesheetUri !== undefined &&
      (typeof stylesheetUri !== 'string' || !isPreviewStylesheetUri(stylesheetUri)))
  ) {
    return undefined;
  }
  return { revision, scriptUri, stylesheetUri, token };
}

/** Reports one exact hot request outcome with enough state for host-side lease reconciliation. */
function reportHotReloadOutcome(message, outcome) {
  const acknowledgement = {
    applied: outcome.applied,
    retainedPrevious: outcome.retainedPrevious,
    revision: message.revision,
    stale: outcome.stale === true,
    token: message.token,
    type: outcome.ready
      ? 'react-preview-hot-reload-ready'
      : 'react-preview-hot-reload-failed',
  };
  previewHotRuntime.reloadOutcomeByToken.set(message.token, acknowledgement);
  if (previewHotRuntime.reloadOutcomeByToken.size > 64) {
    const oldestToken = previewHotRuntime.reloadOutcomeByToken.keys().next().value;
    previewHotRuntime.reloadOutcomeByToken.delete(oldestToken);
  }
  previewHotRuntime.vscodeApi?.postMessage(acknowledgement);
}

/** Reports whether a queued or preparing request remains the newest browser-side intention. */
function isLatestHotReloadRequest(message) {
  const latest = previewHotRuntime.latestReloadRequest;
  return latest?.revision === message.revision &&
    latest.token === message.token &&
    latest.requestSequence === message.requestSequence;
}

/** Prepares setup, bridges, props, and target modules before replacing the visible React root. */
async function applyHotReloadMessage(message) {
  let modulePreparation;
  let stylesheetPreparation;
  let replacementStarted = false;
  try {
    if (!isLatestHotReloadRequest(message)) {
      reportHotReloadOutcome(message, {
        applied: false,
        ready: false,
        retainedPrevious: true,
        stale: true,
      });
      return;
    }
    modulePreparation = preparePreviewModule(message.scriptUri);
    stylesheetPreparation = preparePreviewStylesheet(message.stylesheetUri);
    updatePreviewProgressRuntimeDetail('Preparing the latest browser modules and styles.');
    previewHotRuntime.activeReloadRevision = message.revision;
    const importedEntryPromise = import(message.scriptUri);
    await Promise.all([
      modulePreparation.ready,
      stylesheetPreparation.ready,
      importedEntryPromise,
    ]);
    const preparedEntry = previewHotRuntime.preparedEntry;
    if (
      preparedEntry?.revision !== message.revision ||
      typeof preparedEntry.activate !== 'function' ||
      preparedEntry.preparationPromise === undefined
    ) {
      throw new Error('React Preview replacement entry did not register its preparation boundary.');
    }
    await preparedEntry.preparationPromise;
    if (!isLatestHotReloadRequest(message)) {
      reportHotReloadOutcome(message, {
        applied: false,
        ready: false,
        retainedPrevious: true,
        stale: true,
      });
      return;
    }
    replacementStarted = true;
    updatePreviewProgressRuntimeDetail('Committing the prepared preview revision.');
    if (previewHotRuntime.root !== undefined) {
      previewHotRuntime.root.unmount();
      previewHotRuntime.root = undefined;
    }
    mountNode.replaceChildren();
    stylesheetPreparation.commit();
    const activationOutcome = await preparedEntry.activate();
    if (activationOutcome !== 'ready') {
      reportHotReloadOutcome(message, {
        applied: false,
        ready: false,
        retainedPrevious: false,
      });
      return;
    }
    reportHotReloadOutcome(message, {
      applied: true,
      ready: true,
      retainedPrevious: false,
    });
  } catch (error) {
    if (replacementStarted) {
      if (previewHotRuntime.root !== undefined) {
        previewHotRuntime.root.unmount();
        previewHotRuntime.root = undefined;
      }
      showRuntimeError(error, {
        forceReplace: true,
        phase: 'hot reload module replacement',
      });
    } else {
      console.error('React Preview retained the previous render after preparation failed.', error);
    }
    reportHotReloadOutcome(message, {
      applied: false,
      ready: false,
      retainedPrevious: !replacementStarted,
    });
  } finally {
    modulePreparation?.dispose();
    stylesheetPreparation?.dispose();
    if (isLatestHotReloadRequest(message)) {
      completePreviewProgress(message.revision);
    }
  }
}

if (!previewHotRuntime.messageListenerInstalled) {
  window.addEventListener('message', (event) => {
    const message = readHotReloadMessage(event.data);
    if (message === undefined) {
      return;
    }
    const settledOutcome = previewHotRuntime.reloadOutcomeByToken.get(message.token);
    if (settledOutcome !== undefined) {
      previewHotRuntime.vscodeApi?.postMessage(settledOutcome);
      return;
    }
    const latest = previewHotRuntime.latestReloadRequest;
    if (latest?.revision === message.revision && latest.token === message.token) {
      return;
    }
    if (latest !== undefined && message.revision < latest.revision) {
      reportHotReloadOutcome(message, {
        applied: false,
        ready: false,
        retainedPrevious: true,
        stale: true,
      });
      return;
    }
    previewHotRuntime.requestSequence += 1;
    const scheduledMessage = {
      ...message,
      requestSequence: previewHotRuntime.requestSequence,
    };
    previewHotRuntime.latestReloadRequest = scheduledMessage;
    previewHotRuntime.reloadQueue = previewHotRuntime.reloadQueue.then(
      () => applyHotReloadMessage(scheduledMessage),
      () => applyHotReloadMessage(scheduledMessage),
    );
  });
  previewHotRuntime.messageListenerInstalled = true;
}
`;
}
