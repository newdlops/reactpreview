/**
 * Collects Formik context consumer and provider evidence from one target-reachable source module.
 * The analysis reads authored imports and namespace property access only; it never loads a form,
 * executes validation, or assumes that a similarly named project component belongs to Formik.
 */
import ts from 'typescript';

/** Formik APIs that read an existing Formik context during render or lifecycle work. */
const FORM_CONTEXT_CONSUMERS = new Set([
  'ErrorMessage',
  'FastField',
  'Field',
  'FieldArray',
  'Form',
  'FormikConsumer',
  'connect',
  'useField',
  'useFormikContext',
]);

/** Formik APIs that create or explicitly publish a complete context boundary. */
const FORM_CONTEXT_PROVIDERS = new Set(['Formik', 'FormikProvider', 'withFormik']);

/** Independent graph evidence aggregated across every transformed workspace source module. */
export interface PreviewFormikRequirement {
  /** Whether this module uses a Formik API that requires an ancestor Formik context. */
  readonly consumesFormik: boolean;
  /** Whether this module imports or accesses an API capable of owning the Formik boundary. */
  readonly ownsFormik: boolean;
}

/** Local bindings required to classify direct and namespace-based Formik usage. */
interface FormikImportInventory {
  /** Local runtime names bound to APIs that consume Formik context. */
  readonly consumerBindings: ReadonlySet<string>;
  /** Local names bound to the complete Formik module namespace. */
  readonly namespaces: ReadonlySet<string>;
  /** Whether a provider API was imported directly. */
  readonly ownsFormik: boolean;
}

/**
 * Reports Formik consumer/provider evidence without resolving package files or evaluating source.
 * Named aliases are tracked by their local binding and namespace imports are counted only when a
 * known property is actually accessed, keeping type-only and unrelated imports inert.
 *
 * @param sourcePath Source identity used to select JavaScript, JSX, TypeScript, or TSX grammar.
 * @param sourceText Current source contents already selected by the workspace overlay.
 * @returns Bounded context requirement flags for the generated Formik bridge.
 */
export function collectPreviewFormikRequirement(
  sourcePath: string,
  sourceText: string,
): PreviewFormikRequirement {
  if (!sourceText.includes('formik')) {
    return { consumesFormik: false, ownsFormik: false };
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return { consumesFormik: false, ownsFormik: false };
  }
  const inventory = collectFormikImports(sourceFile);
  const usage = collectFormikUsage(sourceFile, inventory);
  return {
    consumesFormik: usage.consumesFormik,
    ownsFormik: inventory.ownsFormik || usage.ownsFormik,
  };
}

/** Collects non-erased bindings imported from the exact browser-facing Formik package. */
function collectFormikImports(sourceFile: ts.SourceFile): FormikImportInventory {
  const consumerBindings = new Set<string>();
  const namespaces = new Set<string>();
  let ownsFormik = false;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'formik'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
      continue;
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      const importedName = (element.propertyName ?? element.name).text;
      if (FORM_CONTEXT_CONSUMERS.has(importedName)) {
        consumerBindings.add(element.name.text);
      }
      if (FORM_CONTEXT_PROVIDERS.has(importedName)) {
        ownsFormik = true;
      }
    }
  }
  return { consumerBindings, namespaces, ownsFormik };
}

/** Finds direct binding use and known namespace property access in the parsed module. */
function collectFormikUsage(
  sourceFile: ts.SourceFile,
  inventory: FormikImportInventory,
): PreviewFormikRequirement {
  const usage = { consumesFormik: false, ownsFormik: false };

  /** Visits runtime syntax conservatively without resolving aliases beyond static imports. */
  function visit(node: ts.Node): void {
    if (
      ts.isIdentifier(node) &&
      inventory.consumerBindings.has(node.text) &&
      !isImportBindingIdentifier(node)
    ) {
      usage.consumesFormik = true;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      inventory.namespaces.has(node.expression.text)
    ) {
      usage.consumesFormik ||= FORM_CONTEXT_CONSUMERS.has(node.name.text);
      usage.ownsFormik ||= FORM_CONTEXT_PROVIDERS.has(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usage;
}

/** Excludes the declaration-side identifier inside one named import specifier. */
function isImportBindingIdentifier(identifier: ts.Identifier): boolean {
  return ts.isImportSpecifier(identifier.parent) || ts.isNamespaceImport(identifier.parent);
}

/** Selects a parser grammar from the source suffix without reading project configuration. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const normalizedPath = sourcePath.toLowerCase();
  if (normalizedPath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.mts') ||
    normalizedPath.endsWith('.cts')
  ) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JSX;
}

/** Treats parser recovery as unsupported so malformed source cannot create a false requirement. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
