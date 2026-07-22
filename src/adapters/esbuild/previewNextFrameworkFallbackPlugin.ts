/**
 * Supplies a tiny browser-rendering surface for selected Next.js modules when the framework itself
 * is not installed. The fallback exists for dependency-free source snapshots: it is admitted only
 * after normal esbuild resolution fails and an inert, workspace-owned package manifest explicitly
 * declares Next. It never imports Next configuration, starts a server, or executes package scripts.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { isFileBackedPreviewNamespace, PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';

const NEXT_RENDER_FALLBACK_NAMESPACE = 'react-preview-next-render-fallback';
const NEXT_RENDER_MODULE_PATTERN = /^next\/(?:font\/google|image|link)$/;
const MAXIMUM_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_IMPORTER_BYTES = 2 * 1024 * 1024;
const PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** Compiler-owned inputs needed by the evidence-bounded framework fallback. */
export interface PreviewNextFrameworkFallbackOptions {
  /** Reads a current editor snapshot before falling back to the saved importer. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Canonical boundary containing both the importing source and its declaring manifest. */
  readonly workspaceRoot: string;
}

/** Inert manifest evidence carried into virtual-module loading and hot-reload watching. */
interface PreviewNextFrameworkFallbackData {
  /** Named Google-font factories referenced by the exact importing source file. */
  readonly fontExportNames: readonly string[];
  /** Discriminant that prevents unrelated plugin metadata from being accepted. */
  readonly kind: 'react-preview-next-render-fallback';
  /** Exact workspace package manifest that declares the unavailable framework. */
  readonly manifestPath: string;
  /** One of the small render-only public modules supported by this adapter. */
  readonly moduleSpecifier: string;
}

/** Minimal package metadata accepted without evaluating JavaScript configuration. */
interface PreviewNextPackageManifest {
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

/**
 * Creates the missing-Next render fallback.
 *
 * Normal installed image/link code wins. Google-font modules always use static metadata because
 * Next's compiler normally rewrites their exports and raw esbuild evaluation yields undefined font
 * factories. Every facade still requires an explicit nearest `next` declaration. Missing arbitrary
 * Next internals remain hard errors instead of hiding an incompatible runtime contract.
 */
export function createPreviewNextFrameworkFallbackPlugin(
  options: PreviewNextFrameworkFallbackOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const manifestByImporterDirectory = new Map<string, Promise<string | undefined>>();
  const warnedSpecifiers = new Set<string>();

  return {
    name: 'react-preview-next-framework-fallback',
    setup(build): void {
      /** Uses the font facade by contract; image/link defer to real Next before using a fallback. */
      async function resolveNextRenderModule(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (!isEligibleNextRequest(arguments_, workspaceRoot)) return undefined;
        const importerPath = canonicalizeExistingPath(arguments_.importer);
        const importerDirectory = path.dirname(importerPath);
        let manifestPromise = manifestByImporterDirectory.get(importerDirectory);
        if (manifestPromise === undefined) {
          manifestPromise = findNearestNextManifest(importerDirectory, workspaceRoot);
          manifestByImporterDirectory.set(importerDirectory, manifestPromise);
        }
        const earlyManifestPath =
          arguments_.path === 'next/font/google' ? await manifestPromise : undefined;
        if (earlyManifestPath !== undefined) {
          return createNextFallbackResolution(arguments_, importerPath, earlyManifestPath);
        }

        const resolved = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: 'file',
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
          with: arguments_.with,
        });
        if (resolved.errors.length === 0) return resolved;

        const manifestPath = await manifestPromise;
        if (manifestPath === undefined) {
          return { errors: resolved.errors, warnings: resolved.warnings };
        }
        return createNextFallbackResolution(arguments_, importerPath, manifestPath);
      }

      /** Creates one facade resolution after a nearest declaration has already been proven. */
      async function createNextFallbackResolution(
        arguments_: OnResolveArgs,
        importerPath: string,
        manifestPath: string,
      ): Promise<OnResolveResult> {
        const fontExportNames =
          arguments_.path === 'next/font/google'
            ? await collectNamedFontImports(
                importerPath,
                arguments_.path,
                options.readSource?.(importerPath),
              )
            : [];
        const includeWarning = !warnedSpecifiers.has(arguments_.path);
        warnedSpecifiers.add(arguments_.path);
        return {
          namespace: NEXT_RENDER_FALLBACK_NAMESPACE,
          path:
            arguments_.path === 'next/font/google'
              ? `${arguments_.path}?exports=${fontExportNames.join(',')}`
              : arguments_.path,
          pluginData: {
            fontExportNames,
            kind: 'react-preview-next-render-fallback',
            manifestPath,
            moduleSpecifier: arguments_.path,
          } satisfies PreviewNextFrameworkFallbackData,
          sideEffects: false,
          warnings: includeWarning
            ? [
                {
                  text:
                    `React Preview supplied a static render-only fallback for ` +
                    `framework module "${arguments_.path}" without running Next build transforms.`,
                },
              ]
            : [],
        };
      }

      /** Emits a module-specific browser facade and watches only its inert declaration evidence. */
      function loadNextRenderModule(arguments_: OnLoadArgs): OnLoadResult | undefined {
        const data = readFallbackData(arguments_.pluginData);
        if (data === undefined) return undefined;
        const contents = createNextRenderModuleSource(data.moduleSpecifier, data.fontExportNames);
        if (contents === undefined) return undefined;
        return {
          contents,
          loader: 'js',
          resolveDir: path.dirname(data.manifestPath),
          watchFiles: [data.manifestPath],
        };
      }

      build.onResolve({ filter: NEXT_RENDER_MODULE_PATTERN }, resolveNextRenderModule);
      build.onLoad(
        { filter: /.*/, namespace: NEXT_RENDER_FALLBACK_NAMESPACE },
        loadNextRenderModule,
      );
    },
  };
}

/** Rejects guarded recursion, virtual importers, and any source outside the selected workspace. */
function isEligibleNextRequest(arguments_: OnResolveArgs, workspaceRoot: string): boolean {
  if (
    (arguments_.namespace !== 'file' && !isFileBackedPreviewNamespace(arguments_.namespace)) ||
    (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
    !NEXT_RENDER_MODULE_PATTERN.test(arguments_.path) ||
    !path.isAbsolute(arguments_.importer)
  ) {
    return false;
  }
  return isPathInside(workspaceRoot, canonicalizeExistingPath(arguments_.importer));
}

/** Walks only inert package manifests between one source directory and the workspace boundary. */
async function findNearestNextManifest(
  importerDirectory: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  let currentDirectory = canonicalizeExistingPath(importerDirectory);
  while (isPathInside(workspaceRoot, currentDirectory)) {
    const manifestPath = path.join(currentDirectory, 'package.json');
    if (await manifestDeclaresNext(manifestPath, workspaceRoot)) return manifestPath;
    if (currentDirectory === workspaceRoot) return undefined;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return undefined;
    currentDirectory = parentDirectory;
  }
  return undefined;
}

/** Reads bounded JSON only and accepts a non-empty string declaration from standard npm fields. */
async function manifestDeclaresNext(manifestPath: string, workspaceRoot: string): Promise<boolean> {
  try {
    const manifestIdentity = canonicalizeExistingPath(manifestPath);
    if (!isPathInside(workspaceRoot, manifestIdentity)) return false;
    const manifestStats = await stat(manifestIdentity);
    if (!manifestStats.isFile() || manifestStats.size > MAXIMUM_PACKAGE_MANIFEST_BYTES)
      return false;
    const parsed: unknown = JSON.parse(await readFile(manifestIdentity, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const manifest = parsed as PreviewNextPackageManifest;
    return PACKAGE_DEPENDENCY_FIELDS.some((field) => {
      const dependencies = manifest[field];
      if (
        typeof dependencies !== 'object' ||
        dependencies === null ||
        Array.isArray(dependencies)
      ) {
        return false;
      }
      const declaration = (dependencies as Record<string, unknown>).next;
      return typeof declaration === 'string' && declaration.trim().length > 0;
    });
  } catch {
    return false;
  }
}

/** Narrows virtual metadata before a filesystem path can become a watch dependency. */
function readFallbackData(value: unknown): PreviewNextFrameworkFallbackData | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<PreviewNextFrameworkFallbackData>;
  return candidate.kind === 'react-preview-next-render-fallback' &&
    Array.isArray(candidate.fontExportNames) &&
    candidate.fontExportNames.every((name) => typeof name === 'string') &&
    typeof candidate.manifestPath === 'string' &&
    typeof candidate.moduleSpecifier === 'string'
    ? (candidate as PreviewNextFrameworkFallbackData)
    : undefined;
}

/** Selects only the audited public-module facades; unknown Next imports are never generalized. */
function createNextRenderModuleSource(
  moduleSpecifier: string,
  fontExportNames: readonly string[],
): string | undefined {
  if (moduleSpecifier === 'next/image') return createNextImageFallbackSource();
  if (moduleSpecifier === 'next/link') return createNextLinkFallbackSource();
  if (moduleSpecifier === 'next/font/google') {
    return createNextGoogleFontFallbackSource(fontExportNames);
  }
  return undefined;
}

/** Creates an ordinary image element while removing framework-only optimization properties. */
function createNextImageFallbackSource(): string {
  return `
import * as React from 'react';

/** Reads a public URL from Next static-image objects without importing an image optimizer. */
function readImageSource(source) {
  return typeof source === 'string' ? source :
    source !== null && typeof source === 'object' && typeof source.src === 'string'
      ? source.src
      : '';
}

/** Renders the visual image contract with no server loader or framework bootstrap. */
const PreviewNextImage = React.forwardRef(function PreviewNextImage(properties, reference) {
  const {
    blurDataURL, fill, loader, onLoadingComplete, placeholder, priority, quality, unoptimized,
    src: source, style, ...imageProperties
  } = properties ?? {};
  const staticSource = source !== null && typeof source === 'object' ? source : undefined;
  const imageStyle = fill === true
    ? { position: 'absolute', height: '100%', width: '100%', inset: 0, objectFit: 'cover', ...style }
    : style;
  return React.createElement('img', {
    ...imageProperties,
    alt: typeof imageProperties.alt === 'string' ? imageProperties.alt : '',
    'data-react-preview-next-image': '',
    decoding: imageProperties.decoding ?? 'async',
    height: imageProperties.height ?? staticSource?.height,
    loading: priority === true ? 'eager' : imageProperties.loading,
    ref: reference,
    src: readImageSource(source),
    style: imageStyle,
    width: imageProperties.width ?? staticSource?.width,
  });
});

PreviewNextImage.displayName = 'PreviewNextImage';
export default PreviewNextImage;

/** Mirrors the public helper sufficiently for render-time property spreading. */
export function getImageProps(properties) {
  const { src, ...rest } = properties ?? {};
  return { props: { ...rest, src: readImageSource(src) } };
}
`;
}

/** Creates a same-document anchor facade for the visual portion of `next/link`. */
function createNextLinkFallbackSource(): string {
  return `
import * as React from 'react';

/** Serializes the static pathname/query subset commonly passed to Next Link. */
function readHref(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '#';
  const pathname = typeof value.pathname === 'string' ? value.pathname : '';
  const query = value.query !== null && typeof value.query === 'object'
    ? new URLSearchParams(Object.entries(value.query).flatMap(([key, item]) =>
        (Array.isArray(item) ? item : [item])
          .filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
          .map((entry) => [key, String(entry)]))).toString()
    : '';
  return pathname + (query.length === 0 ? '' : '?' + query) +
    (typeof value.hash === 'string' ? value.hash : '');
}

/** Keeps links inspectable without starting Next routing or prefetch behavior. */
const PreviewNextLink = React.forwardRef(function PreviewNextLink(properties, reference) {
  const {
    href, legacyBehavior, locale, onNavigate, passHref, prefetch, replace, scroll, shallow,
    children, ...anchorProperties
  } = properties ?? {};
  const resolvedHref = readHref(href);
  if (legacyBehavior === true && React.isValidElement(children)) {
    return React.cloneElement(children, { href: children.props.href ?? resolvedHref, ref: reference });
  }
  return React.createElement('a', {
    ...anchorProperties,
    'data-react-preview-next-link': '',
    href: resolvedHref,
    ref: reference,
  }, children);
});

PreviewNextLink.displayName = 'PreviewNextLink';
export default PreviewNextLink;
`;
}

/** Creates arbitrary named Google-font factories through safe CommonJS named-import interop. */
function createNextGoogleFontFallbackSource(exportNames: readonly string[]): string {
  const exports = exportNames
    .filter(isSafeJavaScriptIdentifier)
    .map((name) => `export const ${name} = createPreviewFont;`)
    .join('\n');
  return `
/** Returns inert class/style metadata without downloading fonts or evaluating Next configuration. */
function createPreviewFont(options) {
  const variable = options !== null && typeof options === 'object' && typeof options.variable === 'string'
    ? options.variable
    : '';
  return Object.freeze({
    className: 'react-preview-next-font',
    style: Object.freeze({ fontFamily: 'Arial, Helvetica, sans-serif' }),
    variable,
  });
}

/** Every statically imported Google font shares the deterministic local-font contract. */
${exports}
`;
}

/** Reads named imports from one bounded source without evaluating loaders or TypeScript config. */
async function collectNamedFontImports(
  importerPath: string,
  moduleSpecifier: string,
  snapshotSource: string | undefined,
): Promise<readonly string[]> {
  try {
    const sourceStats = await stat(importerPath);
    if (!sourceStats.isFile() || sourceStats.size > MAXIMUM_IMPORTER_BYTES) return [];
    const source = snapshotSource ?? (await readFile(importerPath, 'utf8'));
    if (Buffer.byteLength(source, 'utf8') > MAXIMUM_IMPORTER_BYTES) return [];
    const sourceFile = ts.createSourceFile(
      importerPath,
      source,
      ts.ScriptTarget.Latest,
      false,
      selectScriptKind(importerPath),
    );
    const names = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleSpecifier
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            const importedName = binding.propertyName?.text ?? binding.name.text;
            if (isSafeJavaScriptIdentifier(importedName)) names.add(importedName);
          }
        }
      }
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleSpecifier &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const binding of statement.exportClause.elements) {
          const importedName = binding.propertyName?.text ?? binding.name.text;
          if (isSafeJavaScriptIdentifier(importedName)) names.add(importedName);
        }
      }
    }
    return [...names].sort();
  } catch {
    return [];
  }
}

/** Selects a parser mode from the source filename without loading project compiler options. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Refuses malformed or reserved identifiers before interpolating an ESM export declaration. */
function isSafeJavaScriptIdentifier(value: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    value,
  );
  return (
    scanner.scan() === ts.SyntaxKind.Identifier && scanner.scan() === ts.SyntaxKind.EndOfFileToken
  );
}

/** Reports whether a canonical candidate equals or remains below one canonical workspace root. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
