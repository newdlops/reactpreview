/**
 * Supplies declared-type values to render guards that the Page Inspector may force open.
 *
 * A guard such as `form && <FormModal mode={form.mode} />` or `if (!row) return null;` hides UI
 * while nullable state is empty. When the Inspector reveals that UI, the state is still `null`, so
 * every `form.x` read throws. For a bare-identifier guard whose declared type is nullable, this
 * transform rewrites the identifier's value reads inside the guarded branch (or after the bypassed
 * early return) to `(form || typedFormState)`. Authored truthy
 * values are returned unchanged, the JSX structure (and therefore the condition instrumentation)
 * is preserved, and the typed value is one module-level frozen constant with a stable identity.
 */
import ts from 'typescript';
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import {
  isPreviewGuardExpression,
  isPreviewNegation,
  readPreviewNegatedIdentifier,
} from '../typeOracle/previewTypeOracle';
import { createPreviewTypedValueExpression } from '../typeOracle/previewTypedValueExpression';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import type { StaticSourceAnalysis } from './staticCallParser';

const MAX_GUARDS_PER_MODULE = 32;
const MAX_GUARD_EXPRESSION_LENGTH = 20_000;

/** Replacements and module-level declarations produced for one source module. */
export interface PreviewTypedGuardInstrumentation {
  /** `const` declarations holding each guard's typed substitute. */
  readonly declarations: readonly string[];
  /** Identifier-read replacements inside guarded branches. */
  readonly replacements: readonly PreviewSourceReplacement[];
}

/**
 * Rewrites nullable guard reads inside JSX branches and after early-return guards.
 *
 * @param sourcePath Absolute module path used for oracle lookups.
 * @param sourceText Transform input text (original positions).
 * @param oracle Build-scoped declared-type oracle.
 * @param allocate Allocates a collision-free module binding name.
 * @param occupied Replacements already selected for this module; overlapping reads are skipped.
 * @param sourceAnalysis Private transformer analysis reused only for the exact input path and text.
 * @returns Declarations and replacements, both empty when nothing qualified.
 */
export function createPreviewTypedGuardReplacements(
  sourcePath: string,
  sourceText: string,
  oracle: PreviewTypeOracleView,
  allocate: (kind: string) => string,
  occupied: readonly PreviewSourceReplacement[],
  sourceAnalysis?: StaticSourceAnalysis,
): PreviewTypedGuardInstrumentation {
  const empty = { declarations: [], replacements: [] };
  if (!sourceText.includes('<') && !sourceText.includes('createElement')) return empty;
  const prepared = sourceAnalysis?.getSourceFile();
  const sourceFile =
    prepared?.fileName === sourcePath && prepared.text === sourceText
      ? prepared
      : ts.createSourceFile(
          sourcePath,
          sourceText,
          ts.ScriptTarget.Latest,
          true,
          /\.[jt]sx$/u.test(sourcePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
  const occurrenceByNode = indexOccurrences(sourceFile);
  const declarations: string[] = [];
  const replacements: PreviewSourceReplacement[] = [];
  const guards = collectGuards(sourceFile).slice(0, MAX_GUARDS_PER_MODULE);
  for (const guard of guards) {
    const text = guard.expression.getText(sourceFile);
    const reads = collectReads(guard.identifier, guard.scope);
    if (reads === undefined || reads.length === 0 || text.length > MAX_GUARD_EXPRESSION_LENGTH) {
      continue;
    }
    const free = reads.filter(
      (read) =>
        !occupied.some((item) => read.start < item.end && read.end > item.start) &&
        !replacements.some((item) => read.start < item.end && read.end > item.start),
    );
    if (free.length === 0) continue;
    const typed = oracle.readTypedGuardValue({
      expressionText: text,
      kind: guard.kind,
      occurrence: occurrenceByNode.get(guard.expression) ?? 0,
      requiredPaths: [...new Set(reads.map((read) => read.path).filter((path) => path.length > 0))],
      sourcePath,
    });
    if (typed?.nullable !== true) continue;
    const binding = allocate('typedGuard');
    declarations.push(`const ${binding} = ${createPreviewTypedValueExpression(typed.value)};`);
    for (const read of free) {
      replacements.push({
        end: read.end,
        replacement: `(${guard.identifier.text} || ${binding})`,
        start: read.start,
      });
    }
  }
  return { declarations, replacements };
}

/** One nullable-identifier guard and the syntax whose reads it protects. */
interface GuardSite {
  /** Node the oracle finds by text: the `&&`/ternary expression or the `!identifier` negation. */
  readonly expression: ts.Node;
  readonly identifier: ts.Identifier;
  readonly kind: 'branch' | 'negation';
  /** Branch expression, or the statements that run after an early return is bypassed. */
  readonly scope: readonly ts.Node[];
}

/** Collects JSX `id && …`/`id ? … : …` branches and `if (!id) return …;` continuations. */
function collectGuards(sourceFile: ts.SourceFile): readonly GuardSite[] {
  const guards: GuardSite[] = [];
  const visit = (node: ts.Node): void => {
    if (isPreviewGuardExpression(node)) {
      const guard = readJsxGuard(node);
      if (guard !== undefined) {
        guards.push({
          expression: node,
          identifier: guard.identifier,
          kind: 'branch',
          scope: [guard.branch],
        });
      }
    }
    if (
      ts.isIfStatement(node) &&
      node.elseStatement === undefined &&
      isReturnOnly(node.thenStatement)
    ) {
      let condition = node.expression;
      while (ts.isParenthesizedExpression(condition)) condition = condition.expression;
      const identifier = isPreviewNegation(condition)
        ? readPreviewNegatedIdentifier(condition)
        : undefined;
      const parent = node.parent;
      if (identifier !== undefined && ts.isBlock(parent)) {
        const index = parent.statements.indexOf(node);
        guards.push({
          expression: condition,
          identifier,
          kind: 'negation',
          scope: parent.statements.slice(index + 1),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return guards;
}

/** Reports `return …;` or a block that holds only one return statement. */
function isReturnOnly(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  const [only] =
    ts.isBlock(statement) && statement.statements.length === 1 ? statement.statements : [];
  return only !== undefined && ts.isReturnStatement(only);
}

/** Numbers guard and negation nodes by identical text in the pre-order the oracle also uses. */
function indexOccurrences(sourceFile: ts.SourceFile): ReadonlyMap<ts.Node, number> {
  const counters = new Map<string, number>();
  const occurrences = new Map<ts.Node, number>();
  const visit = (node: ts.Node): void => {
    const kind = isPreviewGuardExpression(node)
      ? 'branch'
      : isPreviewNegation(node)
        ? 'negation'
        : undefined;
    if (kind !== undefined) {
      const key = `${kind}\0${node.getText(sourceFile)}`;
      const occurrence = counters.get(key) ?? 0;
      counters.set(key, occurrence + 1);
      occurrences.set(node, occurrence);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return occurrences;
}

/** Collects reads across every node in a guard's scope; any unsafe use disqualifies the guard. */
function collectReads(
  identifier: ts.Identifier,
  scope: readonly ts.Node[],
): readonly BranchRead[] | undefined {
  const reads: BranchRead[] = [];
  for (const node of scope) {
    const found = collectBranchReads(identifier, node);
    if (found === undefined) return undefined;
    reads.push(...found);
  }
  return reads;
}

/** Accepts `id && <jsx>` and `id ? <jsx> : other`, returning the tested identifier and branch. */
function readJsxGuard(
  node: ts.BinaryExpression | ts.ConditionalExpression,
): { readonly branch: ts.Expression; readonly identifier: ts.Identifier } | undefined {
  let tested: ts.Expression = ts.isConditionalExpression(node) ? node.condition : node.left;
  while (ts.isParenthesizedExpression(tested)) tested = tested.expression;
  const branch = ts.isConditionalExpression(node) ? node.whenTrue : node.right;
  return ts.isIdentifier(tested) && containsJsx(branch)
    ? { branch, identifier: tested }
    : undefined;
}

/** Reports JSX in `node` outside nested functions, whose bodies render later or not at all. */
function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
    return true;
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, containsJsx) === true;
}

interface BranchRead {
  readonly end: number;
  /** Usage path below the identifier (`mode`, `rows.map()`), empty for a bare value read. */
  readonly path: string;
  readonly start: number;
}

/**
 * Collects value reads of `identifier` inside `branch`.
 * Returns `undefined` when the branch shadows the name or uses it in a position that cannot be
 * rewritten as an expression (assignment target, shorthand property), so the guard is left intact.
 */
function collectBranchReads(
  identifier: ts.Identifier,
  branch: ts.Node,
): readonly BranchRead[] | undefined {
  const name = identifier.text;
  const reads: BranchRead[] = [];
  // Widened: the visitor below sets it, which control-flow narrowing cannot see.
  let unsafe = false as boolean;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (declaresName(node, name)) {
      unsafe = true;
      return;
    }
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      if (ts.isShorthandPropertyAssignment(parent) || isAssignmentTarget(node)) {
        unsafe = true;
        return;
      }
      if (isValueReference(node))
        reads.push({ end: node.end, path: readUsagePath(node), start: node.getStart() });
    }
    ts.forEachChild(node, visit);
  };
  visit(branch);
  return unsafe ? undefined : reads;
}

/** Reports a parameter, variable, binding, function, or class declaration that binds `name`. */
function declaresName(node: ts.Node, name: string): boolean {
  const declarationName =
    ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)
      ? node.name
      : ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node)
        ? node.name
        : undefined;
  if (declarationName === undefined) return false;
  let found = false;
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && current.text === name) found = true;
    else ts.forEachChild(current, visit);
  };
  visit(declarationName);
  return found;
}

/** Excludes property names, JSX attribute names, labels, and type references. */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))
    return parent.initializer === node;
  if (ts.isJsxAttribute(parent) || ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent))
    return false;
  if (
    ts.isJsxOpeningElement(parent) ||
    ts.isJsxSelfClosingElement(parent) ||
    ts.isJsxClosingElement(parent)
  ) {
    return false;
  }
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return !ts.isPropertySignature(parent) && !ts.isMethodDeclaration(parent);
}

/** Reports an identifier written by assignment or increment, which a rebinding cannot replace. */
function isAssignmentTarget(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    const kind = parent.operatorToken.kind;
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
  }
  return (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  );
}

/** Reads `id.a.b` as `a.b` (with `()` when the last member is called), or `` for a bare read. */
function readUsagePath(node: ts.Identifier): string {
  const names: string[] = [];
  let current: ts.Node = node;
  while (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) {
    names.push(current.parent.name.text);
    current = current.parent;
  }
  const called = ts.isCallExpression(current.parent) && current.parent.expression === current;
  return names.length === 0 ? '' : `${names.join('.')}${called ? '()' : ''}`;
}
