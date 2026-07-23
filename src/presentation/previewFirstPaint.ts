/**
 * Selects the preparation policy used by a pinned preview session.
 * Every cold surface may publish a graph-reachable fast bundle first; complete Page Inspector
 * ancestry is then enriched only after the browser has acknowledged that useful first paint.
 */
import type { BuildPreview } from '../application/buildPreview';
import type { PreparedPreview, PreviewBuildRequest, PreviewRenderMode } from '../domain/preview';
import {
  isPreviewBuildCancellation,
  isPreviewBuildStall,
  type PreviewBuildExecutionContext,
} from '../domain/previewBuildExecution';

/** Minimal application boundary required by first-paint selection. */
type PreviewFirstPaintBuildService = Pick<BuildPreview, 'execute'>;

/** Result of first-paint preparation and whether a later context enrichment remains useful. */
export interface PreviewFirstPaintResult {
  /** Published bundle safe to commit as the next browser revision. */
  readonly preparedPreview: PreparedPreview;
  /** Whether the fast graph omitted reverse usage and application-entry discovery. */
  readonly requiresContextEnrichment: boolean;
}

/** Inputs that remain immutable across the fast attempt and its complete fallback. */
export interface PreviewFirstPaintOptions {
  /** Application service that compiles and publishes one preparation policy. */
  readonly buildPreview: PreviewFirstPaintBuildService;
  /** Cancellation and progress controls owned by the current panel revision. */
  readonly context: PreviewBuildExecutionContext;
  /** Rendering surface selected when the panel was opened. */
  readonly renderMode: PreviewRenderMode;
  /** Whether this session still needs a cold direct-graph first paint before full rebuild reuse. */
  readonly preferFast: boolean;
  /** Latest source snapshot for the panel's pinned target. */
  readonly request: PreviewBuildRequest;
}

/**
 * Publishes a fast cold artifact before deferred context, or reuses full preparation once warm.
 * Cancellation is never converted into fallback work because a newer revision already owns the UI.
 *
 * @param options Build service, immutable source request, render mode, and execution context.
 * @returns First committable artifact plus the remaining enrichment decision.
 */
export async function preparePreviewFirstPaint(
  options: PreviewFirstPaintOptions,
): Promise<PreviewFirstPaintResult> {
  if (!options.preferFast) {
    const preparedPreview = await options.buildPreview.execute(
      {
        ...options.request,
        buildIntent: 'foreground',
        preparationMode: 'full',
        renderMode: options.renderMode,
      },
      options.context,
    );
    return { preparedPreview, requiresContextEnrichment: false };
  }
  try {
    const preparedPreview = await options.buildPreview.execute(
      {
        ...options.request,
        buildIntent: 'foreground',
        preparationMode: 'fast',
        renderMode: options.renderMode,
      },
      options.context,
    );
    return {
      preparedPreview,
      requiresContextEnrichment: preparedPreview.contextCoverage !== 'complete',
    };
  } catch (error) {
    if (isPreviewBuildCancellation(error, options.context.signal) || isPreviewBuildStall(error)) {
      throw error;
    }
    const preparedPreview = await options.buildPreview.execute(
      {
        ...options.request,
        buildIntent: 'foreground',
        preparationMode: 'full',
        renderMode: options.renderMode,
      },
      options.context,
    );
    return { preparedPreview, requiresContextEnrichment: false };
  }
}
