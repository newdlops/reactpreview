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
  const ownerName = readFunctionOwnerName(functionLike) ?? exportName;
  if (!isReactOverlayComponentName(ownerName)) return undefined;
  const propsType = functionLike.parameters[0]?.type ?? contextualPropsType;
  if (propsType === undefined) return undefined;
  const localTypes = collectLocalObjectTypes(sourceFile, resolvedObjectTypes);
  const candidates = new Set<string>();
  collectVisibilityTypeProps(propsType, localTypes, new Set(), candidates);
  return candidates.size === 1 ? [...candidates][0] : undefined;
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

/** Walks local aliases, intersections, transparent wrappers, and exact Pick key literals. */
function collectVisibilityTypeProps(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  activeNames: Set<string>,
  candidates: Set<string>,
): void {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isIntersectionTypeNode(unwrapped)) {
    for (const member of unwrapped.types) {
      collectVisibilityTypeProps(member, localTypes, activeNames, candidates);
    }
    return;
  }
  if (ts.isTypeLiteralNode(unwrapped)) {
    collectVisibilityMembers(unwrapped.members, candidates);
    return;
  }
  if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) return;
  const name = unwrapped.typeName.text;
  if (name === 'Pick' && unwrapped.typeArguments?.[1] !== undefined) {
    collectVisibilityLiteralKeys(unwrapped.typeArguments[1], candidates);
    return;
  }
  if (
    (name === 'PropsWithChildren' ||
      name === 'Readonly' ||
      name === 'Required' ||
      name === 'Partial') &&
    unwrapped.typeArguments?.[0] !== undefined
  ) {
    collectVisibilityTypeProps(unwrapped.typeArguments[0], localTypes, activeNames, candidates);
    return;
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || activeNames.has(name)) return;
  activeNames.add(name);
  if (ts.isTypeAliasDeclaration(declaration)) {
    collectVisibilityTypeProps(declaration.type, localTypes, activeNames, candidates);
  } else {
    collectVisibilityMembers(declaration.members, candidates);
  }
  activeNames.delete(name);
}

/** Adds visibility-shaped property signatures from an inline object or interface declaration. */
function collectVisibilityMembers(
  members: ts.NodeArray<ts.TypeElement>,
  candidates: Set<string>,
): void {
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const propertyName = readPropertyName(member.name);
    if (propertyName !== undefined && isReactOverlayVisibilityPropName(propertyName)) {
      candidates.add(propertyName);
    }
  }
}

/** Adds only string-literal Pick keys that independently name positive overlay visibility. */
function collectVisibilityLiteralKeys(typeNode: ts.TypeNode, candidates: Set<string>): void {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isUnionTypeNode(unwrapped)) {
    for (const member of unwrapped.types) collectVisibilityLiteralKeys(member, candidates);
    return;
  }
  if (!ts.isLiteralTypeNode(unwrapped) || !ts.isStringLiteral(unwrapped.literal)) return;
  const propertyName = unwrapped.literal.text;
  if (isReactOverlayVisibilityPropName(propertyName)) candidates.add(propertyName);
}

/** Returns a static object property name without evaluating computed expressions. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}
