/** Static resource transformation contracts and aggregate expansion budgets. */
import { PREVIEW_IMPORT_META_GLOB_MAX_MATCH_REFERENCES } from './previewImportMetaGlobInventory';

export const MAX_BUILD_EXPANSIONS = 128;

export const MAX_BUILD_MATCH_REFERENCES = PREVIEW_IMPORT_META_GLOB_MAX_MATCH_REFERENCES;

export const MAX_BUILD_SCANNED_ENTRIES = 16_384;

export const MAX_BUILD_WATCH_DIRECTORIES = 128;

export const INSTALLED_DEPENDENCY_DIRECTORY_NAMES = new Set(['.pnpm', '.yarn', 'node_modules']);

/** Transformed module source and directories that can gain future matching files. */
export interface PreviewSourceTransformResult {
  /** JavaScript or TypeScript source containing only explicit bundle-visible imports. */
  readonly contents: string;
  /** Glob roots used to route newly created or saved files back to the preview session. */
  readonly watchDirectories: readonly string[];
}

/** Parsed Vite glob behavior accepted by the safe compatibility layer. */
export interface GlobOptions {
  /** Whether modules are imported synchronously at module evaluation time. */
  readonly eager: boolean;
  /** Namespace, default, or named export returned for each key. */
  readonly importName?: string;
  /** Optional asset query appended only to generated import specifiers. */
  readonly query?: string;
}

/** Static Webpack context parameters after non-evaluating parsing. */
export interface RequireContextOptions {
  /** Relative directory exposed as the context key root. */
  readonly directory: string;
  /** Regular expression applied to `./`-prefixed context keys. */
  readonly matcher: RegExp;
  /** Whether files below nested directories are considered. */
  readonly recursive: boolean;
}
