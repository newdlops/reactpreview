/**
 * Extracts inert per-module value-flow facts for application render-chain discovery.
 * The collector intentionally models ordinary top-level values as well as React components: route
 * arrays, router objects, page maps, and conditional app selectors are the connective tissue that
 * a JSX-owner-only traversal loses. No project expression is evaluated by this module.
 */
import path from 'node:path';
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import type {
  PreviewRenderChainCertainty,
  PreviewRenderChainEdgeKind,
  PreviewRenderInvocation,
} from './previewRenderGraphTypes';
import { readPreviewRenderInvocation } from './previewRenderInvocation';
import { collectPreviewRenderDeferredImportFacts } from './previewRenderDeferredImportFacts';

/** One top-level declaration that can carry a component through route/configuration value flow. */
export interface PreviewRenderValueFact {
  /** Stable source-local declaration identity. */
  readonly id: string;
  /** Human-readable declaration name used in diagnostics and the Inspector toolbar. */
  readonly label: string;
  /** Local binding referenced by other declarations in this module. */
  readonly localName: string;
  /** Source offset used to distinguish declarations and rank deterministic paths. */
  readonly occurrenceStart: number;
  /** Whether syntax suggests this value is route/configuration data rather than a component owner. */
  readonly routeLike: boolean;
}

/** Static ESM binding resolved later with the consumer's nearest tsconfig/jsconfig. */
export interface PreviewRenderImportFact {
  /** Export spelling read from the imported module; `*` denotes a namespace binding. */
  readonly importedName: string;
  /** Consumer-local identifier. */
  readonly localName: string;
  /** Authored module specifier retained until the graph index applies project resolution. */
  readonly moduleSpecifier: string;
}

/** One public module export and the local/imported value that supplies it. */
export interface PreviewRenderExportFact {
  /** Runtime export spelling, including `default`. */
  readonly exportName: string;
  /** Local binding supplying this export, when the clause does not re-export directly. */
  readonly localName?: string;
  /** Source export spelling for a direct `export ... from` edge. */
  readonly reexportedName?: string;
  /** Module specifier for a direct or wildcard re-export. */
  readonly moduleSpecifier?: string;
  /** Source offset of the export evidence. */
  readonly occurrenceStart: number;
  /** Whether this fact represents `export * from` and therefore resolves names on demand. */
  readonly wildcard: boolean;
}

/** One declaration-to-declaration reference within the same authored module. */
export interface PreviewRenderLocalEdgeFact {
  /** Runtime conditionality inferred from route/config syntax around this edge. */
  readonly certainty: PreviewRenderChainCertainty;
  /** Inner local/import binding consumed by the owner. */
  readonly childLocalName: string;
  /** Structural relationship visible at the exact occurrence. */
  readonly kind: Exclude<PreviewRenderChainEdgeKind, 'react-lazy' | 're-export' | 'entry-render'>;
  /** React-specific HOC or component-slot transport proven around this reference. */
  readonly invocation?: PreviewRenderInvocation;
  /** Outer top-level declaration containing the reference. */
  readonly ownerId: string;
  /** Source offset of the identifier or JSX tag reference. */
  readonly occurrenceStart: number;
  /** Component-like JSX ancestors crossed at the occurrence, ordered inner-to-outer. */
  readonly wrapperNames: readonly string[];
}

/** Literal deferred-export identity carried by a lazy boundary or factory result. */
export interface PreviewRenderLazyFact {
  /** Generic loader arguments prove conditional value flow, without asserting React.lazy. */
  readonly kind?: 'value-flow';
  /** Export selected from the dynamically imported module. */
  readonly importedName: string;
  /** Literal authored dynamic-import specifier. */
  readonly moduleSpecifier: string;
  /** Top-level declaration that receives the lazy component value. */
  readonly ownerId: string;
  /** Source offset of the lazy call. */
  readonly occurrenceStart: number;
}

/** Complete syntax-only facts for one source module, safe to cache without retaining AST nodes. */
export interface PreviewRenderModuleFacts {
  readonly exports: readonly PreviewRenderExportFact[];
  readonly imports: readonly PreviewRenderImportFact[];
  readonly lazyImports: readonly PreviewRenderLazyFact[];
  readonly localEdges: readonly PreviewRenderLocalEdgeFact[];
  readonly sourcePath: string;
  readonly values: readonly PreviewRenderValueFact[];
}

/** Mutable declaration retained only while one source AST is being analyzed. */
interface MutableValueFact {
  readonly analysisNode: ts.Node;
  readonly id: string;
  readonly label: string;
  readonly localName: string;
  readonly occurrenceStart: number;
  readonly routeLike: boolean;
}

/** JSX nodes whose context-free label contributions can be reused during one module analysis. */
type JsxWrapperElement = ts.JsxElement | ts.JsxSelfClosingElement;

const NO_WRAPPER_NAMES: readonly string[] = Object.freeze([]);

/**
 * Parses one authored module into bounded declarations, imports, exports, lazy edges, and value flow.
 *
 * @param sourcePath Absolute source identity used for stable declaration IDs and TSX grammar.
 * @param sourceText Current editor-or-disk source; callers own byte and file-count budgets.
 * @returns Frozen facts containing no TypeScript nodes or application values.
 */
export function collectPreviewRenderModuleFacts(
  sourcePath: string,
  sourceText: string,
): PreviewRenderModuleFacts {
  const normalizedPath = path.normalize(sourcePath);
  const sourceFile = readPreviewAnalysisSourceFile(
    normalizedPath,
    sourceText,
    normalizedPath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return collectPreviewRenderModuleFactsFromSourceFile(normalizedPath, sourceFile);
}

/**
 * Extracts module facts from a caller-owned AST so render-chain planning can share one parse with
 * semantic ReactDOM entry discovery on large workspaces.
 *
 * @param sourcePath Absolute source identity associated with `sourceFile`.
 * @param sourceFile Already parsed current source with parent links enabled.
 * @returns Frozen facts that do not retain the caller's AST.
 */
export function collectPreviewRenderModuleFactsFromSourceFile(
  sourcePath: string,
  sourceFile: ts.SourceFile,
): PreviewRenderModuleFacts {
  const normalizedPath = path.normalize(sourcePath);
  const imports = collectImports(sourceFile);
  const values = collectValues(normalizedPath, sourceFile);
  const localNames = new Set([
    ...imports.map((fact) => fact.localName),
    ...values.map((fact) => fact.localName),
  ]);
  const routeLikeNames = new Set(
    values.filter((value) => value.routeLike).map((value) => value.localName),
  );
  const exports = collectExports(sourceFile, values, imports);
  const lazyImports = collectPreviewRenderDeferredImportFacts(sourceFile, values);
  const wrapperNamesByElement = new Map<JsxWrapperElement, readonly string[]>();
  const localEdges = values.flatMap((value) =>
    collectLocalEdges(value, localNames, routeLikeNames, wrapperNamesByElement),
  );

  return Object.freeze({
    exports: Object.freeze(exports),
    imports: Object.freeze(imports),
    lazyImports: Object.freeze(lazyImports),
    localEdges: Object.freeze(localEdges),
    sourcePath: normalizedPath,
    values: Object.freeze(
      values.map(({ id, label, localName, occurrenceStart, routeLike }) =>
        Object.freeze({ id, label, localName, occurrenceStart, routeLike }),
      ),
    ),
  });
}

/** Collects all runtime import bindings while ignoring type-only declarations and specifiers. */
function collectImports(sourceFile: ts.SourceFile): PreviewRenderImportFact[] {
  const imports: PreviewRenderImportFact[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined) {
      continue;
    }
    if (clause.name !== undefined) {
      imports.push({
        importedName: 'default',
        localName: clause.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      });
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      imports.push({
        importedName: '*',
        localName: bindings.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      });
      continue;
    }
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) {
        imports.push({
          importedName: (element.propertyName ?? element.name).text,
          localName: element.name.text,
          moduleSpecifier: statement.moduleSpecifier.text,
        });
      }
    }
  }
  return imports;
}

/** Inventories top-level named functions, classes, and variable declarations as graph values. */
function collectValues(sourcePath: string, sourceFile: ts.SourceFile): MutableValueFact[] {
  const values: MutableValueFact[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name !== undefined) {
        values.push(createMutableValue(sourcePath, statement.name.text, statement, statement));
      } else if (
        hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      ) {
        values.push(createMutableValue(sourcePath, '@default', statement, statement));
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const identifier of collectBindingIdentifiers(declaration.name)) {
          values.push(
            createMutableValue(
              sourcePath,
              identifier.text,
              identifier,
              declaration.initializer ?? declaration,
            ),
          );
        }
      }
      continue;
    }
    if (
      ts.isExportAssignment(statement) &&
      !ts.isIdentifier(unwrapDefaultExportExpression(statement.expression))
    ) {
      values.push(
        createMutableValue(
          sourcePath,
          '@default',
          statement,
          statement.expression,
          readDefaultExpressionLabel(statement.expression),
        ),
      );
      continue;
    }
    const commonJsDefault = readCommonJsDefaultExpression(statement);
    if (commonJsDefault !== undefined && !ts.isIdentifier(commonJsDefault)) {
      values.push(
        createMutableValue(
          sourcePath,
          '@default',
          statement,
          commonJsDefault,
          readDefaultExpressionLabel(commonJsDefault),
        ),
      );
    }
  }
  return values;
}

/** Creates one declaration fact and classifies route/config values without executing them. */
function createMutableValue(
  sourcePath: string,
  localName: string,
  declarationNode: ts.Node,
  analysisNode: ts.Node,
  label = localName,
): MutableValueFact {
  const occurrenceStart = declarationNode.getStart();
  return {
    analysisNode,
    id: `${sourcePath}\0${localName}\0${occurrenceStart.toString()}`,
    label,
    localName,
    occurrenceStart,
    routeLike: isRouteLikeValue(localName, analysisNode),
  };
}

/** Maps export modifiers, clauses, assignments, and direct barrels to runtime export facts. */
function collectExports(
  sourceFile: ts.SourceFile,
  values: readonly MutableValueFact[],
  imports: readonly PreviewRenderImportFact[],
): PreviewRenderExportFact[] {
  const exports: PreviewRenderExportFact[] = [];
  const valueNames = new Set(values.map((value) => value.localName));
  const importNames = new Set(imports.map((fact) => fact.localName));
  for (const statement of sourceFile.statements) {
    const commonJsDefault = readCommonJsDefaultExpression(statement);
    if (commonJsDefault !== undefined) {
      exports.push({
        exportName: 'default',
        localName: ts.isIdentifier(commonJsDefault) ? commonJsDefault.text : '@default',
        occurrenceStart: statement.getStart(),
        wildcard: false,
      });
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      const expression = unwrapDefaultExportExpression(statement.expression);
      exports.push({
        exportName: 'default',
        localName: ts.isIdentifier(expression) ? expression.text : '@default',
        occurrenceStart: statement.getStart(),
        wildcard: false,
      });
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      collectExportDeclarationFacts(statement, valueNames, importNames, exports);
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    const defaultExport = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const localName = statement.name?.text ?? (defaultExport ? '@default' : undefined);
      if (localName === undefined) {
        continue;
      }
      exports.push({
        exportName: defaultExport ? 'default' : localName,
        localName,
        occurrenceStart: statement.getStart(),
        wildcard: false,
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const identifier of collectBindingIdentifiers(declaration.name)) {
          exports.push({
            exportName: identifier.text,
            localName: identifier.text,
            occurrenceStart: identifier.getStart(),
            wildcard: false,
          });
        }
      }
    }
  }
  return deduplicateExports(exports);
}

/** Removes only parentheses and erased TypeScript wrappers; calls and value-producing operators retain separate identities. */
function unwrapDefaultExportExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Flattens runtime identifiers introduced by one top-level variable binding pattern. */
function collectBindingIdentifiers(bindingName: ts.BindingName): readonly ts.Identifier[] {
  if (ts.isIdentifier(bindingName)) return [bindingName];
  return bindingName.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : collectBindingIdentifiers(element.name),
  );
}

/** Recognizes the CommonJS default assignment already admitted by the target export selector. */
function readCommonJsDefaultExpression(statement: ts.Statement): ts.Expression | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
    return undefined;
  }
  const assignment = statement.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return undefined;
  }
  const target = assignment.left;
  if (ts.isPropertyAccessExpression(target)) {
    return ts.isIdentifier(target.expression) &&
      target.expression.text === 'module' &&
      target.name.text === 'exports'
      ? assignment.right
      : undefined;
  }
  if (!ts.isElementAccessExpression(target) || !ts.isIdentifier(target.expression)) {
    return undefined;
  }
  return target.expression.text === 'module' &&
    ts.isStringLiteralLike(target.argumentExpression) &&
    target.argumentExpression.text === 'exports'
    ? assignment.right
    : undefined;
}

/** Uses an authored function/class name when present and an internal anonymous-default marker otherwise. */
function readDefaultExpressionLabel(expression: ts.Expression): string {
  return (ts.isFunctionExpression(expression) || ts.isClassExpression(expression)) &&
    expression.name !== undefined
    ? expression.name.text
    : '@default';
}

/** Adds named/direct/wildcard export declaration facts without resolving their module yet. */
function collectExportDeclarationFacts(
  statement: ts.ExportDeclaration,
  valueNames: ReadonlySet<string>,
  importNames: ReadonlySet<string>,
  exports: PreviewRenderExportFact[],
): void {
  const specifierNode = statement.moduleSpecifier;
  const moduleSpecifier =
    specifierNode !== undefined && ts.isStringLiteralLike(specifierNode)
      ? specifierNode.text
      : undefined;
  const clause = statement.exportClause;
  if (clause === undefined && moduleSpecifier !== undefined) {
    exports.push({
      exportName: '*',
      moduleSpecifier,
      occurrenceStart: statement.getStart(),
      wildcard: true,
    });
    return;
  }
  if (clause === undefined || !ts.isNamedExports(clause)) {
    return;
  }
  for (const element of clause.elements) {
    if (element.isTypeOnly) {
      continue;
    }
    const localOrImportedName = (element.propertyName ?? element.name).text;
    if (moduleSpecifier !== undefined) {
      exports.push({
        exportName: element.name.text,
        moduleSpecifier,
        occurrenceStart: element.getStart(),
        reexportedName: localOrImportedName,
        wildcard: false,
      });
    } else if (valueNames.has(localOrImportedName) || importNames.has(localOrImportedName)) {
      exports.push({
        exportName: element.name.text,
        localName: localOrImportedName,
        occurrenceStart: element.getStart(),
        wildcard: false,
      });
    }
  }
}

/** Prevents duplicate syntax forms from producing duplicate graph frontiers. */
function deduplicateExports(
  exports: readonly PreviewRenderExportFact[],
): PreviewRenderExportFact[] {
  const seen = new Set<string>();
  return exports.filter((fact) => {
    const key = `${fact.exportName}\0${fact.localName ?? ''}\0${fact.moduleSpecifier ?? ''}\0${fact.reexportedName ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Collects declaration references and classifies JSX, route, and ordinary value-flow edges. */
function collectLocalEdges(
  owner: MutableValueFact,
  knownLocalNames: ReadonlySet<string>,
  routeLikeNames: ReadonlySet<string>,
  wrapperNamesByElement: Map<JsxWrapperElement, readonly string[]>,
): PreviewRenderLocalEdgeFact[] {
  const edges: PreviewRenderLocalEdgeFact[] = [];
  const seen = new Set<string>();
  visit(owner.analysisNode);
  return edges;

  /** Traverses the owner body while excluding identifier positions that do not read a value. */
  function visit(node: ts.Node): void {
    if (
      ts.isIdentifier(node) &&
      node.text !== owner.localName &&
      knownLocalNames.has(node.text) &&
      isRuntimeValueReference(node) &&
      !isInsideTaggedTemplateBody(node, owner.analysisNode)
    ) {
      const wrapperNames = collectWrapperNames(node, owner.analysisNode, wrapperNamesByElement);
      const routeEdge =
        owner.routeLike || wrapperNames.some(isRouteLabel) || routeLikeNames.has(node.text);
      const kind = classifyLocalEdge(node, routeEdge);
      const invocation = readPreviewRenderInvocation(node, owner.analysisNode);
      const occurrenceStart = node.getStart();
      const key = `${node.text}\0${kind}\0${occurrenceStart.toString()}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          certainty: routeEdge ? 'conditional' : 'confirmed',
          childLocalName: node.text,
          ...(invocation === undefined ? {} : { invocation }),
          kind,
          ownerId: owner.id,
          occurrenceStart,
          wrapperNames: Object.freeze(wrapperNames),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
}

/**
 * Rejects value reads from a tagged template's payload while preserving reads from its tag.
 *
 * A styled-components selector such as `styled.div`${Section}`` consumes `Section` as CSS
 * metadata; it does not render the component. Conversely, `styled(Section)`` legitimately wraps
 * the component through the tag expression and remains part of the render value-flow graph.
 */
function isInsideTaggedTemplateBody(node: ts.Node, boundary: ts.Node): boolean {
  let current = node;
  while (current !== boundary && !ts.isSourceFile(current)) {
    const parent = current.parent;
    if (ts.isTaggedTemplateExpression(parent) && parent.template === current) {
      return true;
    }
    current = parent;
  }
  return false;
}

/** Classifies a local read by its JSX/createElement/route context. */
function classifyLocalEdge(
  node: ts.Identifier,
  routeEdge: boolean,
): PreviewRenderLocalEdgeFact['kind'] {
  if (routeEdge) {
    return 'route-branch';
  }
  if (isJsxTagIdentifier(node)) {
    return 'component-render';
  }
  return isInsideCreateElementCall(node) ? 'create-element' : 'value-flow';
}

/** Returns component-like JSX ancestors around one reference, nearest wrapper first. */
function collectWrapperNames(
  node: ts.Node,
  boundary: ts.Node,
  wrapperNamesByElement: Map<JsxWrapperElement, readonly string[]>,
): string[] {
  const names: string[] = [];
  const directParent = node.parent;
  let current: ts.Node =
    (ts.isJsxOpeningElement(directParent) || ts.isJsxSelfClosingElement(directParent)) &&
    directParent.tagName === node
      ? directParent.parent
      : directParent;
  while (current !== boundary && !ts.isSourceFile(current)) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      for (const name of readWrapperElementNames(current, wrapperNamesByElement)) {
        if (names.at(-1) !== name) names.push(name);
      }
    }
    current = current.parent;
  }
  return names;
}

/**
 * Reads one element's own labels without caching its owner-dependent ancestry or route decision.
 *
 * @param element Current immutable parser element.
 * @param namesByElement Temporary module-local catalog, discarded when collection returns.
 * @returns Route-element labels followed by the element's own component label in original order.
 */
function readWrapperElementNames(
  element: JsxWrapperElement,
  namesByElement: Map<JsxWrapperElement, readonly string[]>,
): readonly string[] {
  const tagName = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
  if (!mayHaveComponentTagName(tagName)) return NO_WRAPPER_NAMES;
  const previous = namesByElement.get(element);
  if (previous !== undefined) return previous;
  const names = ts.isJsxElement(element)
    ? [...readRouteElementWrapperNames(element.openingElement)]
    : [];
  const name = readJsxTagName(tagName);
  if (name !== undefined) names.push(name);
  namesByElement.set(element, names);
  return names;
}

/**
 * Reads the component at a React Router `<Route element={...}>` boundary.
 * The element expression is a sibling attribute rather than an AST ancestor of route children, so
 * preserving it explicitly is required to recover layouts and guards surrounding an `<Outlet>`.
 */
function readRouteElementWrapperNames(openingElement: ts.JsxOpeningElement): readonly string[] {
  if (readJsxTagName(openingElement.tagName) !== 'Route') {
    return [];
  }
  const elementAttribute = openingElement.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === 'element',
  );
  const expression = elementAttribute?.initializer;
  if (
    expression === undefined ||
    !ts.isJsxExpression(expression) ||
    expression.expression === undefined
  ) {
    return [];
  }
  const rootExpression = ts.isParenthesizedExpression(expression.expression)
    ? expression.expression.expression
    : expression.expression;
  if (ts.isJsxElement(rootExpression)) {
    const name = readJsxTagName(rootExpression.openingElement.tagName);
    return name === undefined ? [] : [name];
  }
  if (ts.isJsxSelfClosingElement(rootExpression)) {
    const name = readJsxTagName(rootExpression.tagName);
    return name === undefined ? [] : [name];
  }
  return [];
}

/** Rejects declarations, property names, JSX closing tags, types, and other non-read identifiers. */
function isRuntimeValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    ((ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isParameter(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) &&
      parent.name === node &&
      !ts.isComputedPropertyName(parent.name)) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    ts.isTypeNode(parent) ||
    ts.isJsxClosingElement(parent)
  ) {
    return false;
  }
  return !isInsideTypeSyntax(node);
}

/** Walks parents to reject identifiers nested anywhere inside erased TypeScript syntax. */
function isInsideTypeSyntax(node: ts.Node): boolean {
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current) && !ts.isStatement(current) && !ts.isExpression(current)) {
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Reports whether an identifier is the opening/self-closing tag value rather than a child expression. */
function isJsxTagIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
  );
}

/** Detects React.createElement-style value reads through their enclosing call expression. */
function isInsideCreateElementCall(node: ts.Node): boolean {
  let child: ts.Node = node;
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current) && !ts.isStatement(current)) {
    if (
      ts.isCallExpression(current) &&
      ((ts.isIdentifier(current.expression) && current.expression.text === 'createElement') ||
        (ts.isPropertyAccessExpression(current.expression) &&
          current.expression.name.text === 'createElement'))
    ) {
      // The existing parent walk already proves the direct child of this call. Only an argument
      // child qualifies; the callee and type arguments remain ordinary value references.
      return current.arguments.some((argument) => argument === child);
    }
    child = current;
    current = current.parent;
  }
  return false;
}

/** Classifies route/page-map/router values by both stable names and React Router-shaped syntax. */
function isRouteLikeValue(localName: string, node: ts.Node): boolean {
  if (/(?:route|router|pages?|screens?)/iu.test(localName)) {
    return true;
  }
  let routeLike = false;
  const visit = (child: ts.Node): void => {
    if (routeLike) {
      return;
    }
    if (
      (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) &&
      readJsxTagName(child.tagName) === 'Route'
    ) {
      routeLike = true;
      return;
    }
    if (
      ts.isPropertyAssignment(child) &&
      ['children', 'component', 'element', 'lazy'].includes(
        (readPropertyName(child.name) ?? '').toLowerCase(),
      )
    ) {
      routeLike = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return routeLike;
}

/** Reads a simple JSX component label while excluding intrinsic lowercase host elements. */
function readJsxTagName(name: ts.JsxTagNameExpression): string | undefined {
  if (!mayHaveComponentTagName(name)) return undefined;
  const text = name.getText();
  const firstSegment = text.split('.', 1)[0];
  return firstSegment !== undefined && /^[$A-Z_]/u.test(firstSegment) ? text : undefined;
}

/**
 * Rejects identifier spellings the existing authored-text rule cannot admit before reading text.
 *
 * @param name Parser tag; qualified/namespaced spellings still require the existing text check.
 * @returns Whether the tag may start with ASCII uppercase, dollar or underscore; no new names pass.
 */
function mayHaveComponentTagName(name: ts.JsxTagNameExpression): boolean {
  if (!ts.isIdentifier(name)) return true;
  const first = name.text.charCodeAt(0);
  return first === 36 || first === 95 || (first >= 65 && first <= 90);
}

/** Treats React Router wrapper names as conditional route branch evidence. */
function isRouteLabel(label: string): boolean {
  return /(?:^|\.)(?:Route|Routes|RouterProvider)$/u.test(label);
}

/** Reads identifier and literal object property spellings without computed evaluation. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Tests one declaration modifier list without assuming every statement kind exposes modifiers. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true
  );
}
