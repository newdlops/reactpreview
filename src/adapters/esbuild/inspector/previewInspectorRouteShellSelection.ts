/** Preserves proven page chrome unless a live authored route owner already renders it. */
import path from 'node:path';
import type { PreviewInspectorMountSurface } from './previewInspectorPageExecutionTypes';
import type { PreviewInspectorVirtualPageShell } from './previewInspectorVirtualPagePlan';

interface RouteShellSelectionOptions {
  /** True only for retained authored route surfaces, never a generated MemoryRouter. */
  readonly hasAuthoredRouteOwner: boolean;
  /** The exact implicit factory owner retained by the route execution recipe. */
  readonly ownerSurface?: PreviewInspectorMountSurface;
  /** Already composed route/layout surfaces, used to avoid duplicate wrappers. */
  readonly routeCompositionSurfaces: readonly PreviewInspectorMountSurface[];
  /** Compiler-proven outer frame relationships; no new sources are admitted here. */
  readonly shells: readonly PreviewInspectorVirtualPageShell[];
  /** Importable surfaces corresponding to those frame relationships. */
  readonly surfaces: readonly PreviewInspectorMountSurface[];
}

/**
 * A synthetic route supplies location, not page chrome. Keep the proven sibling frame when no
 * authored owner replaces it; otherwise preserve the owner and non-duplicated layout wrappers.
 * Input order is retained so before/after placement remains identical to the authored recipe.
 */
export function selectPreviewInspectorRouteShellSurfaces(
  options: RouteShellSelectionOptions,
): readonly PreviewInspectorMountSurface[] {
  const composed = new Set(options.routeCompositionSurfaces.map(surfaceKey));
  const ownerKey =
    options.ownerSurface === undefined ? undefined : surfaceKey(options.ownerSurface);
  const relations = new Map(
    options.shells.map((shell) => [surfaceKey(shell.root), shell.relation]),
  );
  return Object.freeze(
    options.surfaces.filter((surface) => {
      const identity = surfaceKey(surface);
      if (identity === ownerKey) return true;
      if (composed.has(identity)) return false;
      const relation = relations.get(identity);
      return (
        relation === 'wrapper' ||
        (!options.hasAuthoredRouteOwner && ownerKey === undefined && relation === 'sibling')
      );
    }),
  );
}

/** Uses exact source/export identity, not filenames or visual labels, for de-duplication. */
function surfaceKey(surface: { readonly exportName: string; readonly sourcePath: string }): string {
  return `${path.normalize(surface.sourcePath)}\0${surface.exportName}`;
}
