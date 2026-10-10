/**
 * Reports whether a JSX condition reads only the component's own UI state.
 *
 * `open && <Dialog/>`, `tab === 'members'` or `step === 3` switch between authored screens of
 * one component, so a preview may show either branch. `atRiskDelta !== 0 && <Badge/>` instead
 * displays data: forcing it while the data says 0 renders a contradiction ("−0"). The runtime
 * keeps such data branches as authored when they belong to the selected target itself.
 */
import ts from 'typescript';

const STATE_HOOK_PATTERN = /^(?:useState|useReducer)$/u;

/**
 * True when the condition reads at least one useState/useReducer value of an enclosing function
 * (render helpers and `.map` callbacks included) and otherwise only module constants
 * ('step === STEPS.length - 1').
 */
export function isReactConditionLocalStateBound(condition: ts.Expression): boolean {
  const names = [...collectReadRoots(condition)];
  const stateNames = new Set<string>();
  for (const owner of readEnclosingFunctions(condition)) {
    for (const name of collectLocalStateNames(owner)) stateNames.add(name);
  }
  if (!names.some((name) => stateNames.has(name))) return false;
  const constants = collectModuleConstantNames(condition.getSourceFile());
  return names.every((name) => stateNames.has(name) || constants.has(name));
}

/** Returns every function enclosing the condition, nearest first. */
function readEnclosingFunctions(node: ts.Node): readonly ts.FunctionLikeDeclaration[] {
  const owners: ts.FunctionLikeDeclaration[] = [];
  let current = (node as unknown as { readonly parent?: ts.Node }).parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      owners.push(current);
    }
    current = current.parent;
  }
  return owners;
}

/** Collects the root identifiers read by an expression (`a.b.c` reads `a`). */
function collectReadRoots(expression: ts.Expression): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (node.text !== 'undefined') names.add(node.text);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return names;
}

/** Collects `const [value, setValue] = useState(...)` value names declared in one function. */
function collectLocalStateNames(owner: ts.FunctionLikeDeclaration): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && ts.isFunctionLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      isStateHookCallee(node.initializer.expression)
    ) {
      const first = node.name.elements[0];
      if (first !== undefined && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
        names.add(first.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (owner.body !== undefined) visit(owner.body);
  return names;
}

/** Collects names bound by top-level `const` declarations of the module. */
function collectModuleConstantNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
  }
  return names;
}

/** Accepts `useState`, `React.useState`, and the useReducer equivalents. */
function isStateHookCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return STATE_HOOK_PATTERN.test(callee.text);
  return ts.isPropertyAccessExpression(callee) && STATE_HOOK_PATTERN.test(callee.name.text);
}
