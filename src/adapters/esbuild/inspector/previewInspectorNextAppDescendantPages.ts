/**
 * Reconnects a Next.js App Router layout to the ordinary descendant pages it implicitly wraps.
 *
 * Next does not represent `layout -> page` as a JavaScript import: the framework inserts each
 * page into the nearest layout/template `children` slot. Reverse-import discovery therefore stops
 * at a selected shell wrapper (or at a helper used only by it) unless this filesystem edge is
 * added explicitly. This adapter remains convention-bounded and never evaluates Next config.
 */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { freezePreviewInspectorPageCandidate } from './previewInspectorAncestorFreezing';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import {
  collectPreviewInspectorNextAppLayoutChain,
  type PreviewInspectorNextAppLayoutChain,
} from './previewInspectorNextAppLayoutChain';
import { collectRefinedPreviewInspectorNextAppLayoutChain } from './previewInspectorNextAppParameterEvidence';

const NEXT_APP_SHELL_PATTERN = /^(?:layout|template)\.[cm]?[jt]sx?$/iu;
const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;

/** Inputs kept independent from graph parsing so discovery can reuse the bounded source inventory. */
export interface CollectPreviewInspectorNextAppDescendantPagesOptions {
  /** Existing nearest-owner candidate whose root may be an implicit layout or template. */
  readonly base: PreviewInspectorPageCandidate;
  /** Maximum selectable leaves retained after deterministic nearest-page ranking. */
  readonly maximumCount: number;
  /** Reads the selected leaf only when `generateStaticParams` may refine a dynamic pathname. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Project-aware resolver for imported static route parameter registries. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Package-local inventory already collected by the compiler; no new filesystem walk occurs. */
  readonly sourcePaths: readonly string[];
}

/** One proven ordinary page and the complete layout shell that will mount it. */
interface DescendantPageEvidence {
  readonly pagePath: string;
  readonly shell: PreviewInspectorNextAppLayoutChain;
}

/**
 * Creates independently selectable page candidates below one selected App Router shell wrapper.
 *
 * Parallel and intercepted branches are rejected by the shared layout-chain analyzer because a
 * lone named slot cannot truthfully stand in for Next's simultaneously active route tree.
 */
export function collectPreviewInspectorNextAppDescendantPages(
  options: CollectPreviewInspectorNextAppDescendantPagesOptions,
): Promise<readonly PreviewInspectorPageCandidate[]> {
  const shellPath = path.normalize(options.base.root.sourcePath);
  if (
    options.base.root.exportName !== 'default' ||
    !NEXT_APP_SHELL_PATTERN.test(path.basename(shellPath)) ||
    options.maximumCount <= 0
  ) {
    return Promise.resolve(Object.freeze([]));
  }

  const shellDirectory = path.dirname(shellPath);
  const evidence = [...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath)))]
    .filter((sourcePath) => isDescendantPage(shellDirectory, sourcePath))
    .map((pagePath): DescendantPageEvidence | undefined => {
      const shell = collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath,
        sourcePaths: options.sourcePaths,
      });
      return shell?.layouts.some((layout) => path.normalize(layout.sourcePath) === shellPath) ===
        true
        ? { pagePath, shell }
        : undefined;
    })
    .filter((item): item is DescendantPageEvidence => item !== undefined)
    .sort((left, right) => compareDescendantPages(shellDirectory, left.pagePath, right.pagePath))
    .slice(0, options.maximumCount);

  return Promise.all(
    evidence.map(async ({ pagePath, shell: initialShell }) => {
      const refinement = await collectRefinedPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath,
        readSource: options.readSource,
        ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
        sourcePaths: options.sourcePaths,
      });
      const shell = refinement?.shell ?? initialShell;
      const dependencies = new Set(options.base.dependencyPaths);
      dependencies.add(pagePath);
      for (const dependencyPath of refinement?.dependencyPaths ?? []) {
        dependencies.add(dependencyPath);
      }
      for (const layout of shell.layouts) dependencies.add(layout.sourcePath);
      return freezePreviewInspectorPageCandidate({
        complete: true,
        dependencies,
        edges: options.base.edges,
        id: `next-app-descendant:${pagePath}`,
        renderPath: options.base.renderPath,
        root: Object.freeze({ exportName: 'default', sourcePath: pagePath }),
        rootAutomaticProps: Object.freeze({}),
        nextAppLayoutChain: shell.layouts,
        rootOwnsRouter: false,
        routeLocation: shell.routeLocation,
        stopReason: 'root-reached',
        targetAutomaticProps: options.base.targetAutomaticProps,
      });
    }),
  ).then((candidates) => Object.freeze(candidates));
}

/** Accepts only exact page modules strictly below the selected layout directory. */
function isDescendantPage(layoutDirectory: string, sourcePath: string): boolean {
  if (!NEXT_APP_PAGE_PATTERN.test(path.basename(sourcePath))) return false;
  const relative = path.relative(layoutDirectory, sourcePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Prefers the closest route leaf, then a stable lexical path for repeated builds. */
function compareDescendantPages(layoutDirectory: string, left: string, right: string): number {
  const depth = (sourcePath: string): number =>
    path.relative(layoutDirectory, path.dirname(sourcePath)).split(path.sep).filter(Boolean).length;
  return depth(left) - depth(right) || left.localeCompare(right);
}
