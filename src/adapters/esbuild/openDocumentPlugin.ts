/**
 * Supplies the active editor's text when esbuild loads that exact module path.
 * This one-file overlay is the key boundary that makes unsaved current-file edits previewable
 * while all imported dependencies continue to use normal filesystem and package resolution.
 */
import path from 'node:path';
import type {
  Loader,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
} from 'esbuild';
import { canonicalizeExistingPath, normalizeLexicalPath } from '../../shared/pathIdentity';

/** Namespace that prevents esbuild from canonicalizing the active editor's symlink before loading. */
export const OPEN_DOCUMENT_NAMESPACE = 'react-preview-open-document';

const RESOLVE_GUARD = Symbol('react-preview-resolve-guard');

/** Immutable settings required by the open-document source overlay. */
export interface OpenDocumentPluginOptions {
  /** Absolute source file path represented by the editor snapshot. */
  readonly documentPath: string;
  /** esbuild source loader matching the document extension. */
  readonly loader: Loader;
  /** Complete current editor contents, including unsaved changes. */
  readonly sourceText: string;
}

/**
 * Creates an esbuild plugin that replaces only the active document with its in-memory snapshot.
 *
 * @param options Current editor path, text, and loader.
 * @returns Stateless esbuild plugin scoped to one compilation request.
 */
export function createOpenDocumentPlugin(options: OpenDocumentPluginOptions): Plugin {
  const targetPath = normalizeLexicalPath(options.documentPath);
  const canonicalTargetPath = canonicalizeExistingPath(options.documentPath);
  const canonicalResolveDirectory = path.dirname(canonicalTargetPath);

  /**
   * Returns unsaved text for the active document captured by the custom namespace.
   *
   * @param arguments_ File-loading request emitted by esbuild.
   * @returns An in-memory load result for the active file, otherwise `undefined`.
   */
  function loadOpenDocument(arguments_: OnLoadArgs): OnLoadResult | undefined {
    if (normalizeLexicalPath(arguments_.path) !== targetPath) {
      return undefined;
    }

    return {
      contents: options.sourceText,
      loader: options.loader,
      resolveDir: canonicalResolveDirectory,
      watchFiles: [options.documentPath],
    };
  }

  return {
    name: 'react-preview-open-document',
    setup(build): void {
      /**
       * Delegates to esbuild's complete resolver, then unifies every alias of the active document.
       * This handles extensionless circular imports, tsconfig paths, and symlink real paths without
       * creating a second saved-file module alongside the unsaved editor module.
       *
       * @param arguments_ Module-resolution request emitted by esbuild.
       * @returns Resolved module result, with the active document moved into the private namespace.
       */
      async function resolveOpenDocument(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if ((arguments_.pluginData as unknown) === RESOLVE_GUARD) {
          return undefined;
        }

        const fromOpenDocument = arguments_.namespace === OPEN_DOCUMENT_NAMESPACE;
        const resolved = await build.resolve(arguments_.path, {
          importer: fromOpenDocument ? canonicalTargetPath : arguments_.importer,
          kind: arguments_.kind,
          namespace: fromOpenDocument ? 'file' : arguments_.namespace,
          pluginData: RESOLVE_GUARD,
          resolveDir: fromOpenDocument ? canonicalResolveDirectory : arguments_.resolveDir,
          with: arguments_.with,
        });

        if (resolved.errors.length > 0) {
          return { errors: resolved.errors, warnings: resolved.warnings };
        }

        if (!resolved.external && canonicalizeExistingPath(resolved.path) === canonicalTargetPath) {
          return {
            namespace: OPEN_DOCUMENT_NAMESPACE,
            path: options.documentPath,
            suffix: resolved.suffix,
            warnings: resolved.warnings,
          };
        }

        return {
          external: resolved.external,
          namespace: resolved.namespace,
          path: resolved.path,
          sideEffects: resolved.sideEffects,
          suffix: resolved.suffix,
          warnings: resolved.warnings,
        };
      }

      build.onResolve({ filter: /.*/ }, resolveOpenDocument);
      build.onLoad({ filter: /.*/, namespace: OPEN_DOCUMENT_NAMESPACE }, loadOpenDocument);
    },
  };
}
