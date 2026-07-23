/**
 * Decides whether a broad eager route registry can stay in the fast authored-page corridor.
 *
 * Keeping the registry preserves application layouts and providers, but only when the esbuild
 * corridor boundary can replace most independent unselected leaf routes with inert projections.
 * A bounded authentic minority may remain when route values also have visible runtime uses.
 */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';

const MINIMUM_PROJECTED_SHARE_NUMERATOR = 2;
const MINIMUM_PROJECTED_SHARE_DENOMINATOR = 3;
const MAXIMUM_AUTHENTIC_OFF_CORRIDOR_BRANCHES = 16;

/** Minimal facts returned to fast corridor trimming without exposing TypeScript syntax nodes. */
export interface PreviewInspectorFastRouteRegistryProjection {
  /** Total static route-branch module spellings detected in the registry. */
  readonly branchCount: number;
  /** True when safe projections remove enough independent off-corridor authored branches. */
  readonly preservesAuthoredPrefix: boolean;
}

/** Inputs use the caller's trusted workspace policy and alias-aware resolver. */
export interface AnalyzePreviewInspectorFastRouteRegistryOptions {
  /** Proven entry-to-target paths that must retain their authentic modules. */
  readonly corridorPaths: ReadonlySet<string>;
  /** Applies the caller's workspace, package, auxiliary, and source-extension policy. */
  readonly isAdmittedSourcePath: (sourcePath: string) => boolean;
  /** Exact alias-aware resolver shared by analysis and esbuild. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Absolute registry source identity. */
  readonly sourcePath: string;
  /** Current editor/filesystem registry snapshot. */
  readonly sourceText: string;
}

/**
 * Proves complete projection coverage for resolved authored route branches outside the corridor.
 *
 * Unresolved or external package requests are irrelevant to authored graph breadth and stay exact.
 * A bounded minority of unsafe authored branches also stays exact: projection is a cost boundary,
 * not correctness evidence, so preserving a useful application shell does not require every
 * sibling to be replaceable. Registries dominated by unsafe branches retain the page-local trim.
 */
export function analyzePreviewInspectorFastRouteRegistry(
  options: AnalyzePreviewInspectorFastRouteRegistryOptions,
): PreviewInspectorFastRouteRegistryProjection {
  const inventory = collectPreviewStaticRouteProjectionInventory(
    options.sourcePath,
    options.sourceText,
  );
  let projectedOffCorridorBranches = 0;
  let authenticOffCorridorBranches = 0;
  for (const moduleSpecifier of inventory.routeBranchSpecifiers) {
    const resolvedPath = options.resolveModule(moduleSpecifier, options.sourcePath);
    if (resolvedPath === undefined) continue;
    const childPath = path.normalize(resolvedPath);
    if (!options.isAdmittedSourcePath(childPath) || options.corridorPaths.has(childPath)) continue;
    if (!inventory.projectionsBySpecifier.has(moduleSpecifier)) {
      authenticOffCorridorBranches += 1;
      continue;
    }
    projectedOffCorridorBranches += 1;
  }
  const authoredOffCorridorBranches = projectedOffCorridorBranches + authenticOffCorridorBranches;
  const hasBoundedAuthenticMinority =
    authenticOffCorridorBranches <= MAXIMUM_AUTHENTIC_OFF_CORRIDOR_BRANCHES &&
    projectedOffCorridorBranches * MINIMUM_PROJECTED_SHARE_DENOMINATOR >=
      authoredOffCorridorBranches * MINIMUM_PROJECTED_SHARE_NUMERATOR;
  return Object.freeze({
    branchCount: inventory.branchCount,
    preservesAuthoredPrefix: projectedOffCorridorBranches > 0 && hasBoundedAuthenticMinority,
  });
}
