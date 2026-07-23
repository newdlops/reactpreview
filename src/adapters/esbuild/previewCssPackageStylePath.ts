/**
 * Resolves installed CSS package targets selected by the community `style` export condition.
 *
 * This module performs only inert manifest/filesystem inspection. Callers remain responsible for
 * deciding which import kinds are eligible and whether the resulting stylesheet may be executed by
 * a processor or merely read during a safety preflight.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  parsePreviewBarePackageSpecifier,
  selectPreviewPackageStyleExport,
} from './previewCssPackageExports';

const CSS_FILE_PATTERN = /\.css$/iu;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

/** Inert fields read from an installed package manifest during CSS-only style resolution. */
interface PreviewCssStylePackageManifest {
  /** Conditional package exports inspected by the shared pure selector. */
  readonly exports?: unknown;
  /** Exact package identity that prevents an unrelated ancestor from being accepted. */
  readonly name?: unknown;
}

/** Installed package root paired with the manifest that proved its exact npm identity. */
interface PreviewInstalledCssStylePackage {
  /** Parsed inert metadata used to select the requested style subpath. */
  readonly manifest: PreviewCssStylePackageManifest;
  /** Lexical package directory below the applicable node_modules ancestry. */
  readonly rootPath: string;
}

/**
 * Resolves a package target chosen specifically by the CSS `style` export condition.
 *
 * Node's `createRequire().resolve()` cannot locate a package whose root has no JavaScript/default
 * condition, and it selects JavaScript when a package exposes both forms. This resolver instead
 * finds an ordinary installed package manifest, applies CSS condition semantics, and repeats both
 * lexical and canonical containment checks before returning an existing regular CSS file.
 *
 * @param moduleSpecifier Exact bare package request with any query or fragment removed.
 * @param startDirectories Ordered importer and fallback directories for node_modules ancestry.
 * @returns Canonical style target, or `undefined` when no safe exact export can be proven.
 */
export function resolvePreviewInstalledCssPackageStylePath(
  moduleSpecifier: string,
  startDirectories: readonly string[],
): string | undefined {
  const request = parsePreviewBarePackageSpecifier(moduleSpecifier);
  if (request === undefined) return undefined;
  const installedPackage = findInstalledCssStylePackage(request.packageName, startDirectories);
  if (installedPackage === undefined) return undefined;

  const target = selectPreviewPackageStyleExport(
    installedPackage.manifest.exports,
    request.exportSubpath,
  );
  if (
    target === undefined ||
    !target.startsWith('./') ||
    /[?#]/u.test(target) ||
    !CSS_FILE_PATTERN.test(target)
  ) {
    return undefined;
  }

  const targetPath = path.resolve(installedPackage.rootPath, target);
  if (!isPathInside(installedPackage.rootPath, targetPath)) return undefined;
  try {
    if (!statSync(targetPath).isFile()) return undefined;
  } catch {
    return undefined;
  }

  const canonicalPackageRoot = canonicalizeExistingPath(installedPackage.rootPath);
  const canonicalTargetPath = canonicalizeExistingPath(targetPath);
  return isPathInside(canonicalPackageRoot, canonicalTargetPath) ? canonicalTargetPath : undefined;
}

/**
 * Searches nearest and fallback node_modules ancestries for one exact package manifest.
 *
 * Starting with an importing stylesheet preserves nested dependency semantics. Additional roots can
 * cover hoisted packages when generated or canonicalized importers lose their lexical install path.
 */
function findInstalledCssStylePackage(
  packageName: string,
  startDirectories: readonly string[],
): PreviewInstalledCssStylePackage | undefined {
  const visitedDirectories = new Set<string>();
  for (const startDirectory of startDirectories) {
    let directory = path.resolve(startDirectory);
    while (!visitedDirectories.has(directory)) {
      visitedDirectories.add(directory);
      const packageRoot = path.join(directory, 'node_modules', packageName);
      const manifest = readCssStylePackageManifest(path.join(packageRoot, 'package.json'));
      if (manifest?.name === packageName) return { manifest, rootPath: packageRoot };
      const parentDirectory = path.dirname(directory);
      if (parentDirectory === directory) break;
      directory = parentDirectory;
    }
  }
  return undefined;
}

/**
 * Reads one bounded object-shaped package manifest without importing package code.
 *
 * @param manifestPath Candidate package.json below a searched node_modules directory.
 * @returns Narrow inert fields, or `undefined` for absent, oversized, or malformed metadata.
 */
function readCssStylePackageManifest(
  manifestPath: string,
): PreviewCssStylePackageManifest | undefined {
  try {
    const metadata = statSync(manifestPath);
    if (!metadata.isFile() || metadata.size > MAX_PACKAGE_MANIFEST_BYTES) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reports whether a canonical candidate equals or remains below one canonical root.
 *
 * @param rootPath Package boundary after lexical or canonical normalization.
 * @param candidatePath Potential exported stylesheet path.
 * @returns Whether relative traversal remains within the package boundary.
 */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
