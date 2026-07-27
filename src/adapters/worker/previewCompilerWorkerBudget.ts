/**
 * Defines bounded, stage-aware watchdog budgets for isolated preview compilation.
 *
 * Page Inspector bundling can legitimately take longer than source discovery because esbuild must
 * resolve an authored page corridor and its styles. Native bundling cannot report meaningful
 * sub-stage progress, so production Page Inspector requests do not receive a fixed active-bundle
 * deadline. Queue acquisition, cancellation acknowledgement, worker memory isolation, and explicit
 * host overrides remain independent recovery boundaries.
 */
import type { PreviewBuildRequest } from '../../domain/preview';
import type { PreviewProgressStage } from '../../domain/previewProgress';

/** Immutable timing policy owned by one active worker request. */
export interface PreviewCompilerWorkerBudget {
  /** Whether a test/host override preserves the legacy single hard deadline. */
  readonly fixed: boolean;
  /** Deadline used before a distinct compiler milestone proves forward progress. */
  readonly initialStageTimeoutMs: number;
  /** Optional absolute ceiling; omitted for automatic Page Inspector compilation. */
  readonly totalTimeoutMs?: number;
}

const FAST_STAGE_TIMEOUT_MS = 45_000;
const CORRIDOR_STAGE_TIMEOUT_MS = 60_000;
const FULL_STAGE_TIMEOUT_MS = 120_000;

/**
 * Creates a mode-aware watchdog policy without inspecting project-specific paths or frameworks.
 *
 * A configured override remains a deterministic single deadline for tests and embedding hosts.
 * Production Page Inspector requests omit the absolute ceiling because their native bundling step
 * has no reliable heartbeat. Ordinary component previews keep the tighter finite deadline.
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
  const mode = request.preparationMode ?? 'full';
  const initialStageTimeoutMs =
    mode === 'fast'
      ? FAST_STAGE_TIMEOUT_MS
      : mode === 'corridor'
        ? CORRIDOR_STAGE_TIMEOUT_MS
        : FULL_STAGE_TIMEOUT_MS;
  const pageInspector = request.renderMode === 'page-inspector';
  return Object.freeze({
    fixed: false,
    initialStageTimeoutMs,
    ...(pageInspector ? {} : { totalTimeoutMs: initialStageTimeoutMs }),
  });
}

/**
 * Selects the inactivity budget after one new compiler milestone.
 *
 * Page Inspector's native bundling phase receives no fixed inactivity deadline. All other work must
 * continue to report a distinct stage within the normal mode budget.
 */
export function selectPreviewCompilerStageTimeoutMs(
  request: PreviewBuildRequest,
  budget: PreviewCompilerWorkerBudget,
  stage: PreviewProgressStage,
): number | undefined {
  if (budget.fixed || stage !== 'bundling-modules' || request.renderMode !== 'page-inspector') {
    return budget.initialStageTimeoutMs;
  }
  return undefined;
}

/** Rejects non-finite and non-positive overrides instead of accidentally disabling isolation. */
function normalizeConfiguredTimeout(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
