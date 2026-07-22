/**
 * Defines immutable empty evidence used by the compiler's direct first-paint path.
 * Keeping these structural defaults outside the build orchestrator makes its runtime planning
 * readable while preserving exact domain shapes for fast and full preparation modes.
 */
import path from 'node:path';
import { PreviewCompilationError, type PreviewBuildRequest } from '../../domain/preview';
import type { PreviewImplicitGlobalEvidenceInventory } from './previewImplicitGlobalEvidence';
import type { PreviewRuntimeWatchInputs } from './previewRuntimeEnvironment';
import type { PreviewRouterRequirement } from './previewRouterRequirement';
import type { PreviewSassBoundary } from './previewSassPlugin';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';
import type { PreviewGlobalPackageBridgePlan } from './globalPackageBridge/previewGlobalPackageBridge';

const MAX_PREVIEW_WATCH_DIRECTORIES = 128;

/** Direct preview omits package-wide reverse analysis until background enrichment begins. */
export const EMPTY_TARGET_USAGE_PROPS: PreviewTargetUsageProps = Object.freeze({
  dependencyPaths: Object.freeze([]),
  parentSlicesByExport: Object.freeze({}),
  propsByExport: Object.freeze({}),
});

/** Fast builds discover exact free globals from reached esbuild inputs instead of a cold scan. */
export const EMPTY_IMPLICIT_GLOBAL_EVIDENCE: PreviewImplicitGlobalEvidenceInventory = Object.freeze(
  {
    ambiguousGlobalNames: Object.freeze([]),
    dependencyPaths: Object.freeze([]),
    evidence: Object.freeze([]),
    truncated: false,
    unresolvedGlobalNames: Object.freeze([]),
  },
);

/** Fast first paint observes reached esbuild inputs before conventional watch roots join. */
export const EMPTY_RUNTIME_WATCH_INPUTS: PreviewRuntimeWatchInputs = Object.freeze({
  dependencyPaths: Object.freeze([]),
  watchDirectories: Object.freeze([]),
});

/** Router bridge selection carried into one discovery or final esbuild attempt. */
export interface PreviewRouterBuildSelection {
  /** Whether graph evidence permits a default automatic MemoryRouter wrapper. */
  readonly automaticallyWrap: boolean;
  /** Whether the project router package should be resolved into the final runtime. */
  readonly enabled: boolean;
}

/**
 * Seeds the first native build from both a cached reached graph and the current editor target.
 * Direct router hooks are therefore wrapped on the first pass instead of compiling the same large
 * dependency graph once to discover the hook and a second time to install its MemoryRouter.
 */
export function selectPreviewInitialRouterBuild(
  cached: PreviewRouterRequirement | undefined,
  target: PreviewRouterRequirement,
): PreviewRouterBuildSelection {
  const consumesRouter = cached?.consumesRouter === true || target.consumesRouter;
  const ownsRouter = cached?.ownsRouter === true || target.ownsRouter;
  return consumesRouter
    ? { automaticallyWrap: !ownsRouter, enabled: true }
    : { automaticallyWrap: false, enabled: false };
}

/** Reports whether cached router ownership exactly matches the newly reached source graph. */
export function haveEquivalentRouterSelections(
  left: PreviewRouterBuildSelection,
  right: PreviewRouterBuildSelection,
): boolean {
  return left.enabled === right.enabled && left.automaticallyWrap === right.automaticallyWrap;
}

/** Describes static module injection without claiming that every available candidate was used. */
export function describeGlobalPackageBridgeStatus(plan: PreviewGlobalPackageBridgePlan): string {
  if (plan.bridges.length === 0) {
    return plan.truncated
      ? 'degraded: implicit-global evidence or exact package candidates exceeded a safety budget'
      : 'available: no active bridge; exact package fallback is enabled only for reached free identifiers';
  }
  const projectEvidenceCount = plan.bridges.filter(
    (bridge) =>
      bridge.evidence === 'ambient-declaration' || bridge.evidence === 'runtime-assignment',
  ).length;
  const packageFallbackCount = plan.bridges.filter(
    (bridge) => bridge.evidence === 'dependency-name',
  ).length;
  return `active: ${plan.bridges.length.toString()} lexical module bridge(s); ${projectEvidenceCount.toString()} from project bootstrap/ambient evidence, ${packageFallbackCount.toString()} from exact installed-package fallback`;
}

/** Reports whether adaptive discovery selected the same generated module bindings. */
export function haveEquivalentGlobalPackageBridges(
  left: PreviewGlobalPackageBridgePlan,
  right: PreviewGlobalPackageBridgePlan,
): boolean {
  return (
    left.bridges.length === right.bridges.length &&
    left.bridges.every((bridge, index) => {
      const candidate = right.bridges[index];
      return (
        bridge.globalName === candidate?.globalName &&
        bridge.moduleSpecifier === candidate.moduleSpecifier &&
        bridge.resolveDir === candidate.resolveDir &&
        bridge.exportKind === candidate.exportKind &&
        bridge.exportName === candidate.exportName
      );
    })
  );
}

/** Separates nearest-config and explicitly configured implicit-global evidence per package. */
export function createImplicitGlobalEvidenceCacheKey(
  projectRoot: string,
  configuredTsconfigPath: string | undefined,
): string {
  const configIdentity =
    configuredTsconfigPath === undefined
      ? 'nearest-config'
      : path.normalize(configuredTsconfigPath);
  return `${path.normalize(projectRoot)}\0${configIdentity}`;
}

/** Creates a stable setup/decorator title without exposing paths outside the selected workspace. */
export function createPreviewDocumentName(request: PreviewBuildRequest): string {
  const relativeName = path.relative(request.workspaceRoot, request.documentPath);
  return relativeName.length > 0 && !relativeName.startsWith('..') && !path.isAbsolute(relativeName)
    ? relativeName.split(path.sep).join('/')
    : path.basename(request.documentPath);
}

/** Narrows the Sass resource injected by a persistent context or one-shot setup build. */
export function requirePreviewSassBoundary(
  boundary: PreviewSassBoundary | undefined,
): PreviewSassBoundary {
  if (boundary === undefined) {
    throw new Error('React Preview could not initialize its project-scoped Sass boundary.');
  }
  return boundary;
}

/** Merges resource, runtime, and style watch roots under one lightweight session limit. */
export function mergePreviewWatchDirectories(
  ...directoryGroups: readonly (readonly string[])[]
): readonly string[] {
  const directories = [...new Set(directoryGroups.flat())].sort();
  if (directories.length > MAX_PREVIEW_WATCH_DIRECTORIES) {
    throw new PreviewCompilationError(
      `Preview build exceeds the ${MAX_PREVIEW_WATCH_DIRECTORIES.toString()} watch directory safety limit.`,
      [],
    );
  }
  return directories;
}
