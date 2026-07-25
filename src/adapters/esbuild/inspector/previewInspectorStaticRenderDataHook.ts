/**
 * Recognizes project hooks whose authored return value is a substantial static UI-data catalog.
 *
 * A VirtualPage normally replaces project hooks below a retained component with demand-shaped
 * values. That is appropriate for network/session hooks, but it removes useful authored detail when
 * a hook itself returns navigation items, tabs, columns, or similar render data. This analyzer keeps
 * only syntax-proven catalogs authentic. It never executes project code and follows local return
 * aliases through a small, cycle-safe expression walk.
 */
import ts from 'typescript';

const MAXIMUM_EXPRESSION_DEPTH = 16;
const MAXIMUM_EXPRESSION_VISITS = 512;
const MINIMUM_CATALOG_OBJECTS = 2;
const MINIMUM_PRESENTATION_STRINGS = 2;
const PRESENTATION_PROPERTY_PATTERN =
  /^(?:ariaLabel|caption|description|heading|href|label|message|name|pageName|pageNameOrUrl|path|placeholder|route|text|title|url)$/u;

/** Bounded evidence collected from expressions that directly contribute to a hook return value. */
interface StaticRenderDataEvidence {
  /** Array literals prove that the result is a collection rather than an ordinary state object. */
  arrays: number;
  /** Object literals approximate the number of authored records retained for visible rendering. */
  objects: number;
  /** Distinct user-facing strings attached to well-known presentation fields. */
  readonly presentationStrings: Set<string>;
  /** Set when local expression traversal exceeds a fixed safety budget. */
  truncated: boolean;
  /** Total expression nodes visited across return expressions and their local aliases. */
  visits: number;
}

/** Reports when syntax has already proved enough authored detail to retain the hook. */
function hasSufficientStaticRenderDataEvidence(evidence: StaticRenderDataEvidence): boolean {
  return (
    evidence.arrays > 0 &&
    evidence.objects >= MINIMUM_CATALOG_OBJECTS &&
    evidence.presentationStrings.size >= MINIMUM_PRESENTATION_STRINGS
  );
}

type HookFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/**
 * Returns true when a demanded hook module contains an authored static render-data catalog.
 *
 * Every demanded runtime export must retain hook naming semantics, while at least one export must
 * return a collection with multiple object records and presentation strings. Co-located lightweight
 * hooks may then remain authentic too because downstream hook imports are still independently
 * projected by the corridor plugin.
 *
 * @param sourcePath Absolute source identity used only to select the TypeScript parser mode.
 * @param sourceText Current dirty-editor or filesystem snapshot; it is parsed but never evaluated.
 * @param exportNames Exact runtime-hook exports demanded by the retained visual component.
 */
export function hasPreviewInspectorStaticRenderDataHook(
  sourcePath: string,
  sourceText: string,
  exportNames: readonly string[],
): boolean {
  const demandedExports = [...new Set(exportNames)];
  if (
    demandedExports.length === 0 ||
    demandedExports.some((exportName) => !/^use[A-Z0-9_$]/u.test(exportName))
  ) {
    return false;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  const functionsByExport = collectExportedHookFunctions(sourceFile);
  return demandedExports.some((exportName) => {
    const hookFunction = functionsByExport.get(exportName);
    if (hookFunction === undefined) return false;
    const evidence = collectStaticRenderDataEvidence(hookFunction);
    return !evidence.truncated && hasSufficientStaticRenderDataEvidence(evidence);
  });
}

/** Selects TS/TSX parsing without consulting the filesystem or project compiler configuration. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/iu.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/iu.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/**
 * Maps named exported hook identities to their top-level function implementations.
 *
 * Direct exported declarations and `export { local as useName }` aliases are both supported.
 * Re-export-only barrels intentionally produce no match because retaining a catalog through an
 * unresolved module hop would turn weak syntax evidence into an unbounded graph decision.
 */
function collectExportedHookFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, HookFunction> {
  const functionsByLocalName = new Map<string, HookFunction>();
  const exportedLocalNames = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functionsByLocalName.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        exportedLocalNames.set(statement.name.text, statement.name.text);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const implementation = unwrapHookFunction(declaration.initializer);
        if (implementation === undefined) continue;
        functionsByLocalName.set(declaration.name.text, implementation);
        if (exported) exportedLocalNames.set(declaration.name.text, declaration.name.text);
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedLocalNames.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }

  return new Map(
    [...exportedLocalNames].flatMap(([exportName, localName]) => {
      const implementation = functionsByLocalName.get(localName);
      return implementation === undefined ? [] : [[exportName, implementation] as const];
    }),
  );
}

/** Unwraps transparent TypeScript syntax around an arrow/function initializer. */
function unwrapHookFunction(expression: ts.Expression | undefined): HookFunction | undefined {
  let current = expression;
  while (
    current !== undefined &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current !== undefined && (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
    ? current
    : undefined;
}

/** Checks a declaration modifier without depending on deprecated mutable modifier arrays. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind) === true
  );
}

/**
 * Collects catalog evidence only from expressions that can flow into the hook's own return.
 *
 * Local const aliases are followed, while nested callback bodies are ignored. This prevents event
 * handlers or helper closures from manufacturing presentation evidence unrelated to returned data.
 */
function collectStaticRenderDataEvidence(hookFunction: HookFunction): StaticRenderDataEvidence {
  const evidence: StaticRenderDataEvidence = {
    arrays: 0,
    objects: 0,
    presentationStrings: new Set(),
    truncated: false,
    visits: 0,
  };
  const localInitializers = collectLocalInitializers(hookFunction);
  const returnExpressions = collectHookReturnExpressions(hookFunction);
  const visitingLocalNames = new Set<string>();

  /** Visits one returned expression through transparent calls, branches, and local aliases. */
  const visit = (expression: ts.Expression, depth: number): void => {
    /*
     * Real application navigation catalogs can contain thousands of syntax nodes. Once the minimum
     * structural proof is present, further walking cannot change the decision and would only consume
     * the build budget that this bounded analyzer exists to protect.
     */
    if (evidence.truncated || hasSufficientStaticRenderDataEvidence(evidence)) return;
    evidence.visits += 1;
    if (depth > MAXIMUM_EXPRESSION_DEPTH || evidence.visits > MAXIMUM_EXPRESSION_VISITS) {
      evidence.truncated = true;
      return;
    }
    const current = unwrapExpression(expression);
    if (ts.isIdentifier(current)) {
      const initializer = localInitializers.get(current.text);
      if (initializer === undefined || visitingLocalNames.has(current.text)) return;
      visitingLocalNames.add(current.text);
      visit(initializer, depth + 1);
      visitingLocalNames.delete(current.text);
      return;
    }
    if (ts.isArrayLiteralExpression(current)) {
      evidence.arrays += 1;
      for (const element of current.elements) {
        if (hasSufficientStaticRenderDataEvidence(evidence)) break;
        if (ts.isOmittedExpression(element)) continue;
        visit(ts.isSpreadElement(element) ? element.expression : element, depth + 1);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(current)) {
      evidence.objects += 1;
      for (const property of current.properties) {
        if (hasSufficientStaticRenderDataEvidence(evidence)) break;
        if (ts.isPropertyAssignment(property)) {
          const propertyName = readPropertyName(property.name);
          const text = readStaticString(property.initializer);
          if (
            propertyName !== undefined &&
            text !== undefined &&
            PRESENTATION_PROPERTY_PATTERN.test(propertyName)
          ) {
            evidence.presentationStrings.add(text);
          }
          visit(property.initializer, depth + 1);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          visit(property.name, depth + 1);
        } else if (ts.isSpreadAssignment(property)) {
          visit(property.expression, depth + 1);
        }
      }
      return;
    }
    if (ts.isCallExpression(current)) {
      /*
       * Collection normalizers appear both as helpers (`compact([...])`) and fluent receivers
       * (`[...].filter(Boolean)`). The receiver still contributes the returned catalog, whereas the
       * called method body does not. Visiting only that receiver keeps traversal local and inert.
       */
      if (ts.isPropertyAccessExpression(current.expression)) {
        visit(current.expression.expression, depth + 1);
      } else if (ts.isElementAccessExpression(current.expression)) {
        visit(current.expression.expression, depth + 1);
      }
      for (const argument of current.arguments) visit(argument, depth + 1);
      return;
    }
    if (ts.isNewExpression(current)) {
      for (const argument of current.arguments ?? []) visit(argument, depth + 1);
      return;
    }
    if (ts.isConditionalExpression(current)) {
      visit(current.whenTrue, depth + 1);
      visit(current.whenFalse, depth + 1);
      return;
    }
    if (ts.isBinaryExpression(current)) {
      visit(current.left, depth + 1);
      visit(current.right, depth + 1);
    }
  };

  for (const expression of returnExpressions) visit(expression, 0);
  return evidence;
}

/** Collects direct local variable initializers available to the hook's return expression. */
function collectLocalInitializers(hookFunction: HookFunction): ReadonlyMap<string, ts.Expression> {
  const body = hookFunction.body;
  if (body === undefined || !ts.isBlock(body)) return new Map();
  const initializers = new Map<string, ts.Expression>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        initializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return initializers;
}

/** Finds only returns owned by the analyzed hook, never returns inside nested callbacks. */
function collectHookReturnExpressions(hookFunction: HookFunction): readonly ts.Expression[] {
  const body = hookFunction.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const expressions: ts.Expression[] = [];
  /** Walks control-flow statements but stops at every nested function boundary. */
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return Object.freeze(expressions);
}

/** Removes transparent expression wrappers before structural classification. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Reads a static object property spelling without evaluating computed keys. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Reads an authored literal string used as visible catalog detail. */
function readStaticString(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    const text = current.text.trim();
    return text.length === 0 || text.length > 160 ? undefined : text;
  }
  return undefined;
}
