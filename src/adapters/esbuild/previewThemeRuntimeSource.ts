/**
 * Generates the browser-only styled-components compatibility boundary used by previews.
 * The generated theme deliberately provides structure rather than invented design values: missing
 * mixins and functions collapse to empty CSS, allowing layout markup to render approximately while
 * an explicit project provider remains the nearest and therefore authoritative theme context.
 */

/** Resolved project module required to build the optional theme preview boundary. */
export interface PreviewThemeRuntimeSourceOptions {
  /** Absolute browser-resolved entry for the target project's styled-components package. */
  readonly styledComponentsModulePath: string;
}

/**
 * Creates the source for a safe structural theme and project-owned ThemeProvider wrapper.
 * Proxy tokens are callable and string-coercible, covering both `theme.spacing(2)` and CSS mixin
 * access such as `theme.flex.colCenter` without assuming any repository-specific token names.
 *
 * @param options Project-owned styled-components module selected through esbuild resolution.
 * @returns JavaScript source loaded inside the private theme bridge namespace.
 */
export function createPreviewThemeRuntimeSource(options: PreviewThemeRuntimeSourceOptions): string {
  const encodedModulePath = JSON.stringify(normalizeImportPath(options.styledComponentsModulePath));
  return `
import * as React from 'react';
import * as StyledComponents from ${encodedModulePath};

const tokenCache = new Map();

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

/**
 * Wraps a composed preview tree with the target project's styled-components ThemeProvider.
 * An inner project provider still wins through normal React context precedence. Exporting
 * themePreview=false disables the bridge; themePreview={ theme } supplies an exact root theme.
 */
export function createThemePreviewElement(children, options) {
  const configuration = options?.configuration;
  const ThemeProvider = StyledComponents.ThemeProvider ?? StyledComponents.default?.ThemeProvider;
  if (configuration === false || typeof ThemeProvider !== 'function') {
    return children;
  }
  const configuredTheme = readConfiguredTheme(configuration);
  return React.createElement(
    ThemeProvider,
    { theme: configuredTheme ?? structuralTheme },
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
