/**
 * Marks props declared as built-in keyed collections so generated values are real Maps and Sets.
 *
 * Prop inference is syntax-only, so `promoWeeks?: Map<number, string>` became whatever its uses
 * proved: `promoWeeks.get(week)` made an object with a `get` function, while the optional call
 * `promoWeeks?.has(week)` and `promoWeeks.size` left no trace. A target mounted with generated
 * props then threw "promoWeeks?.has is not a function". The declaration already says the value is
 * a Map, so the inferred object node is marked and the browser materializer creates an empty one.
 */
import ts from 'typescript';

/** Built-in keyed collection created for a marked prop. */
export type PreviewPropCollectionKind = 'map' | 'set';

/** Global collection type names and the collection each one is materialized as. */
const COLLECTION_KIND_BY_TYPE_NAME: ReadonlyMap<string, PreviewPropCollectionKind> = new Map([
  ['Map', 'map'],
  ['ReadonlyMap', 'map'],
  ['WeakMap', 'map'],
  ['Set', 'set'],
  ['ReadonlySet', 'set'],
  ['WeakSet', 'set'],
]);

/** The part of an inferred shape node this module reads and marks. */
interface CollectionShapeNode {
  readonly children: ReadonlyMap<string, CollectionShapeNode>;
  collection?: PreviewPropCollectionKind;
  readonly kind: string;
}

/** Marks each top-level prop node whose declared type is a built-in Map or Set. */
export function annotatePreviewPropCollections(
  root: CollectionShapeNode,
  members: readonly ts.TypeElement[],
  sourceFile: ts.SourceFile,
): void {
  for (const member of members) {
    if (!ts.isPropertySignature(member) || member.type === undefined) continue;
    const name = readMemberName(member.name);
    const node = name === undefined ? undefined : root.children.get(name);
    if (node?.kind !== 'object') continue;
    const collection = readPreviewPropCollectionKind(member.type, sourceFile);
    if (collection !== undefined) node.collection = collection;
  }
}

/** Reads `Map<…>`, `Set<…> | undefined` and similar declarations; undefined for anything else. */
export function readPreviewPropCollectionKind(
  typeNode: ts.TypeNode,
  sourceFile: ts.SourceFile,
): PreviewPropCollectionKind | undefined {
  let current = typeNode;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  if (ts.isUnionTypeNode(current)) {
    const present = current.types.filter((member) => !isNullishTypeNode(member));
    return present.length === 1 && present[0] !== undefined
      ? readPreviewPropCollectionKind(present[0], sourceFile)
      : undefined;
  }
  if (!ts.isTypeReferenceNode(current) || !ts.isIdentifier(current.typeName)) return undefined;
  const collection = COLLECTION_KIND_BY_TYPE_NAME.get(current.typeName.text);
  return collection === undefined || declaresTopLevelName(sourceFile, current.typeName.text)
    ? undefined
    : collection;
}

/** Recognizes `undefined`, `null`, and `void` members of an optional prop union. */
function isNullishTypeNode(node: ts.TypeNode): boolean {
  return (
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword ||
    (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

/** Reports a module that declares or imports its own binding with a built-in collection's name. */
function declaresTopLevelName(sourceFile: ts.SourceFile, name: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return true;
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
      );
    }
    if (!ts.isImportDeclaration(statement)) return false;
    const clause = statement.importClause;
    if (clause?.name?.text === name) return true;
    const bindings = clause?.namedBindings;
    if (bindings === undefined) return false;
    return ts.isNamespaceImport(bindings)
      ? bindings.name.text === name
      : bindings.elements.some((element) => element.name.text === name);
  });
}

/** Reads an identifier or string-literal member name. */
function readMemberName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}
