/**
 * Defines bounded, stage-aware watchdog budgets for isolated preview compilation.
 *
 * Page Inspector's fast graph is still an authored page analysis: healthy discovery can exceed
 * 45 seconds under load. Its analysis and bundling share the existing finite full-page allowance.
 * Preparation mode continues to select graph depth, without imposing a shorter visible-page
 * cutoff. Queue acquisition, cancellation acknowledgement, worker memory isolation, and explicit
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
const PAGE_INSPECTOR_BUNDLE_TIMEOUT_MS = 120_000;

/**
 * Creates a mode-aware watchdog policy without inspecting project-specific paths or frameworks.
 *
 * A configured override remains a deterministic single deadline for tests and embedding hosts.
 * Production Page Inspector requests omit one whole-build ceiling because each distinct analysis
 * milestone owns its own allowance. Its heartbeat-free native bundle still receives the explicit
 * finite allowance selected below. Ordinary component previews keep the tighter total deadline.
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
  const modeStageTimeoutMs =
    mode === 'fast'
      ? FAST_STAGE_TIMEOUT_MS
      : mode === 'corridor'
        ? CORRIDOR_STAGE_TIMEOUT_MS
        : FULL_STAGE_TIMEOUT_MS;
  const pageInspector = request.renderMode === 'page-inspector';
  const initialStageTimeoutMs = pageInspector
    ? Math.max(modeStageTimeoutMs, PAGE_INSPECTOR_BUNDLE_TIMEOUT_MS)
    : modeStageTimeoutMs;
  return Object.freeze({
    fixed: false,
    initialStageTimeoutMs,
    ...(pageInspector ? {} : { totalTimeoutMs: initialStageTimeoutMs }),
  });
}

/**
 * Selects the inactivity budget after one new compiler milestone.
 *
 * Page Inspector analysis and native bundling retain the same finite stage allowance. This is
 * independent from repository size: a healthy stage may use the full allowance, while a wedged
 * worker is eventually recycled. Repeated reports of the same stage do not renew the client timer.
 * Component previews and explicit host overrides retain their existing compact or fixed budget.
 */
export function selectPreviewCompilerStageTimeoutMs(
  request: PreviewBuildRequest,
  budget: PreviewCompilerWorkerBudget,
  stage: PreviewProgressStage,
): number | undefined {
  if (budget.fixed || stage !== 'bundling-modules' || request.renderMode !== 'page-inspector') {
    return budget.initialStageTimeoutMs;
  }
  return Math.max(budget.initialStageTimeoutMs, PAGE_INSPECTOR_BUNDLE_TIMEOUT_MS);
}

/** Rejects non-finite and non-positive overrides instead of accidentally disabling isolation. */
function normalizeConfiguredTimeout(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
