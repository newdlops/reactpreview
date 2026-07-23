/**
 * Classifies how much authored application context one compiler artifact has statically proven.
 * This module intentionally owns no bundling or filesystem work: it evaluates the immutable Page
 * Inspector plan that the bounded DFS/BFS planner already selected before esbuild starts.
 */
import path from 'node:path';
import type { PreviewBuildRequest, PreviewContextCoverage } from '../../domain/preview';
import type { PreviewInspectorAncestorPlan } from './inspector';

/** Evidence available after target-usage planning and before bundle publication. */
export interface ResolvePreviewContextCoverageOptions {
  /** Immutable request whose mode determines whether page context is relevant. */
  readonly request: PreviewBuildRequest;
  /** Compiler-selected ancestry and default page candidate, when static discovery succeeded. */
  readonly inspectorPlan: PreviewInspectorAncestorPlan | undefined;
  /** Candidate count actually admitted by the generated Inspector root; undefined means no cap. */
  readonly maximumPublishedPageCandidates: number | undefined;
}

/**
 * Returns `complete` only for an authored route corridor that reaches an application shell.
 *
 * A plan's `complete` bit alone means reverse owner traversal stopped cleanly; a standalone target
 * can satisfy that condition. The additional candidate, route, and shell checks prevent a generic
 * direct-file fallback from suppressing the deferred application-entry search.
 *
 * @param options Current build request and compiler-selected Page Inspector plan.
 * @returns Conservative page-context coverage safe for first-paint scheduling decisions.
 */
export function resolvePreviewContextCoverage(
  options: ResolvePreviewContextCoverageOptions,
): PreviewContextCoverage {
  if (options.request.renderMode !== 'page-inspector') {
    return options.request.preparationMode === 'fast' ? 'partial' : 'complete';
  }

  const plan = options.inspectorPlan;
  const candidate = plan?.pageCandidates[0];
  if (plan?.complete !== true || candidate?.complete !== true) return 'partial';
  if (
    options.request.preparationMode === 'fast' &&
    options.maximumPublishedPageCandidates !== undefined &&
    plan.pageCandidates.length > Math.max(1, Math.floor(options.maximumPublishedPageCandidates))
  ) {
    return 'partial';
  }

  const renderPath = candidate.renderPath;
  if (plan.renderChain.reachability === 'entry-connected' && renderPath?.entryPoint !== undefined) {
    return 'complete';
  }

  const routeLocation = candidate.routeLocation;
  if (routeLocation === undefined) return 'partial';

  if (routeLocation.evidenceKind === 'next-app-filesystem') {
    return candidate.nextAppLayoutChain !== undefined &&
      candidate.nextAppLayoutChain.length > 0 &&
      /^page\.[cm]?[jt]sx?$/iu.test(path.basename(routeLocation.sourcePath))
      ? 'complete'
      : 'partial';
  }

  if (routeLocation.evidenceKind === 'next-pages-filesystem') {
    return candidate.nextPagesShell !== undefined ? 'complete' : 'partial';
  }

  return 'partial';
}
