/**
 * Compiles project-owned Sass styles without loading webpack, Vite, or Storybook configuration.
 * The nearest package's own `sass` implementation is used so monorepos keep their declared syntax
 * version. Missing compilers and stylesheet failures degrade to an empty style plus a warning: a
 * cosmetic dependency must not prevent the React component itself from rendering.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Loader, OnLoadArgs, OnLoadResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  compilePreviewSass,
  loadProjectSassImplementation,
  type PreviewSassImplementation,
  type PreviewSassTask,
  type PreviewSassTaskFactory,
} from './previewSassCompiler';

const SASS_SOURCE_FILTER = /\.s[ac]ss$/i;
const SASS_MODULE_FILTER = /\.module\.s[ac]ss$/iu;
const MAX_SASS_CACHE_ENTRIES = 32;

/** Cached CSS plus dependency fingerprints needed to reject stale hot-reload results. */
interface PreviewSassCacheEntry {
  /** Compiled CSS returned directly to esbuild on a valid cache hit. */
  readonly css: string;
  /** Canonical Sass entry and partial files used by the previous compilation. */
  readonly dependencyPaths: readonly string[];
  /** File identity and high-resolution change/modification times aligned with `dependencyPaths`. */
  readonly fingerprints: readonly string[];
}

/** Public plugin and graph evidence consumed by the compiler after a successful build. */
export interface PreviewSassBoundary {
  /** Waits for unused or cancelled initialization to terminate, sharing concurrent disposal. */
  dispose(): Promise<void>;
  /** Current Sass and partial files that must trigger this panel's hot reload. */
  getDependencyPaths(): readonly string[];
  /** Narrow directories watched after a recoverable Sass compilation failure. */
  getWatchDirectories(): readonly string[];
  /** Esbuild loader responsible only for `.scss` and `.sass` filesystem modules. */
  readonly plugin: Plugin;
}

/** Trusted roots used to resolve the package compiler and Sass load paths. */
export interface PreviewSassPluginOptions {
  /** Nearest package boundary selected for the active component. */
  readonly projectRoot: string;
  /** Workspace boundary containing monorepo-hoisted dependencies. */
  readonly workspaceRoot: string;
  /** First-build-only runtime initialization; Sass source reads still start at onLoad. */
  readonly preparation?: {
    readonly sourcePath: string;
    readonly createTask: PreviewSassTaskFactory;
    readonly signal: AbortSignal;
  };
}

/**
 * Creates one compilation-context Sass adapter with a bounded dependency-aware result cache.
 *
 * @param options Nearest package and workspace roots selected without executing project config.
 * @returns Plugin plus dependency/watch evidence for artifact hot-reload routing.
 */
export function createPreviewSassPlugin(options: PreviewSassPluginOptions): PreviewSassBoundary {
  const dependencyPaths = new Set<string>();
  const watchDirectories = new Set<string>();
  const cacheByEntry = new Map<string, PreviewSassCacheEntry>();
  let sass: PreviewSassImplementation | undefined;
  let sassPrepared = false;
  let preparationAttempted = false;
  let preparedTask: PreviewSassTask | undefined;
  let preparedTaskDisposal: Promise<void> | undefined;

  /** Initializes the existing one-shot transport once, without requesting stylesheet contents. */
  function prepare(): void {
    if (preparationAttempted || options.preparation === undefined) return;
    preparationAttempted = true;
    if (options.preparation.signal.aborted) return;
    try {
      preparedTask = options.preparation.createTask(
        {
          projectRoot: options.projectRoot,
          workspaceRoot: options.workspaceRoot,
          sourcePath: options.preparation.sourcePath,
        },
        options.preparation.signal,
      );
    } catch {
      /* Ordinary Sass compilation remains available after a transport failure. */
    }
  }

  /** Stops unused, completed, or cancelled initialization before native build cleanup settles. */
  async function disposePreparedTask(): Promise<void> {
    const task = preparedTask;
    preparedTask = undefined;
    if (task !== undefined) preparedTaskDisposal = task.dispose();
    await preparedTaskDisposal;
  }

  /** Returns stable dependency evidence from the latest build attempt. */
  function getDependencyPaths(): readonly string[] {
    return [...dependencyPaths].sort();
  }

  /** Returns bounded recovery directories from the latest build attempt. */
  function getWatchDirectories(): readonly string[] {
    return [...watchDirectories].sort();
  }

  /** Compiles one Sass file or returns fail-soft CSS when the optional tool/style is unavailable. */
  async function loadSass(arguments_: OnLoadArgs): Promise<OnLoadResult> {
    const sourcePath = canonicalizeExistingPath(arguments_.path);
    dependencyPaths.add(sourcePath);
    const loader = selectCompiledStyleLoader(sourcePath);
    const cached = cacheByEntry.get(sourcePath);
    if (cached !== undefined && (await cacheEntryIsCurrent(cached))) {
      for (const dependencyPath of cached.dependencyPaths) dependencyPaths.add(dependencyPath);
      return createCompiledSassResult(cached.css, cached.dependencyPaths, loader, sourcePath);
    }

    try {
      const task = options.preparation?.sourcePath === sourcePath ? preparedTask : undefined;
      let result = await task?.compile();
      if (task !== undefined && options.preparation?.signal.aborted === true) {
        throw (
          options.preparation.signal.reason ??
          new DOMException('Sass build cancelled.', 'AbortError')
        );
      }
      if (result === undefined) {
        if (!sassPrepared) {
          sass = loadProjectSassImplementation(options.projectRoot);
          sassPrepared = true;
        }
        if (sass === undefined) {
          return createSkippedSassResult(
            sourcePath,
            loader,
            'No compatible "sass" package was found from the nearest project package. Install sass to include this stylesheet.',
          );
        }
        result = await compilePreviewSass(sass, { ...options, sourcePath });
      }
      const loadedPaths = collectLoadedSassPaths(sourcePath, result.loadedUrls);
      const fingerprints = await Promise.all(loadedPaths.map(readFileFingerprint));
      const entry = { css: result.css, dependencyPaths: loadedPaths, fingerprints };
      rememberCacheEntry(cacheByEntry, sourcePath, entry);
      for (const dependencyPath of loadedPaths) dependencyPaths.add(dependencyPath);
      return createCompiledSassResult(result.css, loadedPaths, loader, sourcePath);
    } catch (error) {
      watchDirectories.add(path.dirname(sourcePath));
      return createSkippedSassResult(
        sourcePath,
        loader,
        `Sass compilation failed and this style was skipped: ${describeSassError(error)}`,
        error,
      );
    }
  }

  const plugin: Plugin = {
    name: 'react-preview-sass',
    setup(build): void {
      build.onStart(() => {
        dependencyPaths.clear();
        watchDirectories.clear();
        prepare();
      });
      build.onLoad({ filter: SASS_SOURCE_FILTER, namespace: 'file' }, loadSass);
      build.onEnd(disposePreparedTask);
      build.onDispose(() => {
        void disposePreparedTask();
      });
    },
  };
  return { dispose: disposePreparedTask, getDependencyPaths, getWatchDirectories, plugin };
}

/** Returns local-css for Sass modules and ordinary css for global Sass side effects. */
function selectCompiledStyleLoader(sourcePath: string): Loader {
  return SASS_MODULE_FILTER.test(sourcePath) ? 'local-css' : 'css';
}

/** Creates a normal CSS load result with every Sass partial registered for rebuild watching. */
function createCompiledSassResult(
  css: string,
  dependencyPaths: readonly string[],
  loader: Loader,
  sourcePath: string,
): OnLoadResult {
  return {
    contents: css,
    loader,
    resolveDir: path.dirname(sourcePath),
    watchFiles: [...dependencyPaths],
  };
}

/** Keeps rendering alive while surfacing one structured non-fatal style diagnostic. */
function createSkippedSassResult(
  sourcePath: string,
  loader: Loader,
  message: string,
  error?: unknown,
): OnLoadResult {
  return {
    contents: `/* React Preview skipped ${path.basename(sourcePath)}. */`,
    loader,
    resolveDir: path.dirname(sourcePath),
    warnings: [{ ...(error === undefined ? {} : { detail: error }), text: message }],
    watchDirs: [path.dirname(sourcePath)],
    watchFiles: [sourcePath],
  };
}

/** Converts Sass file URLs into unique canonical filesystem dependencies. */
function collectLoadedSassPaths(sourcePath: string, loadedUrls: readonly URL[]): readonly string[] {
  const loadedPaths = new Set<string>([sourcePath]);
  for (const loadedUrl of loadedUrls) {
    if (loadedUrl.protocol === 'file:') {
      loadedPaths.add(canonicalizeExistingPath(fileURLToPath(loadedUrl)));
    }
  }
  return [...loadedPaths].sort();
}

/** Validates cached Sass without rereading content, including timestamp-preserving same-size edits. */
async function readFileFingerprint(sourcePath: string): Promise<string> {
  const status = await stat(sourcePath);
  return `${status.dev.toString()}:${status.ino.toString()}:${status.size.toString()}:${status.mtimeMs.toString()}:${status.ctimeMs.toString()}`;
}

/** Checks all prior transitive Sass files in parallel before reusing compiled CSS. */
async function cacheEntryIsCurrent(entry: PreviewSassCacheEntry): Promise<boolean> {
  try {
    const current = await Promise.all(entry.dependencyPaths.map(readFileFingerprint));
    return current.every((fingerprint, index) => fingerprint === entry.fingerprints[index]);
  } catch {
    return false;
  }
}

/** Inserts one result and evicts the oldest entry when the context-local cache is full. */
function rememberCacheEntry(
  cacheByEntry: Map<string, PreviewSassCacheEntry>,
  sourcePath: string,
  entry: PreviewSassCacheEntry,
): void {
  cacheByEntry.delete(sourcePath);
  cacheByEntry.set(sourcePath, entry);
  if (cacheByEntry.size <= MAX_SASS_CACHE_ENTRIES) return;
  const oldestPath = cacheByEntry.keys().next().value;
  if (oldestPath !== undefined) cacheByEntry.delete(oldestPath);
}

/** Converts arbitrary Sass rejections to one concise single-line warning. */
function describeSassError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/gu, ' ').trim().slice(0, 1_000);
}
