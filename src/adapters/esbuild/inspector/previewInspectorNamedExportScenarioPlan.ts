/** Builds one selectable authored-page scenario per named component export. */
import type { PreviewRenderChainPlansByExport } from '../renderGraph';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorTypes';

/** Inputs that keep the primary plan fast while allowing independent secondary analysis. */
export interface CreatePreviewInspectorNamedExportScenarioPlanOptions {
  /** Creates one export-specific plan, optionally reusing the primary render-chain inventory. */
  readonly createPlan: (
    exportName: string,
    renderChainsByExport: PreviewRenderChainPlansByExport,
  ) => Promise<PreviewInspectorAncestorPlan>;
  /** Source-ordered explicit exports admitted by the target selector. */
  readonly exportNames: readonly string[];
  /** Existing primary plan whose visual ranking and route metadata remain authoritative. */
  readonly primaryPlan: PreviewInspectorAncestorPlan;
}

/** Returns true only for the ambiguous no-default component-module shape. */
export function hasPreviewInspectorNamedExportScenarios(exportNames: readonly string[]): boolean {
  const uniqueNames = new Set(exportNames);
  return uniqueNames.size > 1 && !uniqueNames.has('default');
}

/**
 * Adds independently selectable page candidates for every named component export.
 *
 * Secondary ancestry passes are independent and run concurrently. Callers may reuse the primary
 * render chains or search an export-specific bounded corridor, while the primary plan retains its
 * existing default ranking and route controls.
 */
export async function createPreviewInspectorNamedExportScenarioPlan(
  options: CreatePreviewInspectorNamedExportScenarioPlanOptions,
): Promise<PreviewInspectorAncestorPlan> {
  const exportNames = [...new Set(options.exportNames)];
  if (!hasPreviewInspectorNamedExportScenarios(exportNames)) return options.primaryPlan;
  const primaryExportName = options.primaryPlan.target.exportName;
  const secondaryExportNames = exportNames.filter((exportName) => exportName !== primaryExportName);
  const secondaryPlans = await Promise.all(
    secondaryExportNames.map((exportName) =>
      options.createPlan(exportName, options.primaryPlan.renderChainsByExport),
    ),
  );
  const plans = [options.primaryPlan, ...secondaryPlans];
  const dependencyPaths = Object.freeze(
    [...new Set(plans.flatMap((plan) => plan.dependencyPaths))].sort(),
  );
  const renderChainsByExport = Object.freeze(
    Object.assign({}, ...plans.map((plan) => plan.renderChainsByExport)),
  );
  const renderOutcomesByExport = Object.freeze(
    Object.assign({}, ...plans.map((plan) => plan.renderOutcomesByExport ?? {})),
  );
  const pageCandidates = Object.freeze(
    plans.flatMap((plan) =>
      plan.pageCandidates.map((candidate) =>
        Object.freeze({
          ...candidate,
          id: createNamedExportScenarioCandidateId(plan.target.exportName, candidate.id),
          target: plan.target,
        }),
      ),
    ),
  );
  return Object.freeze({
    ...options.primaryPlan,
    dependencyPaths,
    pageCandidates,
    renderChainsByExport,
    renderOutcomesByExport,
  });
}

/** Namespaces candidate ids because different orphan exports share `nearest-authored-owner`. */
function createNamedExportScenarioCandidateId(exportName: string, candidateId: string): string {
  return `named-export:${encodeURIComponent(exportName)}:${candidateId}`;
}
