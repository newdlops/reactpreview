/**
 * Resolves project modules, overlays dirty editor snapshots, and applies bounded source transforms.
 * Combining resolution and loading guarantees that aliases, symlinks, circular imports, and
 * generated dynamic-import candidates all receive the same editor text and resource policy.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, Plugin } from 'esbuild';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { getPreviewSourceLanguage } from '../../domain/previewTarget';
import { canonicalizeExistingPath, normalizeLexicalPath } from '../../shared/pathIdentity';
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
  /** Trusted workspace whose application sources may receive preview-only transformations. */
  readonly workspaceRoot: string;
}

/**
 * Creates an esbuild plugin that resolves and loads all project-owned JavaScript/TypeScript source.
 *
 * @param options Dirty snapshots and the compilation-scoped static resource transformer.
 * @returns Stateless resolver with immutable snapshot maps and explicit project-source loading.
 */
export function createWorkspaceSourcePlugin(options: WorkspaceSourcePluginOptions): Plugin {
  const lexicalWorkspaceRoot = normalizeLexicalPath(options.workspaceRoot);
  const canonicalWorkspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
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
       * Loads project source from the editor or disk and exposes explicit imports after transformation.
       *
       * @param arguments_ File or snapshot load request emitted by esbuild.
       * @returns Transformed source, watch metadata, or `undefined` for dependency packages.
       */
      async function loadWorkspaceSource(
        arguments_: OnLoadArgs,
      ): Promise<OnLoadResult | undefined> {
        const lexicalSourcePath = normalizeLexicalPath(arguments_.path);
        let snapshot = snapshotByLexicalPath.get(lexicalSourcePath);
        if (
          snapshot === undefined &&
          !isTransformableWorkspaceSource(lexicalWorkspaceRoot, lexicalSourcePath)
        ) {
          return undefined;
        }
        const canonicalSourcePath = canonicalizeExistingPath(arguments_.path);
        snapshot ??= snapshotByCanonicalPath.get(canonicalSourcePath);
        if (
          snapshot === undefined &&
          !isTransformableWorkspaceSource(canonicalWorkspaceRoot, canonicalSourcePath)
        ) {
          return undefined;
        }
        const language = snapshot?.language ?? getPreviewSourceLanguage(arguments_.path);
        if (language === undefined) {
          return undefined;
        }

        try {
          const sourceText = snapshot?.sourceText ?? (await readFile(arguments_.path, 'utf8'));
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

      build.onLoad({ filter: PROJECT_SOURCE_FILTER, namespace: 'file' }, loadWorkspaceSource);
    },
  };
}

/**
 * Keeps expensive AST compatibility transforms on application source instead of dependency code.
 * Esbuild already parses package JavaScript efficiently; walking every file below `node_modules`
 * through several TypeScript syntax analyzers dominated large-repository preview latency.
 */
function isTransformableWorkspaceSource(workspaceRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, sourcePath);
  if (relativePath.length === 0 || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return relativePath.length === 0;
  }
  return !relativePath.split(path.sep).includes('node_modules');
}
