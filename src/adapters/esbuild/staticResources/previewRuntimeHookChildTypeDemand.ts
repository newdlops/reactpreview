/**
 * Resolves component prop types across workspace modules for child-demand propagation.
 *
 * A VirtualPage often obtains a collection from a hook in one module and passes it to a child
 * component whose required item fields are declared in another type-only module. Runtime hook
 * inference cannot see those fields lexically. This analyzer follows exact TypeScript import and
 * export identities, expands required members into a data-only shape, and stops on module/type
 * cycles or an aggregate node budget rather than an authored hop count.
 *
 * Project modules are parsed only; they are never imported or evaluated in the extension host.
 */
import path from 'node:path';
import ts from 'typescript';
import { type PreviewInferredPropShape } from './reactExportPropInference';

const MAX_SOURCE_CHARACTERS = 512 * 1024;
const MAX_OVERSIZED_SOURCE_CHARACTERS = 32 * 1024 * 1024;
const MAX_EXTRACTED_TYPE_CHARACTERS = 256 * 1024;
const MAX_SHAPE_NODES = 512;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'ref']);

/** Read-only workspace operations supplied by the active preview source transformer. */
export interface PreviewRuntimeHookChildTypeDemandOptions {
  /** Returns a dirty editor snapshot before falling back to TypeScript's filesystem host. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Resolves an exact authored module specifier with the active tsconfig/jsconfig aliases. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Trusted boundary outside which type source is never inspected. */
  readonly workspaceRoot: string;
}

/** Parsed source plus the syntax indexes needed for exact type/component lookup. */
interface ParsedTypeDemandModule {
  readonly exports: ReadonlyMap<string, ExportedTypeBinding>;
  readonly file: ts.SourceFile;
  readonly imports: ReadonlyMap<string, ImportedTypeBinding>;
  /** Primitive equality literals keyed by the accessed field name in this exact module. */
  readonly literalHints: ReadonlyMap<string, boolean | number | string>;
  readonly localFunctions: ReadonlyMap<string, ComponentFunctionCandidate>;
  readonly localTypes: ReadonlyMap<string, TypeDeclaration>;
  readonly sourcePath: string;
}

/** A local or re-exported type name visible from another module. */
interface ExportedTypeBinding {
  readonly localName?: string;
  readonly moduleSpecifier?: string;
  readonly sourceName: string;
}

/** One named/default type import before exact module resolution. */
interface ImportedTypeBinding {
  readonly moduleSpecifier: string;
  readonly sourceName: string;
}

/** Type declarations safe to expand structurally without a TypeScript program. */
type TypeDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** Function body and contextual props type behind a direct export or local HOC chain. */
interface ComponentFunctionCandidate {
  /** Exact variable annotation retained for ordinary imported helper function contracts. */
  readonly contextualFunctionType?: ts.TypeNode;
  readonly contextualPropsType?: ts.TypeNode;
  readonly functionLike?: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
  readonly initializer?: ts.Expression;
}

/** Active expansion budget shared by one export so wide schemas cannot exhaust the editor. */
interface ShapeBudget {
  nodes: number;
}

/** A resolved type declaration retains the module that owns its nested type references. */
interface ResolvedTypeDeclaration {
  readonly declaration: TypeDeclaration;
  readonly module: ParsedTypeDemandModule;
}

/**
 * Caches parsed modules for one compilation and returns imported-type shapes by component export.
 */
export class PreviewRuntimeHookChildTypeDemandResolver {
  private readonly moduleCache = new Map<string, ParsedTypeDemandModule | undefined>();
  private readonly oversizedSourceCache = new Map<string, string | undefined>();
  private readonly oversizedTypeModuleCache = new Map<
    string,
    ParsedTypeDemandModule | undefined
  >();
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
  ): Readonly<Record<string, PreviewInferredPropShape>> {
    const module = this.readModule(sourcePath, sourceText);
    if (module === undefined) return {};
    const result: Record<string, PreviewInferredPropShape> = {};
    for (const [exportName, candidate] of collectExportedComponentCandidates(module)) {
      const propsType = readComponentPropsType(candidate, module.localFunctions, new Set());
      if (propsType === undefined) continue;
      const shape = this.inferShape(propsType, module, module.literalHints, new Set(), {
        nodes: 0,
      });
      if (shape?.kind !== 'object' || Object.keys(shape.properties ?? {}).length === 0) continue;
      result[exportName] = shape;
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
    return parameterType === undefined
      ? undefined
      : this.inferShape(
          parameterType.type,
          parameterType.module,
          parameterType.module.literalHints,
          new Set(),
          { nodes: 0 },
        );
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
  ): PreviewInferredPropShape | undefined {
    if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
    const current = unwrapTypeNode(typeNode);
    if (ts.isTypeOperatorNode(current) && current.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.inferShape(current.type, module, consumerHints, activeTypes, budget);
    }
    const primitive = readPrimitiveShape(current);
    if (primitive !== undefined) return countShape(primitive, budget);
    if (ts.isFunctionTypeNode(current) || ts.isConstructorTypeNode(current)) {
      return countShape({ kind: 'function' }, budget);
    }
    if (isReactComponentType(current)) return countShape({ kind: 'component' }, budget);
    if (ts.isArrayTypeNode(current)) {
      return this.createArrayShape(current.elementType, module, consumerHints, activeTypes, budget);
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
          );
    }
    if (ts.isUnionTypeNode(current)) {
      for (const member of prioritizeUnionMembers(current.types)) {
        const inferred = this.inferShape(member, module, consumerHints, activeTypes, budget);
        if (inferred !== undefined) return inferred;
      }
      return undefined;
    }
    if (ts.isIntersectionTypeNode(current)) {
      return this.mergeObjectTypes(current.types, module, consumerHints, activeTypes, budget);
    }
    if (ts.isTypeLiteralNode(current)) {
      return this.createObjectShape(current.members, module, consumerHints, activeTypes, budget);
    }
    if (ts.isIndexedAccessTypeNode(current)) {
      const objectShape = this.inferShape(
        current.objectType,
        module,
        consumerHints,
        activeTypes,
        budget,
      );
      if (unwrapTypeNode(current.indexType).kind === ts.SyntaxKind.NumberKeyword) {
        return objectShape?.kind === 'array' ? objectShape.items : undefined;
      }
      const propertyName = readStaticIndexedAccessTypeProperty(current.indexType);
      if (propertyName === undefined) return undefined;
      return objectShape?.kind === 'object' ? objectShape.properties?.[propertyName] : undefined;
    }
    if (!ts.isTypeReferenceNode(current) || !ts.isIdentifier(current.typeName)) return undefined;
    const name = current.typeName.text;
    if (
      (name === 'Array' || name === 'ReadonlyArray') &&
      current.typeArguments?.[0] !== undefined
    ) {
      return this.createArrayShape(
        current.typeArguments[0],
        module,
        consumerHints,
        activeTypes,
        budget,
      );
    }
    if (
      (name === 'Readonly' || name === 'Required' || name === 'Partial') &&
      current.typeArguments?.[0] !== undefined
    ) {
      return this.inferShape(current.typeArguments[0], module, consumerHints, activeTypes, budget);
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
        )
      : this.inferShape(
          resolved.declaration.type,
          resolved.module,
          consumerHints,
          activeTypes,
          budget,
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
  ): PreviewInferredPropShape | undefined {
    if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
    budget.nodes += 1;
    const items = this.inferShape(elementType, module, consumerHints, activeTypes, budget);
    return Object.freeze({ kind: 'array', ...(items === undefined ? {} : { items }) });
  }

  /** Merges required members from an interface and every exact inherited interface. */
  private createInterfaceShape(
    declaration: ts.InterfaceDeclaration,
    module: ParsedTypeDemandModule,
    consumerHints: ReadonlyMap<string, boolean | number | string>,
    activeTypes: Set<string>,
    budget: ShapeBudget,
  ): PreviewInferredPropShape | undefined {
    const own = this.createObjectShape(
      declaration.members,
      module,
      consumerHints,
      activeTypes,
      budget,
    );
    let merged = own;
    for (const heritage of declaration.heritageClauses ?? []) {
      for (const expression of heritage.types) {
        const inherited = this.inferShape(expression, module, consumerHints, activeTypes, budget);
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
  ): PreviewInferredPropShape | undefined {
    if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
    budget.nodes += 1;
    const properties: Record<string, PreviewInferredPropShape> = {};
    for (const member of members) {
      const name =
        (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
        member.questionToken === undefined
          ? readPropertyName(member.name)
          : undefined;
      if (name === undefined || BLOCKED_PROPERTY_NAMES.has(name)) continue;
      let child: PreviewInferredPropShape | undefined;
      if (ts.isMethodSignature(member)) {
        child = countShape({ kind: 'function' }, budget);
      } else if (ts.isPropertySignature(member) && member.type !== undefined) {
        child = this.inferShape(member.type, module, consumerHints, activeTypes, budget);
      }
      if (child !== undefined)
        properties[name] = applyPrimitiveLiteralHint(
          child,
          consumerHints.get(name) ?? module.literalHints.get(name),
        );
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
  ): PreviewInferredPropShape | undefined {
    let merged: PreviewInferredPropShape | undefined;
    for (const member of members) {
      merged = mergePropShapes(
        merged,
        this.inferShape(member, module, consumerHints, activeTypes, budget),
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
    if (imported === undefined) return undefined;
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
      if (
        sourceText !== undefined &&
        sourceText.length <= MAX_OVERSIZED_SOURCE_CHARACTERS
      ) {
        this.oversizedSourceCache.set(normalizedPath, sourceText);
      }
      this.moduleCache.set(normalizedPath, undefined);
      return undefined;
    }
    const file = ts.createSourceFile(
      normalizedPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
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
    const normalizedPath = path.normalize(sourcePath);
    const cacheKey = `${normalizedPath}\0${exportName}`;
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
          : extractOversizedExportedTypeAlias(sourceText, exportName);
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
    const module = this.oversizedTypeModuleCache.get(cacheKey);
    return module === undefined
      ? undefined
      : this.resolveExportedType(module, exportName, new Set());
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

/** Extracts one top-level exported type alias without tokenizing an oversized generated module. */
function extractOversizedExportedTypeAlias(
  sourceText: string,
  exportName: string,
): string | undefined {
  if (!/^[$A-Z_a-z][$\w]*$/u.test(exportName)) return undefined;
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `(?:^|[\\r\\n])[\\t ]*export[\\t ]+(?:declare[\\t ]+)?type[\\t ]+${escapedName}(?=[\\t <=>\\r\\n])`,
    'mu',
  ).exec(sourceText);
  if (match?.index === undefined) return undefined;
  const exportOffset = match[0].lastIndexOf('export');
  const start = match.index + Math.max(0, exportOffset);
  const limit = Math.min(sourceText.length, start + MAX_EXTRACTED_TYPE_CHARACTERS);
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let quote: "'" | '"' | '`' | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < limit; index += 1) {
    const character = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') braces += 1;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === ';' && braces === 0 && brackets === 0 && parentheses === 0) {
      return sourceText.slice(start, index + 1);
    }
  }
  return undefined;
}

/** Reads the literal key from `Type["field"]` without expanding unions or computed types. */
function readStaticIndexedAccessTypeProperty(typeNode: ts.TypeNode): string | undefined {
  const current = unwrapTypeNode(typeNode);
  return ts.isLiteralTypeNode(current) && ts.isStringLiteralLike(current.literal)
    ? current.literal.text
    : undefined;
}

/** Indexes type bindings, local component bodies, and exact export identities for one module. */
function indexTypeDemandModule(sourcePath: string, file: ts.SourceFile): ParsedTypeDemandModule {
  const imports = new Map<string, ImportedTypeBinding>();
  const exports = new Map<string, ExportedTypeBinding>();
  const localTypes = new Map<string, TypeDeclaration>();
  const localFunctions = new Map<string, ComponentFunctionCandidate>();
  const literalHints = collectPrimitivePropertyLiteralHints(file);
  let starIndex = 0;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.name !== undefined)
        imports.set(clause.name.text, {
          moduleSpecifier: statement.moduleSpecifier.text,
          sourceName: 'default',
        });
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, {
            moduleSpecifier: statement.moduleSpecifier.text,
            sourceName: element.propertyName?.text ?? element.name.text,
          });
        }
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      localTypes.set(statement.name.text, statement);
      if (hasExportModifier(statement))
        exports.set(statement.name.text, {
          localName: statement.name.text,
          sourceName: statement.name.text,
        });
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      localFunctions.set(statement.name.text, { functionLike: statement });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const contextualPropsType = readReactComponentPropsType(declaration.type);
        localFunctions.set(declaration.name.text, {
          ...(declaration.type === undefined
            ? {}
            : { contextualFunctionType: declaration.type }),
          ...(contextualPropsType === undefined ? {} : { contextualPropsType }),
          initializer: declaration.initializer,
        });
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const moduleSpecifier =
      statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        exports.set(element.name.text, {
          ...(moduleSpecifier === undefined
            ? { localName: element.propertyName?.text ?? element.name.text }
            : { moduleSpecifier }),
          sourceName: element.propertyName?.text ?? element.name.text,
        });
      }
    } else if (moduleSpecifier !== undefined) {
      exports.set(`*:${starIndex.toString()}`, { moduleSpecifier, sourceName: '*' });
      starIndex += 1;
    }
  }
  return { exports, file, imports, literalHints, localFunctions, localTypes, sourcePath };
}

/** Enumerates direct/default/named component exports without executing HOC factories. */
function collectExportedComponentCandidates(
  module: ParsedTypeDemandModule,
): ReadonlyMap<string, ComponentFunctionCandidate> {
  const result = new Map<string, ComponentFunctionCandidate>();
  for (const statement of module.file.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      result.set(hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''), {
        functionLike: statement,
      });
    } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const candidate = module.localFunctions.get(declaration.name.text);
        if (candidate !== undefined) result.set(declaration.name.text, candidate);
      }
    } else if (ts.isExportAssignment(statement)) {
      result.set('default', { initializer: statement.expression });
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const candidate = module.localFunctions.get((element.propertyName ?? element.name).text);
        if (candidate !== undefined) result.set(element.name.text, candidate);
      }
    }
  }
  result.delete('');
  return result;
}

/** Finds the first component parameter type through cycle-safe same-file wrapper expressions. */
function readComponentPropsType(
  candidate: ComponentFunctionCandidate,
  declarations: ReadonlyMap<string, ComponentFunctionCandidate>,
  activeNames: Set<string>,
): ts.TypeNode | undefined {
  if (candidate.contextualPropsType !== undefined) return candidate.contextualPropsType;
  const direct = candidate.functionLike?.parameters[0]?.type;
  if (direct !== undefined) return direct;
  const expression = candidate.initializer;
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return current.parameters[0]?.type;
  }
  if (ts.isIdentifier(current)) {
    if (activeNames.has(current.text)) return undefined;
    const next = declarations.get(current.text);
    if (next === undefined) return undefined;
    activeNames.add(current.text);
    const result = readComponentPropsType(next, declarations, activeNames);
    activeNames.delete(current.text);
    return result;
  }
  const call = ts.isTaggedTemplateExpression(current) ? unwrapExpression(current.tag) : current;
  if (!ts.isCallExpression(call)) return undefined;
  for (const argument of call.arguments) {
    const propsType = readComponentPropsType({ initializer: argument }, declarations, activeNames);
    if (propsType !== undefined) return propsType;
  }
  return undefined;
}

/** Resolves one ordinary function body through exact same-file value aliases. */
function readRuntimeFunctionLike(
  candidate: ComponentFunctionCandidate,
  declarations: ReadonlyMap<string, ComponentFunctionCandidate>,
  activeNames: Set<string>,
): ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | undefined {
  if (candidate.functionLike !== undefined) return candidate.functionLike;
  const expression = candidate.initializer;
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return current;
  if (!ts.isIdentifier(current) || activeNames.has(current.text)) return undefined;
  const next = declarations.get(current.text);
  if (next === undefined) return undefined;
  activeNames.add(current.text);
  const result = readRuntimeFunctionLike(next, declarations, activeNames);
  activeNames.delete(current.text);
  return result;
}

/** Merges compatible structural shapes while preserving operation-proven first operands. */
export function mergePreviewRuntimeHookChildPropShapes(
  primary: PreviewInferredPropShape | undefined,
  secondary: PreviewInferredPropShape | undefined,
): PreviewInferredPropShape | undefined {
  return mergePropShapes(primary, secondary);
}

/** Recursively merges object properties and array item contracts into a frozen data-only shape. */
function mergePropShapes(
  primary: PreviewInferredPropShape | undefined,
  secondary: PreviewInferredPropShape | undefined,
): PreviewInferredPropShape | undefined {
  if (primary === undefined) return secondary;
  if (secondary === undefined) return primary;
  if (primary.kind !== secondary.kind) {
    return primary.kind === 'object' && Object.keys(primary.properties ?? {}).length === 0
      ? secondary
      : primary;
  }
  if (primary.kind === 'array') {
    const items = mergePropShapes(primary.items, secondary.items);
    return Object.freeze({
      kind: 'array',
      ...(items === undefined ? {} : { items }),
    });
  }
  if (primary.kind !== 'object') return primary.value === undefined ? secondary : primary;
  const properties: Record<string, PreviewInferredPropShape> = { ...(primary.properties ?? {}) };
  for (const [name, child] of Object.entries(secondary.properties ?? {})) {
    const merged = mergePropShapes(properties[name], child);
    if (merged !== undefined) properties[name] = merged;
  }
  return Object.freeze({ kind: 'object', properties: Object.freeze(properties) });
}

/**
 * Collects exact primitive values used by equality guards on named fields.
 *
 * A generated key-name string is structurally correct but can still be rejected by a route or enum
 * registry. An authored comparison such as `page.kind === "settings"` proves both the field's
 * domain and one valid scenario. The first source-ordered equality wins; inequality alone is not
 * treated as a valid member of the domain.
 */
function collectPrimitivePropertyLiteralHints(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, boolean | number | string> {
  const hints = new Map<string, boolean | number | string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
    ) {
      appendPrimitivePropertyLiteralHint(node.left, node.right, hints);
      appendPrimitivePropertyLiteralHint(node.right, node.left, hints);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hints;
}

/** Adds one `property === literal` pair without evaluating computed keys or expressions. */
function appendPrimitivePropertyLiteralHint(
  propertyExpression: ts.Expression,
  literalExpression: ts.Expression,
  hints: Map<string, boolean | number | string>,
): void {
  const propertyName = readAccessPropertyName(unwrapExpression(propertyExpression));
  const literal = readPrimitiveExpression(literalExpression);
  if (propertyName !== undefined && literal !== undefined && !hints.has(propertyName)) {
    hints.set(propertyName, literal);
  }
}

/** Reads a direct static property name from dot or literal element access syntax. */
function readAccessPropertyName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

/** Reads a primitive runtime literal without constant folding project expressions. */
function readPrimitiveExpression(expression: ts.Expression): boolean | number | string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Applies a compatible source-proven literal to a neutral primitive type shape. */
function applyPrimitiveLiteralHint(
  shape: PreviewInferredPropShape,
  hint: boolean | number | string | undefined,
): PreviewInferredPropShape {
  if (
    hint === undefined ||
    shape.value !== undefined ||
    (shape.kind === 'string' && typeof hint !== 'string') ||
    (shape.kind === 'number' && typeof hint !== 'number') ||
    (shape.kind === 'boolean' && typeof hint !== 'boolean') ||
    (shape.kind !== 'string' && shape.kind !== 'number' && shape.kind !== 'boolean')
  ) {
    return shape;
  }
  return Object.freeze({ ...shape, value: hint });
}

/** Gives primitive/literal types stable neutral categories and literal values. */
function readPrimitiveShape(typeNode: ts.TypeNode): PreviewInferredPropShape | undefined {
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return { kind: 'string' };
  if (
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BigIntKeyword
  )
    return { kind: 'number' };
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' };
  if (!ts.isLiteralTypeNode(typeNode)) return undefined;
  if (ts.isStringLiteralLike(typeNode.literal))
    return { kind: 'string', value: typeNode.literal.text };
  if (ts.isNumericLiteral(typeNode.literal))
    return { kind: 'number', value: Number(typeNode.literal.text) };
  if (typeNode.literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: true };
  if (typeNode.literal.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: 'boolean', value: false };
  return undefined;
}

/** Counts one immutable shape node against the aggregate schema expansion budget. */
function countShape(
  shape: PreviewInferredPropShape,
  budget: ShapeBudget,
): PreviewInferredPropShape | undefined {
  if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
  budget.nodes += 1;
  return Object.freeze(shape);
}

/** Orders union members so useful browser primitives win over unresolved nominal objects. */
function prioritizeUnionMembers(types: readonly ts.TypeNode[]): readonly ts.TypeNode[] {
  return [...types]
    .filter(
      (candidate) =>
        candidate.kind !== ts.SyntaxKind.NullKeyword &&
        candidate.kind !== ts.SyntaxKind.UndefinedKeyword &&
        candidate.kind !== ts.SyntaxKind.VoidKeyword,
    )
    .sort((left, right) => unionPriority(left) - unionPriority(right));
}

/** Ranks concrete primitives/structures before nominal references that may be unavailable. */
function unionPriority(typeNode: ts.TypeNode): number {
  const current = unwrapTypeNode(typeNode);
  if (
    current.kind === ts.SyntaxKind.StringKeyword ||
    current.kind === ts.SyntaxKind.NumberKeyword ||
    current.kind === ts.SyntaxKind.BooleanKeyword ||
    ts.isLiteralTypeNode(current)
  )
    return 0;
  if (ts.isArrayTypeNode(current) || ts.isTupleTypeNode(current) || ts.isTypeLiteralNode(current))
    return 1;
  return 2;
}

/** Removes tuple optional/rest/named wrappers before element-shape inference. */
function readTupleElementType(typeNode: ts.TypeNode): ts.TypeNode {
  if (ts.isNamedTupleMember(typeNode)) return typeNode.type;
  if (ts.isOptionalTypeNode(typeNode) || ts.isRestTypeNode(typeNode)) return typeNode.type;
  return typeNode;
}

/** Recognizes common React constructor contracts without importing React declarations. */
function isReactComponentType(typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(typeNode)) return false;
  const name = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:ComponentType|ElementType|FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(
    name,
  );
}

/** Reads the props argument of a contextual React function-component variable type. */
function readReactComponentPropsType(typeNode: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const name = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(name)
    ? typeNode.typeArguments?.[0]
    : undefined;
}

/** Unwraps syntax-only expression wrappers without evaluating project code. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

/** Unwraps parenthesized type syntax while preserving authored type identity. */
function unwrapTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(typeNode) ? unwrapTypeNode(typeNode.type) : typeNode;
}

/** Reads a static prototype-safe object member name. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Reports direct `export` syntax without relying on internal compiler flags. */
function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports the `default` partner of an exported declaration. */
function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** Selects the JSX-aware grammar for one supported workspace source. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
    return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Rejects parser recovery before source identities participate in inference. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
