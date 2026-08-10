/**
 * Collects react-beautiful-dnd consumer and provider evidence without evaluating application code.
 * Direct aliases and namespace property access are recognized only for the exact public package.
 */
import ts from 'typescript';

const PACKAGE_SPECIFIER = 'react-beautiful-dnd';

/** Context requirements and ownership aggregated across target-reachable workspace modules. */
export interface PreviewDragDropRequirement {
  /** Whether a Draggable or Droppable requires the package's application context. */
  readonly consumesDragDropContext: boolean;
  /** Whether a Draggable additionally requires a nearest Droppable context. */
  readonly consumesDroppableContext: boolean;
  /** Whether reached code already creates the application-level drag context. */
  readonly ownsDragDropContext: boolean;
  /** Whether reached code already creates a droppable context. */
  readonly ownsDroppableContext: boolean;
}

type DragDropApi = 'DragDropContext' | 'Draggable' | 'Droppable';

interface DragDropImportInventory {
  readonly bindings: ReadonlyMap<string, DragDropApi>;
  readonly namespaces: ReadonlySet<string>;
}

const EMPTY_REQUIREMENT: PreviewDragDropRequirement = Object.freeze({
  consumesDragDropContext: false,
  consumesDroppableContext: false,
  ownsDragDropContext: false,
  ownsDroppableContext: false,
});

/** Returns bounded syntax evidence for public react-beautiful-dnd component usage. */
export function collectPreviewDragDropRequirement(
  sourcePath: string,
  sourceText: string,
): PreviewDragDropRequirement {
  if (!sourceText.includes(PACKAGE_SPECIFIER)) return EMPTY_REQUIREMENT;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return EMPTY_REQUIREMENT;
  const inventory = collectImports(sourceFile);
  const usedApis = new Set<DragDropApi>();

  /** Records only runtime references, excluding the import declaration's binding identifiers. */
  function visit(node: ts.Node): void {
    if (
      ts.isIdentifier(node) &&
      !isImportBindingIdentifier(node) &&
      inventory.bindings.has(node.text)
    ) {
      const importedApi = inventory.bindings.get(node.text);
      if (importedApi !== undefined) usedApis.add(importedApi);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      inventory.namespaces.has(node.expression.text) &&
      isDragDropApi(node.name.text)
    ) {
      usedApis.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  const usesDraggable = usedApis.has('Draggable');
  const usesDroppable = usedApis.has('Droppable');
  return Object.freeze({
    consumesDragDropContext: usesDraggable || usesDroppable,
    consumesDroppableContext: usesDraggable,
    ownsDragDropContext: usedApis.has('DragDropContext'),
    ownsDroppableContext: usesDroppable,
  });
}

/** Retains runtime named aliases and namespace imports from only the exact package. */
function collectImports(sourceFile: ts.SourceFile): DragDropImportInventory {
  const bindings = new Map<string, DragDropApi>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== PACKAGE_SPECIFIER
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const namedBindings = clause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = (element.propertyName ?? element.name).text;
      if (isDragDropApi(importedName)) bindings.set(element.name.text, importedName);
    }
  }
  return { bindings, namespaces };
}

/** Narrows public package member names to the context-relevant component set. */
function isDragDropApi(value: string): value is DragDropApi {
  return value === 'DragDropContext' || value === 'Draggable' || value === 'Droppable';
}

/** Prevents an unused import declaration alone from creating runtime evidence. */
function isImportBindingIdentifier(identifier: ts.Identifier): boolean {
  return ts.isImportSpecifier(identifier.parent) || ts.isNamespaceImport(identifier.parent);
}

/** Selects JSX-aware parsing for JavaScript while retaining TypeScript syntax when authored. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const normalizedPath = sourcePath.toLowerCase();
  if (normalizedPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.mts') ||
    normalizedPath.endsWith('.cts')
  ) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JSX;
}

/** Rejects malformed sources instead of deriving partial provider evidence. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
