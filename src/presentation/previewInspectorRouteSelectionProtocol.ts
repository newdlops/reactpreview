/**
 * Validates route-explorer messages before they can schedule a compiler rebuild.
 *
 * The browser sends only public component and route identities already serialized by the compiler.
 * Filesystem paths, import specifiers, arbitrary URLs, and code are deliberately absent; the next
 * compiler pass must match every step against fresh static evidence before importing a page module.
 */
import type { PreviewInspectorRouteSelectionStep } from '../domain/preview';

// This is a hostile-message envelope, not a compiler graph budget. Authored route analysis itself
// descends until a leaf or source-identity cycle; 256 steps prevents pathological structured-clone
// traffic without truncating realistic nested applications.
const MAXIMUM_ROUTE_SELECTION_DEPTH = 256;
const MAXIMUM_ROUTE_COMPONENT_NAME_LENGTH = 256;
const MAXIMUM_ROUTE_PATTERN_LENGTH = 2_048;
const MAXIMUM_INTERACTION_ID_LENGTH = 128;
const COMPONENT_NAME_PATTERN = /^[$_\p{L}][$_\u200C\u200D\p{ID_Continue}]*$/u;
const INTERACTION_ID_PATTERN = /^route:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/u;
const ROUTE_BRANCH_ID_PATTERN = /^route-[a-f0-9]{20}$/u;

/** Bounded request accepted from one committed Page Inspector runtime. */
export interface PreviewInspectorRouteSelectionRequest {
  /** Public branch identity emitted by the descriptor that offered this path. */
  readonly branchId: string;
  /** Browser-generated id correlating this request with later terminal host status. */
  readonly interactionId: string;
  /** Runtime revision that rendered the offered route hierarchy. */
  readonly runtimeRevision: number;
  /** Ordered root-to-leaf static identities; an empty path restores automatic default selection. */
  readonly selectionPath: readonly PreviewInspectorRouteSelectionStep[];
  /** Exact protocol discriminator. */
  readonly type: 'react-preview-inspector-route-selected';
}

/** Reports whether untrusted traffic claims the route-selection discriminator. */
export function isPreviewInspectorRouteSelectionMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'react-preview-inspector-route-selected'
  );
}

/**
 * Parses one bounded hierarchy path while rejecting URLs, control characters, and extra depth.
 *
 * @param value Untrusted structured-clone value emitted by the preview webview.
 * @returns Frozen route selection, or `undefined` when any field is invalid.
 */
export function readPreviewInspectorRouteSelectionRequest(
  value: unknown,
): PreviewInspectorRouteSelectionRequest | undefined {
  if (!isPreviewInspectorRouteSelectionMessage(value)) return undefined;
  const message = value as Record<string, unknown>;
  const branchId = message.branchId;
  const interactionId = message.interactionId;
  const runtimeRevision = message.runtimeRevision;
  const selectionPath = message.selectionPath;
  if (
    typeof branchId !== 'string' ||
    !ROUTE_BRANCH_ID_PATTERN.test(branchId) ||
    typeof interactionId !== 'string' ||
    interactionId.length === 0 ||
    interactionId.length > MAXIMUM_INTERACTION_ID_LENGTH ||
    !INTERACTION_ID_PATTERN.test(interactionId) ||
    typeof runtimeRevision !== 'number' ||
    !Number.isSafeInteger(runtimeRevision) ||
    runtimeRevision < 0 ||
    !Array.isArray(selectionPath) ||
    selectionPath.length > MAXIMUM_ROUTE_SELECTION_DEPTH
  ) {
    return undefined;
  }
  const normalized: PreviewInspectorRouteSelectionStep[] = [];
  for (const candidate of selectionPath) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return undefined;
    }
    const step = candidate as Record<string, unknown>;
    const componentName = step.componentName;
    const pattern = step.pattern;
    if (
      typeof componentName !== 'string' ||
      componentName.length === 0 ||
      componentName.length > MAXIMUM_ROUTE_COMPONENT_NAME_LENGTH ||
      !COMPONENT_NAME_PATTERN.test(componentName) ||
      typeof pattern !== 'string' ||
      pattern.length === 0 ||
      pattern.length > MAXIMUM_ROUTE_PATTERN_LENGTH ||
      !pattern.startsWith('/') ||
      pattern.startsWith('//') ||
      /[?#\\\u0000-\u001f\u007f]/u.test(pattern)
    ) {
      return undefined;
    }
    normalized.push(Object.freeze({ componentName, pattern }));
  }
  return Object.freeze({
    branchId,
    interactionId,
    runtimeRevision,
    selectionPath: Object.freeze(normalized),
    type: 'react-preview-inspector-route-selected',
  });
}
