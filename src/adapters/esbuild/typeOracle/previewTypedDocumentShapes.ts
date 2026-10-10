/**
 * Finds the typed GraphQL documents one module can reach and their declared result shapes.
 *
 * A module either declares a document (`const Q: typeof Q_DOCUMENT = gql\`…\``) or hands one to a
 * query helper (`useQuery(Q)`, `createQueryRenderer(Q)`, `{ query: Q }`). Both name a module-scope
 * binding whose declared type is a typed document, so the transform can register the document
 * object with its result shape at the end of the module, where every such binding is initialized.
 * The operation name is read from the document at runtime, so no GraphQL parsing happens here.
 */
import ts from 'typescript';
import {
  createPreviewTypedPayloadShape,
  readPreviewTypedDocumentResultType,
  type PreviewTypedPayloadShape,
} from './previewTypedPayloadShape';

/** One module-scope typed document binding and the shape of its declared result. */
export interface PreviewTypedDocumentShape {
  /** Module-scope identifier that evaluates to the document object. */
  readonly identifier: string;
  readonly shape: PreviewTypedPayloadShape;
}

/** Cheap text evidence that a module can reach a GraphQL document at all. */
export const PREVIEW_GRAPHQL_DOCUMENT_TEXT_PATTERN =
  /\b(?:gql|graphql)\b|Document\b|DOCUMENT\b|QUERY\b|MUTATION\b|Query\b|Mutation\b|Subscription\b/u;

/** Generated schema modules reference thousands of documents; registering them all would bloat. */
const MAX_DOCUMENTS_PER_MODULE = 32;
const MAX_CANDIDATES_PER_MODULE = 2_000;

/**
 * Collects typed document bindings declared or used by one module.
 *
 * @param checker Checker of the program that owns `sourceFile`.
 * @param sourceFile Program-owned parse of the module being transformed.
 * @returns Distinct bindings with structured result shapes; empty for generated schema modules.
 */
export function collectPreviewTypedDocumentShapes(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): readonly PreviewTypedDocumentShape[] {
  const candidates = collectCandidateIdentifiers(sourceFile);
  if (candidates.length > MAX_CANDIDATES_PER_MODULE) return [];
  const documents: PreviewTypedDocumentShape[] = [];
  const seen = new Set<ts.Symbol>();
  for (const identifier of candidates) {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol === undefined || seen.has(symbol) || !isModuleScopeBinding(symbol, sourceFile)) {
      continue;
    }
    seen.add(symbol);
    const resultType = readPreviewTypedDocumentResultType(
      checker,
      checker.getTypeAtLocation(identifier),
      identifier,
    );
    const shape =
      resultType === undefined
        ? undefined
        : createPreviewTypedPayloadShape(checker, resultType, identifier);
    if (shape === undefined) continue;
    if (documents.length >= MAX_DOCUMENTS_PER_MODULE) return [];
    documents.push({ identifier: identifier.text, shape });
  }
  return documents;
}

/**
 * Top-level `const` names plus identifiers passed as call arguments or property values, the two
 * places a query helper receives its document.
 */
function collectCandidateIdentifiers(sourceFile: ts.SourceFile): readonly ts.Identifier[] {
  const identifiers: ts.Identifier[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || isAmbient(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) identifiers.push(declaration.name);
    }
  }
  const visit = (node: ts.Node): void => {
    if (identifiers.length > MAX_CANDIDATES_PER_MODULE) return;
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) {
        if (ts.isIdentifier(argument)) identifiers.push(argument);
      }
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.initializer)) {
      identifiers.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifiers;
}

/** Accepts imports and top-level declarations of this module, which exist at module end. */
function isModuleScopeBinding(symbol: ts.Symbol, sourceFile: ts.SourceFile): boolean {
  const [declaration] = symbol.declarations ?? [];
  if (declaration?.getSourceFile() !== sourceFile) return false;
  if (
    ts.isImportSpecifier(declaration) ||
    ts.isImportClause(declaration) ||
    ts.isNamespaceImport(declaration)
  ) {
    return !isTypeOnlyImport(declaration);
  }
  return (
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    ts.isVariableStatement(declaration.parent.parent) &&
    declaration.parent.parent.parent === sourceFile &&
    !isAmbient(declaration.parent.parent)
  );
}

/** `declare const` has no runtime binding to register. */
function isAmbient(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) === true
  );
}

/** Type-only imports have no runtime binding to register. */
function isTypeOnlyImport(
  declaration: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport,
): boolean {
  if (ts.isImportSpecifier(declaration)) {
    return declaration.isTypeOnly || isTypeOnlyClause(declaration.parent.parent);
  }
  return isTypeOnlyClause(ts.isImportClause(declaration) ? declaration : declaration.parent);
}

/** Reports `import type …`, which TypeScript now records as the clause's phase modifier. */
function isTypeOnlyClause(clause: ts.ImportClause): boolean {
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
}
