/**
 * Exposes one actual authored ancestor through the existing preview target descriptor contract.
 * Page Inspector builds use this bridge instead of the ordinary export gallery bridge, allowing
 * the browser entry to stay unchanged while the mounted value includes real siblings/dynamics.
 */
import path from 'node:path';
import type { OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_INSPECTOR_ROOT_NAMESPACE,
  PREVIEW_TARGET_SPECIFIER,
} from '../previewPluginProtocol';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import { PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER } from './previewInspectorTargetPlugin';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';

const INSPECTOR_ROOT_PATH = 'selected-ancestor-root';

/** Inputs required to expose one inspector plan as a preview target descriptor. */
export interface PreviewInspectorRootPluginOptions {
  /** User-facing name of the originally selected export. */
  readonly displayName?: string;
  /** Bounded real-owner plan produced from current editor-or-disk source. */
  readonly plan: PreviewInspectorAncestorPlan;
  /** Neutral target props inferred without evaluating the selected project module. */
  readonly targetInference?: PreviewInferredExportProps;
}

/**
 * Creates a virtual `react-preview:target` module importing the plan's real owner export.
 *
 * `watchFiles` contains the entire selected ancestry so saved source changes trigger esbuild's
 * rebuild pipeline even before the module graph changes shape. Dirty snapshot refresh remains
 * controlled by the existing preview panel dependency watcher.
 *
 * @param options Inspector ancestor plan and optional source label.
 * @returns Build-scoped bridge plugin used in place of the normal target gallery bridge.
 */
export function createPreviewInspectorRootPlugin(
  options: PreviewInspectorRootPluginOptions,
): Plugin {
  /** Resolves only the target specifier already imported by the generated browser entry. */
  function resolveInspectorRoot(arguments_: OnResolveArgs): OnResolveResult | undefined {
    return arguments_.path === PREVIEW_TARGET_SPECIFIER
      ? { namespace: PREVIEW_INSPECTOR_ROOT_NAMESPACE, path: INSPECTOR_ROOT_PATH }
      : undefined;
  }

  /** Loads a single-descriptor bridge and associates its full ancestry with watch mode. */
  function loadInspectorRoot(): OnLoadResult {
    return {
      contents: createPreviewInspectorRootSource({
        ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
        plan: options.plan,
        ...(options.targetInference === undefined
          ? {}
          : { targetInference: options.targetInference }),
      }),
      loader: 'js',
      resolveDir: path.dirname(options.plan.root.sourcePath),
      watchFiles: [...options.plan.dependencyPaths],
    };
  }

  return {
    name: 'react-preview-inspector-root',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:target$/ }, resolveInspectorRoot);
      build.onLoad(
        { filter: /^selected-ancestor-root$/, namespace: PREVIEW_INSPECTOR_ROOT_NAMESPACE },
        loadInspectorRoot,
      );
    },
  };
}

/** Pure source generator inputs used by plugin and bridge contract tests. */
export interface PreviewInspectorRootSourceOptions {
  readonly displayName?: string;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly targetInference?: PreviewInferredExportProps;
}

/**
 * Generates the target descriptor for an authored inspector root without loading its value.
 *
 * When root and target share a module, the import intentionally points at the instrumentation
 * facade. Otherwise the real ancestor imports its descendant normally and the target interceptor
 * replaces the nested target edge wherever it is resolved.
 *
 * @param options Inspector plan and optional original export display label.
 * @returns Executable ESM source satisfying the existing preview entry target contract.
 */
export function createPreviewInspectorRootSource(
  options: PreviewInspectorRootSourceOptions,
): string {
  const { plan } = options;
  assertExportName(plan.root.exportName);
  const rootIsTarget =
    path.normalize(plan.root.sourcePath) === path.normalize(plan.target.sourcePath);
  const rootSpecifier = rootIsTarget
    ? PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER
    : plan.root.sourcePath.replaceAll('\\', '/');
  const importLine =
    plan.root.exportName === 'default'
      ? `import __reactPreviewInspectorRoot from ${JSON.stringify(rootSpecifier)};`
      : `import { ${plan.root.exportName} as __reactPreviewInspectorRoot } from ${JSON.stringify(rootSpecifier)};`;
  const descriptor = {
    automaticProps: plan.rootAutomaticProps,
    displayName: options.displayName ?? plan.target.exportName,
    exportName: plan.target.exportName,
    ...(rootIsTarget && options.targetInference !== undefined
      ? {
          inferredPropShape: options.targetInference.shape,
          inferredProps: options.targetInference.provenance,
        }
      : {}),
    inspector: {
      ancestry: plan.edges,
      complete: plan.complete,
      renderChain: plan.renderChain,
      renderChainsByExport: plan.renderChainsByExport,
      root: plan.root,
      stopReason: plan.stopReason,
      target: plan.target,
      targetAutomaticProps: plan.targetAutomaticProps,
      targetInferredProps: options.targetInference?.provenance ?? [],
    },
  };

  return [
    importLine,
    `const __reactPreviewInspectorDescriptor = ${JSON.stringify(descriptor)};`,
    '__reactPreviewInspectorDescriptor.value = __reactPreviewInspectorRoot;',
    'export const previewTheme = undefined;',
    'export default Object.freeze([Object.freeze(__reactPreviewInspectorDescriptor)]);',
  ].join('\n');
}

/** Rejects names that cannot be emitted in an ECMAScript named import clause. */
function assertExportName(exportName: string): void {
  if (
    exportName !== 'default' &&
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
  ) {
    throw new TypeError(`Invalid React preview inspector root export name: ${exportName}`);
  }
}
