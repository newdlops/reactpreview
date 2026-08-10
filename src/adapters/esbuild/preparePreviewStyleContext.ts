/**
 * Coordinates host-side style evidence needed before the browser loads a lazy authored page root.
 * The adapter shares current editor snapshots with exact theme and HTML-shell discovery, keeping
 * the main compiler focused on build orchestration and all style policy behind one module boundary.
 */
import path from 'node:path';
import type { PreviewBuildRequest, PreviewSourceSnapshot } from '../../domain/preview';
import { getPreviewSourceLanguage } from '../../domain/previewTarget';
import type { PreviewPreparationPolicy } from './previewPreparationPolicy';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  selectPreviewApplicationStylesheetImports,
  type PreviewApplicationStylesheetImportSelection,
} from './previewApplicationStylesheetSelection';
import {
  discoverPreviewDocumentShell,
  type PreviewDocumentShellEvidence,
} from './previewDocumentShell';
import { discoverPreviewPortalHostIds } from './previewPortalHostDiscovery';
import { selectPreviewGraphThemeImport } from './previewGraphThemeSelection';
import {
  selectPreviewGlobalStyleImports,
  type PreviewApplicationStyleRoot,
  type PreviewGlobalStyleImportSelection,
} from './previewGlobalStyleSelection';
import type { ReadPreviewProjectSourceOptions } from './previewProjectFileAnalysisCache';
import type { PreviewRenderChainCandidate } from './renderGraph/previewRenderGraphTypes';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import { discoverPreviewStyledComponentsAvailability } from './previewStyledComponentsAvailability';
import {
  selectPreviewStyleSheetManagerPlan,
  type PreviewMountedRootReference,
} from './previewStyleSheetManagerSelection';
import type { PreviewStyledComponentsPlan } from './previewStyledComponentsPlan';
import { collectPreviewTailwindCandidateSnapshotGraph } from './previewTailwindCandidateSnapshotGraph';
import type { PreviewThemeImportSelection } from './previewTargetExports';

/** Final exact execution closure can safely fill the complete Tailwind scanner envelope. */
const MAX_FINAL_TAILWIND_CANDIDATE_FILES = 192;
const MAX_FINAL_TAILWIND_CANDIDATE_BYTES = 4 * 1024 * 1024;
const MAX_FINAL_TAILWIND_SOURCE_BYTES = 1024 * 1024;
const TAILWIND_SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const TAILWIND_DECLARATION_PATTERN = /\.d\.[cm]?tsx?$/iu;

/** Current-source reader owned by the compiler-lifetime project analysis cache. */
export type ReadPreviewStyleContextSource = (
  options: ReadPreviewProjectSourceOptions,
) => Promise<string | undefined>;

/** Immutable inputs for one target revision's pre-render style preparation. */
export interface PreparePreviewStyleContextOptions {
  readonly applicationStyleRoots?: readonly PreviewApplicationStyleRoot[];
  readonly directThemeImport?: PreviewThemeImportSelection;
  readonly inspectorDependencyPaths: readonly string[];
  /** Exact Inspector root; absent for component gallery where a synthetic boundary is used. */
  readonly mountedRoot?: PreviewMountedRootReference;
  /** Reached source graph inspected for exact ReactDOM portal host requirements. */
  readonly portalHostDependencyPaths: readonly string[];
  readonly projectRoot: string;
  readonly styleEvidence?: PreviewPreparationPolicy['styleEvidence'];
  readonly readSource: ReadPreviewStyleContextSource;
  readonly renderPath?: PreviewRenderChainCandidate;
  readonly request: PreviewBuildRequest;
  readonly staticModuleResolver: PreviewStaticModuleResolver;
  readonly workspaceRoot: string;
}

/** Style evidence plus the snapshot map reused by later runtime-global and GraphQL analysis. */
export interface PreparedPreviewStyleContext {
  /** Conventional app-root CSS loaded only when no authentic page/layout root can own styles. */
  readonly applicationStylesheetImports: readonly PreviewApplicationStylesheetImportSelection[];
  readonly documentShellEvidence?: PreviewDocumentShellEvidence;
  readonly globalStyleImports: readonly PreviewGlobalStyleImportSelection[];
  readonly portalHostIds: readonly string[];
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
  /** Immutable styled-components boundary plan shared by entry generation and the compiler. */
  readonly styledComponentsPlan: PreviewStyledComponentsPlan;
  /** Bounded page-corridor source text supplied to Tailwind without a filesystem scan. */
  readonly tailwindCandidateSnapshots: readonly PreviewSourceSnapshot[];
  readonly themeImport?: PreviewThemeImportSelection;
}

/**
 * Resolves the exact corridor theme and static document shell concurrently.
 * Dirty target/dependency snapshots take precedence over disk while the shared reader enforces the
 * same byte ceilings and file identity cache as the rest of project analysis.
 *
 * @param options Build request, static graph evidence, resolver, and cached source boundary.
 * @returns Reusable snapshot map and optional exact style context.
 */
export async function preparePreviewStyleContext(
  options: PreparePreviewStyleContextOptions,
): Promise<PreparedPreviewStyleContext> {
  const snapshotSourceByPath = createPreviewSnapshotSourceMap(options.request);
  const readProjectSource: ReadPreviewStyleContextSource = (readOptions) => {
    const snapshotText = snapshotSourceByPath.get(path.normalize(readOptions.sourcePath));
    return options.readSource({
      ...readOptions,
      ...(snapshotText === undefined ? {} : { snapshotText }),
    });
  };
  const readSource = (sourcePath: string, maximumBytes: number): Promise<string | undefined> =>
    readProjectSource({ maximumBytes, sourcePath });
  const availabilityPromise = discoverPreviewStyledComponentsAvailability({
    importerPath: options.mountedRoot?.sourcePath ?? options.request.documentPath,
    resolveModule: options.staticModuleResolver.resolve,
  });
  const applicationStyleRoots = [
    ...(options.applicationStyleRoots ?? []),
    ...createConventionalNextPagesStyleRoots(options.projectRoot),
  ];
  const [
    themeImport,
    documentShellEvidence,
    globalStyleImports,
    applicationStylesheetImports,
    availability,
  ] = await Promise.all([
    options.directThemeImport ??
      (options.inspectorDependencyPaths.length === 0
        ? undefined
        : selectPreviewGraphThemeImport({
            dependencyPaths: options.inspectorDependencyPaths,
            readSource,
            ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
            resolveModule: options.staticModuleResolver.resolve,
          })),
    discoverPreviewDocumentShell({
      projectRoot: options.projectRoot,
      readSource,
      workspaceRoot: options.workspaceRoot,
    }),
    selectPreviewGlobalStyleImports({
      applicationRoots: applicationStyleRoots,
      readSource: readProjectSource,
      ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
      resolveModule: options.staticModuleResolver.resolve,
    }),
    selectPreviewApplicationStylesheetImports({
      projectRoot: options.projectRoot,
      readSource: readProjectSource,
      ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
    }),
    availabilityPromise,
  ]);
  const styledComponentsPlan = await selectPreviewStyleSheetManagerPlan({
    availability,
    ...(options.mountedRoot === undefined ? {} : { mountedRoot: options.mountedRoot }),
    readSource,
    ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
    resolveModule: options.staticModuleResolver.resolve,
  });
  const criticalStyleEvidence =
    (options.styleEvidence ??
      (options.request.preparationMode === 'fast' ? 'critical' : 'workspace-complete')) ===
    'critical';
  // Critical first paint still needs class candidates from the exact visible page/layout corridor.
  // It uses a smaller target-first graph; only portal discovery and the broader candidate budget
  // remain deferred until full enrichment.
  const [portalHostIds, tailwindCandidateSnapshots] = await Promise.all([
    criticalStyleEvidence
      ? Promise.resolve<readonly string[]>(Object.freeze([]))
      : discoverPreviewPortalHostIds({
          dependencyPaths: [
            options.request.documentPath,
            ...options.inspectorDependencyPaths,
            ...options.portalHostDependencyPaths,
          ],
          readSource,
        }),
    collectPreviewTailwindCandidateSnapshotGraph({
      corridorPaths: options.inspectorDependencyPaths,
      readSource: readProjectSource,
      resolveModule: options.staticModuleResolver.resolve,
      scope: criticalStyleEvidence ? 'critical' : 'complete',
      targetPath: options.request.documentPath,
      workspaceRoot: options.workspaceRoot,
    }),
  ]);
  return {
    applicationStylesheetImports,
    ...(documentShellEvidence === undefined ? {} : { documentShellEvidence }),
    globalStyleImports,
    portalHostIds,
    snapshotSourceByPath,
    styledComponentsPlan,
    tailwindCandidateSnapshots,
    ...(themeImport === undefined ? {} : { themeImport }),
  };
}

/**
 * Adds exact authored modules admitted only after the Page Execution frontier is frozen.
 *
 * Generated lazy registries cannot safely be expanded while the initial style corridor is built:
 * doing so scans every route branch. The final frontier has already selected one bounded branch,
 * so its authentic sources can now contribute responsive utility candidates without ambiguity.
 */
export async function completePreviewStyleContextTailwindCandidates(options: {
  readonly context: PreparedPreviewStyleContext;
  readonly readSource: ReadPreviewStyleContextSource;
  readonly sourcePaths: readonly string[];
}): Promise<PreparedPreviewStyleContext> {
  const snapshots = [...options.context.tailwindCandidateSnapshots];
  const existingPaths = new Set(
    snapshots.map((snapshot) => canonicalizeExistingPath(snapshot.documentPath)),
  );
  let totalBytes = snapshots.reduce(
    (sum, snapshot) => sum + Buffer.byteLength(snapshot.sourceText, 'utf8'),
    0,
  );
  for (const sourcePath of options.sourcePaths) {
    if (
      snapshots.length >= MAX_FINAL_TAILWIND_CANDIDATE_FILES ||
      totalBytes >= MAX_FINAL_TAILWIND_CANDIDATE_BYTES
    ) {
      break;
    }
    const canonicalPath = canonicalizeExistingPath(sourcePath);
    if (
      existingPaths.has(canonicalPath) ||
      !TAILWIND_SOURCE_PATTERN.test(canonicalPath) ||
      TAILWIND_DECLARATION_PATTERN.test(canonicalPath)
    ) {
      continue;
    }
    const remainingBytes = MAX_FINAL_TAILWIND_CANDIDATE_BYTES - totalBytes;
    const sourceText = await options.readSource({
      maximumBytes: Math.min(MAX_FINAL_TAILWIND_SOURCE_BYTES, remainingBytes),
      sourcePath: canonicalPath,
    });
    if (sourceText === undefined) continue;
    const language = getPreviewSourceLanguage(canonicalPath);
    if (language === undefined) continue;
    const sourceBytes = Buffer.byteLength(sourceText, 'utf8');
    if (sourceBytes > remainingBytes) continue;
    existingPaths.add(canonicalPath);
    totalBytes += sourceBytes;
    snapshots.push(
      Object.freeze({
        documentPath: canonicalPath,
        language,
        sourceText,
      }),
    );
  }
  if (snapshots.length === options.context.tailwindCandidateSnapshots.length) {
    return options.context;
  }
  return {
    ...options.context,
    tailwindCandidateSnapshots: Object.freeze(snapshots),
  };
}

/** Supplies strict Next Pages application-shell candidates without scanning the filesystem. */
function createConventionalNextPagesStyleRoots(
  projectRoot: string,
): readonly PreviewApplicationStyleRoot[] {
  return Object.freeze(
    ['pages', path.join('src', 'pages')].flatMap((pagesDirectory) =>
      ['tsx', 'jsx', 'ts', 'js'].map((extension) =>
        Object.freeze({
          exportName: 'default',
          sourcePath: path.join(projectRoot, pagesDirectory, `_app.${extension}`),
        }),
      ),
    ),
  );
}

/** Overlays unsaved source text on both authored and canonical filesystem identities. */
function createPreviewSnapshotSourceMap(request: PreviewBuildRequest): ReadonlyMap<string, string> {
  const sourceByPath = new Map<string, string>();
  for (const snapshot of [
    { documentPath: request.documentPath, sourceText: request.sourceText },
    ...request.dependencySnapshots,
  ]) {
    sourceByPath.set(path.normalize(snapshot.documentPath), snapshot.sourceText);
    sourceByPath.set(
      path.normalize(canonicalizeExistingPath(snapshot.documentPath)),
      snapshot.sourceText,
    );
  }
  return sourceByPath;
}
