/**
 * Resolves authored import specifiers for static reverse-component graph analysis.
 *
 * The preview compiler itself delegates module loading to esbuild. Reverse analysis happens before
 * that build, so it needs a small, read-only resolver to recognize tsconfig/jsconfig aliases without
 * evaluating project configuration or importing application modules in the extension host.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {
  canonicalizeExistingPath,
  canonicalizePathThroughExistingAncestor,
} from '../../shared/pathIdentity';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const SOURCE_EXTENSION_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

/** Immutable resolver inputs bounded by the trusted VS Code workspace. */
export interface PreviewStaticModuleResolverOptions {
  /** Optional explicit tsconfig/jsconfig already selected by extension configuration. */
  readonly configuredTsconfigPath?: string;
  /** Immutable managed node_modules roots consulted only after project TypeScript resolution fails. */
  readonly fallbackNodeModulesPaths?: readonly string[];
  /** Filesystem boundary above which automatic config discovery must never climb. */
  readonly workspaceRoot: string;
}

/** Static import identity operations consumed by reverse graph analyzers. */
export interface PreviewStaticModuleResolver {
  /** Returns authored specifiers already proven to resolve to one target during this scan. */
  readonly getMatchedSpecifiers: (targetPath: string) => readonly string[];
  /** Reports explicit tsconfig/jsconfig evidence that JSX belongs to a non-React runtime. */
  readonly usesAlternativeJsxRuntime: (consumerPath: string) => boolean;
  /**
   * Reports whether one consumer import resolves to the exact selected source module.
   *
   * @param moduleSpecifier Authored relative, package, or configured alias specifier.
   * @param consumerPath Absolute source file containing that import.
   * @param targetPath Absolute component source path selected by the editor.
   */
  readonly matchesTarget: (
    moduleSpecifier: string,
    consumerPath: string,
    targetPath: string,
  ) => boolean;
  /**
   * Resolves only the lexical filesystem candidate selected by an explicit tsconfig `paths` alias.
   *
   * Unlike {@link resolve}, this operation may return a path that does not exist yet. Consumers use
   * it only after normal module resolution fails, for evidence-backed generated-source recovery.
   * Relative, package-only, and workspace-escaping requests always return `undefined`.
   */
  readonly resolveMissingPathAliasCandidate: (
    moduleSpecifier: string,
    consumerPath: string,
  ) => string | undefined;
  /**
   * Resolves one import to a source path when TypeScript can prove its identity.
   *
   * @param moduleSpecifier Authored import specifier.
   * @param consumerPath Absolute importing source file.
   * @returns Canonical resolved file path, or `undefined` for unresolved/external modules.
   */
  readonly resolve: (moduleSpecifier: string, consumerPath: string) => string | undefined;
}

/** Compiler options and TypeScript's own bounded module-resolution memoization. */
interface PreviewStaticResolutionContext {
  /** Directory against which TypeScript path mapping targets are interpreted. */
  readonly baseDirectory: string;
  readonly cache: ts.ModuleResolutionCache;
  readonly options: ts.CompilerOptions;
}

/**
 * Creates a synchronous, cached resolver suitable for syntax-only package inventory scans.
 *
 * Nearest config lookup is cached per consumer directory. Config parsing deliberately supplies an
 * empty `readDirectory` result because only compiler options and `extends` are needed; expanding
 * `include` globs would duplicate the preview inventory scan and slow large monorepos.
 *
 * @param options Trusted workspace and optional user-selected config path.
 * @returns Resolver that never executes JS configuration or application code.
 */
export function createPreviewStaticModuleResolver(
  options: PreviewStaticModuleResolverOptions,
): PreviewStaticModuleResolver {
  const lexicalWorkspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const configuredConfigPath = normalizeConfiguredConfigPath(
    options.configuredTsconfigPath,
    workspaceRoot,
  );
  const contextByConfigPath = new Map<string, PreviewStaticResolutionContext>();
  const configPathByDirectory = new Map<string, string | undefined>();
  const matchedSpecifiersByTarget = new Map<string, Set<string>>();
  const fallbackContext = createResolutionContext(undefined, workspaceRoot);
  const managedFallbackResolvers = createManagedFallbackResolvers(
    options.fallbackNodeModulesPaths ?? [],
  );

  /** Selects explicit configuration or the nearest trusted tsconfig/jsconfig for one consumer. */
  function getResolutionContext(consumerPath: string): PreviewStaticResolutionContext {
    const physicalConsumerPath = normalizeWorkspaceConsumerPath(consumerPath);
    const configPath =
      configuredConfigPath ??
      findNearestPreviewConfig(path.dirname(physicalConsumerPath), workspaceRoot);
    if (configPath === undefined) {
      return fallbackContext;
    }
    const cached = contextByConfigPath.get(configPath);
    if (cached !== undefined) {
      return cached;
    }
    const created = createResolutionContext(configPath, path.dirname(configPath));
    contextByConfigPath.set(configPath, created);
    return created;
  }

  /** Maps missing editor paths across platform aliases such as macOS `/var` and `/private/var`. */
  function normalizeWorkspaceConsumerPath(consumerPath: string): string {
    const resolvedPath = path.resolve(consumerPath);
    if (isPathInside(workspaceRoot, resolvedPath)) return resolvedPath;
    if (isPathInside(lexicalWorkspaceRoot, resolvedPath)) {
      return path.join(workspaceRoot, path.relative(lexicalWorkspaceRoot, resolvedPath));
    }
    return canonicalizeExistingPath(resolvedPath);
  }

  /** Finds a nearest config once per importing directory without crossing the workspace root. */
  function findNearestPreviewConfig(
    consumerDirectory: string,
    boundary: string,
  ): string | undefined {
    const normalizedDirectory = path.resolve(consumerDirectory);
    if (!isPathInside(boundary, normalizedDirectory)) {
      return undefined;
    }
    if (configPathByDirectory.has(normalizedDirectory)) {
      return configPathByDirectory.get(normalizedDirectory);
    }

    let candidateDirectory = normalizedDirectory;
    let configPath: string | undefined;
    while (isPathInside(boundary, candidateDirectory)) {
      for (const configName of ['tsconfig.json', 'jsconfig.json']) {
        const candidate = path.join(candidateDirectory, configName);
        if (ts.sys.fileExists(candidate)) {
          configPath = candidate;
          break;
        }
      }
      if (configPath !== undefined || candidateDirectory === boundary) {
        break;
      }
      candidateDirectory = path.dirname(candidateDirectory);
    }
    configPathByDirectory.set(normalizedDirectory, configPath);
    return configPath;
  }

  /** Resolves one authored import with the exact compiler options selected for its source file. */
  function resolve(moduleSpecifier: string, consumerPath: string): string | undefined {
    const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
    if (cleanSpecifier === undefined || cleanSpecifier.length === 0) {
      return undefined;
    }
    try {
      const context = getResolutionContext(consumerPath);
      const resolution = ts.resolveModuleName(
        cleanSpecifier,
        normalizeWorkspaceConsumerPath(consumerPath),
        context.options,
        ts.sys,
        context.cache,
      ).resolvedModule;
      if (resolution === undefined) {
        return resolveManagedFallback(cleanSpecifier, managedFallbackResolvers);
      }
      const physicalPath = resolvePreviewYarnVirtualPath(
        resolution.resolvedFileName,
        workspaceRoot,
      );
      return physicalPath !== undefined && ts.sys.fileExists(physicalPath)
        ? canonicalizeExistingPath(physicalPath)
        : undefined;
    } catch {
      // Invalid or transient project configuration cannot make syntax-only discovery fail a build.
      return undefined;
    }
  }

  /** Maps an unresolved explicit `paths` request without pretending the candidate exists. */
  function resolveMissingPathAliasCandidate(
    moduleSpecifier: string,
    consumerPath: string,
  ): string | undefined {
    const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
    if (
      cleanSpecifier === undefined ||
      cleanSpecifier.length === 0 ||
      cleanSpecifier.startsWith('.') ||
      path.isAbsolute(cleanSpecifier)
    ) {
      return undefined;
    }
    try {
      const context = getResolutionContext(consumerPath);
      const pathTargets = context.options.paths;
      if (pathTargets === undefined) return undefined;
      const matchingPatterns = Object.keys(pathTargets)
        .map((pattern) => ({ match: matchPathAlias(pattern, cleanSpecifier), pattern }))
        .filter(
          (candidate): candidate is { readonly match: string; readonly pattern: string } =>
            candidate.match !== undefined,
        )
        .sort(comparePathAliasMatches);
      for (const { match, pattern } of matchingPatterns) {
        for (const target of pathTargets[pattern] ?? []) {
          const substitutedTarget = target.replaceAll('*', match);
          const candidatePath = path.resolve(context.baseDirectory, substitutedTarget);
          const canonicalCandidate = canonicalizePathThroughExistingAncestor(candidatePath);
          if (
            isPathInside(workspaceRoot, canonicalCandidate) &&
            !sourceCandidateExists(canonicalCandidate)
          ) {
            return canonicalCandidate;
          }
        }
      }
    } catch {
      // Malformed path mappings remain an ordinary esbuild resolution failure.
    }
    return undefined;
  }

  return Object.freeze({
    getMatchedSpecifiers(targetPath: string): readonly string[] {
      return Object.freeze(
        [...(matchedSpecifiersByTarget.get(normalizeSourceIdentity(targetPath)) ?? [])].sort(),
      );
    },
    matchesTarget(moduleSpecifier: string, consumerPath: string, targetPath: string): boolean {
      const resolvedPath = resolve(moduleSpecifier, consumerPath);
      const matches =
        resolvedPath !== undefined &&
        normalizeSourceIdentity(resolvedPath) ===
          normalizeSourceIdentity(canonicalizeExistingPath(targetPath));
      if (matches) {
        const targetIdentity = normalizeSourceIdentity(targetPath);
        const matchedSpecifiers =
          matchedSpecifiersByTarget.get(targetIdentity) ?? new Set<string>();
        matchedSpecifiers.add(moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier);
        matchedSpecifiersByTarget.set(targetIdentity, matchedSpecifiers);
      }
      return matches;
    },
    resolve,
    resolveMissingPathAliasCandidate,
    usesAlternativeJsxRuntime(consumerPath: string): boolean {
      return compilerOptionsUseAlternativeJsxRuntime(getResolutionContext(consumerPath).options);
    },
  });
}

/**
 * Preserves explicit custom JSX ownership instead of treating a package-level React declaration as
 * proof for every module in a hybrid monorepo. Undefined/default options remain inconclusive so a
 * React manifest may still support Babel-automatic source beside an editor-only classic tsconfig.
 */
function compilerOptionsUseAlternativeJsxRuntime(options: ts.CompilerOptions): boolean {
  const jsxImportSource = options.jsxImportSource?.trim();
  const jsxFactory = options.jsxFactory?.trim();
  const jsxFragmentFactory = options.jsxFragmentFactory?.trim();
  const reactNamespace = options.reactNamespace?.trim();
  return (
    (jsxImportSource !== undefined && jsxImportSource !== 'react') ||
    (jsxFactory !== undefined && jsxFactory !== 'React.createElement') ||
    (jsxFragmentFactory !== undefined && jsxFragmentFactory !== 'React.Fragment') ||
    (reactNamespace !== undefined && reactNamespace !== 'React')
  );
}

/** One immutable Node resolver paired with the node_modules boundary it may expose. */
interface ManagedFallbackResolver {
  readonly nodeModulesPath: string;
  readonly resolve: (moduleSpecifier: string) => string;
}

/** Creates fallback resolvers without adding managed packages to TypeScript's project search path. */
function createManagedFallbackResolvers(
  nodeModulesPaths: readonly string[],
): readonly ManagedFallbackResolver[] {
  return [...new Set(nodeModulesPaths.map((candidate) => canonicalizeExistingPath(candidate)))].map(
    (nodeModulesPath) => ({
      nodeModulesPath,
      resolve: createRequire(path.join(path.dirname(nodeModulesPath), 'package.json')).resolve,
    }),
  );
}

/** Resolves a package only when Node proves that its selected file remains in the managed root. */
function resolveManagedFallback(
  moduleSpecifier: string,
  resolvers: readonly ManagedFallbackResolver[],
): string | undefined {
  for (const resolver of resolvers) {
    try {
      const resolvedPath = resolver.resolve(moduleSpecifier);
      if (isPathInside(resolver.nodeModulesPath, resolvedPath) && ts.sys.fileExists(resolvedPath)) {
        return canonicalizeExistingPath(resolvedPath);
      }
    } catch {
      // A missing export in one immutable environment may still exist in the next fallback root.
    }
  }
  return undefined;
}

/** Creates a TypeScript resolution context without enumerating project source globs. */
function createResolutionContext(
  configPath: string | undefined,
  currentDirectory: string,
): PreviewStaticResolutionContext {
  const fallbackOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
  };
  if (configPath === undefined) {
    return {
      baseDirectory: currentDirectory,
      cache: ts.createModuleResolutionCache(
        currentDirectory,
        canonicalizeCachePath,
        fallbackOptions,
      ),
      options: fallbackOptions,
    };
  }

  const host: ts.ParseConfigFileHost = {
    fileExists: (filePath) => ts.sys.fileExists(filePath),
    getCurrentDirectory: () => path.dirname(configPath),
    onUnRecoverableConfigFileDiagnostic: () => undefined,
    readDirectory: () => [],
    readFile: (filePath) => ts.sys.readFile(filePath),
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  const compilerOptions = parsed?.options ?? fallbackOptions;
  const internalPathsBasePath = Reflect.get(compilerOptions, 'pathsBasePath') as unknown;
  const configuredBaseUrl = Reflect.get(compilerOptions, 'baseUrl') as unknown;
  return {
    baseDirectory:
      (typeof internalPathsBasePath === 'string' ? internalPathsBasePath : undefined) ??
      (typeof configuredBaseUrl === 'string' ? configuredBaseUrl : undefined) ??
      path.dirname(configPath),
    cache: ts.createModuleResolutionCache(
      path.dirname(configPath),
      canonicalizeCachePath,
      compilerOptions,
    ),
    options: compilerOptions,
  };
}

/** Matches one exact or single-wildcard TypeScript path alias and returns its wildcard text. */
function matchPathAlias(pattern: string, moduleSpecifier: string): string | undefined {
  const wildcardOffset = pattern.indexOf('*');
  if (wildcardOffset < 0) return pattern === moduleSpecifier ? '' : undefined;
  if (pattern.slice(wildcardOffset + 1).includes('*')) return undefined;
  const prefix = pattern.slice(0, wildcardOffset);
  const suffix = pattern.slice(wildcardOffset + 1);
  if (
    !moduleSpecifier.startsWith(prefix) ||
    !moduleSpecifier.endsWith(suffix) ||
    moduleSpecifier.length < prefix.length + suffix.length
  ) {
    return undefined;
  }
  return moduleSpecifier.slice(prefix.length, moduleSpecifier.length - suffix.length);
}

/** Gives exact aliases priority, then follows TypeScript's longest-prefix wildcard preference. */
function comparePathAliasMatches(
  left: { readonly pattern: string },
  right: { readonly pattern: string },
): number {
  const leftWildcardOffset = left.pattern.indexOf('*');
  const rightWildcardOffset = right.pattern.indexOf('*');
  if (leftWildcardOffset < 0 || rightWildcardOffset < 0) {
    return Number(leftWildcardOffset >= 0) - Number(rightWildcardOffset >= 0);
  }
  return rightWildcardOffset - leftWildcardOffset || left.pattern.localeCompare(right.pattern);
}

/** Checks normal JS/TS file and directory-index candidates without traversing the workspace. */
function sourceCandidateExists(candidatePath: string): boolean {
  if (ts.sys.fileExists(candidatePath)) return true;
  const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  return extensions.some(
    (extension) =>
      ts.sys.fileExists(`${candidatePath}${extension}`) ||
      ts.sys.fileExists(path.join(candidatePath, `index${extension}`)),
  );
}

/** Accepts only an existing explicit config that remains inside the trusted workspace. */
function normalizeConfiguredConfigPath(
  configuredPath: string | undefined,
  workspaceRoot: string,
): string | undefined {
  if (configuredPath === undefined) {
    return undefined;
  }
  const normalizedPath = path.resolve(configuredPath);
  const canonicalPath = canonicalizeExistingPath(normalizedPath);
  return isPathInside(workspaceRoot, canonicalPath) && ts.sys.fileExists(canonicalPath)
    ? canonicalPath
    : undefined;
}

/** Produces the case policy required by TypeScript's module-resolution cache. */
function canonicalizeCachePath(filePath: string): string {
  return ts.sys.useCaseSensitiveFileNames ? filePath : filePath.toLowerCase();
}

/** Treats extensionful JS imports and their resolved TS/TSX sources as one module identity. */
function normalizeSourceIdentity(sourcePath: string): string {
  return path.normalize(sourcePath).replace(SOURCE_EXTENSION_PATTERN, '');
}

/** Checks workspace containment without accepting sibling-prefix lookalikes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
