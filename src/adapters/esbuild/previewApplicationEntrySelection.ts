/**
 * Finds the single-page-application entry whose side-effect stylesheets style every page.
 *
 * Vite and CRA applications import global CSS (Tailwind layers, CSS variables, fonts) in the entry
 * module that calls `createRoot(...).render(<App />)`. Page Inspector mounts the page root without
 * executing that entry, so its stylesheets were never loaded and Tailwind pages rendered unstyled.
 * This module reads candidate entries as inert text: the `index.html` module script first, then
 * conventional `src/main.*` and `src/index.*` files. A candidate is accepted only when a bounded
 * runtime-import corridor reaches the selected page root; unrelated applications are ignored.
 */
import path from 'node:path';
import type { ReadPreviewProjectSourceOptions } from './previewProjectFileAnalysisCache';
import {
  createPreviewApplicationEntryCorridor,
  type PreviewApplicationStyleOwner,
} from './previewApplicationEntryCorridor';

const MAXIMUM_ENTRY_BYTES = 1024 * 1024;
const HTML_DOCUMENTS = ['index.html', 'public/index.html', 'src/index.html'] as const;
const CONVENTIONAL_ENTRY_STEMS = ['src/main', 'src/index', 'main', 'index'] as const;
const ENTRY_EXTENSIONS = ['tsx', 'jsx', 'ts', 'js', 'mts', 'mjs'] as const;
const MODULE_SCRIPT_PATTERN =
  /<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*\bsrc\s*=\s*["']([^"'?#]+)[^"']*["'][^>]*>/giu;

/** Inputs for one bounded entry lookup. */
export interface SelectPreviewApplicationEntryOptions {
  /** Nearest package boundary containing the selected preview target. */
  readonly projectRoot: string;
  /** Cached byte-bounded source reader shared with the rest of preview preparation. */
  readonly readSource: (options: ReadPreviewProjectSourceOptions) => Promise<string | undefined>;
  /** Project-aware resolver used to prove that the entry imports the page root. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Absolute page-root modules of the selected render path. */
  readonly rootSourcePaths: readonly string[];
}

/** Entry source accepted for inert stylesheet collection. */
export interface PreviewApplicationEntry {
  readonly sourcePath: string;
  readonly sourceText: string;
  /** Runtime-import owners connecting this entry to one already-proven page root. */
  readonly styleOwners: readonly PreviewApplicationStyleOwner[];
}

/**
 * Returns the first candidate entry with a proven runtime-import path to a page-root module.
 *
 * @param options Project root, cached reader, resolver, and page-root modules.
 * @returns Accepted entry, or `undefined` when no candidate proves it owns the page root.
 */
export async function selectPreviewApplicationEntry(
  options: SelectPreviewApplicationEntryOptions,
): Promise<PreviewApplicationEntry | undefined> {
  const roots = new Set(options.rootSourcePaths.map((rootPath) => path.normalize(rootPath)));
  if (roots.size === 0) return undefined;
  const candidates = [
    ...(await readHtmlModuleScripts(options)),
    ...CONVENTIONAL_ENTRY_STEMS.flatMap((stem) =>
      ENTRY_EXTENSIONS.map((extension) => path.join(options.projectRoot, `${stem}.${extension}`)),
    ),
  ];
  const seen = new Set<string>();
  const proveCorridor = createPreviewApplicationEntryCorridor(options);
  for (const candidate of candidates) {
    const sourcePath = path.normalize(candidate);
    if (seen.has(sourcePath) || roots.has(sourcePath)) continue;
    seen.add(sourcePath);
    const sourceText = await options.readSource({ maximumBytes: MAXIMUM_ENTRY_BYTES, sourcePath });
    if (sourceText === undefined) continue;
    const styleOwners = await proveCorridor(sourcePath, sourceText);
    if (styleOwners !== undefined) return { sourcePath, sourceText, styleOwners };
  }
  return undefined;
}

/** Reads `<script type="module" src>` paths from the authored HTML documents of the project. */
async function readHtmlModuleScripts(
  options: SelectPreviewApplicationEntryOptions,
): Promise<readonly string[]> {
  const scripts: string[] = [];
  for (const document of HTML_DOCUMENTS) {
    const documentPath = path.join(options.projectRoot, document);
    const html = await options.readSource({
      maximumBytes: MAXIMUM_ENTRY_BYTES,
      sourcePath: documentPath,
    });
    if (html === undefined) continue;
    for (const match of html.matchAll(MODULE_SCRIPT_PATTERN)) {
      const source = match[1]?.trim();
      if (source === undefined || /^[a-z][a-z0-9+.-]*:/iu.test(source)) continue;
      // Vite serves `/src/main.tsx` from the project root; relative sources follow the document.
      scripts.push(
        source.startsWith('/')
          ? path.join(options.projectRoot, source)
          : path.join(path.dirname(documentPath), source),
      );
    }
  }
  return scripts;
}
