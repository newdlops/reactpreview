/**
 * Coordinates host-side style evidence needed before the browser loads a lazy authored page root.
 * The adapter shares current editor snapshots with exact theme and HTML-shell discovery, keeping
 * the main compiler focused on build orchestration and all style policy behind one module boundary.
 */
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  discoverPreviewDocumentShell,
  type PreviewDocumentShellEvidence,
} from './previewDocumentShell';
import { selectPreviewGraphThemeImport } from './previewGraphThemeSelection';
import {
  selectPreviewGlobalStyleImports,
  type PreviewGlobalStyleImportSelection,
} from './previewGlobalStyleSelection';
import type { ReadPreviewProjectSourceOptions } from './previewProjectFileAnalysisCache';
import type { PreviewRenderChainCandidate } from './renderGraph/previewRenderGraphTypes';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import type { PreviewThemeImportSelection } from './previewTargetExports';

/** Current-source reader owned by the compiler-lifetime project analysis cache. */
export type ReadPreviewStyleContextSource = (
  options: ReadPreviewProjectSourceOptions,
) => Promise<string | undefined>;

/** Immutable inputs for one target revision's pre-render style preparation. */
export interface PreparePreviewStyleContextOptions {
  readonly directThemeImport?: PreviewThemeImportSelection;
  readonly inspectorDependencyPaths: readonly string[];
  readonly projectRoot: string;
  readonly readSource: ReadPreviewStyleContextSource;
  readonly renderPath?: PreviewRenderChainCandidate;
  readonly request: PreviewBuildRequest;
  readonly staticModuleResolver: PreviewStaticModuleResolver;
  readonly workspaceRoot: string;
}

/** Style evidence plus the snapshot map reused by later runtime-global and GraphQL analysis. */
export interface PreparedPreviewStyleContext {
  readonly documentShellEvidence?: PreviewDocumentShellEvidence;
  readonly globalStyleImports: readonly PreviewGlobalStyleImportSelection[];
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
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
  const [themeImport, documentShellEvidence, globalStyleImports] = await Promise.all([
    options.directThemeImport ??
      (options.inspectorDependencyPaths.length === 0
        ? undefined
        : selectPreviewGraphThemeImport({
            dependencyPaths: options.inspectorDependencyPaths,
            readSource,
            resolveModule: options.staticModuleResolver.resolve,
          })),
    discoverPreviewDocumentShell({
      projectRoot: options.projectRoot,
      readSource,
      workspaceRoot: options.workspaceRoot,
    }),
    selectPreviewGlobalStyleImports({
      readSource: readProjectSource,
      ...(options.renderPath === undefined ? {} : { renderPath: options.renderPath }),
      resolveModule: options.staticModuleResolver.resolve,
    }),
  ]);
  return {
    ...(documentShellEvidence === undefined ? {} : { documentShellEvidence }),
    globalStyleImports,
    snapshotSourceByPath,
    ...(themeImport === undefined ? {} : { themeImport }),
  };
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
