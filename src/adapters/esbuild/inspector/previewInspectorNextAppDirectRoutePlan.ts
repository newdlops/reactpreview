/**
 * Creates a low-cost Page Inspector plan for a directly selected Next App Router route module.
 * Cold previews need this filesystem-only shell before esbuild starts; otherwise a page's broad
 * generated registries enter the bundle before the full reverse component analysis can install
 * the corridor pruner. The planner reads the chosen page/layout plus exact static-parameter
 * bindings reached inside an optional trusted source boundary; it never scans that boundary.
 */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewRenderChainPlan } from '../renderGraph';
import {
  freezePreviewInspectorAncestorPlan,
  freezePreviewInspectorPageCandidate,
} from './previewInspectorAncestorFreezing';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import { collectPreviewInspectorNextAppDescendantPages } from './previewInspectorNextAppDescendantPages';
import { collectPreviewInspectorNextAppLayoutChain } from './previewInspectorNextAppLayoutChain';
import { collectRefinedPreviewInspectorNextAppLayoutChain } from './previewInspectorNextAppParameterEvidence';

const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;
const NEXT_APP_SHELL_PATTERN = /^(?:layout|template)\.[cm]?[jt]sx?$/iu;

/** Snapshot-aware inputs supplied from the compiler's already bounded package inventory. */
export interface CreatePreviewInspectorNextAppDirectRoutePlanOptions {
  /** Absolute page, layout, or template selected in the editor. */
  readonly documentPath: string;
  /** Reads dirty snapshots first and bounded disk source second. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Project-aware resolver used only by reached `generateStaticParams` collections. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale static-parameter work before it opens another reached source module. */
  readonly signal?: AbortSignal;
  /** Existing route inventory; exact parameter imports may be read but are never enumerated. */
  readonly sourcePaths: readonly string[];
  /** Optional package/source root that admits only reached static-parameter imports. */
  readonly staticParameterSourceBoundary?: string;
}

/**
 * Connects a selected page to its layouts, or a selected shell to its nearest descendant page.
 * Exactly one candidate is retained so a cold bundle cannot include every route sibling.
 */
export async function createPreviewInspectorNextAppDirectRoutePlan(
  options: CreatePreviewInspectorNextAppDirectRoutePlanOptions,
): Promise<PreviewInspectorAncestorPlan | undefined> {
  const documentPath = path.normalize(options.documentPath);
  const basename = path.basename(documentPath);
  if (!NEXT_APP_PAGE_PATTERN.test(basename) && !NEXT_APP_SHELL_PATTERN.test(basename)) {
    return undefined;
  }
  const target = Object.freeze({ exportName: 'default', sourcePath: documentPath });
  const emptyProps = Object.freeze({});
  const directDependencies = new Set([documentPath]);
  let candidate: PreviewInspectorPageCandidate | undefined;

  if (NEXT_APP_PAGE_PATTERN.test(basename)) {
    const initialShell = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath: documentPath,
      sourcePaths: options.sourcePaths,
    });
    if (initialShell === undefined) return undefined;
    const refinement = await collectRefinedPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath: documentPath,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      sourcePaths: options.sourcePaths,
      ...(options.staticParameterSourceBoundary === undefined
        ? {}
        : { staticParameterSourceBoundary: options.staticParameterSourceBoundary }),
    });
    const shell = refinement?.shell ?? initialShell;
    for (const dependencyPath of refinement?.dependencyPaths ?? []) {
      directDependencies.add(dependencyPath);
    }
    for (const layout of shell.layouts) directDependencies.add(layout.sourcePath);
    candidate = freezePreviewInspectorPageCandidate({
      complete: true,
      dependencies: directDependencies,
      edges: Object.freeze([]),
      id: `next-app-direct:${documentPath}`,
      renderPath: undefined,
      root: target,
      rootAutomaticProps: emptyProps,
      nextAppLayoutChain: shell.layouts,
      rootOwnsRouter: false,
      routeLocation: shell.routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: emptyProps,
    });
  } else {
    const base = freezePreviewInspectorPageCandidate({
      complete: false,
      dependencies: directDependencies,
      edges: Object.freeze([]),
      id: `next-app-shell:${documentPath}`,
      renderPath: undefined,
      root: target,
      rootAutomaticProps: emptyProps,
      rootOwnsRouter: false,
      stopReason: 'root-reached',
      targetAutomaticProps: emptyProps,
    });
    const descendants = await collectPreviewInspectorNextAppDescendantPages({
      base,
      maximumCount: 1,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      sourcePaths: options.sourcePaths,
    });
    candidate = descendants[0];
  }
  if (candidate === undefined) return undefined;

  const dependencies = new Set(candidate.dependencyPaths);
  dependencies.add(documentPath);
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
