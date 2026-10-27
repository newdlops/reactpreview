/** Describes authored React render branches, JSX structure, and terminal evidence. */
import ts from 'typescript';
import {
  isPreviewReactCreateElementCall,
  type PreviewReactRenderTerminalEvidence,
} from './previewReactRenderTerminal';
import {
  boundMetadataText,
  OVERLAY_COMPONENT_NAME_PATTERN,
  type ReactConditionalRenderMetadata,
  type ReactDomPortalBindings,
} from './reactConditionalModel';
import {
  isReactDomPortalCall,
  readStaticPropertyName,
  unwrapConditionalExpression,
} from './reactConditionalOverlaySyntax';

/** Labels a proven returned render expression consistently for one-sided and two-sided branches. */
export function describeReturnedRenderExpression(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  if (expression?.kind === ts.SyntaxKind.NullKeyword) return 'empty return';
  if (expression !== undefined && isConventionalReactFallbackExpression(expression))
    return boundMetadataText(expression.getText(sourceFile));
  if (expression !== undefined) {
    const unwrapped = unwrapConditionalExpression(expression);
    if (
      ts.isJsxElement(unwrapped) ||
      ts.isJsxSelfClosingElement(unwrapped) ||
      ts.isJsxFragment(unwrapped)
    ) {
      return describeReturnedJsxRenderExpression(unwrapped, sourceFile);
    }
  }
  return expression === undefined
    ? 'early return'
    : describeRenderBranch(expression, sourceFile, portalBindings);
}

/** Keeps direct child component names so a shared returned wrapper cannot hide the selected target. */
export function describeReturnedJsxRenderExpression(
  expression: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isJsxFragment(expression)) return describeJsxFragment(expression, sourceFile);
  if (ts.isJsxSelfClosingElement(expression)) {
    return `<${boundMetadataText(expression.tagName.getText(sourceFile))}>`;
  }
  const containerName = boundMetadataText(expression.openingElement.tagName.getText(sourceFile));
  const childNames: string[] = [];
  for (const child of expression.children) {
    const tagName = ts.isJsxElement(child)
      ? child.openingElement.tagName.getText(sourceFile)
      : ts.isJsxSelfClosingElement(child)
        ? child.tagName.getText(sourceFile)
        : undefined;
    if (tagName === undefined || childNames.includes(tagName) || childNames.length >= 8) continue;
    childNames.push(boundMetadataText(tagName));
  }
  return childNames.length === 0
    ? `<${containerName}>`
    : `<${containerName}: ${childNames.join(', ')}>`;
}

/** Recognizes a directly returned React fallback binding without admitting arbitrary values. */
export function isConventionalReactFallbackExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  return (
    (ts.isIdentifier(unwrapped) && /fallback$/iu.test(unwrapped.text)) ||
    (ts.isPropertyAccessExpression(unwrapped) && /fallback$/iu.test(unwrapped.name.text))
  );
}

/** Returns whether one expression directly represents a JSX element or fragment after wrappers. */
export function isDirectJsxRenderExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  );
}

/** Recognizes direct JSX and exact ReactDOM createPortal calls as render-bearing branches. */
export function isDirectReactRenderExpression(
  expression: ts.Expression,
  portalBindings: ReactDomPortalBindings,
): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  return (
    isDirectJsxRenderExpression(unwrapped) ||
    isPreviewReactCreateElementCall(unwrapped) ||
    isReactDomPortalCall(unwrapped, portalBindings)
  );
}

/**
 * Recognizes a direct overlay branch whose dormant state can hide the selected-file subtree.
 *
 * Component naming is used only as structural evidence and exact ReactDOM portals are always visual
 * layers. The result annotates an existing condition; it never instruments a non-render expression.
 */
export function isOverlayReactRenderExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  if (isReactDomPortalCall(unwrapped, portalBindings)) return true;
  if (isPreviewReactCreateElementCall(unwrapped)) {
    const componentType = unwrapped.arguments[0];
    const componentName = componentType?.getText(sourceFile);
    return (
      componentName?.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment)) ===
      true
    );
  }
  const tagName = ts.isJsxElement(unwrapped)
    ? unwrapped.openingElement.tagName.getText(sourceFile)
    : ts.isJsxSelfClosingElement(unwrapped)
      ? unwrapped.tagName.getText(sourceFile)
      : undefined;
  return (
    tagName?.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment)) === true
  );
}

/**
 * Recognizes the object half of an authored React Router-style conditional route entry.
 *
 * The property name and a direct JSX value are both required. That narrow proof keeps ordinary
 * `condition && object` computations unchanged while allowing the Inspector to reveal a page route
 * that an authentication, role, feature, or application-mode condition removed from a route array.
 */
export function isJsxRouteEntryExpression(
  expression: ts.Expression,
): expression is ts.ObjectLiteralExpression {
  const unwrapped = unwrapConditionalExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped)) return false;
  return unwrapped.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const propertyName = readStaticPropertyName(property.name);
    return propertyName === 'element' && isDirectJsxRenderExpression(property.initializer);
  });
}

/** Labels a conditional route with its JSX page element so target-path scoring can select it. */
export function describeJsxRouteEntry(
  expression: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): string {
  const elementProperty = expression.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      readStaticPropertyName(property.name) === 'element' &&
      isDirectJsxRenderExpression(property.initializer),
  );
  return elementProperty === undefined
    ? '<Route> entry'
    : `${describeJsxRenderExpression(elementProperty.initializer, sourceFile)} route`;
}

/** Produces a concise JSX tag label while keeping arbitrary branch expressions bounded. */
export function describeRenderBranch(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  if (isDirectJsxRenderExpression(expression)) {
    return describeJsxRenderExpression(expression, sourceFile);
  }
  const unwrapped = unwrapConditionalExpression(expression);
  if (isReactDomPortalCall(unwrapped, portalBindings)) {
    const portalChild = unwrapped.arguments[0];
    return portalChild !== undefined && isDirectJsxRenderExpression(portalChild)
      ? `${describeJsxRenderExpression(portalChild, sourceFile)} portal overlay`
      : '<Portal> overlay';
  }
  if (isPreviewReactCreateElementCall(unwrapped)) {
    return describeReactCreateElement(unwrapped, sourceFile);
  }
  return boundMetadataText(unwrapped.getText(sourceFile));
}

/** Labels a conventional React.createElement terminal without evaluating its component value. */
export function describeReactCreateElement(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string {
  const componentType = call.arguments[0];
  if (componentType === undefined) return '<React element>';
  const unwrapped = unwrapConditionalExpression(componentType);
  if (
    ts.isIdentifier(unwrapped) ||
    ts.isPropertyAccessExpression(unwrapped) ||
    ts.isStringLiteralLike(unwrapped)
  ) {
    return `<${boundMetadataText(
      ts.isStringLiteralLike(unwrapped) ? unwrapped.text : unwrapped.getText(sourceFile),
    )}>`;
  }
  return '<React element>';
}

/**
 * Combines every direct leaf proven behind an alias, array, ternary, or map callback.
 * The component names remain visible in one bounded label so target-path scoring can associate each
 * flattened guard with the selected descendant instead of treating the guard as an unrelated sibling.
 */
export function describeRenderTerminalEvidence(
  evidence: PreviewReactRenderTerminalEvidence,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): string {
  const labels: string[] = [];
  for (const terminal of evidence.terminals) {
    const label = isJsxRouteEntryExpression(terminal)
      ? describeJsxRouteEntry(terminal, sourceFile)
      : describeRenderBranch(terminal, sourceFile, portalBindings);
    if (!labels.includes(label) && labels.length < 8) labels.push(label);
  }
  return boundMetadataText(labels.join(' | ') || 'render value');
}

/**
 * Reads bounded direct component names from a fragment branch.
 *
 * A logical gate commonly wraps several target descendants in a Fragment. Keeping those names in
 * the branch label lets target-path scoring choose the gate without turning every `&&` expression
 * on the surrounding page on. Nested expressions remain opaque so this stays a local syntax proof.
 */
export function describeJsxFragment(fragment: ts.JsxFragment, sourceFile: ts.SourceFile): string {
  const componentNames: string[] = [];
  for (const child of fragment.children) {
    const tagName = ts.isJsxElement(child)
      ? child.openingElement.tagName.getText(sourceFile)
      : ts.isJsxSelfClosingElement(child)
        ? child.tagName.getText(sourceFile)
        : undefined;
    if (tagName === undefined || componentNames.includes(tagName) || componentNames.length >= 8) {
      continue;
    }
    componentNames.push(boundMetadataText(tagName));
    // A host wrapper (`<div><SkeletonTable /></div>`) hides the component that defines the branch.
    if (ts.isJsxElement(child) && /^[a-z]/u.test(tagName)) {
      collectJsxLayoutComponentNames(child, sourceFile, componentNames, 1);
    }
  }
  return componentNames.length === 0 ? '<Fragment>' : `<Fragment: ${componentNames.join(', ')}>`;
}

/** Keeps component descendants visible when an intrinsic layout shell owns the branch root. */
export function collectJsxLayoutComponentNames(
  node: ts.JsxElement | ts.JsxFragment,
  sourceFile: ts.SourceFile,
  names: string[],
  depth = 0,
): void {
  if (depth > 4 || names.length >= 8) return;
  for (const child of node.children) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const tagName = ts.isJsxElement(child)
        ? child.openingElement.tagName.getText(sourceFile)
        : child.tagName.getText(sourceFile);
      const leafName = tagName.split('.').at(-1) ?? tagName;
      if (/^[$_\p{Lu}]/u.test(leafName) && !names.includes(tagName)) {
        names.push(boundMetadataText(tagName));
      }
      if (ts.isJsxElement(child)) {
        collectJsxLayoutComponentNames(child, sourceFile, names, depth + 1);
      }
      continue;
    }
    if (ts.isJsxFragment(child)) {
      collectJsxLayoutComponentNames(child, sourceFile, names, depth + 1);
    }
  }
}

/** Reads the authored component/tag name from a direct JSX branch. */
export function describeJsxRenderExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  const unwrapped = unwrapConditionalExpression(expression);
  if (ts.isJsxFragment(unwrapped)) {
    return describeJsxFragment(unwrapped, sourceFile);
  }
  if (ts.isJsxElement(unwrapped)) {
    const tagName = boundMetadataText(unwrapped.openingElement.tagName.getText(sourceFile));
    // A wrapper component (`<TableShell><SkeletonTable /></TableShell>`) is named by what it wraps
    // as well; otherwise a loading branch and the content branch carry the same opaque label.
    const componentNames: string[] = [];
    collectJsxLayoutComponentNames(unwrapped, sourceFile, componentNames);
    if (componentNames.length > 0) {
      return boundMetadataText(`<${tagName}: ${componentNames.join(', ')}>`);
    }
    return `<${tagName}>`;
  }
  if (ts.isJsxSelfClosingElement(unwrapped)) {
    return `<${boundMetadataText(unwrapped.tagName.getText(sourceFile))}>`;
  }
  return 'JSX branch';
}

/** Marks a recognizable placeholder/loading/error branch so the UI can call it out explicitly. */
export function inferFallbackBranch(
  truthyLabel: string,
  falsyLabel: string,
): Pick<ReactConditionalRenderMetadata, 'fallbackBranch'> | Record<string, never> {
  const truthyFallback = isFallbackBranchLabel(truthyLabel);
  const falsyFallback = isFallbackBranchLabel(falsyLabel);
  if (truthyFallback === falsyFallback) {
    return {};
  }
  return { fallbackBranch: truthyFallback ? 'truthy' : 'falsy' };
}

/**
 * Recognizes common authored fallback component names without assigning project-specific meaning.
 * A branch with several terminals (`error ? <ErrorRetry/> : <Table/>`) is labeled with every leaf
 * joined by ' | '; it is a fallback only when every leaf is, or the page content beside an error
 * view would be classified as the placeholder and target search would open the other branch.
 */
export function isFallbackBranchLabel(label: string): boolean {
  return label
    .split(' | ')
    .every((leaf) =>
      /fallback|empty|error|loading|placeholder|skeleton|spinner|no[-_ ]?data|log[-_ ]?in|sign[-_ ]?in|unauthori[sz]ed|forbidden|access[-_ ]?denied|navigate|redirect/iu.test(
        leaf,
      ),
    );
}

/** Recognizes an exact router navigation component label already proven as returned React output. */
export function isNavigationBranchLabel(label: string): boolean {
  return /^<(?:[$_\p{L}][$_\p{L}\p{N}]*\.)*(?:Navigate|Redirect)>$/u.test(label);
}
