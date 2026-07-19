/**
 * Supplies render-only neutral values when a project-owned generated source directory is absent.
 * Code-generated API contracts are commonly excluded from source control and created by a normal
 * application bootstrap step; their absence must not prevent unrelated visual React output.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const GENERATED_FALLBACK_NAMESPACE = 'react-preview-generated-module-fallback';
const RELATIVE_SPECIFIER_PATTERN = /^\.\.?\//u;
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?|json)$/iu;
const GENERATED_SEGMENT_PATTERN = /^(?:__generated__|codegen|gen|generated)$/iu;
const GENERATED_SUFFIX_PATTERN = /\.(?:generated|gen)$/iu;
const SOURCE_CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const MAXIMUM_CONTRACT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_CONTRACT_FILES = 2_048;
const MAXIMUM_GENERATED_EXPORT_NAMES = 4_096;

/** Optional callback that connects missing-directory liveness to the compiler's VS Code watcher. */
export interface PreviewGeneratedModuleFallbackOptions {
  /** Records the nearest existing directory so later code generation triggers hot reload. */
  readonly registerWatchDirectory?: (directoryPath: string) => void;
  /** Trusted workspace containing both importer and generated candidate. */
  readonly workspaceRoot: string;
}

/** Replacement prepared for a source file that only re-exports absent generated modules. */
export interface PreviewGeneratedBarrelFallback {
  /** CommonJS proxy source supporting arbitrary named imports through esbuild interop. */
  readonly contents: string;
  /** Human-readable warning retained in preview build diagnostics. */
  readonly warning: string;
  /** Existing source directory whose additions invalidate this fallback. */
  readonly watchDirectory: string;
}

/**
 * Creates a narrow resolver for direct imports of conventionally named generated source modules.
 * Existing modules always use normal esbuild resolution. Only unresolved relative source requests
 * inside the workspace receive the neutral module; missing ordinary components remain hard errors.
 */
export function createPreviewGeneratedModuleFallbackPlugin(
  options: PreviewGeneratedModuleFallbackOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  return {
    name: 'react-preview-generated-module-fallback',
    setup(build): void {
      /** Delegates normal resolution once before admitting an absent generated-source fallback. */
      async function resolveGeneratedModule(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (
          arguments_.namespace !== 'file' ||
          (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
          !isGeneratedSourceSpecifier(arguments_.path)
        ) {
          return undefined;
        }
        const resolved = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
          with: arguments_.with,
        });
        if (resolved.errors.length === 0) {
          return resolved;
        }

        const importerPath = resolvePreviewYarnVirtualPath(arguments_.importer, workspaceRoot);
        const resolveDirectory = path.resolve(
          arguments_.resolveDir || (importerPath === undefined ? '' : path.dirname(importerPath)),
        );
        const candidatePath = path.resolve(resolveDirectory, cleanModuleSpecifier(arguments_.path));
        if (
          importerPath === undefined ||
          !isPathInside(workspaceRoot, importerPath) ||
          !isPathInside(workspaceRoot, candidatePath)
        ) {
          return { errors: resolved.errors, warnings: resolved.warnings };
        }
        options.registerWatchDirectory?.(resolveDirectory);
        const exportNames = collectGeneratedContractExportNames(resolveDirectory);
        for (const importName of collectDirectGeneratedImportNames(importerPath, arguments_.path)) {
          if (exportNames.size >= MAXIMUM_GENERATED_EXPORT_NAMES) break;
          exportNames.add(importName);
        }
        return {
          namespace: GENERATED_FALLBACK_NAMESPACE,
          path: candidatePath,
          pluginData: {
            candidatePath,
            exportNames: [...exportNames].sort(),
            importerPath,
            watchDirectory: resolveDirectory,
          } satisfies PreviewGeneratedFallbackData,
          sideEffects: false,
        };
      }

      /** Emits a recursive callable value that tolerates DTO constructors, enums, and serializers. */
      function loadGeneratedModule(arguments_: OnLoadArgs): OnLoadResult {
        const fallbackData = readFallbackData(arguments_.pluginData);
        if (fallbackData === undefined) {
          return { errors: [{ text: 'React Preview lost generated-module fallback metadata.' }] };
        }
        const label = formatWorkspacePath(fallbackData.candidatePath, workspaceRoot);
        return {
          contents: createGeneratedNeutralModuleSource(label, fallbackData.exportNames),
          loader: 'js',
          resolveDir: fallbackData.watchDirectory,
          warnings: [{ text: createGeneratedFallbackWarning(label) }],
          watchDirs: [fallbackData.watchDirectory],
        };
      }

      build.onResolve({ filter: /^\.\.?\// }, resolveGeneratedModule);
      build.onLoad({ filter: /.*/, namespace: GENERATED_FALLBACK_NAMESPACE }, loadGeneratedModule);
    },
  };
}

/**
 * Replaces a generated-only export barrel before esbuild resolves its missing star export.
 * A CommonJS proxy is required here because an ESM `export *` can enumerate only known keys, while
 * generated DTO packages expose many downstream named imports that are unavailable statically.
 */
export function preparePreviewGeneratedBarrelFallback(
  sourcePath: string,
  sourceText: string,
  workspaceRoot: string,
): PreviewGeneratedBarrelFallback | undefined {
  if (!sourceText.toLocaleLowerCase().includes('generated')) return undefined;
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, false);
  const statements = sourceFile.statements.filter((statement) => !ts.isEmptyStatement(statement));
  if (statements.length === 0) return undefined;

  const specifiers: string[] = [];
  for (const statement of statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !isGeneratedSourceSpecifier(statement.moduleSpecifier.text)
    ) {
      return undefined;
    }
    specifiers.push(statement.moduleSpecifier.text);
  }

  const physicalSourcePath = canonicalizeExistingPath(sourcePath);
  const sourceDirectory = path.dirname(physicalSourcePath);
  const trustedRoot = canonicalizeExistingPath(workspaceRoot);
  if (
    !isPathInside(trustedRoot, physicalSourcePath) ||
    specifiers.some((specifier) => generatedSourceExists(sourceDirectory, specifier))
  ) {
    return undefined;
  }
  const label = formatWorkspacePath(
    path.resolve(sourceDirectory, specifiers[0] ?? 'generated'),
    trustedRoot,
  );
  const exportNames = collectGeneratedContractExportNames(sourceDirectory);
  return {
    contents: createGeneratedNeutralModuleSource(label, [...exportNames].sort()),
    warning: createGeneratedFallbackWarning(label),
    watchDirectory: sourceDirectory,
  };
}

/** Returns whether a relative JS/TS request carries an explicit generated-code path convention. */
function isGeneratedSourceSpecifier(moduleSpecifier: string): boolean {
  const cleanSpecifier = cleanModuleSpecifier(moduleSpecifier).replaceAll('\\', '/');
  if (!RELATIVE_SPECIFIER_PATTERN.test(cleanSpecifier)) return false;
  const extension = path.posix.extname(cleanSpecifier);
  if (extension.length > 0 && !SOURCE_EXTENSION_PATTERN.test(extension)) return false;
  return cleanSpecifier.split('/').some((segment) => {
    const stem = segment.replace(SOURCE_EXTENSION_PATTERN, '');
    return GENERATED_SEGMENT_PATTERN.test(stem) || GENERATED_SUFFIX_PATTERN.test(stem);
  });
}

/** Checks normal source and directory-index candidates without evaluating project configuration. */
function generatedSourceExists(resolveDirectory: string, moduleSpecifier: string): boolean {
  const candidatePath = path.resolve(resolveDirectory, cleanModuleSpecifier(moduleSpecifier));
  const candidates = [
    candidatePath,
    ...SOURCE_CANDIDATE_EXTENSIONS.map((extension) => `${candidatePath}${extension}`),
    ...SOURCE_CANDIDATE_EXTENSIONS.map((extension) =>
      path.join(candidatePath, `index${extension}`),
    ),
  ];
  return candidates.some(isFile);
}

/** Produces a browser-safe recursive value for unavailable generated contracts. */
function createGeneratedNeutralModuleSource(label: string, exportNames: readonly string[]): string {
  return [
    '/** Render-only neutral replacement for an unavailable generated project module. */',
    'let neutral;',
    'const callable = function ReactPreviewGeneratedContractNeutral() { return neutral; };',
    'neutral = new Proxy(callable, {',
    '  apply() { return neutral; },',
    '  construct() { return neutral; },',
    '  get(_target, property) {',
    "    if (property === '__esModule') return false;",
    "    if (property === 'then') return undefined;",
    "    if (property === 'toJSON') return () => ({});",
    '    if (property === Symbol.iterator) return () => [][Symbol.iterator]();',
    "    if (property === Symbol.toPrimitive) return (hint) => hint === 'string' ? '' : 0;",
    '    return neutral;',
    '  },',
    '  has() { return true; },',
    '  set() { return true; },',
    '});',
    `for (const exportName of ${JSON.stringify(exportNames)}) {`,
    "  if (!Object.hasOwn(callable, exportName) && exportName !== 'default') {",
    '    Object.defineProperty(callable, exportName, { configurable: true, enumerable: true, get: () => neutral });',
    '  }',
    '}',
    `console.warn(${JSON.stringify(`[React Preview] Generated source ${label} is unavailable; using neutral render-only contract values.`)});`,
    'module.exports = neutral;',
  ].join('\n');
}

/** Metadata kept entirely inside the plugin's private namespace. */
interface PreviewGeneratedFallbackData {
  readonly candidatePath: string;
  readonly exportNames: readonly string[];
  readonly importerPath: string;
  readonly watchDirectory: string;
}

/** Validates custom-namespace metadata before any filesystem path is reused. */
function readFallbackData(value: unknown): PreviewGeneratedFallbackData | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<PreviewGeneratedFallbackData>;
  return typeof candidate.candidatePath === 'string' &&
    Array.isArray(candidate.exportNames) &&
    candidate.exportNames.every((exportName) => typeof exportName === 'string') &&
    typeof candidate.importerPath === 'string' &&
    typeof candidate.watchDirectory === 'string'
    ? (candidate as PreviewGeneratedFallbackData)
    : undefined;
}

/** Collects named imports from the exact source request that caused one direct generated fallback. */
function collectDirectGeneratedImportNames(
  importerPath: string,
  moduleSpecifier: string,
): readonly string[] {
  let sourceText: string;
  try {
    sourceText = readFileSync(importerPath, 'utf8');
  } catch {
    return [];
  }
  const sourceFile = ts.createSourceFile(importerPath, sourceText, ts.ScriptTarget.Latest, false);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleSpecifier
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements)
          names.add(binding.propertyName?.text ?? binding.name.text);
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
        names.add(binding.propertyName?.text ?? binding.name.text);
      }
    }
  }
  return [...names].sort();
}

/**
 * Derives runtime names from adjacent protobuf and GraphQL contracts under strict file/byte limits.
 * This avoids scanning a monorepo's consumers while covering the common source-controlled inputs
 * whose generated TypeScript output is intentionally absent.
 */
function collectGeneratedContractExportNames(sourceDirectory: string): Set<string> {
  const names = new Set<string>();
  const pendingDirectories = [sourceDirectory];
  let consumedBytes = 0;
  let consumedFiles = 0;
  while (
    pendingDirectories.length > 0 &&
    consumedFiles < MAXIMUM_CONTRACT_FILES &&
    consumedBytes < MAXIMUM_CONTRACT_BYTES &&
    names.size < MAXIMUM_GENERATED_EXPORT_NAMES
  ) {
    const directoryPath = pendingDirectories.pop();
    if (directoryPath === undefined) break;
    let entries;
    try {
      entries = readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.name === 'generated' ||
        entry.name === '__generated__' ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:gql|graphql|proto)$/iu.test(entry.name)) continue;
      let sourceText: string;
      try {
        const size = statSync(entryPath).size;
        if (size > MAXIMUM_CONTRACT_BYTES - consumedBytes) continue;
        sourceText = readFileSync(entryPath, 'utf8');
        consumedBytes += size;
        consumedFiles += 1;
      } catch {
        continue;
      }
      collectContractNames(sourceText, entry.name, names);
      if (names.size >= MAXIMUM_GENERATED_EXPORT_NAMES) break;
    }
  }
  return names;
}

/** Adds protobuf messages/enums/services and GraphQL document identities to one bounded inventory. */
function collectContractNames(sourceText: string, fileName: string, names: Set<string>): void {
  if (fileName.toLocaleLowerCase().endsWith('.proto')) {
    for (const match of sourceText.matchAll(/\b(?:enum|message|service)\s+([A-Za-z_$][\w$]*)/gu)) {
      const exportName = match[1];
      if (exportName !== undefined) names.add(exportName);
    }
    return;
  }
  for (const match of sourceText.matchAll(
    /\b(query|mutation|subscription)\s+([A-Za-z_$][\w$]*)/gu,
  )) {
    const operationKind = match[1];
    const operationName = match[2];
    if (operationKind === undefined || operationName === undefined) continue;
    names.add(`${operationName}Document`);
    names.add(`${operationName}${operationKind.charAt(0).toUpperCase()}${operationKind.slice(1)}`);
  }
  for (const match of sourceText.matchAll(/\bfragment\s+([A-Za-z_$][\w$]*)\s+on\b/gu)) {
    const fragmentName = match[1];
    if (fragmentName !== undefined) names.add(`${fragmentName}FragmentDoc`);
  }
}

/** Removes static query/fragment suffixes before resolving a local source candidate. */
function cleanModuleSpecifier(moduleSpecifier: string): string {
  return moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
}

/** Formats one trusted source path without leaking unrelated absolute host directories. */
function formatWorkspacePath(sourcePath: string, workspaceRoot: string): string {
  return (
    path.relative(workspaceRoot, sourcePath).replaceAll(path.sep, '/') || path.basename(sourcePath)
  );
}

/** Explains the automatic boundary while retaining the project code-generation recovery action. */
function createGeneratedFallbackWarning(label: string): string {
  return `Generated project source "${label}" is unavailable. React Preview supplied recursive neutral contract values so visual rendering can continue; run the project's code-generation command to restore real runtime values.`;
}

/** Checks a candidate without throwing on missing, transient, or directory paths. */
function isFile(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

/** Checks trusted workspace containment without accepting sibling-prefix lookalikes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
