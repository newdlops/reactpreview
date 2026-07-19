/**
 * Prunes unrelated project-owned dynamic imports from a statically proven Page Inspector corridor.
 *
 * A large application root commonly declares hundreds of React.lazy route branches. Esbuild must
 * otherwise emit every branch even though the pinned Inspector session can activate only the
 * candidate paths already proven by static render analysis. This plugin replaces only out-of-path
 * project dynamic imports with inert ESM placeholders. Static imports, installed dependencies,
 * setup entry loading, and every selected target/ancestor module remain untouched.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from '../previewPluginProtocol';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';

const INSPECTOR_CORRIDOR_NAMESPACE = 'react-preview-inspector-corridor';
const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

/** Build inputs required to bound deferred project branches without touching package dependencies. */
export interface PreviewInspectorCorridorPluginOptions {
  /** Static target-to-entry and mount-candidate evidence selected for this Page Inspector build. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** Nearest package root used to distinguish application sources from installed dependencies. */
  readonly projectRoot: string;
  /** Existing compiler-owned resolver; reusing it avoids recursive esbuild resolution per route. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Trusted VS Code workspace that must contain every intercepted project source. */
  readonly workspaceRoot: string;
}

/**
 * Creates one esbuild boundary that keeps only dynamically imported authored corridor modules.
 *
 * @param options Inspector plan plus trusted package/workspace bounds.
 * @returns Build-scoped plugin; omitted modules are never evaluated by the extension or webview.
 */
export function createPreviewInspectorCorridorPlugin(
  options: PreviewInspectorCorridorPluginOptions,
): Plugin {
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const corridorPaths = createPreviewInspectorCorridorPathSet(options.plan);
  const omittedSourcePathByVirtualPath = new Map<string, string>();

  /** Resolves one project dynamic import once, retaining only targets outside the proven corridor. */
  function resolveDeferredBranch(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (
      arguments_.kind !== 'dynamic-import' ||
      (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
      arguments_.importer.length === 0 ||
      !path.isAbsolute(arguments_.importer)
    ) {
      return undefined;
    }
    const canonicalImporter = canonicalizeExistingPath(arguments_.importer);
    if (
      !SOURCE_MODULE_PATTERN.test(canonicalImporter) ||
      !isPathInside(workspaceRoot, canonicalImporter) ||
      !isPathInside(projectRoot, canonicalImporter) ||
      containsDependencyDirectory(projectRoot, canonicalImporter)
    ) {
      return undefined;
    }
    const resolvedPath = options.resolveModule(arguments_.path, arguments_.importer);
    if (resolvedPath === undefined || !SOURCE_MODULE_PATTERN.test(resolvedPath)) {
      return undefined;
    }
    const canonicalTarget = canonicalizeExistingPath(resolvedPath);
    if (
      corridorPaths.has(canonicalTarget) ||
      !isPathInside(workspaceRoot, canonicalTarget) ||
      !isPathInside(projectRoot, canonicalTarget) ||
      containsDependencyDirectory(projectRoot, canonicalTarget)
    ) {
      return undefined;
    }
    const virtualPath = createPreviewInspectorCorridorVirtualPath(canonicalTarget);
    omittedSourcePathByVirtualPath.set(virtualPath, canonicalTarget);
    return {
      namespace: INSPECTOR_CORRIDOR_NAMESPACE,
      path: virtualPath,
      pluginData: { sourcePath: canonicalTarget },
    };
  }

  /** Emits a side-effect-free lazy route placeholder and watches the omitted authored source. */
  function loadDeferredBranch(arguments_: OnLoadArgs): OnLoadResult {
    const sourcePath =
      readPreviewInspectorCorridorSourcePath(arguments_.pluginData) ??
      omittedSourcePathByVirtualPath.get(arguments_.path);
    if (sourcePath === undefined) {
      throw new TypeError('Unknown React Preview deferred corridor module.');
    }
    return {
      contents: [
        '/** Unselected project route omitted from this pinned static Page Inspector corridor. */',
        'function ReactPreviewDeferredCorridorRoute() { return null; }',
        'export default ReactPreviewDeferredCorridorRoute;',
        'export const __reactPreviewDeferredCorridorRoute = ReactPreviewDeferredCorridorRoute;',
      ].join('\n'),
      loader: 'js',
      watchFiles: [sourcePath],
    };
  }

  return {
    name: 'react-preview-inspector-corridor',
    setup(build): void {
      build.onResolve({ filter: /.*/ }, resolveDeferredBranch);
      build.onLoad({ filter: /.*/, namespace: INSPECTOR_CORRIDOR_NAMESPACE }, loadDeferredBranch);
    },
  };
}

/** Collects every normalized source that proves a selectable candidate or render-chain path. */
function createPreviewInspectorCorridorPathSet(
  plan: PreviewInspectorAncestorPlan,
): ReadonlySet<string> {
  const sourcePaths = new Set<string>([
    plan.root.sourcePath,
    plan.target.sourcePath,
    ...plan.dependencyPaths,
    ...plan.pageCandidates.flatMap((candidate) => [
      candidate.root.sourcePath,
      ...candidate.dependencyPaths,
      ...(candidate.renderPath?.steps.map((step) => step.sourcePath) ?? []),
      ...(candidate.renderPath?.entryPoint === undefined
        ? []
        : [candidate.renderPath.entryPoint.sourcePath]),
    ]),
    ...Object.values(plan.renderChainsByExport).flatMap((renderChain) => [
      ...renderChain.dependencyPaths,
      ...renderChain.paths.flatMap((candidate) => [
        ...candidate.steps.map((step) => step.sourcePath),
        ...(candidate.entryPoint === undefined ? [] : [candidate.entryPoint.sourcePath]),
      ]),
    ]),
  ]);
  return new Set([...sourcePaths].map(canonicalizeExistingPath));
}

/** Creates a compact stable custom-namespace path without exposing an absolute path in output. */
function createPreviewInspectorCorridorVirtualPath(sourcePath: string): string {
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
}

/** Reads only compiler-owned custom-namespace metadata. */
function readPreviewInspectorCorridorSourcePath(pluginData: unknown): string | undefined {
  if (pluginData === null || typeof pluginData !== 'object') return undefined;
  const sourcePath = (pluginData as Record<string, unknown>).sourcePath;
  return typeof sourcePath === 'string' ? sourcePath : undefined;
}

/** Checks trusted-root containment while rejecting sibling-prefix lookalikes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Leaves installed or vendored dependency graphs under their normal package runtime semantics. */
function containsDependencyDirectory(rootPath: string, candidatePath: string): boolean {
  return path
    .relative(rootPath, candidatePath)
    .split(path.sep)
    .some((segment) => segment === 'node_modules');
}
