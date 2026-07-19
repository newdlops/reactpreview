/**
 * Infers bounded preview-only prop values from exported component syntax and direct value usage.
 * The analysis never resolves or executes project modules. It materializes only containers needed
 * to evaluate proven property paths plus neutral primitives/functions justified by local types or
 * operations, leaving final unknown leaves absent so ordinary falsey UI branches remain natural.
 */
import path from 'node:path';
import ts from 'typescript';
import { isReactComponentTypeSyntax } from './reactComponentTypeSyntax';

const MAX_COMPONENT_EXPORTS = 32;
const MAX_INFERRED_DEPTH = 10;
const MAX_INFERRED_NODES = 192;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'key', 'prototype', 'ref']);
const ARRAY_METHOD_NAMES = new Set([
  'at',
  'concat',
  'every',
  'filter',
  'find',
  'findIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'map',
  'pop',
  'push',
  'reduce',
  'reduceRight',
  'reverse',
  'shift',
  'slice',
  'some',
  'sort',
  'splice',
  'unshift',
]);
const STRING_METHOD_NAMES = new Set([
  'charAt',
  'endsWith',
  'includes',
  'indexOf',
  'match',
  'replace',
  'slice',
  'split',
  'startsWith',
  'substring',
  'toLowerCase',
  'toUpperCase',
  'trim',
]);

/** Neutral value categories understood by the generated browser materializer. */
export type PreviewInferredPropKind =
  'array' | 'boolean' | 'component' | 'function' | 'number' | 'object' | 'string';

/** JSON-safe recursive shape emitted into target and Inspector bridge descriptors. */
export interface PreviewInferredPropShape {
  readonly kind: PreviewInferredPropKind;
  readonly properties?: Readonly<Record<string, PreviewInferredPropShape>>;
  readonly value?: boolean | number | string;
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

/** Mutable internal node that retains merge provenance before deterministic serialization. */
interface MutableShapeNode {
  children: Map<string, MutableShapeNode>;
  kind: PreviewInferredPropKind;
  source: PreviewInferredPropProvenance['source'];
  value?: boolean | number | string;
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

/** Bounded mutable inference state for one exported function. */
interface InferenceState {
  readonly aliases: Map<string, PropPathBinding>;
  readonly functionLike: ExportedFunctionLike;
  nodeCount: number;
  readonly root: MutableShapeNode;
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
  const localTypes = collectLocalObjectTypes(sourceFile);
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
  if (state.root.children.size === 0) {
    return undefined;
  }
  return freezeInference(state.root);
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
  activeNames: Set<string>,
): readonly ts.TypeElement[] | undefined {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isTypeLiteralNode(unwrapped)) return unwrapped.members;
  if (ts.isIntersectionTypeNode(unwrapped)) {
    const members = unwrapped.types.flatMap(
      (member) => readObjectTypeMembers(member, localTypes, activeNames) ?? [],
    );
    return members.length > 0 ? members : undefined;
  }
  if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) return undefined;
  const name = unwrapped.typeName.text;
  if (
    (name === 'PropsWithChildren' || name === 'Readonly' || name === 'Required') &&
    unwrapped.typeArguments?.[0] !== undefined
  ) {
    return readObjectTypeMembers(unwrapped.typeArguments[0], localTypes, activeNames);
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || activeNames.has(name)) return undefined;
  activeNames.add(name);
  const members = ts.isInterfaceDeclaration(declaration)
    ? [
        ...declaration.members,
        ...(declaration.heritageClauses ?? []).flatMap((clause) =>
          clause.types.flatMap(
            (heritageType) => readObjectTypeMembers(heritageType, localTypes, activeNames) ?? [],
          ),
        ),
      ]
    : readObjectTypeMembers(declaration.type, localTypes, activeNames);
  activeNames.delete(name);
  return members;
}

/** Converts a safe local type into one neutral shape requirement, recursively when object-shaped. */
function addTypeRequirement(
  path_: readonly string[],
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  activeNames: Set<string>,
): void {
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
    const member = unwrapped.types.find(
      (candidate) =>
        candidate.kind !== ts.SyntaxKind.NullKeyword &&
        candidate.kind !== ts.SyntaxKind.UndefinedKeyword &&
        candidate.kind !== ts.SyntaxKind.VoidKeyword,
    );
    if (member !== undefined)
      addTypeRequirement(path_, member, localTypes, state, sourceFile, activeNames);
    return;
  }
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray')
  ) {
    requirePath(state, path_, 'array', 'type');
    return;
  }
  const members = readObjectTypeMembers(unwrapped, localTypes, activeNames);
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
    );
  }
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
    requirePath(state, path_, 'boolean', 'usage', false);
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
  }
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
  value?: boolean | number | string,
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
  value?: boolean | number | string,
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

/** Collects direct/default/local-clause exported function identities without evaluating HOCs. */
function collectExportedComponentFunctions(
  sourceFile: ts.SourceFile,
): readonly ExportedComponentFunction[] {
  const functionsByName = new Map<string, ComponentFunctionCandidate>();
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
      if (statement.name !== undefined) functionsByName.set(statement.name.text, candidate);
      if (hasExportModifier(statement)) {
        add(hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''), candidate);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const functionLike = readFunctionExpression(declaration.initializer);
        if (functionLike === undefined) continue;
        const contextualPropsType = readReactComponentPropsType(declaration.type);
        const candidate: ComponentFunctionCandidate = {
          functionLike,
          ...(contextualPropsType === undefined ? {} : { contextualPropsType }),
        };
        functionsByName.set(declaration.name.text, candidate);
        if (hasExportModifier(statement)) add(declaration.name.text, candidate);
      }
    } else if (ts.isExportAssignment(statement)) {
      add(
        'default',
        ts.isIdentifier(statement.expression)
          ? functionsByName.get(statement.expression.text)
          : createFunctionCandidate(readFunctionExpression(statement.expression)),
      );
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        add(element.name.text, functionsByName.get(localName));
      }
    }
  }
  return selected;
}

/** Wraps one optional function body for export-assignment collection without unsafe assertions. */
function createFunctionCandidate(
  functionLike: ExportedFunctionLike | undefined,
): ComponentFunctionCandidate | undefined {
  return functionLike === undefined ? undefined : { functionLike };
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

/** Reads a direct function or a bounded common React HOC argument containing that function. */
function readFunctionExpression(
  expression: ts.Expression | undefined,
): ExportedFunctionLike | undefined {
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return current;
  const call = ts.isTaggedTemplateExpression(current) ? unwrapExpression(current.tag) : current;
  if (!ts.isCallExpression(call) || call.arguments.length === 0) return undefined;
  for (const argument of call.arguments) {
    const candidate = unwrapExpression(argument);
    if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) return candidate;
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
