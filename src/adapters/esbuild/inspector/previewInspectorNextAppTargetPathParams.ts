/**
 * Derives Next App Router dynamic values from a selected source path outside `app`.
 *
 * A gallery route often mirrors `examples/<variant>/<name>.tsx` as
 * `/examples/[variant]/[name]`. The selected source is stronger local evidence than generic
 * placeholder parameter names, provided a literal route segment anchors both paths. This analyzer
 * is syntax-free and conservative: it never guesses when static segments diverge.
 */
import path from 'node:path';
import type {
  PreviewInspectorNextAppParamValue,
  PreviewInspectorNextAppRouteParams,
} from './previewInspectorNextAppLayoutChain';

const SOURCE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Inputs for one route-pattern to selected-source alignment. */
export interface InferPreviewInspectorNextAppTargetPathParamsOptions {
  /** Filesystem route pattern produced by the already-proven App Router page. */
  readonly routePattern: string;
  /** Direct editor source whose auxiliary directory structure may mirror the route. */
  readonly targetPath: string;
}

/** One anchored alignment candidate ranked by the number of safely bound dynamic segments. */
interface TargetPathParameterCandidate {
  readonly anchorOffset: number;
  readonly values: PreviewInspectorNextAppRouteParams;
}

/**
 * Returns dynamic values only when a literal route anchor aligns with the selected source path.
 *
 * Ordinary one-segment parameters consume one source segment. Terminal catch-all parameters
 * consume the remaining suffix, while optional catch-alls may stay empty. A non-terminal catch-all
 * is deliberately ignored because its split point is ambiguous without runtime router evidence.
 */
export function inferPreviewInspectorNextAppTargetPathParams(
  options: InferPreviewInspectorNextAppTargetPathParamsOptions,
): PreviewInspectorNextAppRouteParams | undefined {
  const routeSegments = options.routePattern.split('/').filter(Boolean);
  const targetSegments = path
    .normalize(options.targetPath)
    .split(path.sep)
    .filter(Boolean)
    .map((segment, index, segments) =>
      index === segments.length - 1 ? segment.replace(SOURCE_EXTENSION_PATTERN, '') : segment,
    );
  const candidates: TargetPathParameterCandidate[] = [];
  for (const [routeOffset, routeSegment] of routeSegments.entries()) {
    if (isDynamicRouteSegment(routeSegment)) continue;
    for (const [anchorOffset, targetSegment] of targetSegments.entries()) {
      if (targetSegment !== routeSegment) continue;
      const values = alignTargetSuffix(
        routeSegments.slice(routeOffset + 1),
        targetSegments.slice(anchorOffset + 1),
      );
      if (values !== undefined && Object.keys(values).length > 0) {
        candidates.push(Object.freeze({ anchorOffset, values }));
      }
    }
  }
  candidates.sort(
    (left, right) =>
      Object.keys(right.values).length - Object.keys(left.values).length ||
      right.anchorOffset - left.anchorOffset,
  );
  return candidates[0]?.values;
}

/** Aligns route segments after one common static anchor without skipping source directories. */
function alignTargetSuffix(
  routeSegments: readonly string[],
  targetSegments: readonly string[],
): PreviewInspectorNextAppRouteParams | undefined {
  const values: Record<string, PreviewInspectorNextAppParamValue> = {};
  let targetOffset = 0;
  for (const [routeOffset, routeSegment] of routeSegments.entries()) {
    const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(routeSegment);
    const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(routeSegment);
    if (catchAll !== null || optionalCatchAll !== null) {
      if (routeOffset !== routeSegments.length - 1) return undefined;
      const name = catchAll?.[1] ?? optionalCatchAll?.[1];
      if (name === undefined) return undefined;
      const remainder = targetSegments.slice(targetOffset).filter(Boolean);
      if (remainder.length === 0) {
        if (optionalCatchAll !== null) continue;
        return undefined;
      }
      values[name] = Object.freeze(remainder);
      targetOffset = targetSegments.length;
      continue;
    }
    const parameter = /^\[([^\]]+)\]$/u.exec(routeSegment)?.[1];
    if (parameter !== undefined) {
      const value = targetSegments[targetOffset];
      if (value === undefined || value.length === 0) return undefined;
      values[parameter] = value;
      targetOffset += 1;
      continue;
    }
    if (targetSegments[targetOffset] !== routeSegment) return undefined;
    targetOffset += 1;
  }
  return Object.freeze(values);
}

/** Distinguishes every supported App Router dynamic segment syntax from a literal anchor. */
function isDynamicRouteSegment(segment: string): boolean {
  return /^\[[^\]]+\]$/u.test(segment) || /^\[\[?\.\.\.[^\]]+\]\]?$/u.test(segment);
}
