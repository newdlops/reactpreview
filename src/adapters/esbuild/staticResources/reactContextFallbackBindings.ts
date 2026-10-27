/** Tracks authored const aliases and source-proven Context-bound return paths. */
import ts from 'typescript';
import {
  COLLECTION_IDENTITY_METHODS,
  MAX_PATH_DEPTH,
  MAX_VALUE_CHOICE_PATHS,
  type FallbackShape,
  type HookBoundValue,
  type HookFallbackPlan,
  type RuntimeFunction,
} from './reactContextFallbackModel';
import {
  addObjectContainer,
  addProperObjectPrefixes,
  isSafePath,
  isSafePropertyName,
} from './reactContextFallbackShape';
import {
  isRuntimeFunction,
  unwrapExpression,
  visitDirectScopeNodes,
} from './reactContextFallbackSyntax';

/** Collects `const` declarations owned by a scope while excluding nested function bodies. */
export function collectDirectConstDeclarations(
  scope: RuntimeFunction,
): readonly ts.VariableDeclaration[] {
  const declarations: ts.VariableDeclaration[] = [];
  visitDirectScopeNodes(scope, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer !== undefined
    ) {
      declarations.push(node);
    }
  });
  return declarations;
}

/** Resolves direct aliases and object binding patterns in bounded fixed-point passes. */
export function inferCandidateAliases(
  declarations: readonly ts.VariableDeclaration[],
  bindings: Map<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
): void {
  const unresolved = new Set(declarations);
  for (let pass = 0; pass < declarations.length && unresolved.size > 0; pass += 1) {
    let changed = false;
    for (const declaration of [...unresolved]) {
      const initializer = declaration.initializer;
      if (initializer === undefined) continue;
      const resolved = readHookBoundValue(
        initializer,
        bindings,
        plan.candidate.call,
        localReturnFunctions,
      );
      if (resolved === undefined) continue;
      for (const valuePath of resolved.paths) {
        recordExpressionContainerPrefixes(initializer, valuePath, plan);
      }
      if (!bindCandidatePattern(declaration.name, resolved.paths, bindings, plan)) {
        plan.invalid = true;
        return;
      }
      unresolved.delete(declaration);
      changed = true;
    }
    if (!changed) return;
  }
}

/** Binds an identifier or recursively supported object pattern to one context-result path. */
export function bindCandidatePattern(
  name: ts.BindingName,
  valuePaths: readonly (readonly string[])[],
  bindings: Map<string, HookBoundValue>,
  plan: HookFallbackPlan,
): boolean {
  if (ts.isIdentifier(name)) {
    bindings.set(name.text, { paths: deduplicateHookBoundPaths(valuePaths) });
    return true;
  }
  if (!ts.isObjectBindingPattern(name)) return false;
  for (const valuePath of valuePaths) {
    if (!addObjectContainer(valuePath, plan)) return false;
  }

  for (const element of name.elements) {
    if (element.dotDotDotToken !== undefined || element.initializer !== undefined) return false;
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined) return false;
    const propertyPaths = deduplicateHookBoundPaths(
      valuePaths.map((valuePath) => [...valuePath, propertyName]),
    );
    if (ts.isIdentifier(element.name)) {
      bindings.set(element.name.text, { paths: propertyPaths });
    } else if (ts.isObjectBindingPattern(element.name)) {
      for (const propertyPath of propertyPaths) {
        if (!addObjectContainer(propertyPath, plan)) return false;
      }
      if (!bindCandidatePattern(element.name, propertyPaths, bindings, plan)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** Reads one simple object-binding property name and rejects computed or prototype-sensitive keys. */
export function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const propertyNode = element.propertyName;
  const propertyName =
    propertyNode === undefined && ts.isIdentifier(element.name)
      ? element.name.text
      : propertyNode !== undefined &&
          (ts.isIdentifier(propertyNode) ||
            ts.isStringLiteral(propertyNode) ||
            ts.isNumericLiteral(propertyNode))
        ? propertyNode.text
        : undefined;
  return isSafePropertyName(propertyName) ? propertyName : undefined;
}

/** Resolves an identifier, the exact candidate call, or a direct property chain to a hook path. */
export function readHookBoundValue(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  candidateCall: ts.CallExpression,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
  activeFunctions = new Set<string>(),
): HookBoundValue | undefined {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped === candidateCall) return { paths: Object.freeze([Object.freeze([])]) };
  if (ts.isIdentifier(unwrapped)) return bindings.get(unwrapped.text);
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.questionDotToken === undefined &&
    isSafePropertyName(unwrapped.name.text)
  ) {
    const owner = readHookBoundValue(
      unwrapped.expression,
      bindings,
      candidateCall,
      localReturnFunctions,
      activeFunctions,
    );
    if (owner === undefined) return undefined;
    const paths = deduplicateHookBoundPaths(
      owner.paths.flatMap((ownerPath) =>
        ownerPath.length >= MAX_PATH_DEPTH ? [] : [[...ownerPath, unwrapped.name.text]],
      ),
    );
    return paths.length === 0 ? undefined : { paths };
  }
  if (ts.isCallExpression(unwrapped) && unwrapped.questionDotToken === undefined) {
    const callee = unwrapExpression(unwrapped.expression);
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.questionDotToken === undefined &&
      COLLECTION_IDENTITY_METHODS.has(callee.name.text)
    ) {
      return readHookBoundValue(
        callee.expression,
        bindings,
        candidateCall,
        localReturnFunctions,
        activeFunctions,
      );
    }
    if (ts.isIdentifier(callee)) {
      const localFunction = localReturnFunctions.get(callee.text);
      const identity = localFunction === undefined ? undefined : String(localFunction.pos);
      if (localFunction !== undefined && identity !== undefined && !activeFunctions.has(identity)) {
        const nextActive = new Set(activeFunctions).add(identity);
        const paths = deduplicateHookBoundPaths(
          collectRuntimeReturnExpressions(localFunction).flatMap(
            (returnExpression) =>
              readHookBoundValue(
                returnExpression,
                bindings,
                candidateCall,
                localReturnFunctions,
                nextActive,
              )?.paths ?? [],
          ),
        );
        return paths.length === 0 ? undefined : { paths };
      }
    }
  }
  return undefined;
}

/** Collects uniquely named local runtime functions without resolving or executing closures. */
export function collectUniqueLocalRuntimeFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, RuntimeFunction> {
  const candidates = new Map<string, RuntimeFunction[]>();
  const append = (name: string, functionLike: RuntimeFunction): void => {
    const values = candidates.get(name) ?? [];
    values.push(functionLike);
    candidates.set(name, values);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      append(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        append(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return new Map(
    [...candidates].flatMap(([name, values]) =>
      values.length === 1 && values[0] !== undefined ? [[name, values[0]] as const] : [],
    ),
  );
}

/** Reads direct return expressions while treating nested closures as separate functions. */
export function collectRuntimeReturnExpressions(owner: RuntimeFunction): readonly ts.Expression[] {
  if (ts.isArrowFunction(owner) && !ts.isBlock(owner.body)) return [owner.body];
  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return Object.freeze(expressions);
}

/** Bounds and de-duplicates alternate hook-relative origins in stable source order. */
export function deduplicateHookBoundPaths(
  paths: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const retained = new Map<string, readonly string[]>();
  for (const path_ of paths) {
    if (path_.length > MAX_PATH_DEPTH) continue;
    const key = path_.join('\0');
    if (!retained.has(key)) retained.set(key, Object.freeze([...path_]));
    if (retained.size >= MAX_VALUE_CHOICE_PATHS) break;
  }
  return Object.freeze([...retained.values()]);
}

/**
 * Retains one resolvable optional receiver without requiring it to exist in the fallback.
 * A path is keyed with NUL separators because validated property names cannot contain NUL in
 * generated object syntax, and the original segment array remains available for shape lookup.
 */
export function recordOptionalBase(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
  localReturnFunctions: ReadonlyMap<string, RuntimeFunction>,
): boolean {
  const resolved = readHookBoundValue(
    expression,
    bindings,
    plan.candidate.call,
    localReturnFunctions,
  );
  if (resolved === undefined || resolved.paths.some((path_) => !isSafePath(path_))) return false;
  for (const path_ of resolved.paths) plan.optionalBasePaths.set(path_.join('\0'), path_);
  return resolved.paths.length > 0;
}

/**
 * Rejects a fallback only when it would make an authored optional receiver non-nullish.
 * The root fallback is necessarily present; nested receivers stay safely undefined unless some
 * independently proven non-optional operation materialized that exact path as an object/function.
 */
export function wouldBreakOptionalShortCircuit(plan: HookFallbackPlan): boolean {
  for (const path_ of plan.optionalBasePaths.values()) {
    if (path_.length === 0 || hasMaterializedShapePath(plan.shape, path_)) return true;
  }
  return false;
}

/** Reports whether one exact fallback path has already become a concrete object or callable. */
export function hasMaterializedShapePath(shape: FallbackShape, path_: readonly string[]): boolean {
  let node = shape;
  for (const propertyName of path_) {
    const child = node.children.get(propertyName);
    if (child === undefined) return false;
    node = child;
  }
  return true;
}

/** Reports whether an unsupported expression still originates from the candidate hook result. */
export function isRootedAtCandidate(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, HookBoundValue>,
  plan: HookFallbackPlan,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped === plan.candidate.call) return true;
  if (ts.isIdentifier(unwrapped)) return bindings.has(unwrapped.text);
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return isRootedAtCandidate(unwrapped.expression, bindings, plan);
  }
  if (ts.isCallExpression(unwrapped)) {
    return isRootedAtCandidate(unwrapped.expression, bindings, plan);
  }
  return false;
}

/** Records initializer evaluation prefixes when a derived alias starts below the hook root. */
export function recordExpressionContainerPrefixes(
  initializer: ts.Expression,
  path_: readonly string[],
  plan: HookFallbackPlan,
): void {
  const unwrapped = unwrapExpression(initializer);
  if (!ts.isPropertyAccessExpression(unwrapped)) return;
  plan.required = true;
  if (!addProperObjectPrefixes(path_, plan)) plan.invalid = true;
}
