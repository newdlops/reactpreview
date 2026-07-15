/**
 * Centralizes platform-aware path identities shared by compiler and VS Code adapters.
 * Lexical identity preserves an editor's symlink before esbuild resolves it, while canonical identity
 * lets dependency save events match esbuild's real paths after module resolution.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Produces a stable lexical identity without following symlinks.
 *
 * @param filePath Absolute or relative filesystem path.
 * @returns Resolved and platform-case-normalized comparison key.
 */
export function normalizeLexicalPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

/**
 * Produces a save-event identity that follows existing symlinks just as esbuild does.
 * Missing or transient paths fall back to lexical normalization instead of breaking refresh events.
 *
 * @param filePath Existing dependency path or a fallback lexical path.
 * @returns Canonical, platform-case-normalized comparison key.
 */
export function canonicalizeExistingPath(filePath: string): string {
  try {
    return normalizeLexicalPath(realpathSync.native(filePath));
  } catch {
    return normalizeLexicalPath(filePath);
  }
}
