/**
 * Finds statically imported leaf route components that can be omitted from a pinned page corridor.
 *
 * Static route registries are more expensive than `React.lazy` registries because esbuild eagerly
 * traverses every imported page. This module uses TypeScript syntax only: an import is eligible when
 * every runtime binding from that exact declaration is used exclusively as the render value of a
 * leaf route carrying a literal `path`/`index` discriminator or as a choice in a literal-base route
 * factory with an authored JSX shell. Layout routes with `children`, namespace imports, side-effect
 * imports, attributes, shadowed bindings, and ambiguous uses fail open.
 */
import ts from 'typescript';

/** One importer-local module edge whose runtime bindings can share an inert route projection. */
export interface PreviewStaticRouteProjection {
  /** Runtime public names requested by the authored import; `default` represents a default import. */
  readonly exportNames: readonly string[];
  /** Exact module spelling from the import declaration. */
  readonly moduleSpecifier: string;
  /** Neutral descendant route identity required by a proven factory submodule collection. */
  readonly neutralRouteBasePath?: string;
}

/** Bounded static-route facts collected from one authored registry. */
export interface PreviewStaticRouteProjectionInventory {
  /** Number of module edges proven to be leaf route branches. */
  readonly branchCount: number;
  /** Projection metadata keyed by exact module spelling. */
  readonly projectionsBySpecifier: ReadonlyMap<string, PreviewStaticRouteProjection>;
  /** All syntax-recognized route edges, including unsafe edges intentionally left authentic. */
  readonly routeBranchSpecifiers: ReadonlySet<string>;
}

/** Mutable facts for one runtime import binding while its source file is traversed once. */
interface MutableBindingUsage {
  /** Public ESM name requested by the local binding. */
  readonly exportName: string;
  /** Exact module spelling owning the binding. */
  readonly moduleSpecifier: string;
  /** Local identifier used inside the importer. */
  readonly localName: string;
  /** Uses located in a statically recognizable leaf-route render position. */
  routeUses: number;
  /** Descendant base path requested when this binding appears in a proven submodule collection. */
  neutralRouteBasePath?: string;
  /** Uses with any other runtime meaning; one is enough to preserve the authentic module. */
  unsafeUses: number;
}

/** Declaration-level demand retained only when every runtime binding is safely projectable. */
interface MutableImportDemand {
  /** Becomes false for namespace, side-effect, attributes, or duplicate ambiguous declarations. */
  safe: boolean;
  /** Runtime bindings declared for this exact module spelling. */
  readonly bindings: MutableBindingUsage[];
}

/** One immutable local object whose imported members may be forwarded into a route page map. */
interface MutableLocalChoiceAggregate {
  /** Direct `const Name = { ... }` declaration skipped until its use sites establish semantics. */
  readonly declaration: ts.VariableDeclaration;
  /** Literal members that can be revisited with route-choice context. */
  readonly initializer: ts.ObjectLiteralExpression;
  /** Guards recursive object spreads such as `const A = { ...B }`. */
  routeExpanded: boolean;
  /** Guards repeated unsafe expansion after an aggregate escapes the route registry. */
  unsafeExpanded: boolean;
}

const ROUTE_RENDER_KEYS = new Set(['component', 'element', 'lazy']);

/**
 * Collects projectable static leaf-route imports without resolving or evaluating any module.
 *
 * @param sourcePath Authored source identity used to select TS versus TSX parsing.
 * @param sourceText Current editor or filesystem snapshot.
 * @returns Import projections plus a broad-registry cardinality used by the esbuild boundary.
 */
export function collectPreviewStaticRouteProjectionInventory(
  sourcePath: string,
  sourceText: string,
): PreviewStaticRouteProjectionInventory {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(sourcePath),
  );
  const demandsBySpecifier = new Map<string, MutableImportDemand>();
  const bindingsByLocalName = new Map<string, MutableBindingUsage[]>();
  const localChoiceAggregates = collectLocalChoiceAggregates(sourceFile);

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    collectImportDemand(statement, demandsBySpecifier, bindingsByLocalName);
  }

  /** Traverses runtime syntax while carrying exact leaf-route render-position evidence. */
  const visit = (node: ts.Node, routeRenderPosition = false): void => {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      localChoiceAggregates.get(node.name.text)?.declaration === node
    ) {
      // The initializer is deliberately delayed. Visiting it here would classify every imported
      // page as an ordinary runtime use before a later `{ ...PageGroup }` establishes route-only
      // semantics. Type annotations still have no runtime edge and therefore need no traversal.
      return;
    }
    if (
      !routeRenderPosition &&
      ts.isCallExpression(node) &&
      visitComponentChoiceFactory(node, visit, (identifier, basePath) => {
        const bindings = bindingsByLocalName.get(identifier.text);
        if (bindings === undefined || !looksLikeComponentBinding(identifier.text)) {
          visit(identifier, false);
          return;
        }
        for (const binding of bindings) {
          recordNeutralRouteUse(binding, createNeutralRouteBasePath(basePath));
        }
      })
    ) {
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      visitJsxRoute(node, visit, routeRenderPosition, (identifier) => {
        const bindings = bindingsByLocalName.get(identifier.text);
        if (bindings === undefined || !looksLikeComponentBinding(identifier.text)) return false;
        for (const binding of bindings) {
          recordNeutralRouteUse(binding, '/__react-preview-omitted__');
        }
        return true;
      });
      return;
    }
    if (ts.isObjectLiteralExpression(node) && isLeafRouteObject(node)) {
      visitObjectRoute(node, visit, routeRenderPosition);
      return;
    }
    if (ts.isIdentifier(node)) {
      const aggregate = localChoiceAggregates.get(node.text);
      if (aggregate !== undefined && isRuntimeIdentifierReference(node)) {
        if (routeRenderPosition) {
          if (!aggregate.routeExpanded) {
            aggregate.routeExpanded = true;
            visitComponentChoiceCollection(aggregate.initializer, visit);
          }
        } else if (!aggregate.unsafeExpanded) {
          // Any read outside the proven page-map slot makes the aggregate observable. Revisit its
          // members as ordinary runtime values so every affected import fails open authentically.
          aggregate.unsafeExpanded = true;
          visit(aggregate.initializer, false);
        }
        return;
      }
      const bindings = bindingsByLocalName.get(node.text);
      if (bindings !== undefined && isRuntimeIdentifierReference(node)) {
        for (const binding of bindings) {
          if (routeRenderPosition && looksLikeComponentBinding(binding.localName)) {
            binding.routeUses += 1;
          } else binding.unsafeUses += 1;
        }
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, routeRenderPosition);
    });
  };
  visit(sourceFile);

  const projectionsBySpecifier = new Map<string, PreviewStaticRouteProjection>();
  const routeBranchSpecifiers = new Set<string>();
  for (const [moduleSpecifier, demand] of demandsBySpecifier) {
    if (demand.bindings.some((binding) => binding.routeUses > 0)) {
      routeBranchSpecifiers.add(moduleSpecifier);
    }
    if (
      !demand.safe ||
      demand.bindings.length === 0 ||
      demand.bindings.some((binding) => binding.routeUses === 0 || binding.unsafeUses > 0)
    ) {
      continue;
    }
    const neutralRouteBasePath = readCommonNeutralRouteBasePath(demand.bindings);
    projectionsBySpecifier.set(moduleSpecifier, {
      exportNames: [...new Set(demand.bindings.map((binding) => binding.exportName))].sort(),
      moduleSpecifier,
      ...(neutralRouteBasePath === undefined ? {} : { neutralRouteBasePath }),
    });
  }
  return {
    branchCount: routeBranchSpecifiers.size,
    projectionsBySpecifier,
    routeBranchSpecifiers,
  };
}

/**
 * Collects only top-level immutable object literals that can be followed without scope analysis.
 *
 * Mutation, reassignment, nested shadowing, destructuring, computed initializers, and arrays are
 * intentionally excluded. A later non-route reference still invalidates every member through the
 * normal unsafe-use accounting above.
 */
function collectLocalChoiceAggregates(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, MutableLocalChoiceAggregate> {
  const aggregates = new Map<string, MutableLocalChoiceAggregate>();
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
        declaration.initializer === undefined ||
        !ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        continue;
      }
      // Duplicate top-level bindings are invalid JavaScript, but preserving neither as a projected
      // aggregate is safer for partially edited buffers than guessing which declaration wins.
      if (aggregates.has(declaration.name.text)) {
        aggregates.delete(declaration.name.text);
        continue;
      }
      aggregates.set(declaration.name.text, {
        declaration,
        initializer: declaration.initializer,
        routeExpanded: false,
        unsafeExpanded: false,
      });
    }
  }
  return aggregates;
}

/**
 * Emits the smallest ESM surface needed by one omitted route branch.
 *
 * Each binding remains callable and JSX-compatible. The function deliberately returns `null` so an
 * accidentally selected stale route cannot obscure the statically pinned candidate with sibling UI.
 */
export function createPreviewStaticRouteProjectionSource(
  projection: PreviewStaticRouteProjection,
): string {
  const lines = [
    '/** Unselected eager route omitted from this pinned static Page Inspector corridor. */',
    'function ReactPreviewStaticCorridorRoute() { return null; }',
  ];
  for (const exportName of projection.exportNames) {
    if (exportName === 'default') {
      lines.push('export default ReactPreviewStaticCorridorRoute;');
    } else {
      lines.push(`export const ${exportName} = ReactPreviewStaticCorridorRoute;`);
    }
  }
  if (projection.neutralRouteBasePath !== undefined) {
    lines.push(
      'Object.defineProperties(ReactPreviewStaticCorridorRoute, {',
      `  basePath: { enumerable: false, value: ${JSON.stringify(projection.neutralRouteBasePath)} },`,
      '  allPages: { enumerable: false, value: Object.freeze([]) },',
      '  pageNames: { enumerable: false, value: Object.freeze([]) },',
      '});',
    );
  }
  return lines.join('\n');
}

/** Records one ordinary default/named ESM declaration or marks its exact edge ambiguous. */
function collectImportDemand(
  declaration: ts.ImportDeclaration,
  demandsBySpecifier: Map<string, MutableImportDemand>,
  bindingsByLocalName: Map<string, MutableBindingUsage[]>,
): void {
  const moduleSpecifier = (declaration.moduleSpecifier as ts.StringLiteralLike).text;
  const demand = demandFor(demandsBySpecifier, moduleSpecifier);
  const clause = declaration.importClause;
  if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    // Type-only imports have no runtime edge and do not make an otherwise safe declaration useful.
    if (clause === undefined) demand.safe = false;
    return;
  }
  if (declaration.attributes !== undefined) demand.safe = false;
  const collected: MutableBindingUsage[] = [];
  if (clause.name !== undefined) {
    collected.push(createBinding(moduleSpecifier, clause.name.text, 'default'));
  }
  if (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
    demand.safe = false;
    collected.push(createBinding(moduleSpecifier, clause.namedBindings.name.text, '*'));
  } else if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) continue;
      if (
        !ts.isIdentifier(element.name) ||
        (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName))
      ) {
        demand.safe = false;
        return;
      }
      const exportName = element.propertyName?.text ?? element.name.text;
      collected.push(createBinding(moduleSpecifier, element.name.text, exportName));
    }
  }
  if (collected.length === 0) return;
  // Two runtime declarations for one module spelling can have different import attributes or
  // evaluation intent. Preserve the authentic edge instead of merging their semantics.
  if (demand.bindings.length > 0) demand.safe = false;
  demand.bindings.push(...collected);
  for (const binding of collected) {
    const existing = bindingsByLocalName.get(binding.localName) ?? [];
    existing.push(binding);
    bindingsByLocalName.set(binding.localName, existing);
  }
}

/** Returns a stable declaration accumulator for one exact module spelling. */
function demandFor(
  demandsBySpecifier: Map<string, MutableImportDemand>,
  moduleSpecifier: string,
): MutableImportDemand {
  const existing = demandsBySpecifier.get(moduleSpecifier);
  if (existing !== undefined) return existing;
  const created: MutableImportDemand = { bindings: [], safe: true };
  demandsBySpecifier.set(moduleSpecifier, created);
  return created;
}

/** Creates one zeroed runtime-binding usage record. */
function createBinding(
  moduleSpecifier: string,
  localName: string,
  exportName: string,
): MutableBindingUsage {
  return { exportName, localName, moduleSpecifier, routeUses: 0, unsafeUses: 0 };
}

/**
 * Records a metadata-only route use while rejecting incompatible contracts on one binding.
 *
 * A single component cannot safely stand in for two unrelated static route bases. Marking that
 * situation unsafe preserves the authored module rather than emitting misleading route metadata.
 */
function recordNeutralRouteUse(binding: MutableBindingUsage, neutralRouteBasePath: string): void {
  if (
    binding.neutralRouteBasePath !== undefined &&
    binding.neutralRouteBasePath !== neutralRouteBasePath
  ) {
    binding.unsafeUses += 1;
    return;
  }
  binding.routeUses += 1;
  binding.neutralRouteBasePath = neutralRouteBasePath;
}

/** Creates one inert descendant identity accepted by a source-proven route-factory base contract. */
function createNeutralRouteBasePath(basePath: string): string {
  const normalizedBase = basePath === '/' ? '' : basePath.replace(/\/+$/u, '');
  return `${normalizedBase}/__react-preview-omitted__`;
}

/** Returns metadata only when every binding from one module edge agrees on the same route base. */
function readCommonNeutralRouteBasePath(
  bindings: readonly MutableBindingUsage[],
): string | undefined {
  const values = new Set(
    bindings
      .map((binding) => binding.neutralRouteBasePath)
      .filter((value): value is string => value !== undefined),
  );
  return values.size === 1 ? [...values][0] : undefined;
}

/** Visits JSX attributes/children, marking only a leaf route's render payload as projectable. */
function visitJsxRoute(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  visit: (node: ts.Node, routeRenderPosition?: boolean) => void,
  inheritedRouteRenderPosition: boolean,
  markRouteBasePathBinding: (identifier: ts.Identifier) => boolean,
): void {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const leafRoute =
    hasJsxRouteDiscriminator(opening.attributes) &&
    !hasJsxChildren(opening) &&
    !hasAuthoredJsxChildren(node);
  const renderedBindingNames = leafRoute
    ? collectJsxRouteRenderBindingNames(opening.attributes)
    : new Set<string>();
  visit(opening.tagName, inheritedRouteRenderPosition);
  for (const property of opening.attributes.properties) {
    if (
      leafRoute &&
      ts.isJsxAttribute(property) &&
      jsxAttributeName(property) === 'path' &&
      property.initializer !== undefined
    ) {
      visitJsxRoutePathExpression(
        property.initializer,
        renderedBindingNames,
        visit,
        markRouteBasePathBinding,
      );
      continue;
    }
    if (
      (leafRoute || inheritedRouteRenderPosition) &&
      ts.isJsxAttribute(property) &&
      (inheritedRouteRenderPosition ||
        ROUTE_RENDER_KEYS.has(jsxAttributeName(property).toLowerCase())) &&
      property.initializer !== undefined
    ) {
      visit(property.initializer, true);
    } else {
      visit(property, false);
    }
  }
  if (ts.isJsxElement(node)) {
    visit(node.closingElement.tagName, inheritedRouteRenderPosition);
    for (const child of node.children) {
      // A route with authored children is a layout/branch boundary, not an omittable leaf.
      visit(child, inheritedRouteRenderPosition);
    }
  }
}

/**
 * Collects identifiers that participate in this exact leaf route's render payload.
 *
 * The set is intentionally lexical rather than name based: a path metadata read is safe only when
 * the same local binding occurs in `element`, `component`, or `lazy` on the same JSX route. Imports
 * used by another sibling route or only by a path helper therefore remain ordinary runtime edges.
 */
function collectJsxRouteRenderBindingNames(attributes: ts.JsxAttributes): ReadonlySet<string> {
  const bindingNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isRuntimeIdentifierReference(node)) {
      bindingNames.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const property of attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      !ROUTE_RENDER_KEYS.has(jsxAttributeName(property).toLowerCase()) ||
      property.initializer === undefined
    ) {
      continue;
    }
    visit(property.initializer);
  }
  return bindingNames;
}

/**
 * Treats `Component.basePath` inside a leaf route discriminator as route metadata, not escape.
 *
 * Route-module factories commonly attach a static `basePath` property to a component and then use
 * the same binding as the route element. Replacing an unselected sibling with a callable component
 * carrying a neutral non-enumerable base path preserves router construction without loading that
 * sibling application. Every other identifier in the expression keeps ordinary unsafe semantics.
 */
function visitJsxRoutePathExpression(
  node: ts.Node,
  renderedBindingNames: ReadonlySet<string>,
  visit: (node: ts.Node, routeRenderPosition?: boolean) => void,
  markRouteBasePathBinding: (identifier: ts.Identifier) => boolean,
): void {
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'basePath' &&
    ts.isIdentifier(node.expression) &&
    renderedBindingNames.has(node.expression.text) &&
    markRouteBasePathBinding(node.expression)
  ) {
    return;
  }
  if (ts.isIdentifier(node)) {
    visit(node, false);
    return;
  }
  ts.forEachChild(node, (child) => {
    visitJsxRoutePathExpression(child, renderedBindingNames, visit, markRouteBasePathBinding);
  });
}

/**
 * Recognizes a broad component-registry factory by argument shape instead of a project API name.
 *
 * Some routers receive an object of page choices plus a later callback that authors the application
 * shell. Only component-shaped imported values inside object arguments preceding
 * that JSX callback are marked as choices; the callee and callback are visited normally, preserving
 * layout/provider imports. Cardinality is enforced later by the build plugin, so small factories
 * remain exact.
 */
function visitComponentChoiceFactory(
  node: ts.CallExpression,
  visit: (node: ts.Node, routeRenderPosition?: boolean) => void,
  markSubmoduleChoice: (identifier: ts.Identifier, basePath: string) => void,
): boolean {
  const basePath = node.arguments[0];
  if (
    basePath === undefined ||
    !ts.isStringLiteralLike(basePath) ||
    !basePath.text.startsWith('/')
  ) {
    return false;
  }
  const shellCallbackIndex = node.arguments.findIndex(
    (argument) => isFunctionLikeArgument(argument) && containsJsxSyntax(argument),
  );
  if (shellCallbackIndex <= 0) return false;
  if (
    !node.arguments
      .slice(0, shellCallbackIndex)
      .some((argument) => ts.isArrayLiteralExpression(argument))
  ) {
    return false;
  }
  const collectionIndexes = node.arguments
    .slice(0, shellCallbackIndex)
    .flatMap((argument, index) => (ts.isObjectLiteralExpression(argument) ? [index] : []));
  if (collectionIndexes.length === 0) return false;
  const collectionIndexSet = new Set(collectionIndexes);
  const submoduleCollectionIndexSet = new Set(
    node.arguments
      .slice(0, shellCallbackIndex)
      .flatMap((argument, index) => (ts.isArrayLiteralExpression(argument) ? [index] : [])),
  );
  visit(node.expression, false);
  node.typeArguments?.forEach((argument) => {
    visit(argument, false);
  });
  node.arguments.forEach((argument, index) => {
    if (collectionIndexSet.has(index)) visitComponentChoiceCollection(argument, visit);
    else if (submoduleCollectionIndexSet.has(index) && ts.isArrayLiteralExpression(argument)) {
      visitSubmoduleCollection(argument, basePath.text, visit, markSubmoduleChoice);
    } else {
      visit(argument, false);
    }
  });
  return true;
}

/**
 * Marks direct imported submodule-array bindings as metadata-bearing neutral route choices.
 *
 * The surrounding literal base path, page map, submodule array, and JSX shell callback together
 * prove the route-factory contract. Computed/spread array elements remain authentic.
 */
function visitSubmoduleCollection(
  node: ts.ArrayLiteralExpression,
  basePath: string,
  visit: (node: ts.Node, routeRenderPosition?: boolean) => void,
  markSubmoduleChoice: (identifier: ts.Identifier, basePath: string) => void,
): void {
  for (const element of node.elements) {
    if (ts.isIdentifier(element)) {
      markSubmoduleChoice(element, basePath);
    } else {
      visit(element, false);
    }
  }
}

/** Marks collection values as choices while keeping object keys and spread expressions exact. */
function visitComponentChoiceCollection(
  node: ts.Expression,
  visit: (node: ts.Node, routeRenderPosition?: boolean) => void,
): void {
  if (!ts.isObjectLiteralExpression(node)) {
    visit(node, false);
    return;
  }
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      visit(property.name, false);
      visit(property.initializer, true);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      visit(property.name, true);
      if (property.objectAssignmentInitializer !== undefined) {
        visit(property.objectAssignmentInitializer, false);
      }
    } else if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)) {
      // A direct imported component/group binding can safely become an empty enumerable function.
      // Computed/local spread expressions remain authentic because their property contract is not
      // visible at this call site.
      visit(property.expression, true);
    } else {
      // Spreads, accessors, and methods can execute arbitrary registry construction logic.
      visit(property, false);
    }
  }
}

/** Restricts factory evidence to authored arrow/function callbacks. */
function isFunctionLikeArgument(
  node: ts.Expression,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** Finds JSX under one callback while ignoring nested function bodies with unrelated UI. */
function containsJsxSyntax(root: ts.ArrowFunction | ts.FunctionExpression): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== root && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Visits object properties, marking only `element`/`component`/`lazy` leaf-route values. */
function visitObjectRoute(
  node: ts.ObjectLiteralExpression,
  visit: (node: ts.Node, routeRenderPosition?: boolean) => void,
  inheritedRouteRenderPosition: boolean,
): void {
  for (const property of node.properties) {
    const propertyName = objectPropertyName(property);
    const routeRenderPosition =
      inheritedRouteRenderPosition ||
      (propertyName !== undefined && ROUTE_RENDER_KEYS.has(propertyName.toLowerCase()));
    if (ts.isPropertyAssignment(property)) {
      visit(property.name, false);
      visit(property.initializer, routeRenderPosition);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      visit(property.name, routeRenderPosition);
      if (property.objectAssignmentInitializer !== undefined) {
        visit(property.objectAssignmentInitializer, false);
      }
    } else {
      visit(property, false);
    }
  }
}

/** Recognizes a leaf route object by syntax, preserving every object that owns nested children. */
function isLeafRouteObject(node: ts.ObjectLiteralExpression): boolean {
  const propertyNames = new Set(node.properties.map(objectPropertyName).filter(isDefined));
  return (
    (propertyNames.has('path') || propertyNames.has('index')) &&
    !propertyNames.has('children') &&
    [...propertyNames].some((name) => ROUTE_RENDER_KEYS.has(name.toLowerCase()))
  );
}

/** Checks JSX `path`/`index` evidence without relying on a framework-specific component name. */
function hasJsxRouteDiscriminator(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some(
    (property) =>
      ts.isJsxAttribute(property) &&
      (jsxAttributeName(property) === 'path' || jsxAttributeName(property) === 'index'),
  );
}

/** Preserves JSX route layouts whose authored children can contain the selected branch. */
function hasJsxChildren(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  return opening.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && jsxAttributeName(property) === 'children',
  );
}

/** Treats non-whitespace JSX children as layout evidence that must remain authentic. */
function hasAuthoredJsxChildren(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  if (!ts.isJsxElement(node)) return false;
  return node.children.some((child) => !ts.isJsxText(child) || child.text.trim().length > 0);
}

/** Reads a stable JSX attribute name while rejecting namespaced spellings. */
function jsxAttributeName(attribute: ts.JsxAttribute): string {
  return ts.isIdentifier(attribute.name) ? attribute.name.text : '';
}

/** Reads an identifier/string property key while rejecting computed runtime expressions. */
function objectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name;
  if (name === undefined) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

/** Excludes declaration names, object keys, property names, labels, and type-only references. */
function isRuntimeIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    (ts.isBreakOrContinueStatement(parent) && parent.label === node) ||
    ts.isTypeNode(parent)
  ) {
    return false;
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  ) {
    // A nested declaration shadows an import. Treating it as unsafe preserves the original edge.
    return true;
  }
  return !isInsideTypeSyntax(node);
}

/** Walks only the short parent chain needed to reject nested generic/type-query positions. */
function isInsideTypeSyntax(node: ts.Node): boolean {
  let current = node.parent;
  while (!ts.isStatement(current) && !ts.isExpression(current)) {
    if (ts.isTypeNode(current) || ts.isImportTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

/** React component values used as indirect registry choices must retain component capitalization. */
function looksLikeComponentBinding(value: string): boolean {
  const firstCharacter = value[0];
  if (firstCharacter === undefined) return false;
  return (
    firstCharacter.toUpperCase() === firstCharacter &&
    firstCharacter.toLowerCase() !== firstCharacter
  );
}

/** Selects TSX parsing for JSX-bearing source extensions while retaining JS syntax compatibility. */
function scriptKindForPath(sourcePath: string): ts.ScriptKind {
  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lowerPath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs') || lowerPath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Narrows an optional string while keeping collection expressions readable. */
function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}
