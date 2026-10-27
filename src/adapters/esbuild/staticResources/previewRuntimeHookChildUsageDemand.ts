/** Collects authored child prop uses, forwarded spreads, and imported bindings. */
import ts from 'typescript';
import {
  collectPreviewRuntimeHookAliasPaths,
  type PreviewRuntimeHookAliasPathCatalog,
} from './previewRuntimeHookAliasUsage';
import {
  collectPreviewRuntimeHookChildShapePaths,
  serializePreviewRuntimeHookChildShape,
} from './previewRuntimeHookChildCollectionDemand';
import {
  BLOCKED_PROP_NAMES,
  COLLECTION_IDENTITY_METHODS,
  MAX_COMPONENT_IMPORTS,
  MAX_PROP_DEMANDS,
  MAX_PROP_DEPTH,
  type ImportedComponentBinding,
  type PreviewRuntimeHookChildPropDemandSource,
  type PreviewRuntimeHookChildPropUsage,
} from './previewRuntimeHookChildDemandModel';
import { functionShadowsName, isPascalCase } from './previewRuntimeHookChildDemandSyntax';
import { mergePreviewRuntimeHookChildPropShapes } from './previewRuntimeHookChildTypeDemand';
import type { PreviewRuntimeFunction } from './previewRuntimeHookSyntax';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import { mergePreviewRuntimeHookCollectionItemExpressions } from './previewRuntimeHookUsageTree';
import { type PreviewInferredPropShape } from './reactExportPropInference';

/** Prioritizes JSX children that directly receive one inline render callback's data binding. */
export function collectInlineRenderPropConsumerBindings(
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      names.size < MAX_COMPONENT_IMPORTS &&
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      isInlineJsxRenderCallback(node)
    ) {
      const bindings = new Set<string>();
      for (const parameter of node.parameters) appendBindingNames(parameter.name, bindings);
      const visitBody = (candidate: ts.Node): void => {
        if (names.size >= MAX_COMPONENT_IMPORTS) return;
        if (
          (ts.isJsxOpeningElement(candidate) || ts.isJsxSelfClosingElement(candidate)) &&
          ts.isIdentifier(candidate.tagName) &&
          isPascalCase(candidate.tagName.text) &&
          candidate.attributes.properties.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.initializer !== undefined &&
              ts.isJsxExpression(attribute.initializer) &&
              attribute.initializer.expression !== undefined &&
              readHookResultRootName(attribute.initializer.expression, bindings) !== undefined,
          )
        ) {
          names.add(candidate.tagName.text);
        }
        ts.forEachChild(candidate, visitBody);
      };
      visitBody(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Recognizes a function supplied as one JSX element's child, `render`, or `children` prop. */
export function isInlineJsxRenderCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  const expression = callback.parent;
  if (!ts.isJsxExpression(expression)) return false;
  const owner = expression.parent;
  if (ts.isJsxElement(owner)) return true;
  if (!ts.isJsxAttribute(owner) || !ts.isIdentifier(owner.name)) return false;
  return owner.name.text === 'children' || owner.name.text === 'render';
}

/** Adds bounded imported JSX consumers used by static render-prop callbacks. */
export function collectAllUsedJsxComponentBindings(
  sourceFile: ts.SourceFile,
  names: Set<string>,
): void {
  const visit = (node: ts.Node): void => {
    if (names.size >= MAX_COMPONENT_IMPORTS) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      isPascalCase(node.tagName.text)
    )
      names.add(node.tagName.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Finds JSX attributes rooted at one hook result and appends the child component's proven demand.
 * Optional source chains stay authored: only a non-optional identity path can make a missing child
 * field a hard requirement on the hook fallback.
 */
export function readPreviewRuntimeHookChildPropUsages(
  identifier: ts.Identifier,
  catalog: PreviewRuntimeHookChildPropDemandSource | undefined,
): readonly PreviewRuntimeHookChildPropUsage[] {
  if (catalog === undefined || (typeof catalog !== 'function' && catalog.size === 0)) return [];
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return [];
  const aliases = collectPreviewRuntimeHookAliasPaths(identifier, owner);
  const spreadObjects = collectPreviewRuntimeHookChildSpreadObjects(owner);
  const usages: PreviewRuntimeHookChildPropUsage[] = [];
  const visit = (node: ts.Node): void => {
    if (usages.length >= MAX_PROP_DEMANDS) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      functionShadowsName(node, identifier.text)
    ) {
      return;
    }
    if (
      ts.isJsxAttribute(node) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression;
      const sourcePaths =
        expression === undefined ? [] : readRequiredAliasPaths(expression, aliases);
      const propName = ts.isIdentifier(node.name) ? node.name.text : undefined;
      const componentName = readJsxAttributeComponentName(node);
      const shape =
        sourcePaths.length === 0 || propName === undefined || componentName === undefined
          ? undefined
          : readChildPropShape(catalog, componentName, propName);
      if (shape !== undefined) {
        for (const sourcePath of sourcePaths) {
          appendShapeUsages(shape, sourcePath, [], usages, 0);
        }
      }
    }
    if (ts.isJsxSpreadAttribute(node)) {
      const componentName = readJsxAttributesComponentName(node.parent);
      const object = readPreviewRuntimeHookChildSpreadObject(
        node.expression,
        spreadObjects,
        node.getStart(),
      );
      if (componentName !== undefined && object !== undefined) {
        for (const property of object.properties) {
          if (usages.length >= MAX_PROP_DEMANDS) break;
          const forwarded = readPreviewRuntimeHookChildSpreadProperty(property);
          if (forwarded === undefined) continue;
          const sourcePaths = readRequiredAliasPaths(forwarded.expression, aliases);
          if (sourcePaths.length === 0) continue;
          const shape = readChildPropShape(catalog, componentName, forwarded.propName);
          if (shape === undefined) continue;
          for (const sourcePath of sourcePaths) {
            appendShapeUsages(shape, sourcePath, [], usages, 0);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return deduplicateUsages(usages);
}

/**
 * Reads the demand of a child prop that receives a hook call directly.
 *
 * A wrapper page commonly forwards context without first naming it:
 * `context={useAppContext()}`. There is no local identifier for the ordinary usage walker to
 * follow, but the exact JSX attribute and reached child contract still prove the hook root shape.
 * Only a direct JSX expression is admitted so arbitrary transforms remain authored.
 */
export function readPreviewRuntimeHookDirectChildPropUsages(
  expression: ts.Expression,
  catalog: PreviewRuntimeHookChildPropDemandSource | undefined,
): readonly PreviewRuntimeHookChildPropUsage[] {
  if (catalog === undefined || (typeof catalog !== 'function' && catalog.size === 0)) return [];
  const jsxExpression = expression.parent;
  if (
    !ts.isJsxExpression(jsxExpression) ||
    jsxExpression.expression !== expression ||
    !ts.isJsxAttribute(jsxExpression.parent)
  ) {
    return [];
  }
  const attribute = jsxExpression.parent;
  const propName = ts.isIdentifier(attribute.name) ? attribute.name.text : undefined;
  const componentName = readJsxAttributeComponentName(attribute);
  const shape =
    propName === undefined || componentName === undefined
      ? undefined
      : readChildPropShape(catalog, componentName, propName);
  if (shape === undefined) return [];
  const usages: PreviewRuntimeHookChildPropUsage[] = [];
  appendShapeUsages(shape, [], [], usages, 0);
  return deduplicateUsages(usages);
}

/** Reads a child contract only after the caller has proved its exact source path and JSX prop. */
function readChildPropShape(
  source: PreviewRuntimeHookChildPropDemandSource,
  componentName: string,
  propName: string,
): PreviewInferredPropShape | undefined {
  return (typeof source === 'function' ? source() : source).get(componentName)?.get(propName);
}

/** Indexes default and named imports; namespace/member JSX remains conservatively unsupported. */
export function collectImportedComponentBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ImportedComponentBinding> {
  const bindings = new Map<string, ImportedComponentBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (clause.name !== undefined && isPascalCase(clause.name.text)) {
      bindings.set(clause.name.text, { exportName: 'default', moduleSpecifier });
    }
    const named = clause.namedBindings;
    if (named === undefined || ts.isNamespaceImport(named)) continue;
    for (const element of named.elements) {
      if (element.isTypeOnly || !isPascalCase(element.name.text)) continue;
      bindings.set(element.name.text, {
        exportName: element.propertyName?.text ?? element.name.text,
        moduleSpecifier,
      });
    }
  }
  return bindings;
}

/** Collects local names bound directly from one syntactically recognizable hook call. */
export function collectHookResultBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const initializer = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isCallExpression(initializer) && isHookCallee(initializer.expression)) {
        appendBindingNames(node.name, names);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Recognizes direct and namespace hook names without resolving their implementation. */
export function isHookCallee(expression: ts.LeftHandSideExpression): boolean {
  const unwrapped = unwrapPreviewRuntimeExpression(expression);
  const name = ts.isIdentifier(unwrapped)
    ? unwrapped.text
    : ts.isPropertyAccessExpression(unwrapped)
      ? unwrapped.name.text
      : '';
  return /^use[A-Z0-9_$]/u.test(name);
}

/** Records identifier leaves from one hook-result binding pattern. */
export function appendBindingNames(binding: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(binding)) {
    names.add(binding.text);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNames(element.name, names);
  }
}

/** Collects JSX components whose attribute directly receives one hook-result identity path. */
export function collectUsedJsxComponentBindings(
  sourceFile: ts.SourceFile,
  hookResultBindings: ReadonlySet<string>,
): ReadonlySet<string> {
  const names = new Set<string>();
  if (hookResultBindings.size === 0) return names;
  const visit = (node: ts.Node): void => {
    if (names.size >= MAX_COMPONENT_IMPORTS) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const receivesHookResult = node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.initializer !== undefined &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression !== undefined &&
          readHookResultRootName(attribute.initializer.expression, hookResultBindings) !==
            undefined,
      );
      if (receivesHookResult && ts.isIdentifier(node.tagName) && isPascalCase(node.tagName.text))
        names.add(node.tagName.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Reads the identifier root of a direct, non-optional property carrier. */
export function readHookResultRootName(
  expression: ts.Expression,
  hookResultBindings: ReadonlySet<string>,
): string | undefined {
  let current = unwrapRequiredCollectionCarrier(expression);
  if (current === undefined) return undefined;
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && hookResultBindings.has(current.text)
    ? current.text
    : undefined;
}

/** Reads the owning simple JSX tag for one attribute. */
export function readJsxAttributeComponentName(attribute: ts.JsxAttribute): string | undefined {
  return readJsxAttributesComponentName(attribute.parent);
}

/** Reads the owning simple JSX tag shared by ordinary and spread attributes. */
export function readJsxAttributesComponentName(attributes: ts.JsxAttributes): string | undefined {
  const element = attributes.parent;
  return (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
    ts.isIdentifier(element.tagName)
    ? element.tagName.text
    : undefined;
}

/** Indexes unique immutable object literals that may be forwarded through one JSX spread. */
export function collectPreviewRuntimeHookChildSpreadObjects(
  owner: PreviewRuntimeFunction,
): ReadonlyMap<string, ts.ObjectLiteralExpression> {
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const ambiguous = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const value = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isObjectLiteralExpression(value)) {
        const name = node.name.text;
        if (objects.has(name)) {
          objects.delete(name);
          ambiguous.add(name);
        } else if (!ambiguous.has(name)) {
          objects.set(name, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return objects;
}

/** Resolves a direct or uniquely named const object used by a JSX spread before that use. */
export function readPreviewRuntimeHookChildSpreadObject(
  expression: ts.Expression,
  objects: ReadonlyMap<string, ts.ObjectLiteralExpression>,
  usageStart: number,
): ts.ObjectLiteralExpression | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const object = objects.get(value.text);
  return object !== undefined && object.end <= usageStart ? object : undefined;
}

/** Reads one prototype-safe identity property from an object forwarded to a child component. */
export function readPreviewRuntimeHookChildSpreadProperty(
  property: ts.ObjectLiteralElementLike,
): Readonly<{ expression: ts.Expression; propName: string }> | undefined {
  if (ts.isShorthandPropertyAssignment(property)) {
    return BLOCKED_PROP_NAMES.has(property.name.text)
      ? undefined
      : { expression: property.name, propName: property.name.text };
  }
  if (!ts.isPropertyAssignment(property)) return undefined;
  const propName =
    ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
      ? property.name.text
      : undefined;
  return propName === undefined || BLOCKED_PROP_NAMES.has(propName)
    ? undefined
    : { expression: property.initializer, propName };
}

/** Reads a non-optional identifier/property chain rooted at a proven immutable hook alias. */
export function readRequiredAliasPaths(
  expression: ts.Expression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
): readonly (readonly string[])[] {
  const suffix: string[] = [];
  let current = unwrapRequiredCollectionCarrier(expression);
  if (current === undefined) return [];
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return [];
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return [];
  return (aliases.get(current.text) ?? []).map((prefix) => [...prefix, ...suffix]);
}

/**
 * Flattens operation-proven child leaves onto the hook-relative carrier path.
 *
 * Visit shallow siblings before deep descendants. A wide form contract can otherwise spend the
 * bounded demand budget inside its first nested field and omit a later Array/object container
 * that the reached child reads eagerly (for example with `Object.entries`).
 */
export function appendShapeUsages(
  shape: PreviewInferredPropShape,
  sourcePath: readonly string[],
  relativePath: readonly string[],
  usages: PreviewRuntimeHookChildPropUsage[],
  depth: number,
): void {
  const pending: {
    readonly depth: number;
    readonly relativePath: readonly string[];
    readonly shape: PreviewInferredPropShape;
  }[] = [{ depth, relativePath, shape }];
  for (let index = 0; index < pending.length && usages.length < MAX_PROP_DEMANDS; index += 1) {
    const current = pending[index];
    if (current === undefined || current.depth > MAX_PROP_DEPTH) continue;
    const names = [...sourcePath, ...current.relativePath];
    if (current.shape.kind === 'array') {
      const itemExpression =
        current.shape.items === undefined
          ? undefined
          : serializePreviewRuntimeHookChildShape(current.shape.items, names.at(-1) ?? 'item');
      const itemRequiredPaths =
        current.shape.items === undefined
          ? []
          : collectPreviewRuntimeHookChildShapePaths(current.shape.items);
      usages.push({
        called: false,
        ...(itemExpression === undefined ? {} : { collectionItemExpression: itemExpression }),
        ...(itemRequiredPaths.length === 0
          ? {}
          : { collectionItemRequiredPaths: Object.freeze(itemRequiredPaths) }),
        collectionProperty: 'map',
        names,
      });
      continue;
    }
    if (current.shape.kind === 'function') {
      usages.push({ called: true, names });
      continue;
    }
    if (
      current.shape.kind === 'boolean' ||
      current.shape.kind === 'null' ||
      current.shape.kind === 'number'
    ) {
      usages.push({
        called: false,
        names,
        ...(current.shape.exactValue === true ? { renderGuard: true as const } : {}),
        valueExpression: serializePreviewRuntimeHookChildShape(
          current.shape,
          names.at(-1) ?? 'value',
        ),
      });
      continue;
    }
    if (current.shape.kind === 'string') {
      usages.push(
        current.shape.value === undefined
          ? { called: false, names, stringProperty: 'trim' }
          : {
              called: false,
              names,
              ...(current.shape.exactValue === true ? { renderGuard: true as const } : {}),
              valueExpression: serializePreviewRuntimeHookChildShape(
                current.shape,
                names.at(-1) ?? 'value',
              ),
            },
      );
      continue;
    }
    if (current.shape.kind !== 'object' || current.shape.properties === undefined) continue;
    const properties = Object.entries(current.shape.properties);
    if (properties.length === 0) {
      usages.push({ called: false, names });
      continue;
    }
    for (const [propertyName, child] of properties) {
      pending.push({
        depth: current.depth + 1,
        relativePath: [...current.relativePath, propertyName],
        shape: child,
      });
    }
  }
}

/** Keeps one source-ordered occurrence of every propagated component-prop demand. */
export function deduplicateUsages(
  usages: readonly PreviewRuntimeHookChildPropUsage[],
): readonly PreviewRuntimeHookChildPropUsage[] {
  const retained = new Map<string, PreviewRuntimeHookChildPropUsage>();
  for (const usage of usages) {
    const terminalKind =
      usage.valueExpression === undefined
        ? (usage.collectionProperty ?? usage.stringProperty ?? (usage.called ? 'call' : 'value'))
        : 'expression';
    const key = `${usage.names.join('.')}\u0000${terminalKind}`;
    const existing = retained.get(key);
    if (existing === undefined) {
      retained.set(key, usage);
      continue;
    }
    const requiredPaths = [
      ...new Set([
        ...(existing.collectionItemRequiredPaths ?? []),
        ...(usage.collectionItemRequiredPaths ?? []),
      ]),
    ];
    const collectionItemExpression = mergePreviewRuntimeHookCollectionItemExpressions(
      existing.collectionItemExpression,
      usage.collectionItemExpression,
    );
    retained.set(key, {
      ...existing,
      ...(collectionItemExpression === undefined ? {} : { collectionItemExpression }),
      ...(requiredPaths.length === 0
        ? {}
        : { collectionItemRequiredPaths: Object.freeze(requiredPaths) }),
      ...(existing.renderGuard === true || usage.renderGuard !== true
        ? {}
        : { renderGuard: true as const }),
    });
  }
  return [...retained.values()];
}

/**
 * Peels only collection transforms that retain each element's authored identity.
 *
 * `filter`, `slice`, and the non-mutating ordering helpers may change membership/order but never
 * change an item's contract. Mapping or arbitrary calls remain unsupported because propagating a
 * child's fields through a transform would invent a relationship that syntax did not prove.
 */
export function unwrapRequiredCollectionCarrier(
  expression: ts.Expression,
): ts.Expression | undefined {
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isCallExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    const callee = unwrapPreviewRuntimeExpression(current.expression);
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken !== undefined ||
      !COLLECTION_IDENTITY_METHODS.has(callee.name.text)
    ) {
      return undefined;
    }
    current = unwrapPreviewRuntimeExpression(callee.expression);
  }
  return current;
}

/** Merges operation-derived and recursively resolved type shapes for each exact component export. */
export function mergeComponentInferences(
  usage: Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>>,
  typed: Readonly<Record<string, PreviewInferredPropShape>>,
): Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> {
  const result: Record<string, { readonly shape: PreviewInferredPropShape }> = {};
  for (const exportName of new Set([...Object.keys(usage), ...Object.keys(typed)])) {
    const shape = mergePreviewRuntimeHookChildPropShapes(
      usage[exportName]?.shape,
      typed[exportName],
    );
    if (shape !== undefined) result[exportName] = Object.freeze({ shape });
  }
  return Object.freeze(result);
}
