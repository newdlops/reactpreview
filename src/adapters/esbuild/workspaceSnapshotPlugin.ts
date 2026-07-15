/**
 * Overlays file-backed dirty editor documents onto esbuild's reachable module graph.
 * Canonical path matching unifies symlinks, aliases, and circular imports so a dirty snapshot never
 * coexists with a second saved copy while unrelated open documents are never loaded or bundled.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { canonicalizeExistingPath, normalizeLexicalPath } from '../../shared/pathIdentity';
import {
  isFileBackedPreviewNamespace,
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_SNAPSHOT_NAMESPACE,
} from './previewPluginProtocol';

/** Immutable document snapshots supplied to one compilation request. */
export interface WorkspaceSnapshotPluginOptions {
  /** Active document followed by any dirty reachable dependency snapshots. */
  readonly snapshots: readonly PreviewSourceSnapshot[];
}

/**
 * Creates an esbuild plugin that serves editor text for every resolved dirty document.
 *
 * @param options Active and dependency snapshots captured before compilation starts.
 * @returns Stateless esbuild plugin scoped to one immutable request.
 */
export function createWorkspaceSnapshotPlugin(options: WorkspaceSnapshotPluginOptions): Plugin {
  const snapshotByCanonicalPath = new Map<string, PreviewSourceSnapshot>();
  const snapshotByLexicalPath = new Map<string, PreviewSourceSnapshot>();
  for (const snapshot of options.snapshots) {
    const canonicalPath = canonicalizeExistingPath(snapshot.documentPath);
    const lexicalPath = normalizeLexicalPath(snapshot.documentPath);
    if (!snapshotByCanonicalPath.has(canonicalPath)) {
      snapshotByCanonicalPath.set(canonicalPath, snapshot);
    }
    snapshotByLexicalPath.set(lexicalPath, snapshot);
  }

  /**
   * Returns captured editor text for a snapshot identity selected during resolution.
   *
   * @param arguments_ File-loading request emitted by esbuild.
   * @returns In-memory source and loader, or `undefined` for an unknown identity.
   */
  function loadSnapshot(arguments_: OnLoadArgs): OnLoadResult | undefined {
    const snapshot = snapshotByLexicalPath.get(normalizeLexicalPath(arguments_.path));
    if (snapshot === undefined) {
      return undefined;
    }

    return {
      contents: snapshot.sourceText,
      loader: snapshot.language,
      resolveDir: path.dirname(canonicalizeExistingPath(snapshot.documentPath)),
      watchFiles: [snapshot.documentPath],
    };
  }

  return {
    name: 'react-preview-workspace-snapshots',
    setup(build): void {
      /**
       * Delegates to esbuild, then replaces any canonical dirty-document result with its snapshot.
       *
       * @param arguments_ Module-resolution request emitted by esbuild.
       * @returns Normal resolution result or private snapshot identity.
       */
      async function resolveSnapshot(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if ((arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD) {
          return undefined;
        }

        const fromVirtualModule = isFileBackedPreviewNamespace(arguments_.namespace);
        const virtualImporter = fromVirtualModule
          ? canonicalizeExistingPath(arguments_.importer)
          : arguments_.importer;
        const resolved = await build.resolve(arguments_.path, {
          importer: virtualImporter,
          kind: arguments_.kind,
          namespace: fromVirtualModule ? 'file' : arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: fromVirtualModule ? path.dirname(virtualImporter) : arguments_.resolveDir,
          with: arguments_.with,
        });

        if (resolved.errors.length > 0) {
          return { errors: resolved.errors, warnings: resolved.warnings };
        }

        const snapshot =
          !resolved.external && resolved.namespace === 'file'
            ? snapshotByCanonicalPath.get(canonicalizeExistingPath(resolved.path))
            : undefined;
        if (snapshot !== undefined) {
          return {
            namespace: PREVIEW_SNAPSHOT_NAMESPACE,
            path: snapshot.documentPath,
            sideEffects: resolved.sideEffects,
            suffix: resolved.suffix,
            warnings: resolved.warnings,
          };
        }

        return {
          external: resolved.external,
          namespace: resolved.namespace,
          path: resolved.path,
          pluginData: resolved.pluginData as unknown,
          sideEffects: resolved.sideEffects,
          suffix: resolved.suffix,
          warnings: resolved.warnings,
        };
      }

      build.onResolve({ filter: /.*/ }, resolveSnapshot);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_SNAPSHOT_NAMESPACE }, loadSnapshot);
    },
  };
}
