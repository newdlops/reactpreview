/**
 * Reconnects a Next.js Pages Router `_app` to the authored pages injected as `Component`.
 *
 * There is deliberately no JavaScript import edge from `_app` to a route page. This adapter turns
 * that filesystem-owned relationship into bounded, independently lazy Page Inspector candidates.
 * It also works when reverse traversal reaches `_app` from a shared shell component, allowing the
 * selected component to be shown in the context of a real consuming page.
 */
import path from 'node:path';
import { freezePreviewInspectorPageCandidate } from './previewInspectorAncestorFreezing';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import { collectPreviewInspectorNextPagesAppTargets } from './previewInspectorNextPagesAppTarget';
import type { PreviewInspectorNextPagesShellRefiner } from './previewInspectorNextPagesParameterEvidence';

const NEXT_PAGES_APP_PATTERN = /^_app\.[cm]?[jt]sx?$/iu;

/** Bounded inputs shared with the ancestor planner's already-created analysis caches. */
export interface CollectPreviewInspectorNextPagesDescendantPagesOptions {
  /** Nearest candidate whose root may be the framework-owned `_app` module. */
  readonly base: PreviewInspectorPageCandidate;
  /** Strict maximum number of real pages exposed in the selector. */
  readonly maximumCount: number;
  /** Cached route refiner used for dynamic pathname evidence. */
  readonly nextPagesShellRefiner: PreviewInspectorNextPagesShellRefiner;
  /** Dirty-editor-aware inert source reader used to prove default page exports. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Existing bounded source inventory; this adapter performs no filesystem walk. */
  readonly sourcePaths: readonly string[];
}

/**
 * Produces real page compositions below `_app`, or one explicit synthetic page as a last resort.
 * The original `_app` candidate is never returned because mounting it without `Component` is an
 * invalid application state that leads to the blank/error page seen in preview logs.
 */
export async function collectPreviewInspectorNextPagesDescendantPages(
  options: CollectPreviewInspectorNextPagesDescendantPagesOptions,
): Promise<readonly PreviewInspectorPageCandidate[]> {
  const appPath = path.normalize(options.base.root.sourcePath);
  if (
    options.maximumCount <= 0 ||
    options.base.root.exportName !== 'default' ||
    !NEXT_PAGES_APP_PATTERN.test(path.basename(appPath)) ||
    path.basename(path.dirname(appPath)).toLowerCase() !== 'pages'
  ) {
    return Object.freeze([]);
  }

  const targets = await collectPreviewInspectorNextPagesAppTargets({
    appPath,
    exportName: 'default',
    maximumCount: options.maximumCount,
    readSource: options.readSource,
    sourcePaths: options.sourcePaths,
  });
  return Object.freeze(
    await Promise.all(
      targets.map(async (target) => {
        const refinement = await options.nextPagesShellRefiner.refine(target.shell);
        const root =
          target.kind === 'authored-page'
            ? Object.freeze({ exportName: 'default', sourcePath: target.page.sourcePath })
            : options.base.root;
        const dependencies = new Set(options.base.dependencyPaths);
        dependencies.add(appPath);
        dependencies.add(root.sourcePath);
        for (const dependencyPath of refinement.dependencyPaths) dependencies.add(dependencyPath);
        return freezePreviewInspectorPageCandidate({
          complete: true,
          dependencies,
          edges: options.base.edges,
          id: `next-pages-descendant:${root.sourcePath}`,
          renderPath: options.base.renderPath,
          root,
          rootAutomaticProps: Object.freeze({}),
          ...(target.kind === 'synthetic-page' && options.base.rootInference !== undefined
            ? { rootInference: options.base.rootInference }
            : {}),
          nextPagesShell: refinement.shell,
          rootOwnsRouter: false,
          routeLocation: refinement.shell.routeLocation,
          stopReason: 'root-reached',
          targetAutomaticProps: options.base.targetAutomaticProps,
        });
      }),
    ),
  );
}
