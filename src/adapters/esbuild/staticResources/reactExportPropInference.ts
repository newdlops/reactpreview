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
  'array' | 'boolean' | 'component' | 'function' | 'null' | 'number' | 'object' | 'string';

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
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const module = options.resolveImport(statement.moduleSpecifier.text, sourcePath);
    const moduleBytes = module === undefined ? 0 : Buffer.byteLength(module.sourceText, 'utf8');
    if (module === undefined || moduleBytes > MAX_IMPORTED_TYPE_BYTES ||
      ++budget.modules > MAX_IMPORTED_TYPE_MODULES || (budget.bytes += moduleBytes) > MAX_IMPORTED_TYPE_BYTES) continue;
    const importedFile = ts.createSourceFile(
      module.sourcePath, module.sourceText, ts.ScriptTarget.Latest, true, readScriptKind(module.sourcePath),
    );
    if (hasParseDiagnostics(importedFile)) continue;
    for (const binding of bindings.elements) {
      const importedName = (binding.propertyName ?? binding.name).text;
      const declaration = resolveExportedObjectType(
        importedName, importedFile, module.sourcePath, options, new Set([sourcePath]), budget,
      );
      if (declaration !== undefined && !localTypes.has(binding.name.text)) {
        localTypes.set(binding.name.text, declaration);
      }
    }
  }
  return localTypes;
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
): LocalObjectType | undefined {
  if (depth > 8 || activePaths.has(sourcePath)) return undefined;
  activePaths.add(sourcePath);
  const local = collectLocalObjectTypes(sourceFile).get(name);
  if (local !== undefined && hasExportModifier(local)) return local;
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
    if (module === undefined || moduleBytes > MAX_IMPORTED_TYPE_BYTES ||
      ++budget.modules > MAX_IMPORTED_TYPE_MODULES || (budget.bytes += moduleBytes) > MAX_IMPORTED_TYPE_BYTES) continue;
    const next = ts.createSourceFile(module.sourcePath, module.sourceText, ts.ScriptTarget.Latest, true,
      readScriptKind(module.sourcePath));
    const resolved = hasParseDiagnostics(next) ? undefined : resolveExportedObjectType(
      (binding.propertyName ?? binding.name).text, next, module.sourcePath, options, activePaths, budget, depth + 1,
    );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
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
  addOverlayVisibilityRequirement(component, state, sourceFile);
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
): readonly ts.TypeElement[] | undefined {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isTypeLiteralNode(unwrapped)) return unwrapped.members;
  if (ts.isIntersectionTypeNode(unwrapped)) {
    const members = unwrapped.types.flatMap(
      (member) => readObjectTypeMembers(member, localTypes, resolutionStack) ?? [],
    );
    return members.length > 0 ? members : undefined;
  }
  if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) return undefined;
  const name = unwrapped.typeName.text;
  if (
    (name === 'PropsWithChildren' || name === 'Readonly' || name === 'Required') &&
    unwrapped.typeArguments?.[0] !== undefined
  ) {
    return readObjectTypeMembers(unwrapped.typeArguments[0], localTypes, resolutionStack);
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || resolutionStack.has(name)) return undefined;
  resolutionStack.add(name);
  try {
  const members = ts.isInterfaceDeclaration(declaration)
    ? [
        ...declaration.members,
        ...(declaration.heritageClauses ?? []).flatMap((clause) =>
          clause.types.flatMap(
            (heritageType) => readObjectTypeMembers(heritageType, localTypes, resolutionStack) ?? [],
          ),
        ),
      ]
    : readObjectTypeMembers(declaration.type, localTypes, resolutionStack);
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
    requirePath(state, path_, 'boolean', 'type');
    return;
  }
  if (ts.isArrayTypeNode(unwrapped) || ts.isTupleTypeNode(unwrapped)) {
    requirePath(state, path_, 'array', 'type');
    const elementType = ts.isArrayTypeNode(unwrapped) ? unwrapped.elementType : unwrapped.elements[0];
    if (elementType !== undefined) {
      setArrayItemRequirement(
        state,
        path_,
        createTypeShape(elementType, localTypes, state, sourceFile, activeNames, depthOffset + path_.length),
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
    const members = unwrapped.types.filter(
      (candidate) => !isNullishTypeNode(candidate),
    );
    if (members.length === 1)
      {
        const member = members[0];
        if (member === undefined) return;
      addTypeRequirement(path_, member, localTypes, state, sourceFile, activeNames, depthOffset);
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
        createTypeShape(elementType, localTypes, state, sourceFile, activeNames, depthOffset + path_.length),
      );
    }
    return;
  }
  const activeName = ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)
    ? unwrapped.typeName.text
    : undefined;
  if (activeName !== undefined && activeNames.has(activeName)) return;
  if (activeName !== undefined) activeNames.add(activeName);
  try {
    const members = readObjectTypeMembers(unwrapped, localTypes, new Set());
    if (members === undefined) return;
    requirePath(state, path_, 'object', 'type');
    for (const member of members) {
      if (!ts.isPropertySignature(member) || member.questionToken !== undefined || member.type === undefined) continue;
      const propertyName = readPropertyName(member.name);
      if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
      addTypeRequirement([...path_, propertyName], member.type, localTypes, state, sourceFile, activeNames, depthOffset);
    }
  } finally {
    if (activeName !== undefined) activeNames.delete(activeName);
  }
}

/** Removes only nullish union branches; other alternatives remain ambiguous and fail closed. */
function isNullishTypeNode(node: ts.TypeNode): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword) return true;
  return ts.isLiteralTypeNode(node) && (
    node.literal.kind === ts.SyntaxKind.NullKeyword ||
    node.literal.kind === ts.SyntaxKind.UndefinedKeyword
  );
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
  const root = createMutableNode('object', 'type');
  const previousRoot = state.root;
  state.root = root;
  try {
    addTypeRequirement(['value'], typeNode, localTypes, state, sourceFile, activeNames, depthOffset);
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
    requirePath(state, path_, semantic?.kind ?? 'boolean', 'usage', semantic?.value ?? false);
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
      ...(node.kind === 'object' ? { properties: Object.freeze(properties) } : {}),
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
    if ((statement.typeParameters?.length ?? 0) > 0) continue;
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
