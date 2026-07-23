/**
 * Rewrites finite framework resource syntax into explicit ESM imports that esbuild can bundle.
 * Supported forms are Vite `import.meta.glob`, relative template dynamic imports, Webpack
 * `require.context`, and `new URL(..., import.meta.url)`; every filesystem expansion is bounded.
 */
import path from 'node:path';
import {
  isStaticImportMetaUrl,
  parseDynamicPathSegments,
  parseStaticObject,
  parseStaticString,
  parseStaticStringList,
  StaticSourceAnalysis,
  type StaticCallExpression,
} from './staticCallParser';
import { createReactContextFallbackReplacements } from './reactContextFallback';
import { createReactContextHookFallbackTransform } from './reactContextHookFallback';
import { collectReactContextIdentityPairs } from './reactContextIdentity';
import { createContextRegistrationStatements } from './reactContextRegistration';
import { createReactExportPropFallbackReplacements } from './reactExportPropFallback';
import {
  collectPreviewRouterRequirement,
  type PreviewRouterRequirement,
} from '../previewRouterRequirement';
import { collectPreviewFormikRequirement } from '../previewFormikRequirement';
import { PREVIEW_FORMIK_SPECIFIER, PREVIEW_REDUX_SPECIFIER } from '../previewPluginProtocol';
import { createPreviewThemeSourceInstrumentation } from './previewThemeSourceInstrumentation';
import {
  expandStaticPatterns,
  StaticPatternError,
  type StaticPatternExpansion,
  type StaticScanBudget,
} from './staticPattern';
import { collectPreviewReduxStateContainerPaths } from './reduxStateContainerPaths';
import { collectPreviewImplicitPackageGlobals } from './previewImplicitPackageGlobals';
import { instrumentPreviewDataRequests } from './previewDataRequestInstrumentation';
import { createPreviewRuntimeHookReplacements } from './previewRuntimeHookInstrumentation';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from './previewRuntimeHookChildPropDemand';
import * as framework from './previewFrameworkReplacements';
import { instrumentPreviewRuntimeSource } from './previewRuntimeSourceInstrumentation';
import { createPreviewGraphqlFragmentValueReplacements } from './previewGraphqlFragmentValueInstrumentation';
import { PreviewGraphqlDocumentInstrumentation } from './previewGraphqlDocumentInstrumentation';
import {
  appendPreviewSourceImports,
  applyPreviewSourceReplacements,
  PreviewSourceTransformError,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';
import { PreviewSourceBindingAllocator } from './previewSourceBindingAllocator';
import { requiresFastDependencyCompatibility } from './previewFastDependencyCompatibility';
import { createPreviewReactJsxNamespaceCompatibilityImport } from './previewReactJsxNamespaceCompatibility';
import { deferPreviewDormantOverlayImports } from './previewDormantOverlayDeferral';
import {
  createDynamicTemplateDiscoveryPatterns,
  createDynamicTemplateLoaderProperties,
  createDynamicTemplatePlan,
  matchesDynamicTemplateCandidate,
} from './previewDynamicModuleResolution';
import type { PreviewSourceTransformerOptions } from './previewSourceTransformerOptions';
export { PreviewSourceTransformError } from './previewSourceReplacement';
export type { PreviewSourceTransformerOptions } from './previewSourceTransformerOptions';
const MAX_BUILD_EXPANSIONS = 128;
const MAX_BUILD_MATCH_REFERENCES = 1024;
const MAX_BUILD_SCANNED_ENTRIES = 16_384;
const MAX_BUILD_WATCH_DIRECTORIES = 128;
/** Transformed module source and directories that can gain future matching files. */
export interface PreviewSourceTransformResult {
  /** JavaScript or TypeScript source containing only explicit bundle-visible imports. */
  readonly contents: string;
  /** Glob roots used to route newly created or saved files back to the preview session. */
  readonly watchDirectories: readonly string[];
}
/** Parsed Vite glob behavior accepted by the safe compatibility layer. */
interface GlobOptions {
  /** Whether modules are imported synchronously at module evaluation time. */
  readonly eager: boolean;
  /** Namespace, default, or named export returned for each key. */
  readonly importName?: string;
  /** Optional asset query appended only to generated import specifiers. */
  readonly query?: string;
}

/** Static Webpack context parameters after non-evaluating parsing. */
interface RequireContextOptions {
  /** Relative directory exposed as the context key root. */
  readonly directory: string;
  /** Regular expression applied to `./`-prefixed context keys. */
  readonly matcher: RegExp;
  /** Whether files below nested directories are considered. */
  readonly recursive: boolean;
}

/** Stateful per-build transformer that also accumulates watched glob directories. */
export class PreviewSourceTransformer {
  private expansionCount = 0;
  private readonly expansionCache = new Map<string, Promise<StaticPatternExpansion>>();
  private matchedReferenceCount = 0;
  private readonly referencedImplicitPackageGlobals = new Set<string>();
  private routerConsumerDetected = false;
  private routerProviderDetected = false;
  private readonly scanBudget: StaticScanBudget = {
    maximum: MAX_BUILD_SCANNED_ENTRIES,
    visited: 0,
  };
  private readonly watchDirectories = new Set<string>();
  private readonly graphqlInstrumentation: PreviewGraphqlDocumentInstrumentation | undefined;
  private readonly runtimeHookChildPropDemands:
    PreviewRuntimeHookChildPropDemandCatalogBuilder | undefined;
  /** Creates a transformer without reading or executing project build configuration. */
  public constructor(private readonly options: PreviewSourceTransformerOptions) {
    this.graphqlInstrumentation =
      options.instrumentGraphqlDocuments === true && options.graphqlModuleResolver !== undefined
        ? new PreviewGraphqlDocumentInstrumentation({
            ...(options.readGraphqlSource === undefined
              ? {}
              : { readSource: options.readGraphqlSource }),
            resolveModule: options.graphqlModuleResolver.resolve,
            workspaceRoot: options.workspaceRoot,
          })
        : undefined;
    this.runtimeHookChildPropDemands =
      options.instrumentRuntimeHookFallbacks === true && options.graphqlModuleResolver !== undefined
        ? new PreviewRuntimeHookChildPropDemandCatalogBuilder({
            ...(options.readGraphqlSource === undefined
              ? {}
              : { readSource: options.readGraphqlSource }),
            resolveModule: options.graphqlModuleResolver.resolve,
            workspaceRoot: options.workspaceRoot,
          })
        : undefined;
  }

  /** Reports whether this transformer owns a provisional first-paint compilation. */
  public get usesFastPreparation(): boolean {
    return this.options.fastPreparation === true;
  }

  /**
   * Rewrites all supported resource expressions in one project-owned source module.
   *
   * @param sourcePath Absolute source module path used as the relative discovery base.
   * @param sourceText Original editor or filesystem contents.
   * @returns Explicit-import source and the complete current watch-directory set.
   */
  public async transform(
    sourcePath: string,
    sourceText: string,
  ): Promise<PreviewSourceTransformResult> {
    if (isPathInside(this.options.workspaceRoot, sourcePath))
      sourceText = framework.prepareFrameworkSource(sourcePath, sourceText, this.options);
    if (
      this.options.deferDormantOverlayImports === true &&
      this.options.implicitPackageGlobalResolver !== undefined
    ) {
      sourceText = deferPreviewDormantOverlayImports({
        allowProvisionalSideEffectDeferral: true,
        resolver: this.options.implicitPackageGlobalResolver,
        sourcePath,
        sourceText,
        workspaceRoot: this.options.workspaceRoot,
      });
    }
    const initialWatchDirectories = new Set(this.watchDirectories);
    if (this.canUseFastDependencyPassThrough(sourcePath, sourceText)) {
      return { contents: sourceText, watchDirectories: [] };
    }
    const replacements: PreviewSourceReplacement[] = [];
    const generatedImports: string[] = [];
    const analysis = new StaticSourceAnalysis(sourcePath, sourceText);
    const bindings = new PreviewSourceBindingAllocator(analysis);
    const allocate = (kind: string): string => bindings.next(kind);
    if (isPathInside(this.options.workspaceRoot, sourcePath)) {
      const reactJsxNamespaceImport = createPreviewReactJsxNamespaceCompatibilityImport(
        analysis,
        this.options.projectUsesReactRuntime,
        () => this.options.jsxRuntimeResolver?.usesAlternativeJsxRuntime(sourcePath) === true,
      );
      if (reactJsxNamespaceImport !== undefined) {
        generatedImports.push(reactJsxNamespaceImport);
      }
      if (
        this.options.implicitPackageGlobalResolver !== undefined &&
        (this.options.implicitPackageGlobalCandidateNames?.length ?? 0) > 0
      ) {
        const inventory = collectPreviewImplicitPackageGlobals({
          candidateNames: this.options.implicitPackageGlobalCandidateNames ?? [],
          resolver: this.options.implicitPackageGlobalResolver,
          sourceAnalysis: analysis,
          sourcePath,
          sourceText,
        });
        for (const packageGlobal of inventory.globals) {
          this.referencedImplicitPackageGlobals.add(packageGlobal.globalName);
        }
      }
      if (sourceText.includes('react-router')) {
        const routerRequirement = collectPreviewRouterRequirement(sourcePath, sourceText);
        this.routerConsumerDetected ||= routerRequirement.consumesRouter;
        this.routerProviderDetected ||= routerRequirement.ownsRouter;
      }
      if (sourceText.includes('formik')) {
        const formikRequirement = collectPreviewFormikRequirement(sourcePath, sourceText);
        if (formikRequirement.consumesFormik || formikRequirement.ownsFormik) {
          const registrationBinding = bindings.next('formikRequirement');
          generatedImports.push(
            `import { registerPreviewFormikRequirement as ${registrationBinding} } from ${JSON.stringify(PREVIEW_FORMIK_SPECIFIER)};`,
            `${registrationBinding}(${JSON.stringify(formikRequirement)});`,
          );
        }
      }
      if (sourceText.includes('createContext')) {
        replacements.push(...createReactContextFallbackReplacements(sourcePath, sourceText));
      }
      replacements.push(...framework.createFrameworkReplacements(sourcePath, sourceText));
      if (sourceText.includes('Context')) {
        const contextIdentityInventory =
          sourceText.includes('createContext') && sourceText.includes('useContext')
            ? collectReactContextIdentityPairs(sourcePath, sourceText)
            : { pairs: [], truncated: false };
        const contextHookFallback = createReactContextHookFallbackTransform(sourcePath, sourceText);
        replacements.push(...contextHookFallback.replacements);
        const contextRegistrations = createContextRegistrationStatements(
          contextIdentityInventory.pairs,
          contextHookFallback,
          allocate,
        );
        generatedImports.push(
          ...contextRegistrations.imports,
          ...contextHookFallback.declarations,
          ...contextRegistrations.statements,
        );
      }
      if (this.options.instrumentRuntimeHookFallbacks === true && sourceText.includes('use')) {
        replacements.push(
          ...createPreviewRuntimeHookReplacements(
            sourcePath,
            sourceText,
            this.runtimeHookChildPropDemands?.collect(sourcePath, sourceText),
          ),
        );
      }
      if (
        this.options.instrumentRuntimeHookFallbacks === true &&
        sourceText.includes('getFragmentData')
      ) {
        replacements.push(...createPreviewGraphqlFragmentValueReplacements(sourcePath, sourceText));
      }
      if (sourceText.includes('gql')) {
        replacements.push(
          ...(this.graphqlInstrumentation?.createReplacements(sourcePath, sourceText, analysis) ??
            []),
        );
      }
      if (
        this.options.documentPath !== undefined &&
        path.normalize(sourcePath) === path.normalize(this.options.documentPath) &&
        this.options.instrumentRenderConditions !== true
      ) {
        replacements.push(...createReactExportPropFallbackReplacements(sourcePath, sourceText));
      }
      if (sourceText.includes('styled-components')) {
        const themeInstrumentation = createPreviewThemeSourceInstrumentation(
          sourcePath,
          sourceText,
          allocate,
        );
        replacements.push(...themeInstrumentation.replacements);
        generatedImports.push(...themeInstrumentation.imports);
      }
      const reduxStateContainerPaths = collectPreviewReduxStateContainerPaths(
        sourcePath,
        sourceText,
      );
      if (reduxStateContainerPaths.length > 0) {
        const registrationBinding = bindings.next('reduxState');
        generatedImports.push(
          `import { registerPreviewReduxStateContainerPaths as ${registrationBinding} } from ${JSON.stringify(PREVIEW_REDUX_SPECIFIER)};`,
          `${registrationBinding}(${JSON.stringify(reduxStateContainerPaths)});`,
        );
      }
    }

    for (const [calls, eagerByCallee] of [
      [analysis.findCalls('import.meta.globEager'), true],
      [analysis.findCalls('import.meta.glob'), false],
    ] as const) {
      for (const call of calls) {
        const transformed = await this.transformImportMetaGlob(
          sourcePath,
          call,
          eagerByCallee,
          bindings,
        );
        generatedImports.push(...transformed.imports);
        replacements.push({ ...call, replacement: transformed.expression });
      }
    }

    for (const call of analysis.findCalls('require.context')) {
      const transformed = await this.transformRequireContext(sourcePath, call);
      replacements.push({ ...call, replacement: transformed.expression });
    }

    for (const call of analysis.findCalls('new URL')) {
      const transformed = this.transformNewUrl(call, bindings);
      if (transformed === undefined) continue;
      generatedImports.push(transformed.importStatement);
      replacements.push({ ...call, replacement: transformed.expression });
    }

    for (const call of analysis.findCalls('import')) {
      const transformed = await this.transformDynamicImport(sourcePath, call);
      if (transformed !== undefined) {
        replacements.push({ ...call, replacement: transformed });
      }
    }

    for (const call of analysis.findCalls('require')) {
      const transformed = await this.transformDynamicRequire(sourcePath, call);
      if (transformed !== undefined) {
        replacements.push({ ...call, replacement: transformed });
      }
    }

    const compatibilitySource = applyPreviewSourceReplacements(
      sourceText,
      selectCompatiblePreviewSourceReplacements(replacements),
    );
    const dataBoundarySource =
      this.options.instrumentDataRequests === true
        ? instrumentPreviewDataRequests(sourcePath, compatibilitySource)
        : compatibilitySource;
    const runtimeSource = instrumentPreviewRuntimeSource(sourcePath, dataBoundarySource, {
      isolateEffects: this.options.instrumentRuntimeEffectIsolation === true,
      renderConditions: this.options.instrumentRenderConditions === true,
    });
    generatedImports.push(...runtimeSource.registrations);
    return {
      contents: appendPreviewSourceImports(runtimeSource.source, generatedImports),
      watchDirectories: [...this.watchDirectories]
        .filter((directoryPath) => !initialWatchDirectories.has(directoryPath))
        .sort(),
    };
  }

  /** Returns every glob directory discovered across modules in this compilation request. */
  public getWatchDirectories(): readonly string[] {
    return [...this.watchDirectories].sort();
  }

  /** Adds one trusted source directory discovered by a cooperating build-time fallback boundary. */
  public registerWatchDirectory(directoryPath: string): void {
    const normalizedPath = path.normalize(directoryPath);
    if (
      this.watchDirectories.has(normalizedPath) ||
      this.watchDirectories.size < MAX_BUILD_WATCH_DIRECTORIES
    ) {
      this.watchDirectories.add(normalizedPath);
    }
  }

  /** Returns exact installed-package globals proven free in modules reached by this build. */
  public getReferencedImplicitPackageGlobalNames(): readonly string[] {
    return [...this.referencedImplicitPackageGlobals].sort();
  }

  /**
   * Returns router evidence accumulated from every workspace module esbuild actually requested.
   * Consumer and provider flags remain separate so setup-owned or target-owned routers prevent an
   * unsafe automatic outer boundary while unrelated setup files no longer suppress routing.
   *
   * @returns Immutable graph-level router requirement snapshot for adaptive recompilation.
   */
  public getRouterRequirement(): PreviewRouterRequirement {
    return {
      consumesRouter: this.routerConsumerDetected,
      ownsRouter: this.routerProviderDetected,
    };
  }

  /**
   * Leaves ordinary fast descendants to esbuild's native parser instead of allocating several
   * TypeScript trees per module. The selected target, provider definitions, framework adapters,
   * and non-native resource expressions still use the complete compatibility pipeline. Full
   * preparation never enters this path and therefore remains the exact Inspector artifact.
   */
  private canUseFastDependencyPassThrough(sourcePath: string, sourceText: string): boolean {
    if (this.options.fastPreparation !== true) return false;
    if (
      this.options.documentPath !== undefined &&
      path.normalize(sourcePath) === path.normalize(this.options.documentPath)
    ) {
      return false;
    }
    return !requiresFastDependencyCompatibility(sourceText, this.options.projectUsesNextRuntime);
  }

  /** Transforms one Vite glob call into a deterministic lazy or eager object literal. */
  private async transformImportMetaGlob(
    sourcePath: string,
    call: StaticCallExpression,
    eagerByCallee: boolean,
    bindings: PreviewSourceBindingAllocator,
  ): Promise<{
    readonly expression: string;
    readonly imports: readonly string[];
  }> {
    const arguments_ = call.arguments;
    assertArgumentCount(arguments_, 1, 2, 'import.meta.glob', sourcePath);
    const patterns = parseStaticStringList(arguments_[0] ?? '');
    if (patterns === undefined) {
      throw new PreviewSourceTransformError(
        `${sourcePath}: import.meta.glob patterns must be string literals or a literal string array.`,
      );
    }

    const globOptions = parseGlobOptions(arguments_[1], eagerByCallee, sourcePath);
    const expansion = await this.expand(
      sourcePath,
      patterns,
      undefined,
      this.options.projectRoot,
      MAX_BUILD_MATCH_REFERENCES,
    );
    const imports: string[] = [];
    const properties: string[] = [];
    for (const match of expansion.matches) {
      const importSpecifier = appendImportQuery(match.specifier, globOptions.query);
      if (globOptions.eager) {
        const binding = bindings.next('glob');
        imports.push(createEagerImport(binding, importSpecifier, globOptions.importName));
        properties.push(`${JSON.stringify(match.key)}: ${binding}`);
      } else {
        properties.push(
          `${JSON.stringify(match.key)}: ${createLazyImport(importSpecifier, globOptions.importName)}`,
        );
      }
    }

    return {
      expression: `({${properties.join(',')}})`,
      imports,
    };
  }

  /** Transforms one relative template or concatenated dynamic import into a finite loader lookup. */
  private async transformDynamicImport(
    sourcePath: string,
    call: StaticCallExpression,
  ): Promise<string | undefined> {
    const arguments_ = call.arguments;
    const firstArgument = arguments_[0] ?? '';
    const staticSpecifier = parseStaticString(firstArgument);
    if (staticSpecifier !== undefined) {
      return undefined;
    }
    const template = firstArgument;
    const templateSegments = parseDynamicPathSegments(template);
    if (templateSegments === undefined) {
      throw new PreviewSourceTransformError(
        `${sourcePath}: dynamic import expressions must be a static string or a bounded relative template or string concatenation.`,
      );
    }
    assertArgumentCount(arguments_, 1, 1, 'dynamic import', sourcePath);

    const plan = createDynamicTemplatePlan(templateSegments, sourcePath);
    const expansion = await this.expand(
      sourcePath,
      createDynamicTemplateDiscoveryPatterns(plan),
      (relativeKey) => matchesDynamicTemplateCandidate(plan, relativeKey),
    );
    const properties = createDynamicTemplateLoaderProperties(plan, expansion.matches, true);
    const loaders = `({${properties.join(',')}})`;
    return createBoundedLoaderExpression(template, loaders, 'dynamic import', true);
  }

  /** Transforms one finite CommonJS path expression into a synchronous bounded module lookup. */
  private async transformDynamicRequire(
    sourcePath: string,
    call: StaticCallExpression,
  ): Promise<string | undefined> {
    const arguments_ = call.arguments;
    const firstArgument = arguments_[0] ?? '';
    if (arguments_.length === 1 && parseStaticString(firstArgument) !== undefined) {
      return undefined;
    }
    assertArgumentCount(arguments_, 1, 1, 'require', sourcePath);
    const staticSegments = parseDynamicPathSegments(firstArgument);
    if (staticSegments === undefined) {
      throw new PreviewSourceTransformError(
        `${sourcePath}: require expressions must be a static string or a bounded relative template or string concatenation.`,
      );
    }

    const plan = createDynamicTemplatePlan(staticSegments, sourcePath);
    const expansion = await this.expand(
      sourcePath,
      createDynamicTemplateDiscoveryPatterns(plan),
      (relativeKey) => matchesDynamicTemplateCandidate(plan, relativeKey),
    );
    const properties = createDynamicTemplateLoaderProperties(plan, expansion.matches, false);
    return createBoundedLoaderExpression(
      firstArgument,
      `({${properties.join(',')}})`,
      'require',
      false,
    );
  }

  /** Transforms one static Webpack require context into eager imports plus a context-compatible map. */
  private async transformRequireContext(
    sourcePath: string,
    call: StaticCallExpression,
  ): Promise<{
    readonly expression: string;
  }> {
    const context = parseRequireContext(call.arguments, sourcePath);
    const globPattern = `${context.directory.replace(/\/$/u, '')}/${context.recursive ? '**/*' : '*'}`;
    const importerDirectory = path.dirname(sourcePath);
    const contextDirectory = path.resolve(importerDirectory, context.directory);
    const expansion = await this.expand(sourcePath, [globPattern], (relativeKey) => {
      const absoluteMatch = path.resolve(importerDirectory, relativeKey);
      const contextKey = createRelativeKey(contextDirectory, absoluteMatch);
      context.matcher.lastIndex = 0;
      return context.matcher.test(contextKey);
    });
    const properties: string[] = [];

    for (const match of expansion.matches) {
      const absoluteMatch = path.resolve(importerDirectory, match.specifier);
      const contextKey = createRelativeKey(contextDirectory, absoluteMatch);
      properties.push(
        `${JSON.stringify(contextKey)}: () => require(${JSON.stringify(match.specifier)})`,
      );
    }

    const loaders = `({${properties.join(',')}})`;
    const expression = `(() => { const loaders = ${loaders}; const context = (key) => { if (!Object.prototype.hasOwnProperty.call(loaders, key)) throw new Error("React Preview require.context key not found: " + key); return loaders[key](); }; context.keys = () => Object.keys(loaders); context.resolve = (key) => key; context.id = ${JSON.stringify(`react-preview:${context.directory}`)}; return context; })()`;
    return { expression };
  }

  /** Converts one static new-URL asset expression into an explicit bounded URL import. */
  private transformNewUrl(
    call: StaticCallExpression,
    bindings: PreviewSourceBindingAllocator,
  ):
    | {
        readonly expression: string;
        readonly importStatement: string;
      }
    | undefined {
    const arguments_ = call.arguments;
    const assetPath = parseStaticString(arguments_[0] ?? '');
    const hasImportMetaBase = isStaticImportMetaUrl(arguments_[1] ?? '');
    if (assetPath === undefined || !hasImportMetaBase) {
      return undefined;
    }
    if (arguments_.length !== 2) {
      throw new PreviewSourceTransformError(
        'new URL static assets require exactly two arguments in React Preview.',
      );
    }
    if (
      /^[A-Za-z][A-Za-z\d+.-]*:/u.test(assetPath) ||
      assetPath.startsWith('//') ||
      assetPath.startsWith('?') ||
      assetPath.startsWith('#')
    ) {
      return undefined;
    }

    const binding = bindings.next('url');
    const importSpecifier = createUrlImportSpecifier(assetPath, this.options.projectRoot);
    return {
      expression: `new URL(${binding})`,
      importStatement: `import ${binding} from ${JSON.stringify(importSpecifier)};`,
    };
  }

  /** Expands patterns and accumulates their finite watch roots for controller change routing. */
  private async expand(
    sourcePath: string,
    patterns: readonly string[],
    matchFilter?: (relativeKey: string) => boolean,
    rootRelativeBaseDirectory?: string,
    maxMatches?: number,
  ): Promise<StaticPatternExpansion> {
    try {
      this.expansionCount += 1;
      if (this.expansionCount > MAX_BUILD_EXPANSIONS) {
        throw new StaticPatternError(
          `Static resource discovery exceeded ${MAX_BUILD_EXPANSIONS.toString()} macro expansions in one preview build.`,
        );
      }

      const cacheKey =
        matchFilter === undefined
          ? `${sourcePath}\0${rootRelativeBaseDirectory ?? ''}\0${maxMatches?.toString() ?? ''}\0${JSON.stringify(patterns)}`
          : undefined;
      let expansionPromise = cacheKey === undefined ? undefined : this.expansionCache.get(cacheKey);
      if (expansionPromise === undefined) {
        expansionPromise = expandStaticPatterns({
          aggregateScanBudget: this.scanBudget,
          importerPath: sourcePath,
          ...(matchFilter === undefined ? {} : { matchFilter }),
          ...(maxMatches === undefined ? {} : { maxMatches }),
          patterns,
          ...(rootRelativeBaseDirectory === undefined ? {} : { rootRelativeBaseDirectory }),
          workspaceRoot: this.options.workspaceRoot,
        });
        if (cacheKey !== undefined) {
          this.expansionCache.set(cacheKey, expansionPromise);
        }
      }
      const expansion = await expansionPromise;
      this.matchedReferenceCount += expansion.matches.length;
      if (this.matchedReferenceCount > MAX_BUILD_MATCH_REFERENCES) {
        throw new StaticPatternError(
          `Static resource discovery generated more than ${MAX_BUILD_MATCH_REFERENCES.toString()} module references in one preview build.`,
        );
      }
      for (const directoryPath of expansion.watchDirectories) {
        this.watchDirectories.add(directoryPath);
        if (this.watchDirectories.size > MAX_BUILD_WATCH_DIRECTORIES) {
          throw new StaticPatternError(
            `Static resource discovery produced more than ${MAX_BUILD_WATCH_DIRECTORIES.toString()} watched directories in one preview build.`,
          );
        }
      }
      return expansion;
    } catch (error) {
      if (error instanceof StaticPatternError) {
        throw new PreviewSourceTransformError(`${sourcePath}: ${error.message}`);
      }
      throw error;
    }
  }
}

/** Parses the bounded Vite glob option subset used by the generated object. */
function parseGlobOptions(
  rawOptions: string | undefined,
  eagerByCallee: boolean,
  sourcePath: string,
): GlobOptions {
  const options = parseStaticObject(rawOptions);
  if (options === undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob options must be a simple object literal without spreads or computed properties.`,
    );
  }
  const supportedOptionNames = new Set(['as', 'eager', 'import', 'query']);
  const unsupportedOptionName = [...options.keys()].find(
    (optionName) => !supportedOptionNames.has(optionName),
  );
  if (unsupportedOptionName !== undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob option ${JSON.stringify(unsupportedOptionName)} is not supported by React Preview.`,
    );
  }
  const rawEager = options.get('eager');
  if (rawEager !== undefined && rawEager !== 'true' && rawEager !== 'false') {
    throw new PreviewSourceTransformError(`${sourcePath}: import.meta.glob eager must be boolean.`);
  }

  const rawImportName = options.get('import');
  let importName = rawImportName === undefined ? undefined : parseStaticString(rawImportName);
  if (rawImportName !== undefined && importName === undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob import must be a string literal.`,
    );
  }

  const hasLegacyAs = options.has('as');
  if (hasLegacyAs && (options.has('query') || options.has('import'))) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob legacy as cannot be combined with query or import.`,
    );
  }
  const rawQuery = options.get('query') ?? options.get('as');
  const parsedQuery = rawQuery === undefined ? undefined : parseStaticString(rawQuery);
  if (rawQuery !== undefined && parsedQuery === undefined) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob query must be a string literal.`,
    );
  }
  if (hasLegacyAs && parsedQuery !== 'raw' && parsedQuery !== 'url') {
    throw new PreviewSourceTransformError(
      `${sourcePath}: import.meta.glob legacy as supports only "raw" or "url".`,
    );
  }
  const query = hasLegacyAs && parsedQuery !== undefined ? `?${parsedQuery}` : parsedQuery;
  if (hasLegacyAs) {
    importName = 'default';
  }

  return {
    eager: eagerByCallee || rawEager === 'true',
    ...(importName === undefined ? {} : { importName }),
    ...(query === undefined ? {} : { query }),
  };
}

/** Parses the static directory, recursion flag, and regular expression of `require.context`. */
function parseRequireContext(
  arguments_: readonly string[],
  sourcePath: string,
): RequireContextOptions {
  assertArgumentCount(arguments_, 1, 3, 'require.context', sourcePath);
  const directory = parseStaticString(arguments_[0] ?? '');
  if (
    directory === undefined ||
    (!directory.startsWith('./') && !directory.startsWith('../')) ||
    /[*?{}\0]/u.test(directory)
  ) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context directory must be a relative literal without glob metacharacters.`,
    );
  }

  const rawRecursive = arguments_[1] ?? 'true';
  if (rawRecursive !== 'true' && rawRecursive !== 'false') {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context recursion must be boolean.`,
    );
  }

  const matcher = parseRegularExpression(arguments_[2] ?? '/^\\.\\//', sourcePath);
  return { directory, matcher, recursive: rawRecursive === 'true' };
}

/**
 * Rejects macro overloads whose additional expressions would be dropped by a compatibility rewrite.
 *
 * @param arguments_ Top-level call arguments preserved as raw source segments.
 * @param minimum Smallest arity supported by the preview compatibility layer.
 * @param maximum Largest arity supported without losing runtime behavior.
 * @param callee User-facing macro name included in the diagnostic.
 * @param sourcePath Source module path included in the diagnostic.
 */
function assertArgumentCount(
  arguments_: readonly string[],
  minimum: number,
  maximum: number,
  callee: string,
  sourcePath: string,
): void {
  if (arguments_.length < minimum || arguments_.length > maximum) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: ${callee} requires ${
        minimum === maximum
          ? `exactly ${minimum.toString()}`
          : `${minimum.toString()} to ${maximum.toString()}`
      } static arguments in React Preview.`,
    );
  }
}

/** Parses a bounded regular-expression literal without accepting executable constructor syntax. */
function parseRegularExpression(source: string, sourcePath: string): RegExp {
  const match = /^\/((?:\\.|[^/])*)\/([imu]*)$/u.exec(source.trim());
  if (match === null || (match[1]?.length ?? 0) > 200) {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context filter must be a regular-expression literal under 200 characters.`,
    );
  }
  const pattern = match[1] ?? '';
  assertSafeContextRegularExpression(pattern, sourcePath);
  try {
    return new RegExp(pattern, match[2] ?? '');
  } catch {
    throw new PreviewSourceTransformError(
      `${sourcePath}: require.context filter is not a valid regular-expression literal.`,
    );
  }
}

/**
 * Rejects regex features and nested quantifiers that can cause pathological backtracking while
 * filtering thousands of discovered keys. Common extension/alternation filters remain supported.
 */
function assertSafeContextRegularExpression(pattern: string, sourcePath: string): void {
  if (/\\(?:[1-9]|k<)|\(\?(?!:)/u.test(pattern)) {
    throwUnsafeContextRegularExpression(sourcePath);
  }

  const groups: { containsAlternation: boolean; containsQuantifier: boolean }[] = [];
  let insideCharacterClass = false;
  let quantifierCount = 0;
  let rangedBraceQuantifierCount = 0;
  let unboundedQuantifierCount = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') {
      insideCharacterClass = true;
      continue;
    }
    if (character === ']' && insideCharacterClass) {
      insideCharacterClass = false;
      continue;
    }
    if (insideCharacterClass) {
      continue;
    }
    if (character === '(') {
      groups.push({ containsAlternation: false, containsQuantifier: false });
      continue;
    }
    if (character === '|') {
      const group = groups.at(-1);
      if (group !== undefined) {
        group.containsAlternation = true;
      }
      continue;
    }
    if (character === ')') {
      const group = groups.pop();
      const nextCharacter = pattern[index + 1] ?? '';
      const groupIsQuantified = /[*+?{]/u.test(nextCharacter);
      if (
        groupIsQuantified &&
        group !== undefined &&
        (group.containsAlternation || group.containsQuantifier)
      ) {
        throwUnsafeContextRegularExpression(sourcePath);
      }
      if (groupIsQuantified) {
        const parent = groups.at(-1);
        if (parent !== undefined) {
          parent.containsQuantifier = true;
        }
      }
      const parent = groups.at(-1);
      if (parent !== undefined && group !== undefined) {
        parent.containsAlternation ||= group.containsAlternation;
        parent.containsQuantifier ||= group.containsQuantifier;
      }
      continue;
    }
    const isQuestionQuantifier = character === '?' && pattern[index - 1] !== '(';
    const braceQuantifier =
      character === '{' ? /^\{(\d+)(?:,(\d*))?\}/u.exec(pattern.slice(index)) : null;
    const isBraceQuantifier = braceQuantifier !== null;
    const lowerBraceBound = Number(braceQuantifier?.[1] ?? 0);
    const rawUpperBraceBound = braceQuantifier?.[2];
    const upperBraceBound =
      rawUpperBraceBound === undefined || rawUpperBraceBound.length === 0
        ? lowerBraceBound
        : Number(rawUpperBraceBound);
    if (isBraceQuantifier && (lowerBraceBound > 256 || upperBraceBound > 256)) {
      throwUnsafeContextRegularExpression(sourcePath);
    }
    const isRangedBraceQuantifier = rawUpperBraceBound !== undefined;
    rangedBraceQuantifierCount += isRangedBraceQuantifier ? 1 : 0;
    const isUnboundedQuantifier =
      character === '*' || character === '+' || rawUpperBraceBound === '';
    if (isQuestionQuantifier || isBraceQuantifier || isUnboundedQuantifier) {
      quantifierCount += 1;
      unboundedQuantifierCount += isUnboundedQuantifier ? 1 : 0;
      if (quantifierCount > 8 || rangedBraceQuantifierCount > 1 || unboundedQuantifierCount > 1) {
        throwUnsafeContextRegularExpression(sourcePath);
      }
      const group = groups.at(-1);
      if (group !== undefined) {
        group.containsQuantifier = true;
      }
    }
  }
}

/** Raises the shared actionable diagnostic for a potentially pathological context filter. */
function throwUnsafeContextRegularExpression(sourcePath: string): never {
  throw new PreviewSourceTransformError(
    `${sourcePath}: require.context filter must avoid lookarounds, backreferences, large or repeated range quantifiers, repeated unbounded quantifiers, and nested quantified groups.`,
  );
}

/** Generates a static import matching Vite namespace, default, or named-export selection. */
function createEagerImport(
  binding: string,
  specifier: string,
  importName: string | undefined,
): string {
  if (importName === undefined || importName === '*') {
    return `import * as ${binding} from ${JSON.stringify(specifier)};`;
  }
  return `import { ${JSON.stringify(importName)} as ${binding} } from ${JSON.stringify(specifier)};`;
}

/** Generates a lazy import and optional export-selection promise. */
function createLazyImport(specifier: string, importName: string | undefined): string {
  const baseImport = `() => import(${JSON.stringify(specifier)})`;
  return importName === undefined || importName === '*'
    ? baseImport
    : `() => import(${JSON.stringify(specifier)}).then((module) => module[${JSON.stringify(importName)}])`;
}

/** Appends one transform query before an optional URL fragment. */
function appendImportQuery(specifier: string, query: string | undefined): string {
  if (query === undefined || query.length === 0) {
    return specifier;
  }
  const normalizedQuery = query.startsWith('?') ? query : `?${query}`;
  const fragmentIndex = specifier.indexOf('#');
  return fragmentIndex < 0
    ? `${specifier}${normalizedQuery}`
    : `${specifier.slice(0, fragmentIndex)}${normalizedQuery}${specifier.slice(fragmentIndex)}`;
}

/**
 * Generates one evaluation, path normalization, and finite loader lookup for dynamic module paths.
 * Normalization aligns `./a/../b` and duplicate-slash runtime values with filesystem match keys.
 *
 * @param argumentExpression Original dynamic argument evaluated exactly once.
 * @param loaders Finite object literal mapping normalized keys to module thunks.
 * @param callee User-facing operation name included in a missing-key error.
 * @param asynchronous Whether a miss rejects a promise instead of throwing synchronously.
 * @returns Browser JavaScript expression preserving import or require timing semantics.
 */
function createBoundedLoaderExpression(
  argumentExpression: string,
  loaders: string,
  callee: string,
  asynchronous: boolean,
): string {
  const message = JSON.stringify(`React Preview could not resolve ${callee}: `);
  const missingResult = asynchronous
    ? `return Promise.reject(new Error(${message} + value));`
    : `throw new Error(${message} + value);`;
  return `((specifier) => { const value = String(specifier); const suffixIndex = [value.indexOf("?"), value.indexOf("#")].filter((index) => index >= 0).reduce((lowest, index) => Math.min(lowest, index), value.length); const sourcePath = value.slice(0, suffixIndex); const suffix = value.slice(suffixIndex); const parts = []; for (const part of sourcePath.split("/")) { if (part === "" || part === ".") continue; if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop(); else if (part !== ".." || parts.length === 0 || parts[parts.length - 1] === "..") parts.push(part); } const normalized = (parts[0] === ".." ? "" : "./") + parts.join("/") + suffix; const loader = ${loaders}[normalized]; if (loader === undefined) { ${missingResult} } return loader(); })(${argumentExpression})`;
}

/** Separates a dynamic import transform query or fragment from its filesystem match pattern. */
function splitImportSuffix(pattern: string): {
  readonly pathPattern: string;
  readonly suffix: string;
} {
  const queryIndex = pattern.indexOf('?');
  const fragmentIndex = pattern.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), pattern.length);
  return { pathPattern: pattern.slice(0, suffixIndex), suffix: pattern.slice(suffixIndex) };
}

/** Converts an absolute match into a Webpack-style key relative to its context directory. */
function createRelativeKey(contextDirectory: string, filePath: string): string {
  const relativePath = path.relative(contextDirectory, filePath).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/** Creates a `?url` import, mapping root URLs to the conventional workspace public directory. */
function createUrlImportSpecifier(assetPath: string, workspaceRoot: string): string {
  const { pathPattern, suffix } = splitImportSuffix(assetPath);
  const publicDirectory = path.resolve(workspaceRoot, 'public');
  const sourcePath = pathPattern.startsWith('/')
    ? path.resolve(publicDirectory, pathPattern.slice(1))
    : pathPattern.startsWith('.')
      ? pathPattern
      : `./${pathPattern}`;
  if (pathPattern.startsWith('/') && !isPathInside(publicDirectory, sourcePath)) {
    throw new PreviewSourceTransformError(
      `Preview public asset paths must stay inside ${publicDirectory}: ${assetPath}`,
    );
  }
  const fragmentIndex = suffix.indexOf('#');
  const fragment = fragmentIndex < 0 ? '' : suffix.slice(fragmentIndex);
  return `${sourcePath}?url${fragment}`;
}
/** Reports whether one absolute asset path is equal to or contained by a trusted directory. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}
