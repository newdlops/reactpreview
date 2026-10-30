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
import { createPreviewWorkspacePackageResolver } from './previewWorkspacePackageResolver';
import { createPreviewResolutionFileSystem } from './previewResolutionFileSystem';
import { createPreviewStaticTargetMatcher } from './previewStaticTargetMatcher';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const DECLARATION_EXTENSION_PATTERN = /\.d\.(?:cts|mts|ts)$/iu;
const MAX_RESOLVED_SOURCE_ENTRIES = 4096;
const MAX_CONFIG_DIRECTORY_ENTRIES = 4096;

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
  /** Returns the exact configured automatic JSX package, when the nearest config names one. */
  readonly getJsxImportSource: (consumerPath: string) => string | undefined;
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
   * Resolves a confined missing filesystem candidate selected by an explicit tsconfig `paths` alias.
   *
   * Unlike {@link resolve}, this operation may return a path that does not exist yet. Consumers use
   * it for evidence-backed generated-source recovery. Existing candidates in any target of the
   * best matching alias, relative requests, and workspace escapes always return `undefined`.
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
  /**
   * Reports declarative package evidence that delaying one source module cannot suppress authored
   * top-level effects. Only an owning manifest with the exact `sideEffects: false` contract is
   * admitted; missing, `true`, and pattern-valued declarations remain effectful.
   */
  readonly isSideEffectFree?: (sourcePath: string) => boolean;
}

/** Frozen audit counters for one request-owned static module-resolution memo. */
export interface PreviewStaticModuleResolutionMemoStatistics {
  readonly computations: number;
  readonly entries: number;
  readonly hits: number;
  readonly released: boolean;
  readonly requests: number;
}

/** Exact request-local memo for synchronous static module resolution. */
export interface PreviewStaticModuleResolutionMemo {
  /** Returns a frozen snapshot of retained entries and lifetime counters. */
  readonly getStatistics: () => PreviewStaticModuleResolutionMemoStatistics;
  /** Clears retained results and prevents later resolution. */
  readonly release: () => void;
  /** Resolves one exact consumer-path and module-specifier tuple. */
  readonly resolve: (
    moduleSpecifier: string,
    consumerPath: string,
    compute: () => string | undefined,
  ) => string | undefined;
}

/** Creates an exact two-level static-resolution memo owned by one inventory request. */
export function createPreviewStaticModuleResolutionMemo(): PreviewStaticModuleResolutionMemo {
  const resolutionsByConsumerPath = new Map<string, Map<string, string | undefined>>();
  let computations = 0;
  let entries = 0;
  let hits = 0;
  let released = false;
  let requests = 0;
  return Object.freeze({
    getStatistics(): PreviewStaticModuleResolutionMemoStatistics {
      return Object.freeze({
        computations,
        entries,
        hits,
        released,
        requests,
      });
    },
    release(): void {
      if (released) return;
      for (const resolutions of resolutionsByConsumerPath.values()) resolutions.clear();
      resolutionsByConsumerPath.clear();
      entries = 0;
      released = true;
    },
    resolve(
      moduleSpecifier: string,
      consumerPath: string,
      compute: () => string | undefined,
    ): string | undefined {
      if (released) {
        throw new Error('The preview static module resolution memo was already released.');
      }
      requests += 1;
      const existingResolutions = resolutionsByConsumerPath.get(consumerPath);
      if (existingResolutions?.has(moduleSpecifier) === true) {
        hits += 1;
        return existingResolutions.get(moduleSpecifier);
      }
      computations += 1;
      const resolved = compute();
      const resolutions = existingResolutions ?? new Map<string, string | undefined>();
      if (existingResolutions === undefined) {
        resolutionsByConsumerPath.set(consumerPath, resolutions);
      }
      resolutions.set(moduleSpecifier, resolved);
      entries += 1;
      return resolved;
    },
  });
}

/** Compiler options and TypeScript's own bounded module-resolution memoization. */
interface PreviewStaticResolutionContext {
  /** Directory against which TypeScript path mapping targets are interpreted. */
  readonly baseDirectory: string;
  readonly cache: ts.ModuleResolutionCache;
  readonly options: ts.CompilerOptions;
}

/** One positive issuer answer retained by the existing bounded resolution cache. */
interface ResolvedStaticSource {
  /** Current canonical identity returned to graph consumers. */
  readonly canonicalPath: string;
  /** Exact TypeScript-selected runtime path, when this resolver owns its canonicalization. */
  readonly physicalPath?: string;
}

/** Canonical identity shared only while at least one cached issuer answer retains it. */
interface RetainedCanonicalSource {
  /** Canonical spelling already computed for a positive issuer answer. */
  readonly canonicalPath: string;
  /** Number of positive answers currently retaining this exact physical-path identity. */
  references: number;
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
  const resolvedSourceByRequest = new Map<string, ResolvedStaticSource>();
  const canonicalSourceByPhysicalPath = new Map<string, RetainedCanonicalSource>();
  const sideEffectContractByDirectory = new Map<string, boolean>();
  const sideEffectFreeBySourcePath = new Map<string, boolean>();
  const resolutionFileSystem = createPreviewResolutionFileSystem();
  const fallbackContext = createResolutionContext(undefined, workspaceRoot);
  const workspacePackageResolver = createPreviewWorkspacePackageResolver(workspaceRoot);
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
    const visited: string[] = [];
    while (isPathInside(boundary, candidateDirectory)) {
      if (configPathByDirectory.has(candidateDirectory)) {
        configPath = configPathByDirectory.get(candidateDirectory);
        break;
      }
      visited.push(candidateDirectory);
      for (const configName of ['tsconfig.json', 'jsconfig.json']) {
        const candidate = path.join(candidateDirectory, configName);
        if (resolutionFileSystem.fileExists(candidate)) {
          configPath = candidate;
          break;
        }
      }
      if (configPath !== undefined || candidateDirectory === boundary) {
        break;
      }
      candidateDirectory = path.dirname(candidateDirectory);
    }
    for (const directory of visited) {
      if (configPathByDirectory.size >= MAX_CONFIG_DIRECTORY_ENTRIES) break;
      configPathByDirectory.set(directory, configPath);
    }
    return configPath;
  }

  /** Tries authored workspace sources before immutable extension-managed dependency packages. */
  function resolveStaticPackageFallback(moduleSpecifier: string): ResolvedStaticSource | undefined {
    const canonicalPath =
      workspacePackageResolver.resolve(moduleSpecifier) ??
      resolveManagedFallback(moduleSpecifier, managedFallbackResolvers);
    return canonicalPath === undefined ? undefined : { canonicalPath };
  }

  /** Reuses positive exact-issuer results within this request-owned resolver, with bounded storage. */
  function resolve(moduleSpecifier: string, consumerPath: string): string | undefined {
    const cacheKey = JSON.stringify([consumerPath, moduleSpecifier]);
    const cached = resolvedSourceByRequest.get(cacheKey);
    if (cached !== undefined) return cached.canonicalPath;
    const resolved = resolveUncached(moduleSpecifier, consumerPath);
    if (resolved !== undefined) {
      if (resolvedSourceByRequest.size >= MAX_RESOLVED_SOURCE_ENTRIES) {
        const oldest = resolvedSourceByRequest.entries().next().value;
        if (oldest !== undefined) {
          resolvedSourceByRequest.delete(oldest[0]);
          const physicalPath = oldest[1].physicalPath;
          const retained =
            physicalPath === undefined
              ? undefined
              : canonicalSourceByPhysicalPath.get(physicalPath);
          if (retained !== undefined && physicalPath !== undefined) {
            retained.references -= 1;
            if (retained.references === 0) canonicalSourceByPhysicalPath.delete(physicalPath);
          }
        }
      }
      resolvedSourceByRequest.set(cacheKey, resolved);
      if (resolved.physicalPath !== undefined) {
        const retained = canonicalSourceByPhysicalPath.get(resolved.physicalPath);
        if (retained === undefined) {
          canonicalSourceByPhysicalPath.set(resolved.physicalPath, {
            canonicalPath: resolved.canonicalPath,
            references: 1,
          });
        } else {
          retained.references += 1;
        }
      }
    }
    return resolved?.canonicalPath;
  }

  /** Reuses a retained positive identity after TypeScript independently selects the physical path. */
  function resolvePhysicalSource(physicalPath: string): ResolvedStaticSource {
    return {
      canonicalPath:
        canonicalSourceByPhysicalPath.get(physicalPath)?.canonicalPath ??
        canonicalizeExistingPath(physicalPath),
      physicalPath,
    };
  }

  /** Resolves one authored import with the exact compiler options selected for its source file. */
  function resolveUncached(
    moduleSpecifier: string,
    consumerPath: string,
  ): ResolvedStaticSource | undefined {
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
        resolutionFileSystem,
        context.cache,
      ).resolvedModule;
      if (resolution === undefined) {
        return resolveStaticPackageFallback(cleanSpecifier);
      }
      const physicalPath = resolvePreviewYarnVirtualPath(
        resolution.resolvedFileName,
        workspaceRoot,
      );
      if (physicalPath !== undefined && resolutionFileSystem.fileExists(physicalPath)) {
        const runtimeSibling = resolveRuntimeDeclarationSibling(
          physicalPath,
          resolutionFileSystem.fileExists,
        );
        if (runtimeSibling !== undefined) return resolvePhysicalSource(runtimeSibling);
        if (DECLARATION_EXTENSION_PATTERN.test(physicalPath)) {
          return resolveStaticPackageFallback(cleanSpecifier);
        }
        return resolvePhysicalSource(physicalPath);
      }
      return resolveStaticPackageFallback(cleanSpecifier);
    } catch {
      // Invalid or transient project configuration cannot make syntax-only discovery fail a build.
      return resolveStaticPackageFallback(cleanSpecifier);
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
      const selected = matchingPatterns[0];
      if (selected === undefined) return undefined;
      const candidates = (pathTargets[selected.pattern] ?? []).map((target) =>
        path.resolve(context.baseDirectory, target.replaceAll('*', selected.match)),
      );
      // Existing imports need no ancestor walk. Check every fallback target before admitting a
      // missing first target, and do not fall through to a less-specific alias pattern.
      if (candidates.some(sourceCandidateExists)) return undefined;
      for (const candidatePath of candidates) {
        const canonicalCandidate = canonicalizePathThroughExistingAncestor(candidatePath);
        if (sourceCandidateExists(canonicalCandidate)) return undefined;
        if (isPathInside(workspaceRoot, canonicalCandidate)) return canonicalCandidate;
      }
    } catch {
      // Malformed path mappings remain an ordinary esbuild resolution failure.
    }
    return undefined;
  }

  return Object.freeze({
    ...createPreviewStaticTargetMatcher(resolve),
    getJsxImportSource(consumerPath: string): string | undefined {
      return readConfiguredJsxImportSource(getResolutionContext(consumerPath).options);
    },
    isSideEffectFree(sourcePath: string): boolean {
      const canonicalSourcePath = canonicalizeExistingPath(sourcePath);
      const cached = sideEffectFreeBySourcePath.get(canonicalSourcePath);
      if (cached !== undefined) return cached;
      const sideEffectFree = readNearestSideEffectContract(
        canonicalSourcePath,
        workspaceRoot,
        sideEffectContractByDirectory,
      );
      sideEffectFreeBySourcePath.set(canonicalSourcePath, sideEffectFree);
      return sideEffectFree;
    },
    resolve,
    resolveMissingPathAliasCandidate,
    usesAlternativeJsxRuntime(consumerPath: string): boolean {
      return compilerOptionsUseAlternativeJsxRuntime(getResolutionContext(consumerPath).options);
    },
  });
}

/** Maps TypeScript's conditional `types` result to the adjacent runtime package export. */
function resolveRuntimeDeclarationSibling(
  sourcePath: string,
  fileExists: (fileName: string) => boolean,
): string | undefined {
  const match = /^(?<base>.*)\.d\.(?<extension>cts|mts|ts)$/iu.exec(sourcePath);
  const base = match?.groups?.base;
  const extension = match?.groups?.extension?.toLowerCase();
  if (base === undefined || extension === undefined) return undefined;
  const runtimeExtensions =
    extension === 'mts'
      ? ['.mjs', '.js']
      : extension === 'cts'
        ? ['.cjs', '.js']
        : ['.js', '.mjs', '.cjs'];
  return runtimeExtensions
    .map((runtimeExtension) => base + runtimeExtension)
    .find((candidate) => fileExists(candidate));
}

/** Preserves an exact configured automatic JSX owner without interpreting custom classic factories. */
function readConfiguredJsxImportSource(options: ts.CompilerOptions): string | undefined {
  const jsxImportSource = options.jsxImportSource?.trim();
  return jsxImportSource === undefined || jsxImportSource.length === 0
    ? undefined
    : jsxImportSource;
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

/** Defers existing JS/TS files, indexes, and package directories to ordinary module resolution. */
function sourceCandidateExists(candidatePath: string): boolean {
  if (ts.sys.fileExists(candidatePath)) return true;
  const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  return (
    extensions.some(
      (extension) =>
        ts.sys.fileExists(`${candidatePath}${extension}`) ||
        ts.sys.fileExists(path.join(candidatePath, `index${extension}`)),
    ) || ts.sys.fileExists(path.join(candidatePath, 'package.json'))
  );
}

/**
 * Reads the nearest inert package manifest and accepts only the package-wide no-side-effects flag.
 * Pattern arrays are deliberately rejected: matching npm's complete glob semantics here would risk
 * delaying a stylesheet or registration module that the project explicitly kept effectful.
 */
function readNearestSideEffectContract(
  sourcePath: string,
  workspaceRoot: string,
  cache: Map<string, boolean>,
): boolean {
  let directoryPath = path.dirname(path.resolve(sourcePath));
  const boundary = path.resolve(workspaceRoot);
  const visited: string[] = [];
  while (isPathInside(boundary, directoryPath)) {
    const cached = cache.get(directoryPath);
    if (cached !== undefined) {
      for (const visitedPath of visited) cache.set(visitedPath, cached);
      return cached;
    }
    visited.push(directoryPath);
    const manifestPath = path.join(directoryPath, 'package.json');
    if (ts.sys.fileExists(manifestPath)) {
      try {
        const contents = ts.sys.readFile(manifestPath);
        if (contents === undefined || contents.length > 1024 * 1024) {
          for (const visitedPath of visited) cache.set(visitedPath, false);
          return false;
        }
        const manifest = JSON.parse(contents) as unknown;
        const sideEffectFree =
          typeof manifest === 'object' &&
          manifest !== null &&
          Object.prototype.hasOwnProperty.call(manifest, 'sideEffects') &&
          Reflect.get(manifest, 'sideEffects') === false;
        for (const visitedPath of visited) cache.set(visitedPath, sideEffectFree);
        return sideEffectFree;
      } catch {
        for (const visitedPath of visited) cache.set(visitedPath, false);
        return false;
      }
    }
    if (directoryPath === boundary) break;
    const parentPath = path.dirname(directoryPath);
    if (parentPath === directoryPath) break;
    directoryPath = parentPath;
  }
  for (const visitedPath of visited) cache.set(visitedPath, false);
  return false;
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

/** Checks workspace containment without accepting sibling-prefix lookalikes. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
