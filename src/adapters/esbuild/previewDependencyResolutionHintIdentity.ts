/** Defines the source-free dependency contract projection shared by compiler cache identities. */
import type { PreviewDependencyResolutionHintPlan } from './previewMissingDependencyRequirements';

/** Retains code-affecting contract provenance and package/style selections in authored order. */
export function createPreviewDependencyResolutionHintIdentity(
  plan: PreviewDependencyResolutionHintPlan | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return plan === undefined
    ? undefined
    : {
        facadeSourcePaths: plan.facadeSourcePaths,
        facadeContracts: plan.facadeCandidates.map((candidate) => ({
          contractExamples: candidate.contractExamples?.map((example) => ({
            exportName: example.exportName,
            mode: example.mode,
            value: example.value,
          })),
          evidenceSourcePaths: candidate.evidenceSourcePaths,
          sourcePath: candidate.sourcePath,
        })),
        packageContracts: plan.packageContractCandidates.map((candidate) => ({
          moduleSpecifier: candidate.moduleSpecifier,
          sourcePath: candidate.sourcePath,
        })),
        packageNames: plan.packageNames,
        styleHints: plan.styleCandidates.map((candidate) => ({
          moduleSpecifier: candidate.moduleSpecifier,
          sourcePath: candidate.sourcePath,
        })),
        version: plan.version,
      };
}
