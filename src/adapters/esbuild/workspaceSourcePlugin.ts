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

/** Editor snapshots and transformation policy that may advance between incremental rebuilds. */
export interface WorkspaceSourceCompilationState {
  /** Active document followed by any dirty dependency candidates. */
  readonly snapshots: readonly PreviewSourceSnapshot[];
  /** Per-build bounded transformer for framework resource syntax. */
  readonly transformer: PreviewSourceTransformer;
}

/** Immutable workspace boundary plus either fixed or incrementally replaceable compilation state. */
export type WorkspaceSourcePluginOptions = {
  /** Trusted workspace whose application sources may receive preview-only transformations. */
  readonly workspaceRoot: string;
} & (
  | {
      /** Mutable state retained by one persistent esbuild context. */
      readonly incrementalState: MutableWorkspaceSourceState;
    }
  | WorkspaceSourceCompilationState
);

/**
 * Holds only the current editor overlays and transformer for one serialized esbuild context.
 * Persistent contexts retain this object while each rebuild atomically replaces its lookup maps;
 * no source text is shared across different context keys or concurrent rebuild operations.
 */
export class MutableWorkspaceSourceState {
  private snapshotByCanonicalPath = new Map<string, PreviewSourceSnapshot>();
  private snapshotByLexicalPath = new Map<string, PreviewSourceSnapshot>();
  private currentTransformer: PreviewSourceTransformer;

  /** Creates state initialized for the first context rebuild. */
  public constructor(compilation: WorkspaceSourceCompilationState) {
    this.currentTransformer = compilation.transformer;
    this.update(compilation);
  }

  /** Transformer associated with the currently serialized rebuild. */
  public get transformer(): PreviewSourceTransformer {
    return this.currentTransformer;
  }

  /**
   * Replaces every dirty snapshot and the transformer before `BuildContext.rebuild()` starts.
   * Maps are rebuilt off to the side and swapped together so an aborted previous rebuild cannot
   * observe a partially updated editor overlay inventory.
   */
  public update(compilation: WorkspaceSourceCompilationState): void {
    const nextCanonical = new Map<string, PreviewSourceSnapshot>();
    const nextLexical = new Map<string, PreviewSourceSnapshot>();
    for (const snapshot of compilation.snapshots) {
      const canonicalPath = canonicalizeExistingPath(snapshot.documentPath);
      const lexicalPath = normalizeLexicalPath(snapshot.documentPath);
      if (!nextCanonical.has(canonicalPath)) {
        nextCanonical.set(canonicalPath, snapshot);
      }
      nextLexical.set(lexicalPath, snapshot);
    }
    this.snapshotByCanonicalPath = nextCanonical;
    this.snapshotByLexicalPath = nextLexical;
    this.currentTransformer = compilation.transformer;
  }

  /** Returns the latest lexical editor overlay without following filesystem symlinks. */
  public readLexicalSnapshot(sourcePath: string): PreviewSourceSnapshot | undefined {
    return this.snapshotByLexicalPath.get(sourcePath);
  }

  /** Returns the latest canonical editor overlay after project resolution follows symlinks. */
  public readCanonicalSnapshot(sourcePath: string): PreviewSourceSnapshot | undefined {
    return this.snapshotByCanonicalPath.get(sourcePath);
  }
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
  const sourceState =
    'incrementalState' in options
      ? options.incrementalState
      : new MutableWorkspaceSourceState(options);

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
        let snapshot = sourceState.readLexicalSnapshot(lexicalSourcePath);
        if (
          snapshot === undefined &&
          !isTransformableWorkspaceSource(lexicalWorkspaceRoot, lexicalSourcePath)
        ) {
          return undefined;
        }
        const canonicalSourcePath = canonicalizeExistingPath(arguments_.path);
        snapshot ??= sourceState.readCanonicalSnapshot(canonicalSourcePath);
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
          const transformed = await sourceState.transformer.transform(
            canonicalSourcePath,
            sourceText,
          );
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
