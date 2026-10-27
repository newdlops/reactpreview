/** Combines compiler-owned collection item shapes without dropping local native behavior. */
import ts from 'typescript';
import { createPreviewGeneratedListExpression } from './previewRuntimeHookUsageTree';

const MAX_CONTRACT_CHARACTERS = 64 * 1024;
const MAX_CONTRACT_NODES = 512;
const MAX_CONTRACT_DEPTH = 12;

/** One bounded compiler expression; application expressions are never evaluated here. */
type CollectionContract =
  | { readonly kind: 'record'; readonly fields: ReadonlyMap<string, CollectionContract> }
  | { readonly kind: 'list'; readonly item: CollectionContract }
  | { readonly kind: 'leaf'; readonly expression: string; readonly native: boolean };

/**
 * Repairs native leaves in the existing selected item without expanding ordinary field demand.
 * A proven inert RegExp keeps its prototype when a wider child annotation would otherwise replace
 * it with a generic string. Collections without native evidence retain the previous selection.
 *
 * @param preferred Existing selected item expression; its ordinary fields remain authoritative.
 * @param expressions Compiler-generated item expressions in evidence order.
 * @returns One expression, or undefined when bounded parsing cannot prove compatible records.
 */
export function mergePreviewRuntimeHookCollectionContracts(
  preferred: string,
  expressions: readonly string[],
): string | undefined {
  const distinct = [
    ...new Set([
      preferred,
      ...expressions.filter((expression) => expression.includes('new RegExp(')),
    ]),
  ];
  if (distinct.length < 2 || distinct.length > 16) return undefined;
  if (
    distinct.reduce((length, expression) => length + expression.length, 0) > MAX_CONTRACT_CHARACTERS
  )
    return undefined;
  const budget = { nodes: 0 };
  let merged: CollectionContract | undefined;
  for (const expression of distinct) {
    const source = ts.createSourceFile(
      'preview-generated-collection.ts',
      `const value = (${expression});`,
      ts.ScriptTarget.ES2020,
      true,
      ts.ScriptKind.TS,
    );
    const statement = source.statements[0];
    const initializer =
      statement !== undefined && ts.isVariableStatement(statement)
        ? statement.declarationList.declarations[0]?.initializer
        : undefined;
    if (initializer === undefined) return undefined;
    const contract = readCollectionContract(initializer, source, budget, 0);
    if (contract?.kind !== 'record') return undefined;
    merged = merged === undefined ? contract : repairNativeCollectionContract(merged, contract);
  }
  return merged === undefined ? undefined : serializeCollectionContract(merged);
}

/** Repairs only native-backed paths; ordinary local fields cannot widen the selected contract. */
function repairNativeCollectionContract(
  existing: CollectionContract,
  next: CollectionContract,
): CollectionContract {
  if (next.kind === 'leaf') return next.native ? next : existing;
  if (existing.kind === 'list' && next.kind === 'list') {
    return { kind: 'list', item: repairNativeCollectionContract(existing.item, next.item) };
  }
  if (existing.kind !== 'record' || next.kind !== 'record') return existing;
  const fields = new Map(existing.fields);
  for (const [name, child] of next.fields) {
    const previous = fields.get(name);
    const repaired =
      previous === undefined
        ? readNativeCollectionContract(child)
        : repairNativeCollectionContract(previous, child);
    if (repaired !== undefined) fields.set(name, repaired);
  }
  return { kind: 'record', fields };
}

/** Keeps only a proven native leaf and the required record/list containers leading to it. */
function readNativeCollectionContract(
  contract: CollectionContract,
): CollectionContract | undefined {
  if (contract.kind === 'leaf') return contract.native ? contract : undefined;
  if (contract.kind === 'list') {
    const item = readNativeCollectionContract(contract.item);
    return item === undefined ? undefined : { kind: 'list', item };
  }
  const fields = new Map<string, CollectionContract>();
  for (const [name, child] of contract.fields) {
    const native = readNativeCollectionContract(child);
    if (native !== undefined) fields.set(name, native);
  }
  return fields.size === 0 ? undefined : { kind: 'record', fields };
}

/** Reads only the frozen records and generated-list factories emitted by this compiler. */
function readCollectionContract(
  input: ts.Expression,
  source: ts.SourceFile,
  budget: { nodes: number },
  depth: number,
): CollectionContract | undefined {
  if (depth > MAX_CONTRACT_DEPTH || budget.nodes >= MAX_CONTRACT_NODES) return undefined;
  budget.nodes += 1;
  let expression = input;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (isObjectCall(expression, 'freeze') && expression.arguments.length === 1) {
    const value = expression.arguments[0];
    if (value !== undefined && ts.isObjectLiteralExpression(value)) {
      const fields = new Map<string, CollectionContract>();
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) return undefined;
        const name =
          ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
            ? property.name.text
            : undefined;
        if (name === undefined || ['__proto__', 'constructor', 'prototype'].includes(name))
          return undefined;
        const child = readCollectionContract(property.initializer, source, budget, depth + 1);
        if (child === undefined) return undefined;
        fields.set(name, child);
      }
      return { kind: 'record', fields };
    }
    if (value !== undefined && isObjectCall(value, 'assign')) {
      let merged: CollectionContract | undefined;
      for (const argument of value.arguments.slice(1)) {
        const child = readCollectionContract(argument, source, budget, depth + 1);
        if (child?.kind !== 'record') return undefined;
        merged = merged === undefined ? child : mergeCollectionContract(merged, child);
      }
      if (merged !== undefined) return merged;
    }
  }
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 1 &&
    expression.getText(source).startsWith('((__createPreviewItem) =>')
  ) {
    const factory = expression.arguments[0];
    if (factory !== undefined && ts.isArrowFunction(factory) && ts.isExpression(factory.body)) {
      const item = readCollectionContract(factory.body, source, budget, depth + 1);
      return item === undefined ? undefined : { kind: 'list', item };
    }
  }
  const native =
    expression.kind === ts.SyntaxKind.RegularExpressionLiteral ||
    (ts.isNewExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'RegExp' &&
      expression.arguments?.length === 1 &&
      expression.arguments.every(ts.isStringLiteralLike));
  return { kind: 'leaf', expression: expression.getText(source), native };
}

/** Recognizes an ordinary compiler-emitted Object method without resolving project symbols. */
function isObjectCall(expression: ts.Expression, method: string): expression is ts.CallExpression {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === 'Object' &&
    expression.expression.name.text === method
  );
}

/** Retains complementary fields and native leaves while respecting later ordinary type evidence. */
function mergeCollectionContract(
  existing: CollectionContract,
  next: CollectionContract,
): CollectionContract {
  if (existing.kind === 'leaf' && existing.native) return existing;
  if (next.kind === 'leaf' && next.native) return next;
  if (existing.kind === 'list' && next.kind === 'list') {
    return { kind: 'list', item: mergeCollectionContract(existing.item, next.item) };
  }
  if (existing.kind !== 'record' || next.kind !== 'record') return next;
  const fields = new Map(existing.fields);
  for (const [name, child] of next.fields) {
    const previous = fields.get(name);
    fields.set(name, previous === undefined ? child : mergeCollectionContract(previous, child));
  }
  return { kind: 'record', fields };
}

/** Emits one frozen value so merging does not build several overlapping runtime trees. */
function serializeCollectionContract(contract: CollectionContract): string {
  if (contract.kind === 'leaf') return contract.expression;
  if (contract.kind === 'list')
    return createPreviewGeneratedListExpression(serializeCollectionContract(contract.item));
  const fields = [...contract.fields]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, child]) => `${JSON.stringify(name)}: ${serializeCollectionContract(child)}`);
  return `Object.freeze({ ${fields.join(', ')} })`;
}
