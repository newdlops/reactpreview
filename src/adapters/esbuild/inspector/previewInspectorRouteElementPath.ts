/** Selects the terminal rendered component from one inert React Router element expression. */
import ts from 'typescript';

/** Importer-local component identity retained while a route element is inspected. */
export interface PreviewInspectorRouteElementIdentity {
  /** Human-readable terminal component name. */
  readonly componentName: string;
  /** Namespace member export when the JSX tag is qualified. */
  readonly exportName?: string;
  /** Importer-local binding used to resolve the authored source module. */
  readonly localName: string;
}

/**
 * Returns the most page-like outer-to-inner component path in one route element.
 *
 * JSX structure is stronger than component naming: descendants outrank wrappers first. Semantic
 * page suffixes only break ties between sibling leaves such as `<Container />` and `<AccountPage />`.
 * Fragments and intrinsic elements are transparent, and no component code is evaluated.
 */
export function collectPreviewInspectorRouteElementPath(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): readonly PreviewInspectorRouteElementIdentity[] {
  return Object.freeze(readRouteElementPath(expression, sourceFile));
}

/** Recursively follows only rendered children, conditional branches, and React.createElement input. */
function readRouteElementPath(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): PreviewInspectorRouteElementIdentity[] {
  const value = unwrapExpression(expression);
  if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value)) {
    const opening = ts.isJsxElement(value) ? value.openingElement : value;
    const ownIdentity = isTransparentFragmentTag(opening.tagName)
      ? undefined
      : readTagIdentity(opening.tagName);
    const childPaths: PreviewInspectorRouteElementIdentity[][] = [];
    const explicitChildren = readJsxExpressionAttribute(opening.attributes, 'children');
    if (explicitChildren !== undefined) {
      childPaths.push(readRouteElementPath(explicitChildren, sourceFile));
    }
    if (ts.isJsxElement(value)) {
      for (const child of value.children) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          childPaths.push(readRouteElementPath(child, sourceFile));
        } else if (ts.isJsxExpression(child) && child.expression !== undefined) {
          childPaths.push(readRouteElementPath(child.expression, sourceFile));
        }
      }
    }
    const childPath = selectPreferredPath(childPaths);
    return ownIdentity === undefined ? childPath : [ownIdentity, ...childPath];
  }
  if (ts.isJsxFragment(value)) {
    return selectPreferredPath(
      value.children.flatMap((child) =>
        ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
          ? [readRouteElementPath(child, sourceFile)]
          : ts.isJsxExpression(child) && child.expression !== undefined
            ? [readRouteElementPath(child.expression, sourceFile)]
            : [],
      ),
    );
  }
  if (ts.isIdentifier(value) && /^[A-Z_$]/u.test(value.text)) {
    return [{ componentName: value.text, localName: value.text }];
  }
  if (ts.isPropertyAccessExpression(value)) {
    const identity = readMemberIdentity(value);
    return identity === undefined ? [] : [identity];
  }
  if (ts.isConditionalExpression(value)) {
    return selectPreferredPath([
      readRouteElementPath(value.whenTrue, sourceFile),
      readRouteElementPath(value.whenFalse, sourceFile),
    ]);
  }
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return selectPreferredPath([
      readRouteElementPath(value.left, sourceFile),
      readRouteElementPath(value.right, sourceFile),
    ]);
  }
  if (ts.isArrayLiteralExpression(value)) {
    return selectPreferredPath(
      value.elements.flatMap((element) =>
        ts.isSpreadElement(element)
          ? [readRouteElementPath(element.expression, sourceFile)]
          : ts.isExpression(element)
            ? [readRouteElementPath(element, sourceFile)]
            : [],
      ),
    );
  }
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    if (ts.isExpression(value.body)) return readRouteElementPath(value.body, sourceFile);
    return selectPreferredPath(
      value.body.statements.flatMap((statement) =>
        ts.isReturnStatement(statement) && statement.expression !== undefined
          ? [readRouteElementPath(statement.expression, sourceFile)]
          : [],
      ),
    );
  }
  if (ts.isCallExpression(value)) {
    const callee = value.expression.getText(sourceFile).split('.').at(-1);
    if (callee === 'createElement' && value.arguments[0] !== undefined) {
      const ownIdentity = readExpressionIdentity(value.arguments[0]);
      const childPath = selectPreferredPath(
        value.arguments.slice(2).map((argument) => readRouteElementPath(argument, sourceFile)),
      );
      return ownIdentity === undefined ? childPath : [ownIdentity, ...childPath];
    }
  }
  return [];
}

/** Prefers an explicitly page-shaped leaf, then structural depth, while retaining source order. */
function selectPreferredPath(
  candidates: readonly PreviewInspectorRouteElementIdentity[][],
): PreviewInspectorRouteElementIdentity[] {
  let selected: PreviewInspectorRouteElementIdentity[] = [];
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    const leaf = candidate.at(-1);
    const score = candidate.length * 100 + scoreLeafIdentity(leaf?.componentName ?? '');
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return selected;
}

/** Uses framework-neutral role words only as a sibling tie-breaker, never as source admission. */
function scoreLeafIdentity(componentName: string): number {
  if (/(?:Page|Screen|View)$/u.test(componentName)) return 80;
  if (/(?:Form|Wizard)$/u.test(componentName)) return 60;
  if (/(?:App|Content)$/u.test(componentName)) return 30;
  if (
    /(?:Layout|Shell|Frame|Provider|Boundary|Loader|Handler|Tracker|Helmet)$/u.test(componentName)
  )
    return -40;
  return 0;
}

/** Reads an identifier or namespace member used as a React element type. */
function readExpressionIdentity(
  expression: ts.Expression,
): PreviewInspectorRouteElementIdentity | undefined {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value) && /^[A-Z_$]/u.test(value.text)) {
    return { componentName: value.text, localName: value.text };
  }
  return ts.isPropertyAccessExpression(value) ? readMemberIdentity(value) : undefined;
}

/** Reads one JSX tag while keeping namespace-import member exports exact. */
function readTagIdentity(
  tagName: ts.JsxTagNameExpression,
): PreviewInspectorRouteElementIdentity | undefined {
  if (ts.isIdentifier(tagName) && /^[A-Z_$]/u.test(tagName.text)) {
    return { componentName: tagName.text, localName: tagName.text };
  }
  return ts.isPropertyAccessExpression(tagName) ? readMemberIdentity(tagName) : undefined;
}

/** Maps `Screens.Home` to the namespace binding plus exact `Home` export. */
function readMemberIdentity(
  expression: ts.PropertyAccessExpression,
): PreviewInspectorRouteElementIdentity | undefined {
  let root: ts.Expression = expression.expression;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root) || !/^[A-Z_$]/u.test(expression.name.text)) return undefined;
  return {
    componentName: expression.name.text,
    exportName: expression.name.text,
    localName: root.text,
  };
}

/** Treats React fragments as transparent composition rather than selectable route pages. */
function isTransparentFragmentTag(tagName: ts.JsxTagNameExpression): boolean {
  return tagName.getText().split('.').at(-1) === 'Fragment';
}

/** Reads only an explicit JSX `children={...}` expression. */
function readJsxExpressionAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.Expression | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  return attribute?.initializer !== undefined && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
}

/** Removes inert TypeScript syntax wrappers without changing runtime meaning. */
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
