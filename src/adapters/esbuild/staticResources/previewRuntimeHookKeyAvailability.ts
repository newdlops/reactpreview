/**
 * Proves whether a computed fallback key is visible and initialized at the hook call.
 * Source-only catalogs belong to immutable parser functions and never retain application values.
 * Later locals and bindings in a sibling/descendant block cannot be lifted into an eager factory.
 */
import ts from 'typescript';
import { isPreviewRuntimeFunction, type PreviewRuntimeFunction } from './previewRuntimeHookSyntax';

/** One runtime declaration whose scope and initialization must precede the generated factory. */
interface KeyBinding {
  /** Earliest source position after which this binding's initializer has completed. */
  readonly availableAfter: number;
  /** Lexical scope that must also contain the hook-result binding. */
  readonly scope: ts.Node;
}

/** Complete bounded declaration facts from one unchanged function syntax tree. */
interface KeyBindingCatalog {
  /** Exact local spellings; duplicate declarations remain ambiguous. */
  readonly bindings: ReadonlyMap<string, readonly KeyBinding[]>;
  /** False when the syntax budget prevented proving that all local declarations were seen. */
  readonly complete: boolean;
}

const MAXIMUM_BINDING_NODES = 8_192;
const catalogs = new WeakMap<PreviewRuntimeFunction, KeyBindingCatalog>();

/**
 * Keeps only keys already available where an eager hook fallback will be evaluated.
 * Parameters and prior visible locals are admitted. Names absent from the complete function
 * catalog retain the existing module/outer-binding policy; no module or initializer is executed.
 */
export function isPreviewRuntimeHookKeyAvailable(
  key: ts.Identifier,
  hookBinding: ts.Identifier,
  owner: PreviewRuntimeFunction,
): boolean {
  let catalog = catalogs.get(owner);
  if (catalog === undefined) {
    catalog = collectKeyBindings(owner);
    catalogs.set(owner, catalog);
  }
  if (!catalog.complete) return false;
  const matches = catalog.bindings.get(key.text);
  if (matches === undefined) return true;
  const binding = matches.length === 1 ? matches[0] : undefined;
  if (binding === undefined || binding.availableAfter >= hookBinding.getStart()) return false;
  for (let scope: ts.Node = hookBinding; ; scope = scope.parent) {
    if (scope === binding.scope) return true;
    if (scope === owner) break;
  }
  return false;
}

/** Indexes runtime declarations once, excluding bodies of nested functions and classes. */
function collectKeyBindings(owner: PreviewRuntimeFunction): KeyBindingCatalog {
  const bindings = new Map<string, KeyBinding[]>();
  const append = (name: ts.BindingName, availableAfter: number, scope: ts.Node): void => {
    if (ts.isIdentifier(name)) {
      const values = bindings.get(name.text) ?? [];
      values.push({ availableAfter, scope });
      bindings.set(name.text, values);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) append(element.name, availableAfter, scope);
    }
  };
  for (const parameter of owner.parameters) append(parameter.name, -1, owner);
  let visited = 0;
  let complete = true;
  const visit = (node: ts.Node): void => {
    if (!complete) return;
    if (++visited > MAXIMUM_BINDING_NODES) {
      complete = false;
      return;
    }
    if (node !== owner && isPreviewRuntimeFunction(node)) {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        append(node.name, -1, readKeyScope(node, owner));
      }
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (node.name !== undefined) append(node.name, node.end, readKeyScope(node, owner));
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const scope =
        ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) === 0
          ? owner
          : readKeyScope(node, owner);
      append(node.name, node.end, scope);
    }
    ts.forEachChild(node, visit);
  };
  if (owner.body !== undefined) visit(owner.body);
  return { bindings, complete };
}

/** Finds the enclosing runtime block/loop scope without crossing the owning function. */
function readKeyScope(node: ts.Node, owner: PreviewRuntimeFunction): ts.Node {
  let scope = node.parent;
  while (scope !== owner) {
    if (
      ts.isBlock(scope) ||
      ts.isCaseBlock(scope) ||
      ts.isCatchClause(scope) ||
      ts.isForStatement(scope) ||
      ts.isForInStatement(scope) ||
      ts.isForOfStatement(scope)
    )
      return scope;
    scope = scope.parent;
  }
  return owner;
}
