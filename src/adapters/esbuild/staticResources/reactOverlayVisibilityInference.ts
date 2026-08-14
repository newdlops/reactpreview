/**
 * Infers the one positive visibility prop that can reveal a directly previewed React overlay.
 *
 * This syntax-only helper deliberately avoids resolving application types. An explicit binding is
 * strongest evidence. A rest wrapper is admitted only when an overlay-named owner forwards a
 * same-named rest property into an explicit overlay visibility attribute; a bare spread remains
 * ambiguous because libraries disagree on `show`, `open`, and related contracts.
 */
import ts from 'typescript';

const OVERLAY_COMPONENT_NAME_PATTERN =
  /(?:modal|dialog|drawer|popover|popper|popup|overlay|portal|sheet|lightbox|tooltip|toast|snackbar|dropdown|menu)(?:form|content|container|wrapper|view|panel)?$/iu;
const POSITIVE_OVERLAY_VISIBILITY_PROPS = new Set([
  'defaultopen',
  'defaultvisible',
  'expanded',
  'isopen',
  'isvisible',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);

/** Reports whether a component/export label conventionally owns portal or overlay visibility. */
export function isReactOverlayComponentName(value: string): boolean {
  return OVERLAY_COMPONENT_NAME_PATTERN.test(value);
}

/** Reports whether one public prop name conventionally controls positive overlay visibility. */
export function isReactOverlayVisibilityPropName(value: string): boolean {
  return POSITIVE_OVERLAY_VISIBILITY_PROPS.has(normalizeVisibilityPropName(value));
}

/** Function-like component body accepted without invoking TypeScript's type checker. */
export type ReactOverlayFunctionLike =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Exact JSON-safe overlay state that makes one authored transition active. */
export interface ReactOverlayStateVisibilityValue {
  readonly kind: 'boolean' | 'number' | 'string';
  readonly propName: string;
  readonly renderedContent?: ReactOverlayRenderedContentValue;
  readonly value: boolean | number | string;
}

/** One direct React child slot that can safely receive a bounded visible preview label. */
interface ReactOverlayRenderedContentValue {
  readonly propName: string;
  readonly value: string;
}

/** Bounded parse-only resolver used to prove imported enum member values. */
export type ResolveReactOverlayImport = (
  moduleSpecifier: string,
  importerPath: string,
) => Readonly<{ sourcePath: string; sourceText: string }> | undefined;

const MAX_OVERLAY_STATE_REEXPORT_DEPTH = 6;
const MAX_OVERLAY_STATE_MODULE_BYTES = 512 * 1024;
const MAX_OVERLAY_STATE_REEXPORTS = 64;

/**
 * Returns one generated-true prop name, or `undefined` when visibility remains a user choice.
 *
 * @param functionLike Exact same-file function reached through the exported HOC chain.
 * @param exportName Public export identity used when the function itself is anonymous.
 */
export function inferReactOverlayVisibilityProp(
  functionLike: ReactOverlayFunctionLike,
  exportName: string,
): string | undefined {
  const ownerName = readFunctionLikeName(functionLike) ?? exportName;
  if (!isReactOverlayComponentName(ownerName)) return undefined;
  const parameter = functionLike.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  const explicitPaths = parameter.name.elements.flatMap((element) => {
    if (element.dotDotDotToken !== undefined) return [];
    const propertyName = readBindingPropertyName(element);
    return propertyName !== undefined && isReactOverlayVisibilityPropName(propertyName)
      ? [propertyName]
      : [];
  });
  if (explicitPaths.length === 1) return explicitPaths[0];
  if (explicitPaths.length > 1) return undefined;
  const restName = parameter.name.elements.find(
    (element) => element.dotDotDotToken !== undefined && ts.isIdentifier(element.name),
  )?.name;
  if (restName === undefined || !ts.isIdentifier(restName)) return undefined;
  const overlayOpening = findForwardedOverlayOpening(functionLike.body, restName.text);
  return overlayOpening === undefined
    ? undefined
    : readExplicitForwardedVisibilityProp(overlayOpening, restName.text);
}

/**
 * Infers an exact enum-backed `state` value that opens a directly previewed portal overlay.
 *
 * Some design systems expose `state={State.Default}` instead of a boolean `open` prop. This is
 * admitted only when an overlay-named owner contains a Portal and forwards the same destructured
 * state binding into an animation's positive `active={state === Enum.Member}` comparison. The enum
 * initializer must then resolve through bounded inert imports/re-exports to a JSON-safe literal.
 */
export function inferReactOverlayStateVisibility(
  functionLike: ReactOverlayFunctionLike,
  exportName: string,
  sourcePath: string,
  resolveImport: ResolveReactOverlayImport | undefined,
): ReactOverlayStateVisibilityValue | undefined {
  if (resolveImport === undefined) return undefined;
  const ownerName = readFunctionLikeName(functionLike) ?? exportName;
  if (!isReactOverlayComponentName(ownerName) || !containsPortalElement(functionLike.body)) {
    return undefined;
  }
  const stateBinding = readOverlayStateBinding(functionLike);
  if (stateBinding === undefined) return undefined;
  const comparisons = collectOverlayStateActivationComparisons(
    functionLike,
    stateBinding.localName,
  );
  if (comparisons.length !== 1) return undefined;
  const comparison = comparisons[0];
  if (comparison === undefined) return undefined;
  const importedEnum = readNamedImportBinding(functionLike.getSourceFile(), comparison.enumBinding);
  if (importedEnum === undefined) return undefined;
  const resolved = resolveImportedEnumMemberValue(
    importedEnum.moduleSpecifier,
    importedEnum.importedName,
    comparison.memberName,
    sourcePath,
    resolveImport,
    new Set(),
    0,
  );
  const renderedContent = readOverlayRenderedContent(functionLike, ownerName);
  return resolved === undefined
    ? undefined
    : Object.freeze({
        propName: stateBinding.propName,
        ...resolved,
        ...(renderedContent === undefined ? {} : { renderedContent }),
      });
}

/**
 * Finds a selected overlay's directly rendered public `children` slot.
 *
 * A string is a valid ReactNode, but it is generated only when the authored component renders the
 * exact binding as JSX content. Rest bindings such as `...props` map back to the public root rather
 * than inventing a nested `props` API.
 */
function readOverlayRenderedContent(
  functionLike: ReactOverlayFunctionLike,
  ownerName: string,
): ReactOverlayRenderedContentValue | undefined {
  const parameter = functionLike.parameters[0];
  const body = functionLike.body;
  if (body === undefined || parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) {
    return undefined;
  }
  const directBindings = new Map<string, string>();
  const restBindings = new Set<string>();
  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    if (element.dotDotDotToken !== undefined) {
      restBindings.add(element.name.text);
      continue;
    }
    const propName = readBindingPropertyName(element);
    if (propName?.toLowerCase() === 'children') {
      directBindings.set(element.name.text, propName);
    }
  }
  if (directBindings.size === 0 && restBindings.size === 0) return undefined;
  const renderedPropNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const expression = unwrapOverlayExpression(node.expression);
      if (expression === undefined) return;
      if (ts.isIdentifier(expression)) {
        const propName = directBindings.get(expression.text);
        if (propName !== undefined) renderedPropNames.add(propName);
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        restBindings.has(expression.expression.text) &&
        expression.name.text.toLowerCase() === 'children'
      ) {
        renderedPropNames.add(expression.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  const propName = renderedPropNames.size === 1 ? [...renderedPropNames][0] : undefined;
  if (propName === undefined) return undefined;
  const value = ownerName.length <= 32 ? ownerName : `${ownerName.slice(0, 31)}…`;
  return Object.freeze({ propName, value });
}

/** External and local identities for one destructured overlay state field. */
function readOverlayStateBinding(
  functionLike: ReactOverlayFunctionLike,
): { readonly localName: string; readonly propName: string } | undefined {
  const parameter = functionLike.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  const candidates = parameter.name.elements.flatMap((element) => {
    if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) return [];
    const propName = readBindingPropertyName(element);
    return propName?.replaceAll('_', '').toLowerCase() === 'state'
      ? [{ localName: element.name.text, propName }]
      : [];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Requires an authored Portal element inside the selected component body. */
function containsPortalElement(body: ts.ConciseBody | undefined): boolean {
  if (body === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== body && ts.isFunctionLike(node))) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText().split('.').at(-1)?.toLowerCase() === 'portal'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

interface OverlayStateActivationComparison {
  readonly enumBinding: string;
  readonly memberName: string;
}

/** Collects one positive equality used as a transition-like JSX element's `active` attribute. */
function collectOverlayStateActivationComparisons(
  functionLike: ReactOverlayFunctionLike,
  stateLocalName: string,
): readonly OverlayStateActivationComparison[] {
  const body = functionLike.body;
  if (body === undefined) return [];
  const comparisons: OverlayStateActivationComparison[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isJsxAttribute(node) && node.name.getText().toLowerCase() === 'active') {
      const opening = node.parent.parent;
      const transitionOwner =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        /(?:animate|animation|motion|transition)/iu.test(opening.tagName.getText());
      const expression =
        node.initializer !== undefined && ts.isJsxExpression(node.initializer)
          ? unwrapOverlayExpression(node.initializer.expression)
          : undefined;
      if (transitionOwner && expression !== undefined && ts.isBinaryExpression(expression)) {
        const operator = expression.operatorToken.kind;
        if (
          operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          operator === ts.SyntaxKind.EqualsEqualsToken
        ) {
          const comparison = readOverlayStateComparison(expression, stateLocalName);
          if (comparison !== undefined) comparisons.push(comparison);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return comparisons;
}

/** Reads `state === ImportedEnum.Member` in either operand order. */
function readOverlayStateComparison(
  expression: ts.BinaryExpression,
  stateLocalName: string,
): OverlayStateActivationComparison | undefined {
  const left = unwrapOverlayExpression(expression.left);
  const right = unwrapOverlayExpression(expression.right);
  const member =
    isIdentifierNamed(left, stateLocalName) && right !== undefined
      ? right
      : isIdentifierNamed(right, stateLocalName) && left !== undefined
        ? left
        : undefined;
  if (
    member === undefined ||
    !ts.isPropertyAccessExpression(member) ||
    !ts.isIdentifier(member.expression)
  ) {
    return undefined;
  }
  return { enumBinding: member.expression.text, memberName: member.name.text };
}

/** Named import identity used to follow an enum through a package barrel. */
function readNamedImportBinding(
  sourceFile: ts.SourceFile,
  localName: string,
): { readonly importedName: string; readonly moduleSpecifier: string } | undefined {
  const matches = sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      return [];
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    return statement.importClause.namedBindings.elements.flatMap((element) =>
      element.name.text === localName
        ? [
            {
              importedName: element.propertyName?.text ?? element.name.text,
              moduleSpecifier,
            },
          ]
        : [],
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolves one literal enum member through direct declarations and bounded export barrels. */
function resolveImportedEnumMemberValue(
  moduleSpecifier: string,
  enumName: string,
  memberName: string,
  importerPath: string,
  resolveImport: ResolveReactOverlayImport,
  visited: Set<string>,
  depth: number,
): Pick<ReactOverlayStateVisibilityValue, 'kind' | 'value'> | undefined {
  if (depth >= MAX_OVERLAY_STATE_REEXPORT_DEPTH) return undefined;
  const resolved = resolveImport(moduleSpecifier, importerPath);
  if (
    resolved === undefined ||
    visited.has(resolved.sourcePath) ||
    resolved.sourceText.length > MAX_OVERLAY_STATE_MODULE_BYTES
  ) {
    return undefined;
  }
  visited.add(resolved.sourcePath);
  const sourceFile = ts.createSourceFile(
    resolved.sourcePath,
    resolved.sourceText,
    ts.ScriptTarget.Latest,
    true,
    resolved.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (ts.isEnumDeclaration(statement) && statement.name.text === enumName) {
      return readEnumMemberLiteral(statement, memberName);
    }
  }
  const reexports = sourceFile.statements
    .filter(
      (statement): statement is ts.ExportDeclaration =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(statement.moduleSpecifier),
    )
    .slice(0, MAX_OVERLAY_STATE_REEXPORTS);
  for (const declaration of reexports) {
    const moduleText = (declaration.moduleSpecifier as ts.StringLiteralLike).text;
    if (declaration.exportClause === undefined) {
      const value = resolveImportedEnumMemberValue(
        moduleText,
        enumName,
        memberName,
        resolved.sourcePath,
        resolveImport,
        new Set(visited),
        depth + 1,
      );
      if (value !== undefined) return value;
      continue;
    }
    if (!ts.isNamedExports(declaration.exportClause)) continue;
    for (const element of declaration.exportClause.elements) {
      if (element.name.text !== enumName) continue;
      return resolveImportedEnumMemberValue(
        moduleText,
        element.propertyName?.text ?? element.name.text,
        memberName,
        resolved.sourcePath,
        resolveImport,
        new Set(visited),
        depth + 1,
      );
    }
  }
  return undefined;
}

/** Reads only explicit primitive enum initializers; computed and auto-numbered members fail closed. */
function readEnumMemberLiteral(
  declaration: ts.EnumDeclaration,
  memberName: string,
): Pick<ReactOverlayStateVisibilityValue, 'kind' | 'value'> | undefined {
  const matches = declaration.members.filter((member) => {
    const name = member.name;
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === memberName;
  });
  const initializer =
    matches.length === 1 ? unwrapOverlayExpression(matches[0]?.initializer) : undefined;
  if (initializer === undefined) return undefined;
  if (ts.isStringLiteralLike(initializer)) return { kind: 'string', value: initializer.text };
  if (ts.isNumericLiteral(initializer)) return { kind: 'number', value: Number(initializer.text) };
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: true };
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean', value: false };
  return undefined;
}

/** Removes transparent TypeScript wrappers around a runtime expression. */
function unwrapOverlayExpression(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (
    current !== undefined &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/** TypeScript guard for one exact local binding. */
function isIdentifierNamed(
  expression: ts.Expression | undefined,
  name: string,
): expression is ts.Identifier {
  return expression !== undefined && ts.isIdentifier(expression) && expression.text === name;
}

/**
 * Reports whether one JSX attribute is the positive visibility input of an overlay-shaped tag.
 *
 * This is intentionally stricter than matching `open` or `show` alone. Ordinary panels frequently
 * reuse those names, so both the attribute contract and a Modal/Dialog/Portal-like component name
 * must agree before preview inference is allowed to choose a dormant value.
 */
export function isReactOverlayVisibilityJsxAttribute(attribute: ts.JsxAttribute): boolean {
  const attributeName = attribute.name.getText();
  if (!isReactOverlayVisibilityPropName(attributeName)) {
    return false;
  }
  const attributes = attribute.parent;
  const opening = attributes.parent;
  if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening)) return false;
  return opening.tagName
    .getText()
    .split('.')
    .some((segment) => isReactOverlayComponentName(segment));
}

/** Reads a stable authored owner name through the local HOC function candidate. */
function readFunctionLikeName(functionLike: ReactOverlayFunctionLike): string | undefined {
  const name =
    ts.isFunctionDeclaration(functionLike) || ts.isFunctionExpression(functionLike)
      ? functionLike.name
      : undefined;
  if (name !== undefined) return name.text;
  const parent = functionLike.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

/** Finds an overlay JSX tag that receives the exact object-rest binding from component props. */
function findForwardedOverlayOpening(
  body: ts.ConciseBody | undefined,
  restName: string,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
  if (body === undefined) return undefined;
  let selected: ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node): void => {
    if (selected !== undefined) return;
    if (
      ts.isJsxSpreadAttribute(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === restName &&
      ts.isJsxAttributes(node.parent)
    ) {
      const opening = node.parent.parent;
      if (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) {
        const tag = opening.tagName.getText();
        if (tag.split('.').some((segment) => isReactOverlayComponentName(segment))) {
          selected = opening;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return selected;
}

/**
 * Reads one same-named rest property explicitly forwarded into the overlay's visibility attribute.
 * A bare spread supplies no evidence whether `Modal` means `show`, `open`, or another project API,
 * so ambiguous wrappers remain observed-only and editable in the Inspector.
 */
function readExplicitForwardedVisibilityProp(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  restName: string,
): string | undefined {
  const candidates = opening.attributes.properties.flatMap((property) => {
    if (!ts.isJsxAttribute(property)) return [];
    const initializer = property.initializer;
    if (initializer === undefined || !ts.isJsxExpression(initializer)) return [];
    const attributeName = property.name.getText();
    if (!isReactOverlayVisibilityPropName(attributeName)) {
      return [];
    }
    const expression = initializer.expression;
    if (
      expression === undefined ||
      !ts.isPropertyAccessExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== restName ||
      normalizeVisibilityPropName(expression.name.text) !==
        normalizeVisibilityPropName(attributeName)
    ) {
      return [];
    }
    return [attributeName];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Returns the external key of a simple object-binding field without evaluating computed names. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const name = element.propertyName ?? element.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Normalizes common `isOpen`/`is_open` spellings without admitting arbitrary property names. */
function normalizeVisibilityPropName(value: string): string {
  return value.replaceAll('_', '').toLowerCase();
}
