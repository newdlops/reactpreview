/**
 * Finds explicit server modules that perform host I/O, so the first build can load them as
 * render-only execution contracts instead of evaluating them in the browser.
 *
 * A module that imports `server-only` (or declares `'use server'`) and reaches the filesystem,
 * child processes, or sockets through Node built-ins cannot do anything meaningful in a preview.
 * Evaluating it anyway also evaluates every Node-targeted package it imports: document parsers and
 * cloud SDKs touch `Buffer` or `createRequire(import.meta.url)('cfb')` at module scope and fail
 * before any component renders. Built-in shims only move that failure to the next server internal,
 * so these modules join the dependency hint plan's facade candidates, exactly like a server module
 * whose package is missing. The facade loader still re-checks the explicit boundary on every build.
 */
import path from 'node:path';
import { collectPreviewInspectorRuntimeImportInventory } from './inspector/previewInspectorRuntimeImportInventory';
import { hasExplicitPreviewServerBoundary } from './previewDependencyResolutionHintPlugin';

/** Node built-ins whose only purpose is host I/O; `path`, `url`, and `events` are not included. */
const HOST_IO_BUILTINS = new Set([
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'net',
  'readline',
  'repl',
  'tls',
  'worker_threads',
]);
const HOST_IO_SPECIFIER_PATTERN =
  /["'](?:node:)?(?:child_process|cluster|dgram|dns|fs|http2?|https|inspector|net|readline|repl|tls|worker_threads)(?:\/promises)?["']/u;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const MAX_SOURCE_LENGTH = 2 * 1024 * 1024;

/**
 * Returns the non-target explicit server modules that import a host I/O built-in.
 *
 * @param options Frontier sources, their reader, and the previewed target that is never replaced.
 * @returns Normalized, sorted module paths.
 */
export async function collectPreviewHostIoServerSourcePaths(options: {
  readonly readSource: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  readonly sourcePaths: readonly string[];
  readonly targetPath: string;
}): Promise<readonly string[]> {
  const targetPath = path.normalize(options.targetPath);
  const found: string[] = [];
  for (const sourcePath of new Set(options.sourcePaths.map((value) => path.normalize(value)))) {
    if (sourcePath === targetPath || !SOURCE_PATTERN.test(sourcePath)) continue;
    const sourceText = await options.readSource(sourcePath);
    // Cheap text checks first; only candidate modules are parsed.
    if (
      sourceText === undefined ||
      sourceText.length > MAX_SOURCE_LENGTH ||
      !HOST_IO_SPECIFIER_PATTERN.test(sourceText) ||
      !hasExplicitPreviewServerBoundary(sourceText)
    ) {
      continue;
    }
    const importsHostIo = collectPreviewInspectorRuntimeImportInventory(
      sourcePath,
      sourceText,
    ).some((edge) => HOST_IO_BUILTINS.has(edge.moduleSpecifier.replace(/^node:/u, '')));
    if (importsHostIo) found.push(sourcePath);
  }
  return Object.freeze(found.sort());
}
