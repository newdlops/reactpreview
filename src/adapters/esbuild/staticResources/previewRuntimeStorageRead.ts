/**
 * Recognizes render code that parses a value persisted in Web Storage.
 *
 * ```tsx
 * const session = JSON.parse(localStorage.getItem('session') ?? 'null') as StoredSession;
 * return <h1>{session.user.name}</h1>;
 * ```
 *
 * A fresh preview origin has nothing stored, so the parse yields `null` and the first member read
 * crashes even though the component works for a signed-in user. The parse result is a render input
 * exactly like a hook result, so it joins the hook fallback boundary: local reads of the parsed
 * value describe the fallback, a stored value is always kept, and turning Auto values off restores
 * the authored `null`. Only `JSON.parse` calls whose argument reads `localStorage.getItem` or
 * `sessionStorage.getItem` qualify; module-level reads stay outside, because the caller admits
 * only calls inside a component or hook.
 */
import ts from 'typescript';

/** Diagnostic module identity of a storage read; never a real import specifier. */
export const PREVIEW_RUNTIME_STORAGE_READ_MODULE = 'web-storage';

const STORAGE_NAMES = new Set(['localStorage', 'sessionStorage']);
const STORAGE_GLOBAL_OWNERS = new Set(['globalThis', 'self', 'window']);
const STORAGE_READ_TEXT_PATTERN = /\b(?:local|session)Storage\s*\.\s*getItem\s*\(/u;
const MAX_ARGUMENT_NODES = 64;

/**
 * Cheap text gate before parsing a module that may have no hook imports at all.
 *
 * @param sourceText Module source text.
 * @returns True when the text contains a Web Storage `getItem` call.
 */
export function hasPreviewRuntimeStorageReadText(sourceText: string): boolean {
  return STORAGE_READ_TEXT_PATTERN.test(sourceText);
}

/**
 * Returns the diagnostic binding of a `JSON.parse` call over a Web Storage read.
 *
 * @param call Candidate call expression.
 * @returns Hook-like binding, or `undefined` for any other call.
 */
export function readPreviewRuntimeStorageReadBinding(
  call: ts.CallExpression,
): Readonly<{ hookName: string; moduleSpecifier: string }> | undefined {
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'parse' ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== 'JSON'
  ) {
    return undefined;
  }
  const [argument] = call.arguments;
  const read = argument === undefined ? undefined : findStorageRead(argument);
  // The key is part of the name: fallback contracts are shared by name, and two keys differ.
  return read === undefined
    ? undefined
    : {
        hookName: `JSON.parse(${read.storage}.getItem(${read.key}))`,
        moduleSpecifier: PREVIEW_RUNTIME_STORAGE_READ_MODULE,
      };
}

/** Storage and key text of the `getItem` call that appears inside the parsed argument. */
function findStorageRead(
  argument: ts.Expression,
): Readonly<{ key: string; storage: string }> | undefined {
  let found: Readonly<{ key: string; storage: string }> | undefined;
  let nodes = 0;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || nodes >= MAX_ARGUMENT_NODES || ts.isFunctionLike(node)) return;
    nodes += 1;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'getItem'
    ) {
      const storage = readStorageName(node.expression.expression);
      if (storage !== undefined) {
        const [key] = node.arguments;
        found = {
          key: key !== undefined && ts.isStringLiteralLike(key) ? JSON.stringify(key.text) : '…',
          storage,
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(argument);
  return found;
}

/** `localStorage`, `window.localStorage`, or `globalThis.sessionStorage`. */
function readStorageName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return STORAGE_NAMES.has(expression.text) ? expression.text : undefined;
  }
  return ts.isPropertyAccessExpression(expression) &&
    STORAGE_NAMES.has(expression.name.text) &&
    ts.isIdentifier(expression.expression) &&
    STORAGE_GLOBAL_OWNERS.has(expression.expression.text)
    ? expression.name.text
    : undefined;
}
