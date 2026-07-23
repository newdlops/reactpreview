/**
 * Adapts render-oriented asset import conventions without executing framework configuration.
 * Normal URL assets remain owned by esbuild loaders; this plugin adds explicit `?raw`, SVG
 * component, and Create React App-style named `ReactComponent` semantics for reachable imports.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  parsePreviewBarePackageSpecifier,
  selectPreviewPackageStyleExport,
  type PreviewBarePackageSpecifier,
} from './previewCssPackageExports';
import { isInlinePreviewAssetPath } from './previewLoaderPolicy';
import {
  isFileBackedPreviewNamespace,
  PREVIEW_ASSET_NAMESPACE,
  PREVIEW_DATA_URL_NAMESPACE,
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_TARGET_BRIDGE_NAMESPACE,
} from './previewPluginProtocol';

const JAVASCRIPT_IMPORT_KINDS = new Set(['dynamic-import', 'import-statement', 'require-call']);
const ASSET_PLUGIN_DATA = Symbol('react-preview-asset-plugin-data');
const MAX_INLINE_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_INLINE_ASSET_BYTES = 20 * 1024 * 1024;
const PACKAGE_MANIFEST_NAME = 'package.json';

/** Asset transformations that produce JavaScript modules for the browser bundle. */
type PreviewAssetMode = 'data-url' | 'raw' | 'svg-component' | 'svg-url';

/** Private data transferred from asset resolution to loading. */
interface PreviewAssetPluginData {
  /** Marker that distinguishes this adapter's metadata from other esbuild plugins. */
  readonly [ASSET_PLUGIN_DATA]: true;
  /** Transformation selected from the original query and import kind. */
  readonly mode: PreviewAssetMode;
  /** Optional SVG fragment retained in a generated browser URL. */
  readonly urlFragment: string;
}

/** Parsed filesystem request and query suffix for one asset import. */
interface ParsedAssetRequest {
  /** Path passed to esbuild's normal resolver without query or fragment text. */
  readonly path: string;
  /** Query and fragment retained as part of module identity. */
  readonly suffix: string;
}

/** Filesystem request plus the trusted canonical root required after symlink resolution. */
interface BoundedAssetRequest {
  /** Local request passed through normal esbuild resolution. */
  readonly path: string;
  /** Canonical project boundary that the resolved file must remain within. */
  readonly requiredRoot?: string;
}

/** Untrusted package metadata narrowed to the fields used by CSS style resolution. */
interface PreviewStylePackageManifest {
  /** Conditional or subpath package exports map interpreted without executing project code. */
  readonly exports?: unknown;
  /** Exact package identity guarding against an unrelated nested manifest. */
  readonly name?: unknown;
}

/** Active path needed when an asset is imported from the target bridge namespace. */
export interface PreviewAssetPluginOptions {
  /** Absolute active-document path used as the virtual bridge's filesystem importer. */
  readonly documentPath: string;
  /** Nearest package boundary containing the conventional public directory. */
  readonly projectRoot: string;
  /** Registers a resolved style package so manifest-only changes can trigger preview rebuilds. */
  readonly registerWatchDirectory?: (directoryPath: string) => void;
  /** Trusted workspace boundary applied after filesystem symlinks are resolved. */
  readonly workspaceRoot: string;
}

/**
 * Creates an asset adapter for raw text and SVG component conventions.
 *
 * @param options Active document used to restore filesystem resolution from virtual namespaces.
 * @returns Stateless esbuild plugin scoped to one compilation request.
 */
export function createPreviewAssetPlugin(options: PreviewAssetPluginOptions): Plugin {
  const canonicalTargetPath = canonicalizeExistingPath(options.documentPath);
  const canonicalWorkspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const publicDirectory = path.resolve(options.projectRoot, 'public');
  const canonicalPublicDirectory = canonicalizeExistingPath(publicDirectory);
  const assetBudget: AssetBudgetState = {
    representations: new Set<string>(),
    totalBytes: 0,
  };
  const stylePackageResolutionCache = new Map<string, Promise<OnResolveResult | undefined>>();

  return {
    name: 'react-preview-assets',
    setup(build): void {
      /** Resets compilation-local accounting when a persistent esbuild context starts a rebuild. */
      build.onStart(() => {
        assetBudget.representations.clear();
        assetBudget.totalBytes = 0;
        stylePackageResolutionCache.clear();
      });

      /**
       * Resolves only imports requiring generated JavaScript instead of a normal URL loader.
       *
       * @param arguments_ Module-resolution request emitted by esbuild.
       * @returns Private asset-module identity, normal resolution errors, or `undefined`.
       */
      async function resolvePreviewAsset(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if ((arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD) {
          return undefined;
        }

        const parsedRequest = parseAssetRequest(arguments_.path);
        const stylePackageResolution = await resolveCssPackageStyleImport({
          arguments_,
          build,
          cache: stylePackageResolutionCache,
          parsedRequest,
          projectRoot: options.projectRoot,
          registerWatchDirectory: options.registerWatchDirectory,
          workspaceRoot: options.workspaceRoot,
        });
        if (stylePackageResolution !== undefined) {
          return stylePackageResolution;
        }
        const mode = selectAssetMode(arguments_, parsedRequest);
        const resolvesPublicStylesheet = isPublicStylesheetImport(arguments_, parsedRequest);
        if (mode === undefined && !resolvesPublicStylesheet) {
          return undefined;
        }

        const fromVirtualModule = isFileBackedPreviewNamespace(arguments_.namespace);
        const virtualImporter =
          arguments_.namespace === PREVIEW_TARGET_BRIDGE_NAMESPACE
            ? canonicalTargetPath
            : canonicalizeExistingPath(arguments_.importer);
        let boundedRequest: BoundedAssetRequest;
        try {
          boundedRequest = resolveAssetRequestPath({
            canonicalPublicDirectory,
            canonicalWorkspaceRoot,
            importerIsWorkspaceOwned: isPathInside(
              canonicalWorkspaceRoot,
              canonicalizeExistingPath(virtualImporter),
            ),
            publicDirectory,
            requestPath: parsedRequest.path,
            workspaceRoot: options.workspaceRoot,
          });
        } catch (error) {
          return {
            errors: [
              {
                detail: error,
                text: error instanceof Error ? error.message : 'Invalid preview asset path.',
              },
            ],
          };
        }
        const resolved = await build.resolve(boundedRequest.path, {
          importer: fromVirtualModule ? virtualImporter : arguments_.importer,
          kind: arguments_.kind,
          namespace: fromVirtualModule ? 'file' : arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: fromVirtualModule ? path.dirname(virtualImporter) : arguments_.resolveDir,
          with: arguments_.with,
        });

        if (resolved.errors.length > 0) {
          return { errors: resolved.errors, warnings: resolved.warnings };
        }

        if (resolved.external) {
          return {
            errors: [
              {
                text: `Preview asset imports must be bundled instead of external: ${arguments_.path}`,
              },
            ],
          };
        }

        if (resolved.namespace !== 'file') {
          return {
            errors: [
              {
                text: `Preview assets must resolve to local files: ${arguments_.path}`,
              },
            ],
          };
        }

        if (
          boundedRequest.requiredRoot !== undefined &&
          !isPathInside(boundedRequest.requiredRoot, canonicalizeExistingPath(resolved.path))
        ) {
          return {
            errors: [
              {
                text: `Preview asset resolved outside its trusted project boundary: ${arguments_.path}`,
              },
            ],
          };
        }

        if (mode === undefined) {
          return {
            namespace: resolved.namespace,
            path: resolved.path,
            pluginData: resolved.pluginData as unknown,
            sideEffects: resolved.sideEffects,
            suffix: resolved.suffix,
            warnings: resolved.warnings,
          };
        }

        const policyError = await reserveAssetBudget(
          resolved.path,
          parsedRequest.suffix,
          mode,
          assetBudget,
        );
        if (!policyError.ok) {
          return {
            errors: [
              policyError.error === undefined
                ? { text: policyError.message }
                : { detail: policyError.error, text: policyError.message },
            ],
          };
        }

        return {
          namespace: mode === 'data-url' ? PREVIEW_DATA_URL_NAMESPACE : PREVIEW_ASSET_NAMESPACE,
          path: resolved.path,
          pluginData: {
            [ASSET_PLUGIN_DATA]: true,
            mode,
            urlFragment: extractUrlFragment(parsedRequest.suffix),
          } satisfies PreviewAssetPluginData,
          sideEffects: resolved.sideEffects,
          suffix:
            mode === 'data-url' ? extractUrlFragment(parsedRequest.suffix) : parsedRequest.suffix,
          warnings: resolved.warnings,
        };
      }

      /**
       * Reads a resolved asset and generates the requested browser module representation.
       *
       * @param arguments_ Asset load request carrying private transformation metadata.
       * @returns JavaScript module with dependency watching, or a structured read failure.
       */
      async function loadPreviewAsset(arguments_: OnLoadArgs): Promise<OnLoadResult | undefined> {
        const pluginData = readAssetPluginData(arguments_.pluginData);
        if (pluginData === undefined) {
          return undefined;
        }

        try {
          const source = await readFile(arguments_.path);
          const contents = createAssetContents(source, pluginData.mode, pluginData.urlFragment);

          return {
            contents,
            loader: pluginData.mode === 'data-url' ? 'dataurl' : 'js',
            resolveDir: path.dirname(arguments_.path),
            watchFiles: [arguments_.path],
          };
        } catch (error) {
          return {
            errors: [
              {
                detail: error,
                text: `Could not read preview asset: ${arguments_.path}`,
              },
            ],
          };
        }
      }

      build.onResolve({ filter: /.*/ }, resolvePreviewAsset);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_ASSET_NAMESPACE }, loadPreviewAsset);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_DATA_URL_NAMESPACE }, loadPreviewAsset);
    },
  };
}

/** Inputs used by the CSS-only conditional package resolver. */
interface CssPackageStyleResolutionOptions {
  /** Original esbuild request; only `import-rule` requests are eligible. */
  readonly arguments_: OnResolveArgs;
  /** Active build API used only to locate PnP packages through their ordinary JS export. */
  readonly build: Parameters<Plugin['setup']>[0];
  /** Rebuild-local result cache keyed by importer directory and exact package request. */
  readonly cache: Map<string, Promise<OnResolveResult | undefined>>;
  /** Request with query and fragment separated from the package specifier. */
  readonly parsedRequest: ParsedAssetRequest;
  /** Nearest package root used when the importer belongs to a virtual preview module. */
  readonly projectRoot: string;
  /** Compiler watcher bridge used because package manifests are absent from esbuild metafile inputs. */
  readonly registerWatchDirectory: ((directoryPath: string) => void) | undefined;
  /** Workspace fallback used for hoisted dependency discovery. */
  readonly workspaceRoot: string;
}

/**
 * Resolves the `style` condition of a bare package only for a CSS `@import` rule.
 *
 * esbuild's build-wide `conditions` option cannot be used here: adding `style` globally would make
 * JavaScript imports of packages such as Tailwind resolve to CSS. This resolver instead reads one
 * package manifest as inert JSON and accepts a target only when authored conditional-export order
 * proves that the CSS-specific `style` condition selected it.
 *
 * @param options Original import, package boundaries, build API, and rebuild-local cache.
 * @returns A local CSS file result, a package diagnostic, or `undefined` for normal esbuild logic.
 */
async function resolveCssPackageStyleImport(
  options: CssPackageStyleResolutionOptions,
): Promise<OnResolveResult | undefined> {
  if (options.arguments_.kind !== 'import-rule') return undefined;
  const packageSpecifier = parsePreviewBarePackageSpecifier(options.parsedRequest.path);
  if (packageSpecifier === undefined) return undefined;

  const importerDirectory = selectPackageImporterDirectory(options.arguments_, options.projectRoot);
  const cacheKey = `${canonicalizeExistingPath(importerDirectory)}\0${options.parsedRequest.path}${options.parsedRequest.suffix}`;
  let pending = options.cache.get(cacheKey);
  if (pending === undefined) {
    pending = resolveCssPackageStyleImportUncached({
      ...options,
      importerDirectory,
      packageSpecifier,
    });
    options.cache.set(cacheKey, pending);
  }
  return pending;
}

/** Full inputs after a bare CSS package request has been validated and normalized. */
interface UncachedCssPackageStyleResolutionOptions extends CssPackageStyleResolutionOptions {
  /** Filesystem directory whose Node-style package ancestry should be searched first. */
  readonly importerDirectory: string;
  /** Parsed npm identity and package-exports subpath. */
  readonly packageSpecifier: PreviewBarePackageSpecifier;
}

/** Finds the package, selects its conditional style target, and validates the resulting CSS file. */
async function resolveCssPackageStyleImportUncached(
  options: UncachedCssPackageStyleResolutionOptions,
): Promise<OnResolveResult | undefined> {
  const packageRoot =
    (await findInstalledPackageRoot(options.packageSpecifier.packageName, [
      options.importerDirectory,
      options.projectRoot,
      options.workspaceRoot,
    ])) ??
    (await resolvePackageRootFromJavascriptExport(
      options.build,
      options.arguments_,
      options.importerDirectory,
      options.packageSpecifier.packageName,
    ));
  if (packageRoot === undefined) return undefined;

  const manifestPath = path.join(packageRoot, PACKAGE_MANIFEST_NAME);
  const manifest = await readStylePackageManifest(manifestPath);
  if (manifest?.name !== options.packageSpecifier.packageName) return undefined;
  options.registerWatchDirectory?.(packageRoot);
  const target = selectPreviewPackageStyleExport(
    manifest.exports,
    options.packageSpecifier.exportSubpath,
  );
  if (!target?.toLowerCase().endsWith('.css')) return undefined;
  if (!target.startsWith('./') || /[?#]/u.test(target)) return undefined;

  const targetPath = path.resolve(packageRoot, target);
  if (!isPathInside(packageRoot, targetPath)) return undefined;
  try {
    const metadata = await stat(targetPath);
    if (!metadata.isFile()) return undefined;
  } catch (error) {
    return {
      errors: [
        {
          detail: error,
          text: `Could not read package style export for ${options.parsedRequest.path}: ${targetPath}`,
        },
      ],
      watchFiles: [manifestPath],
    };
  }

  const canonicalPackageRoot = canonicalizeExistingPath(packageRoot);
  const canonicalTargetPath = canonicalizeExistingPath(targetPath);
  if (!isPathInside(canonicalPackageRoot, canonicalTargetPath)) return undefined;
  return {
    namespace: 'file',
    path: canonicalTargetPath,
    sideEffects: true,
    suffix: options.parsedRequest.suffix,
    watchFiles: [manifestPath, canonicalTargetPath],
  };
}

/** Selects a real importer directory for file-backed and generated preview modules. */
function selectPackageImporterDirectory(arguments_: OnResolveArgs, projectRoot: string): string {
  if (path.isAbsolute(arguments_.resolveDir)) return arguments_.resolveDir;
  if (path.isAbsolute(arguments_.importer)) return path.dirname(arguments_.importer);
  return projectRoot;
}

/** Searches ordinary nearest/hoisted `node_modules` roots without leaving package names unchecked. */
async function findInstalledPackageRoot(
  packageName: string,
  startDirectories: readonly string[],
): Promise<string | undefined> {
  const visited = new Set<string>();
  for (const startDirectory of startDirectories) {
    let directory = path.resolve(startDirectory);
    while (!visited.has(directory)) {
      visited.add(directory);
      const packageRoot = path.join(directory, 'node_modules', packageName);
      const manifest = await readStylePackageManifest(
        path.join(packageRoot, PACKAGE_MANIFEST_NAME),
      );
      if (manifest?.name === packageName) return packageRoot;
      const parentDirectory = path.dirname(directory);
      if (parentDirectory === directory) break;
      directory = parentDirectory;
    }
  }
  return undefined;
}

/**
 * Uses an ordinary JS package export only as a locator for PnP or virtual package installations.
 * The returned JS file is never substituted into CSS; its nearest matching manifest anchors the
 * subsequent `style` export lookup.
 */
async function resolvePackageRootFromJavascriptExport(
  build: Parameters<Plugin['setup']>[0],
  arguments_: OnResolveArgs,
  importerDirectory: string,
  packageName: string,
): Promise<string | undefined> {
  const importer = path.isAbsolute(arguments_.importer)
    ? arguments_.importer
    : path.join(importerDirectory, '__react_preview_css_import__.css');
  const resolved = await build.resolve(packageName, {
    importer,
    kind: 'import-statement',
    namespace: 'file',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: importerDirectory,
  });
  if (resolved.external || resolved.errors.length > 0 || !path.isAbsolute(resolved.path)) {
    return undefined;
  }

  let directory = path.dirname(resolved.path);
  for (;;) {
    const manifest = await readStylePackageManifest(path.join(directory, PACKAGE_MANIFEST_NAME));
    if (manifest?.name === packageName) return directory;
    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) return undefined;
    directory = parentDirectory;
  }
}

/** Reads only object-shaped JSON metadata and treats malformed or unreadable manifests as absent. */
async function readStylePackageManifest(
  manifestPath: string,
): Promise<PreviewStylePackageManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Reports whether a root-relative CSS `@import` needs public-directory path mapping only. */
function isPublicStylesheetImport(arguments_: OnResolveArgs, request: ParsedAssetRequest): boolean {
  return (
    arguments_.kind === 'import-rule' &&
    request.path.startsWith('/') &&
    request.path.toLowerCase().endsWith('.css')
  );
}

/**
 * Maps root-relative browser assets to the conventional workspace `public` directory while
 * preserving workspace-contained absolute paths and rejecting traversal outside trusted roots.
 *
 * @param options Request identity, importer ownership, and lexical/canonical project boundaries.
 * @returns Resolution path plus the boundary that must still hold after symlinks are followed.
 */
function resolveAssetRequestPath(options: {
  readonly canonicalPublicDirectory: string;
  readonly canonicalWorkspaceRoot: string;
  readonly importerIsWorkspaceOwned: boolean;
  readonly publicDirectory: string;
  readonly requestPath: string;
  readonly workspaceRoot: string;
}): BoundedAssetRequest {
  const normalizedWorkspaceRoot = path.resolve(options.workspaceRoot);
  if (
    path.isAbsolute(options.requestPath) &&
    isPathInside(normalizedWorkspaceRoot, options.requestPath)
  ) {
    return {
      path: path.resolve(options.requestPath),
      requiredRoot: options.canonicalWorkspaceRoot,
    };
  }
  if (path.isAbsolute(options.requestPath) && !options.requestPath.startsWith('/')) {
    throw new Error(
      `Preview absolute asset paths must stay inside ${normalizedWorkspaceRoot}: ${options.requestPath}`,
    );
  }

  if (options.requestPath.startsWith('/')) {
    if (!isPathInside(options.canonicalWorkspaceRoot, options.canonicalPublicDirectory)) {
      throw new Error(
        `Preview public directory must stay inside ${normalizedWorkspaceRoot}: ${options.publicDirectory}`,
      );
    }
    const publicAssetPath = path.resolve(options.publicDirectory, options.requestPath.slice(1));
    if (!isPathInside(options.publicDirectory, publicAssetPath)) {
      throw new Error(
        `Preview public asset paths must stay inside ${options.publicDirectory}: ${options.requestPath}`,
      );
    }
    return { path: publicAssetPath, requiredRoot: options.canonicalPublicDirectory };
  }

  const isRelativeRequest =
    options.requestPath.startsWith('./') || options.requestPath.startsWith('../');
  return {
    path: options.requestPath,
    ...(isRelativeRequest && options.importerIsWorkspaceOwned
      ? { requiredRoot: options.canonicalWorkspaceRoot }
      : {}),
  };
}

/** Reports whether one absolute path is equal to or contained by an absolute directory. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, path.resolve(candidatePath));
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/**
 * Separates a query or fragment suffix without interpreting filesystem path characters.
 *
 * @param importPath Original import string seen by esbuild.
 * @returns Base path for resolution and suffix retained for unique module identity.
 */
function parseAssetRequest(importPath: string): ParsedAssetRequest {
  const queryIndex = importPath.indexOf('?');
  const fragmentIndex = importPath.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), importPath.length);

  return {
    path: importPath.slice(0, suffixIndex),
    suffix: importPath.slice(suffixIndex),
  };
}

/**
 * Retains an actual URL fragment while leaving transform queries such as `?url` and `?react` out
 * of generated data URLs.
 *
 * @param suffix Query and fragment separated from the resolved filesystem path.
 * @returns Fragment beginning with `#`, or an empty string when no fragment was requested.
 */
function extractUrlFragment(suffix: string): string {
  const fragmentIndex = suffix.indexOf('#');
  return fragmentIndex < 0 ? '' : suffix.slice(fragmentIndex);
}

/**
 * Chooses an asset transformation while leaving CSS URL tokens to esbuild's URL loader.
 *
 * @param arguments_ Original resolution request including import kind.
 * @param request Parsed asset path and query suffix.
 * @returns Selected transformation or `undefined` for normal source and URL imports.
 */
function selectAssetMode(
  arguments_: OnResolveArgs,
  request: ParsedAssetRequest,
): PreviewAssetMode | undefined {
  const query = request.suffix.startsWith('?')
    ? new URLSearchParams(request.suffix.slice(1).split('#', 1)[0])
    : undefined;
  if (query?.has('raw') === true) {
    return 'raw';
  }

  if (query?.has('url') === true) {
    return 'data-url';
  }

  const isSvg = request.path.toLowerCase().endsWith('.svg');
  if (query?.has('react') === true) {
    return isSvg ? 'svg-component' : undefined;
  }

  if (isSvg && JAVASCRIPT_IMPORT_KINDS.has(arguments_.kind)) {
    return 'svg-url';
  }

  return isInlinePreviewAssetPath(request.path) ? 'data-url' : undefined;
}

/** Mutable aggregate asset budget scoped to one compilation request. */
interface AssetBudgetState {
  /** Canonical path, suffix, and mode identities already counted. */
  readonly representations: Set<string>;
  /** Total original bytes reserved by unique representations. */
  totalBytes: number;
}

/** Result of validating and reserving one unique asset representation. */
type AssetBudgetResult =
  | {
      /** Marks a successful reservation that requires no diagnostic. */
      readonly ok: true;
    }
  | {
      /** Underlying filesystem error when metadata could not be read. */
      readonly error?: unknown;
      /** Actionable policy failure for the compiler diagnostic. */
      readonly message: string;
      /** Marks a rejected reservation. */
      readonly ok: false;
    };

/**
 * Verifies that an asset is a bounded regular file before any callback reads it into memory.
 * A representation key prevents repeated imports from consuming the aggregate budget more than
 * once while separately generated forms such as CSS data URLs and SVG components remain counted.
 *
 * @param assetPath Resolved local filesystem path.
 * @param suffix Query or fragment that distinguishes the module representation.
 * @param mode Transformation that determines the emitted representation.
 * @param budget Mutable state private to one compilation request.
 * @returns Empty message after reservation or an actionable policy error.
 */
async function reserveAssetBudget(
  assetPath: string,
  suffix: string,
  mode: PreviewAssetMode,
  budget: AssetBudgetState,
): Promise<AssetBudgetResult> {
  try {
    const metadata = await stat(assetPath);
    if (!metadata.isFile()) {
      return { message: `Preview assets must be regular files: ${assetPath}`, ok: false };
    }

    if (metadata.size > MAX_INLINE_ASSET_BYTES) {
      return {
        message: `Preview asset exceeds the ${formatMebibytes(MAX_INLINE_ASSET_BYTES)} MiB per-file safety limit: ${assetPath}`,
        ok: false,
      };
    }

    const representationKey = `${canonicalizeExistingPath(assetPath)}\0${suffix}\0${mode}`;
    if (budget.representations.has(representationKey)) {
      return { ok: true };
    }

    const nextTotalBytes = budget.totalBytes + metadata.size;
    if (nextTotalBytes > MAX_TOTAL_INLINE_ASSET_BYTES) {
      return {
        message: `Preview assets exceed the ${formatMebibytes(MAX_TOTAL_INLINE_ASSET_BYTES)} MiB aggregate safety limit.`,
        ok: false,
      };
    }

    budget.representations.add(representationKey);
    budget.totalBytes = nextTotalBytes;
    return { ok: true };
  } catch (error) {
    return {
      error,
      message: `Could not inspect preview asset: ${assetPath}`,
      ok: false,
    };
  }
}

/**
 * Converts validated asset bytes into either a data-URL loader input or generated JavaScript.
 *
 * @param source Complete bounded asset contents.
 * @param mode Representation selected during resolution.
 * @param urlFragment Optional SVG fragment retained by generated URL modules.
 * @returns Raw bytes for esbuild's data-URL loader or JavaScript module source.
 */
function createAssetContents(
  source: Buffer,
  mode: PreviewAssetMode,
  urlFragment: string,
): Uint8Array | string {
  if (mode === 'data-url') {
    return source;
  }

  if (mode === 'raw') {
    return `export default ${JSON.stringify(source.toString('utf8'))};`;
  }

  return createSvgModule(source, mode === 'svg-component', urlFragment);
}

/**
 * Formats a byte count as a stable mebibyte value for asset-policy diagnostics.
 *
 * @param bytes Integer safety limit in bytes.
 * @returns Base-two mebibyte count without a unit suffix.
 */
function formatMebibytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toString();
}

/**
 * Narrows arbitrary esbuild plugin metadata to this adapter's private contract.
 *
 * @param pluginData Unknown metadata received by an on-load callback.
 * @returns Typed transformation metadata, or `undefined` for other plugins.
 */
function readAssetPluginData(pluginData: unknown): PreviewAssetPluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null) {
    return undefined;
  }

  return ASSET_PLUGIN_DATA in pluginData ? (pluginData as PreviewAssetPluginData) : undefined;
}

/**
 * Builds an SVG module supporting URL imports and a lightweight React component representation.
 * The component intentionally renders an `img` data URL instead of executing an SVGR transform,
 * which preserves safe browser rendering without loading project Babel or Vite plugins.
 *
 * @param source Original SVG bytes.
 * @param componentAsDefault Whether `?react` requested the component as the default export.
 * @param urlFragment Optional symbol or view fragment appended to the generated data URL.
 * @returns Browser JavaScript containing the data URL and React component exports.
 */
function createSvgModule(
  source: Uint8Array,
  componentAsDefault: boolean,
  urlFragment: string,
): string {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}${urlFragment}`;
  const encodedDataUrl = JSON.stringify(dataUrl);
  const defaultExport = componentAsDefault ? 'ReactComponent' : 'assetUrl';

  return `
import * as React from 'react';

export const assetUrl = ${encodedDataUrl};
export const ReactComponent = React.forwardRef(function ReactPreviewSvgAsset(props, ref) {
  return React.createElement('img', { ...props, ref, src: assetUrl });
});
export default ${defaultExport};
`;
}
