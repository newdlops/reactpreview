/**
 * Creates a bounded first-paint plan for one directly selected Next.js Pages Router page.
 *
 * Pages Router applications connect `pages/_app` to the active page through framework-owned
 * props, so no authored import edge exists for a generic reverse graph to discover. This module
 * owns that exact filesystem exception: it accepts only a default route below a trusted `pages`
 * directory, locates the nearest sibling `_app`, and refines dynamic route values through reached
 * static imports without enumerating the package. Next App Router and ordinary React ancestry
 * remain outside this boundary.
 */
import path from 'node:path';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  freezePreviewInspectorAncestorPlan,
  freezePreviewInspectorPageCandidate,
} from './previewInspectorAncestorFreezing';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorTypes';
import { refinePreviewInspectorNextPagesShell } from './previewInspectorNextPagesParameterEvidence';
import { collectPreviewInspectorNextPagesShell } from './previewInspectorNextPagesShell';

const NEXT_PAGES_SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const NEXT_PAGES_APP_BASENAMES = Object.freeze(['_app.tsx', '_app.jsx', '_app.ts', '_app.js']);
const NEXT_PAGES_SPECIAL_PAGE_PATTERN = /^(?:404|500|_app|_document|_error)$/iu;

/** Snapshot-aware inputs supplied by the compiler without a package-wide source inventory. */
export interface CreatePreviewInspectorNextPagesDirectRoutePlanOptions {
  /** Default-export page selected in the editor. */
  readonly documentPath: string;
  /** Nearest package root that bounds both the route and reached parameter evidence. */
  readonly projectRoot: string;
  /** Reads dirty snapshots first and bounded disk source second. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Project-aware resolver used only for exact imports reached from the selected page. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale shell and parameter work between bounded source reads. */
  readonly signal?: AbortSignal;
  /** Dirty snapshot identities already known to the request; no inventory scan is required. */
  readonly sourcePaths: readonly string[];
  /** Optional trusted root for exact parameter imports absent from `sourcePaths`. */
  readonly staticParameterSourceBoundary?: string;
}

/**
 * Reports whether a source path is an eligible conventional Pages Router leaf.
 *
 * The check is purely structural and performs no I/O. `_app` existence is proven later by the
 * planner, allowing preparation to fall back to ordinary React ancestry when the directory is
 * merely named `pages` but is not a Pages Router application.
 */
export function isPreviewInspectorNextPagesDirectRoutePath(
  documentPath: string,
  projectRoot: string,
): boolean {
  return findStrictPagesRoot(documentPath, projectRoot) !== undefined;
}

/**
 * Connects one direct Pages Router route to its implicit `_app` before the first esbuild artifact.
 *
 * The plan contains exactly one authored page candidate. Reached route-parameter registries are
 * retained as dependencies for hot reload, while unrelated pages and package modules are never
 * enumerated or admitted to the bundle.
 */
export async function createPreviewInspectorNextPagesDirectRoutePlan(
  options: CreatePreviewInspectorNextPagesDirectRoutePlanOptions,
): Promise<PreviewInspectorAncestorPlan | undefined> {
  const documentPath = path.normalize(options.documentPath);
  const pagesRoot = findStrictPagesRoot(documentPath, options.projectRoot);
  if (pagesRoot === undefined) return undefined;

  const appPath = await findNearestPagesAppPath({
    pagesRoot,
    readSource: options.readSource,
    sourcePaths: options.sourcePaths,
  });
  if (appPath === undefined) return undefined;

  const sourcePaths = Object.freeze(
    [
      ...new Set(
        [...options.sourcePaths, documentPath, appPath].map((sourcePath) =>
          path.normalize(sourcePath),
        ),
      ),
    ].sort(),
  );
  const initialShell = collectPreviewInspectorNextPagesShell({
    exportName: 'default',
    pagePath: documentPath,
    sourcePaths,
  });
  if (initialShell === undefined) return undefined;

  const refinement = await refinePreviewInspectorNextPagesShell({
    readSource: options.readSource,
    resolveModule: options.resolveModule,
    shell: initialShell,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths,
    ...(options.staticParameterSourceBoundary === undefined
      ? {}
      : { staticParameterSourceBoundary: options.staticParameterSourceBoundary }),
  });
  const target = Object.freeze({ exportName: 'default', sourcePath: documentPath });
  const emptyProps = Object.freeze({});
  const dependencies = new Set<string>([documentPath, appPath, ...refinement.dependencyPaths]);
  const candidate = freezePreviewInspectorPageCandidate({
    complete: true,
    dependencies,
    edges: Object.freeze([]),
    id: `next-pages-direct:${documentPath}`,
    renderPath: undefined,
    root: target,
    rootAutomaticProps: emptyProps,
    nextPagesShell: refinement.shell,
    rootOwnsRouter: false,
    routeLocation: refinement.shell.routeLocation,
    stopReason: 'root-reached',
    targetAutomaticProps: emptyProps,
  });
  const renderChain: PreviewRenderChainPlan = Object.freeze({
    dependencyPaths: Object.freeze([...dependencies].sort()),
    paths: Object.freeze([]),
    reachability: 'entry-unreachable',
    stopReason: 'entry-unreachable',
    target,
    truncated: false,
  });
  return freezePreviewInspectorAncestorPlan({
    complete: true,
    dependencies,
    edges: candidate.edges,
    pageCandidates: Object.freeze([candidate]),
    root: candidate.root,
    rootAutomaticProps: candidate.rootAutomaticProps,
    renderChain,
    renderChainsByExport: Object.freeze({ default: renderChain }),
    renderOutcomesByExport: Object.freeze({}),
    stopReason: 'root-reached',
    target,
    targetAutomaticProps: emptyProps,
  });
}

/** Finds the nearest eligible `pages` ancestor without leaving the selected package root. */
function findStrictPagesRoot(documentPath: string, projectRoot: string): string | undefined {
  const normalizedDocumentPath = path.resolve(documentPath);
  const normalizedProjectRoot = path.resolve(projectRoot);
  if (!isPathInside(normalizedProjectRoot, normalizedDocumentPath)) return undefined;
  const basename = path.basename(normalizedDocumentPath);
  const pageStem = basename.replace(NEXT_PAGES_SOURCE_PATTERN, '');
  if (!NEXT_PAGES_SOURCE_PATTERN.test(basename) || NEXT_PAGES_SPECIAL_PAGE_PATTERN.test(pageStem)) {
    return undefined;
  }

  let current = path.dirname(normalizedDocumentPath);
  while (isPathInside(normalizedProjectRoot, current)) {
    if (path.basename(current).toLowerCase() === 'pages') {
      const relativeSegments = path.relative(current, normalizedDocumentPath).split(path.sep);
      return relativeSegments[0]?.toLowerCase() === 'api' ? undefined : current;
    }
    if (current === normalizedProjectRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/** Selects the preferred sibling `_app` through at most four deterministic bounded reads. */
async function findNearestPagesAppPath(options: {
  readonly pagesRoot: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly sourcePaths: readonly string[];
}): Promise<string | undefined> {
  const knownPaths = new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  for (const basename of NEXT_PAGES_APP_BASENAMES) {
    const candidate = path.normalize(path.join(options.pagesRoot, basename));
    if (knownPaths.has(candidate) || (await options.readSource(candidate)) !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

/** Segment-aware containment prevents a similarly prefixed sibling package from being admitted. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}
