/** Converts authored TypeScript declarations into bounded mutable prop requirements. */
import ts from 'typescript';
import { isReactComponentTypeSyntax } from './reactComponentTypeSyntax';
import {
  BLOCKED_PROPERTY_NAMES,
  type InferenceState,
  type LocalObjectType,
  MAX_INFERRED_DEPTH,
  type MutableShapeNode,
} from './reactPropInferenceModel';
import {
  createMutableNode,
  mergeMutableShapeRequirement,
  readMutablePathNode,
  requirePath,
} from './reactPropInferenceShape';
import {
  readBindingPropertyName,
  readLiteralUnionValues,
  readLiteralValue,
  readPropertyName,
} from './reactPropInferenceSyntax';

/**
 * Gives a declared closed union its first member and every member as a candidate, so generated
 * rows rotate through real values. InboundTab's `status: InboundStatus` was dropped and
 * `STATUS_DOT[r.status]` / `STATUS_LABEL[r.status]` rendered "undefined" and an empty label,
 * though both maps are keyed by exactly those members.
 */
export function addLiteralUnionRequirement(
  state: InferenceState,
  path_: readonly string[],
  literals: readonly string[] | readonly number[],
): void {
  const [first] = literals;
  if (first === undefined) return;
  const kind = typeof first === 'number' ? 'number' : 'string';
  requirePath(state, path_, kind, 'type', first);
  const node = readMutablePathNode(state, path_);
  if (node?.kind !== kind) return;
  const candidateValues = (node.candidateValues ??= []);
  for (const literal of literals) {
    if (candidateValues.length >= 8) break;
    if (!candidateValues.some((candidate) => Object.is(candidate, literal))) {
      candidateValues.push(literal);
    }
  }
}

/** Adds syntax-resolvable required prop types while imported/any contracts remain usage-driven. */
export function addTypedParameterRequirements(
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
export function readObjectTypeMembers(
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
  const reference =
    ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)
      ? { name: unwrapped.typeName.text, typeArguments: unwrapped.typeArguments }
      : ts.isExpressionWithTypeArguments(unwrapped) && ts.isIdentifier(unwrapped.expression)
        ? { name: unwrapped.expression.text, typeArguments: unwrapped.typeArguments }
        : undefined;
  if (reference === undefined) return undefined;
  const { name } = reference;
  const substituted = substitutions.get(name);
  if (substituted !== undefined) {
    return readObjectTypeMembers(substituted, localTypes, resolutionStack, substitutions);
  }
  if (
    (name === 'PropsWithChildren' || name === 'Readonly' || name === 'Required') &&
    reference.typeArguments?.[0] !== undefined
  ) {
    return readObjectTypeMembers(
      reference.typeArguments[0],
      localTypes,
      resolutionStack,
      substitutions,
    );
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || resolutionStack.has(name)) return undefined;
  resolutionStack.add(name);
  try {
    const typeParameters = declaration.typeParameters;
    const typeArguments = reference.typeArguments;
    if (typeParameters !== undefined && typeParameters.length !== typeArguments?.length) {
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
                readObjectTypeMembers(
                  heritageType,
                  localTypes,
                  resolutionStack,
                  nestedSubstitutions,
                ) ?? [],
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
export function addTypeRequirement(
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
  if (isReactElementValueTypeSyntax(unwrapped)) {
    requirePath(state, path_, 'element', 'type');
    return;
  }
  if (isReactComponentTypeSyntax(unwrapped)) {
    requirePath(state, path_, 'component', 'type');
    return;
  }
  if (ts.isLiteralTypeNode(unwrapped)) {
    const literal = readLiteralValue(unwrapped.literal);
    if (typeof literal === 'string') requirePath(state, path_, 'string', 'type', literal, true);
    else if (typeof literal === 'number')
      requirePath(state, path_, 'number', 'type', literal, true);
    else if (typeof literal === 'boolean')
      requirePath(state, path_, 'boolean', 'type', literal, true);
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
    const literals = readLiteralUnionValues(members);
    if (literals !== undefined) {
      addLiteralUnionRequirement(state, path_, literals);
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
  if (ts.isMappedTypeNode(unwrapped)) {
    /* A mapped key domain is no safer to populate than Record, but the mapped value still proves
     * that the required prop itself is an object. Materialize an empty plain object so consumers
     * such as Object.entries(config) remain executable without inventing application keys. */
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

/** Recognizes required React-node values without resolving or executing a library type graph. */
export function isReactElementValueTypeSyntax(typeNode: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(typeNode)) {
    const rightmostName = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : typeNode.typeName.right.text;
    if (rightmostName === 'ReactElement' || rightmostName === 'ReactNode') return true;
    if (
      rightmostName === 'Element' &&
      ts.isQualifiedName(typeNode.typeName) &&
      ts.isIdentifier(typeNode.typeName.left) &&
      typeNode.typeName.left.text === 'JSX'
    ) {
      return true;
    }
  }
  if (!ts.isIndexedAccessTypeNode(typeNode) || !ts.isLiteralTypeNode(typeNode.indexType)) {
    return false;
  }
  const key = readLiteralValue(typeNode.indexType.literal);
  if (key !== 'children' || !ts.isTypeReferenceNode(typeNode.objectType)) return false;
  const rightmostName = ts.isIdentifier(typeNode.objectType.typeName)
    ? typeNode.objectType.typeName.text
    : typeNode.objectType.typeName.right.text;
  return (
    rightmostName === 'ComponentProps' ||
    rightmostName === 'ComponentPropsWithRef' ||
    rightmostName === 'ComponentPropsWithoutRef'
  );
}

/** Admits only canonical GraphQL document imports, including a directly named local alias. */
export function collectGraphqlDocumentTypeNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
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

/** Finds only the named GraphQL Code Generator fragment-masking identity helper import. */
export function collectGraphqlFragmentUnmaskBindings(
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !/(?:^|\/)graphql-codegen\/fragment-masking$/u.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      if ((binding.propertyName ?? binding.name).text === 'getFragmentData') {
        names.add(binding.name.text);
      }
    }
  }
  return names;
}

/** Creates a minimum executable GraphQL document from canonical type evidence and response shape. */
export function addGraphqlDocumentRequirement(
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
  if (document?.kind !== 'graphql-document') return;
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
export function readGraphqlOperation(path_: readonly string[]): 'mutation' | 'query' | undefined {
  const name = path_.at(-1) ?? '';
  const query = /query/iu.test(name);
  const mutation = /mutation/iu.test(name);
  return query === mutation ? undefined : query ? 'query' : 'mutation';
}

/**
 * Selects the first authored branch only when every object branch proves a shared literal tag.
 *
 * A discriminated union has multiple valid runtime representatives but omitting the whole prop is
 * never one of them. Requiring a common literal field keeps this choice bounded and avoids
 * guessing through ordinary unions whose branches carry unrelated application semantics.
 */
export function selectDiscriminatedObjectUnionMember(
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
export function isNullishTypeNode(node: ts.TypeNode): boolean {
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
export function isPreviewCollectionTypeNode(node: ts.TypeNode): boolean {
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
export function readPreviewCollectionElementType(node: ts.TypeNode): ts.TypeNode | undefined {
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
export function selectPreviewCollectionItemType(
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
  )
    return typeNode;
  return objectMember;
}

/** Builds one fail-closed, parse-only element shape for a statically known collection. */
export function createTypeShape(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  activeNames: Set<string>,
  depthOffset: number,
): MutableShapeNode | undefined {
  // The detached item root consumes one level of the caller's already-used aggregate corridor;
  // it must not restart at an apparent top-level `value` path for nested collection evidence.
  if (state.nodeCount >= state.nodeLimit) return undefined;
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
export function setArrayItemRequirement(
  state: InferenceState,
  path_: readonly string[],
  items: MutableShapeNode | undefined,
): void {
  let node = state.root;
  for (const name of path_) {
    const next = node.children.get(name);
    if (next === undefined) return;
    node = next;
  }
  if (node.kind !== 'array') return;
  /*
   * Object readers prove structured rows. A string/number root is equally strong only when the
   * callback rendered it or direct iterable destructuring consumes a type-proven item. Retaining
   * those cases prevents both invalid Smart-fill records and empty arrays that defeat `[first]`.
   */
  if (
    items === undefined ||
    (items.kind !== 'object' &&
      !(
        (items.renderedValue === true || (node.itemConsumed === true && items.source === 'type')) &&
        (items.kind === 'number' || items.kind === 'string')
      ))
  ) {
    return;
  }
  if (node.items === undefined) node.items = items;
  else mergeMutableShapeRequirement(node.items, items);
}
