/**
 * Recovers inert route-base evidence from conventional application/router factory calls.
 *
 * Project factories often receive a file-local `const` path instead of repeating a string literal.
 * This module deliberately resolves only a previously declared, top-level immutable string. It
 * never evaluates expressions, follows imports, folds templates, or guesses mutable runtime state.
 */
import ts from 'typescript';
import { collectPreviewInspectorRouteElementPath } from './previewInspectorRouteElementPath';
import { readRouteFactoryRenderContract } from './previewInspectorRouteFactoryRenderContract';
import { collectPreviewInspectorUnstableRouteFactoryAggregates } from './previewInspectorRouteFactoryAggregateUses';
import { collectPreviewInspectorRouteFactoryPageChoices } from './previewInspectorRouteFactoryPageChoices';

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
  /** Unknown runtime keys/accessors prevent projecting this page map as pinned inert choices. */
  readonly pageChoicesOpaque: boolean;
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
  /** Factory argument position; never inferred from source text. */
  readonly kind: 'page' | 'submodule';
  /** Imported/local value rendered for that key; absent for executable or computed expressions. */
  readonly localName?: string;
  /** Stable source order for duplicate values used at different paths. */
  readonly occurrenceStart: number;
  /** Direct outer-to-inner component arguments composed around the selected page binding. */
  readonly wrapperLocalNames?: readonly string[];
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
  const calls: { readonly expression: ts.CallExpression; readonly basePath: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const basePath = readPreviewInspectorRouteFactoryBasePath(node, sourceFile);
      if (basePath !== undefined) {
        calls.push({ expression: node, basePath });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (calls.length === 0) return Object.freeze([]);
  const unstableAggregates = collectPreviewInspectorUnstableRouteFactoryAggregates(
    sourceFile,
    new Set(calls.map((call) => call.expression)),
    (identifier) => hasNestedBinding(identifier, sourceFile),
  );
  return Object.freeze(
    calls.map(({ expression, basePath }) => {
      const componentName = readDirectFactoryResultName(expression);
      const renderContract = readRouteFactoryRenderContract(expression, sourceFile);
      const pages = collectPreviewInspectorRouteFactoryPageChoices({
        expression: expression.arguments[1],
        sourceFile,
        unstableAggregates,
        readInitializer: (identifier) => readPriorTopLevelConstInitializer(identifier, sourceFile),
        readComposition: (value, name) => readComposedRouteChoicePath(value, name, sourceFile),
      });
      return {
        basePath,
        choices: readRouteFactoryChoices(expression, sourceFile, unstableAggregates, pages.choices),
        pageChoicesOpaque: pages.opaque,
        hasWildcardFallback: renderContract.hasWildcardFallback,
        routeSlots: renderContract.routeSlots,
        ...(componentName === undefined ? {} : { componentName }),
        occurrenceStart: expression.getStart(sourceFile),
      };
    }),
  );
}

/**
 * Reads the page-map keys and submodule identifiers passed to one route factory.
 *
 * The factory implementation commonly turns the second object argument into `<Route>` elements
 * and the third array into nested module routes. Object keys are the route catalog identities, so
 * aliases such as `{ AccountPage: LazyAccount }` deliberately retain `AccountPage`. Only direct
 * literals and previously declared top-level `const` aggregates are followed. Mutated/escaped
 * aggregates retain declared labels without component references. Object construction keeps only
 * the effective last property; opaque spreads/computed keys invalidate earlier references without
 * executing their values. Imported configuration remains untouched.
 */
function readRouteFactoryChoices(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
  unstableAggregates: ReadonlySet<string>,
  pageChoices: readonly PreviewInspectorRouteFactoryChoiceEvidence[],
): readonly PreviewInspectorRouteFactoryChoiceEvidence[] {
  const choices: PreviewInspectorRouteFactoryChoiceEvidence[] = [...pageChoices];
  const visited = new Set<ts.Expression>();
  const add = (
    componentName: string | undefined,
    occurrenceStart: number,
    localName?: string,
  ): void => {
    if (
      componentName !== undefined &&
      /^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u.test(componentName) &&
      !choices.some(
        (choice) =>
          choice.componentName === componentName &&
          choice.kind === 'submodule' &&
          choice.occurrenceStart === occurrenceStart,
      ) &&
      choices.length < MAXIMUM_ROUTE_FACTORY_CHOICES
    ) {
      choices.push(
        Object.freeze({
          componentName,
          kind: 'submodule',
          occurrenceStart,
          ...(localName === undefined ? {} : { localName }),
        }),
      );
    }
  };

  /** Retains the existing ordered submodule-array proof without interpreting array values. */
  const visit = (expression: ts.Expression | undefined): void => {
    if (expression === undefined || choices.length >= MAXIMUM_ROUTE_FACTORY_CHOICES) return;
    const unwrapped = unwrapExpression(expression);
    if (visited.has(unwrapped)) return;
    visited.add(unwrapped);
    if (ts.isIdentifier(unwrapped)) {
      const aggregate = readPriorTopLevelConstInitializer(unwrapped, sourceFile);
      const value = aggregate === undefined ? undefined : unwrapExpression(aggregate);
      if (value !== undefined && (ts.isIdentifier(value) || ts.isArrayLiteralExpression(value))) {
        const firstChoice = choices.length;
        visit(value);
        if (unstableAggregates.has(unwrapped.text)) {
          for (let index = firstChoice; index < choices.length; index += 1) {
            const choice = choices[index];
            if (choice === undefined) continue;
            choices[index] = Object.freeze({
              componentName: choice.componentName,
              kind: choice.kind,
              occurrenceStart: choice.occurrenceStart,
            });
          }
        }
      } else {
        add(unwrapped.text, unwrapped.getStart(sourceFile), unwrapped.text);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isSpreadElement(element)) visit(element.expression);
        else visit(element);
      }
    }
  };

  visit(callExpression.arguments[2]);
  return Object.freeze(choices);
}

/**
 * Recovers one exact page binding from an inert wrapper-composition call.
 *
 * Route maps commonly wrap a page as `Page: compose(Layout, Page)`. The call is never evaluated;
 * only direct PascalCase identifier arguments are inspected. An exact object-key match is
 * unambiguous, while a single component argument also supports aliased page keys. Multiple
 * non-matching component arguments fail closed because their wrapper/leaf order is unknown.
 */
function readComposedRouteChoicePath(
  expression: ts.Expression,
  componentName: string | undefined,
  sourceFile: ts.SourceFile,
): { readonly localName: string; readonly wrapperLocalNames: readonly string[] } | undefined {
  const elementPath = collectPreviewInspectorRouteElementPath(expression, sourceFile);
  const leaf = elementPath.at(-1);
  if (leaf !== undefined) {
    return Object.freeze({
      localName: leaf.localName,
      wrapperLocalNames: Object.freeze([
        ...new Set(elementPath.slice(0, -1).map((item) => item.localName)),
      ]),
    });
  }
  if (!ts.isCallExpression(expression)) return undefined;
  const candidates: string[] = [];
  const collect = (candidate: ts.Expression): void => {
    const value = unwrapExpression(candidate);
    if (ts.isIdentifier(value)) {
      if (/^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u.test(value.text)) {
        candidates.push(value.text);
      }
      return;
    }
    if (!ts.isCallExpression(value)) return;
    for (const argument of value.arguments) collect(argument);
  };
  for (const argument of expression.arguments) collect(argument);
  const exactIndexes = candidates.flatMap((candidate, index) =>
    candidate === componentName ? [index] : [],
  );
  if (exactIndexes.length === 1) {
    const leafIndex = exactIndexes[0];
    const localName = leafIndex === undefined ? undefined : candidates[leafIndex];
    if (leafIndex === undefined || localName === undefined) return undefined;
    return Object.freeze({
      localName,
      wrapperLocalNames: Object.freeze([...new Set(candidates.slice(0, leafIndex))]),
    });
  }
  const uniqueCandidates = [...new Set(candidates)];
  return uniqueCandidates.length === 1 && uniqueCandidates[0] !== undefined
    ? Object.freeze({ localName: uniqueCandidates[0], wrapperLocalNames: Object.freeze([]) })
    : undefined;
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
 * Returns only a module-level immutable variable or default export owning one factory result.
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
  if (
    ts.isExportAssignment(current.parent) &&
    current.parent.expression === current &&
    ts.isSourceFile(current.parent.parent)
  ) {
    return 'default';
  }
  const declaration = current.parent;
  return ts.isVariableDeclaration(declaration) &&
    declaration.initializer === current &&
    ts.isIdentifier(declaration.name) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    ts.isVariableStatement(declaration.parent.parent) &&
    ts.isSourceFile(declaration.parent.parent.parent) &&
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
      (ts.isFunctionExpression(current) || ts.isClassExpression(current)) &&
      current.name?.text === identifier.text
    ) {
      return true;
    }
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
