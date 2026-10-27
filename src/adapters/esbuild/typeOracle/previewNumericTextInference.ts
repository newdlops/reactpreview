/**
 * Finds string properties consumed by the global Number constructor in admitted project sources.
 * Evidence belongs to exact property declarations in one program, never to a shared string type
 * or a field name. The lazy, bounded index avoids rescanning the program for every payload leaf;
 * unresolved, shadowed, mutable, oversized, and unsupported aliases keep ordinary text samples.
 */
import ts from 'typescript';
import { readPreviewTypeAnalysisNodeCost } from './previewTypedJsonAnalysis';

const MAX_FILES = 600;
const MAX_SOURCE_LENGTH = 128 * 1024;
const MAX_VISITED_NODES = 200_000;
const MAX_CANDIDATES = 2_048;
const MAX_ALIAS_DEPTH = 4;

/** Reports whether the exact property has an authored global Number conversion. */
export type PreviewNumericTextReader = (property: ts.Symbol) => boolean;

interface NumericCandidate {
  readonly call: ts.CallExpression;
  readonly value: ts.Expression;
  declarations?: readonly ts.Declaration[];
}

/**
 * Creates a lazy reader scoped to this program and its current editor snapshots.
 *
 * @param program Program containing admitted project sources and default library declarations.
 * @param checker That program's checker; no separate or cross-program symbols are retained.
 * @returns Bounded reader; unsupported syntax and checker failures contribute no evidence.
 */
export function createPreviewNumericTextReader(
  program: ts.Program,
  checker: ts.TypeChecker,
): PreviewNumericTextReader {
  let candidates: ReadonlyMap<string, readonly NumericCandidate[]> | undefined;
  const results = new Map<ts.Symbol, boolean>();
  return (property) => {
    const cached = results.get(property);
    if (cached !== undefined) return cached;
    let numeric = false;
    try {
      candidates ??= collectCandidates(program, checker);
      const declarations = new Set(property.getDeclarations() ?? []);
      for (const candidate of candidates.get(property.getName()) ?? []) {
        candidate.declarations ??= readCandidateDeclarations(program, checker, candidate);
        if (candidate.declarations.some((declaration) => declarations.has(declaration))) {
          numeric = true;
          break;
        }
      }
    } catch {
      numeric = false;
    }
    if (results.size < MAX_CANDIDATES) results.set(property, numeric);
    return numeric;
  };
}

/** Indexes only syntactic Number calls, postponing property type resolution until a name matches. */
function collectCandidates(
  program: ts.Program,
  checker: ts.TypeChecker,
): ReadonlyMap<string, readonly NumericCandidate[]> {
  const candidates = new Map<string, NumericCandidate[]>();
  let files = 0;
  let visited = 0;
  let count = 0;
  for (const source of program.getSourceFiles()) {
    if (
      source.isDeclarationFile ||
      /[/\\]node_modules[/\\]/u.test(source.fileName) ||
      source.text.length > MAX_SOURCE_LENGTH ||
      !source.text.includes('Number')
    )
      continue;
    if (files >= MAX_FILES || visited >= MAX_VISITED_NODES || count >= MAX_CANDIDATES) break;
    files += 1;
    const visit = (node: ts.Node): void => {
      if (visited >= MAX_VISITED_NODES || count >= MAX_CANDIDATES) return;
      visited = Math.min(MAX_VISITED_NODES, visited + readPreviewTypeAnalysisNodeCost(node));
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Number' &&
        node.arguments.length === 1
      ) {
        const argument = node.arguments[0];
        const value = argument === undefined ? undefined : unwrapAlias(checker, argument, 0);
        const name = value === undefined ? undefined : readValueName(checker, value);
        if (value !== undefined && name !== undefined && name.length <= 128) {
          const entries = candidates.get(name) ?? [];
          entries.push({ call: node, value });
          candidates.set(name, entries);
          count += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return candidates;
}

/** Resolves a candidate only after rejecting local/imported Number bindings. */
function readCandidateDeclarations(
  program: ts.Program,
  checker: ts.TypeChecker,
  candidate: NumericCandidate,
): readonly ts.Declaration[] {
  const numberDeclarations = checker
    .getSymbolAtLocation(candidate.call.expression)
    ?.getDeclarations();
  if (
    numberDeclarations === undefined ||
    numberDeclarations.length === 0 ||
    !numberDeclarations.every((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    )
  )
    return [];
  const value = candidate.value;
  if (ts.isPropertyAccessExpression(value)) {
    return checker.getSymbolAtLocation(value.name)?.getDeclarations() ?? [];
  }
  if (ts.isElementAccessExpression(value) && ts.isStringLiteralLike(value.argumentExpression)) {
    const type = checker.getNonNullableType(checker.getTypeAtLocation(value.expression));
    return checker.getPropertyOfType(type, value.argumentExpression.text)?.getDeclarations() ?? [];
  }
  if (ts.isIdentifier(value)) {
    const binding = checker.getSymbolAtLocation(value)?.valueDeclaration;
    if (binding !== undefined && ts.isBindingElement(binding)) {
      return readBindingProperty(checker, binding, 0)?.getDeclarations() ?? [];
    }
  }
  return [];
}

/** Follows only const value aliases; destructured bindings are resolved against their container. */
function unwrapAlias(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  depth: number,
): ts.Expression | undefined {
  if (depth > MAX_ALIAS_DEPTH) return undefined;
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression;
  if (!ts.isIdentifier(value)) return value;
  const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
  if (declaration !== undefined && ts.isBindingElement(declaration)) {
    return isConstBinding(declaration) ? value : undefined;
  }
  if (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    isConstDeclaration(declaration) &&
    declaration.initializer !== undefined
  )
    return unwrapAlias(checker, declaration.initializer, depth + 1);
  return undefined;
}

/** Reads a syntactic backing name without asking the checker for the property's type. */
function readValueName(checker: ts.TypeChecker, value: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(value)) return value.name.text;
  if (ts.isElementAccessExpression(value) && ts.isStringLiteralLike(value.argumentExpression)) {
    return value.argumentExpression.text;
  }
  if (ts.isIdentifier(value)) {
    const binding = checker.getSymbolAtLocation(value)?.valueDeclaration;
    if (binding !== undefined && ts.isBindingElement(binding)) {
      const name = binding.propertyName ?? binding.name;
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    }
  }
  return undefined;
}

/** Resolves nested object destructuring to the exact property declaration in the source type. */
function readBindingProperty(
  checker: ts.TypeChecker,
  binding: ts.BindingElement,
  depth: number,
): ts.Symbol | undefined {
  if (
    depth > MAX_ALIAS_DEPTH ||
    !isConstBinding(binding) ||
    !ts.isObjectBindingPattern(binding.parent)
  )
    return undefined;
  const name = binding.propertyName ?? binding.name;
  if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) return undefined;
  const container = binding.parent.parent;
  let type: ts.Type | undefined;
  if (ts.isVariableDeclaration(container) && container.initializer !== undefined) {
    type = checker.getTypeAtLocation(container.initializer);
  } else if (ts.isBindingElement(container)) {
    const property = readBindingProperty(checker, container, depth + 1);
    if (property !== undefined) type = checker.getTypeOfSymbolAtLocation(property, container);
  }
  return type === undefined
    ? undefined
    : checker.getPropertyOfType(checker.getNonNullableType(type), name.text);
}

/** Rejects default/rest bindings and requires an immutable root declaration. */
function isConstBinding(binding: ts.BindingElement): boolean {
  let current: ts.BindingElement = binding;
  for (let depth = 0; depth <= MAX_ALIAS_DEPTH; depth += 1) {
    if (current.initializer !== undefined || current.dotDotDotToken !== undefined) return false;
    const parent = current.parent.parent;
    if (ts.isVariableDeclaration(parent)) return isConstDeclaration(parent);
    if (!ts.isBindingElement(parent)) return false;
    current = parent;
  }
  return false;
}

/** Checks the declaration list, without accepting let, var, or function parameters. */
function isConstDeclaration(declaration: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}
