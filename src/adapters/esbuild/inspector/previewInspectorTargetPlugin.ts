/**
 * Intercepts imports of the selected target module for Page Inspector instrumentation.
 * The generated facade preserves every original export and replaces only selected React exports,
 * allowing a nested target to register DOM highlights and accept runtime prop overrides.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { matchesPreviewParentSliceTargetImport } from '../parentSlice/previewParentSliceImports';
import { PREVIEW_INSPECTOR_TARGET_NAMESPACE } from '../previewPluginProtocol';
import type { PreviewInferredPropsByExport } from '../staticResources/reactExportPropInference';
import type { PreviewInspectorTargetModuleContract } from './previewInspectorTargetModuleContract';

const INSPECTOR_TARGET_FACADE_PATH = 'selected-target-facade';
const INSPECTOR_DIRECT_TARGET_PATH_PREFIX = 'selected-direct-target:';
const INSPECTOR_ORIGINAL_TARGET_SPECIFIER = 'react-preview:inspector-original-target';
const INSPECTOR_RESOLUTION_GUARD = 'reactPreviewInspectorResolutionGuard';

/** Default virtual runtime contract consumed by the generated target facade. */
export const PREVIEW_INSPECTOR_RUNTIME_SPECIFIER = 'react-preview:inspector-runtime';
/** Direct facade import used when the selected target is itself the inspector mount root. */
export const PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER = 'react-preview:inspector-target-facade';
/** Prefix for tree-shakeable per-export dynamic entry modules used only after path traversal stalls. */
export const PREVIEW_INSPECTOR_DIRECT_TARGET_SPECIFIER_PREFIX =
  'react-preview:inspector-direct-target/';

/** Creates an opaque virtual specifier without embedding an export name as source syntax. */
export function createPreviewInspectorDirectTargetSpecifier(exportName: string): string {
  assertExportName(exportName);
  return PREVIEW_INSPECTOR_DIRECT_TARGET_SPECIFIER_PREFIX + encodeURIComponent(exportName);
}

/** Metadata passed to the browser-side target wrapper without evaluating project code. */
export interface PreviewInspectorTargetMetadata {
  readonly compilerExportEvidence: true;
  readonly exportName: string;
  readonly facadeResolutionEvidence: true;
  readonly preparedSourceDigest: string;
  readonly sourcePath: string;
}

/** Inputs for exact target import interception in one Page Inspector build. */
export interface PreviewInspectorTargetPluginOptions {
  /** Exact aliases resolved from the active tsconfig/package graph, when available. */
  readonly acceptedTargetImportSpecifiers?: readonly string[];
  /** Data-only fallback shapes associated with exact selected runtime exports. */
  readonly inferredPropsByExport?: PreviewInferredPropsByExport;
  /** Optional private runtime specifier, primarily useful to isolated compiler tests. */
  readonly runtimeSpecifier?: string;
  /** Prepared-source export evidence shared with PageExecution and facade generation. */
  readonly targetModuleContract: PreviewInspectorTargetModuleContract;
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
  const targetPath = path.normalize(options.targetModuleContract.sourcePath);
  const canonicalTargetPath = canonicalizeExistingPath(targetPath);
  const targetModuleStem = path.basename(targetPath).replace(/\.[^.]+$/u, '');
  const selectedExportNames = options.targetModuleContract.selectedExportNames;
  const acceptedSpecifiers = new Set(options.acceptedTargetImportSpecifiers ?? []);
  const runtimeSpecifier = options.runtimeSpecifier ?? PREVIEW_INSPECTOR_RUNTIME_SPECIFIER;

  /** Redirects exact authored target imports while preserving a private non-recursive edge. */
  function resolveTargetImport(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (
      arguments_.namespace === PREVIEW_INSPECTOR_TARGET_NAMESPACE &&
      arguments_.path === INSPECTOR_ORIGINAL_TARGET_SPECIFIER
    ) {
      return { namespace: 'file', path: targetPath };
    }
    if (arguments_.path === PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER) {
      return {
        namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE,
        path: INSPECTOR_TARGET_FACADE_PATH,
      };
    }
    if (arguments_.path.startsWith(PREVIEW_INSPECTOR_DIRECT_TARGET_SPECIFIER_PREFIX)) {
      const encodedExportName = arguments_.path.slice(
        PREVIEW_INSPECTOR_DIRECT_TARGET_SPECIFIER_PREFIX.length,
      );
      const exportName = decodePreviewInspectorDirectTargetExportName(encodedExportName);
      if (exportName === undefined || !selectedExportNames.includes(exportName)) return undefined;
      return {
        namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE,
        path: INSPECTOR_DIRECT_TARGET_PATH_PREFIX + encodeURIComponent(exportName),
      };
    }
    if (
      arguments_.importer.length === 0 ||
      !path.isAbsolute(arguments_.importer) ||
      (arguments_.namespace === 'file' && path.normalize(arguments_.importer) === targetPath) ||
      !matchesPreviewParentSliceTargetImport(
        arguments_.path,
        arguments_.importer,
        targetPath,
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
        ...(options.inferredPropsByExport === undefined
          ? {}
          : { inferredPropsByExport: options.inferredPropsByExport }),
        runtimeSpecifier,
        targetModuleContract: options.targetModuleContract,
      }),
      loader: 'js',
      resolveDir: path.dirname(targetPath),
    };
  }

  /** Supplies one exact static facade import so an unused sibling export remains tree-shakeable. */
  function loadDirectTarget(arguments_: OnLoadArgs): OnLoadResult {
    const exportName = decodePreviewInspectorDirectTargetExportName(
      arguments_.path.slice(INSPECTOR_DIRECT_TARGET_PATH_PREFIX.length),
    );
    if (exportName === undefined || !selectedExportNames.includes(exportName)) {
      throw new TypeError('Invalid React Preview direct target export.');
    }
    const importClause =
      exportName === 'default'
        ? '__reactPreviewDirectTarget'
        : `{ ${exportName} as __reactPreviewDirectTarget }`;
    return {
      contents: [
        `import ${importClause} from ${JSON.stringify(PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER)};`,
        'export default __reactPreviewDirectTarget;',
      ].join('\n'),
      loader: 'js',
      resolveDir: path.dirname(targetPath),
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
          canonicalizeExistingPath(resolution.path) === canonicalTargetPath
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
      build.onLoad(
        {
          filter: /^selected-direct-target:/,
          namespace: PREVIEW_INSPECTOR_TARGET_NAMESPACE,
        },
        loadDirectTarget,
      );
    },
  };
}

/** Decodes a bounded virtual export identity and rejects malformed URI escape sequences. */
function decodePreviewInspectorDirectTargetExportName(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    assertExportName(decoded);
    return decoded;
  } catch {
    return undefined;
  }
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
  readonly inferredPropsByExport?: PreviewInferredPropsByExport;
  readonly runtimeSpecifier?: string;
  readonly targetModuleContract: PreviewInspectorTargetModuleContract;
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
  const exportNames = options.targetModuleContract.selectedExportNames;
  for (const exportName of exportNames) {
    assertExportName(exportName);
  }
  const runtimeSpecifier = options.runtimeSpecifier ?? PREVIEW_INSPECTOR_RUNTIME_SPECIFIER;
  const selectedDefault = exportNames.includes('default');
  if (selectedDefault && !options.targetModuleContract.hasDefaultExport) {
    throw new TypeError('Preview inspector cannot select an absent original default export.');
  }
  const namedExports = exportNames.filter((exportName) => exportName !== 'default');
  const lines: string[] = [];
  if (options.targetModuleContract.hasDefaultExport) {
    lines.push(
      `import __reactPreviewOriginalDefault from ${JSON.stringify(INSPECTOR_ORIGINAL_TARGET_SPECIFIER)};`,
    );
  }
  for (const [index, exportName] of namedExports.entries()) {
    lines.push(
      `import { ${exportName} as __reactPreviewOriginalSelected${index.toString()} } from ${JSON.stringify(INSPECTOR_ORIGINAL_TARGET_SPECIFIER)};`,
    );
  }
  lines.push(
    `import { wrapPreviewInspectorTarget as __reactPreviewWrap } from ${JSON.stringify(runtimeSpecifier)};`,
    `export * from ${JSON.stringify(INSPECTOR_ORIGINAL_TARGET_SPECIFIER)};`,
  );

  for (const [index, exportName] of namedExports.entries()) {
    lines.push(
      `const __reactPreviewSelected${index.toString()} = /* @__PURE__ */ __reactPreviewWrap(__reactPreviewOriginalSelected${index.toString()}, ${serializeMetadata(options.targetModuleContract, exportName, options.inferredPropsByExport?.[exportName])});`,
      `export { __reactPreviewSelected${index.toString()} as ${exportName} };`,
    );
  }
  if (selectedDefault) {
    lines.push(
      `export default /* @__PURE__ */ __reactPreviewWrap(__reactPreviewOriginalDefault, ${serializeMetadata(options.targetModuleContract, 'default', options.inferredPropsByExport?.default)});`,
    );
  } else if (options.targetModuleContract.hasDefaultExport) {
    lines.push('export { __reactPreviewOriginalDefault as default };');
  }
  return lines.join('\n');
}

/** Serializes immutable target identity supplied to the inspector runtime registry. */
function serializeMetadata(
  contract: PreviewInspectorTargetModuleContract,
  exportName: string,
  inference: PreviewInferredPropsByExport[string] | undefined,
): string {
  return JSON.stringify({
    compilerExportEvidence: true,
    exportName,
    facadeResolutionEvidence: true,
    ...(inference === undefined
      ? {}
      : { inferredPropShape: inference.shape, inferredProps: inference.provenance }),
    preparedSourceDigest: contract.preparedSourceDigest,
    sourcePath: path.normalize(contract.sourcePath),
  });
}

/** Validates plugin boundaries before installing broad esbuild resolver callbacks. */
function assertPluginOptions(options: PreviewInspectorTargetPluginOptions): void {
  if (!path.isAbsolute(options.targetModuleContract.sourcePath)) {
    throw new RangeError('Preview inspector target path must be absolute.');
  }
  if (options.targetModuleContract.selectedExportNames.length === 0) {
    throw new TypeError('Preview inspector requires at least one explicit target export.');
  }
  const explicitExportNames = new Set(options.targetModuleContract.explicitExportNames);
  for (const exportName of options.targetModuleContract.selectedExportNames) {
    assertExportName(exportName);
    if (!explicitExportNames.has(exportName)) {
      throw new TypeError(`Preview inspector selected an unproven target export: ${exportName}`);
    }
  }
  if (
    options.targetModuleContract.selectedExportNames.includes('default') &&
    !options.targetModuleContract.hasDefaultExport
  ) {
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
