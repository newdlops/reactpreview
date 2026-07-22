/**
 * Collects literal dynamic-import requests without resolving or evaluating their target modules.
 *
 * Page roots often reach a small helper that loads one registry, while generated registries can
 * declare hundreds of lazy branches. Keeping this syntax inventory separate from the esbuild
 * plugin lets the corridor policy distinguish those two cases with a bounded, reusable analysis.
 */
import path from 'node:path';
import ts from 'typescript';

const MAX_LITERAL_DYNAMIC_IMPORTS = 4096;

/** Immutable result of one bounded source-file scan. */
export interface PreviewDynamicImportInventory {
  /** False when an incomplete editor snapshot prevents a trustworthy closed-world inventory. */
  readonly reliable: boolean;
  /** Literal module requests in stable source order, with duplicates removed. */
  readonly specifiers: readonly string[];
  /** Whether the source declared more imports than the safety budget retained. */
  readonly truncated: boolean;
}

/**
 * Finds `import("literal")` calls while ignoring computed requests and ordinary function calls.
 *
 * @param sourcePath File identity used only to choose TypeScript or JSX parser grammar.
 * @param sourceText Authored source that is never executed by this analyzer.
 * @returns Stable literal requests, or an empty result when the source cannot be parsed safely.
 */
export function collectPreviewDynamicImportInventory(
  sourcePath: string,
  sourceText: string,
): PreviewDynamicImportInventory {
  if (!sourceText.includes('import')) return EMPTY_DYNAMIC_IMPORT_INVENTORY;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return UNRELIABLE_DYNAMIC_IMPORT_INVENTORY;

  const specifiers = new Set<string>();
  let truncated = false;
  const visit = (node: ts.Node): void => {
    if (truncated) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const request = node.arguments[0];
      if (
        node.arguments.length === 1 &&
        request !== undefined &&
        (ts.isStringLiteral(request) || ts.isNoSubstitutionTemplateLiteral(request))
      ) {
        if (!specifiers.has(request.text) && specifiers.size >= MAX_LITERAL_DYNAMIC_IMPORTS) {
          truncated = true;
          return;
        }
        specifiers.add(request.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return Object.freeze({
    reliable: true,
    specifiers: Object.freeze([...specifiers]),
    truncated,
  });
}

/** Shared immutable empty result avoids allocations for the common static-module path. */
const EMPTY_DYNAMIC_IMPORT_INVENTORY: PreviewDynamicImportInventory = Object.freeze({
  reliable: true,
  specifiers: Object.freeze([]),
  truncated: false,
});

/** Parse failure is explicitly unreliable so corridor pruning fails closed on partial edits. */
const UNRELIABLE_DYNAMIC_IMPORT_INVENTORY: PreviewDynamicImportInventory = Object.freeze({
  reliable: false,
  specifiers: Object.freeze([]),
  truncated: true,
});

/** Selects parser grammar without reading or executing project compiler configuration. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Rejects incomplete syntax so a partial editor snapshot cannot widen the retained graph. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
