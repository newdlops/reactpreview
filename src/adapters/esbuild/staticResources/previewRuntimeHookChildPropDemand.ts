/** Coordinates bounded authored-source analysis for previewRuntimeHookChildPropDemand. */
import path from 'node:path';
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import { createPreviewRuntimeHookChildDemandCatalog } from './previewRuntimeHookChildDemandCatalog';
import {
  collectPreviewRuntimeHookChildShapePaths,
  serializePreviewRuntimeHookChildShape,
} from './previewRuntimeHookChildCollectionDemand';
import {
  MAX_COMPONENT_IMPORTS,
  MAX_SOURCE_CHARACTERS,
  MAX_TRANSITIVE_COMPONENT_DEPTH,
  SOURCE_PATTERN,
  type PreviewRuntimeHookChildPropDemandCatalog,
  type PreviewRuntimeHookChildPropDemandCollectOptions,
  type PreviewRuntimeHookChildPropDemandOptions,
  type PreviewRuntimeHookChildPropUsage,
  type PreviewRuntimeHookLocalTypeFallback,
} from './previewRuntimeHookChildDemandModel';
import { hasParseDiagnostics, readScriptKind } from './previewRuntimeHookChildDemandSyntax';
import { PreviewRuntimeHookChildTypeDemandResolver } from './previewRuntimeHookChildTypeDemand';
import {
  appendShapeUsages,
  collectAllUsedJsxComponentBindings,
  collectHookResultBindings,
  collectImportedComponentBindings,
  collectInlineRenderPropConsumerBindings,
  collectUsedJsxComponentBindings,
  mergeComponentInferences,
} from './previewRuntimeHookChildUsageDemand';
import {
  collectReactExportPropInference,
  collectReactLocalComponentPropInference,
  type PreviewInferredPropShape,
} from './reactExportPropInference';

/**
 * Caches child prop inference for one compilation attempt while keeping every traversal bounded.
 */
export class PreviewRuntimeHookChildPropDemandCatalogBuilder {
  private readonly inferenceCache = new Map<
    string,
    Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> | undefined
  >();
  private readonly presentValueInferenceCache = new Map<
    string,
    Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> | undefined
  >();
  private readonly activeInferenceIdentities = new Set<string>();
  private readonly workspaceRoot: string;
  private readonly typeDemands: PreviewRuntimeHookChildTypeDemandResolver;

  /** Creates a catalog builder without executing project resolvers or configuration code. */
  public constructor(private readonly options: PreviewRuntimeHookChildPropDemandOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.typeDemands = new PreviewRuntimeHookChildTypeDemandResolver(options);
  }

  /** Resolves reached local and imported components rendered by the current source module. */
  public collect(
    sourcePath: string,
    sourceText: string,
    options: PreviewRuntimeHookChildPropDemandCollectOptions = {},
  ): PreviewRuntimeHookChildPropDemandCatalog {
    if (!sourceText.includes('<')) return new Map();
    const sourceFile = readPreviewAnalysisSourceFile(
      sourcePath,
      sourceText,
      readScriptKind(sourcePath),
    );
    if (hasParseDiagnostics(sourceFile)) return new Map();
    const transitiveDepth = options.transitiveDepth ?? 0;
    const imports = collectImportedComponentBindings(sourceFile);
    const usedComponents = new Set([
      ...collectInlineRenderPropConsumerBindings(sourceFile),
      ...collectUsedJsxComponentBindings(sourceFile, collectHookResultBindings(sourceFile)),
    ]);
    // Render-prop data is not a hook binding, but its imported child is still an operation-proven
    // consumer. Keep the catalog bounded and syntax-only for that adjacent use as well.
    collectAllUsedJsxComponentBindings(sourceFile, usedComponents);
    const boundedComponents = [...usedComponents].slice(0, MAX_COMPONENT_IMPORTS);
    return createPreviewRuntimeHookChildDemandCatalog(boundedComponents, (localName) => {
      const localInferences = mergeComponentInferences(
        collectReactLocalComponentPropInference(sourcePath, sourceText, [localName]),
        this.typeDemands.collectLocal(sourcePath, sourceText, [localName], {
          includeOptionalProperties: options.includeOptionalTypes === true,
        }),
      );
      let inference = localInferences[localName];
      if (inference === undefined) {
        const imported = imports.get(localName);
        if (imported === undefined) return undefined;
        const resolvedPath = this.options.resolveModule(imported.moduleSpecifier, sourcePath);
        if (resolvedPath === undefined || !this.isInspectableSource(resolvedPath)) return undefined;
        inference = this.readInference(
          resolvedPath,
          options.includeOptionalTypes === true,
          transitiveDepth + 1,
        )?.[imported.exportName];
      }
      const properties = inference?.shape.properties;
      return properties === undefined || Object.keys(properties).length === 0
        ? undefined
        : new Map(Object.entries(properties));
    });
  }

  /**
   * Serializes a reached local type annotation through the same bounded transitive type resolver.
   *
   * This complements JSX prop demand for data first passed to an imported pure helper. The helper
   * may be the first runtime reader, while an authored `Item[]` annotation already identifies the
   * exact imported item contract without executing that helper.
   */
  public inferLocalTypeFallback(
    sourcePath: string,
    sourceText: string,
    typeNode: ts.TypeNode,
  ): PreviewRuntimeHookLocalTypeFallback | undefined {
    const shape = this.typeDemands.inferLocalType(sourcePath, sourceText, typeNode);
    if (shape === undefined) return undefined;
    return Object.freeze({
      expression: serializePreviewRuntimeHookChildShape(shape, 'item'),
      kind: shape.kind,
      label: 'generated collection item from authored type',
      requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(shape)),
    });
  }

  /**
   * Infers the item required by an Array-typed parameter of a direct imported helper call.
   * Returning an item rather than the parameter root lets the hook usage-tree retain the exact
   * hook-relative response path while applying the helper's nested contract below that collection.
   */
  public inferImportedHelperArrayItemFallback(
    sourcePath: string,
    sourceText: string,
    localName: string,
    parameterIndex: number,
  ): PreviewRuntimeHookLocalTypeFallback | undefined {
    const parameter = this.typeDemands.inferImportedFunctionParameter(
      sourcePath,
      sourceText,
      localName,
      parameterIndex,
    );
    if (parameter?.kind !== 'array' || parameter.items === undefined) return undefined;
    return Object.freeze({
      expression: serializePreviewRuntimeHookChildShape(parameter.items, 'item'),
      kind: parameter.items.kind,
      label: 'generated collection item from imported helper parameter',
      requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(parameter.items)),
    });
  }

  /** Infers the item contract of an exact imported function used as an Array callback. */
  public inferImportedCollectionCallbackItemFallback(
    sourcePath: string,
    sourceText: string,
    localName: string,
    parameterIndex: number,
  ): PreviewRuntimeHookLocalTypeFallback | undefined {
    const parameter = this.typeDemands.inferImportedFunctionParameter(
      sourcePath,
      sourceText,
      localName,
      parameterIndex,
    );
    if (parameter === undefined) return undefined;
    return Object.freeze({
      expression: serializePreviewRuntimeHookChildShape(parameter, 'item'),
      kind: parameter.kind,
      label: 'generated collection item from imported callback parameter',
      requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(parameter)),
    });
  }

  /** Infers every operation-proven field read by one direct imported helper parameter. */
  public inferImportedHelperParameterFallback(
    sourcePath: string,
    sourceText: string,
    localName: string,
    parameterIndex: number,
  ): PreviewRuntimeHookLocalTypeFallback | undefined {
    const parameter = this.typeDemands.inferImportedFunctionParameter(
      sourcePath,
      sourceText,
      localName,
      parameterIndex,
    );
    if (parameter === undefined) return undefined;
    const nestedUsages: PreviewRuntimeHookChildPropUsage[] = [];
    appendShapeUsages(parameter, [], [], nestedUsages, 0);
    return Object.freeze({
      expression: serializePreviewRuntimeHookChildShape(parameter, 'value'),
      kind: parameter.kind,
      label: 'generated value from imported helper parameter',
      ...(nestedUsages.length === 0
        ? {}
        : {
            nestedUsages: Object.freeze(nestedUsages.map((usage) => Object.freeze({ ...usage }))),
          }),
      requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(parameter)),
    });
  }

  /**
   * Infers one named property supplied through an object argument to a direct imported helper.
   *
   * This covers identity-only forwarding such as `helper({ navigate })`: the hook consumer does
   * not call `navigate` locally, but the helper's authored parameter contract still proves that the
   * forwarded value must remain callable. Only a direct static property and exact imported helper
   * identity are accepted; spreads, computed names, and unresolved parameter types fail open.
   */
  public inferImportedHelperParameterPropertyFallback(
    sourcePath: string,
    sourceText: string,
    localName: string,
    parameterIndex: number,
    propertyName: string,
  ): PreviewRuntimeHookLocalTypeFallback | undefined {
    if (propertyName.length === 0 || propertyName.length > 128) return undefined;
    const parameter = this.typeDemands.inferImportedFunctionParameter(
      sourcePath,
      sourceText,
      localName,
      parameterIndex,
    );
    const property =
      parameter?.kind === 'object' ? parameter.properties?.[propertyName] : undefined;
    if (property === undefined) return undefined;
    const nestedUsages: PreviewRuntimeHookChildPropUsage[] = [];
    appendShapeUsages(property, [], [], nestedUsages, 0);
    return Object.freeze({
      expression: serializePreviewRuntimeHookChildShape(property, propertyName),
      kind: property.kind,
      label: 'generated value from imported helper parameter property',
      ...(nestedUsages.length === 0
        ? {}
        : {
            nestedUsages: Object.freeze(nestedUsages.map((usage) => Object.freeze({ ...usage }))),
          }),
      requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(property)),
    });
  }

  /** Reads and caches one resolved component source under strict path and text-size limits. */
  private readInference(
    sourcePath: string,
    includeOptionalTypes: boolean,
    transitiveDepth: number,
  ): Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> | undefined {
    if (transitiveDepth > MAX_TRANSITIVE_COMPONENT_DEPTH) return undefined;
    const normalizedPath = path.normalize(sourcePath);
    const cache = includeOptionalTypes ? this.presentValueInferenceCache : this.inferenceCache;
    const cacheKey = `${normalizedPath}\0${transitiveDepth.toString()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const activeIdentity = `${normalizedPath}\0${includeOptionalTypes ? 'optional' : 'required'}`;
    if (this.activeInferenceIdentities.has(activeIdentity)) return undefined;
    this.activeInferenceIdentities.add(activeIdentity);
    try {
      const sourceText =
        this.options.readSource?.(normalizedPath) ?? ts.sys.readFile(normalizedPath);
      if (sourceText === undefined || sourceText.length > MAX_SOURCE_CHARACTERS) {
        cache.set(cacheKey, undefined);
        return undefined;
      }
      const childPropDemands =
        transitiveDepth >= MAX_TRANSITIVE_COMPONENT_DEPTH
          ? undefined
          : () =>
              this.collect(normalizedPath, sourceText, {
                includeOptionalTypes,
                transitiveDepth,
              });
      const inference = mergeComponentInferences(
        collectReactExportPropInference(normalizedPath, sourceText, {
          ...(childPropDemands === undefined ? {} : { childPropDemands }),
          resolveImport: (moduleSpecifier, importerPath) => {
            const importedPath = this.options.resolveModule(moduleSpecifier, importerPath);
            if (importedPath === undefined || !this.isInspectableSource(importedPath)) {
              return undefined;
            }
            const normalizedImportedPath = path.normalize(importedPath);
            const importedSource =
              this.options.readSource?.(normalizedImportedPath) ??
              ts.sys.readFile(normalizedImportedPath);
            return importedSource === undefined
              ? undefined
              : { sourcePath: normalizedImportedPath, sourceText: importedSource };
          },
        }),
        this.typeDemands.collect(normalizedPath, sourceText, {
          includeOptionalProperties: includeOptionalTypes,
        }),
      );
      cache.set(cacheKey, inference);
      return inference;
    } finally {
      this.activeInferenceIdentities.delete(activeIdentity);
    }
  }

  /** Rejects generated declarations, non-source assets, and workspace-escaping resolution. */
  private isInspectableSource(sourcePath: string): boolean {
    const normalizedPath = path.resolve(sourcePath);
    const relative = path.relative(this.workspaceRoot, normalizedPath);
    return (
      SOURCE_PATTERN.test(normalizedPath) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }
}
export { inferPreviewRuntimeHookJsxCollectionItemFallback } from './previewRuntimeHookChildCollectionDemand';
export type {
  PreviewRuntimeHookChildPropDemandCatalog,
  PreviewRuntimeHookChildPropDemandSource,
  PreviewRuntimeHookChildPropDemandOptions,
  PreviewRuntimeHookChildPropUsage,
  PreviewRuntimeHookLocalTypeFallback,
} from './previewRuntimeHookChildDemandModel';
export {
  readPreviewRuntimeHookChildPropUsages,
  readPreviewRuntimeHookDirectChildPropUsages,
} from './previewRuntimeHookChildUsageDemand';
