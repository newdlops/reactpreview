/**
 * Recovers one overlay visibility prop from syntax-resolvable component prop type aliases.
 *
 * Application contracts can be supplied by the caller after bounded static import resolution. A
 * utility declaration such as `Pick<ModalProps, "show">` also exposes the exact public key without
 * resolving or executing that module. The selected component must have an overlay-shaped name, and
 * multiple possible keys remain deliberately ambiguous.
 */
import ts from 'typescript';
import {
  isReactOverlayComponentName,
  isReactOverlayVisibilityPropName,
} from './reactOverlayVisibilityInference';

/** Function bodies accepted by the direct exported-component prop analyzer. */
type OverlayFunctionLike = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Statically resolved object declarations that can route a parameter to one visibility key. */
type LocalObjectType = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
type VisibilityTypePathCatalog = Map<string, readonly string[]>;
type VisibilityTypeBindings = ReadonlyMap<string, ts.TypeNode>;
const MAX_VISIBILITY_TYPE_DEPTH = 12;

/**
 * Infers one positive visibility prop from a component's local type corridor.
 *
 * @param functionLike Exact same-file function reached through the exported component.
 * @param exportName Public export label used when the function is anonymous.
 * @param contextualPropsType Variable-level React component props annotation, when present.
 * @param sourceFile Parsed selected source containing local aliases.
 * @param resolvedObjectTypes Bounded local/imported declarations already resolved by the caller.
 * @returns One exact visibility key, or `undefined` when source evidence is absent or ambiguous.
 */
export function inferReactOverlayVisibilityTypeProp(
  functionLike: OverlayFunctionLike,
  exportName: string,
  contextualPropsType: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  resolvedObjectTypes?: ReadonlyMap<string, LocalObjectType>,
): string | undefined {
  const path = inferReactOverlayVisibilityTypePath(
    functionLike,
    exportName,
    contextualPropsType,
    sourceFile,
    resolvedObjectTypes,
  );
  return path?.length === 1 ? path[0] : undefined;
}

/**
 * Infers one positive visibility path, including a proven carrier such as `modalProps.show`.
 * Nested traversal is restricted to overlay-named prop contracts so an unrelated `settings.show`
 * field cannot make a directly previewed modal choose application state on the user's behalf.
 */
export function inferReactOverlayVisibilityTypePath(
  functionLike: OverlayFunctionLike,
  exportName: string,
  contextualPropsType: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  resolvedObjectTypes?: ReadonlyMap<string, LocalObjectType>,
): readonly string[] | undefined {
  const ownerName = readFunctionOwnerName(functionLike) ?? exportName;
  if (!isReactOverlayComponentName(ownerName)) return undefined;
  const propsType = functionLike.parameters[0]?.type ?? contextualPropsType;
  if (propsType === undefined) return undefined;
  const localTypes = collectLocalObjectTypes(sourceFile, resolvedObjectTypes);
  const candidates: VisibilityTypePathCatalog = new Map();
  collectVisibilityTypePaths(propsType, localTypes, new Set(), [], candidates, 0, new Map());
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

/** Builds a bounded identity map for only interface and type-alias declarations in this module. */
function collectLocalObjectTypes(
  sourceFile: ts.SourceFile,
  resolvedObjectTypes?: ReadonlyMap<string, LocalObjectType>,
): Map<string, LocalObjectType> {
  const declarations = new Map<string, LocalObjectType>(resolvedObjectTypes);
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
    }
  }
  return declarations;
}

/** Reads a stable authored owner label without following imported or computed wrappers. */
function readFunctionOwnerName(functionLike: OverlayFunctionLike): string | undefined {
  if (
    (ts.isFunctionDeclaration(functionLike) || ts.isFunctionExpression(functionLike)) &&
    functionLike.name !== undefined
  ) {
    return functionLike.name.text;
  }
  const parent = functionLike.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

/** Walks aliases, intersections, utility types, and bounded nested overlay prop carriers. */
function collectVisibilityTypePaths(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  activeNames: Set<string>,
  prefix: readonly string[],
  candidates: VisibilityTypePathCatalog,
  depth: number,
  typeBindings: VisibilityTypeBindings,
): void {
  if (depth > MAX_VISIBILITY_TYPE_DEPTH) return;
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isIntersectionTypeNode(unwrapped)) {
    for (const member of unwrapped.types) {
      collectVisibilityTypePaths(
        member,
        localTypes,
        activeNames,
        prefix,
        candidates,
        depth + 1,
        typeBindings,
      );
    }
    return;
  }
  if (ts.isUnionTypeNode(unwrapped)) {
    for (const member of unwrapped.types) {
      collectVisibilityTypePaths(
        member,
        localTypes,
        activeNames,
        prefix,
        candidates,
        depth + 1,
        typeBindings,
      );
    }
    return;
  }
  if (ts.isConditionalTypeNode(unwrapped)) {
    /*
     * Generic overlay wrappers commonly select one of several public prop contracts. Walking both
     * result branches is safe because the caller accepts a visibility key only when the complete
     * candidate set remains singular; branches that disagree on `show` versus `open` therefore
     * stay deliberately unresolved.
     */
    collectVisibilityTypePaths(
      unwrapped.trueType,
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      typeBindings,
    );
    collectVisibilityTypePaths(
      unwrapped.falseType,
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      typeBindings,
    );
    return;
  }
  if (ts.isTypeLiteralNode(unwrapped)) {
    collectVisibilityMemberPaths(
      unwrapped.members,
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      typeBindings,
    );
    return;
  }
  if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) return;
  const name = unwrapped.typeName.text;
  if (
    (name === 'Pick' || name === 'Omit') &&
    unwrapped.typeArguments?.[0] !== undefined &&
    unwrapped.typeArguments[1] !== undefined
  ) {
    const selectedKeys = collectVisibilitySelectionKeys(unwrapped.typeArguments[1]);
    const inherited: VisibilityTypePathCatalog = new Map();
    collectVisibilityTypePaths(
      unwrapped.typeArguments[0],
      localTypes,
      new Set(activeNames),
      prefix,
      inherited,
      depth + 1,
      typeBindings,
    );
    for (const path of inherited.values()) {
      const firstRelativeSegment = path[prefix.length];
      if (
        firstRelativeSegment !== undefined &&
        (name === 'Pick'
          ? selectedKeys.has(firstRelativeSegment)
          : !selectedKeys.has(firstRelativeSegment))
      ) {
        addVisibilityTypePath(candidates, path);
      }
    }
    return;
  }
  if (
    (name === 'PropsWithChildren' ||
      name === 'Readonly' ||
      name === 'Required' ||
      name === 'Partial') &&
    unwrapped.typeArguments?.[0] !== undefined
  ) {
    collectVisibilityTypePaths(
      unwrapped.typeArguments[0],
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      typeBindings,
    );
    return;
  }
  const boundType = typeBindings.get(name);
  if (boundType !== undefined) {
    const bindingKey = `type-parameter:${name}`;
    if (activeNames.has(bindingKey)) return;
    activeNames.add(bindingKey);
    collectVisibilityTypePaths(
      boundType,
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      typeBindings,
    );
    activeNames.delete(bindingKey);
    return;
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || activeNames.has(name)) return;
  activeNames.add(name);
  const declarationBindings = new Map(typeBindings);
  for (const parameter of declaration.typeParameters ?? []) {
    declarationBindings.delete(parameter.name.text);
  }
  for (const [index, parameter] of (declaration.typeParameters ?? []).entries()) {
    const argument = unwrapped.typeArguments?.[index] ?? parameter.default;
    if (argument !== undefined) declarationBindings.set(parameter.name.text, argument);
  }
  if (ts.isTypeAliasDeclaration(declaration)) {
    collectVisibilityTypePaths(
      declaration.type,
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      declarationBindings,
    );
  } else {
    collectVisibilityMemberPaths(
      declaration.members,
      localTypes,
      activeNames,
      prefix,
      candidates,
      depth + 1,
      declarationBindings,
    );
  }
  activeNames.delete(name);
}

/** Adds direct visibility fields and descends only through an overlay-named props carrier. */
function collectVisibilityMemberPaths(
  members: ts.NodeArray<ts.TypeElement>,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  activeNames: Set<string>,
  prefix: readonly string[],
  candidates: VisibilityTypePathCatalog,
  depth: number,
  typeBindings: VisibilityTypeBindings,
): void {
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const propertyName = readPropertyName(member.name);
    if (propertyName === undefined) continue;
    const path = [...prefix, propertyName];
    if (isReactOverlayVisibilityPropName(propertyName)) {
      addVisibilityTypePath(candidates, path);
    } else if (
      member.type !== undefined &&
      isNestedOverlayVisibilityCarrierName(propertyName)
    ) {
      collectVisibilityTypePaths(
        member.type,
        localTypes,
        activeNames,
        path,
        candidates,
        depth + 1,
        typeBindings,
      );
    }
  }
}

/** Collects exact string-literal keys accepted by Pick/Omit without widening their domain. */
function collectVisibilitySelectionKeys(typeNode: ts.TypeNode): ReadonlySet<string> {
  const keys = new Set<string>();
  const collect = (candidate: ts.TypeNode): void => {
    const unwrapped = ts.isParenthesizedTypeNode(candidate) ? candidate.type : candidate;
    if (ts.isUnionTypeNode(unwrapped)) {
      for (const member of unwrapped.types) collect(member);
      return;
    }
    if (ts.isLiteralTypeNode(unwrapped) && ts.isStringLiteral(unwrapped.literal)) {
      keys.add(unwrapped.literal.text);
    }
  };
  collect(typeNode);
  return keys;
}

/** De-duplicates one exact prop path without relying on application-controlled object keys. */
function addVisibilityTypePath(
  candidates: VisibilityTypePathCatalog,
  path: readonly string[],
): void {
  candidates.set(path.join('\0'), Object.freeze([...path]));
}

/** Restricts nested inference to explicit `modalProps`/`dialogOptions`-style public contracts. */
function isNestedOverlayVisibilityCarrierName(value: string): boolean {
  const ownerName = value.replace(/(?:props|properties|options|config|state)$/iu, '');
  return ownerName !== value && isReactOverlayComponentName(ownerName);
}

/** Returns a static object property name without evaluating computed expressions. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}
