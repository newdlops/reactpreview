/**
 * Generates scroll-state ownership for the inert React Inspector companion document.
 *
 * Every semantic preview update replaces the companion's sanitized DOM. Browser-owned scroll
 * offsets therefore disappear unless the extension records them outside that disposable markup.
 * This module keeps a bounded ledger for each named Inspector viewport and deliberately holds the
 * last user position across short, structurally incomplete snapshots emitted while React settles.
 */

/** Maximum independently scrollable Inspector regions retained by one companion editor tab. */
export const PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT = 32;

/** Milliseconds of snapshot quiet time required before new DOM coordinates become authoritative. */
export const PREVIEW_INSPECTOR_COMPANION_SCROLL_SETTLE_MS = 400;

/**
 * Creates browser source for capturing and restoring every stable Inspector scroll viewport.
 *
 * The generated source expects the companion document's `mirror` element, VS Code's ordinary
 * browser animation/timer APIs, and `document.scrollingElement`. It never reads project DOM and
 * stores only finite coordinates plus extension-authored region keys.
 *
 * @returns Inert companion-only JavaScript embedded under the document's nonce-authorized script.
 */
export function createPreviewInspectorCompanionScrollScript(): string {
  return String.raw`
const PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT =
  ${PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT};
const PREVIEW_INSPECTOR_COMPANION_SCROLL_SETTLE_MS =
  ${PREVIEW_INSPECTOR_COMPANION_SCROLL_SETTLE_MS};
const previewInspectorCompanionScrollFallbackRegions = Object.freeze([
  ['.rpi-shell', 'inspector-shell'],
  ['.rpi-toolbar', 'inspector-toolbar'],
  ['.rpi-page-context', 'page-context'],
  ['.rpi-route-browser', 'route-browser'],
  ['.rpi-navigation-tabs', 'workbench-tabs'],
  ['.rpi-scenario-scroll', 'jsx-scenarios'],
  ['.rpi-tree-scroll', 'components-tree'],
  ['.rpi-tree-selection-scroll', 'components-selection-detail'],
  ['.rpi-detail-scroll', 'component-details'],
  ['.rpi-console-list', 'component-console'],
  ['textarea.rpi-json', 'component-json-editor'],
  ['pre.rpi-json', 'component-json-view'],
  ['.rpi-blocker-navigation-scroll', 'preview-setup'],
]);
const previewInspectorCompanionScrollState = {
  documentLeft: 0,
  documentTop: 0,
  frame: undefined,
  holding: false,
  initialized: false,
  interactionKey: undefined,
  regionByKey: new Map(),
  revision: 0,
  secondFrame: undefined,
  settleTimer: undefined,
};

/** Converts one DOM scroll coordinate into a finite non-negative number. */
function normalizeCompanionScrollCoordinate(value) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

/** Reads one bounded extension-issued identity for a preserved Inspector scroll viewport. */
function readCompanionScrollRegionKey(viewport) {
  const key = viewport?.getAttribute?.('data-rpi-scroll-key');
  return typeof key === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(key)
    ? key
    : undefined;
}

/**
 * Gives legacy or nested scroll surfaces deterministic local identities after every replacement.
 * Existing source-issued keys always win; numbered JSON keys remain stable within one detail view.
 */
function nameCompanionScrollRegions() {
  for (const [selector, baseKey] of previewInspectorCompanionScrollFallbackRegions) {
    const viewports = [...(mirror.querySelectorAll?.(selector) ?? [])].slice(0, 8);
    viewports.forEach((viewport, index) => {
      if (readCompanionScrollRegionKey(viewport) !== undefined) return;
      const key = viewports.length === 1 ? baseKey : baseKey + '-' + String(index + 1);
      viewport.setAttribute?.('data-rpi-scroll-key', key);
    });
  }
}

/** Returns at most the bounded set of named regions from the currently installed snapshot. */
function readCompanionScrollRegions() {
  nameCompanionScrollRegions();
  return [...(mirror.querySelectorAll?.('[data-rpi-scroll-key]') ?? [])]
    .slice(0, PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT);
}

/** Writes one region through a small insertion-ordered ledger that cannot grow across snapshots. */
function writeCompanionScrollRegionState(key, viewport) {
  const regions = previewInspectorCompanionScrollState.regionByKey;
  if (!regions.has(key) && regions.size >= PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT) {
    const oldestKey = regions.keys().next().value;
    if (typeof oldestKey === 'string') regions.delete(oldestKey);
  }
  regions.set(key, {
    left: normalizeCompanionScrollCoordinate(viewport.scrollLeft),
    top: normalizeCompanionScrollCoordinate(viewport.scrollTop),
  });
}

/** Copies current pixels into the durable ledger before a real user interaction or stable update. */
function rememberCurrentCompanionScrollPositions() {
  const documentViewport = document.scrollingElement;
  previewInspectorCompanionScrollState.documentLeft =
    normalizeCompanionScrollCoordinate(documentViewport?.scrollLeft);
  previewInspectorCompanionScrollState.documentTop =
    normalizeCompanionScrollCoordinate(documentViewport?.scrollTop);
  for (const viewport of readCompanionScrollRegions()) {
    const key = readCompanionScrollRegionKey(viewport);
    if (key === undefined) continue;
    writeCompanionScrollRegionState(key, viewport);
  }
  previewInspectorCompanionScrollState.initialized = true;
}

/** Seeds only newly appearing regions so a short transitional tree cannot erase older positions. */
function rememberMissingCompanionScrollRegions() {
  for (const viewport of readCompanionScrollRegions()) {
    const key = readCompanionScrollRegionKey(viewport);
    if (key === undefined || previewInspectorCompanionScrollState.regionByKey.has(key)) continue;
    writeCompanionScrollRegionState(key, viewport);
  }
}

/** Captures a serializable copy without accepting clamped coordinates during a settling sequence. */
function captureCompanionScrollSnapshot() {
  if (
    previewInspectorCompanionScrollState.initialized !== true ||
    previewInspectorCompanionScrollState.holding !== true
  ) {
    rememberCurrentCompanionScrollPositions();
  }
  return {
    documentLeft: previewInspectorCompanionScrollState.documentLeft,
    documentTop: previewInspectorCompanionScrollState.documentTop,
    regions: [...previewInspectorCompanionScrollState.regionByKey]
      .slice(0, PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT)
      .map(([key, region]) => ({ key, ...region })),
  };
}

/**
 * Reads a long-running interaction identity minted by the Inspector source.
 *
 * Most controls settle in the next React commit. Route selection is different because it compiles
 * a new branch before the authoritative DOM changes. Its identity keeps the original coordinates
 * authoritative until that exact route reports completion, regardless of compilation duration.
 */
function readCompanionScrollInteraction(control) {
  const key = control?.getAttribute?.('data-rpi-scroll-transaction');
  const state = control?.getAttribute?.('data-rpi-scroll-transaction-state');
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > 512 ||
    state !== 'available'
  ) {
    return undefined;
  }
  return key;
}

/** Reports whether the latest mirrored DOM completed the held interaction transaction. */
function isCompanionScrollInteractionComplete(key) {
  if (typeof key !== 'string') return true;
  const controls = [...(mirror.querySelectorAll?.('[data-rpi-scroll-transaction]') ?? [])];
  return controls.some((control) =>
    control.getAttribute?.('data-rpi-scroll-transaction') === key &&
    control.getAttribute?.('data-rpi-scroll-transaction-state') === 'complete',
  );
}

/**
 * Freezes the exact visible coordinates before an interaction is relayed to the hidden authority.
 * Ordinary controls release after quiet time. A route-selection transaction remains held across
 * every intermediate snapshot until the selected branch is installed or another click supersedes it.
 */
function rememberCompanionScrollBeforeInteraction(control) {
  rememberCurrentCompanionScrollPositions();
  previewInspectorCompanionScrollState.holding = true;
  previewInspectorCompanionScrollState.interactionKey =
    readCompanionScrollInteraction(control);
  if (previewInspectorCompanionScrollState.settleTimer !== undefined) {
    clearTimeout(previewInspectorCompanionScrollState.settleTimer);
  }
  const revision = ++previewInspectorCompanionScrollState.revision;
  previewInspectorCompanionScrollState.settleTimer = setTimeout(() => {
    if (previewInspectorCompanionScrollState.revision !== revision) return;
    previewInspectorCompanionScrollState.settleTimer = undefined;
    if (
      previewInspectorCompanionScrollState.interactionKey !== undefined &&
      !isCompanionScrollInteractionComplete(
        previewInspectorCompanionScrollState.interactionKey,
      )
    ) {
      return;
    }
    previewInspectorCompanionScrollState.interactionKey = undefined;
    previewInspectorCompanionScrollState.holding = false;
    rememberMissingCompanionScrollRegions();
  }, PREVIEW_INSPECTOR_COMPANION_SCROLL_SETTLE_MS);
}

/** Restores one bounded snapshot without focusing controls or dispatching application callbacks. */
function restoreCompanionScrollSnapshot(snapshot) {
  const source = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
  const documentViewport = document.scrollingElement;
  if (documentViewport !== null && documentViewport !== undefined) {
    documentViewport.scrollLeft = normalizeCompanionScrollCoordinate(source.documentLeft);
    documentViewport.scrollTop = normalizeCompanionScrollCoordinate(source.documentTop);
  }
  const retainedRegions = new Map(
    (Array.isArray(source.regions) ? source.regions : [])
      .slice(0, PREVIEW_INSPECTOR_COMPANION_SCROLL_REGION_LIMIT)
      .map((region) => [region.key, region]),
  );
  for (const viewport of readCompanionScrollRegions()) {
    const key = readCompanionScrollRegionKey(viewport);
    const region = key === undefined ? undefined : retainedRegions.get(key);
    if (region === undefined) continue;
    viewport.scrollLeft = normalizeCompanionScrollCoordinate(region.left);
    viewport.scrollTop = normalizeCompanionScrollCoordinate(region.top);
  }
}

/** Records an intentional reveal as the next ordinary position without changing other regions. */
function rememberCompanionScrollRegion(key) {
  const viewport = readCompanionScrollRegions().find(
    (candidate) => readCompanionScrollRegionKey(candidate) === key,
  );
  if (viewport === undefined) return;
  writeCompanionScrollRegionState(key, viewport);
}

/** Cancels delayed writes from an older DOM snapshot before scheduling its replacement. */
function cancelCompanionScrollRestoration() {
  if (previewInspectorCompanionScrollState.frame !== undefined) {
    cancelAnimationFrame(previewInspectorCompanionScrollState.frame);
    previewInspectorCompanionScrollState.frame = undefined;
  }
  if (previewInspectorCompanionScrollState.secondFrame !== undefined) {
    cancelAnimationFrame(previewInspectorCompanionScrollState.secondFrame);
    previewInspectorCompanionScrollState.secondFrame = undefined;
  }
  if (previewInspectorCompanionScrollState.settleTimer !== undefined) {
    clearTimeout(previewInspectorCompanionScrollState.settleTimer);
    previewInspectorCompanionScrollState.settleTimer = undefined;
  }
}

/**
 * Restores immediately and across two layout frames, then releases only after snapshot quiet time.
 * The optional callback is reserved for an explicit external tree reveal and therefore runs last.
 */
function scheduleCompanionScrollRestoration(snapshot, afterRestore) {
  cancelCompanionScrollRestoration();
  const revision = ++previewInspectorCompanionScrollState.revision;
  previewInspectorCompanionScrollState.holding = true;
  const apply = () => {
    if (previewInspectorCompanionScrollState.revision !== revision) return;
    restoreCompanionScrollSnapshot(snapshot);
    afterRestore?.();
  };
  apply();
  previewInspectorCompanionScrollState.frame = requestAnimationFrame(() => {
    previewInspectorCompanionScrollState.frame = undefined;
    apply();
    previewInspectorCompanionScrollState.secondFrame = requestAnimationFrame(() => {
      previewInspectorCompanionScrollState.secondFrame = undefined;
      apply();
    });
  });
  previewInspectorCompanionScrollState.settleTimer = setTimeout(() => {
    if (previewInspectorCompanionScrollState.revision !== revision) return;
    previewInspectorCompanionScrollState.settleTimer = undefined;
    if (
      previewInspectorCompanionScrollState.interactionKey !== undefined &&
      !isCompanionScrollInteractionComplete(
        previewInspectorCompanionScrollState.interactionKey,
      )
    ) {
      return;
    }
    previewInspectorCompanionScrollState.interactionKey = undefined;
    if (typeof afterRestore === 'function') rememberCompanionScrollRegion('components-tree');
    rememberMissingCompanionScrollRegions();
    previewInspectorCompanionScrollState.holding = false;
  }, PREVIEW_INSPECTOR_COMPANION_SCROLL_SETTLE_MS);
}
`;
}
