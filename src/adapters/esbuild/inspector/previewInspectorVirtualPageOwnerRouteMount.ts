/** Preserves source-proven nested mounts while adding a derived outer VirtualPage owner. */
import path from 'node:path';
import type {
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorTypes';
import type { PreviewInspectorRouteMountEvidence } from './previewInspectorRouteLocationTypes';
import type { PreviewInspectorMountSurface } from './previewInspectorPageExecutionTypes';
import type { PreviewInspectorVirtualPageCandidate } from './previewInspectorVirtualPagePlan';
import { collectPreviewInspectorRouteFactoryChoices } from './previewInspectorRouteFactoryChoices';
import { readSource } from './previewInspectorPageExecutionSurfaceEvidence';
import {
  localizePreviewInspectorRoutePathname,
  relativizePreviewInspectorRoutePattern,
} from './previewInspectorRoutePatternMatch';

interface PreviewInspectorDerivedOwnerRouteMount {
  readonly evidence: PreviewInspectorRouteMountEvidence;
  readonly surface: PreviewInspectorMountSurface;
}

/**
 * Recovers the outer Route context from the exact authentic factory owner already selected as a
 * VirtualPage shell. A leaf catalog can name an inner owner while the rendered composition begins
 * at an outer factory shell; mounting that shell at the inner base makes its relative Routes miss.
 */
export function collectVirtualPageOwnerRouteMount(
  candidate: PreviewInspectorPageCandidate,
  virtualPage: PreviewInspectorVirtualPageCandidate,
  shellSurfaces: readonly PreviewInspectorMountSurface[],
): PreviewInspectorDerivedOwnerRouteMount | undefined {
  const location = candidate.routeLocation;
  if (
    location === undefined ||
    (location.evidenceKind !== 'route-catalog' && location.evidenceKind !== 'route-jsx')
  ) {
    return undefined;
  }
  for (let index = virtualPage.recipe.shells.length - 1; index >= 0; index -= 1) {
    const shell = virtualPage.recipe.shells[index];
    const surface = shellSurfaces[index];
    if (shell?.relation !== 'owner' || surface === undefined) continue;
    const sourceText = readSource(surface.sourcePath);
    if (sourceText === undefined) continue;
    const owner = collectPreviewInspectorRouteFactoryChoices({
      sourcePath: surface.sourcePath,
      sourceText,
      targetIdentities: new Set([surface.exportName]),
    }).owner;
    if (
      owner === undefined ||
      owner.routeSlotCount === 0 ||
      path.normalize(owner.sourcePath) !== path.normalize(surface.sourcePath) ||
      owner.exportName !== surface.exportName ||
      relativizePreviewInspectorRoutePattern(owner.basePath, location.pattern) === undefined ||
      localizePreviewInspectorRoutePathname(owner.basePath, location.pathname) === undefined
    ) {
      continue;
    }
    return Object.freeze({
      evidence: Object.freeze({
        basePath: owner.basePath,
        contextOrigin: 'virtual-page-owner' as const,
        contextPattern: createVirtualPageOwnerContextPattern(owner.basePath),
        exportName: owner.exportName,
        hasWildcardFallback: owner.hasWildcardFallback,
        routeSlotCount: owner.routeSlotCount,
        sourcePath: path.normalize(owner.sourcePath),
      }),
      surface,
    });
  }
  return undefined;
}

/** Adds a trailing splat so the owner's own relative Routes receive the unmatched child path. */
function createVirtualPageOwnerContextPattern(basePath: string): string {
  if (/(?:^|\/)\*$/u.test(basePath)) return basePath;
  const normalized = basePath === '/' ? '' : basePath.replace(/\/+$/u, '');
  return `${normalized}/*`;
}

/**
 * Publishes derived owner evidence on the compiler-owned browser candidate as well as the recipe.
 * Runtime ownership validation can therefore compare the generated mount against immutable input
 * evidence instead of trusting a PageExecution-only edge.
 */
export function attachVirtualPageOwnerRouteMount(
  candidate: PreviewInspectorPageCandidate & {
    readonly target: PreviewInspectorComponentReference;
  },
  mount: PreviewInspectorDerivedOwnerRouteMount | undefined,
): PreviewInspectorPageCandidate & { readonly target: PreviewInspectorComponentReference } {
  if (mount === undefined) return candidate;
  const location = candidate.routeLocation;
  if (
    location === undefined ||
    (location.evidenceKind !== 'route-catalog' && location.evidenceKind !== 'route-jsx')
  ) {
    return candidate;
  }
  const sourcePath = path.normalize(mount.evidence.sourcePath);
  const dependencyPaths = Object.freeze(
    [...new Set([...candidate.dependencyPaths, sourcePath])].sort(),
  );
  return Object.freeze({
    ...candidate,
    dependencyPaths,
    routeLocation: Object.freeze({
      ...location,
      dependencyPaths: Object.freeze(
        [...new Set([...location.dependencyPaths, sourcePath])].sort(),
      ),
      routeMounts: mergeVirtualPageOwnerRouteMounts(location.routeMounts ?? [], mount.evidence),
    }),
  });
}

/** Keeps existing route proof authoritative; only a distinct, strict outer prefix is prepended. */
export function mergeVirtualPageOwnerRouteMounts(
  existing: readonly PreviewInspectorRouteMountEvidence[],
  owner: PreviewInspectorRouteMountEvidence,
): readonly PreviewInspectorRouteMountEvidence[] {
  if (existing.length === 0) return Object.freeze([owner]);
  if (
    existing.some(
      (mount) =>
        path.normalize(mount.sourcePath) === path.normalize(owner.sourcePath) &&
        mount.exportName === owner.exportName,
    )
  )
    return existing;
  const first = existing[0];
  const relative =
    first === undefined
      ? undefined
      : relativizePreviewInspectorRoutePattern(owner.basePath, first.basePath);
  return relative === undefined || relative.length === 0
    ? existing
    : Object.freeze([owner, ...existing]);
}
