/**
 * Defines bounded, stage-aware watchdog budgets for isolated preview compilation.
 *
 * Page Inspector bundling can legitimately take longer than source discovery because esbuild must
 * resolve an authored page corridor and its styles. Giving every phase the same short deadline
 * aborts healthy large graphs; removing the watchdog entirely would let a poisoned native service
 * retain memory indefinitely. This policy separates per-stage inactivity from an absolute ceiling.
 */
import type { PreviewBuildRequest } from '../../domain/preview';
import type { PreviewProgressStage } from '../../domain/previewProgress';

/** Immutable timing policy owned by one active worker request. */
export interface PreviewCompilerWorkerBudget {
  /** Whether a test/host override preserves the legacy single hard deadline. */
  readonly fixed: boolean;
  /** Deadline used before a distinct compiler milestone proves forward progress. */
  readonly initialStageTimeoutMs: number;
  /** Absolute active-request ceiling even when several legitimate milestones are observed. */
  readonly totalTimeoutMs: number;
}

const FAST_STAGE_TIMEOUT_MS = 45_000;
const FULL_STAGE_TIMEOUT_MS = 120_000;
const FAST_PAGE_BUNDLING_TIMEOUT_MS = 120_000;
const FULL_PAGE_BUNDLING_TIMEOUT_MS = 240_000;
const FAST_PAGE_TOTAL_TIMEOUT_MS = 180_000;
const FULL_PAGE_TOTAL_TIMEOUT_MS = 360_000;

/**
 * Creates a mode-aware watchdog policy without inspecting project-specific paths or frameworks.
 *
 * A configured override remains a deterministic single deadline for tests and embedding hosts.
 * Production Page Inspector requests receive a larger absolute ceiling because their bundling step
 * includes the statically composed page shell; ordinary component previews keep the tighter limit.
 */
export function createPreviewCompilerWorkerBudget(
  request: PreviewBuildRequest,
  configuredTimeoutMs: number | undefined,
): PreviewCompilerWorkerBudget {
  const configured = normalizeConfiguredTimeout(configuredTimeoutMs);
  if (configured !== undefined) {
    return Object.freeze({
      fixed: true,
      initialStageTimeoutMs: configured,
      totalTimeoutMs: configured,
    });
  }
  const fast = request.preparationMode === 'fast';
  const initialStageTimeoutMs = fast ? FAST_STAGE_TIMEOUT_MS : FULL_STAGE_TIMEOUT_MS;
  const pageInspector = request.renderMode === 'page-inspector';
  return Object.freeze({
    fixed: false,
    initialStageTimeoutMs,
    totalTimeoutMs: pageInspector
      ? fast
        ? FAST_PAGE_TOTAL_TIMEOUT_MS
        : FULL_PAGE_TOTAL_TIMEOUT_MS
      : initialStageTimeoutMs,
  });
}

/**
 * Selects the inactivity budget after one new compiler milestone.
 *
 * Only Page Inspector's native bundling phase receives the larger allowance. All other work must
 * continue to report a distinct stage within the normal mode budget.
 */
export function selectPreviewCompilerStageTimeoutMs(
  request: PreviewBuildRequest,
  budget: PreviewCompilerWorkerBudget,
  stage: PreviewProgressStage,
): number {
  if (budget.fixed || stage !== 'bundling-modules' || request.renderMode !== 'page-inspector') {
    return budget.initialStageTimeoutMs;
  }
  return request.preparationMode === 'fast'
    ? FAST_PAGE_BUNDLING_TIMEOUT_MS
    : FULL_PAGE_BUNDLING_TIMEOUT_MS;
}

/** Rejects non-finite and non-positive overrides instead of accidentally disabling isolation. */
function normalizeConfiguredTimeout(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
