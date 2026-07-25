/**
 * Recovers inert route-base evidence from conventional application/router factory calls.
 *
 * Project factories often receive a file-local `const` path instead of repeating a string literal.
 * This module deliberately resolves only a previously declared, top-level immutable string. It
 * never evaluates expressions, follows imports, folds templates, or guesses mutable runtime state.
 */
import ts from 'typescript';

const ROUTE_FACTORY_NAME_PATTERN =
  /^(?:create|define)[$_\p{L}\p{N}]*(?:App|Application|Module|Router|Routes)$/u;
/*
 * Route choices remain syntax-only metadata until one branch is selected. A high defensive ceiling
 * supports large application registries without causing esbuild to traverse every page module.
 */
const MAXIMUM_ROUTE_FACTORY_CHOICES = 4_096;

/** One factory result whose local component identity and absolute mount path are source-proven. */
export interface PreviewInspectorRouteFactoryEvidence {
  /** Absolute path passed as the factory's first argument. */
  readonly basePath: string;
  /** Page-map keys and submodule bindings offered as mutually exclusive route choices. */
  readonly choices: readonly PreviewInspectorRouteFactoryChoiceEvidence[];
  /** Statically proven callback bindings inserted directly beneath a Routes boundary. */
  readonly routeSlots: readonly PreviewInspectorRouteFactorySlotEvidence[];
  /** Whether the same Routes boundary contains a literal wildcard fallback. */
  readonly hasWildcardFallback: boolean;
  /** Local variable receiving the factory result, when the assignment is direct and named. */
  readonly componentName?: string;
  /** Stable source offset used to keep diagnostics deterministic. */
  readonly occurrenceStart: number;
}

/** One destructured factory callback value consumed as a direct Route child expression. */
export interface PreviewInspectorRouteFactorySlotEvidence {
  /** Local identifier referenced by the JSX expression. */
  readonly localName: string;
  /** Property name from the callback's first destructured parameter. */
  readonly propertyName: string;
  /** Stable JSX expression offset for deterministic diagnostics. */
  readonly occurrenceStart: number;
}

/** One route-catalog component identity and its importer-local runtime binding when statically known. */
export interface PreviewInspectorRouteFactoryChoiceEvidence {
  /** Page-map key or submodule name used by route catalogs and Inspector labels. */
  readonly componentName: string;
  /** Imported/local value rendered for that key; absent for executable or computed expressions. */
  readonly localName?: string;
}

/**
 * Collects conventional route factories without executing project factory implementations.
 *
 * A named owner is retained only for `const FeatureApp = createFeatureApp(...)`-shaped assignments.
 * Anonymous/nested calls still contribute supporting base-path evidence, but cannot become a page
 * candidate because no component identity connects them to the authored render graph.
 */
export function collectPreviewInspectorRouteFactoryEvidence(
  sourceFile: ts.SourceFile,
): readonly PreviewInspectorRouteFactoryEvidence[] {
  const evidence: PreviewInspectorRouteFactoryEvidence[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const basePath = readPreviewInspectorRouteFactoryBasePath(node, sourceFile);
      if (basePath !== undefined) {
        const componentName = readDirectFactoryResultName(node);
        const renderContract = readRouteFactoryRenderContract(node, sourceFile);
        evidence.push({
          basePath,
          choices: readRouteFactoryChoices(node, sourceFile),
          hasWildcardFallback: renderContract.hasWildcardFallback,
          routeSlots: renderContract.routeSlots,
          ...(componentName === undefined ? {} : { componentName }),
          occurrenceStart: node.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(evidence);
}

/**
 * Finds callback bindings that are demonstrably supplied to a local Routes element.
 *
 * The reader stays syntax-only: it follows neither callback values nor component implementations,
 * so executable route configuration remains outside extension-host analysis.
 */
function readRouteFactoryRenderContract(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): {
  readonly routeSlots: readonly PreviewInspectorRouteFactorySlotEvidence[];
  readonly hasWildcardFallback: boolean;
} {
  const callback = callExpression.arguments
    .slice(3)
    .find(
      (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
    );
  const parameter = callback?.parameters[0];
  if (
    callback === undefined ||
    parameter === undefined ||
    !ts.isObjectBindingPattern(parameter.name)
  ) {
    return Object.freeze({ hasWildcardFallback: false, routeSlots: Object.freeze([]) });
  }
  const bindings = new Map<string, string>();
  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const propertyName =
      element.propertyName === undefined
        ? element.name.text
        : readStaticPropertyName(element.propertyName);
    if (propertyName !== undefined) bindings.set(element.name.text, propertyName);
  }
  const slots: PreviewInspectorRouteFactorySlotEvidence[] = [];
  let hasWildcardFallback = false;
  const inspectRoutes = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && readJsxTagName(node.openingElement.tagName) === 'Routes') {
      for (const child of node.children) {
        if (
          ts.isJsxExpression(child) &&
          child.expression !== undefined &&
          ts.isIdentifier(child.expression)
        ) {
          const propertyName = bindings.get(child.expression.text);
          if (propertyName !== undefined) {
            slots.push(
              Object.freeze({
                localName: child.expression.text,
                occurrenceStart: child.getStart(sourceFile),
                propertyName,
              }),
            );
          }
        }
        if (ts.isJsxElement(child) && readJsxTagName(child.openingElement.tagName) === 'Route') {
          hasWildcardFallback ||= child.openingElement.attributes.properties.some(
            isWildcardRoutePathAttribute,
          );
        }
        if (ts.isJsxSelfClosingElement(child) && readJsxTagName(child.tagName) === 'Route') {
          hasWildcardFallback ||= child.attributes.properties.some(isWildcardRoutePathAttribute);
        }
      }
    }
    ts.forEachChild(node, inspectRoutes);
  };
  inspectRoutes(callback.body);
  const routeSlots = slots
    .filter(
      (slot, index, values) =>
        values.findIndex((value) => value.occurrenceStart === slot.occurrenceStart) === index,
    )
    .sort((left, right) => left.occurrenceStart - right.occurrenceStart);
  return Object.freeze({ hasWildcardFallback, routeSlots: Object.freeze(routeSlots) });
}

/** Reads the terminal tag spelling without resolving JSX component values. */
function readJsxTagName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText().split('.').at(-1) ?? '';
}

/** Accepts only a literal `path="*"` attribute on a Route element. */
function isWildcardRoutePathAttribute(attribute: ts.JsxAttributeLike): boolean {
  return (
    ts.isJsxAttribute(attribute) &&
    ts.isIdentifier(attribute.name) &&
    attribute.name.text === 'path' &&
    attribute.initializer !== undefined &&
    ts.isStringLiteral(attribute.initializer) &&
    attribute.initializer.text === '*'
  );
}

/**
 * Reads the page-map keys and submodule identifiers passed to one route factory.
 *
 * The factory implementation commonly turns the second object argument into `<Route>` elements
 * and the third array into nested module routes. Object keys are the route catalog identities, so
 * aliases such as `{ AccountPage: LazyAccount }` deliberately retain `AccountPage`. Only direct
 * literals and previously declared top-level `const` aggregates are followed; executable values,
 * computed names, mutation, and imported configuration remain untouched.
 */
function readRouteFactoryChoices(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): readonly PreviewInspectorRouteFactoryChoiceEvidence[] {
  const choices: PreviewInspectorRouteFactoryChoiceEvidence[] = [];
  const visited = new Set<ts.Expression>();
  const add = (componentName: string | undefined, localName?: string): void => {
    if (
      componentName !== undefined &&
      /^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u.test(componentName) &&
      !choices.some((choice) => choice.componentName === componentName) &&
      choices.length < MAXIMUM_ROUTE_FACTORY_CHOICES
    ) {
      choices.push(
        Object.freeze({
          componentName,
          ...(localName === undefined ? {} : { localName }),
        }),
      );
    }
  };

  /** Traverses only aggregate syntax whose values cannot execute during inspection. */
  const visit = (expression: ts.Expression | undefined, mode: 'pages' | 'submodules'): void => {
    if (expression === undefined || choices.length >= MAXIMUM_ROUTE_FACTORY_CHOICES) return;
    const unwrapped = unwrapExpression(expression);
    if (visited.has(unwrapped)) return;
    visited.add(unwrapped);
    if (ts.isIdentifier(unwrapped)) {
      const aggregate = readPriorTopLevelConstInitializer(unwrapped, sourceFile);
      if (aggregate === undefined) {
        if (mode === 'submodules') add(unwrapped.text, unwrapped.text);
      } else {
        visit(aggregate, mode);
      }
      return;
    }
    if (mode === 'pages' && ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          add(property.name.text, property.name.text);
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          const value = unwrapExpression(property.initializer);
          add(
            readStaticPropertyName(property.name),
            ts.isIdentifier(value) ? value.text : undefined,
          );
          continue;
        }
        if (ts.isSpreadAssignment(property)) visit(property.expression, mode);
      }
      return;
    }
    if (mode === 'submodules' && ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isSpreadElement(element)) visit(element.expression, mode);
        else visit(element, mode);
      }
    }
  };

  visit(callExpression.arguments[1], 'pages');
  visit(callExpression.arguments[2], 'submodules');
  return Object.freeze(choices);
}

/** Reads an identifier/string object key while rejecting computed route catalog identities. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

/**
 * Reads the absolute first argument of a conventional create/define route factory.
 *
 * Member calls are accepted by their terminal property name so namespace-imported factories remain
 * analyzable. The factory name is only a structural convention; no project-specific API is listed.
 */
export function readPreviewInspectorRouteFactoryBasePath(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | undefined {
  const calleeName = callExpression.expression.getText(sourceFile).split('.').at(-1) ?? '';
  return ROUTE_FACTORY_NAME_PATTERN.test(calleeName)
    ? readPreviewInspectorStaticAbsolutePathArgument(callExpression, sourceFile)
    : undefined;
}

/**
 * Resolves a literal absolute first argument or a safe same-file `const` alias.
 *
 * This lower-level reader intentionally does not inspect the callee name. The static-route
 * projection uses argument shape plus JSX/collection evidence to recognize custom factories whose
 * public names are unknown, while retaining the same conservative path-value rules.
 */
export function readPreviewInspectorStaticAbsolutePathArgument(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | undefined {
  const firstArgument = callExpression.arguments[0];
  if (firstArgument === undefined) return undefined;
  const directValue = readLiteralString(firstArgument);
  if (directValue !== undefined) return directValue.startsWith('/') ? directValue : undefined;
  if (!ts.isIdentifier(unwrapExpression(firstArgument))) return undefined;
  const identifier = unwrapExpression(firstArgument) as ts.Identifier;
  if (hasNestedBinding(identifier, sourceFile)) return undefined;
  const value = readPriorTopLevelConstString(identifier, sourceFile);
  return value?.startsWith('/') === true ? value : undefined;
}

/**
 * Returns the direct immutable variable or default export that owns one factory result.
 *
 * A default factory expression has no PascalCase local binding, but it is still an exact selected
 * export and can safely expose its inert page-map choices.
 */
function readDirectFactoryResultName(callExpression: ts.CallExpression): string | undefined {
  let current: ts.Expression = callExpression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent)
  ) {
    current = current.parent;
  }
  if (ts.isExportAssignment(current.parent) && current.parent.expression === current) {
    return 'default';
  }
  const declaration = current.parent;
  return ts.isVariableDeclaration(declaration) &&
    declaration.initializer === current &&
    ts.isIdentifier(declaration.name) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    ? declaration.name.text
    : undefined;
}

/**
 * Reads one previously declared top-level immutable string.
 *
 * Requiring source order rejects temporal-dead-zone code, while requiring exactly one matching
 * declaration fails open for partially edited files with duplicate bindings.
 */
function readPriorTopLevelConstString(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): string | undefined {
  const initializer = readPriorTopLevelConstInitializer(identifier, sourceFile);
  return initializer === undefined ? undefined : readLiteralString(initializer);
}

/**
 * Finds one prior top-level immutable initializer without interpreting its runtime value.
 *
 * This shared binding primitive supports both path aliases and route-choice aggregates while
 * retaining the original duplicate/temporal-dead-zone safety policy.
 */
function readPriorTopLevelConstInitializer(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const matches: ts.Expression[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== identifier.text ||
        declaration.initializer === undefined ||
        declaration.end >= identifier.getStart(sourceFile)
      ) {
        continue;
      }
      matches.push(declaration.initializer);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Rejects a top-level alias when a nested lexical scope declares the same name.
 *
 * The resolver does not attempt a full TypeScript binding pass. Conservatively rejecting parameters,
 * catch variables, and block-local declarations prevents a nearby shadow from being mistaken for
 * the top-level route constant.
 */
function hasNestedBinding(identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node = identifier.parent;
  while (current !== sourceFile) {
    if (
      ts.isFunctionLike(current) &&
      current.parameters.some((parameter) => bindingNameContains(parameter.name, identifier.text))
    ) {
      return true;
    }
    if (
      ts.isCatchClause(current) &&
      bindingNameContains(current.variableDeclaration?.name, identifier.text)
    ) {
      return true;
    }
    if (
      (ts.isBlock(current) || ts.isModuleBlock(current)) &&
      current.statements.some((statement) => statementDeclaresName(statement, identifier.text))
    ) {
      return true;
    }
    if (
      ts.isCaseBlock(current) &&
      current.clauses.some((clause) =>
        clause.statements.some((statement) => statementDeclaresName(statement, identifier.text)),
      )
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Checks direct variable/function/class declarations owned by one lexical statement. */
function statementDeclaresName(statement: ts.Statement, name: string): boolean {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name),
    );
  }
  return (
    ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === name) ||
    false
  );
}

/** Traverses destructuring names without evaluating their initializers or property expressions. */
function bindingNameContains(name: ts.BindingName | undefined, expected: string): boolean {
  if (name === undefined) return false;
  if (ts.isIdentifier(name)) return name.text === expected;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingNameContains(element.name, expected),
  );
}

/** Reads only a plain string/no-substitution template after removing inert TypeScript wrappers. */
function readLiteralString(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
}

/** Removes wrappers that cannot change the runtime value of a string expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
