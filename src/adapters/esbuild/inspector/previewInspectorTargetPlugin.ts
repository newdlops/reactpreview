/**
 * Intercepts imports of the selected target module for Page Inspector instrumentation.
 * The generated facade preserves every original export and replaces only selected React exports,
 * allowing a nested target to register DOM highlights and accept runtime prop overrides.
 */
import path from 'node:path';
import type { OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { matchesPreviewParentSliceTargetImport } from '../parentSlice/previewParentSliceImports';
import { PREVIEW_INSPECTOR_TARGET_NAMESPACE } from '../previewPluginProtocol';
import type { PreviewInferredPropsByExport } from '../staticResources/reactExportPropInference';

const INSPECTOR_TARGET_FACADE_PATH = 'selected-target-facade';
const INSPECTOR_ORIGINAL_TARGET_SPECIFIER = 'react-preview:inspector-original-target';
const INSPECTOR_RESOLUTION_GUARD = 'reactPreviewInspectorResolutionGuard';

/** Default virtual runtime contract consumed by the generated target facade. */
export const PREVIEW_INSPECTOR_RUNTIME_SPECIFIER = 'react-preview:inspector-runtime';
/** Direct facade import used when the selected target is itself the inspector mount root. */
export const PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER = 'react-preview:inspector-target-facade';

/** Metadata passed to the browser-side target wrapper without evaluating project code. */
export interface PreviewInspectorTargetMetadata {
  readonly exportName: string;
  readonly sourcePath: string;
}

/** Inputs for exact target import interception in one Page Inspector build. */
export interface PreviewInspectorTargetPluginOptions {
  /** Exact aliases resolved from the active tsconfig/package graph, when available. */
  readonly acceptedTargetImportSpecifiers?: readonly string[];
  /** Absolute editor-selected target module. */
  readonly documentPath: string;
  /** Explicit target exports to wrap while preserving every other module export. */
  readonly exportNames: readonly string[];
  /** Whether the authored target declares a default export that the facade must preserve. */
  readonly originalHasDefaultExport: boolean;
  /** Data-only fallback shapes associated with exact selected runtime exports. */
  readonly inferredPropsByExport?: PreviewInferredPropsByExport;
  /** Optional private runtime specifier, primarily useful to isolated compiler tests. */
  readonly runtimeSpecifier?: string;
}

/**
 * Creates an esbuild facade that is substituted anywhere the selected module is imported.
 *
 * The private original-target edge resolves directly into the `file` namespace, preventing facade
 * recursion while still allowing the ordinary workspace snapshot/transform loader to own source
 * loading. The plugin should be registered before generic project resolvers.
 *
 * @param options Selected source identity, exports, aliases, and runtime module contract.
 * @returns Build-scoped interceptor with no application module evaluation in the extension host.
 */
export function createPreviewInspectorTargetPlugin(
  options: PreviewInspectorTargetPluginOptions,
): Plugin {
  assertPluginOptions(options);
  const documentPath = path.normalize(options.documentPath);
  const canonicalDocumentPath = canonicalizeExistingPath(documentPath);
  const targetModuleStem = path.basename(documentPath).replace(/\.[^.]+$/u, '');
  const selectedExportNames = Object.freeze([...new Set(options.exportNames)]);
  const acceptedSpecifiers = new Set(options.acceptedTargetImportSpecifiers ?? []);
  const runtimeSpecifier = options.runtimeSpecifier ?? PREVIEW_INSPECTOR_RUNTIME_SPECIFIER;

  /** Redirects exact authored target imports while preserving a private non-recursive edge. */
  function resolveTargetImport(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (
      arguments_.namespace === PREVIEW_INSPECTOR_TARGET_NAMESPACE &&
      arguments_.path === INSPECTOR_ORIGINAL_TARGET_SPECIFIER
    ) {
      return { namespace: 'file', path: documentPath };
    }
    if (arguments_.path === PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER) {
      return {
        namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE,
        path: INSPECTOR_TARGET_FACADE_PATH,
      };
    }
    if (
      arguments_.importer.length === 0 ||
      !path.isAbsolute(arguments_.importer) ||
      (arguments_.namespace === 'file' && path.normalize(arguments_.importer) === documentPath) ||
      !matchesPreviewParentSliceTargetImport(
        arguments_.path,
        arguments_.importer,
        documentPath,
        acceptedSpecifiers,
      )
    ) {
      return undefined;
    }
    return {
      namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE,
      path: INSPECTOR_TARGET_FACADE_PATH,
    };
  }

  /** Supplies the stable facade shared by all importers in this inspector bundle. */
  function loadTargetFacade(): OnLoadResult {
    return {
      contents: createPreviewInspectorTargetFacadeSource({
        exportNames: selectedExportNames,
        originalHasDefaultExport: options.originalHasDefaultExport,
        ...(options.inferredPropsByExport === undefined
          ? {}
          : { inferredPropsByExport: options.inferredPropsByExport }),
        runtimeSpecifier,
        sourcePath: documentPath,
      }),
      loader: 'js',
      resolveDir: path.dirname(documentPath),
    };
  }

  return {
    name: 'react-preview-inspector-target',
    setup(build): void {
      build.onResolve({ filter: /.*/ }, resolveTargetImport);
      /**
       * Resolves aliases through esbuild's configured tsconfig/package graph, then substitutes the
       * facade only when that canonical result is the selected file. Returning non-target results
       * avoids performing the same default resolution twice during this Inspector-only build.
       */
      build.onResolve({ filter: /.*/ }, async (arguments_) => {
        if (
          arguments_.importer.length === 0 ||
          !path.isAbsolute(arguments_.importer) ||
          hasInspectorResolutionGuard(arguments_.pluginData) ||
          !mayResolveToInspectorTarget(arguments_.path, targetModuleStem)
        ) {
          return undefined;
        }
        const resolution = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: arguments_.namespace,
          pluginData: addInspectorResolutionGuard(arguments_.pluginData),
          resolveDir: arguments_.resolveDir,
          with: arguments_.with,
        });
        if (
          resolution.namespace === 'file' &&
          resolution.path.length > 0 &&
          canonicalizeExistingPath(resolution.path) === canonicalDocumentPath
        ) {
          return {
            namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE,
            path: INSPECTOR_TARGET_FACADE_PATH,
          };
        }
        return resolution;
      });
      build.onLoad(
        { filter: /^selected-target-facade$/, namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE },
        loadTargetFacade,
      );
    },
  };
}

/** Limits guarded esbuild alias resolution to imports whose path still names the target module. */
function mayResolveToInspectorTarget(moduleSpecifier: string, targetModuleStem: string): boolean {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
  return cleanSpecifier.split('/').some((segment) => {
    const segmentStem = segment.replace(/\.[^.]+$/u, '');
    return segmentStem === targetModuleStem;
  });
}

/** Marks one nested `build.resolve` call so the Inspector resolver cannot recurse into itself. */
function addInspectorResolutionGuard(pluginData: unknown): Record<string, unknown> {
  return {
    ...(pluginData !== null && typeof pluginData === 'object' ? pluginData : {}),
    [INSPECTOR_RESOLUTION_GUARD]: true,
  };
}

/** Detects the private recursion marker without trusting project-owned plugin data prototypes. */
function hasInspectorResolutionGuard(pluginData: unknown): boolean {
  return (
    pluginData !== null &&
    typeof pluginData === 'object' &&
    Object.prototype.hasOwnProperty.call(pluginData, INSPECTOR_RESOLUTION_GUARD) &&
    (pluginData as Record<string, unknown>)[INSPECTOR_RESOLUTION_GUARD] === true
  );
}

/** Inputs for the pure facade source generator used by plugin and unit tests. */
export interface PreviewInspectorTargetFacadeSourceOptions {
  readonly exportNames: readonly string[];
  readonly originalHasDefaultExport: boolean;
  readonly inferredPropsByExport?: PreviewInferredPropsByExport;
  readonly runtimeSpecifier?: string;
  readonly sourcePath: string;
}

/**
 * Generates a complete module facade with explicit selected-export precedence over `export *`.
 *
 * The browser runtime owns component validation, non-DOM marker boundaries, subscriptions, and
 * merged prop overrides. Keeping those behaviors outside this facade makes the build-time boundary
 * independent of React versions and prevents source rewriting of the selected application module.
 *
 * @param options Selected export names, target path, and private runtime module specifier.
 * @returns Executable ESM source that preserves non-selected original exports.
 */
export function createPreviewInspectorTargetFacadeSource(
  options: PreviewInspectorTargetFacadeSourceOptions,
): string {
  const exportNames = [...new Set(options.exportNames)];
  for (const exportName of exportNames) {
    assertExportName(exportName);
  }
  const runtimeSpecifier = options.runtimeSpecifier ?? PREVIEW_INSPECTOR_RUNTIME_SPECIFIER;
  const selectedDefault = exportNames.includes('default');
  if (selectedDefault && !options.originalHasDefaultExport) {
    throw new TypeError('Preview inspector cannot select an absent original default export.');
  }
  const namedExports = exportNames.filter((exportName) => exportName !== 'default');
  const lines = [
    `import * as __reactPreviewOriginal from ${JSON.stringify(INSPECTOR_ORIGINAL_TARGET_SPECIFIER)};`,
    `import { wrapPreviewInspectorTarget as __reactPreviewWrap } from ${JSON.stringify(runtimeSpecifier)};`,
    `export * from ${JSON.stringify(INSPECTOR_ORIGINAL_TARGET_SPECIFIER)};`,
  ];

  for (const [index, exportName] of namedExports.entries()) {
    lines.push(
      `const __reactPreviewSelected${index.toString()} = /* @__PURE__ */ __reactPreviewWrap(__reactPreviewOriginal[${JSON.stringify(exportName)}], ${serializeMetadata(options.sourcePath, exportName, options.inferredPropsByExport?.[exportName])});`,
      `export { __reactPreviewSelected${index.toString()} as ${exportName} };`,
    );
  }
  if (selectedDefault) {
    lines.push(
      `export default /* @__PURE__ */ __reactPreviewWrap(__reactPreviewOriginal.default, ${serializeMetadata(options.sourcePath, 'default', options.inferredPropsByExport?.default)});`,
    );
  } else if (options.originalHasDefaultExport) {
    lines.push('export default __reactPreviewOriginal.default;');
  }
  return lines.join('\n');
}

/** Serializes immutable target identity supplied to the inspector runtime registry. */
function serializeMetadata(
  sourcePath: string,
  exportName: string,
  inference: PreviewInferredPropsByExport[string] | undefined,
): string {
  return JSON.stringify({
    exportName,
    ...(inference === undefined
      ? {}
      : { inferredPropShape: inference.shape, inferredProps: inference.provenance }),
    sourcePath: path.normalize(sourcePath),
  });
}

/** Validates plugin boundaries before installing broad esbuild resolver callbacks. */
function assertPluginOptions(options: PreviewInspectorTargetPluginOptions): void {
  if (!path.isAbsolute(options.documentPath)) {
    throw new RangeError('Preview inspector target path must be absolute.');
  }
  if (options.exportNames.length === 0) {
    throw new TypeError('Preview inspector requires at least one explicit target export.');
  }
  for (const exportName of options.exportNames) {
    assertExportName(exportName);
  }
  if (options.exportNames.includes('default') && !options.originalHasDefaultExport) {
    throw new TypeError('Preview inspector cannot select an absent original default export.');
  }
}

/** Rejects names that cannot appear in a generated ECMAScript export clause. */
function assertExportName(exportName: string): void {
  if (
    exportName !== 'default' &&
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
  ) {
    throw new TypeError(`Invalid React preview inspector export name: ${exportName}`);
  }
}
