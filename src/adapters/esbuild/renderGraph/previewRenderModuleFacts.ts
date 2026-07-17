/**
 * Extracts inert per-module value-flow facts for application render-chain discovery.
 * The collector intentionally models ordinary top-level values as well as React components: route
 * arrays, router objects, page maps, and conditional app selectors are the connective tissue that
 * a JSX-owner-only traversal loses. No project expression is evaluated by this module.
 */
import path from 'node:path';
import ts from 'typescript';
import type {
  PreviewRenderChainCertainty,
  PreviewRenderChainEdgeKind,
} from './previewRenderGraphTypes';

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
  /** Outer top-level declaration containing the reference. */
  readonly ownerId: string;
  /** Source offset of the identifier or JSX tag reference. */
  readonly occurrenceStart: number;
  /** Component-like JSX ancestors crossed at the occurrence, ordered inner-to-outer. */
  readonly wrapperNames: readonly string[];
}

/** Literal dynamic-import identity attached to a React.lazy declaration. */
export interface PreviewRenderLazyFact {
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

/** React import aliases needed to prove that a dynamic import is actually consumed by React.lazy. */
interface ReactLazyBindings {
  readonly directNames: ReadonlySet<string>;
  readonly namespaceNames: ReadonlySet<string>;
}

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
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
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
  const lazyBindings = collectReactLazyBindings(sourceFile);
  const exports = collectExports(sourceFile, values, imports);
  const lazyImports = values.flatMap((value) => collectLazyFacts(value, lazyBindings));
  const localEdges = values.flatMap((value) =>
    collectLocalEdges(value, localNames, routeLikeNames),
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
        if (ts.isIdentifier(declaration.name)) {
          values.push(
            createMutableValue(
              sourcePath,
              declaration.name.text,
              declaration,
              declaration.initializer ?? declaration,
            ),
          );
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && !ts.isIdentifier(statement.expression)) {
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
      exports.push({
        exportName: 'default',
        localName: ts.isIdentifier(statement.expression) ? statement.expression.text : '@default',
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
        if (ts.isIdentifier(declaration.name)) {
          exports.push({
            exportName: declaration.name.text,
            localName: declaration.name.text,
            occurrenceStart: declaration.getStart(),
            wildcard: false,
          });
        }
      }
    }
  }
  return deduplicateExports(exports);
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

/** Reads aliases that prove a call expression is React.lazy or a React namespace lazy member. */
function collectReactLazyBindings(sourceFile: ts.SourceFile): ReactLazyBindings {
  const directNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react' ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      namespaceNames.add(clause.name.text);
    }
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'lazy') {
          directNames.add(element.name.text);
        }
      }
    }
  }
  return { directNames, namespaceNames };
}

/** Finds literal dynamic imports owned by a proven React.lazy call within one declaration. */
function collectLazyFacts(
  value: MutableValueFact,
  bindings: ReactLazyBindings,
): PreviewRenderLazyFact[] {
  const facts: PreviewRenderLazyFact[] = [];
  visit(value.analysisNode);
  return facts;

  /** Visits only syntax beneath this declaration and records each exact lazy import once. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isReactLazyCall(node, bindings)) {
      const selection = readLazyImportSelection(node.arguments[0]);
      if (selection !== undefined) {
        facts.push({ ...selection, ownerId: value.id, occurrenceStart: node.getStart() });
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
}

/** Proves a lazy call through a direct named import or a React namespace/default import. */
function isReactLazyCall(call: ts.CallExpression, bindings: ReactLazyBindings): boolean {
  const expression = call.expression;
  return (
    (ts.isIdentifier(expression) && bindings.directNames.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'lazy' &&
      ts.isIdentifier(expression.expression) &&
      bindings.namespaceNames.has(expression.expression.text))
  );
}

/** Resolves the default or `.then`-selected export from one React.lazy loader callback. */
function readLazyImportSelection(
  loader: ts.Expression | undefined,
): { readonly importedName: string; readonly moduleSpecifier: string } | undefined {
  if (loader === undefined || (!ts.isArrowFunction(loader) && !ts.isFunctionExpression(loader))) {
    return undefined;
  }
  const body = ts.isBlock(loader.body)
    ? loader.body.statements.find(ts.isReturnStatement)?.expression
    : loader.body;
  if (body === undefined) {
    return undefined;
  }
  const importCall = findDynamicImportCall(body);
  const specifier = importCall?.arguments[0];
  if (importCall === undefined || specifier === undefined || !ts.isStringLiteralLike(specifier)) {
    return undefined;
  }
  return {
    importedName: readLazySelectedExport(body) ?? 'default',
    moduleSpecifier: specifier.text,
  };
}

/** Finds the literal `import()` call under a bounded lazy loader expression. */
function findDynamicImportCall(node: ts.Node): ts.CallExpression | undefined {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node;
  }
  let selected: ts.CallExpression | undefined;
  ts.forEachChild(node, (child) => {
    selected ??= findDynamicImportCall(child);
  });
  return selected;
}

/** Recognizes common `then(module => module.Named)` and `{ default: module.Named }` adapters. */
function readLazySelectedExport(body: ts.Expression): string | undefined {
  if (
    !ts.isCallExpression(body) ||
    !ts.isPropertyAccessExpression(body.expression) ||
    body.expression.name.text !== 'then'
  ) {
    return undefined;
  }
  const callback = body.arguments[0];
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return undefined;
  }
  const parameterName = callback.parameters[0]?.name;
  if (parameterName === undefined || !ts.isIdentifier(parameterName)) {
    return undefined;
  }
  const result = ts.isBlock(callback.body)
    ? callback.body.statements.find(ts.isReturnStatement)?.expression
    : callback.body;
  return result === undefined ? undefined : readSelectedModuleProperty(result, parameterName.text);
}

/** Reads a module property directly or from an object literal's `default` adapter property. */
function readSelectedModuleProperty(
  expression: ts.Expression,
  moduleName: string,
): string | undefined {
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === moduleName
  ) {
    return unwrapped.name.text;
  }
  if (!ts.isObjectLiteralExpression(unwrapped)) {
    return undefined;
  }
  const defaultProperty = unwrapped.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && readPropertyName(property.name) === 'default',
  );
  return defaultProperty === undefined
    ? undefined
    : readSelectedModuleProperty(defaultProperty.initializer, moduleName);
}

/** Collects declaration references and classifies JSX, route, and ordinary value-flow edges. */
function collectLocalEdges(
  owner: MutableValueFact,
  knownLocalNames: ReadonlySet<string>,
  routeLikeNames: ReadonlySet<string>,
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
      isRuntimeValueReference(node)
    ) {
      const wrapperNames = collectWrapperNames(node, owner.analysisNode);
      const routeEdge =
        owner.routeLike || wrapperNames.some(isRouteLabel) || routeLikeNames.has(node.text);
      const kind = classifyLocalEdge(node, routeEdge);
      const key = `${node.text}\0${kind}\0${node.getStart().toString()}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          certainty: routeEdge ? 'conditional' : 'confirmed',
          childLocalName: node.text,
          kind,
          ownerId: owner.id,
          occurrenceStart: node.getStart(),
          wrapperNames: Object.freeze(wrapperNames),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
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
function collectWrapperNames(node: ts.Node, boundary: ts.Node): string[] {
  const names: string[] = [];
  const directParent = node.parent;
  let current: ts.Node =
    (ts.isJsxOpeningElement(directParent) || ts.isJsxSelfClosingElement(directParent)) &&
    directParent.tagName === node
      ? directParent.parent
      : directParent;
  while (current !== boundary && !ts.isSourceFile(current)) {
    if (ts.isJsxElement(current)) {
      for (const routeWrapper of readRouteElementWrapperNames(current.openingElement)) {
        if (names.at(-1) !== routeWrapper) {
          names.push(routeWrapper);
        }
      }
      const name = readJsxTagName(current.openingElement.tagName);
      if (name !== undefined && names.at(-1) !== name) {
        names.push(name);
      }
    } else if (ts.isJsxSelfClosingElement(current)) {
      const name = readJsxTagName(current.tagName);
      if (name !== undefined && names.at(-1) !== name) {
        names.push(name);
      }
    }
    current = current.parent;
  }
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
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current) && !ts.isStatement(current)) {
    if (
      ts.isCallExpression(current) &&
      ((ts.isIdentifier(current.expression) && current.expression.text === 'createElement') ||
        (ts.isPropertyAccessExpression(current.expression) &&
          current.expression.name.text === 'createElement'))
    ) {
      return (
        current.arguments.includes(node as ts.Expression) ||
        current.arguments.some((argument) => containsNode(argument, node))
      );
    }
    current = current.parent;
  }
  return false;
}

/** Bounded AST containment helper used only inside one already selected call expression. */
function containsNode(root: ts.Node, target: ts.Node): boolean {
  if (root === target) {
    return true;
  }
  let contained = false;
  ts.forEachChild(root, (child) => {
    contained ||= containsNode(child, target);
  });
  return contained;
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
  const text = name.getText();
  const firstSegment = text.split('.', 1)[0];
  return firstSegment !== undefined && /^[$A-Z_]/u.test(firstSegment) ? text : undefined;
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
