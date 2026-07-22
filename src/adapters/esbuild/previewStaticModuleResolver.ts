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
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
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
  const workspaceRoot = path.resolve(options.workspaceRoot);
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
    const configPath =
      configuredConfigPath ??
      findNearestPreviewConfig(path.dirname(path.resolve(consumerPath)), workspaceRoot);
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
        path.resolve(consumerPath),
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
  });
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
  return {
    cache: ts.createModuleResolutionCache(
      path.dirname(configPath),
      canonicalizeCachePath,
      compilerOptions,
    ),
    options: compilerOptions,
  };
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
  return isPathInside(workspaceRoot, normalizedPath) && ts.sys.fileExists(normalizedPath)
    ? normalizedPath
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
