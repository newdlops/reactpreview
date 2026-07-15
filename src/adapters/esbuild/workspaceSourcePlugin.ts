/**
 * Resolves project modules, overlays dirty editor snapshots, and applies bounded source transforms.
 * Combining resolution and loading guarantees that aliases, symlinks, circular imports, and
 * generated dynamic-import candidates all receive the same editor text and resource policy.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { getPreviewSourceLanguage } from '../../domain/previewTarget';
import { canonicalizeExistingPath, normalizeLexicalPath } from '../../shared/pathIdentity';
import {
  isFileBackedPreviewNamespace,
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_SNAPSHOT_NAMESPACE,
} from './previewPluginProtocol';
import {
  PreviewSourceTransformError,
  type PreviewSourceTransformer,
} from './staticResources/previewSourceTransformer';

const PROJECT_SOURCE_FILTER = /\.[cCmM]?[jJtT][sS][xX]?$/;

/** Immutable editor state and transformation policy supplied to one compilation request. */
export interface WorkspaceSourcePluginOptions {
  /** Active document followed by any dirty dependency candidates. */
  readonly snapshots: readonly PreviewSourceSnapshot[];
  /** Per-build bounded transformer for framework resource syntax. */
  readonly transformer: PreviewSourceTransformer;
}

/**
 * Creates an esbuild plugin that resolves and loads all project-owned JavaScript/TypeScript source.
 *
 * @param options Dirty snapshots and the compilation-scoped static resource transformer.
 * @returns Stateless resolver with immutable snapshot maps and explicit project-source loading.
 */
export function createWorkspaceSourcePlugin(options: WorkspaceSourcePluginOptions): Plugin {
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

  return {
    name: 'react-preview-workspace-source',
    setup(build): void {
      /**
       * Delegates normal resolution, then maps a reached dirty document to its private namespace.
       *
       * @param arguments_ Module-resolution request emitted by esbuild.
       * @returns Normal resolution result or a snapshot identity for current editor text.
       */
      async function resolveWorkspaceSource(
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

      /**
       * Loads project source from the editor or disk and exposes explicit imports after transformation.
       *
       * @param arguments_ File or snapshot load request emitted by esbuild.
       * @returns Transformed source, watch metadata, or `undefined` for dependency packages.
       */
      async function loadWorkspaceSource(
        arguments_: OnLoadArgs,
      ): Promise<OnLoadResult | undefined> {
        const snapshot =
          snapshotByLexicalPath.get(normalizeLexicalPath(arguments_.path)) ??
          snapshotByCanonicalPath.get(canonicalizeExistingPath(arguments_.path));
        const language = snapshot?.language ?? getPreviewSourceLanguage(arguments_.path);
        if (language === undefined) {
          return undefined;
        }

        try {
          const sourceText = snapshot?.sourceText ?? (await readFile(arguments_.path, 'utf8'));
          const canonicalSourcePath = canonicalizeExistingPath(arguments_.path);
          const transformed = await options.transformer.transform(canonicalSourcePath, sourceText);
          return {
            contents: transformed.contents,
            loader: language,
            resolveDir: path.dirname(canonicalSourcePath),
            watchDirs: [...transformed.watchDirectories],
            watchFiles: [arguments_.path],
          };
        } catch (error) {
          const transformMessage =
            error instanceof PreviewSourceTransformError ? error.message : String(error);
          return {
            errors: [
              {
                detail: error,
                text: `Could not prepare preview source: ${transformMessage}`,
              },
            ],
          };
        }
      }

      build.onResolve({ filter: /.*/ }, resolveWorkspaceSource);
      build.onLoad(
        { filter: PROJECT_SOURCE_FILTER, namespace: PREVIEW_SNAPSHOT_NAMESPACE },
        loadWorkspaceSource,
      );
      build.onLoad({ filter: PROJECT_SOURCE_FILTER, namespace: 'file' }, loadWorkspaceSource);
    },
  };
}
