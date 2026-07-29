/** Rejects authored static edges that escaped a frozen automatic Inspector frontier. */
import path from 'node:path';
import type { OnResolveArgs, OnResolveResult, PluginBuild } from 'esbuild';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { createPreviewInspectorFrontierMismatchEvidence } from './previewInspectorFrontierMismatchEvidence';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { PREVIEW_RESOLVE_GUARD } from '../previewPluginProtocol';

const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

export interface PreviewInspectorBundleFrontierGuardOptions {
  readonly authenticSourcePaths: ReadonlySet<string>;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly workspaceRoot: string;
}

/** Registers a last-resort guard after corridor projections have had first chance to resolve. */
export function registerPreviewInspectorBundleFrontierGuard(
  build: PluginBuild,
  options: PreviewInspectorBundleFrontierGuardOptions,
): void {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  build.onResolve({ filter: /.*/ }, (arguments_: OnResolveArgs): OnResolveResult | undefined => {
    if (
      arguments_.kind !== 'import-statement' ||
      (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
      !path.isAbsolute(arguments_.importer)
    )
      return undefined;
    const importer = canonicalizeExistingPath(arguments_.importer);
    if (!options.authenticSourcePaths.has(importer)) return undefined;
    const resolved = options.resolveModule(arguments_.path, importer);
    if (
      resolved === undefined ||
      !SOURCE_MODULE_PATTERN.test(resolved) ||
      !isAuthoredWorkspacePath(workspaceRoot, resolved) ||
      options.authenticSourcePaths.has(canonicalizeExistingPath(resolved))
    )
      return undefined;
    return {
      errors: [
        {
          detail: createPreviewInspectorFrontierMismatchEvidence({
            cause: 'guard-escape',
            importerPath: importer,
            moduleSpecifier: arguments_.path,
            sourcePath: canonicalizeExistingPath(resolved),
            workspaceRoot,
          }),
          text: `React Preview frontier mismatch: ${arguments_.path} escaped the planned authored bundle.`,
        },
      ],
    };
  });
}

/** Ensures packages and generated modules remain outside authored frontier enforcement. */
function isAuthoredWorkspacePath(workspaceRoot: string, sourcePath: string): boolean {
  const relative = path.relative(workspaceRoot, canonicalizeExistingPath(sourcePath));
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.split(path.sep).includes('node_modules')
  );
}
