/** Pre-seeds adaptive native-build decisions from the already frozen authored frontier. */
import path from 'node:path';
import {
  discoverPreviewGlobalPackageBridges,
  type PreviewGlobalPackageBridgeEvidencePolicy,
} from './globalPackageBridge';
import type { PreviewRouterRequirement } from './previewRouterRequirement';
import { collectPreviewRouterRequirement } from './previewRouterRequirement';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import { collectPreviewImplicitPackageGlobals } from './staticResources/previewImplicitPackageGlobals';

interface PreparePreviewAdaptiveBuildSeedOptions {
  readonly globalBridgeEvidencePolicy: PreviewGlobalPackageBridgeEvidencePolicy;
  readonly projectRoot: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  readonly sourcePaths: readonly string[];
  readonly staticModuleResolver: PreviewStaticModuleResolver;
  readonly workspaceRoot: string;
}

export interface PreviewAdaptiveBuildSeed {
  readonly referencedGlobalNames: readonly string[];
  readonly routerRequirement: PreviewRouterRequirement;
}

/**
 * Uses the exact authored frontier that Page Context preparation already froze.
 * This avoids a full native build whose only purpose is discovering a child
 * router hook or an exact package-shaped free global.
 */
export async function preparePreviewAdaptiveBuildSeed(
  options: PreparePreviewAdaptiveBuildSeedOptions,
): Promise<PreviewAdaptiveBuildSeed> {
  const baselineGlobalPlan = await discoverPreviewGlobalPackageBridges({
    ...options.globalBridgeEvidencePolicy,
    projectRoot: options.projectRoot,
    referencedGlobalNames: [],
    workspaceRoot: options.workspaceRoot,
  });
  const candidateNames = baselineGlobalPlan.fallbackCandidateNames;
  const referencedGlobalNames = new Set<string>();
  let consumesRouter = false;
  let ownsRouter = false;
  for (const sourcePath of [...new Set(options.sourcePaths.map((candidate) => path.normalize(candidate)))].sort()) {
    const sourceText = await options.readSource(sourcePath);
    if (sourceText === undefined) continue;
    if (sourceText.includes('react-router')) {
      const requirement = collectPreviewRouterRequirement(sourcePath, sourceText);
      consumesRouter ||= requirement.consumesRouter;
      ownsRouter ||= requirement.ownsRouter;
    }
    if (
      candidateNames.length === 0 ||
      !candidateNames.some((candidateName) => sourceText.includes(candidateName))
    ) {
      continue;
    }
    const inventory = collectPreviewImplicitPackageGlobals({
      candidateNames,
      resolver: options.staticModuleResolver,
      sourcePath,
      sourceText,
    });
    for (const global of inventory.globals) referencedGlobalNames.add(global.globalName);
  }
  return Object.freeze({
    referencedGlobalNames: Object.freeze([...referencedGlobalNames].sort()),
    routerRequirement: Object.freeze({ consumesRouter, ownsRouter }),
  });
}
