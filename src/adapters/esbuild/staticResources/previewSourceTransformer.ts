/** Coordinates bounded authored-source analysis for previewSourceTransformer. */
import path from 'node:path';
import { collectPreviewDragDropRequirement } from '../previewDragDropRequirement';
import { collectPreviewFormikRequirement } from '../previewFormikRequirement';
import {
  PREVIEW_DRAG_DROP_SPECIFIER,
  PREVIEW_FORMIK_SPECIFIER,
  PREVIEW_REDUX_SPECIFIER,
  PREVIEW_YARN_LIBUI_SPECIFIER,
} from '../previewPluginProtocol';
import {
  collectPreviewRouterRequirement,
  type PreviewRouterRequirement,
} from '../previewRouterRequirement';
import { collectPreviewYarnLibuiRequirement } from '../previewYarnLibuiRequirement';
import { createPreviewAgGridModuleRegistration } from './previewAgGridModuleRegistration';
import { instrumentPreviewDataRequests } from './previewDataRequestInstrumentation';
import { canPassThroughPreviewDependency } from './previewDependencyPassThroughPolicy';
import { deferPreviewDormantOverlayImports } from './previewDormantOverlayDeferral';
import {
  createDynamicTemplateDiscoveryPatterns,
  createDynamicTemplateLoaderProperties,
  createDynamicTemplatePlan,
  matchesDynamicTemplateCandidate,
} from './previewDynamicModuleResolution';
import * as framework from './previewFrameworkReplacements';
import { PreviewGraphqlDocumentInstrumentation } from './previewGraphqlDocumentInstrumentation';
import { createPreviewGraphqlFragmentValueReplacements } from './previewGraphqlFragmentValueInstrumentation';
import {
  createPreviewGraphqlRenderPropUsageReplacements,
  mayContainPreviewGraphqlRenderPropUsage,
} from './previewGraphqlRenderPropUsageInstrumentation';
import { collectPreviewImplicitPackageGlobals } from './previewImplicitPackageGlobals';
import { instrumentPreviewLocalTargetExportBindings } from './previewLocalTargetExportInstrumentation';
import { createPreviewReactDomPortalContainerReplacements } from './previewReactDomPortalInstrumentation';
import { createPreviewReactJsxNamespaceCompatibilityImport } from './previewReactJsxNamespaceCompatibility';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from './previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from './previewRuntimeHookInstrumentation';
import { createPreviewRuntimeHookTypedCallResolver } from './previewRuntimeHookTypedFallback';
import { instrumentPreviewRuntimeSource } from './previewRuntimeSourceInstrumentation';
import { createPreviewSelectedJsxOccurrences } from './previewSelectedJsxOccurrences';
import { readPreviewSelectedPageTabHookNames } from './previewSelectedPageTabHookProof';
import { typePreviewServerQueries } from './previewServerQueryTyping';
import { PreviewSourceBindingAllocator } from './previewSourceBindingAllocator';
import {
  appendPreviewSourceImports,
  applyPreviewSourceReplacements,
  PreviewSourceTransformError,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';
import type { PreviewSourceTransformerOptions } from './previewSourceTransformerOptions';
import {
  appendImportQuery,
  createBoundedLoaderExpression,
  createEagerImport,
  createLazyImport,
  createRelativeKey,
  createUrlImportSpecifier,
  isPreviewOwnedSourcePath,
} from './previewSourceTransformImports';
import {
  MAX_BUILD_EXPANSIONS,
  MAX_BUILD_MATCH_REFERENCES,
  MAX_BUILD_SCANNED_ENTRIES,
  MAX_BUILD_WATCH_DIRECTORIES,
  type PreviewSourceTransformResult,
} from './previewSourceTransformModel';
import {
  assertArgumentCount,
  parseGlobOptions,
  parseRequireContext,
} from './previewSourceTransformOptions';
import { createPreviewStaticRenderAssetTransform } from './previewStaticRenderAssets';
import { createPreviewThemeSourceInstrumentation } from './previewThemeSourceInstrumentation';
import { createPreviewTypedGuardReplacements } from './previewTypedGuardReplacements';
import { createPreviewTypedModuleRegistrations } from './previewTypedModuleRegistrations';
import { createPreviewTypedResponseShapeResolver } from './previewTypedResponseShape';
import { createReactContextFallbackReplacements } from './reactContextFallback';
import { createReactContextHookFallbackTransform } from './reactContextHookFallback';
import { collectReactContextIdentityPairs } from './reactContextIdentity';
import { createContextRegistrationStatements } from './reactContextRegistration';
import { createReactExportPropFallbackReplacements } from './reactExportPropFallback';
import { instrumentReactConditionalRendering } from './reactConditionalRendering';
import { collectPreviewReduxStateContainerPaths } from './reduxStateContainerPaths';
import {
  isStaticImportMetaUrl,
  parseDynamicPathSegments,
  parseStaticString,
  parseStaticStringList,
  StaticSourceAnalysis,
  type StaticCallExpression,
} from './staticCallParser';
import {
  expandStaticPatterns,
  StaticPatternError,
  type StaticPatternExpansion,
  type StaticScanBudget,
} from './staticPattern';

export { PreviewSourceTransformError } from './previewSourceReplacement';

export type { PreviewSourceTransformerOptions } from './previewSourceTransformerOptions';
export type { PreviewSourceTransformResult } from './previewSourceTransformModel';

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

  /**
   * Declared-type oracle of the build this transformer serves. Persistent esbuild contexts keep
   * their plugins but swap transformers per rebuild, so plugins read the oracle through here.
   */
  public get typeOracle(): PreviewSourceTransformerOptions['typeOracle'] {
    return this.options.typeOracle;
  }

  /** Reports whether this transformer can cheaply pass through ordinary corridor dependencies. */
  public get usesSelectiveDependencyPassThrough(): boolean {
    return this.options.selectiveDependencyPassThrough === true;
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
    // Read before framework rewrites move the compiler-measured target occurrence offsets.
    const selectedOccurrences = createPreviewSelectedJsxOccurrences(
      this.options.selectedTargetOccurrences,
      sourcePath,
      sourceText,
      this.options.trackSelectedJsxOccurrences !== false,
    );
    const selectedTargetNames = selectedOccurrences.names;
    const previewOwnedSource = isPreviewOwnedSourcePath(
      this.options.workspaceRoot,
      this.options.documentPath,
      sourcePath,
    );
    const selectedTabHookNames =
      previewOwnedSource &&
      this.options.instrumentRenderConditions === true &&
      (selectedTargetNames?.size ?? 0) > 0
        ? await readPreviewSelectedPageTabHookNames(
            sourcePath,
            sourceText,
            this.options.admitSelectedPageTabHook,
          )
        : undefined;
    if (previewOwnedSource)
      sourceText = framework.prepareFrameworkSource(sourcePath, sourceText, this.options);
    if (
      previewOwnedSource &&
      this.options.typeOracle !== undefined &&
      this.options.graphqlModuleResolver !== undefined &&
      (this.options.serverContractSourcePaths?.length ?? 0) > 0
    ) {
      sourceText = typePreviewServerQueries(sourcePath, sourceText, {
        contractSourcePaths: new Set(this.options.serverContractSourcePaths),
        oracle: this.options.typeOracle,
        ...(this.options.prismaColumnDefaults === undefined
          ? {}
          : { prismaColumnDefaults: this.options.prismaColumnDefaults }),
        resolveModule: this.options.graphqlModuleResolver.resolve,
      });
    }
    if (
      this.options.deferDormantOverlayImports === true &&
      this.options.implicitPackageGlobalResolver !== undefined
    ) {
      sourceText = deferPreviewDormantOverlayImports({
        allowProvisionalSideEffectDeferral: true,
        preservedSourcePaths: [
          ...(this.options.documentPath === undefined ? [] : [this.options.documentPath]),
          ...(this.options.preservedDormantOverlaySourcePaths ?? []),
        ],
        resolver: this.options.implicitPackageGlobalResolver,
        sourcePath,
        sourceText,
        workspaceRoot: this.options.workspaceRoot,
      });
    }
    const initialWatchDirectories = new Set(this.watchDirectories);
    if (canPassThroughPreviewDependency(sourcePath, sourceText, this.options)) {
      // An API module passes through unchanged but still registers its declared response types.
      const typedRegistrations = previewOwnedSource
        ? createPreviewTypedModuleRegistrations(this.options.typeOracle, sourcePath, sourceText)
        : [];
      const selectedSource =
        previewOwnedSource &&
        this.options.instrumentRenderConditions === true &&
        (selectedTargetNames?.size ?? 0) > 0
          ? instrumentReactConditionalRendering(
              sourcePath,
              selectedOccurrences.apply(sourceText),
              undefined,
              selectedTargetNames,
              selectedTabHookNames,
            )
          : sourceText;
      return {
        contents: appendPreviewSourceImports(selectedSource, typedRegistrations),
        watchDirectories: [],
      };
    }
    const replacements: PreviewSourceReplacement[] = [];
    const generatedImports: string[] = [];
    const analysis = new StaticSourceAnalysis(sourcePath, sourceText);
    const bindings = new PreviewSourceBindingAllocator(analysis);
    const allocate = (kind: string): string => bindings.next(kind);
    const staticRenderAssets = await createPreviewStaticRenderAssetTransform({
      bindings,
      projectRoot: this.options.projectRoot,
      sourceAnalysis: analysis,
      sourcePath,
      sourceText,
      workspaceRoot: this.options.workspaceRoot,
    });
    generatedImports.push(...staticRenderAssets.imports);
    replacements.push(...staticRenderAssets.replacements);
    if (previewOwnedSource) {
      const reactJsxNamespaceImport = createPreviewReactJsxNamespaceCompatibilityImport(
        analysis,
        this.options.projectUsesReactRuntime,
        () => this.options.jsxRuntimeResolver?.usesAlternativeJsxRuntime(sourcePath) === true,
      );
      if (reactJsxNamespaceImport !== undefined) {
        generatedImports.push(reactJsxNamespaceImport);
      }
      if (
        this.options.instrumentRuntimeHookFallbacks === true &&
        sourceText.includes('ag-grid-react')
      ) {
        generatedImports.push(
          ...createPreviewAgGridModuleRegistration(
            analysis.getSourceFile(),
            this.options.agGridModulePackage ?? 'community',
            allocate,
          ),
        );
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
      if (sourceText.includes('@yarnpkg/libui')) {
        const libuiRequirement = collectPreviewYarnLibuiRequirement(sourcePath, sourceText);
        if (libuiRequirement.consumesMinistore || libuiRequirement.ownsMinistore) {
          const registrationBinding = bindings.next('yarnLibuiRequirement');
          generatedImports.push(
            `import { registerPreviewYarnLibuiRequirement as ${registrationBinding} } from ${JSON.stringify(PREVIEW_YARN_LIBUI_SPECIFIER)};`,
            `${registrationBinding}(${JSON.stringify(libuiRequirement)});`,
          );
        }
      }
      if (sourceText.includes('react-beautiful-dnd')) {
        const dragDropRequirement = collectPreviewDragDropRequirement(sourcePath, sourceText);
        if (
          dragDropRequirement.consumesDragDropContext ||
          dragDropRequirement.ownsDragDropContext ||
          dragDropRequirement.ownsDroppableContext
        ) {
          const registrationBinding = bindings.next('dragDropRequirement');
          generatedImports.push(
            `import { registerPreviewDragDropRequirement as ${registrationBinding} } from ${JSON.stringify(PREVIEW_DRAG_DROP_SPECIFIER)};`,
            `${registrationBinding}(${JSON.stringify(dragDropRequirement)});`,
          );
        }
      }
      const contextTypeDemand = this.runtimeHookChildPropDemands;
      if (sourceText.includes('createContext')) {
        replacements.push(
          ...createReactContextFallbackReplacements(
            sourcePath,
            sourceText,
            contextTypeDemand?.inferLocalTypeFallback.bind(
              contextTypeDemand,
              sourcePath,
              sourceText,
            ),
          ),
        );
      }
      replacements.push(...framework.createFrameworkReplacements(sourcePath, sourceText));
      if (sourceText.includes('Context')) {
        const contextIdentityInventory =
          sourceText.includes('createContext') && sourceText.includes('useContext')
            ? collectReactContextIdentityPairs(sourcePath, sourceText)
            : { pairs: [], truncated: false };
        const contextHookFallback = createReactContextHookFallbackTransform(
          sourcePath,
          sourceText,
          contextTypeDemand?.inferImportedCollectionCallbackItemFallback.bind(
            contextTypeDemand,
            sourcePath,
            sourceText,
          ),
          contextTypeDemand?.inferImportedHelperParameterFallback.bind(
            contextTypeDemand,
            sourcePath,
            sourceText,
          ),
          contextTypeDemand?.inferImportedHelperParameterPropertyFallback.bind(
            contextTypeDemand,
            sourcePath,
            sourceText,
          ),
          createPreviewRuntimeHookTypedCallResolver(this.options.typeOracle, sourcePath),
          selectedTargetNames,
        );
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
        const typeDemand = this.runtimeHookChildPropDemands;
        replacements.push(
          ...createPreviewRuntimeHookReplacements(
            sourcePath,
            sourceText,
            typeDemand === undefined
              ? undefined
              : () => typeDemand.collect(sourcePath, sourceText, { includeOptionalTypes: true }),
            typeDemand === undefined
              ? undefined
              : (typeNode) => typeDemand.inferLocalTypeFallback(sourcePath, sourceText, typeNode),
            typeDemand?.inferImportedHelperArrayItemFallback.bind(
              typeDemand,
              sourcePath,
              sourceText,
            ),
            typeDemand?.inferImportedHelperParameterPropertyFallback.bind(
              typeDemand,
              sourcePath,
              sourceText,
            ),
            typeDemand?.inferImportedCollectionCallbackItemFallback.bind(
              typeDemand,
              sourcePath,
              sourceText,
            ),
            createPreviewRuntimeHookTypedCallResolver(this.options.typeOracle, sourcePath),
            selectedTargetNames,
            analysis,
          ),
        );
      }
      if (
        this.options.instrumentRuntimeHookFallbacks === true &&
        sourceText.includes('createPortal')
      ) {
        replacements.push(
          ...createPreviewReactDomPortalContainerReplacements(analysis.getSourceFile(), sourceText),
        );
      }
      if (
        this.options.instrumentRuntimeHookFallbacks === true &&
        mayContainPreviewGraphqlRenderPropUsage(sourceText)
      ) {
        replacements.push(
          ...createPreviewGraphqlRenderPropUsageReplacements(
            sourcePath,
            sourceText,
            this.runtimeHookChildPropDemands?.collect(sourcePath, sourceText, {
              includeOptionalTypes: true,
            }),
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

    if (
      previewOwnedSource &&
      this.options.instrumentRenderConditions === true &&
      this.options.typeOracle !== undefined
    ) {
      // Last, so identifier reads never displace a broader compatibility rewrite.
      const typedGuards = createPreviewTypedGuardReplacements(
        sourcePath,
        sourceText,
        this.options.typeOracle,
        allocate,
        replacements,
        analysis,
      );
      replacements.push(...typedGuards.replacements);
      generatedImports.push(
        ...typedGuards.declarations,
        ...createPreviewTypedModuleRegistrations(this.options.typeOracle, sourcePath, sourceText),
      );
    }
    const compatibilitySource = applyPreviewSourceReplacements(
      sourceText,
      selectCompatiblePreviewSourceReplacements(replacements),
    );
    const dataBoundarySource =
      previewOwnedSource && this.options.instrumentDataRequests === true
        ? instrumentPreviewDataRequests(
            sourcePath,
            compatibilitySource,
            createPreviewTypedResponseShapeResolver(this.options.typeOracle, sourcePath),
          )
        : compatibilitySource;
    const localTargetSource = instrumentPreviewLocalTargetExportBindings(
      sourcePath,
      dataBoundarySource,
      this.options.localTargetExportInstrumentation,
    );
    const runtimeSource = instrumentPreviewRuntimeSource(
      sourcePath,
      selectedOccurrences.apply(localTargetSource),
      {
        isolateEffects:
          previewOwnedSource && this.options.instrumentRuntimeEffectIsolation === true,
        registerConditionDefinitions:
          previewOwnedSource &&
          (this.options.documentPath === undefined ||
            path.normalize(sourcePath) === path.normalize(this.options.documentPath)),
        renderConditions: previewOwnedSource && this.options.instrumentRenderConditions === true,
        ...(selectedTargetNames === undefined ? {} : { selectedTargetNames }),
        ...(selectedTabHookNames === undefined ? {} : { selectedTabHookNames }),
      },
    );
    generatedImports.push(...runtimeSource.registrations);
    return {
      contents: appendPreviewSourceImports(runtimeSource.source, generatedImports),
      watchDirectories: [...this.watchDirectories]
        .filter((directoryPath) => !initialWatchDirectories.has(directoryPath))
        .sort(),
    };
  }

  /** Annotates original JSX before a virtual export slice moves the authored offsets. */
  public prepareSelectedTargetOccurrences(sourcePath: string, sourceText: string): string {
    return createPreviewSelectedJsxOccurrences(
      this.options.selectedTargetOccurrences,
      sourcePath,
      sourceText,
      this.options.trackSelectedJsxOccurrences !== false,
    ).apply(sourceText);
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
