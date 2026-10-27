/** Creates bounded static import expressions and confined portable source identities. */
import path from 'node:path';
import { PreviewSourceTransformError } from './previewSourceReplacement';
import { INSTALLED_DEPENDENCY_DIRECTORY_NAMES } from './previewSourceTransformModel';

/** Generates a static import matching Vite namespace, default, or named-export selection. */
export function createEagerImport(
  binding: string,
  specifier: string,
  importName: string | undefined,
): string {
  if (importName === undefined || importName === '*') {
    return `import * as ${binding} from ${JSON.stringify(specifier)};`;
  }
  return `import { ${JSON.stringify(importName)} as ${binding} } from ${JSON.stringify(specifier)};`;
}

/** Generates a lazy import and optional export-selection promise. */
export function createLazyImport(specifier: string, importName: string | undefined): string {
  const baseImport = `() => import(${JSON.stringify(specifier)})`;
  return importName === undefined || importName === '*'
    ? baseImport
    : `() => import(${JSON.stringify(specifier)}).then((module) => module[${JSON.stringify(importName)}])`;
}

/** Appends one transform query before an optional URL fragment. */
export function appendImportQuery(specifier: string, query: string | undefined): string {
  if (query === undefined || query.length === 0) {
    return specifier;
  }
  const normalizedQuery = query.startsWith('?') ? query : `?${query}`;
  const fragmentIndex = specifier.indexOf('#');
  return fragmentIndex < 0
    ? `${specifier}${normalizedQuery}`
    : `${specifier.slice(0, fragmentIndex)}${normalizedQuery}${specifier.slice(fragmentIndex)}`;
}

/**
 * Generates one evaluation, path normalization, and finite loader lookup for dynamic module paths.
 * Normalization aligns `./a/../b` and duplicate-slash runtime values with filesystem match keys.
 *
 * @param argumentExpression Original dynamic argument evaluated exactly once.
 * @param loaders Finite object literal mapping normalized keys to module thunks.
 * @param callee User-facing operation name included in a missing-key error.
 * @param asynchronous Whether a miss rejects a promise instead of throwing synchronously.
 * @returns Browser JavaScript expression preserving import or require timing semantics.
 */
export function createBoundedLoaderExpression(
  argumentExpression: string,
  loaders: string,
  callee: string,
  asynchronous: boolean,
): string {
  const message = JSON.stringify(`React Preview could not resolve ${callee}: `);
  const missingResult = asynchronous
    ? `return Promise.reject(new Error(${message} + value));`
    : `throw new Error(${message} + value);`;
  return `((specifier) => { const value = String(specifier); const suffixIndex = [value.indexOf("?"), value.indexOf("#")].filter((index) => index >= 0).reduce((lowest, index) => Math.min(lowest, index), value.length); const sourcePath = value.slice(0, suffixIndex); const suffix = value.slice(suffixIndex); const parts = []; for (const part of sourcePath.split("/")) { if (part === "" || part === ".") continue; if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop(); else if (part !== ".." || parts.length === 0 || parts[parts.length - 1] === "..") parts.push(part); } const normalized = (parts[0] === ".." ? "" : "./") + parts.join("/") + suffix; const loader = ${loaders}[normalized]; if (loader === undefined) { ${missingResult} } return loader(); })(${argumentExpression})`;
}

/** Separates a dynamic import transform query or fragment from its filesystem match pattern. */
export function splitImportSuffix(pattern: string): {
  readonly pathPattern: string;
  readonly suffix: string;
} {
  const queryIndex = pattern.indexOf('?');
  const fragmentIndex = pattern.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), pattern.length);
  return { pathPattern: pattern.slice(0, suffixIndex), suffix: pattern.slice(suffixIndex) };
}

/** Converts an absolute match into a Webpack-style key relative to its context directory. */
export function createRelativeKey(contextDirectory: string, filePath: string): string {
  const relativePath = path.relative(contextDirectory, filePath).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/** Creates a `?url` import, mapping root URLs to the conventional workspace public directory. */
export function createUrlImportSpecifier(assetPath: string, workspaceRoot: string): string {
  const { pathPattern, suffix } = splitImportSuffix(assetPath);
  const publicDirectory = path.resolve(workspaceRoot, 'public');
  const sourcePath = pathPattern.startsWith('/')
    ? path.resolve(publicDirectory, pathPattern.slice(1))
    : pathPattern.startsWith('.')
      ? pathPattern
      : `./${pathPattern}`;
  if (pathPattern.startsWith('/') && !isPathInside(publicDirectory, sourcePath)) {
    throw new PreviewSourceTransformError(
      `Preview public asset paths must stay inside ${publicDirectory}: ${assetPath}`,
    );
  }
  const fragmentIndex = suffix.indexOf('#');
  const fragment = fragmentIndex < 0 ? '' : suffix.slice(fragmentIndex);
  return `${sourcePath}?url${fragment}`;
}

/** Reports whether one absolute asset path is equal to or contained by a trusted directory. */
export function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/**
 * Keeps semantic preview instrumentation on authored source instead of installed package internals.
 *
 * Package code must preserve its own provider invariants. In particular, synthesizing a local
 * `useInRouterContext()` result inside React Router can turn its defensive nested-Router check into
 * an unconditional failure. An explicitly selected document remains eligible so opening a package
 * source file directly still behaves like any other preview target.
 */
export function isPreviewOwnedSourcePath(
  workspaceRoot: string,
  documentPath: string | undefined,
  sourcePath: string,
): boolean {
  if (!isPathInside(workspaceRoot, sourcePath)) return false;
  if (documentPath !== undefined && path.normalize(sourcePath) === path.normalize(documentPath)) {
    return true;
  }
  return !path
    .relative(workspaceRoot, sourcePath)
    .split(path.sep)
    .some((segment) => INSTALLED_DEPENDENCY_DIRECTORY_NAMES.has(segment));
}
