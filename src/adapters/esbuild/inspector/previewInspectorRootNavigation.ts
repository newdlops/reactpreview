/** Derives exact render chains and inert Next layout segment values for the root module. */
import path from 'node:path';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorComponentReference,
} from './previewInspectorAncestorPlan';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';

/**
 * Keeps alternate current-file exports selectable while removing inactive references of the
 * currently compiled export from browser-side blocker and JSX-case discovery.
 */
export function createPreviewInspectorDescriptorRenderChains(
  plan: PreviewInspectorAncestorPlan,
  runtimeTarget: PreviewInspectorComponentReference,
  selectedRenderPath: PreviewInspectorPageCandidate['renderPath'],
): Pick<PreviewInspectorAncestorPlan, 'renderChain' | 'renderChainsByExport'> {
  const targetRenderChain = plan.renderChainsByExport[runtimeTarget.exportName];
  const firstStep = selectedRenderPath?.steps[0];
  const exactSelectedTargetPath =
    targetRenderChain !== undefined &&
    firstStep !== undefined &&
    path.normalize(firstStep.sourcePath) === path.normalize(runtimeTarget.sourcePath) &&
    (firstStep.label === runtimeTarget.exportName ||
      (runtimeTarget.exportName === 'default' && firstStep.label.endsWith(' (default)')));
  if (!exactSelectedTargetPath || selectedRenderPath === undefined) {
    return {
      renderChain: plan.renderChain,
      renderChainsByExport: plan.renderChainsByExport,
    };
  }
  const selectedRenderChain = Object.freeze({
    ...targetRenderChain,
    paths: Object.freeze([selectedRenderPath]),
  });
  return {
    renderChain: selectedRenderChain,
    renderChainsByExport: Object.freeze({
      ...plan.renderChainsByExport,
      [runtimeTarget.exportName]: selectedRenderChain,
    }),
  };
}

/** Per-layout navigation context serialized beside one composed App Router candidate. */
export interface PreviewNextAppLayoutNavigationValue {
  /** Active route segments below this exact layout/template boundary. */
  readonly segments: readonly string[];
  /** Known named slots remain neutral until a future bounded slot branch is selected. */
  readonly slots: Readonly<Record<string, readonly string[]>>;
}

/**
 * Derives Next's layout-relative segment hook values from the same filesystem route evidence.
 * Using source directories instead of splitting the final URL preserves route groups and collapses
 * catch-all values into the single segment returned by Next's public navigation hooks.
 */
export function createNextAppLayoutNavigationValues(
  candidate: PreviewInspectorPageCandidate,
): readonly PreviewNextAppLayoutNavigationValue[] {
  const routeParams =
    candidate.routeLocation !== undefined && 'params' in candidate.routeLocation
      ? candidate.routeLocation.params
      : {};
  const pageDirectory = path.dirname(candidate.root.sourcePath);
  return Object.freeze(
    (candidate.nextAppLayoutChain ?? []).map((layout) => {
      const relativePath = path.relative(path.dirname(layout.sourcePath), pageDirectory);
      const segments =
        relativePath.startsWith('..') || path.isAbsolute(relativePath)
          ? []
          : relativePath
              .split(path.sep)
              .filter(Boolean)
              .flatMap((segment) => normalizeNextLayoutSegment(segment, routeParams));
      const slots = Object.fromEntries((layout.slotNames ?? []).map((slotName) => [slotName, []]));
      return Object.freeze({
        segments: Object.freeze(segments),
        slots: Object.freeze(slots),
      });
    }),
  );
}

/** Converts one filesystem segment into the public layout-hook representation. */
export function normalizeNextLayoutSegment(
  sourceSegment: string,
  params: Readonly<Record<string, string | readonly string[]>>,
): readonly string[] {
  if (
    sourceSegment.startsWith('@') ||
    sourceSegment.startsWith('_') ||
    /^\([^)]*\)$/u.test(sourceSegment)
  ) {
    return Object.freeze([]);
  }
  const segment = sourceSegment.replace(/^(?:\(\.\.\.\)|\(\.\.\)|\(\.\))+/u, '');
  const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(segment);
  if (optionalCatchAll !== null) {
    const values = readNextLayoutParameterValues(params[optionalCatchAll[1] ?? '']);
    return values.length === 0 ? Object.freeze([]) : Object.freeze([values.join('/')]);
  }
  const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(segment);
  if (catchAll !== null) {
    const values = readNextLayoutParameterValues(params[catchAll[1] ?? '']);
    return Object.freeze([values.length === 0 ? (catchAll[1] ?? 'preview') : values.join('/')]);
  }
  const dynamic = /^\[([^\]]+)\]$/u.exec(segment);
  if (dynamic !== null) {
    const values = readNextLayoutParameterValues(params[dynamic[1] ?? '']);
    return Object.freeze([values[0] ?? dynamic[1] ?? 'preview']);
  }
  return Object.freeze([decodeNextLayoutSegment(segment)]);
}

/** Narrows scalar and catch-all route values to one immutable string sequence. */
export function readNextLayoutParameterValues(
  value: string | readonly string[] | undefined,
): string[] {
  if (typeof value === 'string') return [value];
  if (value === undefined) return [];
  return Array.from(value);
}

/** Decodes ordinary URL-safe segment spelling while keeping malformed escapes inspectable. */
export function decodeNextLayoutSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/^%5f/iu, '_'));
  } catch {
    return segment;
  }
}
