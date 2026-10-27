/** Coordinates bounded authored-source analysis for previewRuntimeHookChildTypeDemand. */
import path from 'node:path';
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import {
  collectExportedComponentCandidates,
  extractOversizedTypeAlias,
  indexTypeDemandModule,
  readComponentPropsType,
  readRuntimeFunctionLike,
  readStaticIndexedAccessTypeProperty,
  readStaticTypePropertyNames,
} from './previewRuntimeHookChildTypeIndex';
import {
  BLOCKED_PROPERTY_NAMES,
  MAX_OVERSIZED_SOURCE_CHARACTERS,
  MAX_SHAPE_NODES,
  MAX_SOURCE_CHARACTERS,
  SOURCE_PATTERN,
  type ComponentFunctionCandidate,
  type ParsedTypeDemandModule,
  type PreviewRuntimeHookChildTypeDemandOptions,
  type PreviewRuntimeHookChildTypeShapeOptions,
  type ResolvedTypeDeclaration,
  type ShapeBudget,
} from './previewRuntimeHookChildTypeModel';
import {
  applyPrimitiveLiteralHint,
  applyPrimitiveSemanticHint,
  countShape,
  mergePropShapes,
  prioritizeUnionMembers,
  readPrimitiveShape,
} from './previewRuntimeHookChildTypeShape';
import {
  hasParseDiagnostics,
  isReactComponentType,
  readPropertyName,
  readScriptKind,
  readTupleElementType,
  unwrapTypeNode,
} from './previewRuntimeHookChildTypeSyntax';
import {
  inferReactFunctionParameterUsageShape,
  type PreviewInferredPropShape,
} from './reactExportPropInference';

/**
 * Caches parsed modules for one compilation and returns imported-type shapes by component export.
 */
export class PreviewRuntimeHookChildTypeDemandResolver {
  private readonly moduleCache = new Map<string, ParsedTypeDemandModule | undefined>();
  private readonly oversizedSourceCache = new Map<string, string | undefined>();
  private readonly oversizedTypeModuleCache = new Map<string, ParsedTypeDemandModule | undefined>();
  private readonly workspaceRoot: string;

  /** Creates a resolver scoped to the current trusted workspace. */
  public constructor(private readonly options: PreviewRuntimeHookChildTypeDemandOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  /**
   * Infers required prop types for exported component functions in one reached child module.
   *
   * @param sourcePath Exact child source identity.
   * @param sourceText Current source snapshot already read by the caller.
   */
  public collect(
    sourcePath: string,
    sourceText: string,
    options: PreviewRuntimeHookChildTypeShapeOptions = {},
  ): Readonly<Record<string, PreviewInferredPropShape>> {
    const module = this.readModule(sourcePath, sourceText);
    if (module === undefined) return {};
    const result: Record<string, PreviewInferredPropShape> = {};
    for (const [exportName, candidate] of collectExportedComponentCandidates(module)) {
      const propsType = readComponentPropsType(candidate, module.localFunctions, new Set());
      if (propsType === undefined) continue;
      const shape = this.inferShape(
        propsType,
        module,
        module.literalHints,
        new Set(),
        { nodes: 0 },
        options.includeOptionalProperties === true,
      );
      if (shape?.kind !== 'object' || Object.keys(shape.properties ?? {}).length === 0) continue;
      result[exportName] = shape;
    }
    return Object.freeze(result);
  }

  /** Infers exact same-file JSX child contracts without promoting private bindings to exports. */
  public collectLocal(
    sourcePath: string,
    sourceText: string,
    componentNames: readonly string[],
    options: PreviewRuntimeHookChildTypeShapeOptions = {},
  ): Readonly<Record<string, PreviewInferredPropShape>> {
    const module = this.readModule(sourcePath, sourceText);
    if (module === undefined || componentNames.length === 0) return {};
    const result: Record<string, PreviewInferredPropShape> = {};
    for (const componentName of [...new Set(componentNames)].slice(0, 32)) {
      const candidate = module.localFunctions.get(componentName);
      if (candidate === undefined) continue;
      const propsType = readComponentPropsType(candidate, module.localFunctions, new Set());
      if (propsType === undefined) continue;
      const shape = this.inferShape(
        propsType,
        module,
        module.literalHints,
        new Set(),
        { nodes: 0 },
        options.includeOptionalProperties === true,
      );
      if (shape?.kind !== 'object' || Object.keys(shape.properties ?? {}).length === 0) continue;
      result[componentName] = shape;
    }
    return Object.freeze(result);
  }

  /**
   * Expands one type annotation authored in a reached hook-consumer module.
   *
   * The supplied node may belong to the hook instrumenter's equivalent parser tree. Resolution is
   * based only on its syntax and the cached module import/type indexes, so no TypeScript Program or
   * application module evaluation is required.
   */
  public inferLocalType(
    sourcePath: string,
    sourceText: string,
    typeNode: ts.TypeNode,
  ): PreviewInferredPropShape | undefined {
    const module = this.readModule(sourcePath, sourceText);
    return module === undefined
      ? undefined
      : this.inferShape(typeNode, module, module.literalHints, new Set(), { nodes: 0 });
  }

  /**
   * Expands one direct imported helper parameter without executing or type-checking the helper.
   * This lets a hook-fed identity inherit the exact collection item contract of a reached pure
   * helper even when every first field read lives in that helper's module.
   */
  public inferImportedFunctionParameter(
    sourcePath: string,
    sourceText: string,
    localName: string,
    parameterIndex: number,
  ): PreviewInferredPropShape | undefined {
    if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0 || parameterIndex > 15) {
      return undefined;
    }
    const consumer = this.readModule(sourcePath, sourceText);
    const imported = consumer?.imports.get(localName);
    if (imported === undefined) return undefined;
    const resolvedPath = this.options.resolveModule(imported.moduleSpecifier, sourcePath);
    const importedModule =
      resolvedPath === undefined || !this.isInspectableSource(resolvedPath)
        ? undefined
        : this.readModule(resolvedPath);
    if (importedModule === undefined) return undefined;
    const candidate = collectExportedComponentCandidates(importedModule).get(imported.sourceName);
    const functionLike =
      candidate === undefined
        ? undefined
        : readRuntimeFunctionLike(candidate, importedModule.localFunctions, new Set());
    const directParameterType = functionLike?.parameters[parameterIndex]?.type;
    const contextualParameter =
      directParameterType === undefined && candidate?.contextualFunctionType !== undefined
        ? this.readContextualFunctionParameter(
            candidate.contextualFunctionType,
            importedModule,
            parameterIndex,
            new Set(),
          )
        : undefined;
    const parameterType =
      directParameterType === undefined
        ? contextualParameter
        : { module: importedModule, type: directParameterType };
    const typedShape =
      parameterType === undefined
        ? undefined
        : this.inferImportedFunctionParameterShape(
            parameterType.type,
            parameterType.module,
            functionLike,
          );
    return (
      typedShape ??
      (functionLike === undefined
        ? undefined
        : inferReactFunctionParameterUsageShape(functionLike, parameterIndex))
    );
  }

  /**
   * Expands a direct imported helper parameter, including one bounded generic Array carrier.
   *
   * Identity helpers commonly preserve a domain union with `<T extends Feed>(items: readonly
   * T[]): T[]`. The call site does not provide a concrete type argument in syntax, but the
   * constraint is still the exact safe lower-bound shape needed by a generated preview item.
   * Only a direct type-parameter reference (or one Array element) is substituted; arbitrary
   * conditional and mapped generic evaluation remains outside this bounded resolver.
   */
  private inferImportedFunctionParameterShape(
    typeNode: ts.TypeNode,
    module: ParsedTypeDemandModule,
    functionLike: ComponentFunctionCandidate['functionLike'],
  ): PreviewInferredPropShape | undefined {
    const constraints = new Map<string, ts.TypeNode>();
    for (const parameter of functionLike?.typeParameters ?? []) {
      if (parameter.constraint !== undefined) {
        constraints.set(parameter.name.text, parameter.constraint);
      }
    }
    const resolveConstraint = (candidate: ts.TypeNode): ts.TypeNode => {
      const current = unwrapTypeNode(candidate);
      return ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)
        ? (constraints.get(current.typeName.text) ?? candidate)
        : candidate;
    };
    const infer = (candidate: ts.TypeNode): PreviewInferredPropShape | undefined =>
      this.inferShape(candidate, module, module.literalHints, new Set(), { nodes: 0 });
    const current = unwrapTypeNode(typeNode);
    if (ts.isTypeOperatorNode(current) && current.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.inferImportedFunctionParameterShape(current.type, module, functionLike);
    }
    if (ts.isArrayTypeNode(current)) {
      return infer(ts.factory.createArrayTypeNode(resolveConstraint(current.elementType)));
    }
    if (
      ts.isTypeReferenceNode(current) &&
      ts.isIdentifier(current.typeName) &&
      (current.typeName.text === 'Array' || current.typeName.text === 'ReadonlyArray') &&
      current.typeArguments?.[0] !== undefined
    ) {
      return infer(ts.factory.createArrayTypeNode(resolveConstraint(current.typeArguments[0])));
    }
    return infer(resolveConstraint(current));
  }

  /** Resolves callable aliases and call signatures without creating a TypeScript Program. */
  private readContextualFunctionParameter(
    typeNode: ts.TypeNode,
    module: ParsedTypeDemandModule,
    parameterIndex: number,
    activeTypes: Set<string>,
  ): { readonly module: ParsedTypeDemandModule; readonly type: ts.TypeNode } | undefined {
    const current = unwrapTypeNode(typeNode);
    if (ts.isFunctionTypeNode(current)) {
      const type = current.parameters[parameterIndex]?.type;
      return type === undefined ? undefined : { module, type };
    }
    if (ts.isTypeLiteralNode(current)) {
      const type = current.members.find(ts.isCallSignatureDeclaration)?.parameters[parameterIndex]
        ?.type;
      return type === undefined ? undefined : { module, type };
    }
    if (ts.isUnionTypeNode(current) || ts.isIntersectionTypeNode(current)) {
      for (const member of current.types) {
        const parameter = this.readContextualFunctionParameter(
          member,
          module,
          parameterIndex,
          activeTypes,
        );
        if (parameter !== undefined) return parameter;
      }
      return undefined;
    }
    if (!ts.isTypeReferenceNode(current) || !ts.isIdentifier(current.typeName)) return undefined;
    const resolved = this.resolveType(module, current.typeName.text, new Set());
    if (resolved === undefined) return undefined;
    const identity = `${resolved.module.sourcePath}\0${resolved.declaration.name.text}`;
    if (activeTypes.has(identity)) return undefined;
    activeTypes.add(identity);
    const parameter = ts.isTypeAliasDeclaration(resolved.declaration)
      ? this.readContextualFunctionParameter(
          resolved.declaration.type,
          resolved.module,
          parameterIndex,
          activeTypes,
        )
      : (() => {
          const type = resolved.declaration.members.find(ts.isCallSignatureDeclaration)?.parameters[
            parameterIndex
          ]?.type;
          return type === undefined ? undefined : { module: resolved.module, type };
        })();
    activeTypes.delete(identity);
    return parameter;
  }

  /** Recursively converts one type syntax node into a neutral preview data shape. */
  private inferShape(
    typeNode: ts.TypeNode,
    module: ParsedTypeDemandModule,
    consumerHints: ReadonlyMap<string, boolean | number | string>,
    activeTypes: Set<string>,
    budget: ShapeBudget,
    includeOptionalProperties = false,
  ): PreviewInferredPropShape | undefined {
    if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
    const current = unwrapTypeNode(typeNode);
    if (ts.isTypeOperatorNode(current) && current.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.inferShape(
        current.type,
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
    }
    const primitive = readPrimitiveShape(current);
    if (primitive !== undefined) return countShape(primitive, budget);
    if (ts.isFunctionTypeNode(current) || ts.isConstructorTypeNode(current)) {
      return countShape({ kind: 'function' }, budget);
    }
    if (isReactComponentType(current)) return countShape({ kind: 'component' }, budget);
    if (ts.isArrayTypeNode(current)) {
      return this.createArrayShape(
        current.elementType,
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
    }
    if (ts.isTupleTypeNode(current)) {
      const element = current.elements.find((candidate) => !ts.isOptionalTypeNode(candidate));
      return element === undefined
        ? countShape({ kind: 'array' }, budget)
        : this.createArrayShape(
            readTupleElementType(element),
            module,
            consumerHints,
            activeTypes,
            budget,
            includeOptionalProperties,
          );
    }
    if (ts.isUnionTypeNode(current)) {
      for (const member of prioritizeUnionMembers(current.types)) {
        const inferred = this.inferShape(
          member,
          module,
          consumerHints,
          activeTypes,
          budget,
          includeOptionalProperties,
        );
        if (inferred !== undefined) return inferred;
      }
      return undefined;
    }
    if (ts.isIntersectionTypeNode(current)) {
      return this.mergeObjectTypes(
        current.types,
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
    }
    if (ts.isTypeLiteralNode(current)) {
      return this.createObjectShape(
        current.members,
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
    }
    if (ts.isIndexedAccessTypeNode(current)) {
      const objectShape = this.inferShape(
        current.objectType,
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
      if (unwrapTypeNode(current.indexType).kind === ts.SyntaxKind.NumberKeyword) {
        return objectShape?.kind === 'array' ? objectShape.items : undefined;
      }
      const propertyName = readStaticIndexedAccessTypeProperty(current.indexType);
      if (propertyName === undefined) return undefined;
      return objectShape?.kind === 'object' ? objectShape.properties?.[propertyName] : undefined;
    }
    const reference =
      ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)
        ? { name: current.typeName.text, typeArguments: current.typeArguments }
        : ts.isExpressionWithTypeArguments(current) && ts.isIdentifier(current.expression)
          ? { name: current.expression.text, typeArguments: current.typeArguments }
          : undefined;
    if (reference === undefined) return undefined;
    const { name } = reference;
    if (
      (name === 'Array' || name === 'ReadonlyArray') &&
      reference.typeArguments?.[0] !== undefined
    ) {
      return this.createArrayShape(
        reference.typeArguments[0],
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
    }
    if (name === 'Pick' && reference.typeArguments?.[0] !== undefined) {
      const selectedNames = readStaticTypePropertyNames(reference.typeArguments[1]);
      if (selectedNames === undefined) return undefined;
      const objectShape = this.inferShape(
        reference.typeArguments[0],
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
      if (objectShape?.kind !== 'object') return undefined;
      const properties: Record<string, PreviewInferredPropShape> = {};
      for (const propertyName of selectedNames) {
        const property = objectShape.properties?.[propertyName];
        if (property !== undefined) properties[propertyName] = property;
      }
      return Object.freeze({ kind: 'object', properties: Object.freeze(properties) });
    }
    if (
      (name === 'Readonly' || name === 'Required' || name === 'Partial') &&
      reference.typeArguments?.[0] !== undefined
    ) {
      return this.inferShape(
        reference.typeArguments[0],
        module,
        consumerHints,
        activeTypes,
        budget,
        includeOptionalProperties,
      );
    }
    const resolved = this.resolveType(module, name, new Set());
    if (resolved === undefined) return undefined;
    const identity = `${resolved.module.sourcePath}\0${resolved.declaration.name.text}`;
    if (activeTypes.has(identity)) return undefined;
    activeTypes.add(identity);
    const shape = ts.isInterfaceDeclaration(resolved.declaration)
      ? this.createInterfaceShape(
          resolved.declaration,
          resolved.module,
          consumerHints,
          activeTypes,
          budget,
          includeOptionalProperties,
        )
      : this.inferShape(
          resolved.declaration.type,
          resolved.module,
          consumerHints,
          activeTypes,
          budget,
          includeOptionalProperties,
        );
    activeTypes.delete(identity);
    return shape;
  }

  /** Creates a one-item-capable array shape while retaining an unknown element as an empty list. */
  private createArrayShape(
    elementType: ts.TypeNode,
    module: ParsedTypeDemandModule,
    consumerHints: ReadonlyMap<string, boolean | number | string>,
    activeTypes: Set<string>,
    budget: ShapeBudget,
    includeOptionalProperties: boolean,
  ): PreviewInferredPropShape | undefined {
    if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
    budget.nodes += 1;
    const items = this.inferShape(
      elementType,
      module,
      consumerHints,
      activeTypes,
      budget,
      includeOptionalProperties,
    );
    return Object.freeze({ kind: 'array', ...(items === undefined ? {} : { items }) });
  }

  /** Merges required members from an interface and every exact inherited interface. */
  private createInterfaceShape(
    declaration: ts.InterfaceDeclaration,
    module: ParsedTypeDemandModule,
    consumerHints: ReadonlyMap<string, boolean | number | string>,
    activeTypes: Set<string>,
    budget: ShapeBudget,
    includeOptionalProperties: boolean,
  ): PreviewInferredPropShape | undefined {
    const own = this.createObjectShape(
      declaration.members,
      module,
      consumerHints,
      activeTypes,
      budget,
      includeOptionalProperties,
    );
    let merged = own;
    for (const heritage of declaration.heritageClauses ?? []) {
      for (const expression of heritage.types) {
        const inherited = this.inferShape(
          expression,
          module,
          consumerHints,
          activeTypes,
          budget,
          includeOptionalProperties,
        );
        merged = mergePropShapes(merged, inherited);
      }
    }
    return merged;
  }

  /** Materializes required property and method signatures from one structural object type. */
  private createObjectShape(
    members: readonly ts.TypeElement[],
    module: ParsedTypeDemandModule,
    consumerHints: ReadonlyMap<string, boolean | number | string>,
    activeTypes: Set<string>,
    budget: ShapeBudget,
    includeOptionalProperties: boolean,
  ): PreviewInferredPropShape | undefined {
    if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
    budget.nodes += 1;
    const properties: Record<string, PreviewInferredPropShape> = {};
    for (const member of members) {
      const name =
        (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
        (includeOptionalProperties || member.questionToken === undefined)
          ? readPropertyName(member.name)
          : undefined;
      if (name === undefined || BLOCKED_PROPERTY_NAMES.has(name)) continue;
      let child: PreviewInferredPropShape | undefined;
      if (ts.isMethodSignature(member)) {
        child = countShape({ kind: 'function' }, budget);
      } else if (ts.isPropertySignature(member) && member.type !== undefined) {
        child = this.inferShape(
          member.type,
          module,
          consumerHints,
          activeTypes,
          budget,
          // JSX supplies this prop, not every optional field inside its value. Nested optional
          // fields need their own authored usage proof, so layout/event defaults stay in control.
          false,
        );
      }
      if (child !== undefined) {
        properties[name] = applyPrimitiveLiteralHint(
          applyPrimitiveSemanticHint(child, name),
          consumerHints.get(name) ?? module.literalHints.get(name),
        );
      }
      if (budget.nodes >= MAX_SHAPE_NODES) break;
    }
    return Object.freeze({ kind: 'object', properties: Object.freeze(properties) });
  }

  /** Merges object-shaped intersection members without choosing an arbitrary branch. */
  private mergeObjectTypes(
    members: readonly ts.TypeNode[],
    module: ParsedTypeDemandModule,
    consumerHints: ReadonlyMap<string, boolean | number | string>,
    activeTypes: Set<string>,
    budget: ShapeBudget,
    includeOptionalProperties: boolean,
  ): PreviewInferredPropShape | undefined {
    let merged: PreviewInferredPropShape | undefined;
    for (const member of members) {
      merged = mergePropShapes(
        merged,
        this.inferShape(
          member,
          module,
          consumerHints,
          activeTypes,
          budget,
          includeOptionalProperties,
        ),
      );
    }
    return merged;
  }

  /** Resolves local, imported, and exact re-exported type names with cycle-safe identities. */
  private resolveType(
    module: ParsedTypeDemandModule,
    name: string,
    activeBindings: Set<string>,
  ): ResolvedTypeDeclaration | undefined {
    const local = module.localTypes.get(name);
    if (local !== undefined) return { declaration: local, module };
    const imported = module.imports.get(name);
    if (imported === undefined) {
      return this.oversizedSourceCache.has(path.normalize(module.sourcePath))
        ? this.readOversizedLocalType(module.sourcePath, name)
        : undefined;
    }
    const resolvedPath = this.options.resolveModule(imported.moduleSpecifier, module.sourcePath);
    const importedModule =
      resolvedPath === undefined || !this.isInspectableSource(resolvedPath)
        ? undefined
        : this.readModule(resolvedPath);
    if (importedModule !== undefined) {
      return this.resolveExportedType(importedModule, imported.sourceName, activeBindings);
    }
    return resolvedPath === undefined || !this.isInspectableSource(resolvedPath)
      ? undefined
      : this.readOversizedExportedType(resolvedPath, imported.sourceName);
  }

  /** Follows one exported name through local aliases and named/star re-export declarations. */
  private resolveExportedType(
    module: ParsedTypeDemandModule,
    exportName: string,
    activeBindings: Set<string>,
  ): ResolvedTypeDeclaration | undefined {
    const identity = `${module.sourcePath}\0${exportName}`;
    if (activeBindings.has(identity)) return undefined;
    activeBindings.add(identity);
    const binding = module.exports.get(exportName);
    const localName = binding?.localName ?? (module.localTypes.has(exportName) ? exportName : '');
    if (localName.length > 0) {
      const declaration = module.localTypes.get(localName);
      if (declaration !== undefined) {
        activeBindings.delete(identity);
        return { declaration, module };
      }
    }
    if (binding?.moduleSpecifier !== undefined) {
      const resolvedPath = this.options.resolveModule(binding.moduleSpecifier, module.sourcePath);
      const next =
        resolvedPath === undefined || !this.isInspectableSource(resolvedPath)
          ? undefined
          : this.readModule(resolvedPath);
      const resolved =
        next === undefined
          ? undefined
          : this.resolveExportedType(next, binding.sourceName, activeBindings);
      activeBindings.delete(identity);
      return resolved;
    }
    for (const [key, candidate] of module.exports) {
      if (!key.startsWith('*:') || candidate.moduleSpecifier === undefined) continue;
      const resolvedPath = this.options.resolveModule(candidate.moduleSpecifier, module.sourcePath);
      const next =
        resolvedPath === undefined || !this.isInspectableSource(resolvedPath)
          ? undefined
          : this.readModule(resolvedPath);
      const resolved =
        next === undefined ? undefined : this.resolveExportedType(next, exportName, activeBindings);
      if (resolved !== undefined) {
        activeBindings.delete(identity);
        return resolved;
      }
    }
    activeBindings.delete(identity);
    return undefined;
  }

  /** Reads and indexes one workspace source, reusing the supplied dirty snapshot when available. */
  private readModule(
    sourcePath: string,
    knownSourceText?: string,
  ): ParsedTypeDemandModule | undefined {
    const normalizedPath = path.normalize(sourcePath);
    if (this.moduleCache.has(normalizedPath)) return this.moduleCache.get(normalizedPath);
    const sourceText =
      knownSourceText ??
      this.options.readSource?.(normalizedPath) ??
      ts.sys.readFile(normalizedPath);
    if (sourceText === undefined || sourceText.length > MAX_SOURCE_CHARACTERS) {
      if (sourceText !== undefined && sourceText.length <= MAX_OVERSIZED_SOURCE_CHARACTERS) {
        this.oversizedSourceCache.set(normalizedPath, sourceText);
      }
      this.moduleCache.set(normalizedPath, undefined);
      return undefined;
    }
    const file = readPreviewAnalysisSourceFile(
      normalizedPath,
      sourceText,
      readScriptKind(normalizedPath),
    );
    if (hasParseDiagnostics(file)) {
      this.moduleCache.set(normalizedPath, undefined);
      return undefined;
    }
    const module = indexTypeDemandModule(normalizedPath, file);
    this.moduleCache.set(normalizedPath, module);
    return module;
  }

  /**
   * Parses one exact exported type alias from a generated module that is too large to parse whole.
   *
   * GraphQL code generators commonly emit multi-megabyte files while each operation result is a
   * small, self-contained alias. Extracting only the requested export keeps child-prop completion
   * bounded and avoids making every preview compilation parse the entire generated corpus.
   */
  private readOversizedExportedType(
    sourcePath: string,
    exportName: string,
  ): ResolvedTypeDeclaration | undefined {
    const module = this.readOversizedTypeModule(sourcePath, exportName, true);
    return module === undefined
      ? undefined
      : this.resolveExportedType(module, exportName, new Set());
  }

  /** Parses an exact same-module alias referenced by an already-proven exported generated type. */
  private readOversizedLocalType(
    sourcePath: string,
    typeName: string,
  ): ResolvedTypeDeclaration | undefined {
    const module = this.readOversizedTypeModule(sourcePath, typeName, false);
    const declaration = module?.localTypes.get(typeName);
    return declaration === undefined || module === undefined ? undefined : { declaration, module };
  }

  /** Caches one bounded declaration slice from an oversized generated module. */
  private readOversizedTypeModule(
    sourcePath: string,
    typeName: string,
    requireExport: boolean,
  ): ParsedTypeDemandModule | undefined {
    const normalizedPath = path.normalize(sourcePath);
    const cacheKey = `${normalizedPath}\0${requireExport ? 'export' : 'local'}\0${typeName}`;
    if (!this.oversizedTypeModuleCache.has(cacheKey)) {
      const sourceText =
        this.oversizedSourceCache.get(normalizedPath) ??
        this.options.readSource?.(normalizedPath) ??
        ts.sys.readFile(normalizedPath);
      const declarationText =
        sourceText === undefined ||
        sourceText.length <= MAX_SOURCE_CHARACTERS ||
        sourceText.length > MAX_OVERSIZED_SOURCE_CHARACTERS
          ? undefined
          : extractOversizedTypeAlias(sourceText, typeName, requireExport);
      const file =
        declarationText === undefined
          ? undefined
          : ts.createSourceFile(
              normalizedPath,
              declarationText,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS,
            );
      this.oversizedTypeModuleCache.set(
        cacheKey,
        file === undefined || hasParseDiagnostics(file)
          ? undefined
          : indexTypeDemandModule(normalizedPath, file),
      );
    }
    return this.oversizedTypeModuleCache.get(cacheKey);
  }

  /** Rejects assets, declarations outside the workspace, and path traversal. */
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
export type { PreviewRuntimeHookChildTypeDemandOptions } from './previewRuntimeHookChildTypeModel';
export { mergePreviewRuntimeHookChildPropShapes } from './previewRuntimeHookChildTypeShape';
