/**
 * Indexes immutable declaration and shadowing syntax for literal-zero hook collection aliases.
 * Weak parser ownership releases the catalog with its AST. Context-dependent fallback values,
 * imported-helper contracts, selected targets, and type decisions are deliberately never cached.
 */
import ts from 'typescript';
import { appendBindingNameCounts } from './previewRuntimeHookAliasBindings';
import { forEachBindingInRuntimeFunction } from './previewRuntimeHookFallbackSupport';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

/** Declaration facts from exactly one unchanged parser function. */
interface IndexedItemCatalog {
  /** Eligible aliases in authored order, keyed by the exact collection identifier spelling. */
  readonly aliasesByCollection: ReadonlyMap<string, readonly ts.Identifier[]>;
}

const catalogsByOwner = new WeakMap<PreviewRuntimeFunction, IndexedItemCatalog>();

/**
 * Reads only syntactically proven aliases; each caller must infer the current item contract again.
 *
 * @param owner Immutable parser function containing the collection binding and const aliases.
 * @param collectionName Collection identifier whose exact literal-zero aliases are requested.
 * @returns Authored alias identifiers, excluding ambiguous bindings and nested-name collisions.
 */
export function readPreviewRuntimeHookIndexedItemAliases(
  owner: PreviewRuntimeFunction,
  collectionName: string,
): readonly ts.Identifier[] {
  let catalog = catalogsByOwner.get(owner);
  if (catalog === undefined) {
    catalog = collectIndexedItemCatalog(owner);
    catalogsByOwner.set(owner, catalog);
  }
  return catalog.aliasesByCollection.get(collectionName) ?? [];
}

/**
 * Collects the original const and nested-scope counts in one preorder syntax walk.
 *
 * @param owner Parser function whose own const declarations remain visible to item inference.
 * @returns Read-only syntax facts without evaluating or resolving any alias value.
 */
function collectIndexedItemCatalog(owner: PreviewRuntimeFunction): IndexedItemCatalog {
  const declarations: ts.VariableDeclaration[] = [];
  const bindingCounts = new Map<string, number>();
  const nestedBindingCounts = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) {
      forEachBindingInRuntimeFunction(node, (binding) => {
        appendBindingNameCounts(binding, nestedBindingCounts);
      });
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      declarations.push(node);
      appendBindingNameCounts(node.name, bindingCounts);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  const aliasesByCollection = new Map<string, readonly ts.Identifier[]>();
  const pendingAliases = new Map<string, ts.Identifier[]>();
  for (const declaration of declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
    const alias = declaration.name;
    if (bindingCounts.get(alias.text) !== 1 || nestedBindingCounts.has(alias.text)) continue;
    const initializer = unwrapPreviewRuntimeExpression(declaration.initializer);
    if (!ts.isElementAccessExpression(initializer) || initializer.questionDotToken !== undefined) {
      continue;
    }
    const collection = unwrapPreviewRuntimeExpression(initializer.expression);
    const index = unwrapPreviewRuntimeExpression(initializer.argumentExpression);
    if (
      !ts.isIdentifier(collection) ||
      !ts.isNumericLiteral(index) ||
      index.text !== '0' ||
      bindingCounts.get(collection.text) !== 1
    )
      continue;
    const aliases = pendingAliases.get(collection.text) ?? [];
    aliases.push(alias);
    pendingAliases.set(collection.text, aliases);
  }
  for (const [name, aliases] of pendingAliases)
    aliasesByCollection.set(name, Object.freeze(aliases));
  return { aliasesByCollection };
}
