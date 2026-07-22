/**
 * Resolves implicit Next App/Pages Router shells behind one authored page candidate.
 *
 * Both router generations encode their outer shell in filesystem conventions rather than a normal
 * page-to-shell import. Centralizing the lookup keeps candidate construction consistent and avoids
 * duplicating parameter refinement, dependency tracking, and completeness semantics.
 */
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import {
  collectRefinedPreviewInspectorNextAppLayoutChain,
  type RefinedPreviewInspectorNextAppLayoutChain,
} from './previewInspectorNextAppParameterEvidence';
import type { PreviewInspectorNextAppRouteLocation } from './previewInspectorNextAppLayoutChain';
import type { PreviewInspectorNextPagesShellRefiner } from './previewInspectorNextPagesParameterEvidence';
import {
  collectPreviewInspectorNextPagesShell,
  type PreviewInspectorNextPagesRouteLocation,
  type PreviewInspectorNextPagesShell,
} from './previewInspectorNextPagesShell';

/** Inputs shared by nearest-owner and render-path candidate construction. */
export interface CollectPreviewInspectorFrameworkPageShellOptions {
  readonly exportName: string;
  readonly nextPagesShellRefiner: PreviewInspectorNextPagesShellRefiner;
  readonly pagePath: string;
  readonly readSource: ReadPreviewInspectorSource;
  /** Exact project resolver used to follow reached `generateStaticParams` collections. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePaths: readonly string[];
}

/** Uniform result consumed without knowing which Next router generation supplied the shell. */
export interface PreviewInspectorFrameworkPageShell {
  readonly dependencyPaths: readonly string[];
  readonly nextAppShell?: RefinedPreviewInspectorNextAppLayoutChain['shell'];
  readonly nextPagesShell?: PreviewInspectorNextPagesShell;
  readonly routeLocation?:
    PreviewInspectorNextAppRouteLocation | PreviewInspectorNextPagesRouteLocation;
}

/** Collects at most one mutually exclusive Next router shell for an exact default page export. */
export async function collectPreviewInspectorFrameworkPageShell(
  options: CollectPreviewInspectorFrameworkPageShellOptions,
): Promise<PreviewInspectorFrameworkPageShell> {
  const nextAppResult = await collectRefinedPreviewInspectorNextAppLayoutChain({
    exportName: options.exportName,
    pagePath: options.pagePath,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePaths: options.sourcePaths,
  });
  if (nextAppResult !== undefined) {
    const dependencies = new Set(nextAppResult.dependencyPaths);
    for (const layout of nextAppResult.shell.layouts) dependencies.add(layout.sourcePath);
    return Object.freeze({
      dependencyPaths: Object.freeze([...dependencies].sort()),
      nextAppShell: nextAppResult.shell,
      routeLocation: nextAppResult.shell.routeLocation,
    });
  }

  const initialPagesShell = collectPreviewInspectorNextPagesShell({
    exportName: options.exportName,
    pagePath: options.pagePath,
    sourcePaths: options.sourcePaths,
  });
  if (initialPagesShell === undefined) {
    return Object.freeze({ dependencyPaths: Object.freeze([]) });
  }
  const refinement = await options.nextPagesShellRefiner.refine(initialPagesShell);
  return Object.freeze({
    dependencyPaths: Object.freeze(
      [refinement.shell.app.sourcePath, ...refinement.dependencyPaths].sort(),
    ),
    nextPagesShell: refinement.shell,
    routeLocation: refinement.shell.routeLocation,
  });
}
