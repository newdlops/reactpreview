/**
 * Restores JavaScript/CSS loading boundaries that esbuild's aggregate entry stylesheet flattens.
 * Every dynamically imported browser module receives only the CSS reachable without crossing its
 * next dynamic-import edge, so unopened routes, editors, and overlays cannot mutate the preview.
 */
import { createHash } from 'node:crypto';
import type { Metafile } from 'esbuild';

/** Global symbol shared by the generated entry bootstrap and every auxiliary ESM module. */
export const PREVIEW_LAZY_STYLE_LOADER_SYMBOL = 'newdlops.react-preview.lazy-styles.v1';
const JAVASCRIPT_OUTPUT_PATTERN = /\.[cm]?js$/iu;
const STYLESHEET_OUTPUT_PATTERN = /\.css$/iu;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One completely joined esbuild output supplied by the outer path-safety planner. */
export interface PreviewJoinedBuildOutput {
  /** Immutable output bytes returned by esbuild. */
  readonly contents: Uint8Array;
  /** Metadata associated with the exact output file. */
  readonly metadata: Metafile['outputs'][string];
  /** Original working-directory-relative key used by metafile output imports. */
  readonly metadataPath: string;
  /** Validated path below the preview artifact root. */
  readonly relativePath: string;
}

/** One generated, content-addressed stylesheet loaded with its owning JavaScript boundary. */
export interface PreviewLazyStylesheetOutput {
  /** CSS containing only the statically reachable sections for its owning module. */
  readonly contents: Uint8Array;
  /** Portable content-addressed path below the shared chunk directory. */
  readonly relativePath: string;
}

/** Post-processing needed to publish and activate route-local preview styles. */
export interface PreviewLazyStyleOutputPlan {
  /** Bootstrap prepended to the content-addressed entry before any dynamic import can run. */
  readonly entryPrefix: Uint8Array;
  /** CSS reachable synchronously from the generated entry, excluding every lazy descendant. */
  readonly entryStylesheet?: Uint8Array;
  /** Stable prefix prepended to every split JavaScript output across all revisions. */
  readonly modulePrefix: Uint8Array;
  /** Deduplicated generated stylesheets referenced by the entry bootstrap. */
  readonly stylesheets: readonly PreviewLazyStylesheetOutput[];
}

/** One module-to-stylesheet relationship serialized into the generated entry bootstrap. */
interface LazyStyleAssociation {
  /** Validated JavaScript artifact path received later as `import.meta.url`. */
  readonly modulePath: string;
  /** Generated exclusive CSS artifact path loaded before the module import resolves. */
  readonly stylesheetPath: string;
}

/** Located esbuild CSS section beginning at its generated source-identity comment. */
interface LocatedCssSection {
  /** Source input identity shared with `metafile.outputs[css].inputs`. */
  readonly inputPath: string;
  /** UTF-16 string offset of the generated source comment. */
  readonly start: number;
}

/**
 * Plans exclusive lazy CSS plus deterministic JavaScript prefixes for a split browser build.
 *
 * esbuild intentionally makes an entry CSS bundle contain styles from nested dynamic imports. Its
 * output metadata still records which CSS source belongs to each static JavaScript chunk, however.
 * Following only non-dynamic output edges recovers the same boundary a production runtime observes.
 *
 * @param entryMetadataPath Exact metadata key of the generated root JavaScript output.
 * @param outputs Fully joined and path-validated build outputs.
 * @returns Bootstrap bytes, stable module prefix, and content-addressed exclusive CSS files.
 */
export function planPreviewLazyStyleOutputs(
  entryMetadataPath: string,
  outputs: readonly PreviewJoinedBuildOutput[],
  inputMetadata: Metafile['inputs'],
): PreviewLazyStyleOutputPlan | undefined {
  const outputByMetadataPath = new Map(outputs.map((output) => [output.metadataPath, output]));
  const auxiliaryJavaScript = outputs.filter(
    (output) =>
      output.metadataPath !== entryMetadataPath &&
      JAVASCRIPT_OUTPUT_PATTERN.test(output.relativePath),
  );
  if (auxiliaryJavaScript.length === 0) return undefined;

  const stylesheetByPath = new Map<string, PreviewLazyStylesheetOutput>();
  const associations: LazyStyleAssociation[] = [];
  for (const moduleOutput of auxiliaryJavaScript) {
    const exclusiveCss = selectExclusiveStylesheet(
      moduleOutput,
      outputByMetadataPath,
      inputMetadata,
    );
    if (exclusiveCss === undefined || exclusiveCss.byteLength === 0) continue;

    const stylesheetPath = createLazyStylesheetPath(exclusiveCss);
    stylesheetByPath.set(stylesheetPath, { contents: exclusiveCss, relativePath: stylesheetPath });
    associations.push({ modulePath: moduleOutput.relativePath, stylesheetPath });
  }

  associations.sort((left, right) => comparePaths(left.modulePath, right.modulePath));
  const entryOutput = outputByMetadataPath.get(entryMetadataPath);
  const entryStylesheet =
    entryOutput === undefined
      ? undefined
      : selectExclusiveStylesheet(entryOutput, outputByMetadataPath, inputMetadata);
  const basePlan = {
    entryPrefix: encoder.encode(createLazyStyleEntryBootstrap(associations)),
    modulePrefix: encoder.encode(
      `await globalThis[Symbol.for(${JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL)})]?.(import.meta.url);\n`,
    ),
    stylesheets: [...stylesheetByPath.values()].sort((left, right) =>
      comparePaths(left.relativePath, right.relativePath),
    ),
  };
  return entryStylesheet === undefined ? basePlan : { ...basePlan, entryStylesheet };
}

/** Selects only the CSS synchronously owned by one JavaScript entry or dynamic-import boundary. */
function selectExclusiveStylesheet(
  moduleOutput: PreviewJoinedBuildOutput,
  outputByMetadataPath: ReadonlyMap<string, PreviewJoinedBuildOutput>,
  inputMetadata: Metafile['inputs'],
): Uint8Array | undefined {
  const aggregateStylesheetPath = moduleOutput.metadata.cssBundle;
  if (aggregateStylesheetPath === undefined) return undefined;
  const aggregateStylesheet = outputByMetadataPath.get(aggregateStylesheetPath);
  if (
    aggregateStylesheet === undefined ||
    !STYLESHEET_OUTPUT_PATTERN.test(aggregateStylesheet.relativePath)
  ) {
    return undefined;
  }
  const selectedInputs = collectStaticCssInputs(
    moduleOutput,
    aggregateStylesheet.metadata,
    outputByMetadataPath,
    inputMetadata,
  );
  return selectCssInputSections(aggregateStylesheet, selectedInputs);
}

/**
 * Finds CSS inputs reached through the owning output and its static shared chunks only.
 * Dynamic-import edges are intentionally stopped so nested pages, editors, and modals keep their
 * own stylesheet activation boundary.
 */
function collectStaticCssInputs(
  rootOutput: PreviewJoinedBuildOutput,
  aggregateStylesheetMetadata: Metafile['outputs'][string],
  outputByMetadataPath: ReadonlyMap<string, PreviewJoinedBuildOutput>,
  inputMetadata: Metafile['inputs'],
): ReadonlySet<string> {
  const aggregateInputs = new Set(Object.keys(aggregateStylesheetMetadata.inputs));
  const selectedInputs = new Set<string>();
  const pendingOutputs = [rootOutput];
  const visitedOutputs = new Set<string>();

  while (pendingOutputs.length > 0) {
    const output = pendingOutputs.pop();
    if (output === undefined || visitedOutputs.has(output.metadataPath)) continue;
    visitedOutputs.add(output.metadataPath);
    for (const inputPath of Object.keys(output.metadata.inputs)) {
      if (aggregateInputs.has(inputPath)) selectedInputs.add(inputPath);
    }
    for (const imported of output.metadata.imports) {
      if (imported.kind === 'dynamic-import') continue;
      const importedOutput = outputByMetadataPath.get(imported.path);
      if (
        importedOutput !== undefined &&
        JAVASCRIPT_OUTPUT_PATTERN.test(importedOutput.relativePath)
      ) {
        pendingOutputs.push(importedOutput);
      }
    }
  }
  expandImportedCssInputs(selectedInputs, aggregateInputs, inputMetadata);
  return selectedInputs;
}

/** Includes `@import` and other static CSS dependencies owned by an already selected source. */
function expandImportedCssInputs(
  selectedInputs: Set<string>,
  aggregateInputs: ReadonlySet<string>,
  inputMetadata: Metafile['inputs'],
): void {
  const pendingInputs = [...selectedInputs];
  const visitedInputs = new Set<string>();
  while (pendingInputs.length > 0) {
    const inputPath = pendingInputs.pop();
    if (inputPath === undefined || visitedInputs.has(inputPath)) continue;
    visitedInputs.add(inputPath);
    for (const imported of inputMetadata[inputPath]?.imports ?? []) {
      if (
        imported.kind !== 'dynamic-import' &&
        aggregateInputs.has(imported.path) &&
        !selectedInputs.has(imported.path)
      ) {
        selectedInputs.add(imported.path);
        pendingInputs.push(imported.path);
      }
    }
  }
}

/**
 * Extracts selected source sections from one non-minified esbuild CSS bundle in original order.
 * When a positive-byte section cannot be identified, the complete aggregate is retained as a
 * fail-soft fallback: imperfect isolation is preferable to silently removing authored styles.
 */
function selectCssInputSections(
  stylesheet: PreviewJoinedBuildOutput,
  selectedInputs: ReadonlySet<string>,
): Uint8Array | undefined {
  const positiveInputPaths = Object.entries(stylesheet.metadata.inputs)
    .filter(([, contribution]) => contribution.bytesInOutput > 0)
    .map(([inputPath]) => inputPath);
  const selectedPositiveInputs = positiveInputPaths.filter((inputPath) =>
    selectedInputs.has(inputPath),
  );
  if (selectedPositiveInputs.length === 0) return undefined;

  const css = decoder.decode(stylesheet.contents);
  const locatedSections = locateCssSections(css, positiveInputPaths);
  if (locatedSections === undefined) return stylesheet.contents;

  const selected = new Set(selectedPositiveInputs);
  const firstSectionStart = locatedSections[0]?.start ?? 0;
  const parts = firstSectionStart > 0 ? [css.slice(0, firstSectionStart)] : [];
  for (const [index, section] of locatedSections.entries()) {
    if (!selected.has(section.inputPath)) continue;
    const nextSection = locatedSections[index + 1];
    parts.push(css.slice(section.start, nextSection?.start ?? css.length));
  }
  return encoder.encode(parts.join(''));
}

/** Locates every positive-byte esbuild input section or reports an unsupported output shape. */
function locateCssSections(
  css: string,
  inputPaths: readonly string[],
): readonly LocatedCssSection[] | undefined {
  const sections: LocatedCssSection[] = [];
  for (const inputPath of inputPaths) {
    const marker = `/* ${inputPath} */`;
    const start = css.indexOf(marker);
    if (start < 0 || css.includes(marker, start + marker.length)) return undefined;
    sections.push({ inputPath, start });
  }
  sections.sort((left, right) => left.start - right.start);
  return sections;
}

/** Creates a portable full-digest path so changed CSS can never reuse a prior browser URL. */
function createLazyStylesheetPath(contents: Uint8Array): string {
  const digest = createHash('sha256').update(contents).digest('hex');
  return `chunks/styles/${digest}.css`;
}

/**
 * Creates the entry-local loader registry used by stable auxiliary module prefixes.
 * CSS failures remain console warnings so cosmetic problems cannot hide otherwise renderable DOM.
 */
function createLazyStyleEntryBootstrap(associations: readonly LazyStyleAssociation[]): string {
  const serializedAssociations = associations
    .map(
      ({ modulePath, stylesheetPath }) =>
        `[new URL(${JSON.stringify(`./${modulePath}`)}, import.meta.url).href, new URL(${JSON.stringify(`./${stylesheetPath}`)}, import.meta.url).href]`,
    )
    .join(',\n');
  return `
const __reactPreviewLazyStyleByModule = new Map([${serializedAssociations}]);
const __reactPreviewLazyStylePromises = new Map();
const __reactPreviewLazyStyleRevision = import.meta.url;
const __reactPreviewLazyStyleLoader = async (moduleUrl) => {
  const stylesheetUrl = __reactPreviewLazyStyleByModule.get(moduleUrl);
  if (stylesheetUrl === undefined) return;
  const existingPromise = __reactPreviewLazyStylePromises.get(stylesheetUrl);
  if (existingPromise !== undefined) return existingPromise;
  const existingLink = Array.from(document.querySelectorAll('link[data-react-preview-lazy-style]'))
    .find((candidate) => candidate.href === stylesheetUrl);
  if (existingLink !== undefined) {
    existingLink.dataset.reactPreviewLazyStyleRevision = __reactPreviewLazyStyleRevision;
    return;
  }
  const promise = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheetUrl;
    link.dataset.reactPreviewLazyStyle = 'true';
    link.dataset.reactPreviewLazyStyleRevision = __reactPreviewLazyStyleRevision;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => {
      globalThis.console?.warn?.('React Preview could not load a lazy project stylesheet.', stylesheetUrl);
      resolve();
    }, { once: true });
    document.head.append(link);
  });
  __reactPreviewLazyStylePromises.set(stylesheetUrl, promise);
  return promise;
};
__reactPreviewLazyStyleLoader.commit = () => {
  for (const link of document.querySelectorAll('link[data-react-preview-lazy-style]')) {
    if (link.dataset.reactPreviewLazyStyleRevision !== __reactPreviewLazyStyleRevision) link.remove();
  }
};
globalThis[Symbol.for(${JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL)})] = __reactPreviewLazyStyleLoader;
`;
}

/** Orders artifact paths without locale-sensitive platform behavior. */
function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
