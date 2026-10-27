/**
 * Connects one imported target tab to its local controller's literal initial default.
 * Only compiler-selected target names and a single unmodified spread/controller binding qualify;
 * URL query precedence and all later authored state/event handling remain in the real hook.
 */
import path from 'node:path';
import ts from 'typescript';
import { PREVIEW_PAGE_INSPECTOR_API_SYMBOL } from '../pageInspector/previewPageInspectorRuntimeSource';
import type { PreviewReactConditionalReplacement } from './previewReactConditionalReplacements';
import {
  findNearestOverlayRuntimeFunction,
  readOverlayRuntimeFunctionName,
} from './reactConditionalOverlaySyntax';

/** Returns initial-key wrappers for unambiguous imported Tab/TabItem/controller data flow. */
export function collectPreviewSelectedPageTabDefaultReplacements(
  source: ts.SourceFile,
  targetNames: ReadonlySet<string>,
  provenHookNames?: ReadonlySet<string>,
): readonly PreviewReactConditionalReplacement[] {
  if (provenHookNames === undefined || provenHookNames.size === 0) return [];
  const replacements: PreviewReactConditionalReplacement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Tab') {
      const replacement = readTabDefault(node, source, targetNames, provenHookNames);
      if (replacement !== undefined) replacements.push(replacement);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Sharing a controller across two tab groups is ambiguous even if both name the same target.
  const counts = new Map<number, number>();
  for (const replacement of replacements)
    counts.set(replacement.start, (counts.get(replacement.start) ?? 0) + 1);
  return replacements.filter((replacement) => counts.get(replacement.start) === 1).slice(0, 8);
}

/** Proves the exact tuple binding and one selected child under a unique static event key. */
function readTabDefault(
  tab: ts.JsxElement,
  source: ts.SourceFile,
  targetNames: ReadonlySet<string>,
  provenHookNames: ReadonlySet<string>,
): PreviewReactConditionalReplacement | undefined {
  const owner = findNearestOverlayRuntimeFunction(tab);
  const ownerName = owner === undefined ? undefined : readOverlayRuntimeFunctionName(owner, source);
  if (
    owner?.body === undefined ||
    !ts.isBlock(owner.body) ||
    ownerName === undefined ||
    !hasUniqueImport(source, 'Tab') ||
    !hasUniqueImport(source, 'TabItem')
  )
    return undefined;
  const spreads = tab.openingElement.attributes.properties.filter(ts.isJsxSpreadAttribute);
  const spread = spreads.length === 1 ? spreads[0] : undefined;
  if (spread === undefined || !ts.isIdentifier(spread.expression)) return undefined;
  if (
    tab.openingElement.attributes.properties.some(
      (property) =>
        ts.isJsxAttribute(property) &&
        ['activeKey', 'defaultActiveKey', 'onSelect'].includes(property.name.getText(source)),
    )
  )
    return undefined;
  const controller = spread.expression.text;
  const declarations: ts.VariableDeclaration[] = [];
  let references = 0;
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === controller) references += 1;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements.length === 1
    ) {
      const first = node.name.elements[0];
      if (
        first !== undefined &&
        ts.isBindingElement(first) &&
        ts.isIdentifier(first.name) &&
        first.name.text === controller &&
        first.initializer === undefined &&
        first.dotDotDotToken === undefined
      )
        declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(owner);
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  const call =
    declaration?.initializer === undefined
      ? undefined
      : readControllerCall(declaration.initializer);
  if (
    references !== 2 ||
    declaration === undefined ||
    findNearestOverlayRuntimeFunction(declaration) !== owner ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
    call === undefined ||
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    !provenHookNames.has(call.expression.text) ||
    !/^use[A-Z]/u.test(call.expression.text) ||
    !hasUniqueImport(source, call.expression.text)
  )
    return undefined;
  const authored = call.arguments[0];
  if (authored === undefined || !ts.isStringLiteralLike(authored)) return undefined;
  const keys: string[] = [];
  const selected: { key: string; targetName: string }[] = [];
  for (const child of tab.children) {
    if (ts.isJsxText(child) && child.text.trim().length === 0) continue;
    if (!ts.isJsxElement(child) || child.openingElement.tagName.getText(source) !== 'TabItem')
      return undefined;
    const attributes = child.openingElement.attributes.properties;
    if (attributes.some(ts.isJsxSpreadAttribute)) return undefined;
    const eventKeys = attributes.filter(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'eventKey',
    );
    const eventAttribute = eventKeys.length === 1 ? eventKeys[0] : undefined;
    const eventKey =
      eventAttribute !== undefined && ts.isJsxAttribute(eventAttribute)
        ? eventAttribute.initializer
        : undefined;
    if (
      eventKey === undefined ||
      !ts.isStringLiteral(eventKey) ||
      eventKey.text.length === 0 ||
      eventKey.text.length > 128 ||
      keys.includes(eventKey.text)
    )
      return undefined;
    keys.push(eventKey.text);
    const names = new Set<string>();
    const findTarget = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName) &&
        targetNames.has(node.tagName.text) &&
        hasUniqueImport(source, node.tagName.text)
      )
        names.add(node.tagName.text);
      ts.forEachChild(node, findTarget);
    };
    for (const descendant of child.children) findTarget(descendant);
    for (const targetName of names) selected.push({ key: eventKey.text, targetName });
  }
  const choice = selected.length === 1 ? selected[0] : undefined;
  if (
    choice === undefined ||
    keys.length > 8 ||
    !keys.includes(authored.text) ||
    choice.key === authored.text
  )
    return undefined;
  const metadata = {
    sourcePath: path.normalize(source.fileName),
    ownerName,
    targetName: choice.targetName,
    targetKey: choice.key,
    keys,
  };
  return {
    start: authored.getStart(source),
    end: authored.end,
    prefix: `globalThis[Symbol.for(${JSON.stringify(PREVIEW_PAGE_INSPECTOR_API_SYMBOL)})].resolveTargetPageTabDefault((`,
    suffix: `),${JSON.stringify(metadata)})`,
  };
}

/** Unwraps only our exact runtime hook boundary, whose first closure preserves the authored call. */
function readControllerCall(expression: ts.Expression): ts.CallExpression | undefined {
  const unwrap = (value: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    return value;
  };
  const call = unwrap(expression);
  if (!ts.isCallExpression(call)) return undefined;
  if (ts.isIdentifier(call.expression)) return call;
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'resolveRuntimeHook' ||
    !ts.isElementAccessExpression(callee.expression)
  )
    return undefined;
  const api = callee.expression;
  if (!ts.isIdentifier(api.expression) || api.expression.text !== 'globalThis') return undefined;
  const symbol = api.argumentExpression;
  const symbolName = ts.isCallExpression(symbol) ? symbol.arguments[0] : undefined;
  if (
    !ts.isCallExpression(symbol) ||
    !ts.isPropertyAccessExpression(symbol.expression) ||
    !ts.isIdentifier(symbol.expression.expression) ||
    symbol.expression.expression.text !== 'Symbol' ||
    symbol.expression.name.text !== 'for' ||
    symbol.arguments.length !== 1 ||
    symbolName === undefined ||
    !ts.isStringLiteralLike(symbolName) ||
    symbolName.text !== PREVIEW_PAGE_INSPECTOR_API_SYMBOL
  )
    return undefined;
  const closure = call.arguments[0];
  if (
    closure === undefined ||
    !ts.isArrowFunction(closure) ||
    closure.parameters.length !== 0 ||
    ts.isBlock(closure.body) ||
    closure.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  )
    return undefined;
  const authored = unwrap(closure.body);
  return ts.isCallExpression(authored) ? authored : undefined;
}

/** Rejects locally shadowed/redeclared spellings instead of treating names as binding proof. */
function hasUniqueImport(source: ts.SourceFile, name: string): boolean {
  let imports = 0;
  let shadows = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return;
      if (clause?.name?.text === name) imports += 1;
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        imports += clause.namedBindings.elements.filter(
          (binding) => !binding.isTypeOnly && binding.name.text === name,
        ).length;
      }
      return;
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    )
      shadows += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports === 1 && shadows === 0;
}
