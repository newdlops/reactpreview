/** Owns request-local reverse-target matching without adding state to module resolution. */
import path from 'node:path';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

const SOURCE_EXTENSION_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

/** Matching and spelling evidence shared by callers of one request-owned resolver. */
export interface PreviewStaticTargetMatcher {
  /** Returns sorted authored spellings proven to reach this target during the current request. */
  readonly getMatchedSpecifiers: (targetPath: string) => readonly string[];
  /** Resolves the exact issuer and compares its result with the current canonical target. */
  readonly matchesTarget: (
    moduleSpecifier: string,
    consumerPath: string,
    targetPath: string,
  ) => boolean;
}

/**
 * Creates one current-pivot memo around an unchanged module resolver.
 * A different target replaces the single path cell; a new request starts with an empty cell.
 * File and import-answer caches remain owned by the supplied resolver with their existing limits.
 */
export function createPreviewStaticTargetMatcher(
  resolve: (moduleSpecifier: string, consumerPath: string) => string | undefined,
): PreviewStaticTargetMatcher {
  const matchedSpecifiersByTarget = new Map<string, Set<string>>();
  let lastTargetPath: string | undefined;
  let lastCanonicalTargetPath: string | undefined;

  /** Reuses the current reverse-search pivot without retaining unrelated file metadata. */
  function canonicalizeTargetPath(targetPath: string): string {
    if (targetPath !== lastTargetPath || lastCanonicalTargetPath === undefined) {
      lastCanonicalTargetPath = canonicalizeExistingPath(targetPath);
      lastTargetPath = targetPath;
    }
    return lastCanonicalTargetPath;
  }

  return {
    getMatchedSpecifiers(targetPath: string): readonly string[] {
      return Object.freeze(
        [...(matchedSpecifiersByTarget.get(normalizeSourceIdentity(targetPath)) ?? [])].sort(),
      );
    },
    matchesTarget(moduleSpecifier: string, consumerPath: string, targetPath: string): boolean {
      const resolvedPath = resolve(moduleSpecifier, consumerPath);
      const matches =
        resolvedPath !== undefined &&
        normalizeSourceIdentity(resolvedPath) ===
          normalizeSourceIdentity(canonicalizeTargetPath(targetPath));
      if (matches) {
        const targetIdentity = normalizeSourceIdentity(targetPath);
        const matchedSpecifiers =
          matchedSpecifiersByTarget.get(targetIdentity) ?? new Set<string>();
        matchedSpecifiers.add(moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier);
        matchedSpecifiersByTarget.set(targetIdentity, matchedSpecifiers);
      }
      return matches;
    },
  };
}

/** Treats extensionful JS imports and their resolved TS/TSX sources as one module identity. */
function normalizeSourceIdentity(sourcePath: string): string {
  return path.normalize(sourcePath).replace(SOURCE_EXTENSION_PATTERN, '');
}
