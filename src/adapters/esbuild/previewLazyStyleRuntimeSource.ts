/**
 * Generates document-scoped lazy CSS ownership without changing content-addressed module bytes.
 * ESM witnesses bound the document cache; only active modules restore CSS on the next entry.
 * Speculative hot styles stay inactive until replacement and cancellation never admits them.
 */

/** Global symbol shared by the generated entry bootstrap and every auxiliary ESM module. */
export const PREVIEW_LAZY_STYLE_LOADER_SYMBOL = 'newdlops.react-preview.lazy-styles.v1';

/** Finite document history; the existing host document fallback resets the browser's ESM cache. */
export const MAXIMUM_PREVIEW_EVALUATED_STYLE_MODULES = 8_192;

/** Validated module-to-stylesheet relationship supplied by the output path-safety planner. */
export interface PreviewLazyStyleAssociation {
  /** JavaScript artifact path later received as `import.meta.url`. */
  readonly modulePath: string;
  /** Exclusive, content-addressed CSS artifact path owned by this module. */
  readonly stylesheetPath: string;
}

/**
 * Creates the entry-local loader and restores CSS only for previously evaluated module URLs.
 * Initial cosmetic failures warn; a failed hot stylesheet rejects before the visible root changes.
 *
 * @param associations Current, validated exclusive CSS ownership.
 * @param modulePaths All current auxiliary modules, including modules that acquire CSS in a later edit.
 * @returns Browser source prepended before the entry starts its dynamic preparation imports.
 */
export function createPreviewLazyStyleRuntimeSource(
  associations: readonly PreviewLazyStyleAssociation[],
  modulePaths: readonly string[],
): string {
  const serializedAssociations = associations
    .map(
      ({ modulePath, stylesheetPath }) =>
        `[new URL(${JSON.stringify(`./${modulePath}`)}, import.meta.url).href, new URL(${JSON.stringify(`./${stylesheetPath}`)}, import.meta.url).href]`,
    )
    .join(',\n');
  const serializedModules = JSON.stringify(modulePaths.map((modulePath) => `./${modulePath}`));
  return `
const __reactPreviewLazyStyleKey = Symbol.for(${JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL)});
let __reactPreviewPreviousLazyStyleLoader = globalThis[__reactPreviewLazyStyleKey];
const __reactPreviewLazyStyleByModule = new Map([${serializedAssociations}]);
const __reactPreviewLazyStyleModules = new Set(${serializedModules}.map((value) => new URL(value, import.meta.url).href));
const __reactPreviewEvaluatedStyleModules = __reactPreviewPreviousLazyStyleLoader?.evaluatedModules ?? new Set();
const __reactPreviewActiveStyleModules = __reactPreviewPreviousLazyStyleLoader?.activeModules ?? new Set(__reactPreviewEvaluatedStyleModules);
const __reactPreviewPreparedStyleModules = new Set();
const __reactPreviewLazyStylePromises = new Map();
const __reactPreviewLazyStyleLinks = new Set();
const __reactPreviewCreatedLazyStyleLinks = new Set();
const __reactPreviewPendingLazyStyles = new Set();
const __reactPreviewLazyPreloads = new Map();
const __reactPreviewPendingLazyPreloads = new Set();
const __reactPreviewExistingLazyStyles = new Map(Array.from(
  document.querySelectorAll('link[data-react-preview-lazy-style]'),
  (link) => [link.href, link],
));
const __reactPreviewLazyStyleRevision = import.meta.url;
let __reactPreviewLazyStylePhase = __reactPreviewPreviousLazyStyleLoader === undefined ? 'activated' : 'preparing';

/** Records actual prefix evaluation even if this revision has no CSS for the module. */
const __reactPreviewLazyStyleLoader = async (moduleUrl) => {
  if (__reactPreviewLazyStylePhase === 'disposed' || __reactPreviewLazyStylePhase === 'retired') return;
  if (!__reactPreviewLazyStyleModules.has(moduleUrl)) {
    if (__reactPreviewLazyStylePhase === 'preparing') await __reactPreviewPreviousLazyStyleLoader?.(moduleUrl);
    return;
  }
  if (!__reactPreviewEvaluatedStyleModules.has(moduleUrl)) {
    if (__reactPreviewEvaluatedStyleModules.size >= ${String(MAXIMUM_PREVIEW_EVALUATED_STYLE_MODULES)}) {
      __reactPreviewLazyStyleLoader.requiresDocumentReload = true;
    } else {
      __reactPreviewEvaluatedStyleModules.add(moduleUrl);
    }
  }
  if (__reactPreviewEvaluatedStyleModules.has(moduleUrl)) {
    if (__reactPreviewLazyStylePhase === 'preparing') __reactPreviewPreparedStyleModules.add(moduleUrl);
    else __reactPreviewActiveStyleModules.add(moduleUrl);
  }
  const stylesheetUrl = __reactPreviewLazyStyleByModule.get(moduleUrl);
  if (stylesheetUrl === undefined) return;
  const existingPromise = __reactPreviewLazyStylePromises.get(stylesheetUrl);
  if (existingPromise !== undefined) return existingPromise;
  const existingLink = __reactPreviewExistingLazyStyles.get(stylesheetUrl);
  if (existingLink !== undefined) {
    __reactPreviewLazyStyleLinks.add(existingLink);
    __reactPreviewLazyStylePromises.set(stylesheetUrl, Promise.resolve());
    return;
  }
  const link = document.createElement('link');
  const previousStylesheetUrl = __reactPreviewPreviousLazyStyleLoader?.stylesheetForModule?.(moduleUrl);
  const previousLink = __reactPreviewExistingLazyStyles.get(previousStylesheetUrl);
  link.rel = 'stylesheet';
  link.href = stylesheetUrl;
  link.media = __reactPreviewLazyStylePhase === 'preparing' ? 'not all' : '';
  link.dataset.reactPreviewLazyStyle = 'true';
  link.dataset.reactPreviewLazyStyleRevision = __reactPreviewLazyStyleRevision;
  __reactPreviewLazyStyleLinks.add(link);
  __reactPreviewCreatedLazyStyleLinks.add(link);
  const promise = new Promise((resolve, reject) => {
    const finish = (failed = false) => {
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
      __reactPreviewPendingLazyStyles.delete(cancel);
      if (failed) {
        link.remove();
        __reactPreviewLazyStyleLinks.delete(link);
        __reactPreviewCreatedLazyStyleLinks.delete(link);
        __reactPreviewLazyStylePromises.delete(stylesheetUrl);
        const error = new Error('React Preview could not load a lazy project stylesheet: ' + stylesheetUrl);
        if (__reactPreviewLazyStylePhase === 'preparing') { reject(error); return; }
        globalThis.console?.warn?.(error.message);
      }
      resolve();
    };
    const onLoad = () => { link.dataset.reactPreviewLazyStyleLoaded = 'true'; finish(); };
    const onError = () => finish(true);
    const cancel = () => finish();
    __reactPreviewPendingLazyStyles.add(cancel);
    link.addEventListener('load', onLoad, { once: true });
    link.addEventListener('error', onError, { once: true });
    if (previousLink?.isConnected) previousLink.before(link);
    else document.head.append(link);
  });
  __reactPreviewLazyStylePromises.set(stylesheetUrl, promise);
  return promise;
};
__reactPreviewLazyStyleLoader.evaluatedModules = __reactPreviewEvaluatedStyleModules;
__reactPreviewLazyStyleLoader.activeModules = __reactPreviewActiveStyleModules;
Object.defineProperty(__reactPreviewLazyStyleLoader, 'phase', { get: () => __reactPreviewLazyStylePhase });
/** Fetches CSS beside JavaScript without applying speculative global selectors. */
function __reactPreviewPreloadLazyStyle(stylesheetUrl) {
  if (__reactPreviewLazyStylePromises.has(stylesheetUrl)) return __reactPreviewLazyStylePromises.get(stylesheetUrl);
  const previous = __reactPreviewLazyPreloads.get(stylesheetUrl);
  if (previous !== undefined) return previous;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'style';
  link.href = stylesheetUrl;
  link.dataset.reactPreviewLazyStylePreload = 'true';
  const promise = new Promise((resolve) => {
    const finish = () => {
      link.removeEventListener('load', finish);
      link.removeEventListener('error', finish);
      link.remove();
      __reactPreviewPendingLazyPreloads.delete(finish);
      resolve();
    };
    __reactPreviewPendingLazyPreloads.add(finish);
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    document.head.append(link);
  });
  __reactPreviewLazyPreloads.set(stylesheetUrl, promise);
  return promise;
}
/** Rechecks cached modules after native success; failed imports never activate new CSS. */
__reactPreviewLazyStyleLoader.import = (specifier, importerUrl, modulePromise) => {
  let moduleUrl;
  try { moduleUrl = new URL(specifier, importerUrl).href; }
  catch { return modulePromise; }
  if (!__reactPreviewLazyStyleModules.has(moduleUrl)) return modulePromise;
  const stylesheetUrl = __reactPreviewLazyStyleByModule.get(moduleUrl);
  const preload = stylesheetUrl === undefined ? undefined : __reactPreviewPreloadLazyStyle(stylesheetUrl);
  return Promise.all([modulePromise, preload]).then(async (values) => {
    await __reactPreviewLazyStyleLoader(moduleUrl);
    return values[0];
  });
};
__reactPreviewLazyStyleLoader.stylesheetForModule = (moduleUrl) => __reactPreviewLazyStyleByModule.get(moduleUrl);
__reactPreviewLazyStyleLoader.requiresDocumentReload =
  __reactPreviewPreviousLazyStyleLoader?.requiresDocumentReload === true ||
  __reactPreviewEvaluatedStyleModules.size > ${String(MAXIMUM_PREVIEW_EVALUATED_STYLE_MODULES)};

/** Activates prepared CSS before React layout effects observe the replacement DOM. */
__reactPreviewLazyStyleLoader.activate = () => {
  if (__reactPreviewLazyStylePhase !== 'preparing' || __reactPreviewLazyStyleLoader.requiresDocumentReload) return;
  const loadedLinks = new Map(Array.from(document.querySelectorAll('link[data-react-preview-lazy-style]'))
    .filter((link) => link.dataset.reactPreviewLazyStyleLoaded === 'true').map((link) => [link.href, link]));
  for (const link of __reactPreviewLazyStyleLinks) {
    if (link.dataset.reactPreviewLazyStyleLoaded === 'true') loadedLinks.set(link.href, link);
  }
  for (const [moduleUrl, stylesheetUrl] of __reactPreviewLazyStyleByModule) {
    if (!__reactPreviewActiveStyleModules.has(moduleUrl)) continue;
    const link = loadedLinks.get(stylesheetUrl);
    if (link === undefined) { __reactPreviewLazyStyleLoader.requiresDocumentReload = true; return; }
    __reactPreviewLazyStyleLinks.add(link);
    if (!__reactPreviewLazyStylePromises.has(stylesheetUrl)) __reactPreviewLazyStylePromises.set(stylesheetUrl, Promise.resolve());
  }
  __reactPreviewLazyStylePhase = 'activated';
  for (const link of __reactPreviewLazyStyleLinks) link.media = '';
  for (const link of document.querySelectorAll('link[data-react-preview-lazy-style]')) {
    if (!__reactPreviewLazyStyleLinks.has(link)) link.remove();
  }
};
/** Releases obsolete entry closures after ownership moves, without removing adopted DOM links. */
__reactPreviewLazyStyleLoader.retire = () => {
  __reactPreviewLazyStylePhase = 'retired';
  for (const cancel of __reactPreviewPendingLazyStyles) cancel();
  for (const cancel of __reactPreviewPendingLazyPreloads) cancel();
  __reactPreviewLazyStyleByModule.clear();
  __reactPreviewLazyStyleModules.clear();
  __reactPreviewLazyStylePromises.clear();
  __reactPreviewLazyPreloads.clear();
  __reactPreviewPreparedStyleModules.clear();
  __reactPreviewLazyStyleLinks.clear();
  __reactPreviewCreatedLazyStyleLinks.clear();
  __reactPreviewExistingLazyStyles.clear();
  __reactPreviewPreviousLazyStyleLoader = undefined;
};
/** Removes stale CSS only after a successful replacement; unopened module styles remain absent. */
__reactPreviewLazyStyleLoader.commit = () => {
  if (__reactPreviewLazyStylePhase === 'disposed' || __reactPreviewLazyStylePhase === 'retired') return;
  __reactPreviewLazyStyleLoader.activate();
  if (__reactPreviewLazyStyleLoader.requiresDocumentReload) return;
  __reactPreviewLazyStylePhase = 'committed';
  for (const moduleUrl of __reactPreviewPreparedStyleModules) __reactPreviewActiveStyleModules.add(moduleUrl);
  __reactPreviewPreparedStyleModules.clear();
  for (const link of __reactPreviewLazyStyleLinks) link.dataset.reactPreviewLazyStyleRevision = __reactPreviewLazyStyleRevision;
  for (const link of document.querySelectorAll('link[data-react-preview-lazy-style]')) {
    if (!__reactPreviewLazyStyleLinks.has(link)) link.remove();
  }
  __reactPreviewPreviousLazyStyleLoader?.retire?.();
  __reactPreviewPreviousLazyStyleLoader = undefined;
  __reactPreviewCreatedLazyStyleLinks.clear();
  __reactPreviewExistingLazyStyles.clear();
};
/** Rolls back speculative links without modifying the still-visible revision's CSS. */
__reactPreviewLazyStyleLoader.dispose = () => {
  if (__reactPreviewLazyStylePhase === 'committed' || __reactPreviewLazyStylePhase === 'retired' || __reactPreviewLazyStylePhase === 'disposed') return;
  __reactPreviewLazyStylePhase = 'disposed';
  for (const link of __reactPreviewCreatedLazyStyleLinks) link.remove();
  if (globalThis[__reactPreviewLazyStyleKey] === __reactPreviewLazyStyleLoader) {
    globalThis[__reactPreviewLazyStyleKey] = __reactPreviewPreviousLazyStyleLoader;
  }
  __reactPreviewLazyStyleLoader.retire();
};
globalThis[__reactPreviewLazyStyleKey] = __reactPreviewLazyStyleLoader;
__reactPreviewLazyStyleLoader.ready = Promise.all(Array.from(
  __reactPreviewLazyStyleByModule.keys(),
  (moduleUrl) => __reactPreviewActiveStyleModules.has(moduleUrl) ? __reactPreviewLazyStyleLoader(moduleUrl) : undefined,
));
// Setup imports may settle later; retain rejection for their preparation boundary without an orphan.
void __reactPreviewLazyStyleLoader.ready.catch(() => {});
`;
}
