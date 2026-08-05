/**
 * Infers bounded preview-only prop values from exported component syntax and direct value usage.
 * It never executes project modules and materializes only syntax-proven containers, primitives, and
 * functions; unproven leaves stay absent so ordinary falsey UI branches remain natural.
 */
import path from 'node:path';
import ts from 'typescript';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import { PREVIEW_STRING_ONLY_METHOD_NAMES } from '../previewStringMethodNames';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import { isReactComponentTypeSyntax } from './reactComponentTypeSyntax';
import { inferReactOverlayVisibilityProp } from './reactOverlayVisibilityInference';
import { inferReactOverlayVisibilityTypeProp } from './reactOverlayVisibilityTypeInference';
import { inferReactOverlayVisibilityNeutralValue } from './reactOverlayVisibilityNeutralValue';

const MAX_COMPONENT_EXPORTS = 32;
const MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH = 12;
const MAX_INFERRED_DEPTH = 10;
const MAX_INFERRED_NODES = 192;
const MAX_IMPORTED_TYPE_MODULES = 12;
const MAX_IMPORTED_TYPE_BYTES = 2 * 1024 * 1024;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'key', 'prototype', 'ref']);
const ARRAY_METHOD_NAMES = new Set<string>(PREVIEW_COLLECTION_METHOD_NAMES);
const STRING_METHOD_NAMES = new Set<string>(PREVIEW_STRING_ONLY_METHOD_NAMES);

/** Neutral value categories understood by the generated browser materializer. */
export type PreviewInferredPropKind =
  | 'array'
  | 'boolean'
  | 'component'
  | 'function'
  | 'graphql-document'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

/** JSON-safe recursive shape emitted into target and Inspector bridge descriptors. */
export interface PreviewInferredPropShape {
  /** Element contract for arrays when syntax or a resolved type proves its required fields. */
  readonly items?: PreviewInferredPropShape;
  readonly kind: PreviewInferredPropKind;
  readonly properties?: Readonly<Record<string, PreviewInferredPropShape>>;
  readonly value?: boolean | number | string | null;
}

/** Human-readable provenance shown beside editable values in React Page Inspector. */
export interface PreviewInferredPropProvenance {
  readonly kind: PreviewInferredPropKind;
  readonly path: string;
  readonly source: 'type' | 'usage';
}

/** One export's materialization recipe and the paths the extension invented. */
export interface PreviewInferredExportProps {
  readonly provenance: readonly PreviewInferredPropProvenance[];
  readonly shape: PreviewInferredPropShape;
}

/** Exact runtime export-name map consumed without evaluating the selected source module. */
export type PreviewInferredPropsByExport = Readonly<Record<string, PreviewInferredExportProps>>;

type ExportedFunctionLike = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
type LocalObjectType = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** One named import ordered for bounded type-contract resolution. */
interface ResolvableObjectTypeImport {
  readonly binding: ts.ImportSpecifier;
  readonly moduleSpecifier: string;
  readonly order: number;
  readonly typeOnly: boolean;
}

/** One parsed direct-import module shared by all bindings from the same authored specifier. */
interface ResolvedObjectTypeModule {
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}

/** One exported object declaration paired with the parsed module that owns its dependencies. */
interface ResolvedImportedObjectType {
  readonly declaration: LocalObjectType;
  readonly module: ResolvedObjectTypeModule;
}

/** Bounded parse-only import reader shared by compiler and child-demand callers. */
export interface PreviewPropInferenceOptions {
  readonly resolveImport?: (
    moduleSpecifier: string,
    importerPath: string,
  ) => Readonly<{ sourcePath: string; sourceText: string }> | undefined;
}

/** Mutable internal node that retains merge provenance before deterministic serialization. */
interface MutableShapeNode {
  children: Map<string, MutableShapeNode>;
  /** Element contract for an Array node, retained only when its syntax is statically resolvable. */
  items?: MutableShapeNode;
  kind: PreviewInferredPropKind;
  source: PreviewInferredPropProvenance['source'];
  value?: boolean | number | string | null;
}

/** One local identifier proven to represent a path rooted at the component's props object. */
interface PropPathBinding {
  readonly path: readonly string[];
}

/** Export name paired with the function body that React will invoke for that export. */
interface ExportedComponentFunction {
  /** Props type supplied by a variable annotation such as `React.FC<CardProps>`. */
  readonly contextualPropsType?: ts.TypeNode;
  readonly exportName: string;
  readonly functionLike: ExportedFunctionLike;
}

/** Function body plus the optional variable-level React component props contract. */
interface ComponentFunctionCandidate {
  readonly contextualPropsType?: ts.TypeNode;
  readonly functionLike: ExportedFunctionLike;
}

/** Same-file declaration that may be a function or a bounded chain of component wrappers. */
interface LocalComponentDeclaration {
  readonly contextualPropsType?: ts.TypeNode;
  readonly expression?: ts.Expression;
  readonly functionLike?: ExportedFunctionLike;
}

/** Bounded mutable inference state for one exported function. */
interface InferenceState {
  readonly aliases: Map<string, PropPathBinding>;
  readonly functionLike: ExportedFunctionLike;
  readonly graphqlDocumentTypeNames: ReadonlySet<string>;
  nodeCount: number;
  root: MutableShapeNode;
}

/**
 * Collects automatic prop recipes for direct exported component functions.
 *
 * Required same-file types contribute neutral leaves. Runtime usage contributes only receiver
 * containers and operation-proven kinds; an unknown final property is not invented. Existing
 * parent/setup props later overlay this lowest-priority shape in the browser runtime.
 *
 * @param sourcePath Selected JS/TS source path used only to choose parser grammar.
 * @param sourceText Current editor snapshot analyzed without module resolution.
 * @returns Deterministic export-name recipes, or an empty record after parser/budget ambiguity.
 */
export function collectReactExportPropInference(
  sourcePath: string,
  sourceText: string,
  options: PreviewPropInferenceOptions = {},
): PreviewInferredPropsByExport {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return {};
  }
  const localTypes = collectResolvableObjectTypes(sourceFile, sourcePath, options);
  const results: Record<string, PreviewInferredExportProps> = {};
  for (const component of collectExportedComponentFunctions(sourceFile).slice(
    0,
    MAX_COMPONENT_EXPORTS,
  )) {
    const inference = inferComponentProps(component, localTypes, sourceFile);
    if (inference !== undefined && inference.provenance.length > 0) {
      results[component.exportName] = inference;
    }
  }
  return Object.freeze(results);
}

/** Resolves direct imported aliases and one re-export chain without evaluating a project module. */
function collectResolvableObjectTypes(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewPropInferenceOptions,
): ReadonlyMap<string, LocalObjectType> {
  const localTypes = new Map(collectLocalObjectTypes(sourceFile));
  if (options.resolveImport === undefined) return localTypes;
  const budget = { bytes: 0, modules: 0 };
  const modules = new Map<string, ResolvedObjectTypeModule | undefined>();
  for (const imported of collectResolvableObjectTypeImports(sourceFile)) {
    if (!modules.has(imported.moduleSpecifier)) {
      const module = options.resolveImport(imported.moduleSpecifier, sourcePath);
      const moduleBytes = module === undefined ? 0 : Buffer.byteLength(module.sourceText, 'utf8');
      if (
        module === undefined ||
        moduleBytes > MAX_IMPORTED_TYPE_BYTES ||
        budget.modules + 1 > MAX_IMPORTED_TYPE_MODULES ||
        budget.bytes + moduleBytes > MAX_IMPORTED_TYPE_BYTES
      ) {
        modules.set(imported.moduleSpecifier, undefined);
      } else {
        budget.modules += 1;
        budget.bytes += moduleBytes;
        const importedFile = ts.createSourceFile(
          module.sourcePath,
          module.sourceText,
          ts.ScriptTarget.Latest,
          true,
          readScriptKind(module.sourcePath),
        );
        modules.set(
          imported.moduleSpecifier,
          hasParseDiagnostics(importedFile)
            ? undefined
            : { sourceFile: importedFile, sourcePath: module.sourcePath },
        );
      }
    }
    const module = modules.get(imported.moduleSpecifier);
    if (module === undefined) continue;
    const importedName = (imported.binding.propertyName ?? imported.binding.name).text;
    const resolved = resolveExportedObjectType(
      importedName,
      module.sourceFile,
      module.sourcePath,
      options,
      new Set([sourcePath]),
      budget,
    );
    if (resolved === undefined) continue;
    const closure = collectImportedObjectTypeClosure(resolved);
    if (closure === undefined) continue;
    closure.set(imported.binding.name.text, resolved.declaration);
    if (
      [...closure].every(([name, declaration]) => {
        const existing = localTypes.get(name);
        return existing === undefined || isSameObjectTypeDeclaration(existing, declaration);
      })
    ) {
      for (const [name, declaration] of closure) localTypes.set(name, declaration);
    }
  }
  return localTypes;
}

/** Prioritizes explicit type imports so runtime-heavy modules cannot starve prop contracts. */
function collectResolvableObjectTypeImports(
  sourceFile: ts.SourceFile,
): readonly ResolvableObjectTypeImport[] {
  const imports: ResolvableObjectTypeImport[] = [];
  let order = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const importClause = statement.importClause;
    const bindings = importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      imports.push({
        binding,
        moduleSpecifier: statement.moduleSpecifier.text,
        order: order++,
        typeOnly:
          importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword || binding.isTypeOnly,
      });
    }
  }
  return imports.sort(
    (left, right) => Number(right.typeOnly) - Number(left.typeOnly) || left.order - right.order,
  );
}

/** Follows an exported object declaration through a bounded acyclic re-export chain. */
function resolveExportedObjectType(
  name: string,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewPropInferenceOptions,
  activePaths: Set<string>,
  budget: { bytes: number; modules: number },
  depth = 0,
): ResolvedImportedObjectType | undefined {
  if (depth > 8 || activePaths.has(sourcePath)) return undefined;
  activePaths.add(sourcePath);
  const local = collectLocalObjectTypes(sourceFile).get(name);
  if (local !== undefined && hasExportModifier(local)) {
    return { declaration: local, module: { sourceFile, sourcePath } };
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    const exportClause = statement.exportClause;
    if (moduleSpecifier === undefined || exportClause === undefined) continue;
    if (!ts.isStringLiteralLike(moduleSpecifier) || !ts.isNamedExports(exportClause)) continue;
    const binding = exportClause.elements.find((entry) => entry.name.text === name);
    if (binding === undefined || options.resolveImport === undefined) continue;
    const module = options.resolveImport(moduleSpecifier.text, sourcePath);
    const moduleBytes = module === undefined ? 0 : Buffer.byteLength(module.sourceText, 'utf8');
    if (
      module === undefined ||
      moduleBytes > MAX_IMPORTED_TYPE_BYTES ||
      ++budget.modules > MAX_IMPORTED_TYPE_MODULES ||
      (budget.bytes += moduleBytes) > MAX_IMPORTED_TYPE_BYTES
    )
      continue;
    const next = ts.createSourceFile(
      module.sourcePath,
      module.sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(module.sourcePath),
    );
    const resolved = hasParseDiagnostics(next)
      ? undefined
      : resolveExportedObjectType(
          (binding.propertyName ?? binding.name).text,
          next,
          module.sourcePath,
          options,
          activePaths,
          budget,
          depth + 1,
        );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * Collects only object declarations reachable from one already-authorized import in its owner.
 * The walk never resolves another module and fails closed when its existing inference bounds apply.
 */
function collectImportedObjectTypeClosure(
  root: ResolvedImportedObjectType,
): Map<string, LocalObjectType> | undefined {
  const available = collectLocalObjectTypes(root.module.sourceFile);
  const closure = new Map<string, LocalObjectType>();
  const visiting = new Set<string>();
  const visit = (name: string, depth: number): boolean => {
    if (depth > MAX_INFERRED_DEPTH || closure.size >= MAX_INFERRED_NODES) return false;
    const declaration = available.get(name);
    if (declaration === undefined || closure.has(name)) return true;
    if (visiting.has(name)) return true;
    visiting.add(name);
    closure.set(name, declaration);
    let valid = true;
    const inspect = (node: ts.Node): void => {
      if (!valid) return;
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        valid = visit(node.typeName.text, depth + 1);
        if (!valid) return;
      }
      ts.forEachChild(node, inspect);
    };
    if (ts.isInterfaceDeclaration(declaration)) {
      for (const heritage of declaration.heritageClauses ?? []) inspect(heritage);
      for (const member of declaration.members) inspect(member);
    } else {
      inspect(declaration.type);
    }
    visiting.delete(name);
    return valid;
  };
  if (!visit(root.declaration.name.text, 0)) return undefined;
  return closure;
}

/** Treats separately parsed declarations as equal only when their source identity is identical. */
function isSameObjectTypeDeclaration(left: LocalObjectType, right: LocalObjectType): boolean {
  return (
    left === right ||
    (left.kind === right.kind &&
      left.pos === right.pos &&
      left.end === right.end &&
      left.getSourceFile().fileName === right.getSourceFile().fileName)
  );
}

/** Infers local type and direct-use requirements for one component function. */
function inferComponentProps(
  component: ExportedComponentFunction,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  sourceFile: ts.SourceFile,
): PreviewInferredExportProps | undefined {
  const { functionLike } = component;
  const parameter = functionLike.parameters[0];
  if (parameter === undefined) {
    return undefined;
  }
  const root = createMutableNode('object', 'usage');
  const state: InferenceState = {
    aliases: new Map(),
    functionLike,
    graphqlDocumentTypeNames: collectGraphqlDocumentTypeNames(sourceFile),
    nodeCount: 1,
    root,
  };
  collectParameterBindings(parameter.name, [], state.aliases);
  addTypedParameterRequirements(
    parameter,
    component.contextualPropsType,
    localTypes,
    state,
    sourceFile,
  );
  collectLocalPropAliases(functionLike, state);
  collectUsageRequirements(functionLike, state);
  collectSwitchDiscriminantRequirements(functionLike, state);
  addOverlayVisibilityRequirement(component, localTypes, state, sourceFile);
  if (state.root.children.size === 0) {
    return undefined;
  }
  return freezeInference(state.root);
}

/**
 * Gives a directly previewed overlay its one visible state while retaining authored/user priority.
 * Exact visibility bindings win. A rest wrapper is admitted only when an overlay-named component
 * explicitly forwards the same rest property into a visibility attribute; a bare spread cannot
 * prove whether a project uses `show`, `open`, or another API. The inferred `usage` provenance keeps
 * this generated value visible and editable in Page Inspector rather than changing project source.
 */
function addOverlayVisibilityRequirement(
  component: ExportedComponentFunction,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
): void {
  const propName =
    inferReactOverlayVisibilityProp(component.functionLike, component.exportName) ??
    inferReactOverlayVisibilityTypeProp(
      component.functionLike,
      component.exportName,
      component.contextualPropsType,
      sourceFile,
      localTypes,
    );
  if (propName !== undefined) requirePath(state, [propName], 'boolean', 'usage', true);
}

/** Maps destructured/local prop bindings to their external root property paths. */
function collectParameterBindings(
  bindingName: ts.BindingName,
  parentPath: readonly string[],
  aliases: Map<string, PropPathBinding>,
): void {
  if (ts.isIdentifier(bindingName)) {
    aliases.set(bindingName.text, { path: parentPath });
    return;
  }
  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element) || element.initializer !== undefined) continue;
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
    collectParameterBindings(element.name, [...parentPath, propertyName], aliases);
  }
}

/** Adds syntax-resolvable required prop types while imported/any contracts remain usage-driven. */
function addTypedParameterRequirements(
  parameter: ts.ParameterDeclaration,
  contextualPropsType: ts.TypeNode | undefined,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
): void {
  const propsType = parameter.type ?? contextualPropsType;
  if (propsType === undefined) return;
  const members = readObjectTypeMembers(propsType, localTypes, new Set());
  if (members === undefined) return;
  const typeByProperty = new Map<string, ts.TypeNode>();
  for (const member of members) {
    if (
      !ts.isPropertySignature(member) ||
      member.questionToken !== undefined ||
      member.type === undefined
    ) {
      continue;
    }
    const name = readPropertyName(member.name);
    if (name !== undefined && !typeByProperty.has(name)) typeByProperty.set(name, member.type);
  }
  if (ts.isIdentifier(parameter.name)) {
    for (const [propertyName, typeNode] of typeByProperty) {
      addTypeRequirement([propertyName], typeNode, localTypes, state, sourceFile, new Set());
    }
    return;
  }
  if (!ts.isObjectBindingPattern(parameter.name)) return;
  for (const element of parameter.name.elements) {
    if (ts.isOmittedExpression(element) || element.initializer !== undefined) continue;
    const propertyName = readBindingPropertyName(element);
    const typeNode = propertyName === undefined ? undefined : typeByProperty.get(propertyName);
    if (propertyName === undefined || typeNode === undefined) continue;
    addTypeRequirement([propertyName], typeNode, localTypes, state, sourceFile, new Set());
  }
}

/** Resolves required members from one inline or same-file non-generic object declaration. */
function readObjectTypeMembers(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  resolutionStack: Set<string>,
  substitutions: ReadonlyMap<string, ts.TypeNode> = new Map(),
): readonly ts.TypeElement[] | undefined {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isTypeLiteralNode(unwrapped)) return unwrapped.members;
  if (ts.isIntersectionTypeNode(unwrapped)) {
    const members = unwrapped.types.flatMap(
      (member) => readObjectTypeMembers(member, localTypes, resolutionStack, substitutions) ?? [],
    );
    return members.length > 0 ? members : undefined;
  }
  if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) return undefined;
  const name = unwrapped.typeName.text;
  const substituted = substitutions.get(name);
  if (substituted !== undefined) {
    return readObjectTypeMembers(substituted, localTypes, resolutionStack, substitutions);
  }
  if (
    (name === 'PropsWithChildren' || name === 'Readonly' || name === 'Required') &&
    unwrapped.typeArguments?.[0] !== undefined
  ) {
    return readObjectTypeMembers(unwrapped.typeArguments[0], localTypes, resolutionStack, substitutions);
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || resolutionStack.has(name)) return undefined;
  resolutionStack.add(name);
  try {
    const typeParameters = declaration.typeParameters;
    const typeArguments = unwrapped.typeArguments;
    if (
      typeParameters !== undefined &&
      (typeArguments === undefined || typeParameters.length !== typeArguments.length)
    ) {
      return undefined;
    }
    const nestedSubstitutions = new Map(substitutions);
    for (const [index, parameter] of (typeParameters ?? []).entries()) {
      const argument = typeArguments?.[index];
      if (argument === undefined) return undefined;
      nestedSubstitutions.set(parameter.name.text, argument);
    }
    const members = ts.isInterfaceDeclaration(declaration)
      ? [
          ...declaration.members,
          ...(declaration.heritageClauses ?? []).flatMap((clause) =>
            clause.types.flatMap(
              (heritageType) =>
                readObjectTypeMembers(heritageType, localTypes, resolutionStack, nestedSubstitutions) ?? [],
            ),
          ),
        ]
      : readObjectTypeMembers(declaration.type, localTypes, resolutionStack, nestedSubstitutions);
    return members;
  } finally {
    resolutionStack.delete(name);
  }
}

/** Converts a safe local type into one neutral shape requirement, recursively when object-shaped. */
function addTypeRequirement(
  path_: readonly string[],
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  activeNames: Set<string>,
  depthOffset = 0,
): void {
  if (depthOffset + path_.length > MAX_INFERRED_DEPTH) return;
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    state.graphqlDocumentTypeNames.has(unwrapped.typeName.text)
  ) {
    addGraphqlDocumentRequirement(path_, unwrapped, localTypes, state, sourceFile, depthOffset);
    return;
  }
  if (unwrapped.kind === ts.SyntaxKind.StringKeyword) {
    requirePath(state, path_, 'string', 'type');
    return;
  }
  if (
    unwrapped.kind === ts.SyntaxKind.NumberKeyword ||
    unwrapped.kind === ts.SyntaxKind.BigIntKeyword
  ) {
    requirePath(state, path_, 'number', 'type');
    return;
  }
  if (unwrapped.kind === ts.SyntaxKind.BooleanKeyword) {
    /* A required-state flag on a generated row describes which valid UI variant to show, not an
     * action to perform. Prefer the affirmative representative so required markers/fields are not
     * permanently hidden behind the otherwise neutral false value. */
    const propertyName = path_.at(-1)?.toLowerCase();
    requirePath(
      state,
      path_,
      'boolean',
      'type',
      propertyName === 'isrequired' || propertyName === 'required' ? true : undefined,
    );
    return;
  }
  if (ts.isArrayTypeNode(unwrapped) || ts.isTupleTypeNode(unwrapped)) {
    requirePath(state, path_, 'array', 'type');
    const elementType = ts.isArrayTypeNode(unwrapped)
      ? unwrapped.elementType
      : unwrapped.elements[0];
    if (elementType !== undefined) {
      setArrayItemRequirement(
        state,
        path_,
        createTypeShape(
          elementType,
          localTypes,
          state,
          sourceFile,
          activeNames,
          depthOffset + path_.length,
        ),
      );
    }
    return;
  }
  if (ts.isFunctionTypeNode(unwrapped)) {
    requirePath(state, path_, 'function', 'type');
    return;
  }
  if (isReactComponentTypeSyntax(unwrapped)) {
    requirePath(state, path_, 'component', 'type');
    return;
  }
  if (ts.isLiteralTypeNode(unwrapped)) {
    const literal = readLiteralValue(unwrapped.literal);
    if (typeof literal === 'string') requirePath(state, path_, 'string', 'type', literal);
    else if (typeof literal === 'number') requirePath(state, path_, 'number', 'type', literal);
    else if (typeof literal === 'boolean') requirePath(state, path_, 'boolean', 'type', literal);
    return;
  }
  if (ts.isUnionTypeNode(unwrapped)) {
    const members = unwrapped.types.filter((candidate) => !isNullishTypeNode(candidate));
    if (members.length > 0 && members.every(isPreviewCollectionTypeNode)) {
      requirePath(state, path_, 'array', 'type');
      const itemShapes = members
        .map((member) => readPreviewCollectionElementType(member))
        .filter((member): member is ts.TypeNode => member !== undefined)
        .map((member) =>
          createTypeShape(
            member,
            localTypes,
            state,
            sourceFile,
            activeNames,
            depthOffset + path_.length,
          ),
        )
        .filter((shape): shape is MutableShapeNode => shape?.kind === 'object');
      if (itemShapes.length === 1) setArrayItemRequirement(state, path_, itemShapes[0]);
      return;
    }
    if (members.length === 1) {
      const member = members[0];
      if (member === undefined) return;
      addTypeRequirement(path_, member, localTypes, state, sourceFile, activeNames, depthOffset);
      return;
    }
    const representative = selectDiscriminatedObjectUnionMember(members, localTypes);
    if (representative !== undefined) {
      addTypeRequirement(
        path_,
        representative,
        localTypes,
        state,
        sourceFile,
        activeNames,
        depthOffset,
      );
    }
    return;
  }
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray')
  ) {
    requirePath(state, path_, 'array', 'type');
    const elementType = unwrapped.typeArguments?.[0];
    if (elementType !== undefined) {
      setArrayItemRequirement(
        state,
        path_,
        createTypeShape(
          elementType,
          localTypes,
          state,
          sourceFile,
          activeNames,
          depthOffset + path_.length,
        ),
      );
    }
    return;
  }
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    unwrapped.typeName.text === 'Record'
  ) {
    /* Record keys may be an unbounded string domain, so invent no entries. The empty plain object
     * still satisfies Object.keys/values/entries and dynamic lookup contracts without guessing
     * application data. */
    requirePath(state, path_, 'object', 'type');
    return;
  }
  if (ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)) {
    const aliasName = unwrapped.typeName.text;
    const alias = localTypes.get(aliasName);
    if (alias !== undefined && ts.isTypeAliasDeclaration(alias)) {
      if (activeNames.has(aliasName)) return;
      activeNames.add(aliasName);
      try {
        addTypeRequirement(
          path_,
          alias.type,
          localTypes,
          state,
          sourceFile,
          activeNames,
          depthOffset,
        );
      } finally {
        activeNames.delete(aliasName);
      }
      return;
    }
  }
  const activeName =
    ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)
      ? unwrapped.typeName.text
      : undefined;
  if (activeName !== undefined && activeNames.has(activeName)) return;
  if (activeName !== undefined) activeNames.add(activeName);
  try {
    const members = readObjectTypeMembers(unwrapped, localTypes, new Set());
    if (members === undefined) return;
    requirePath(state, path_, 'object', 'type');
    for (const member of members) {
      if (
        !ts.isPropertySignature(member) ||
        member.questionToken !== undefined ||
        member.type === undefined
      )
        continue;
      const propertyName = readPropertyName(member.name);
      if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
      addTypeRequirement(
        [...path_, propertyName],
        member.type,
        localTypes,
        state,
        sourceFile,
        activeNames,
        depthOffset,
      );
    }
  } finally {
    if (activeName !== undefined) activeNames.delete(activeName);
  }
}

/** Admits only canonical GraphQL document imports, including a directly named local alias. */
function collectGraphqlDocumentTypeNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (!/^@apollo\/client(?:\/|$)/u.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const importedName = (binding.propertyName ?? binding.name).text;
      if (importedName === 'DocumentNode' || importedName === 'TypedDocumentNode') {
        names.add(binding.name.text);
      }
    }
  }
  return names;
}

/** Creates a minimum executable GraphQL document from canonical type evidence and response shape. */
function addGraphqlDocumentRequirement(
  path_: readonly string[],
  typeReference: ts.TypeReferenceNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  depthOffset: number,
): void {
  const operation = readGraphqlOperation(path_);
  if (operation === undefined || typeReference.typeArguments?.[0] === undefined) return;
  requirePath(state, path_, 'graphql-document', 'type');
  const document = readMutablePathNode(state, path_);
  if (document === undefined || document.kind !== 'graphql-document') return;
  const response = createTypeShape(
    typeReference.typeArguments[0],
    localTypes,
    state,
    sourceFile,
    new Set(),
    depthOffset + path_.length,
  );
  if (response?.kind === 'object') {
    for (const [name, child] of response.children) document.children.set(name, child);
  }
  // Keep a neutral valid leaf even when the response type cannot be resolved.
  if (!document.children.has('__typename')) {
    document.children.set('__typename', createMutableNode('string', 'type'));
  }
  document.value = operation;
}

/** Requires a non-conflicting authored query/mutation marker in addition to canonical type evidence. */
function readGraphqlOperation(path_: readonly string[]): 'mutation' | 'query' | undefined {
  const name = path_.at(-1) ?? '';
  const query = /query/iu.test(name);
  const mutation = /mutation/iu.test(name);
  return query === mutation ? undefined : query ? 'query' : 'mutation';
}

/** Reads one previously materialized node without widening paths or bypassing safe-name checks. */
function readMutablePathNode(
  state: InferenceState,
  path_: readonly string[],
): MutableShapeNode | undefined {
  let node = state.root;
  for (const name of path_) {
    const child = node.children.get(name);
    if (child === undefined) return undefined;
    node = child;
  }
  return node;
}

/**
 * Selects the first authored branch only when every object branch proves a shared literal tag.
 *
 * A discriminated union has multiple valid runtime representatives but omitting the whole prop is
 * never one of them. Requiring a common literal field keeps this choice bounded and avoids
 * guessing through ordinary unions whose branches carry unrelated application semantics.
 */
function selectDiscriminatedObjectUnionMember(
  members: readonly ts.TypeNode[],
  localTypes: ReadonlyMap<string, LocalObjectType>,
): ts.TypeNode | undefined {
  if (members.length < 2) return undefined;
  const objectMembers = members.map((member) =>
    readObjectTypeMembers(member, localTypes, new Set()),
  );
  if (objectMembers.some((member) => member === undefined)) return undefined;
  const first = objectMembers[0];
  if (first === undefined) return undefined;
  for (const candidate of first) {
    if (
      !ts.isPropertySignature(candidate) ||
      candidate.questionToken !== undefined ||
      candidate.type === undefined ||
      !ts.isLiteralTypeNode(candidate.type)
    ) {
      continue;
    }
    const propertyName = readPropertyName(candidate.name);
    const firstLiteral = readLiteralValue(candidate.type.literal);
    if (propertyName === undefined || firstLiteral === undefined) continue;
    const literals = objectMembers.map((member) => {
      const property = member?.find(
        (entry) =>
          ts.isPropertySignature(entry) &&
          entry.questionToken === undefined &&
          readPropertyName(entry.name) === propertyName,
      );
      return property !== undefined &&
        ts.isPropertySignature(property) &&
        property.type !== undefined &&
        ts.isLiteralTypeNode(property.type)
        ? readLiteralValue(property.type.literal)
        : undefined;
    });
    if (
      literals.every((literal) => literal !== undefined) &&
      new Set(literals.map((literal) => `${typeof literal}:${String(literal)}`)).size > 1
    ) {
      return members[0];
    }
  }
  return undefined;
}

/** Removes only nullish union branches; other alternatives remain ambiguous and fail closed. */
function isNullishTypeNode(node: ts.TypeNode): boolean {
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword
  )
    return true;
  return (
    ts.isLiteralTypeNode(node) &&
    (node.literal.kind === ts.SyntaxKind.NullKeyword ||
      node.literal.kind === ts.SyntaxKind.UndefinedKeyword)
  );
}

/** Reports an array-like type branch without resolving or executing imported declarations. */
function isPreviewCollectionTypeNode(node: ts.TypeNode): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(node) ? node.type : node;
  return (
    ts.isArrayTypeNode(unwrapped) ||
    ts.isTupleTypeNode(unwrapped) ||
    (ts.isTypeReferenceNode(unwrapped) &&
      ts.isIdentifier(unwrapped.typeName) &&
      (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray'))
  );
}

/** Reads the one direct item annotation of a safe array branch without evaluating generic values. */
function readPreviewCollectionElementType(node: ts.TypeNode): ts.TypeNode | undefined {
  const unwrapped = ts.isParenthesizedTypeNode(node) ? node.type : node;
  if (ts.isArrayTypeNode(unwrapped)) return unwrapped.elementType;
  if (ts.isTupleTypeNode(unwrapped)) return unwrapped.elements[0];
  return ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray')
    ? unwrapped.typeArguments?.[0]
    : undefined;
}

/**
 * Selects the direct object branch of a grouped collection item such as `(Row | Row[])[]`.
 *
 * Both branches are valid authored values, but materializing the nested-array branch would require
 * recursively inventing grouping semantics. A unique resolvable object plus only collection
 * alternatives has one bounded, type-valid representative: the direct object.
 */
function selectPreviewCollectionItemType(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
): ts.TypeNode {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isUnionTypeNode(unwrapped)) return typeNode;
  const members = unwrapped.types.filter((candidate) => !isNullishTypeNode(candidate));
  const objectMembers = members.filter(
    (member) => readObjectTypeMembers(member, localTypes, new Set()) !== undefined,
  );
  if (objectMembers.length !== 1) return typeNode;
  const objectMember = objectMembers[0];
  if (
    objectMember === undefined ||
    members.some((member) => member !== objectMember && !isPreviewCollectionTypeNode(member))
  ) return typeNode;
  return objectMember;
}

/** Builds one fail-closed, parse-only element shape for a statically known collection. */
function createTypeShape(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  activeNames: Set<string>,
  depthOffset: number,
): MutableShapeNode | undefined {
  // The detached item root consumes one level of the caller's already-used aggregate corridor;
  // it must not restart at an apparent top-level `value` path for nested collection evidence.
  if (state.nodeCount >= MAX_INFERRED_NODES) return undefined;
  const selectedTypeNode = selectPreviewCollectionItemType(typeNode, localTypes);
  const root = createMutableNode('object', 'type');
  const previousRoot = state.root;
  state.root = root;
  try {
    addTypeRequirement(
      ['value'],
      selectedTypeNode,
      localTypes,
      state,
      sourceFile,
      activeNames,
      depthOffset,
    );
  } finally {
    state.root = previousRoot;
  }
  return root.children.get('value');
}

/** Associates a proven element shape with an existing inferred Array path without widening it. */
function setArrayItemRequirement(
  state: InferenceState,
  path_: readonly string[],
  items: MutableShapeNode | undefined,
): void {
  // A scalar element does not prove a structured UI branch. Retain only object-shaped element
  // contracts, which are the bounded evidence needed for a pill/list item without inventing data.
  if (items === undefined || items.kind !== 'object') return;
  let node = state.root;
  for (const name of path_) {
    const next = node.children.get(name);
    if (next === undefined) return;
    node = next;
  }
  if (node.kind === 'array' && node.items === undefined) node.items = items;
}

/** Collects simple local aliases before evaluating later receiver paths in callbacks and JSX. */
function collectLocalPropAliases(functionLike: ExportedFunctionLike, state: InferenceState): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const sourcePath = readPropPath(node.initializer, state.aliases);
      if (sourcePath !== undefined) {
        if (ts.isIdentifier(node.name)) {
          state.aliases.set(node.name.text, { path: sourcePath });
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const propertyName = readBindingPropertyName(element);
            if (
              propertyName !== undefined &&
              !BLOCKED_PROPERTY_NAMES.has(propertyName) &&
              ts.isIdentifier(element.name)
            ) {
              state.aliases.set(element.name.text, { path: [...sourcePath, propertyName] });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Derives receiver containers and operation kinds from property paths rooted in known props. */
function collectUsageRequirements(functionLike: ExportedFunctionLike, state: InferenceState): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      if (path_ !== undefined && path_.length > 0 && !isShadowedPathRoot(node, state)) {
        const optionalReceiverLength = readFirstOptionalReceiverLength(node, state.aliases);
        addReceiverContainers(state, path_, optionalReceiverLength ?? path_.length);
        if (optionalReceiverLength === undefined) addOperationRequirement(state, path_, node);
      }
    } else if (ts.isIdentifier(node)) {
      const binding = state.aliases.get(node.text);
      if (
        binding !== undefined &&
        binding.path.length > 0 &&
        !isIdentifierPartOfAccess(node) &&
        !isDeclarationName(node) &&
        !isShadowedIdentifier(node, node.text, state.functionLike)
      ) {
        addOperationRequirement(state, binding.path, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/**
 * Selects the first authored primitive branch for a direct prop-derived switch discriminant.
 *
 * A switch that names every branch with a literal proves a finite accepted value set without
 * evaluating project code. Existing type or usage requirements retain ownership of a prop value;
 * this is solely the bounded fallback for an otherwise unmaterialized discriminant.
 */
function collectSwitchDiscriminantRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) {
      const path_ = readPropPath(node.expression, state.aliases);
      const caseValues = readDirectPrimitiveSwitchCaseValues(node);
      if (
        path_ !== undefined &&
        path_.length > 0 &&
        !isShadowedPathRoot(node.expression, state) &&
        !hasPreviewInferredPropTerminal(state, path_) &&
        caseValues !== undefined
      ) {
        const value = caseValues[0];
        if (value !== undefined) {
          requirePath(state, path_, readPrimitiveValueKind(value), 'usage', value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Accepts only switches whose non-default clauses are directly authored primitive literals. */
function readDirectPrimitiveSwitchCaseValues(
  statement: ts.SwitchStatement,
): readonly (boolean | number | string)[] | undefined {
  const values: (boolean | number | string)[] = [];
  for (const clause of statement.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const value = readLiteralValue(clause.expression as ts.LiteralTypeNode['literal']);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values.length > 0 ? values : undefined;
}

/** Narrows the three serializable switch-literal categories to inference shape kinds. */
function readPrimitiveValueKind(value: boolean | number | string): PreviewInferredPropKind {
  if (typeof value === 'boolean') return 'boolean';
  return typeof value === 'number' ? 'number' : 'string';
}

/** Ensures receiver prefixes exist only before an authored optional-chain short circuit. */
function addReceiverContainers(
  state: InferenceState,
  path_: readonly string[],
  exclusiveLength: number,
): void {
  for (let length = 1; length < exclusiveLength; length += 1) {
    requirePath(state, path_.slice(0, length), 'object', 'usage');
  }
}

/** Infers callable/iterable/primitive kinds only when the consuming syntax proves the operation. */
function addOperationRequirement(
  state: InferenceState,
  path_: readonly string[],
  node: ts.Expression,
): void {
  const parent = node.parent;
  const overlayNeutralValue = inferReactOverlayVisibilityNeutralValue(node);
  if (overlayNeutralValue !== undefined) {
    requirePath(state, path_, overlayNeutralValue.kind, 'usage', overlayNeutralValue.value);
    return;
  }
  if (
    ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === node) ||
    (ts.isJsxClosingElement(parent) && parent.tagName === node)
  ) {
    requirePath(state, path_, 'component', 'usage');
    return;
  }
  if (
    ts.isCallExpression(parent) &&
    parent.expression === node &&
    parent.questionDotToken !== undefined
  ) {
    return;
  }
  if (
    ts.isPrefixUnaryExpression(parent) &&
    parent.operator === ts.SyntaxKind.ExclamationToken &&
    parent.operand === node
  ) {
    /* Negation proves truthiness, not Boolean type. Preserve a semantic URL/data value so an exact
     * target can pass `if (!value) return null` instead of receiving a self-defeating `false`. */
    const semantic = inferPreviewRuntimeSemanticFallback(path_.at(-1) ?? '');
    if (isRenderTerminatingNegatedGuard(parent)) {
      if (semantic?.kind === 'boolean') {
        requirePath(state, path_, 'boolean', 'usage', true);
      } else if (semantic?.kind === 'number') {
        requirePath(state, path_, 'number', 'usage', 1);
      } else if (semantic?.kind === 'null' || semantic === undefined) {
        requirePath(state, path_, 'object', 'usage');
      } else {
        requirePath(state, path_, semantic.kind, 'usage', semantic.value);
      }
    } else {
      requirePath(state, path_, semantic?.kind ?? 'boolean', 'usage', semantic?.value ?? false);
    }
    return;
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) {
    const methodName = path_.at(-1);
    const receiverPath = path_.slice(0, -1);
    if (receiverPath.length > 0 && methodName !== undefined && ARRAY_METHOD_NAMES.has(methodName)) {
      requirePath(state, receiverPath, 'array', 'usage');
    } else if (
      receiverPath.length > 0 &&
      methodName !== undefined &&
      STRING_METHOD_NAMES.has(methodName)
    ) {
      requirePath(state, receiverPath, 'string', 'usage');
    } else {
      requirePath(state, path_, 'function', 'usage');
    }
    return;
  }
  if (
    (ts.isForOfStatement(parent) && parent.expression === node) ||
    (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent))
  ) {
    requirePath(state, path_, 'array', 'usage');
    return;
  }
  if (
    path_.length > 1 &&
    !hasPreviewInferredPropTerminal(state, path_) &&
    isReactRenderedValueExpression(node)
  ) {
    const semantic = inferPreviewRuntimeSemanticFallback(path_.at(-1) ?? '');
    if (semantic !== undefined) {
      requirePath(state, path_, semantic.kind, 'usage', semantic.value);
    }
  }
}

/** Reports a negated prop guard whose selected branch exits before visible component output. */
function isRenderTerminatingNegatedGuard(negation: ts.PrefixUnaryExpression): boolean {
  let condition: ts.Expression = negation;
  let parent = condition.parent;
  while (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent)) &&
    parent.expression === condition
  ) {
    condition = parent;
    parent = condition.parent;
  }
  return (
    ts.isIfStatement(parent) &&
    parent.expression === condition &&
    doesStatementTerminateRender(parent.thenStatement)
  );
}

/** Accepts only a direct return/throw or a block whose last statement is a direct terminal. */
function doesStatementTerminateRender(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  const terminal = statement.statements.at(-1);
  return terminal !== undefined &&
    (ts.isReturnStatement(terminal) || ts.isThrowStatement(terminal));
}

/** Reports whether type or prior operation evidence already owns the final prop-path value kind. */
function hasPreviewInferredPropTerminal(state: InferenceState, path_: readonly string[]): boolean {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return false;
    current = child;
  }
  return current.kind !== 'object' || current.children.size > 0;
}

/**
 * Reports whether one prop-derived value reaches JSX output. Semantic keys may seed that leaf while
 * syntax-only wrappers are skipped without following calls or changing unrelated control flow.
 */
function isReactRenderedValueExpression(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  if (!ts.isJsxExpression(parent) || parent.expression !== current) return false;
  return (
    ts.isJsxAttribute(parent.parent) ||
    ts.isJsxElement(parent.parent) ||
    ts.isJsxFragment(parent.parent)
  );
}

/** Finds the shallowest optional receiver so neutral props preserve authored short-circuiting. */
function readFirstOptionalReceiverLength(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): number | undefined {
  let current = unwrapExpression(expression);
  let selected: number | undefined;
  while (isAccessExpression(current)) {
    if (current.questionDotToken !== undefined) {
      const receiverPath = readPropPath(current.expression, aliases);
      if (receiverPath !== undefined) {
        selected =
          selected === undefined ? receiverPath.length : Math.min(selected, receiverPath.length);
      }
    }
    current = unwrapExpression(current.expression);
  }
  return selected;
}

/** Merges one materialized path under depth/node budgets and safe-property constraints. */
function requirePath(
  state: InferenceState,
  path_: readonly string[],
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
  value?: boolean | number | string | null,
): void {
  if (path_.length === 0 || path_.length > MAX_INFERRED_DEPTH) return;
  let current = state.root;
  for (const [index, propertyName] of path_.entries()) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= MAX_INFERRED_NODES) return;
      child = createMutableNode(index === path_.length - 1 ? kind : 'object', source);
      current.children.set(propertyName, child);
      state.nodeCount += 1;
    }
    if (index === path_.length - 1) {
      mergeNodeKind(child, kind, source, value);
    } else if (child.kind !== 'object') {
      return;
    }
    current = child;
  }
}

/** Refines an empty object receiver to an operation-proven kind and otherwise fails conservatively. */
function mergeNodeKind(
  node: MutableShapeNode,
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
  value?: boolean | number | string | null,
): void {
  if (node.kind === kind) {
    if (source === 'type') node.source = 'type';
    if (value !== undefined) node.value = value;
    return;
  }
  if (node.kind === 'object' && node.children.size === 0) {
    node.kind = kind;
    node.source = source;
    if (value === undefined) delete node.value;
    else node.value = value;
  }
}

/** Reads an access chain rooted in a known prop or local alias without invoking computed values. */
function readPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return aliases.get(current.text)?.path;
  if (ts.isPropertyAccessExpression(current)) {
    const parentPath = readPropPath(current.expression, aliases);
    return parentPath === undefined || BLOCKED_PROPERTY_NAMES.has(current.name.text)
      ? undefined
      : [...parentPath, current.name.text];
  }
  if (ts.isElementAccessExpression(current)) {
    const parentPath = readPropPath(current.expression, aliases);
    const propertyName = readElementPropertyName(current.argumentExpression);
    return parentPath === undefined ||
      propertyName === undefined ||
      BLOCKED_PROPERTY_NAMES.has(propertyName)
      ? undefined
      : [...parentPath, propertyName];
  }
  return undefined;
}

/** Rejects a root identifier shadowed between its access and the exported component function. */
function isShadowedPathRoot(node: ts.Expression, state: InferenceState): boolean {
  let root: ts.Expression = node;
  while (isAccessExpression(root)) root = unwrapExpression(root.expression);
  return ts.isIdentifier(root) ? isShadowedIdentifier(root, root.text, state.functionLike) : false;
}

/** Detects nested function parameters that replace a component prop/alias identity. */
function isShadowedIdentifier(
  identifier: ts.Identifier,
  name: string,
  functionLike: ExportedFunctionLike,
): boolean {
  let current: ts.Node = identifier.parent;
  while (current !== functionLike && !ts.isSourceFile(current)) {
    if (isFunctionLike(current) && current !== functionLike) {
      if (current.parameters.some((parameter) => bindingContainsName(parameter.name, name))) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Freezes one deterministic JSON-safe shape and its flattened provenance inventory. */
function freezeInference(root: MutableShapeNode): PreviewInferredExportProps {
  const provenance: PreviewInferredPropProvenance[] = [];
  const freezeNode = (
    node: MutableShapeNode,
    path_: readonly string[],
  ): PreviewInferredPropShape => {
    const properties = Object.fromEntries(
      [...node.children.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, child]) => [name, freezeNode(child, [...path_, name])]),
    );
    if (path_.length > 0) {
      provenance.push({ kind: node.kind, path: path_.join('.'), source: node.source });
    }
    return Object.freeze({
      kind: node.kind,
      ...(node.kind === 'array' && node.items !== undefined
        ? { items: freezeNode(node.items, [...path_, '[]']) }
        : {}),
      ...(node.kind === 'object' || node.kind === 'graphql-document'
        ? { properties: Object.freeze(properties) }
        : {}),
      ...(node.value === undefined ? {} : { value: node.value }),
    });
  };
  const shape = freezeNode(root, []);
  return Object.freeze({
    provenance: Object.freeze(
      provenance.sort((left, right) => left.path.localeCompare(right.path)),
    ),
    shape,
  });
}

/** Collects direct/default/local-clause exports while statically following same-file HOC inputs. */
function collectExportedComponentFunctions(
  sourceFile: ts.SourceFile,
): readonly ExportedComponentFunction[] {
  const localDeclarations = collectLocalComponentDeclarations(sourceFile);
  const selected: ExportedComponentFunction[] = [];
  const seenNames = new Set<string>();
  const add = (exportName: string, candidate: ComponentFunctionCandidate | undefined): void => {
    if (
      candidate === undefined ||
      seenNames.has(exportName) ||
      (exportName !== 'default' && !/^\p{Lu}/u.test(exportName))
    )
      return;
    seenNames.add(exportName);
    selected.push({ exportName, ...candidate });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const candidate = { functionLike: statement };
      if (hasExportModifier(statement)) {
        add(hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''), candidate);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const candidate = resolveLocalComponent(declaration.name.text, localDeclarations);
        if (hasExportModifier(statement)) add(declaration.name.text, candidate);
      }
    } else if (ts.isExportAssignment(statement)) {
      add('default', resolveComponentExpression(statement.expression, localDeclarations));
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        add(element.name.text, resolveLocalComponent(localName, localDeclarations));
      }
    }
  }
  return selected;
}

/** Indexes unique top-level declarations without resolving imports or evaluating initializers. */
function collectLocalComponentDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalComponentDeclaration> {
  const declarations = new Map<string, LocalComponentDeclaration>();
  const ambiguous = new Set<string>();
  const add = (name: string, declaration: LocalComponentDeclaration): void => {
    if (ambiguous.has(name)) return;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else declarations.set(name, declaration);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      add(statement.name.text, { functionLike: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const contextualPropsType = readReactComponentPropsType(declaration.type);
        add(declaration.name.text, {
          expression: declaration.initializer,
          ...(contextualPropsType === undefined ? {} : { contextualPropsType }),
        });
      }
    }
  }
  return declarations;
}

/** Extracts the props argument from common `FC<Props>` variable annotations. */
function readReactComponentPropsType(typeNode: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const typeName = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(typeName)
    ? typeNode.typeArguments?.[0]
    : undefined;
}

/** Resolves one unique same-file declaration through bounded HOC/alias chains; cycles fail closed. */
function resolveLocalComponent(
  name: string,
  declarations: ReadonlyMap<string, LocalComponentDeclaration>,
  activeNames: Set<string> = new Set<string>(),
  depth = 0,
): ComponentFunctionCandidate | undefined {
  if (depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH || activeNames.has(name)) return undefined;
  const declaration = declarations.get(name);
  if (declaration === undefined) return undefined;
  activeNames.add(name);
  const candidate = declaration.functionLike
    ? { functionLike: declaration.functionLike }
    : resolveComponentExpression(declaration.expression, declarations, activeNames, depth + 1);
  activeNames.delete(name);
  return candidate === undefined
    ? undefined
    : {
        ...candidate,
        ...(declaration.contextualPropsType === undefined
          ? {}
          : { contextualPropsType: declaration.contextualPropsType }),
      };
}

/** Reads direct functions or local component arguments from nested common React HOC syntax. */
function resolveComponentExpression(
  expression: ts.Expression | undefined,
  declarations: ReadonlyMap<string, LocalComponentDeclaration>,
  activeNames: Set<string> = new Set<string>(),
  depth = 0,
): ComponentFunctionCandidate | undefined {
  if (expression === undefined || depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return { functionLike: current };
  }
  if (ts.isIdentifier(current)) {
    return resolveLocalComponent(current.text, declarations, activeNames, depth + 1);
  }
  const call = ts.isTaggedTemplateExpression(current) ? unwrapExpression(current.tag) : current;
  if (!ts.isCallExpression(call) || call.arguments.length === 0) return undefined;
  for (const argument of call.arguments) {
    const candidate = unwrapExpression(argument);
    if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) {
      return { functionLike: candidate };
    }
  }
  for (const argument of call.arguments) {
    const candidate = resolveComponentExpression(argument, declarations, activeNames, depth + 1);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

/** Indexes unique non-generic same-file type/interface declarations. */
function collectLocalObjectTypes(sourceFile: ts.SourceFile): ReadonlyMap<string, LocalObjectType> {
  const declarations = new Map<string, LocalObjectType>();
  const ambiguous = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue;
    const name = statement.name.text;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else if (!ambiguous.has(name)) {
      declarations.set(name, statement);
    }
  }
  return declarations;
}

/** Creates one mutable node with a child map unavailable to project-controlled prototypes. */
function createMutableNode(
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
): MutableShapeNode {
  return { children: new Map(), kind, source };
}

/** Unwraps syntax-only assertions while retaining runtime access structure. */
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

/** Reports property/element access expressions handled by the path reader. */
function isAccessExpression(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/** Keeps only the outermost access chain so each operation is interpreted exactly once. */
function isNestedAccessReceiver(node: ts.Expression): boolean {
  const parent = node.parent;
  return isAccessExpression(parent) && parent.expression === node;
}

/** Reports whether an identifier already belongs to an access chain visited at its outer node. */
function isIdentifierPartOfAccess(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) &&
      (parent.expression === identifier || parent.name === identifier)) ||
    (ts.isElementAccessExpression(parent) && parent.expression === identifier)
  );
}

/** Excludes declaration/binding positions from bare identifier operation inference. */
function isDeclarationName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier)
  );
}

/** Narrows ordinary nested function scopes used by shadow checks. */
function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Recursively checks a binding pattern for one shadowing local name. */
function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Reads an external property name from shorthand, renamed, or nested binding syntax. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName !== undefined) return readPropertyName(element.propertyName);
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

/** Reads a safe static property name without evaluating a computed expression. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Reads a static element-access name accepted by object shape serialization. */
function readElementPropertyName(expression: ts.Expression | undefined): string | undefined {
  return expression !== undefined &&
    (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression))
    ? expression.text
    : undefined;
}

/** Reads primitive literal types while excluding bigint and expression-based values. */
function readLiteralValue(
  literal: ts.LiteralTypeNode['literal'],
): boolean | number | string | undefined {
  if (ts.isStringLiteralLike(literal)) return literal.text;
  if (ts.isNumericLiteral(literal)) return Number(literal.text);
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Reports a direct export modifier without relying on TypeScript-internal node flags. */
function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports a default modifier paired with an exported declaration. */
function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** Rejects parser recovery so generated paths never reflect malformed syntax. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Selects the JSX-aware parser grammar from one supported source suffix. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return extension === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}
