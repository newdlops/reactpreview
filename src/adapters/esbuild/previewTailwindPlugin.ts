/**
 * Compiles project-owned Tailwind entry styles without executing PostCSS, framework, or Tailwind
 * configuration files. Tailwind v4 uses the package's canonical PostCSS adapter; v2/v3 use the
 * package's PostCSS plugin with a safe in-memory default configuration. Ordinary CSS is left to
 * esbuild, and every optional-tool failure degrades to the original stylesheet plus a warning.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Loader, OnLoadArgs, OnLoadResult, Plugin } from 'esbuild';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { parsePreviewCssImports } from './previewCssImportParser';

/** Project-anchored CommonJS resolver returned by Node's `createRequire`. */
type PreviewProjectRequire = ReturnType<typeof createRequire>;

const CSS_FILTER = /\.css$/i;
const CSS_MODULE_FILTER = /\.module\.css$/iu;
const TAILWIND_MARKER_PATTERN =
  /@(?:apply|custom-variant|reference|source|tailwind|theme|utility|variant)\b|@import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']/iu;
const EXECUTABLE_DIRECTIVE_PATTERN = /@(?:config|plugin)\b/iu;
const EXPLICIT_SOURCE_PATTERN = /@source\s+(?!inline\s*\()(["'])(.*?)\1\s*;/giu;
const IMPORT_SOURCE_MODIFIER_PATTERN = /\bsource\s*\(\s*(none|(["'])(.*?)\2)\s*\)/giu;
const PROJECT_SOURCE_EXTENSIONS = 'html,js,jsx,md,mdx,ts,tsx,vue,svelte';
const MAX_DEPENDENCY_PATHS = 128;
const MAX_EXPLICIT_SOURCE_DIRECTORIES = 16;
const MAX_SNAPSHOT_FILES = 64;
const MAX_SNAPSHOT_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_CANDIDATES = 4_096;
const MAX_INLINE_CANDIDATE_BYTES = 128 * 1024;
const MAX_PREFLIGHT_CSS_FILES = 32;
const MAX_PREFLIGHT_CSS_BYTES = 2 * 1024 * 1024;

/** Minimal PostCSS message fields used for bounded dependency and directory watching. */
interface PreviewPostcssMessage {
  /** Filesystem directory reported by a `dir-dependency` message. */
  readonly dir?: unknown;
  /** Filesystem dependency reported by Tailwind's processor. */
  readonly file?: unknown;
  /** PostCSS result message kind. */
  readonly type?: unknown;
}

/** Structural PostCSS result returned by supported project-local releases. */
interface PreviewPostcssResult {
  /** Fully transformed CSS. */
  readonly css: string;
  /** Optional dependency messages emitted by Tailwind. */
  readonly messages?: readonly PreviewPostcssMessage[];
}

/** Structural PostCSS processor kept independent from any project package's type declarations. */
interface PreviewPostcssProcessor {
  /** Processes one stylesheet while retaining its original filesystem identity. */
  process(source: string, options: { readonly from: string }): Promise<PreviewPostcssResult>;
}

/** Structural Tailwind Oxide scanner used only for dirty in-memory editor snapshots. */
interface PreviewTailwindScanner {
  /** Extracts Tailwind candidates from bounded source strings without filesystem traversal. */
  scanFiles(
    inputs: readonly { readonly content: string; readonly extension: string }[],
  ): readonly string[];
}

/** Constructor exported by v4's Oxide dependency; receives no filesystem glob sources. */
type PreviewTailwindScannerConstructor = new (options: {
  readonly sources: readonly never[];
}) => PreviewTailwindScanner;

/** Loaded project implementation and the policy required to instantiate one safe processor. */
interface PreviewTailwindImplementation {
  /** Adapter generation selected from exact installed packages. */
  readonly kind: 'legacy' | 'v4';
  /** Optional native scanner paired with the v4 adapter. */
  readonly Scanner?: PreviewTailwindScannerConstructor;
  /** Creates a processor for the current bounded dirty-source inventory. */
  createProcessor(snapshotSources: readonly PreviewSnapshotSource[]): PreviewPostcssProcessor;
}

/** One bounded dirty source passed to native candidate extraction or legacy raw content config. */
interface PreviewSnapshotSource {
  /** Extension without the leading period, as expected by Tailwind scanners. */
  readonly extension: string;
  /** In-memory editor contents. */
  readonly sourceText: string;
}

/** Validated explicit `@source` paths used only as narrowly scoped watch evidence. */
interface PreviewExplicitSourceValidation {
  /** Safe existing source directories inside the selected workspace. */
  readonly directories: readonly string[];
  /** Diagnostic explaining why Tailwind execution must be skipped. */
  readonly unsafeReason?: string;
}

/** Result of recursively checking CSS imports before Tailwind can load or execute their directives. */
interface PreviewCssImportPreflight {
  /** Imported CSS files safe to expose as bounded hot-reload dependencies. */
  readonly dependencyPaths: readonly string[];
  /** Explicit safe source directories discovered across the imported style graph. */
  readonly sourceDirectories: readonly string[];
  /** Diagnostic explaining why adapter execution was refused. */
  readonly unsafeReason?: string;
}

/** Result of removing only proven-unresolvable Tailwind package imports from fail-soft CSS. */
interface PreviewTailwindImportFallback {
  /** Whether at least one exact root import was omitted. */
  readonly omittedUnresolvedImport: boolean;
  /** CSS safe to return to esbuild's ordinary loader. */
  readonly source: string;
}

/** Trusted roots and live dirty-source access used by one persistent esbuild context. */
export interface PreviewTailwindPluginOptions {
  /** Nearest package boundary selected for the active preview target. */
  readonly projectRoot: string;
  /** Reads the current serialized rebuild's dirty editor overlays. */
  readonly readSourceSnapshots?: () => readonly PreviewSourceSnapshot[];
  /** Workspace boundary outside which source scanning is forbidden. */
  readonly workspaceRoot: string;
}

/**
 * Creates a project-scoped Tailwind CSS adapter.
 *
 * The callback claims only workspace-owned CSS containing a proven Tailwind directive. It loads
 * canonical package entry points directly and never imports `postcss.config.*`, Next/Vite config,
 * `tailwind.config.*`, or source-authored `@plugin`/`@config` modules.
 *
 * @param options Package roots and current editor-snapshot reader.
 * @returns Esbuild plugin that produces normal CSS or CSS-module output.
 */
export function createPreviewTailwindPlugin(options: PreviewTailwindPluginOptions): Plugin {
  const lexicalWorkspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const defaultProjectRoot = canonicalizeExistingPath(options.projectRoot);
  const implementationByStyleRoot = new Map<string, PreviewTailwindImplementation>();

  return {
    name: 'react-preview-tailwind',
    setup(build): void {
      /** Compiles only Tailwind-marked application CSS while preserving fail-soft rendering. */
      async function loadTailwindStylesheet(
        arguments_: OnLoadArgs,
      ): Promise<OnLoadResult | undefined> {
        const sourcePath = canonicalizeExistingPath(arguments_.path);
        if (!isWorkspaceOwnedCss(sourcePath, workspaceRoot)) return undefined;

        const source = await readFile(sourcePath, 'utf8');
        if (!TAILWIND_MARKER_PATTERN.test(source)) return undefined;
        const loader = selectCssLoader(sourcePath);
        if (EXECUTABLE_DIRECTIVE_PATTERN.test(source)) {
          return createFailSoftResult(
            source,
            sourcePath,
            loader,
            'Tailwind @plugin and @config directives were not executed because preview styles cannot run project-authored configuration code.',
          );
        }

        const explicitSources = validateExplicitSources(source, sourcePath, workspaceRoot);
        if (explicitSources.unsafeReason !== undefined) {
          return createFailSoftResult(source, sourcePath, loader, explicitSources.unsafeReason);
        }

        const styleRoot = findNearestStylePackageRoot(
          sourcePath,
          workspaceRoot,
          defaultProjectRoot,
        );
        const importPreflight = preflightCssImports(source, sourcePath, styleRoot, workspaceRoot);
        if (importPreflight.unsafeReason !== undefined) {
          return createFailSoftResult(source, sourcePath, loader, importPreflight.unsafeReason);
        }
        let implementation = implementationByStyleRoot.get(styleRoot);
        if (implementation === undefined) {
          implementation = loadTailwindImplementation(styleRoot);
          if (implementation !== undefined) {
            implementationByStyleRoot.set(styleRoot, implementation);
          }
        }
        if (implementation === undefined) {
          const pnpManifestPath = findNearestPnpManifest(styleRoot, workspaceRoot);
          const importFallback = omitUnresolvedTailwindRootImports(source, sourcePath);
          const missingAdapterMessage =
            pnpManifestPath === undefined
              ? 'No compatible project-local Tailwind PostCSS adapter was found. Install @tailwindcss/postcss for Tailwind v4 or postcss with tailwindcss for Tailwind v2/v3.'
              : "Yarn PnP zero-install Tailwind packages could not be loaded without activating the workspace's process-wide .pnp.cjs hook, so React Preview retained the authored CSS. Unplug @tailwindcss/postcss, postcss, tailwindcss, and @tailwindcss/oxide or use a node_modules linker.";
          return createFailSoftResult(
            importFallback.source,
            sourcePath,
            loader,
            importFallback.omittedUnresolvedImport
              ? `${missingAdapterMessage} The unresolved @import "tailwindcss" rule was omitted so remaining authored CSS can render.`
              : missingAdapterMessage,
            undefined,
            [
              path.join(styleRoot, 'package.json'),
              ...(pnpManifestPath === undefined ? [] : [pnpManifestPath]),
            ],
          );
        }

        const snapshots = collectSnapshotSources(
          options.readSourceSnapshots?.(),
          lexicalWorkspaceRoot,
          workspaceRoot,
        );
        const inlineCandidates =
          implementation.kind === 'v4' && implementation.Scanner !== undefined
            ? scanInlineCandidates(implementation.Scanner, snapshots)
            : [];
        const processorInput = appendInlineCandidates(source, inlineCandidates);
        try {
          const result = await implementation
            .createProcessor(snapshots)
            .process(processorInput, { from: sourcePath });
          if (result.css.trim().length === 0 && source.trim().length > 0) {
            return createFailSoftResult(
              source,
              sourcePath,
              loader,
              'The project Tailwind adapter emitted an empty stylesheet, so React Preview retained the original CSS.',
            );
          }
          const evidence = collectPostcssEvidence(
            result.messages ?? [],
            sourcePath,
            workspaceRoot,
            [...explicitSources.directories, ...importPreflight.sourceDirectories],
            importPreflight.dependencyPaths,
          );
          return {
            contents: result.css,
            loader,
            resolveDir: path.dirname(sourcePath),
            watchDirs: [...evidence.watchDirectories],
            watchFiles: [...evidence.dependencyPaths],
          };
        } catch (error) {
          return createFailSoftResult(
            source,
            sourcePath,
            loader,
            `Tailwind compilation failed and the original stylesheet was retained: ${describeTailwindError(error)}`,
            error,
          );
        }
      }

      build.onLoad({ filter: CSS_FILTER, namespace: 'file' }, loadTailwindStylesheet);
    },
  };
}

/**
 * Removes exact Tailwind root imports only when Node's inert package resolver cannot find them.
 * Other imports, comments, strings, and Tailwind directives remain byte-for-byte authored. Exact
 * parser ranges avoid a broad regular expression that could rewrite commented documentation.
 */
function omitUnresolvedTailwindRootImports(
  source: string,
  sourcePath: string,
): PreviewTailwindImportFallback {
  const parsedImports = parsePreviewCssImports(source);
  if (
    parsedImports.unsafeReason !== undefined ||
    !parsedImports.imports.some((cssImport) => cssImport.specifier === 'tailwindcss')
  ) {
    return { omittedUnresolvedImport: false, source };
  }
  try {
    createRequire(sourcePath).resolve('tailwindcss');
    return { omittedUnresolvedImport: false, source };
  } catch {
    let output = source;
    for (const cssImport of [...parsedImports.imports].reverse()) {
      if (cssImport.specifier !== 'tailwindcss') continue;
      const removed = source.slice(cssImport.statementStart, cssImport.statementEnd);
      const replacement = removed.replaceAll(/[^\r\n]/gu, ' ');
      output =
        output.slice(0, cssImport.statementStart) +
        replacement +
        output.slice(cssImport.statementEnd);
    }
    return { omittedUnresolvedImport: true, source: output };
  }
}

/** Loads v4 first, then a configuration-free v2/v3 PostCSS fallback from the same package graph. */
function loadTailwindImplementation(styleRoot: string): PreviewTailwindImplementation | undefined {
  const projectRequire = createRequire(path.join(styleRoot, 'package.json'));
  const v4 = loadTailwindV4Implementation(projectRequire, styleRoot);
  return v4 ?? loadLegacyTailwindImplementation(projectRequire, styleRoot);
}

/** Loads Tailwind v4's canonical adapter and its own PostCSS/Oxide dependencies by exact issuer. */
function loadTailwindV4Implementation(
  projectRequire: PreviewProjectRequire,
  styleRoot: string,
): PreviewTailwindImplementation | undefined {
  try {
    const adapterPath = projectRequire.resolve('@tailwindcss/postcss');
    const adapterRequire = createRequire(adapterPath);
    const postcss = readCallableExport(adapterRequire('postcss'));
    const tailwind = readCallableExport(projectRequire('@tailwindcss/postcss'));
    if (postcss === undefined || tailwind === undefined) return undefined;
    const Scanner = readScannerConstructor(safeRequire(adapterRequire, '@tailwindcss/oxide'));
    const processor = readPostcssProcessor(
      postcss([tailwind({ base: styleRoot, optimize: false })]),
    );
    return {
      kind: 'v4',
      ...(Scanner === undefined ? {} : { Scanner }),
      createProcessor: () => processor,
    };
  } catch {
    return undefined;
  }
}

/** Loads Tailwind v2/v3 with inert default content options instead of executing its config file. */
function loadLegacyTailwindImplementation(
  projectRequire: PreviewProjectRequire,
  styleRoot: string,
): PreviewTailwindImplementation | undefined {
  try {
    const tailwindPath = projectRequire.resolve('tailwindcss');
    const tailwindRequire = createRequire(tailwindPath);
    const postcss =
      readCallableExport(safeRequire(tailwindRequire, 'postcss')) ??
      readCallableExport(projectRequire('postcss'));
    const tailwind = readCallableExport(projectRequire('tailwindcss'));
    if (postcss === undefined || tailwind === undefined) return undefined;
    const majorVersion = readPackageMajorVersion(tailwindPath, 'tailwindcss');
    return {
      kind: 'legacy',
      createProcessor: (snapshotSources) => {
        const content = createLegacyContentInventory(styleRoot, snapshotSources);
        const safeConfiguration =
          majorVersion !== undefined && majorVersion < 3 ? { purge: content } : { content };
        return readPostcssProcessor(postcss([tailwind(safeConfiguration)]));
      },
    };
  } catch {
    return undefined;
  }
}

/** Reads a function from CommonJS, transpiled default, or native ESM interop values. */
function readCallableExport(value: unknown): ((...arguments_: unknown[]) => unknown) | undefined {
  if (typeof value === 'function') return value as (...arguments_: unknown[]) => unknown;
  if (typeof value !== 'object' || value === null || !('default' in value)) return undefined;
  const defaultExport = (value as { readonly default?: unknown }).default;
  return typeof defaultExport === 'function'
    ? (defaultExport as (...arguments_: unknown[]) => unknown)
    : undefined;
}

/** Narrows an arbitrary processor value before project code can influence later compiler logic. */
function readPostcssProcessor(value: unknown): PreviewPostcssProcessor {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('process' in value) ||
    typeof (value as { readonly process?: unknown }).process !== 'function'
  ) {
    throw new TypeError('The project PostCSS package returned no compatible processor.');
  }
  return value as PreviewPostcssProcessor;
}

/** Attempts one package import without allowing an optional dependency miss to escape. */
function safeRequire(require_: PreviewProjectRequire, specifier: string): unknown {
  try {
    return require_(specifier) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads the native scanner constructor without trusting unrelated package export properties. */
function readScannerConstructor(value: unknown): PreviewTailwindScannerConstructor | undefined {
  if (typeof value !== 'object' || value === null || !('Scanner' in value)) return undefined;
  const Scanner = (value as { readonly Scanner?: unknown }).Scanner;
  return typeof Scanner === 'function' ? (Scanner as PreviewTailwindScannerConstructor) : undefined;
}

/** Reads only Tailwind's inert package version to choose v2 versus v3 content option syntax. */
function readPackageMajorVersion(
  packageEntryPath: string,
  packageName: string,
): number | undefined {
  try {
    const manifestPath = findOwningPackageManifest(packageEntryPath, packageName);
    if (manifestPath === undefined) return undefined;
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest
        ? (manifest as { readonly version?: unknown }).version
        : undefined;
    const match = typeof version === 'string' ? /^(\d+)\./u.exec(version) : undefined;
    return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
  } catch {
    return undefined;
  }
}

/** Finds the inert owning manifest even when package exports hide the package.json subpath. */
function findOwningPackageManifest(
  packageEntryPath: string,
  expectedPackageName: string,
): string | undefined {
  let current = path.dirname(packageEntryPath);
  for (;;) {
    const manifestPath = path.join(current, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (
          typeof manifest === 'object' &&
          manifest !== null &&
          'name' in manifest &&
          (manifest as { readonly name?: unknown }).name === expectedPackageName
        ) {
          return manifestPath;
        }
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Creates safe conventional legacy content roots plus bounded raw dirty-editor overlays. */
function createLegacyContentInventory(
  styleRoot: string,
  snapshots: readonly PreviewSnapshotSource[],
): readonly unknown[] {
  const directories = ['app', 'components', 'pages', 'src']
    .map((directory) => path.join(styleRoot, directory))
    .filter((directory) => existsSync(directory));
  return [
    ...directories.map((directory) => path.join(directory, `**/*.{${PROJECT_SOURCE_EXTENSIONS}}`)),
    ...snapshots.map((snapshot) => ({
      extension: snapshot.extension,
      raw: snapshot.sourceText,
    })),
  ];
}

/** Selects only bounded, workspace-owned dirty source strings for candidate discovery. */
function collectSnapshotSources(
  snapshots: readonly PreviewSourceSnapshot[] | undefined,
  lexicalWorkspaceRoot: string,
  canonicalWorkspaceRoot: string,
): readonly PreviewSnapshotSource[] {
  if (snapshots === undefined) return [];
  const output: PreviewSnapshotSource[] = [];
  let totalBytes = 0;
  for (const snapshot of snapshots.slice(0, MAX_SNAPSHOT_FILES)) {
    const lexicalSourcePath = path.resolve(snapshot.documentPath);
    const sourcePath = canonicalizeExistingPath(snapshot.documentPath);
    if (
      !isPathInside(canonicalWorkspaceRoot, sourcePath) &&
      !isPathInside(lexicalWorkspaceRoot, lexicalSourcePath)
    ) {
      continue;
    }
    const extension = path.extname(sourcePath).slice(1).toLowerCase();
    if (!/^(?:[cm]?[jt]sx?|html|mdx?|svelte|vue)$/u.test(extension)) continue;
    const sourceBytes = Buffer.byteLength(snapshot.sourceText, 'utf8');
    if (totalBytes + sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) break;
    totalBytes += sourceBytes;
    output.push({ extension, sourceText: snapshot.sourceText });
  }
  return output;
}

/** Extracts and bounds v4 candidates so unsaved class edits participate in the same rebuild. */
function scanInlineCandidates(
  Scanner: PreviewTailwindScannerConstructor,
  sources: readonly PreviewSnapshotSource[],
): readonly string[] {
  if (sources.length === 0) return [];
  try {
    const scanner = new Scanner({ sources: [] });
    const candidates = scanner.scanFiles(
      sources.map((source) => ({ content: source.sourceText, extension: source.extension })),
    );
    const output: string[] = [];
    let totalBytes = 0;
    for (const candidate of [...new Set(candidates)].sort()) {
      if (candidate.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(candidate)) continue;
      const candidateBytes = Buffer.byteLength(candidate, 'utf8');
      if (
        output.length >= MAX_INLINE_CANDIDATES ||
        totalBytes + candidateBytes > MAX_INLINE_CANDIDATE_BYTES
      ) {
        break;
      }
      totalBytes += candidateBytes;
      output.push(candidate);
    }
    return output;
  } catch {
    return [];
  }
}

/** Adds one inert v4 inline source directive containing only native-scanner candidates. */
function appendInlineCandidates(source: string, candidates: readonly string[]): string {
  if (candidates.length === 0) return source;
  const value = candidates.join(' ').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `${source}\n@source inline("${value}");\n`;
}

/**
 * Recursively checks bounded CSS imports before Tailwind's adapter receives the root source.
 *
 * Tailwind v4 expands CSS imports and can execute nested `@plugin` or `@config` directives during
 * that expansion. This inert preflight follows relative files and exact bare CSS package exports,
 * rejects executable directives anywhere in that graph, and refuses an unresolved/oversized graph
 * instead of allowing uninspected project code to reach the extension host.
 */
function preflightCssImports(
  rootSource: string,
  rootSourcePath: string,
  styleRoot: string,
  workspaceRoot: string,
): PreviewCssImportPreflight {
  const projectRequire = createRequire(path.join(styleRoot, 'package.json'));
  const dependencyPaths = new Set<string>();
  const sourceDirectories = new Set<string>();
  const pending = [{ source: rootSource, sourcePath: rootSourcePath }];
  const visited = new Set<string>();
  let totalBytes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const identity = canonicalizeExistingPath(current.sourcePath);
    if (visited.has(identity)) continue;
    visited.add(identity);
    totalBytes += Buffer.byteLength(current.source, 'utf8');
    if (visited.size > MAX_PREFLIGHT_CSS_FILES || totalBytes > MAX_PREFLIGHT_CSS_BYTES) {
      return {
        dependencyPaths: [...dependencyPaths],
        sourceDirectories: [...sourceDirectories],
        unsafeReason: `Tailwind CSS import preflight exceeded ${MAX_PREFLIGHT_CSS_FILES.toString()} files or ${(MAX_PREFLIGHT_CSS_BYTES / (1024 * 1024)).toString()} MiB. Narrow the imported style graph to enable safe compilation.`,
      };
    }
    if (
      current.sourcePath !== rootSourcePath &&
      EXECUTABLE_DIRECTIVE_PATTERN.test(current.source)
    ) {
      return {
        dependencyPaths: [...dependencyPaths],
        sourceDirectories: [...sourceDirectories],
        unsafeReason: `Tailwind compilation skipped because imported CSS contains @plugin or @config: ${path.basename(current.sourcePath)}`,
      };
    }
    const explicitSources = validateExplicitSources(
      current.source,
      current.sourcePath,
      workspaceRoot,
    );
    if (explicitSources.unsafeReason !== undefined) {
      return {
        dependencyPaths: [...dependencyPaths],
        sourceDirectories: [...sourceDirectories],
        unsafeReason: explicitSources.unsafeReason,
      };
    }
    for (const directory of explicitSources.directories) {
      if (sourceDirectories.size < MAX_EXPLICIT_SOURCE_DIRECTORIES) {
        sourceDirectories.add(directory);
      }
    }

    const parsedImports = parsePreviewCssImports(current.source);
    if (parsedImports.unsafeReason !== undefined) {
      return {
        dependencyPaths: [...dependencyPaths],
        sourceDirectories: [...sourceDirectories],
        unsafeReason: `${parsedImports.unsafeReason} File: ${path.basename(current.sourcePath)}`,
      };
    }
    for (const cssImport of parsedImports.imports) {
      const { modifiers, specifier } = cssImport;
      const modifierValidation = validateImportSourceModifier(
        specifier,
        modifiers,
        current.sourcePath,
        workspaceRoot,
      );
      if (modifierValidation.unsafeReason !== undefined) {
        return {
          dependencyPaths: [...dependencyPaths],
          sourceDirectories: [...sourceDirectories],
          unsafeReason: modifierValidation.unsafeReason,
        };
      }
      for (const directory of modifierValidation.directories) {
        if (sourceDirectories.size < MAX_EXPLICIT_SOURCE_DIRECTORIES) {
          sourceDirectories.add(directory);
        }
      }
      if (specifier === 'tailwindcss' || specifier.startsWith('tailwindcss/')) continue;
      const importedPath = resolveImportedCssPath(
        specifier,
        current.sourcePath,
        projectRequire,
        workspaceRoot,
      );
      if (importedPath === undefined) {
        return {
          dependencyPaths: [...dependencyPaths],
          sourceDirectories: [...sourceDirectories],
          unsafeReason: `Tailwind CSS import could not be safely inspected before compilation: ${specifier}`,
        };
      }
      if (visited.has(importedPath)) continue;
      try {
        const importedSource = readFileSync(importedPath, 'utf8');
        dependencyPaths.add(importedPath);
        pending.push({ source: importedSource, sourcePath: importedPath });
      } catch {
        return {
          dependencyPaths: [...dependencyPaths],
          sourceDirectories: [...sourceDirectories],
          unsafeReason: `Tailwind CSS import could not be read before compilation: ${specifier}`,
        };
      }
    }
  }
  return {
    dependencyPaths: [...dependencyPaths].sort(),
    sourceDirectories: [...sourceDirectories].sort(),
  };
}

/** Applies the same canonical workspace policy to Tailwind v4 import `source(...)` modifiers. */
function validateImportSourceModifier(
  specifier: string,
  modifiers: string,
  sourcePath: string,
  workspaceRoot: string,
): PreviewExplicitSourceValidation {
  if (!specifier.startsWith('tailwindcss') || !/\bsource\s*\(/iu.test(modifiers)) {
    return { directories: [] };
  }
  const matches = [...modifiers.matchAll(IMPORT_SOURCE_MODIFIER_PATTERN)];
  const occurrenceCount = [...modifiers.matchAll(/\bsource\s*\(/giu)].length;
  if (matches.length !== 1 || occurrenceCount !== 1) {
    return {
      directories: [],
      unsafeReason: 'Tailwind import source(...) contains an unsupported or ambiguous path.',
    };
  }
  const value = matches[0]?.[1];
  if (value === 'none') return { directories: [] };
  const request = matches[0]?.[3];
  return validateOneExplicitSource(request, sourcePath, workspaceRoot);
}

/** Resolves relative/application CSS and exact bare CSS exports without executing package code. */
function resolveImportedCssPath(
  specifier: string,
  importerPath: string,
  projectRequire: PreviewProjectRequire,
  workspaceRoot: string,
): string | undefined {
  const cleanSpecifier = specifier.split(/[?#]/u, 1)[0];
  if (cleanSpecifier === undefined || cleanSpecifier.length === 0) return undefined;
  const isRelative = cleanSpecifier.startsWith('./') || cleanSpecifier.startsWith('../');
  if (isRelative || path.isAbsolute(cleanSpecifier)) {
    const candidate = path.resolve(path.dirname(importerPath), cleanSpecifier);
    const canonicalCandidate = canonicalizeExistingPath(candidate);
    return isPathInside(workspaceRoot, canonicalCandidate) && CSS_FILTER.test(canonicalCandidate)
      ? canonicalCandidate
      : undefined;
  }
  try {
    const resolved = canonicalizeExistingPath(projectRequire.resolve(cleanSpecifier));
    return CSS_FILTER.test(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** Refuses executable directives and explicit filesystem scans that escape the workspace. */
function validateExplicitSources(
  source: string,
  sourcePath: string,
  workspaceRoot: string,
): PreviewExplicitSourceValidation {
  const directories = new Set<string>();
  for (const match of source.matchAll(EXPLICIT_SOURCE_PATTERN)) {
    const validation = validateOneExplicitSource(match[2], sourcePath, workspaceRoot);
    if (validation.unsafeReason !== undefined) return validation;
    for (const directory of validation.directories) {
      if (directories.size < MAX_EXPLICIT_SOURCE_DIRECTORIES) directories.add(directory);
    }
  }
  return { directories: [...directories].sort() };
}

/** Validates one quoted source request and returns its canonical existing scan base. */
function validateOneExplicitSource(
  request: string | undefined,
  sourcePath: string,
  workspaceRoot: string,
): PreviewExplicitSourceValidation {
  if (request === undefined || request.length === 0 || /[\u0000\r\n]/u.test(request)) {
    return { directories: [], unsafeReason: 'Tailwind @source contains an invalid path.' };
  }
  const sourceBase = resolveStaticGlobBase(path.dirname(sourcePath), request);
  const canonicalBase = canonicalizeExistingPath(sourceBase);
  if (
    !isPathInside(workspaceRoot, canonicalBase) ||
    path.relative(workspaceRoot, canonicalBase).split(path.sep).includes('node_modules')
  ) {
    return {
      directories: [],
      unsafeReason: `Tailwind @source was not scanned because it resolves outside workspace-owned source: ${request}`,
    };
  }
  return { directories: [canonicalBase] };
}

/** Resolves the non-glob prefix of one explicit source path for canonical boundary validation. */
function resolveStaticGlobBase(importerDirectory: string, request: string): string {
  if (/^[a-z][a-z\d+.-]*:/iu.test(request)) return request;
  const wildcardIndex = request.search(/[!*?{[]/u);
  const staticRequest = wildcardIndex < 0 ? request : request.slice(0, wildcardIndex);
  const resolved = path.resolve(importerDirectory, staticRequest || '.');
  const existing = findNearestExistingPath(resolved);
  try {
    return realpathSync.native(existing);
  } catch {
    return existing;
  }
}

/** Finds an existing ancestor so a missing glob leaf cannot conceal a symlink escape. */
function findNearestExistingPath(candidatePath: string): string {
  let current = candidatePath;
  for (;;) {
    if (existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** Finds the nearest application package around each CSS entry, with target package fallback. */
function findNearestStylePackageRoot(
  sourcePath: string,
  workspaceRoot: string,
  defaultProjectRoot: string,
): string {
  let current = path.dirname(sourcePath);
  while (isPathInside(workspaceRoot, current)) {
    if (existsSync(path.join(current, 'package.json'))) return current;
    if (current === workspaceRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return isPathInside(workspaceRoot, defaultProjectRoot) ? defaultProjectRoot : workspaceRoot;
}

/** Finds inert PnP evidence for an actionable fail-soft diagnostic without executing its hook. */
function findNearestPnpManifest(styleRoot: string, workspaceRoot: string): string | undefined {
  let current = path.resolve(styleRoot);
  while (isPathInside(workspaceRoot, current)) {
    const candidate = path.join(current, '.pnp.cjs');
    if (existsSync(candidate)) return candidate;
    if (current === workspaceRoot) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/** Retains only small style/config dependencies and explicit safe source directories. */
function collectPostcssEvidence(
  messages: readonly PreviewPostcssMessage[],
  sourcePath: string,
  workspaceRoot: string,
  explicitSourceDirectories: readonly string[],
  preflightDependencies: readonly string[],
): { readonly dependencyPaths: readonly string[]; readonly watchDirectories: readonly string[] } {
  const dependencies = new Set<string>([sourcePath, ...preflightDependencies]);
  for (const message of messages) {
    if (message.type !== 'dependency' || typeof message.file !== 'string') continue;
    const dependencyPath = canonicalizeExistingPath(message.file);
    if (!isPathInside(workspaceRoot, dependencyPath) || !CSS_FILTER.test(dependencyPath)) continue;
    if (dependencies.size < MAX_DEPENDENCY_PATHS) dependencies.add(dependencyPath);
  }
  const watchDirectories = [
    ...new Set(
      explicitSourceDirectories.filter((directory) => isPathInside(workspaceRoot, directory)),
    ),
  ]
    .sort()
    .slice(0, MAX_EXPLICIT_SOURCE_DIRECTORIES);
  return { dependencyPaths: [...dependencies].sort(), watchDirectories };
}

/** Returns original CSS with an actionable non-fatal diagnostic. */
function createFailSoftResult(
  source: string,
  sourcePath: string,
  loader: Loader,
  message: string,
  error?: unknown,
  additionalWatchFiles: readonly string[] = [],
): OnLoadResult {
  return {
    contents: source,
    loader,
    resolveDir: path.dirname(sourcePath),
    warnings: [{ ...(error === undefined ? {} : { detail: error }), text: message }],
    watchFiles: [
      sourcePath,
      ...additionalWatchFiles.filter((candidate) => existsSync(candidate)).slice(0, 4),
    ],
  };
}

/** Rejects package CSS and any file not canonically contained by the workspace. */
function isWorkspaceOwnedCss(sourcePath: string, workspaceRoot: string): boolean {
  if (!isPathInside(workspaceRoot, sourcePath) || !CSS_FILTER.test(sourcePath)) return false;
  return !path.relative(workspaceRoot, sourcePath).split(path.sep).includes('node_modules');
}

/** Preserves esbuild's CSS Modules semantics after Tailwind compilation. */
function selectCssLoader(sourcePath: string): Loader {
  return CSS_MODULE_FILTER.test(sourcePath) ? 'local-css' : 'css';
}

/** Reports whether a canonical candidate equals or remains below one canonical root. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Converts arbitrary package failures to one bounded single-line diagnostic. */
function describeTailwindError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/gu, ' ').trim().slice(0, 1_000);
}
