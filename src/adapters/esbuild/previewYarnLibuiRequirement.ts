/** Collects exact @yarnpkg/libui ministore consumer and Application provider usage. */
import ts from 'typescript';

const APPLICATION_SPECIFIER = '@yarnpkg/libui/sources/components/Application';
const MINISTORE_SPECIFIER = '@yarnpkg/libui/sources/hooks/useMinistore';

/** Static provider demand registered by each reached workspace source module. */
export interface PreviewYarnLibuiRequirement {
  readonly consumesMinistore: boolean;
  readonly ownsMinistore: boolean;
}

/** Local bindings established by the two exact libui runtime modules. */
interface LibuiImportInventory {
  readonly consumerBindings: ReadonlySet<string>;
  readonly consumerNamespaces: ReadonlySet<string>;
  readonly providerBindings: ReadonlySet<string>;
  readonly providerNamespaces: ReadonlySet<string>;
}

/**
 * Proves reached hook/provider use through value imports and their actual local references.
 * Lookalike package names, type imports, and unused bindings remain inert.
 */
export function collectPreviewYarnLibuiRequirement(
  sourcePath: string,
  sourceText: string,
): PreviewYarnLibuiRequirement {
  if (!sourceText.includes('@yarnpkg/libui')) return emptyRequirement();
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return emptyRequirement();
  const imports = collectLibuiImports(sourceFile);
  return collectLibuiUsage(sourceFile, imports);
}

/** Records named aliases and namespace imports from only the exact public source entries. */
function collectLibuiImports(sourceFile: ts.SourceFile): LibuiImportInventory {
  const consumerBindings = new Set<string>();
  const consumerNamespaces = new Set<string>();
  const providerBindings = new Set<string>();
  const providerNamespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause === undefined ||
      statement.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (specifier !== MINISTORE_SPECIFIER && specifier !== APPLICATION_SPECIFIER) continue;
    const namedBindings = statement.importClause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      (specifier === MINISTORE_SPECIFIER ? consumerNamespaces : providerNamespaces).add(
        namedBindings.name.text,
      );
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = (element.propertyName ?? element.name).text;
      if (specifier === MINISTORE_SPECIFIER && importedName === 'useMinistore') {
        consumerBindings.add(element.name.text);
      } else if (specifier === APPLICATION_SPECIFIER && importedName === 'Application') {
        providerBindings.add(element.name.text);
      }
    }
  }
  return { consumerBindings, consumerNamespaces, providerBindings, providerNamespaces };
}

/** Finds runtime references while excluding the declaration side of import bindings. */
function collectLibuiUsage(
  sourceFile: ts.SourceFile,
  imports: LibuiImportInventory,
): PreviewYarnLibuiRequirement {
  const requirement = { consumesMinistore: false, ownsMinistore: false };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isImportBinding(node)) {
      requirement.consumesMinistore ||= imports.consumerBindings.has(node.text);
      requirement.ownsMinistore ||= imports.providerBindings.has(node.text);
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      requirement.consumesMinistore ||=
        imports.consumerNamespaces.has(node.expression.text) && node.name.text === 'useMinistore';
      requirement.ownsMinistore ||=
        imports.providerNamespaces.has(node.expression.text) && node.name.text === 'Application';
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return requirement;
}

/** Excludes all local names that are still part of an import declaration. */
function isImportBinding(identifier: ts.Identifier): boolean {
  return (
    ts.isImportSpecifier(identifier.parent) ||
    ts.isNamespaceImport(identifier.parent) ||
    ts.isImportClause(identifier.parent)
  );
}

/** Chooses the permissive JSX grammar for JavaScript and the typed grammar for TS sources. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const normalizedPath = sourcePath.toLowerCase();
  return /\.(?:ts|mts|cts)$/u.test(normalizedPath)
    ? ts.ScriptKind.TS
    : normalizedPath.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.JSX;
}

/** Returns a fresh mutable result so the visitor can aggregate booleans without casts. */
function emptyRequirement(): PreviewYarnLibuiRequirement {
  return { consumesMinistore: false, ownsMinistore: false };
}
