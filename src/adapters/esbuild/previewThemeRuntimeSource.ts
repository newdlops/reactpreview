/**
 * Generates the browser-only styled-components compatibility boundary used by previews.
 * A directly discovered project theme remains authoritative for known values while a structural
 * overlay fills missing paths without inventing design tokens. Explicit setup themes bypass the
 * overlay, and absent themes still receive an inert fallback instead of a runtime exception.
 */

/** Resolved project module required to build the optional theme preview boundary. */
export interface PreviewThemeRuntimeSourceOptions {
  /** Absolute browser-resolved entry for the target project's styled-components package. */
  readonly styledComponentsModulePath: string;
  /** Canonical package condition shared by generated provider and project consumers. */
  readonly styledComponentsResolutionKind?: 'import-statement' | 'require-call';
}

/**
 * Creates the source for discovered-theme overlay, structural fallback, and ThemeProvider wrapper.
 * Proxy tokens cover both `theme.spacing(2)` and `theme.flex.colCenter` without assuming any
 * repository-specific token names, while exact setup values are never cloned or proxied.
 *
 * @param options Project-owned styled-components module selected through esbuild resolution.
 * @returns JavaScript source loaded inside the private theme bridge namespace.
 */
export function createPreviewThemeRuntimeSource(options: PreviewThemeRuntimeSourceOptions): string {
  const encodedModulePath = JSON.stringify(normalizeImportPath(options.styledComponentsModulePath));
  const encodedResolutionKind = JSON.stringify(
    options.styledComponentsResolutionKind ?? 'import-statement',
  );
  return `
import * as React from 'react';
import * as StyledComponents from ${encodedModulePath};

const previewStyledComponentsModulePath = ${encodedModulePath};
const previewStyledComponentsResolutionKind = ${encodedResolutionKind};
const tokenCache = new Map();
const discoveredProxyCache = new WeakMap();
const discoveredProxyTargets = new WeakMap();
const resolvedThemeHelperCache = new WeakMap();
const reachableThemeCandidates = new Map();
const repairedThemeHelperPaths = new Set();
const repairedThemeValuePaths = new Set();
const MAX_REACHABLE_THEME_CANDIDATES = 64;
const MAX_REACHABLE_THEME_EVIDENCE = 256;
const MAX_REPAIRED_THEME_HELPERS = 64;
const MAX_REPAIRED_THEME_VALUES = 128;
let reachableThemeEvidenceCount = 0;
let activePreviewTheme;
let previewRuntimeStatus = 'available: waiting for target-reachable theme evidence';

/** Returns the last automatic styled-components decision for runtime error diagnostics. */
export function readPreviewRuntimeStatus() {
  const repairs = [];
  if (repairedThemeHelperPaths.size > 0) {
    repairs.push(
      'repaired ' + String(repairedThemeHelperPaths.size) +
        ' incompatible callable theme token(s) from exact usage evidence',
    );
  }
  if (repairedThemeValuePaths.size > 0) {
    repairs.push(
      'repaired ' + String(repairedThemeValuePaths.size) +
        ' missing non-callable theme token(s) from exact usage evidence',
    );
  }
  return repairs.length === 0 ? previewRuntimeStatus : previewRuntimeStatus + '; ' + repairs.join('; ');
}

/** Sends one bounded theme health event through the optional Page Inspector diagnostic boundary. */
function reportPreviewThemeRuntimeHealth(event, detail = {}) {
  try {
    globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')]?.recordRuntimeHealth?.({
      category: 'theme',
      detail,
      event,
    });
  } catch {
    // Runtime health is observational and must never become a project render dependency.
  }
}

/** Encodes a property path into a stable cache key without depending on application values. */
function createTokenCacheKey(path) {
  return path.map((part) => typeof part === 'symbol' ? part.toString() : String(part)).join('.');
}

/** Returns an empty CSS token that can also be invoked like a theme helper function. */
function createStructuralToken(path) {
  const cacheKey = createTokenCacheKey(path);
  const cachedToken = tokenCache.get(cacheKey);
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  const tokenTarget = (..._arguments) => '';
  const token = new Proxy(tokenTarget, {
    apply() {
      return '';
    },
    get(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor?.configurable === false) {
        return Reflect.get(target, property);
      }
      if (property === Symbol.toPrimitive) {
        return (hint) => hint === 'number' ? 0 : '';
      }
      if (property === Symbol.iterator) {
        return function* emptyStructuralThemeIterator() {};
      }
      if (property === 'then') {
        return undefined;
      }
      if (property === 'toJSON' || property === 'toString') {
        return () => '';
      }
      if (property === 'valueOf') {
        return () => 0;
      }
      return createStructuralToken([...path, property]);
    },
  });
  tokenCache.set(cacheKey, token);
  return token;
}

/** Creates the non-callable root object required by styled-components ThemeProvider validation. */
function createStructuralTheme() {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === Symbol.toPrimitive) {
        return (hint) => hint === 'number' ? 0 : '';
      }
      if (property === 'then') {
        return undefined;
      }
      if (property === 'toJSON' || property === 'toString') {
        return () => '';
      }
      if (property === 'valueOf') {
        return () => 0;
      }
      return createStructuralToken([property]);
    },
  });
}

const structuralTheme = createStructuralTheme();

/** Reports whether a value is a plain record whose missing keys can safely use structural tokens. */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  } catch {
    return false;
  }
}

/** Collects finite numbers from nested array arguments without accepting coercible values. */
function collectFiniteNumbers(value, numbers, visitedArrays) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return false;
    }
    numbers.push(value);
    return true;
  }
  if (!Array.isArray(value) || visitedArrays.has(value)) {
    return false;
  }

  visitedArrays.add(value);
  for (const item of value) {
    if (!collectFiniteNumbers(item, numbers, visitedArrays)) {
      return false;
    }
  }
  visitedArrays.delete(value);
  return true;
}

/** Derives an exact rem list only from a helper's numeric unit and numeric invocation arguments. */
function createUnitHelperFallback(target, arguments_) {
  let unit;
  try {
    unit = Reflect.get(target, 'unit', target);
  } catch {
    return '';
  }
  if (typeof unit !== 'number' || !Number.isFinite(unit)) {
    return '';
  }

  const numbers = [];
  const visitedArrays = new Set();
  for (const argument of arguments_) {
    if (!collectFiniteNumbers(argument, numbers, visitedArrays)) {
      return '';
    }
  }
  const convertedNumbers = numbers.map((number) =>
    Number((number * unit).toPrecision(15)),
  );
  return convertedNumbers.length > 0 && convertedNumbers.every(Number.isFinite)
    ? convertedNumbers.map((number) => String(number) + 'rem').join(' ')
    : '';
}

/** Returns a structural token for an absent discovered-theme property without creating thenables. */
function readMissingDiscoveredToken(path, property) {
  return property === 'then' ? undefined : createStructuralToken([...path, property]);
}

/**
 * Overlays a discovered plain object or function while preserving primitives, arrays, and class
 * instances exactly. Weak caches keep every overlaid project value referentially stable.
 */
function overlayDiscoveredThemeValue(value, path) {
  if (typeof value !== 'function' && !isPlainObject(value)) {
    return value;
  }
  const cachedProxy = discoveredProxyCache.get(value);
  if (cachedProxy !== undefined) {
    return cachedProxy;
  }

  const proxy = new Proxy(value, {
    apply(target, thisArgument, arguments_) {
      const targetThis = discoveredProxyTargets.get(thisArgument) ?? thisArgument;
      try {
        return overlayDiscoveredThemeValue(
          Reflect.apply(target, targetThis, arguments_),
          [...path, '()'],
        );
      } catch {
        return createUnitHelperFallback(target, arguments_);
      }
    },
    get(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor?.configurable === false && descriptor.writable === false) {
        return Reflect.get(target, property, target);
      }
      if (!Reflect.has(target, property)) {
        return readMissingDiscoveredToken(path, property);
      }
      try {
        return overlayDiscoveredThemeValue(
          Reflect.get(target, property, target),
          [...path, property],
        );
      } catch {
        return readMissingDiscoveredToken(path, property);
      }
    },
  });
  discoveredProxyCache.set(value, proxy);
  discoveredProxyTargets.set(proxy, value);
  return proxy;
}

/** Accepts only the bounded static property paths emitted by the workspace source transformer. */
function normalizeThemeHelperPath(path) {
  if (!Array.isArray(path) || path.length === 0 || path.length > 12) {
    return undefined;
  }
  const normalized = [];
  for (const propertyName of path) {
    if (
      typeof propertyName !== 'string' ||
      propertyName.length === 0 ||
      propertyName.length > 128 ||
      propertyName === '__proto__' ||
      propertyName === 'constructor' ||
      propertyName === 'prototype'
    ) {
      return undefined;
    }
    normalized.push(propertyName);
  }
  return normalized;
}

/** Reads a nested receiver and final helper without letting a partial provider abort evaluation. */
function readThemeHelperCandidate(theme, path) {
  let receiver = theme;
  try {
    for (const propertyName of path.slice(0, -1)) {
      if ((typeof receiver !== 'object' && typeof receiver !== 'function') || receiver === null) {
        return { helper: undefined, receiver: undefined };
      }
      receiver = Reflect.get(receiver, propertyName, receiver);
    }
    if ((typeof receiver !== 'object' && typeof receiver !== 'function') || receiver === null) {
      return { helper: undefined, receiver: undefined };
    }
    return {
      helper: Reflect.get(receiver, path[path.length - 1], receiver),
      receiver,
    };
  } catch {
    return { helper: undefined, receiver: undefined };
  }
}

/** Records and reports one distinct callable repair without logging every style recomputation. */
function recordRepairedThemeHelper(path, evidence, resolution, reason) {
  if (repairedThemeHelperPaths.size >= MAX_REPAIRED_THEME_HELPERS) {
    return;
  }
  const cacheKey = createTokenCacheKey(path);
  if (repairedThemeHelperPaths.has(cacheKey)) {
    return;
  }
  repairedThemeHelperPaths.add(cacheKey);
  reportPreviewThemeRuntimeHealth('theme-token-repaired', {
    evidence: normalizeThemeValueEvidence(evidence),
    kind: 'callable',
    path: path.map(String),
    reason,
    resolution,
  });
}

/** Records and reports one distinct non-callable path without logging every style recomputation. */
function recordRepairedThemeValue(path, evidence, resolution, reason) {
  if (repairedThemeValuePaths.size >= MAX_REPAIRED_THEME_VALUES) {
    return;
  }
  const cacheKey = createTokenCacheKey(path);
  if (repairedThemeValuePaths.has(cacheKey)) {
    return;
  }
  repairedThemeValuePaths.add(cacheKey);
  reportPreviewThemeRuntimeHealth('theme-token-repaired', {
    evidence: normalizeThemeValueEvidence(evidence),
    path: path.map(String),
    reason,
    resolution,
  });
}

/** Copies only compiler-authored source coordinates into a small live diagnostic record. */
function normalizeThemeValueEvidence(evidence) {
  if (evidence === null || typeof evidence !== 'object') {
    return undefined;
  }
  const sourcePath = typeof evidence.sourcePath === 'string'
    ? evidence.sourcePath.slice(0, 16_384)
    : undefined;
  const line = Number.isSafeInteger(evidence.line) && evidence.line > 0 ? evidence.line : undefined;
  const column = Number.isSafeInteger(evidence.column) && evidence.column > 0
    ? evidence.column
    : undefined;
  return sourcePath === undefined
    ? undefined
    : { sourcePath, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) };
}

/** Invokes one exact helper and reports failure separately from a legitimate undefined result. */
function invokeThemeHelperCandidate(candidate, arguments_) {
  if (typeof candidate.helper !== 'function') {
    return { invoked: false, reason: 'theme-helper-was-not-callable', value: undefined };
  }
  try {
    return {
      invoked: true,
      value: Reflect.apply(candidate.helper, candidate.receiver, arguments_),
    };
  } catch {
    return { invoked: false, reason: 'theme-helper-threw', value: undefined };
  }
}

/**
 * Calls the current provider helper, then the exact root-theme helper, then a numeric unit fallback.
 * This order preserves a valid nested override while cutting only an incompatible callable edge.
 */
function invokeResolvedThemeHelper(theme, path, arguments_, evidence) {
  const localCandidate = readThemeHelperCandidate(theme, path);
  const localResult = invokeThemeHelperCandidate(localCandidate, arguments_);
  if (localResult.invoked) {
    return localResult.value;
  }

  const rootCandidate = readThemeHelperCandidate(activePreviewTheme, path);
  if (
    rootCandidate.helper !== localCandidate.helper ||
    rootCandidate.receiver !== localCandidate.receiver
  ) {
    const rootResult = invokeThemeHelperCandidate(rootCandidate, arguments_);
    if (rootResult.invoked) {
      recordRepairedThemeHelper(path, evidence, 'exact-root-theme', localResult.reason);
      return rootResult.value;
    }
  }

  recordRepairedThemeHelper(path, evidence, 'structural-or-unit-fallback', localResult.reason);
  const fallbackTarget = localCandidate.helper ?? rootCandidate.helper;
  return fallbackTarget !== null &&
    (typeof fallbackTarget === 'object' || typeof fallbackTarget === 'function')
    ? createUnitHelperFallback(fallbackTarget, arguments_)
    : '';
}

/** Creates one stable callable for an exact theme identity and statically proven helper path. */
function createResolvedThemeHelper(theme, path, evidence) {
  return (...arguments_) => invokeResolvedThemeHelper(theme, path, arguments_, evidence);
}

/**
 * Resolves a statically proven styled-components theme helper without assuming its property name.
 * Workspace call sites use this only as an immediate callee, so the returned function can safely
 * isolate a malformed nested provider while retaining the exact project's root helper semantics.
 */
export function resolvePreviewThemeHelper(theme, rawPath, evidence) {
  const path = normalizeThemeHelperPath(rawPath);
  if (path === undefined) {
    return createStructuralToken(['invalid-callable-theme-token']);
  }
  if ((typeof theme !== 'object' && typeof theme !== 'function') || theme === null) {
    return createResolvedThemeHelper(theme, path, evidence);
  }
  let helpers;
  try {
    helpers = resolvedThemeHelperCache.get(theme);
  } catch {
    return createResolvedThemeHelper(theme, path, evidence);
  }
  if (helpers === undefined) {
    helpers = new Map();
    try {
      resolvedThemeHelperCache.set(theme, helpers);
    } catch {
      return createResolvedThemeHelper(theme, path, evidence);
    }
  }
  const cacheKey = createTokenCacheKey(path);
  let helper = helpers.get(cacheKey);
  if (helper === undefined) {
    helper = createResolvedThemeHelper(theme, path, evidence);
    helpers.set(cacheKey, helper);
  }
  return helper;
}

/** Reads one static theme path without invoking getters beyond the authored access itself. */
function readThemeValueCandidate(theme, path) {
  let current = theme;
  for (const propertyName of path) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) {
      return { reason: 'missing-intermediate-theme-container', value: undefined };
    }
    try {
      current = Reflect.get(current, propertyName, current);
    } catch {
      return { reason: 'theme-property-read-threw', value: undefined };
    }
    if (current === undefined) {
      return { reason: 'theme-property-was-undefined', value: undefined };
    }
  }
  return { reason: 'exact-theme-value', value: current };
}

/**
 * Resolves a statically proven non-callable styled-components token through local, root, then
 * structural theme evidence. Exact local primitives and CSS fragments remain authoritative.
 */
export function resolvePreviewThemeValue(theme, rawPath, evidence) {
  const path = normalizeThemeHelperPath(rawPath);
  if (path === undefined) {
    return createStructuralToken(['invalid-non-callable-theme-token']);
  }
  const localCandidate = readThemeValueCandidate(theme, path);
  if (localCandidate.value !== undefined) {
    return localCandidate.value;
  }
  const rootCandidate = readThemeValueCandidate(activePreviewTheme, path);
  if (rootCandidate.value !== undefined) {
    recordRepairedThemeValue(path, evidence, 'exact-root-theme', localCandidate.reason);
    return rootCandidate.value;
  }
  recordRepairedThemeValue(path, evidence, 'structural-token', localCandidate.reason);
  return createStructuralToken(path);
}

/** Reports whether setup supplied a theme object or theme-producing function. */
function readConfiguredTheme(configuration) {
  if (configuration === null || typeof configuration !== 'object') {
    return undefined;
  }
  const theme = configuration.theme;
  return theme !== null && (typeof theme === 'object' || typeof theme === 'function')
    ? theme
    : undefined;
}

/** Reports whether an automatically discovered value can be passed to ThemeProvider. */
function readDiscoveredTheme(discoveredTheme) {
  return discoveredTheme !== null &&
    (typeof discoveredTheme === 'object' || typeof discoveredTheme === 'function')
    ? discoveredTheme
    : undefined;
}

/**
 * Records one statically discovered theme loader without evaluating the referenced project module.
 * Evidence is deduplicated by importing source, bounded globally, and retained only while the
 * generated preview bundle is alive in its isolated webview.
 */
export function registerPreviewThemeCandidate(candidate) {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof candidate.candidateKey !== 'string' ||
    candidate.candidateKey.length === 0 ||
    candidate.candidateKey.length > 4096 ||
    typeof candidate.importerKey !== 'string' ||
    candidate.importerKey.length === 0 ||
    candidate.importerKey.length > 4096 ||
    (candidate.confidence !== 'type' && candidate.confidence !== 'value') ||
    typeof candidate.load !== 'function'
  ) {
    return;
  }

  let registeredCandidate = reachableThemeCandidates.get(candidate.candidateKey);
  if (registeredCandidate === undefined) {
    if (reachableThemeCandidates.size >= MAX_REACHABLE_THEME_CANDIDATES) {
      return;
    }
    registeredCandidate = {
      evidence: new Map(),
      load: candidate.load,
      promise: undefined,
    };
    reachableThemeCandidates.set(candidate.candidateKey, registeredCandidate);
  }

  const previousConfidence = registeredCandidate.evidence.get(candidate.importerKey);
  if (previousConfidence === candidate.confidence || previousConfidence === 'value') {
    return;
  }
  if (previousConfidence === undefined) {
    if (reachableThemeEvidenceCount >= MAX_REACHABLE_THEME_EVIDENCE) {
      return;
    }
    reachableThemeEvidenceCount += 1;
  }
  registeredCandidate.evidence.set(candidate.importerKey, candidate.confidence);
}

/** Scores runtime value evidence above every bounded collection of erased type references. */
function scoreReachableThemeCandidate(candidate) {
  let typeCount = 0;
  let valueCount = 0;
  for (const confidence of candidate.evidence.values()) {
    if (confidence === 'value') {
      valueCount += 1;
    } else {
      typeCount += 1;
    }
  }
  return valueCount * (MAX_REACHABLE_THEME_EVIDENCE + 1) + typeCount;
}

/** Returns one uniquely strongest target-reachable theme candidate without traversal-order guesses. */
function selectReachableThemeCandidate() {
  let winner;
  let winnerScore = -1;
  let tied = false;
  for (const candidate of reachableThemeCandidates.values()) {
    const score = scoreReachableThemeCandidate(candidate);
    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
      tied = false;
    } else if (score === winnerScore) {
      tied = true;
    }
  }
  return tied ? undefined : winner;
}

/**
 * Lazily imports one unambiguous reachable project theme after target modules have registered.
 * Explicit setup and direct-target themes stay authoritative; failed or invalid candidates fall
 * back to the structural compatibility theme instead of failing component rendering.
 */
export async function resolvePreviewTheme(options) {
  const configuration = options?.configuration;
  const discoveredTheme = readDiscoveredTheme(options?.discoveredTheme);
  if (configuration === false) {
    previewRuntimeStatus = 'disabled by setup (themePreview=false)';
    return discoveredTheme;
  }
  if (readConfiguredTheme(configuration) !== undefined) {
    previewRuntimeStatus = 'selected: exact setup-owned theme';
    return discoveredTheme;
  }
  if (discoveredTheme !== undefined) {
    previewRuntimeStatus = 'selected: exact theme imported directly by the target file';
    return discoveredTheme;
  }

  const candidate = selectReachableThemeCandidate();
  if (candidate === undefined) {
    previewRuntimeStatus = reachableThemeCandidates.size === 0
      ? 'fallback: no exact target-reachable theme was discovered; structural theme will be used'
      : 'fallback: reachable theme candidates were ambiguous; structural theme will be used';
    return undefined;
  }
  candidate.promise ??= Promise.resolve()
    .then(() => candidate.load())
    .then(readDiscoveredTheme)
    .catch(() => undefined);
  const resolvedCandidate = await candidate.promise;
  previewRuntimeStatus = resolvedCandidate === undefined
    ? 'fallback: selected reachable theme could not be loaded; structural theme will be used'
    : 'selected: exact target-reachable theme with a structural missing-token overlay';
  return resolvedCandidate;
}

/** Assigns a document style only when its exact string token is present and no inline value exists. */
function applyInlineStyleDefault(style, property, value) {
  if (
    style === null ||
    typeof style !== 'object' ||
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    (typeof style[property] === 'string' && style[property].length > 0)
  ) {
    return;
  }
  try {
    style[property] = value;
  } catch {
    // A partial browser document may expose a read-only style object; preview rendering continues.
  }
}

/** Flattens only inert string/number CSS arrays without calling project interpolation functions. */
function readStaticCssText(value, visitedArrays = new Set()) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (!Array.isArray(value) || visitedArrays.has(value)) {
    return undefined;
  }

  visitedArrays.add(value);
  let text = '';
  for (const item of value) {
    const itemText = readStaticCssText(item, visitedArrays);
    if (itemText === undefined) {
      visitedArrays.delete(value);
      return undefined;
    }
    text += itemText;
  }
  visitedArrays.delete(value);
  return text;
}

/** Infers the browser root size only from a bounded, literal body font-size declaration. */
function inferRootFontSize(theme) {
  const bodyTypography = readStaticCssText(theme?.typography?.body);
  if (bodyTypography === undefined) {
    return undefined;
  }
  const match = /(?:^|[;{\\s])font-size\\s*:\\s*(\\d+(?:\\.\\d+)?)rem\\b/i.exec(bodyTypography);
  const remSize = Number(match?.[1]);
  return Number.isFinite(remSize) && remSize >= 1 && remSize <= 2
    ? String(16 / remSize) + 'px'
    : undefined;
}

/** Reads a non-empty setup root size without interpreting or normalizing its CSS value. */
function readConfiguredRootFontSize(configuration) {
  if (configuration === null || typeof configuration !== 'object') {
    return undefined;
  }
  const rootFontSize = configuration.rootFontSize;
  return typeof rootFontSize === 'string' && rootFontSize.trim().length > 0
    ? rootFontSize
    : undefined;
}

/** Applies minimal document defaults derived exclusively from exact discovered-theme tokens. */
function applyDiscoveredDocumentStyles(theme, configuration) {
  if (
    configuration?.documentStyles === false ||
    typeof document === 'undefined' ||
    document === null
  ) {
    return;
  }

  const bodyStyle = document.body?.style;
  applyInlineStyleDefault(bodyStyle, 'backgroundColor', theme?.color?.pageBackground);
  applyInlineStyleDefault(bodyStyle, 'color', theme?.color?.bodyText);
  applyInlineStyleDefault(bodyStyle, 'fontFamily', theme?.fontFamily?.default);

  const rootStyle = document.documentElement?.style;
  const configuredRootFontSize = readConfiguredRootFontSize(configuration);
  if (configuredRootFontSize !== undefined && rootStyle !== null && typeof rootStyle === 'object') {
    try {
      rootStyle.fontSize = configuredRootFontSize;
    } catch {
      // A partial browser document may reject mutation; the component theme still remains usable.
    }
    return;
  }
  applyInlineStyleDefault(rootStyle, 'fontSize', inferRootFontSize(theme));
}

/**
 * Wraps a composed preview tree with the target project's styled-components ThemeProvider.
 * An inner project provider still wins through normal React context precedence. Exporting
 * themePreview=false disables the bridge; themePreview={ theme } supplies an exact root theme.
 */
export function createThemePreviewElement(children, options) {
  const configuration = options?.configuration;
  const ThemeProvider = StyledComponents.ThemeProvider ?? StyledComponents.default?.ThemeProvider;
  if (configuration === false) {
    activePreviewTheme = undefined;
    previewRuntimeStatus = 'disabled by setup (themePreview=false)';
    return children;
  }
  if (typeof ThemeProvider !== 'function') {
    activePreviewTheme = undefined;
    previewRuntimeStatus = 'unavailable: installed styled-components has no ThemeProvider export';
    return children;
  }
  const configuredTheme = readConfiguredTheme(configuration);
  const discoveredTheme = readDiscoveredTheme(options?.discoveredTheme);
  const previewTheme = configuredTheme ?? (
    discoveredTheme === undefined
      ? structuralTheme
      : overlayDiscoveredThemeValue(discoveredTheme, [])
  );
  activePreviewTheme = previewTheme;
  if (configuredTheme !== undefined) {
    previewRuntimeStatus = 'active: exact setup-owned theme';
  } else if (discoveredTheme === undefined) {
    previewRuntimeStatus = 'active: structural theme fallback because no unique exact theme loaded';
  } else if (!previewRuntimeStatus.startsWith('selected:')) {
    previewRuntimeStatus = 'active: exact discovered theme with a structural missing-token overlay';
  } else {
    previewRuntimeStatus = 'active: ' + previewRuntimeStatus.slice('selected: '.length);
  }
  if (configuredTheme === undefined && discoveredTheme !== undefined) {
    applyDiscoveredDocumentStyles(previewTheme, configuration);
  }
  const themeStrategy = configuredTheme !== undefined
    ? 'configured'
    : discoveredTheme === undefined
      ? 'structural'
      : 'discovered';
  const expectedTradeoffs = [];
  if (previewStyledComponentsResolutionKind === 'require-call') {
    expectedTradeoffs.push('canonical-commonjs-entry-may-reduce-tree-shaking');
  }
  if (themeStrategy === 'structural') {
    expectedTradeoffs.push('missing-theme-values-render-as-empty-css');
  }
  reportPreviewThemeRuntimeHealth('theme-boundary-composed', {
    expectedTradeoffs,
    modulePath: previewStyledComponentsModulePath,
    resolutionKind: previewStyledComponentsResolutionKind,
    singletonStrategy: 'canonical-exact-bare-import',
    strategy: themeStrategy,
  });
  return React.createElement(
    ThemeProvider,
    { theme: previewTheme },
    children,
  );
}
`;
}

/**
 * Normalizes Windows separators before embedding an absolute path as an ESM import specifier.
 *
 * @param modulePath Absolute file path selected by esbuild's browser-aware resolver.
 * @returns Slash-separated import path safe to JSON-encode into generated JavaScript.
 */
function normalizeImportPath(modulePath: string): string {
  return modulePath.replaceAll('\\', '/');
}
