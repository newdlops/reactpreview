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
import { normalizePreviewCssFailSoftPrelude } from './previewCssFailSoftNormalization';
import { parsePreviewCssImports } from './previewCssImportParser';
import { resolvePreviewInstalledCssPackageStylePath } from './previewCssPackageStylePath';
import { parsePreviewCssReferences } from './previewCssReferenceParser';
import { runPreviewSerialWork } from './previewSerialWorkQueue';
import { boundPreviewTailwindSourceDiscovery } from './previewTailwindBoundedSources';
import {
  appendPreviewTailwindInlineCandidates,
  collectPreviewTailwindSnapshotSources,
  scanPreviewTailwindInlineCandidates,
} from './previewTailwindCandidates';
import {
  loadPreviewTailwindImplementation,
  type PreviewPostcssMessage,
  type PreviewTailwindImplementation,
} from './previewTailwindImplementation';
import {
  createPreviewWorkspacePackageResolver,
  type PreviewWorkspacePackageResolver,
} from './previewWorkspacePackageResolver';

/** Project-anchored resolver used while rewriting admitted CSS package imports. */
type PreviewProjectRequire = ReturnType<typeof createRequire>;

const CSS_FILTER = /\.css$/i;
const CSS_MODULE_FILTER = /\.module\.css$/iu;
const TAILWIND_MARKER_PATTERN =
  /@(?:apply|custom-variant|reference|source|tailwind|theme|utility|variant)\b|@import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']/iu;
const EXECUTABLE_DIRECTIVE_PATTERN = /@(?:config|plugin)\b/iu;
const EXPLICIT_SOURCE_PATTERN = /@source\s+(?!inline\s*\()(["'])(.*?)\1\s*;/giu;
const IMPORT_SOURCE_MODIFIER_PATTERN = /\bsource\s*\(\s*(none|(["'])(.*?)\2)\s*\)/giu;
const MAX_DEPENDENCY_PATHS = 128;
const MAX_EXPLICIT_SOURCE_DIRECTORIES = 16;
const MAX_PREFLIGHT_CSS_FILES = 32;
const MAX_PREFLIGHT_CSS_BYTES = 2 * 1024 * 1024;

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
  /** Bare root imports still absent after project and managed-package resolution. */
  readonly unresolvedRootImports: readonly string[];
  /** Diagnostic explaining why adapter execution was refused. */
  readonly unsafeReason?: string;
}

/** Result of removing direct executable Tailwind directives without evaluating their modules. */
interface PreviewTailwindExecutableDirectiveOmission {
  /** Whether one or more complete quoted directives were made inert. */
  readonly omitted: boolean;
  /** Source with each omitted statement replaced by spaces while preserving newlines. */
  readonly source: string;
  /** True when an executable directive remained because its grammar was not safely understood. */
  readonly unsafeRemainder: boolean;
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
  /** Disables package-wide v4 scans after a complete page corridor supplied bounded sources. */
  readonly boundedSourceDiscovery?: boolean;
  /** Immutable managed-store package roots used only after ordinary project resolution misses. */
  readonly fallbackNodeModulesPaths?: readonly string[];
  /** Exact retry-scoped CSS imports already admitted for an empty render-only contract. */
  readonly hintedStyleFallbacks?: readonly {
    readonly moduleSpecifier: string;
    readonly sourcePath: string;
  }[];
  /** Nearest package boundary selected for the active preview target. */
  readonly projectRoot: string;
  /** Reads the current serialized rebuild's dirty editor overlays. */
  readonly readSourceSnapshots?: () => readonly PreviewSourceSnapshot[];
  /** Declared lock-backed compiler package whose absence should trigger managed acquisition. */
  readonly requiredCompilerPackage?: string;
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
  const fallbackNodeModulesPaths = Object.freeze([
    ...new Set((options.fallbackNodeModulesPaths ?? []).map(canonicalizeExistingPath)),
  ]);
  const hintedStyleFallbacks = new Set(
    (options.hintedStyleFallbacks ?? []).map(
      (hint) => `${canonicalizeExistingPath(hint.sourcePath)}\0${hint.moduleSpecifier}`,
    ),
  );
  const implementationByStyleRoot = new Map<string, PreviewTailwindImplementation>();
  const processingQueueByStyleRoot = new Map<string, Promise<void>>();
  const workspacePackageResolver = createPreviewWorkspacePackageResolver(workspaceRoot);
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
        const executableDirectives = omitPreviewTailwindExecutableDirectives(source);
        if (executableDirectives.unsafeRemainder) {
          return createFailSoftResult(
            source,
            sourcePath,
            loader,
            'Tailwind @plugin and @config directives were not executed because one or more executable directives could not be made inert safely.',
          );
        }

        const boundedSource = options.boundedSourceDiscovery
          ? boundPreviewTailwindSourceDiscovery(executableDirectives.source).source
          : executableDirectives.source;
        const explicitSources = validateExplicitSources(boundedSource, sourcePath, workspaceRoot);
        if (explicitSources.unsafeReason !== undefined) {
          return createFailSoftResult(source, sourcePath, loader, explicitSources.unsafeReason);
        }

        const styleRoot = findNearestStylePackageRoot(
          sourcePath,
          workspaceRoot,
          defaultProjectRoot,
        );
        const importPreflight = preflightCssImports(
          boundedSource,
          sourcePath,
          styleRoot,
          workspaceRoot,
          workspacePackageResolver,
          fallbackNodeModulesPaths,
        );
        if (importPreflight.unsafeReason !== undefined) {
          return createFailSoftResult(source, sourcePath, loader, importPreflight.unsafeReason);
        }
        const admittedUnresolvedImports = new Set(
          importPreflight.unresolvedRootImports.filter((moduleSpecifier) =>
            hintedStyleFallbacks.has(`${sourcePath}\0${moduleSpecifier}`),
          ),
        );
        const unadmittedUnresolvedImports = importPreflight.unresolvedRootImports.filter(
          (moduleSpecifier) => !admittedUnresolvedImports.has(moduleSpecifier),
        );
        let implementation = implementationByStyleRoot.get(styleRoot);
        if (implementation === undefined) {
          implementation = loadPreviewTailwindImplementation(styleRoot, fallbackNodeModulesPaths);
          if (implementation !== undefined) {
            implementationByStyleRoot.set(styleRoot, implementation);
          }
        }
        const requiredCompilerPackage = options.requiredCompilerPackage;
        if (
          requiredCompilerPackage !== undefined &&
          (implementation === undefined || unadmittedUnresolvedImports.length > 0)
        ) {
          return createMissingTailwindDependencyResult(
            sourcePath,
            defaultProjectRoot,
            implementation === undefined ? requiredCompilerPackage : undefined,
            unadmittedUnresolvedImports,
          );
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
        if (unadmittedUnresolvedImports.length > 0) {
          return createFailSoftResult(
            source,
            sourcePath,
            loader,
            `Tailwind CSS imports could not be safely inspected before compilation: ${unadmittedUnresolvedImports.join(', ')}`,
          );
        }
        if (
          implementation.kind === 'v4' &&
          loader === 'css' &&
          isStandaloneApplyStylesheet(source)
        ) {
          // Tailwind v4 deterministically rejects @apply files that omit both @reference and a
          // theme/import context. Generated style registries commonly import these leaves beneath
          // one contextual parent; preserve them for ordinary CSS bundling instead of allocating
          // and failing an independent Tailwind graph for every sibling file.
          return {
            contents: source,
            loader,
            resolveDir: path.dirname(sourcePath),
          };
        }

        const snapshots = collectPreviewTailwindSnapshotSources(
          options.readSourceSnapshots?.(),
          lexicalWorkspaceRoot,
          workspaceRoot,
        );
        const inlineCandidates =
          implementation.kind === 'v4' && implementation.Scanner !== undefined
            ? scanPreviewTailwindInlineCandidates(implementation.Scanner, snapshots)
            : [];
        const processorSource = rewriteWorkspaceCssImportFallbacks(
          boundedSource,
          sourcePath,
          styleRoot,
          workspaceRoot,
          workspacePackageResolver,
          fallbackNodeModulesPaths,
          admittedUnresolvedImports,
        );
        const processorInput = appendPreviewTailwindInlineCandidates(
          processorSource,
          inlineCandidates,
        );
        try {
          // Esbuild may load sibling CSS files concurrently. Tailwind v4 reuses one processor per
          // package root, while each run may allocate a large candidate graph. Serializing only
          // this processor boundary bounds peak memory without blocking unrelated packages.
          const result = await runPreviewSerialWork(processingQueueByStyleRoot, styleRoot, () =>
            implementation.createProcessor(snapshots).process(processorInput, { from: sourcePath }),
          );
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
            warnings: executableDirectives.omitted
              ? [
                  {
                    text: 'React Preview omitted direct Tailwind @plugin/@config execution while compiling the remaining bounded application styles.',
                  },
                ]
              : [],
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

/** Makes direct quoted module directives inert while preserving CSS offsets and authored rules. */
function omitPreviewTailwindExecutableDirectives(
  source: string,
): PreviewTailwindExecutableDirectiveOmission {
  const ranges: { readonly end: number; readonly start: number }[] = [];
  let unsafeRemainder = false;
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) break;
      index = commentEnd + 2;
      continue;
    }
    const character = source[index];
    if (character === '"' || character === "'") {
      index = findPreviewCssStringEnd(source, index, character);
      continue;
    }
    const directive = readPreviewTailwindExecutableDirective(source, index);
    if (directive === undefined) {
      index += 1;
      continue;
    }
    let cursor = directive.keywordEnd;
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      unsafeRemainder = true;
      index = directive.keywordEnd;
      continue;
    }
    const stringEnd = findPreviewCssStringEnd(source, cursor, quote);
    if (stringEnd <= cursor || stringEnd >= source.length) {
      unsafeRemainder = true;
      break;
    }
    cursor = stringEnd;
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== ';') {
      unsafeRemainder = true;
      index = cursor + 1;
      continue;
    }
    ranges.push({ end: cursor + 1, start: index });
    index = cursor + 1;
  }
  let output = source;
  for (const range of ranges.reverse()) {
    const statement = output.slice(range.start, range.end);
    output =
      output.slice(0, range.start) +
      statement.replaceAll(/[^\r\n]/gu, ' ') +
      output.slice(range.end);
  }
  return { omitted: ranges.length > 0, source: output, unsafeRemainder };
}

/** Reads one complete executable at-rule keyword outside comments and strings. */
function readPreviewTailwindExecutableDirective(
  source: string,
  index: number,
): { readonly keywordEnd: number } | undefined {
  for (const keyword of ['@plugin', '@config']) {
    if (source.slice(index, index + keyword.length).toLowerCase() !== keyword) continue;
    if (/[-_a-z\d]/iu.test(source[index + keyword.length] ?? '')) continue;
    return { keywordEnd: index + keyword.length };
  }
  return undefined;
}

/** Returns the character after a CSS string, or the source length when it is malformed. */
function findPreviewCssStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return source.length;
}

/** Emits ordinary missing-package diagnostics so the existing lock-backed recovery can cooperate. */
function createMissingTailwindDependencyResult(
  sourcePath: string,
  projectRoot: string,
  compilerPackage: string | undefined,
  stylesheetImports: readonly string[],
): OnLoadResult {
  const missing = [
    ...(compilerPackage === undefined
      ? []
      : [{ file: path.join(projectRoot, 'postcss.config.mjs'), specifier: compilerPackage }]),
    ...stylesheetImports.map((specifier) => ({ file: sourcePath, specifier })),
  ];
  return {
    errors: [...new Map(missing.map((item) => [item.specifier, item] as const)).values()].map(
      ({ file, specifier }) => ({
        location: { column: 0, file, length: specifier.length, line: 1, lineText: '' },
        text: `Could not resolve ${JSON.stringify(specifier)}`,
      }),
    ),
  };
}

/** Distinguishes package CSS requests from relative paths and URL schemes. */
function isBareCssModuleSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('.') &&
    !path.isAbsolute(specifier) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(specifier)
  );
}

/** Detects a v4-invalid independent @apply leaf without mistaking a contextual stylesheet. */
function isStandaloneApplyStylesheet(source: string): boolean {
  return (
    /@apply\b/iu.test(source) &&
    !/@(?:custom-variant|import|reference|tailwind|theme|utility)\b/iu.test(source)
  );
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
  workspacePackageResolver: PreviewWorkspacePackageResolver,
  fallbackNodeModulesPaths: readonly string[] = [],
): PreviewCssImportPreflight {
  const projectRequire = createRequire(path.join(styleRoot, 'package.json'));
  const dependencyPaths = new Set<string>();
  const sourceDirectories = new Set<string>();
  const unresolvedRootImports = new Set<string>();
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
        unresolvedRootImports: [...unresolvedRootImports],
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
        unresolvedRootImports: [...unresolvedRootImports],
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
        unresolvedRootImports: [...unresolvedRootImports],
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
        unresolvedRootImports: [...unresolvedRootImports],
        unsafeReason: `${parsedImports.unsafeReason} File: ${path.basename(current.sourcePath)}`,
      };
    }
    const parsedReferences = parsePreviewCssReferences(current.source);
    if (parsedReferences.unsafeReason !== undefined) {
      return {
        dependencyPaths: [...dependencyPaths],
        sourceDirectories: [...sourceDirectories],
        unresolvedRootImports: [...unresolvedRootImports],
        unsafeReason: `${parsedReferences.unsafeReason} File: ${path.basename(current.sourcePath)}`,
      };
    }
    const dependencyRequests = [
      ...parsedImports.imports.map(({ modifiers, specifier }) => ({ modifiers, specifier })),
      ...parsedReferences.references.map(({ specifier }) => ({ modifiers: '', specifier })),
    ];
    for (const { modifiers, specifier } of dependencyRequests) {
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
          unresolvedRootImports: [...unresolvedRootImports],
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
        styleRoot,
        projectRequire,
        workspaceRoot,
        workspacePackageResolver,
        fallbackNodeModulesPaths,
      );
      if (importedPath === undefined) {
        if (current.sourcePath === rootSourcePath && isBareCssModuleSpecifier(specifier)) {
          unresolvedRootImports.add(specifier);
          continue;
        }
        return {
          dependencyPaths: [...dependencyPaths],
          sourceDirectories: [...sourceDirectories],
          unresolvedRootImports: [...unresolvedRootImports],
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
          unresolvedRootImports: [...unresolvedRootImports],
          unsafeReason: `Tailwind CSS import could not be read before compilation: ${specifier}`,
        };
      }
    }
  }
  return {
    dependencyPaths: [...dependencyPaths].sort(),
    sourceDirectories: [...sourceDirectories].sort(),
    unresolvedRootImports: [...unresolvedRootImports].sort(),
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
  styleRoot: string,
  projectRequire: PreviewProjectRequire,
  workspaceRoot: string,
  workspacePackageResolver: PreviewWorkspacePackageResolver,
  fallbackNodeModulesPaths: readonly string[] = [],
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
  const packageStylePath = resolvePreviewInstalledCssPackageStylePath(cleanSpecifier, [
    path.dirname(importerPath),
    styleRoot,
    workspaceRoot,
    ...fallbackNodeModulesPaths,
  ]);
  if (packageStylePath !== undefined) return packageStylePath;
  try {
    const resolved = canonicalizeExistingPath(projectRequire.resolve(cleanSpecifier));
    return CSS_FILTER.test(resolved) ? resolved : undefined;
  } catch {
    return resolveWorkspaceCssFallback(cleanSpecifier, workspaceRoot, workspacePackageResolver);
  }
}

/**
 * Resolves an unbuilt workspace package's CSS source after its installed export target misses.
 * The shared resolver reads only workspace manifests and existing files; this final CSS/boundary
 * check prevents its broader JavaScript source support from widening Tailwind's import policy.
 */
function resolveWorkspaceCssFallback(
  specifier: string,
  workspaceRoot: string,
  workspacePackageResolver: PreviewWorkspacePackageResolver,
): string | undefined {
  const resolvedPath = workspacePackageResolver.resolve(specifier);
  if (resolvedPath === undefined) return undefined;
  const canonicalPath = canonicalizeExistingPath(resolvedPath);
  return CSS_FILTER.test(canonicalPath) && isPathInside(workspaceRoot, canonicalPath)
    ? canonicalPath
    : undefined;
}

/**
 * Redirects only bare CSS imports whose normal package export is absent to proven workspace source.
 * Tailwind's PostCSS adapter performs its own import resolution and therefore cannot observe
 * esbuild's workspace-package fallback. Relative paths keep the transformed request portable and
 * preserve every authored layer/supports/media modifier while avoiding project code execution.
 */
function rewriteWorkspaceCssImportFallbacks(
  source: string,
  sourcePath: string,
  styleRoot: string,
  workspaceRoot: string,
  workspacePackageResolver: PreviewWorkspacePackageResolver,
  fallbackNodeModulesPaths: readonly string[] = [],
  admittedUnresolvedImports: ReadonlySet<string> = new Set(),
): string {
  const parsedImports = parsePreviewCssImports(source);
  if (parsedImports.unsafeReason !== undefined) return source;
  const projectRequire = createRequire(path.join(styleRoot, 'package.json'));
  let output = source;
  for (const cssImport of [...parsedImports.imports].reverse()) {
    const cleanSpecifier = cssImport.specifier.split(/[?#]/u, 1)[0];
    if (
      cleanSpecifier === undefined ||
      cleanSpecifier.length === 0 ||
      cleanSpecifier.startsWith('.') ||
      path.isAbsolute(cleanSpecifier)
    ) {
      continue;
    }
    try {
      projectRequire.resolve(cleanSpecifier);
      continue;
    } catch {
      const fallbackPath =
        resolvePreviewInstalledCssPackageStylePath(cleanSpecifier, [
          path.dirname(sourcePath),
          styleRoot,
          workspaceRoot,
          ...fallbackNodeModulesPaths,
        ]) ?? resolveWorkspaceCssFallback(cleanSpecifier, workspaceRoot, workspacePackageResolver);
      if (fallbackPath === undefined) {
        if (!admittedUnresolvedImports.has(cssImport.specifier)) continue;
        const authoredStatement = output.slice(cssImport.statementStart, cssImport.statementEnd);
        output =
          output.slice(0, cssImport.statementStart) +
          authoredStatement.replaceAll(/[^\r\n]/gu, ' ') +
          output.slice(cssImport.statementEnd);
        continue;
      }
      const relativePath = normalizeCssRelativePath(
        path.relative(path.dirname(sourcePath), fallbackPath),
      );
      const replacement = `@import ${JSON.stringify(relativePath)}${
        cssImport.modifiers.length === 0 ? '' : ` ${cssImport.modifiers}`
      };`;
      output =
        output.slice(0, cssImport.statementStart) +
        replacement +
        output.slice(cssImport.statementEnd);
    }
  }
  return output;
}

/** Produces an explicit POSIX-style CSS-relative request on every host platform. */
function normalizeCssRelativePath(relativePath: string): string {
  const normalizedPath = relativePath.split(path.sep).join('/');
  return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
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
    contents: normalizePreviewCssFailSoftPrelude(source),
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
