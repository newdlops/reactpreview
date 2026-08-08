/**
 * Carries a reached child component's local prop demand back to a hook-fed JSX attribute.
 *
 * Hook inference is normally lexical: `query.data.data` is visible in the parent, while the fact
 * that `<HistoryTable data={query.data.data}>` later reads `data.rows.map(...)` lives in another
 * module. This bounded catalog resolves only imported components that are actually used as JSX,
 * reads their syntax-only exported-prop inference, and exposes operation-proven leaf requirements
 * to the parent hook analyzer. No application module is imported or executed.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  collectReactExportPropInference,
  collectReactLocalComponentPropInference,
  type PreviewInferredPropShape,
} from './reactExportPropInference';
import {
  mergePreviewRuntimeHookChildPropShapes,
  PreviewRuntimeHookChildTypeDemandResolver,
} from './previewRuntimeHookChildTypeDemand';
import {
  collectPreviewRuntimeHookAliasPaths,
  type PreviewRuntimeHookAliasPathCatalog,
} from './previewRuntimeHookAliasUsage';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import type { PreviewRuntimeFunction } from './previewRuntimeHookSyntax';

const MAX_COMPONENT_IMPORTS = 32;
const MAX_PROP_DEMANDS = 32;
const MAX_PROP_DEPTH = 8;
const MAX_SOURCE_CHARACTERS = 512 * 1024;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const COLLECTION_IDENTITY_METHODS = new Set(['filter', 'slice', 'toReversed', 'toSorted']);
const BLOCKED_PROP_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/** Operation-shaped use compatible with the hook analyzer's internal property-path contract. */
export interface PreviewRuntimeHookChildPropUsage {
  readonly called: boolean;
  /** Static one-item value inferred from the reached child's required collection element type. */
  readonly collectionItemExpression?: string;
  /** Nested child item paths surfaced in resolver diagnostics and partial-value repair. */
  readonly collectionItemRequiredPaths?: readonly string[];
  readonly collectionProperty?: string;
  readonly names: readonly string[];
  /** Exact authored literal/control-flow evidence that must replace a generic preview scalar. */
  readonly renderGuard?: true;
  readonly stringProperty?: string;
  /** Static scalar required to keep a reached child's render-only branch dormant. */
  readonly valueExpression?: string;
}

/** Child prop shapes indexed by the local JSX component binding and authored attribute name. */
export type PreviewRuntimeHookChildPropDemandCatalog = ReadonlyMap<
  string,
  ReadonlyMap<string, PreviewInferredPropShape>
>;

/** Serialized value contract inferred from an authored local or imported TypeScript type. */
export interface PreviewRuntimeHookLocalTypeFallback {
  /** Side-effect-free expression evaluated only inside the preview hook boundary. */
  readonly expression: string;
  /** Structural family proven by the expanded authored type. */
  readonly kind: PreviewInferredPropShape['kind'];
  /** Concise provenance shown when the generated value is surfaced as a blocker. */
  readonly label: string;
  /** Nested item properties required by the expanded type. */
  readonly requiredPaths: readonly string[];
}

/** Minimal read-only module operations needed by the cross-component syntax catalog. */
export interface PreviewRuntimeHookChildPropDemandOptions {
  /** Returns a dirty editor snapshot before the catalog consults TypeScript's read-only host. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Resolves an authored import according to the active tsconfig/jsconfig aliases. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Trusted workspace boundary outside which component source is never inspected. */
  readonly workspaceRoot: string;
}

/** Imported component binding before its module is resolved and parsed. */
interface ImportedComponentBinding {
  readonly exportName: string;
  readonly moduleSpecifier: string;
}

/** Optional members are read only when an authored value is already being supplied by its caller. */
interface PreviewRuntimeHookChildPropDemandCollectOptions {
  readonly includeOptionalTypes?: boolean;
}

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
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(sourcePath),
    );
    if (hasParseDiagnostics(sourceFile)) return new Map();
    const imports = collectImportedComponentBindings(sourceFile);
    const usedComponents = new Set(
      collectUsedJsxComponentBindings(sourceFile, collectHookResultBindings(sourceFile)),
    );
    // Render-prop data is not a hook binding, but its imported child is still an operation-proven
    // consumer. Keep the catalog bounded and syntax-only for that adjacent use as well.
    collectAllUsedJsxComponentBindings(sourceFile, usedComponents);
    const boundedComponents = [...usedComponents].slice(0, MAX_COMPONENT_IMPORTS);
    const localInferences = mergeComponentInferences(
      collectReactLocalComponentPropInference(sourcePath, sourceText, boundedComponents),
      this.typeDemands.collectLocal(sourcePath, sourceText, boundedComponents, {
        includeOptionalProperties: options.includeOptionalTypes === true,
      }),
    );
    const catalog = new Map<string, ReadonlyMap<string, PreviewInferredPropShape>>();
    for (const localName of boundedComponents) {
      if (catalog.size >= MAX_COMPONENT_IMPORTS) break;
      let inference = localInferences[localName];
      if (inference === undefined) {
        const imported = imports.get(localName);
        if (imported === undefined) continue;
        const resolvedPath = this.options.resolveModule(imported.moduleSpecifier, sourcePath);
        if (resolvedPath === undefined || !this.isInspectableSource(resolvedPath)) continue;
        inference = this.readInference(resolvedPath, options.includeOptionalTypes === true)?.[
          imported.exportName
        ];
      }
      const properties = inference?.shape.properties;
      if (properties === undefined || Object.keys(properties).length === 0) continue;
      catalog.set(localName, new Map(Object.entries(properties)));
    }
    return catalog;
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
    const property = parameter?.kind === 'object' ? parameter.properties?.[propertyName] : undefined;
    if (property === undefined) return undefined;
    return Object.freeze({
      expression: serializePreviewRuntimeHookChildShape(property, propertyName),
      kind: property.kind,
      label: 'generated value from imported helper parameter property',
      requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(property)),
    });
  }

  /** Reads and caches one resolved component source under strict path and text-size limits. */
  private readInference(
    sourcePath: string,
    includeOptionalTypes: boolean,
  ): Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> | undefined {
    const normalizedPath = path.normalize(sourcePath);
    const cache = includeOptionalTypes
      ? this.presentValueInferenceCache
      : this.inferenceCache;
    if (cache.has(normalizedPath)) return cache.get(normalizedPath);
    const sourceText = this.options.readSource?.(normalizedPath) ?? ts.sys.readFile(normalizedPath);
    const inference =
      sourceText === undefined || sourceText.length > MAX_SOURCE_CHARACTERS
        ? undefined
        : mergeComponentInferences(
            collectReactExportPropInference(normalizedPath, sourceText),
            this.typeDemands.collect(normalizedPath, sourceText, {
              includeOptionalProperties: includeOptionalTypes,
            }),
          );
    cache.set(normalizedPath, inference);
    return inference;
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

/** Adds bounded imported JSX consumers used by static render-prop callbacks. */
function collectAllUsedJsxComponentBindings(sourceFile: ts.SourceFile, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (names.size >= MAX_COMPONENT_IMPORTS) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      isPascalCase(node.tagName.text)
    )
      names.add(node.tagName.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Finds JSX attributes rooted at one hook result and appends the child component's proven demand.
 * Optional source chains stay authored: only a non-optional identity path can make a missing child
 * field a hard requirement on the hook fallback.
 */
export function readPreviewRuntimeHookChildPropUsages(
  identifier: ts.Identifier,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
): readonly PreviewRuntimeHookChildPropUsage[] {
  if (catalog === undefined || catalog.size === 0) return [];
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return [];
  const aliases = collectPreviewRuntimeHookAliasPaths(identifier, owner);
  const spreadObjects = collectPreviewRuntimeHookChildSpreadObjects(owner);
  const usages: PreviewRuntimeHookChildPropUsage[] = [];
  const visit = (node: ts.Node): void => {
    if (usages.length >= MAX_PROP_DEMANDS) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      functionShadowsName(node, identifier.text)
    ) {
      return;
    }
    if (
      ts.isJsxAttribute(node) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression;
      const sourcePaths =
        expression === undefined
          ? []
          : readRequiredAliasPaths(expression, aliases);
      const propName = ts.isIdentifier(node.name) ? node.name.text : undefined;
      const componentName = readJsxAttributeComponentName(node);
      const shape =
        sourcePaths.length === 0 || propName === undefined || componentName === undefined
          ? undefined
          : catalog.get(componentName)?.get(propName);
      if (shape !== undefined) {
        for (const sourcePath of sourcePaths) {
          appendShapeUsages(shape, sourcePath, [], usages, 0);
        }
      }
    }
    if (ts.isJsxSpreadAttribute(node)) {
      const componentName = readJsxAttributesComponentName(node.parent);
      const object = readPreviewRuntimeHookChildSpreadObject(
        node.expression,
        spreadObjects,
        node.getStart(),
      );
      if (componentName !== undefined && object !== undefined) {
        for (const property of object.properties) {
          if (usages.length >= MAX_PROP_DEMANDS) break;
          const forwarded = readPreviewRuntimeHookChildSpreadProperty(property);
          if (forwarded === undefined) continue;
          const shape = catalog.get(componentName)?.get(forwarded.propName);
          if (shape === undefined) continue;
          for (const sourcePath of readRequiredAliasPaths(forwarded.expression, aliases)) {
            appendShapeUsages(shape, sourcePath, [], usages, 0);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return deduplicateUsages(usages);
}

/**
 * Reads the demand of a child prop that receives a hook call directly.
 *
 * A wrapper page commonly forwards context without first naming it:
 * `context={useAppContext()}`. There is no local identifier for the ordinary usage walker to
 * follow, but the exact JSX attribute and reached child contract still prove the hook root shape.
 * Only a direct JSX expression is admitted so arbitrary transforms remain authored.
 */
export function readPreviewRuntimeHookDirectChildPropUsages(
  expression: ts.Expression,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
): readonly PreviewRuntimeHookChildPropUsage[] {
  if (catalog === undefined || catalog.size === 0) return [];
  const jsxExpression = expression.parent;
  if (
    !ts.isJsxExpression(jsxExpression) ||
    jsxExpression.expression !== expression ||
    !ts.isJsxAttribute(jsxExpression.parent)
  ) {
    return [];
  }
  const attribute = jsxExpression.parent;
  const propName = ts.isIdentifier(attribute.name) ? attribute.name.text : undefined;
  const componentName = readJsxAttributeComponentName(attribute);
  const shape =
    propName === undefined || componentName === undefined
      ? undefined
      : catalog.get(componentName)?.get(propName);
  if (shape === undefined) return [];
  const usages: PreviewRuntimeHookChildPropUsage[] = [];
  appendShapeUsages(shape, [], [], usages, 0);
  return deduplicateUsages(usages);
}

/** Indexes default and named imports; namespace/member JSX remains conservatively unsupported. */
function collectImportedComponentBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ImportedComponentBinding> {
  const bindings = new Map<string, ImportedComponentBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (clause.name !== undefined && isPascalCase(clause.name.text)) {
      bindings.set(clause.name.text, { exportName: 'default', moduleSpecifier });
    }
    const named = clause.namedBindings;
    if (named === undefined || ts.isNamespaceImport(named)) continue;
    for (const element of named.elements) {
      if (element.isTypeOnly || !isPascalCase(element.name.text)) continue;
      bindings.set(element.name.text, {
        exportName: element.propertyName?.text ?? element.name.text,
        moduleSpecifier,
      });
    }
  }
  return bindings;
}

/** Collects local names bound directly from one syntactically recognizable hook call. */
function collectHookResultBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const initializer = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isCallExpression(initializer) && isHookCallee(initializer.expression)) {
        appendBindingNames(node.name, names);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Recognizes direct and namespace hook names without resolving their implementation. */
function isHookCallee(expression: ts.LeftHandSideExpression): boolean {
  const unwrapped = unwrapPreviewRuntimeExpression(expression);
  const name = ts.isIdentifier(unwrapped)
    ? unwrapped.text
    : ts.isPropertyAccessExpression(unwrapped)
      ? unwrapped.name.text
      : '';
  return /^use[A-Z0-9_$]/u.test(name);
}

/** Records identifier leaves from one hook-result binding pattern. */
function appendBindingNames(binding: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(binding)) {
    names.add(binding.text);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNames(element.name, names);
  }
}

/** Collects JSX components whose attribute directly receives one hook-result identity path. */
function collectUsedJsxComponentBindings(
  sourceFile: ts.SourceFile,
  hookResultBindings: ReadonlySet<string>,
): ReadonlySet<string> {
  const names = new Set<string>();
  if (hookResultBindings.size === 0) return names;
  const visit = (node: ts.Node): void => {
    if (names.size >= MAX_COMPONENT_IMPORTS) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const receivesHookResult = node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.initializer !== undefined &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression !== undefined &&
          readHookResultRootName(attribute.initializer.expression, hookResultBindings) !==
            undefined,
      );
      if (receivesHookResult && ts.isIdentifier(node.tagName) && isPascalCase(node.tagName.text))
        names.add(node.tagName.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Reads the identifier root of a direct, non-optional property carrier. */
function readHookResultRootName(
  expression: ts.Expression,
  hookResultBindings: ReadonlySet<string>,
): string | undefined {
  let current = unwrapRequiredCollectionCarrier(expression);
  if (current === undefined) return undefined;
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && hookResultBindings.has(current.text)
    ? current.text
    : undefined;
}

/** Reads the owning simple JSX tag for one attribute. */
function readJsxAttributeComponentName(attribute: ts.JsxAttribute): string | undefined {
  return readJsxAttributesComponentName(attribute.parent);
}

/** Reads the owning simple JSX tag shared by ordinary and spread attributes. */
function readJsxAttributesComponentName(attributes: ts.JsxAttributes): string | undefined {
  const element = attributes.parent;
  return (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
    ts.isIdentifier(element.tagName)
    ? element.tagName.text
    : undefined;
}

/** Indexes unique immutable object literals that may be forwarded through one JSX spread. */
function collectPreviewRuntimeHookChildSpreadObjects(
  owner: PreviewRuntimeFunction,
): ReadonlyMap<string, ts.ObjectLiteralExpression> {
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const ambiguous = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const value = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isObjectLiteralExpression(value)) {
        const name = node.name.text;
        if (objects.has(name)) {
          objects.delete(name);
          ambiguous.add(name);
        } else if (!ambiguous.has(name)) {
          objects.set(name, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return objects;
}

/** Resolves a direct or uniquely named const object used by a JSX spread before that use. */
function readPreviewRuntimeHookChildSpreadObject(
  expression: ts.Expression,
  objects: ReadonlyMap<string, ts.ObjectLiteralExpression>,
  usageStart: number,
): ts.ObjectLiteralExpression | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const object = objects.get(value.text);
  return object !== undefined && object.end <= usageStart ? object : undefined;
}

/** Reads one prototype-safe identity property from an object forwarded to a child component. */
function readPreviewRuntimeHookChildSpreadProperty(
  property: ts.ObjectLiteralElementLike,
): Readonly<{ expression: ts.Expression; propName: string }> | undefined {
  if (ts.isShorthandPropertyAssignment(property)) {
    return BLOCKED_PROP_NAMES.has(property.name.text)
      ? undefined
      : { expression: property.name, propName: property.name.text };
  }
  if (!ts.isPropertyAssignment(property)) return undefined;
  const propName =
    ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
      ? property.name.text
      : undefined;
  return propName === undefined || BLOCKED_PROP_NAMES.has(propName)
    ? undefined
    : { expression: property.initializer, propName };
}

/** Reads a non-optional identifier/property chain rooted at a proven immutable hook alias. */
function readRequiredAliasPaths(
  expression: ts.Expression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
): readonly (readonly string[])[] {
  const suffix: string[] = [];
  let current = unwrapRequiredCollectionCarrier(expression);
  if (current === undefined) return [];
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return [];
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return [];
  return (aliases.get(current.text) ?? []).map((prefix) => [...prefix, ...suffix]);
}

/** Flattens operation-proven child leaves onto the hook-relative carrier path. */
function appendShapeUsages(
  shape: PreviewInferredPropShape,
  sourcePath: readonly string[],
  relativePath: readonly string[],
  usages: PreviewRuntimeHookChildPropUsage[],
  depth: number,
): void {
  if (depth > MAX_PROP_DEPTH || usages.length >= MAX_PROP_DEMANDS) return;
  const names = [...sourcePath, ...relativePath];
  if (shape.kind === 'array') {
    const itemExpression =
      shape.items === undefined
        ? undefined
        : serializePreviewRuntimeHookChildShape(shape.items, names.at(-1) ?? 'item');
    const itemRequiredPaths =
      shape.items === undefined ? [] : collectPreviewRuntimeHookChildShapePaths(shape.items);
    usages.push({
      called: false,
      ...(itemExpression === undefined ? {} : { collectionItemExpression: itemExpression }),
      ...(itemRequiredPaths.length === 0
        ? {}
        : { collectionItemRequiredPaths: Object.freeze(itemRequiredPaths) }),
      collectionProperty: 'map',
      names,
    });
    return;
  }
  if (shape.kind === 'function') {
    usages.push({ called: true, names });
    return;
  }
  if (shape.kind === 'boolean' || shape.kind === 'null' || shape.kind === 'number') {
    usages.push({
      called: false,
      names,
      ...(shape.exactValue === true ? { renderGuard: true as const } : {}),
      valueExpression: serializePreviewRuntimeHookChildShape(shape, names.at(-1) ?? 'value'),
    });
    return;
  }
  if (shape.kind === 'string') {
    usages.push(
      shape.value === undefined
        ? { called: false, names, stringProperty: 'trim' }
        : {
            called: false,
            names,
            ...(shape.exactValue === true ? { renderGuard: true as const } : {}),
            valueExpression: serializePreviewRuntimeHookChildShape(shape, names.at(-1) ?? 'value'),
          },
    );
    return;
  }
  if (shape.kind !== 'object' || shape.properties === undefined) return;
  for (const [propertyName, child] of Object.entries(shape.properties)) {
    if (usages.length >= MAX_PROP_DEMANDS) break;
    appendShapeUsages(child, sourcePath, [...relativePath, propertyName], usages, depth + 1);
  }
}

/** Keeps one source-ordered occurrence of every propagated component-prop demand. */
function deduplicateUsages(
  usages: readonly PreviewRuntimeHookChildPropUsage[],
): readonly PreviewRuntimeHookChildPropUsage[] {
  const retained = new Map<string, PreviewRuntimeHookChildPropUsage>();
  for (const usage of usages) {
    const terminalKind =
      usage.valueExpression === undefined
        ? (usage.collectionProperty ?? usage.stringProperty ?? (usage.called ? 'call' : 'value'))
        : 'expression';
    const key = `${usage.names.join('.')}\u0000${terminalKind}`;
    const existing = retained.get(key);
    if (existing === undefined) {
      retained.set(key, usage);
      continue;
    }
    const requiredPaths = [
      ...new Set([
        ...(existing.collectionItemRequiredPaths ?? []),
        ...(usage.collectionItemRequiredPaths ?? []),
      ]),
    ];
    retained.set(key, {
      ...existing,
      ...(existing.collectionItemExpression === undefined &&
      usage.collectionItemExpression !== undefined
        ? { collectionItemExpression: usage.collectionItemExpression }
        : {}),
      ...(requiredPaths.length === 0
        ? {}
        : { collectionItemRequiredPaths: Object.freeze(requiredPaths) }),
      ...(existing.renderGuard === true || usage.renderGuard !== true
        ? {}
        : { renderGuard: true as const }),
    });
  }
  return [...retained.values()];
}

/**
 * Peels only collection transforms that retain each element's authored identity.
 *
 * `filter`, `slice`, and the non-mutating ordering helpers may change membership/order but never
 * change an item's contract. Mapping or arbitrary calls remain unsupported because propagating a
 * child's fields through a transform would invent a relationship that syntax did not prove.
 */
function unwrapRequiredCollectionCarrier(expression: ts.Expression): ts.Expression | undefined {
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isCallExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    const callee = unwrapPreviewRuntimeExpression(current.expression);
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken !== undefined ||
      !COLLECTION_IDENTITY_METHODS.has(callee.name.text)
    ) {
      return undefined;
    }
    current = unwrapPreviewRuntimeExpression(callee.expression);
  }
  return current;
}

/** Merges operation-derived and recursively resolved type shapes for each exact component export. */
function mergeComponentInferences(
  usage: Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>>,
  typed: Readonly<Record<string, PreviewInferredPropShape>>,
): Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> {
  const result: Record<string, { readonly shape: PreviewInferredPropShape }> = {};
  for (const exportName of new Set([...Object.keys(usage), ...Object.keys(typed)])) {
    const shape = mergePreviewRuntimeHookChildPropShapes(
      usage[exportName]?.shape,
      typed[exportName],
    );
    if (shape !== undefined) result[exportName] = Object.freeze({ shape });
  }
  return Object.freeze(result);
}

/** Serializes one compiler-proven child item shape into a side-effect-free frozen value. */
function serializePreviewRuntimeHookChildShape(
  shape: PreviewInferredPropShape,
  propertyName: string,
): string {
  if (shape.kind === 'array') {
    return shape.items === undefined
      ? 'Object.freeze([])'
      : `Object.freeze([${serializePreviewRuntimeHookChildShape(shape.items, propertyName)}])`;
  }
  if (shape.kind === 'boolean')
    return typeof shape.value === 'boolean' ? String(shape.value) : 'false';
  if (shape.kind === 'null') return 'null';
  if (shape.kind === 'number')
    return typeof shape.value === 'number' && Number.isFinite(shape.value)
      ? String(shape.value)
      : '0';
  if (shape.kind === 'string')
    return JSON.stringify(typeof shape.value === 'string' ? shape.value : propertyName);
  if (shape.kind === 'function') return 'Object.freeze(() => undefined)';
  if (shape.kind === 'component') return 'Object.freeze(() => null)';
  if (shape.kind === 'element') return JSON.stringify('Preview');
  const properties = Object.entries(shape.properties ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, child]) =>
        `${JSON.stringify(name)}: ${serializePreviewRuntimeHookChildShape(child, name)}`,
    );
  return `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`;
}

/** Flattens nested array/item requirements into the runtime hook diagnostic path notation. */
function collectPreviewRuntimeHookChildShapePaths(
  shape: PreviewInferredPropShape,
  prefix = '',
): readonly string[] {
  if (shape.kind === 'array') {
    const collectionPath = prefix.length === 0 ? '<root>' : `${prefix}.map()`;
    if (shape.items === undefined) return [collectionPath];
    const itemPrefix = prefix.length === 0 ? '<root>' : `${prefix}[]`;
    return [collectionPath, ...collectPreviewRuntimeHookChildShapePaths(shape.items, itemPrefix)];
  }
  if (shape.kind !== 'object') return prefix.length === 0 ? ['<root>'] : [prefix];
  const paths = Object.entries(shape.properties ?? {}).flatMap(([name, child]) =>
    collectPreviewRuntimeHookChildShapePaths(
      child,
      prefix.length === 0 ? name : `${prefix}.${name}`,
    ),
  );
  return paths.length === 0 && prefix.length > 0 ? [prefix] : paths;
}

/** Detects a nested function parameter that replaces the analyzed hook-result identifier. */
function functionShadowsName(scope: PreviewRuntimeFunction, identifierName: string): boolean {
  return scope.parameters.some((parameter) => bindingContainsName(parameter.name, identifierName));
}

/** Recursively checks one parameter pattern without evaluating authored defaults. */
function bindingContainsName(binding: ts.BindingName, identifierName: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === identifierName;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, identifierName),
  );
}

/** Selects the parser grammar without trusting file contents. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
    return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Rejects TypeScript parser recovery before relying on source offsets or binding identities. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}

/** Mirrors React's conventional component identifier casing without guessing lowercase wrappers. */
function isPascalCase(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}\u200C\u200D]*$/u.test(name);
}
