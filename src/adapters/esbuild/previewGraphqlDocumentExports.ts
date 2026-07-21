/**
 * Proves which local runtime exports are GraphQL documents rather than React components.
 *
 * Page Inspector chooses its target before the bundled module can apply React's runtime element
 * checks. GraphQL documents are ordinary objects with component-shaped export names, so a module
 * that exports a hook plus `SOME_MUTATION` could otherwise select the document as its only target.
 * This analyzer stays syntax-only and fail-closed: it excludes a value only when a GraphQL tag,
 * factory import, DocumentNode type, or literal `kind: "Document"` supplies direct evidence.
 */
import ts from 'typescript';

/** Imported call/tag identities whose module origin proves that they construct GraphQL documents. */
interface GraphqlFactoryBindings {
  /** Identifiers callable or usable as a template tag without namespace qualification. */
  readonly direct: ReadonlySet<string>;
  /** Namespace imports whose `gql` member constructs a document. */
  readonly gqlNamespaces: ReadonlySet<string>;
  /** Namespace imports whose `graphql` member is specifically a document tag. */
  readonly graphqlNamespaces: ReadonlySet<string>;
}

/** Packages whose `gql` export is a document template/factory rather than an arbitrary helper. */
const GRAPHQL_GQL_FACTORY_MODULE_PATTERN =
  /^(?:@apollo\/client(?:\/.*)?|@graphql-tools\/(?:graphql-tag-pluck|utils)(?:\/.*)?|@urql\/core(?:\/.*)?|graphql-request(?:\/.*)?|graphql-tag(?:\/.*)?|graphql\.macro|urql(?:\/.*)?)$/u;

/** Packages whose `graphql` export is specifically a compile-time document tag. */
const GRAPHQL_NAMED_FACTORY_MODULE_PATTERN =
  /^(?:babel-plugin-relay\/macro|gatsby(?:\/.*)?|react-relay(?:\/.*)?|relay-runtime(?:\/.*)?)$/u;

/** Local code-generator entrypoints conventionally exporting `gql` or `graphql` helpers. */
const GENERATED_GRAPHQL_HELPER_MODULE_PATTERN =
  /(?:^|\/)(?:__generated__|generated|gql|graphql)(?:\/index)?(?:\.[cm]?[jt]sx?)?$/u;

/** Local variable evidence retained while aliases are resolved to a fixed point. */
interface GraphqlValueDeclaration {
  /** Initializer that may directly construct or alias a document. */
  readonly initializer?: ts.Expression;
  /** Source-local binding later mapped to one or more public export names. */
  readonly localName: string;
  /** Explicit annotation that may name DocumentNode even when the initializer is opaque. */
  readonly type?: ts.TypeNode;
}

/**
 * Returns public export names whose runtime values are statically proven GraphQL documents.
 *
 * A component named with an acronym remains eligible: spelling alone is never exclusion evidence.
 * Local aliases are followed without resolving imports or evaluating user code. External re-exports
 * remain unknown and are therefore left for the existing runtime React-value guard.
 *
 * @param sourceFile Parsed selected-file snapshot with parent links available.
 * @returns Frozen set containing named and/or `default` public document exports.
 */
export function collectPreviewGraphqlDocumentExportNames(
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const bindings = collectGraphqlFactoryBindings(sourceFile);
  const declarations = collectGraphqlValueDeclarations(sourceFile);
  const documentLocalNames = resolveGraphqlDocumentLocalNames(declarations, bindings);
  const exportNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && documentLocalNames.has(declaration.name.text)) {
          exportNames.add(declaration.name.text);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (isGraphqlDocumentExpression(statement.expression, bindings, documentLocalNames)) {
        exportNames.add('default');
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || ts.isNamespaceExport(clause)) continue;
    for (const element of clause.elements) {
      const localName = (element.propertyName ?? element.name).text;
      if (documentLocalNames.has(localName)) {
        exportNames.add(element.name.text);
      }
    }
  }

  return Object.freeze(exportNames);
}

/** Collects top-level identifier variables without treating nested callback values as exports. */
function collectGraphqlValueDeclarations(
  sourceFile: ts.SourceFile,
): readonly GraphqlValueDeclaration[] {
  const declarations: GraphqlValueDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      declarations.push({
        ...(declaration.initializer === undefined ? {} : { initializer: declaration.initializer }),
        localName: declaration.name.text,
        ...(declaration.type === undefined ? {} : { type: declaration.type }),
      });
    }
  }
  return declarations;
}

/**
 * Resolves direct document constructors and simple local aliases with a bounded fixed-point pass.
 * Each successful iteration adds at least one declaration, so declaration count is a strict bound.
 */
function resolveGraphqlDocumentLocalNames(
  declarations: readonly GraphqlValueDeclaration[],
  bindings: GraphqlFactoryBindings,
): ReadonlySet<string> {
  const documentNames = new Set<string>();
  let remainingPasses = declarations.length;
  while (remainingPasses > 0) {
    remainingPasses -= 1;
    let changed = false;
    for (const declaration of declarations) {
      if (documentNames.has(declaration.localName)) continue;
      if (
        isGraphqlDocumentType(declaration.type) ||
        (declaration.initializer !== undefined &&
          isGraphqlDocumentExpression(declaration.initializer, bindings, documentNames))
      ) {
        documentNames.add(declaration.localName);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return documentNames;
}

/** Collects exact GraphQL factory aliases only when the import source proves document semantics. */
function collectGraphqlFactoryBindings(sourceFile: ts.SourceFile): GraphqlFactoryBindings {
  const direct = new Set<string>();
  const gqlNamespaces = new Set<string>();
  const graphqlNamespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined && isProvenGraphqlFactoryImport(moduleSpecifier, 'default')) {
      direct.add(clause.name.text);
    }
    const namedBindings = clause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      if (isProvenGraphqlFactoryImport(moduleSpecifier, 'gql')) {
        gqlNamespaces.add(namedBindings.name.text);
      }
      if (isProvenGraphqlFactoryImport(moduleSpecifier, 'graphql')) {
        graphqlNamespaces.add(namedBindings.name.text);
      }
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = (element.propertyName ?? element.name).text;
      if (isProvenGraphqlFactoryImport(moduleSpecifier, importedName)) {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, gqlNamespaces, graphqlNamespaces };
}

/** Proves one imported spelling against the narrower semantics of its originating module. */
function isProvenGraphqlFactoryImport(moduleSpecifier: string, importedName: string): boolean {
  const normalized = normalizeGraphqlFactoryModuleSpecifier(moduleSpecifier);
  if (importedName === 'default') return /^graphql-tag(?:\/.*)?$/u.test(normalized);
  if (GENERATED_GRAPHQL_HELPER_MODULE_PATTERN.test(normalized)) {
    return importedName === 'gql' || importedName === 'graphql';
  }
  if (importedName === 'gql') return GRAPHQL_GQL_FACTORY_MODULE_PATTERN.test(normalized);
  return importedName === 'graphql' && GRAPHQL_NAMED_FACTORY_MODULE_PATTERN.test(normalized);
}

/** Normalizes package and relative helper spellings without resolving or reading another module. */
function normalizeGraphqlFactoryModuleSpecifier(moduleSpecifier: string): string {
  return moduleSpecifier.replaceAll('\\', '/').replace(/^\.\//u, '').toLowerCase();
}

/** Recognizes GraphQL tags, factory calls, local aliases, and generated document literals. */
function isGraphqlDocumentExpression(
  expression: ts.Expression,
  bindings: GraphqlFactoryBindings,
  documentLocalNames: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return documentLocalNames.has(current.text);
  if (ts.isTaggedTemplateExpression(current)) {
    return isGraphqlFactoryExpression(current.tag, bindings);
  }
  if (ts.isCallExpression(current)) {
    return isGraphqlFactoryExpression(current.expression, bindings);
  }
  return ts.isObjectLiteralExpression(current) && hasDocumentKindProperty(current);
}

/** Proves a direct or namespace-qualified GraphQL document constructor identity. */
function isGraphqlFactoryExpression(
  expression: ts.Expression,
  bindings: GraphqlFactoryBindings,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return bindings.direct.has(current.text);
  if (!ts.isPropertyAccessExpression(current)) return false;
  const owner = unwrapExpression(current.expression);
  return (
    ts.isIdentifier(owner) &&
    ((current.name.text === 'gql' && bindings.gqlNamespaces.has(owner.text)) ||
      (current.name.text === 'graphql' && bindings.graphqlNamespaces.has(owner.text)))
  );
}

/** Detects generated GraphQL AST objects without depending on a particular code generator. */
function hasDocumentKindProperty(expression: ts.ObjectLiteralExpression): boolean {
  return expression.properties.some((property) => {
    if (!ts.isPropertyAssignment(property) || readPropertyName(property.name) !== 'kind') {
      return false;
    }
    const value = unwrapExpression(property.initializer);
    if (ts.isStringLiteralLike(value)) return value.text === 'Document';
    return ts.isPropertyAccessExpression(value) && value.name.text.toLowerCase() === 'document';
  });
}

/** Accepts only a top-level DocumentNode type; nested prop/generic member types are not value proof. */
function isGraphqlDocumentType(typeNode: ts.TypeNode | undefined): boolean {
  if (typeNode === undefined) return false;
  const direct = unwrapGraphqlDocumentType(typeNode);
  if (!ts.isTypeReferenceNode(direct)) return false;
  const name = readEntityNameTail(direct.typeName);
  return name === 'DocumentNode' || name === 'TypedDocumentNode';
}

/** Removes syntax-only parentheses while deliberately retaining unions, intersections, and generics. */
function unwrapGraphqlDocumentType(typeNode: ts.TypeNode): ts.TypeNode {
  let current = typeNode;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  return current;
}

/** Reads the final identifier from a qualified type such as `graphql.DocumentNode`. */
function readEntityNameTail(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : name.right.text;
}

/** Reads ordinary object-literal property spellings without evaluating computed expressions. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Removes syntax-only wrappers while retaining the expression's runtime identity. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Reports a top-level `export` modifier through TypeScript's public modifier helpers. */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}
