/**
 * Isolates failures from React effects that do not own the component's rendered output.
 *
 * Page Inspector executes real application shells, where analytics, websocket registration,
 * persistence, and native bridges commonly run from effects. A synchronous failure in one such
 * effect makes React unmount an otherwise valid page. This transform wraps only callbacks passed
 * to effect hooks proven to come from React; component render functions and arbitrary project
 * callbacks remain untouched.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';

const EFFECT_HOOK_NAMES = new Set(['useEffect', 'useInsertionEffect', 'useLayoutEffect']);
const PREVIEW_INSPECTOR_API =
  "globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')]";

/** Imported React bindings that prove an effect call without evaluating the source module. */
interface PreviewReactEffectBindings {
  /** Aliased named imports mapped back to their canonical hook names. */
  readonly direct: ReadonlyMap<string, string>;
  /** Default and namespace imports whose effect members are safe to recognize. */
  readonly namespaces: ReadonlySet<string>;
}

/**
 * Wraps React effect callbacks with the Page Inspector's render-only side-effect boundary.
 *
 * @param sourcePath Absolute project source used for parser mode, diagnostics, and stable ids.
 * @param sourceText Source after other preview compatibility transforms have completed.
 * @returns Equivalent source whose proven React effects cannot unmount a static page in Auto mode.
 */
export function instrumentPreviewReactEffects(sourcePath: string, sourceText: string): string {
  if (
    !sourceText.includes('useEffect') &&
    !sourceText.includes('useInsertionEffect') &&
    !sourceText.includes('useLayoutEffect')
  ) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  const bindings = collectPreviewReactEffectBindings(sourceFile);
  if (bindings.direct.size === 0 && bindings.namespaces.size === 0) return sourceText;
  const replacements: PreviewSourceReplacement[] = [];

  /** Visits effect calls while keeping nested JSX and ordinary callbacks inert. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const hookName = readPreviewReactEffectHookName(node.expression, bindings);
      const callback = node.arguments[0];
      if (hookName !== undefined && callback !== undefined && !ts.isSpreadElement(callback)) {
        replacements.push(
          createPreviewReactEffectCallbackReplacement(
            sourcePath,
            sourceText,
            sourceFile,
            node,
            callback,
            hookName,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return applyPreviewSourceReplacements(
    sourceText,
    selectCompatiblePreviewSourceReplacements(replacements),
  );
}

/** Collects named, namespace, and default bindings from the exact `react` module only. */
function collectPreviewReactEffectBindings(sourceFile: ts.SourceFile): PreviewReactEffectBindings {
  const direct = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) namespaces.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (EFFECT_HOOK_NAMES.has(importedName)) direct.set(element.name.text, importedName);
      }
    }
  }
  return { direct, namespaces };
}

/** Maps a call target to a React effect hook only through a proven import binding. */
function readPreviewReactEffectHookName(
  expression: ts.LeftHandSideExpression,
  bindings: PreviewReactEffectBindings,
): string | undefined {
  if (ts.isIdentifier(expression)) return bindings.direct.get(expression.text);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text) &&
    EFFECT_HOOK_NAMES.has(expression.name.text)
  ) {
    return expression.name.text;
  }
  return undefined;
}

/** Creates one callback-only rewrite so effect dependency arrays stay byte-for-byte authored. */
function createPreviewReactEffectCallbackReplacement(
  sourcePath: string,
  sourceText: string,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callback: ts.Expression,
  hookName: string,
): PreviewSourceReplacement {
  const start = callback.getStart(sourceFile);
  const location = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
  const metadata = {
    column: location.character + 1,
    evidence: 'React effect failure does not own rendered page output',
    hookName,
    id: createPreviewReactEffectIdentity(sourcePath, hookName, call.getStart(sourceFile)),
    line: location.line + 1,
    ownerName: readPreviewReactEffectOwnerName(call),
    requiredPaths: [],
    sourcePath: path.normalize(sourcePath),
  };
  const originalCallback = sourceText.slice(start, callback.end);
  const apiBinding = '__reactPreviewEffectApi';
  const argumentBinding = '__reactPreviewEffectArguments';
  return {
    end: callback.end,
    replacement: [
      `((...${argumentBinding}) => {`,
      `const ${apiBinding} = ${PREVIEW_INSPECTOR_API};`,
      `return typeof ${apiBinding}?.resolveRuntimeEffect === 'function'`,
      `? ${apiBinding}.resolveRuntimeEffect(() => (${originalCallback})(...${argumentBinding}), ${JSON.stringify(metadata)})`,
      `: (${originalCallback})(...${argumentBinding});`,
      '})',
    ].join(' '),
    start,
  };
}

/** Finds the nearest authored function/declaration label for Inspector console attribution. */
function readPreviewReactEffectOwnerName(node: ts.Node): string | undefined {
  let current = node.parent;
  while (current !== node.getSourceFile()) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) &&
      current.name !== undefined
    ) {
      return current.name.text;
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer !== undefined
    ) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current)) {
      return readStaticPropertyName(current.name);
    }
    current = current.parent;
  }
  return undefined;
}

/** Reads ordinary method names without evaluating computed project expressions. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Produces a stable source-semantic identity retained across hot rebuilds. */
function createPreviewReactEffectIdentity(
  sourcePath: string,
  hookName: string,
  occurrenceStart: number,
): string {
  return createHash('sha256')
    .update(JSON.stringify([path.normalize(sourcePath), hookName, occurrenceStart]))
    .digest('hex')
    .slice(0, 24);
}

/** Selects TSX/JSX parsing only for extensions that admit JSX syntax. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
