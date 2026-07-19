/**
 * Selects one exact styled-components theme from the statically proven page corridor.
 * Page Inspector keeps authored roots behind dynamic imports, so runtime registration alone is
 * necessarily too late for the outer preview ThemeProvider. This host-only adapter reads inert
 * source text, canonicalizes alias/relative candidates, and emits one eager import selection.
 */
import type { PreviewStyleSignal } from './previewStyleInventory';
import { collectPreviewStyleSignals, selectPreviewGraphTheme } from './previewStyleInventory';
import type { PreviewThemeImportSelection } from './previewTargetExports';

const MAX_THEME_SOURCE_FILES = 512;
const MAX_THEME_SOURCE_BYTES = 2 * 1024 * 1024;
const SOURCE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Bounded source reader shared with the compiler's project-analysis cache. */
export type ReadPreviewGraphThemeSource = (
  sourcePath: string,
  maximumBytes: number,
) => Promise<string | undefined>;

/** Resolver used to collapse alias and relative spellings onto one real module identity. */
export type ResolvePreviewGraphThemeModule = (
  moduleSpecifier: string,
  importerPath: string,
) => string | undefined;

/** Inputs required for one target-scoped, side-effect-free theme selection. */
export interface SelectPreviewGraphThemeOptions {
  /** Files that statically prove the selected entry-to-target render corridor. */
  readonly dependencyPaths: readonly string[];
  /** Byte-bounded current-source reader; editor snapshots should take precedence. */
  readonly readSource: ReadPreviewGraphThemeSource;
  /** Project-aware resolver for tsconfig aliases and extensionless relative imports. */
  readonly resolveModule: ResolvePreviewGraphThemeModule;
}

/**
 * Finds a uniquely strongest theme without importing or evaluating project code in the host.
 * Candidate source files are bounded and scanned in small batches. Canonical module resolution is
 * important because `./theme` and a tsconfig alias often identify the same exported object.
 *
 * @param options Selected render corridor, cached reader, and static module resolver.
 * @returns Exact absolute theme import, or `undefined` when evidence remains absent or ambiguous.
 */
export async function selectPreviewGraphThemeImport(
  options: SelectPreviewGraphThemeOptions,
): Promise<PreviewThemeImportSelection | undefined> {
  const sourcePaths = [
    ...new Set(
      options.dependencyPaths.filter((sourcePath) => SOURCE_EXTENSION_PATTERN.test(sourcePath)),
    ),
  ].slice(0, MAX_THEME_SOURCE_FILES);
  const signals: PreviewStyleSignal[] = [];
  for (let offset = 0; offset < sourcePaths.length; offset += 32) {
    const batch = sourcePaths.slice(offset, offset + 32);
    const sources = await Promise.all(
      batch.map(async (sourcePath) => ({
        sourcePath,
        sourceText: await options.readSource(sourcePath, MAX_THEME_SOURCE_BYTES),
      })),
    );
    for (const source of sources) {
      if (
        source.sourceText === undefined ||
        !source.sourceText.includes('styled-components') ||
        !source.sourceText.includes('theme')
      ) {
        continue;
      }
      for (const signal of collectPreviewStyleSignals(source.sourcePath, source.sourceText)) {
        signals.push(canonicalizeThemeSignal(signal, options.resolveModule));
      }
    }
  }
  return selectPreviewGraphTheme(signals);
}

/** Resolves equivalent authored requests to one stable absolute candidate key and import path. */
function canonicalizeThemeSignal(
  signal: PreviewStyleSignal,
  resolveModule: ResolvePreviewGraphThemeModule,
): PreviewStyleSignal {
  const resolvedPath = resolveModule(signal.moduleSpecifier, signal.importerPath);
  return resolvedPath === undefined ? signal : { ...signal, moduleSpecifier: resolvedPath };
}
