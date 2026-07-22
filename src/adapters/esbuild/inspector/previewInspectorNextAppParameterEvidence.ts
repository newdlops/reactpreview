/**
 * Refines Next App Router dynamic segments from local `generateStaticParams` evidence.
 *
 * The browser preview cannot ask Next's server to enumerate a route. This analyzer recognizes
 * literal return objects and bounded literal arrays used by `map` or `flatMap`, then chooses one
 * coherent authored parameter record. Imported collections are followed only through the existing
 * project source inventory; project modules are never evaluated in the extension host.
 */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import { createLexicalInspectorModuleResolver } from './previewInspectorLexicalResolver';
import {
  collectPreviewInspectorNextAppLayoutChain,
  type CollectPreviewInspectorNextAppLayoutChainOptions,
  type PreviewInspectorNextAppLayoutChain,
  type PreviewInspectorNextAppParamValue,
} from './previewInspectorNextAppLayoutChain';

const MAXIMUM_STATIC_PARAM_OBJECTS = 32;
const MAXIMUM_STATIC_ARRAY_ITEMS = 16;
const MAXIMUM_STATIC_IMPORT_DEPTH = 4;

/** Inputs for collecting and refining one exact default App Router page. */
export interface CollectRefinedPreviewInspectorNextAppLayoutChainOptions extends CollectPreviewInspectorNextAppLayoutChainOptions {
  /** Snapshot-aware source reader; dirty editor content remains authoritative. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Project-aware alias resolver used only for reached static collection bindings. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Cancels stale parameter analysis before each source read and import traversal. */
  readonly signal?: AbortSignal;
}

/** Refined framework shell plus source files whose edits must invalidate the preview. */
export interface RefinedPreviewInspectorNextAppLayoutChain {
  readonly dependencyPaths: readonly string[];
  readonly shell: PreviewInspectorNextAppLayoutChain;
}

/** One internally coherent parameter record found in an authored return branch. */
interface StaticParameterCandidate {
  readonly occurrenceStart: number;
  readonly values: Readonly<Record<string, PreviewInspectorNextAppParamValue>>;
}

type StaticCollectionItem =
  PreviewInspectorNextAppParamValue | Readonly<Record<string, PreviewInspectorNextAppParamValue>>;

/** One source scope retained while a mapped callback binding is resolved across imports. */
interface StaticExpressionScope {
  readonly depth: number;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
  readonly visitedBindings: ReadonlySet<string>;
}

/** Build-local services and caches that keep static parameter traversal bounded and deterministic. */
interface StaticParameterReadContext {
  readonly dependencies: Set<string>;
  readonly inventory: ReadonlySet<string>;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourceFiles: Map<string, ts.SourceFile>;
}

/** Exact imported or re-exported binding reached without evaluating its owning module. */
interface StaticImportBinding {
  readonly exportName: string;
  readonly moduleSpecifier: string;
}

/**
 * Collects a conventional shell and replaces synthetic keys with proven authored values.
 *
 * Next permits every dynamic segment layout to contribute `generateStaticParams`; the leaf page
 * does not need to repeat those parent keys. Sources are therefore inspected in wrapper-to-page
 * order and their partial records are merged without evaluating any server module.
 */
export async function collectRefinedPreviewInspectorNextAppLayoutChain(
  options: CollectRefinedPreviewInspectorNextAppLayoutChainOptions,
): Promise<RefinedPreviewInspectorNextAppLayoutChain | undefined> {
  throwIfPreviewBuildCancelled(options.signal);
  const initial = collectPreviewInspectorNextAppLayoutChain(options);
  if (initial === undefined) return undefined;
  const parameterNames = collectDynamicParameterNames(initial.routeLocation.pattern);
  if (parameterNames.length === 0) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), shell: initial });
  }
  const pagePath = path.normalize(initial.routeLocation.sourcePath);
  const context: StaticParameterReadContext = {
    dependencies: new Set(),
    inventory: new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath))),
    readSource: options.readSource,
    resolveModule:
      options.resolveModule ?? createLexicalInspectorModuleResolver(options.sourcePaths),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourceFiles: new Map(),
  };
  const values: Record<string, PreviewInspectorNextAppParamValue> = {};
  const parameterSourcePaths = [
    ...new Set([...initial.layouts.map((layout) => path.normalize(layout.sourcePath)), pagePath]),
  ];
  for (const sourcePath of parameterSourcePaths) {
    throwIfPreviewBuildCancelled(options.signal);
    const sourceFile = await readStaticSourceFile(sourcePath, context);
    if (sourceFile === undefined) continue;
    const sourceValues = await collectGenerateStaticParameterValues(
      sourceFile,
      sourcePath,
      parameterNames,
      context,
    );
    if (Object.keys(sourceValues).length === 0) continue;
    context.dependencies.add(sourcePath);
    Object.assign(values, sourceValues);
  }
  if (Object.keys(values).length === 0) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), shell: initial });
  }
  const refined = collectPreviewInspectorNextAppLayoutChain({
    ...options,
    dynamicParameterValues: values,
  });
  return Object.freeze({
    dependencyPaths: Object.freeze([...context.dependencies].sort()),
    shell: refined ?? initial,
  });
}

/** Extracts dynamic keys from ordinary, catch-all, and optional catch-all route segments. */
function collectDynamicParameterNames(pattern: string): readonly string[] {
  const names: string[] = [];
  for (const segment of pattern.split('/').filter(Boolean)) {
    const match = /^\[\[?\.\.\.([^\]]+)\]\]?$|^\[([^\]]+)\]$/u.exec(segment);
    const name = match?.[1] ?? match?.[2];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return Object.freeze(names);
}

/** Chooses the earliest object that resolves the greatest number of requested route keys. */
async function collectGenerateStaticParameterValues(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  parameterNames: readonly string[],
  context: StaticParameterReadContext,
): Promise<Readonly<Record<string, PreviewInspectorNextAppParamValue>>> {
  const body = findGenerateStaticParamsBody(sourceFile);
  if (body === undefined) return Object.freeze({});
  const objectLiterals: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (objectLiterals.length >= MAXIMUM_STATIC_PARAM_OBJECTS) return;
    if (ts.isObjectLiteralExpression(node)) objectLiterals.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  const candidates: StaticParameterCandidate[] = [];
  const scope: StaticExpressionScope = {
    depth: 0,
    sourceFile,
    sourcePath,
    visitedBindings: new Set(),
  };
  for (const objectLiteral of objectLiterals) {
    const values: Record<string, PreviewInspectorNextAppParamValue> = {};
    for (const property of objectLiteral.properties) {
      const propertyName = readStaticPropertyName(property.name);
      if (propertyName === undefined || !parameterNames.includes(propertyName)) continue;
      const expression = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined;
      const value =
        expression === undefined
          ? undefined
          : await readStaticParameterValue(expression, scope, context);
      if (value !== undefined) values[propertyName] = value;
    }
    if (Object.keys(values).length > 0) {
      candidates.push({ occurrenceStart: objectLiteral.getStart(sourceFile), values });
    }
  }
  candidates.sort(
    (left, right) =>
      Object.keys(right.values).length - Object.keys(left.values).length ||
      left.occurrenceStart - right.occurrenceStart,
  );
  return Object.freeze({ ...(candidates[0]?.values ?? {}) });
}

/** Finds only an exported top-level function/arrow using Next's exact convention name. */
function findGenerateStaticParamsBody(sourceFile: ts.SourceFile): ts.ConciseBody | undefined {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'generateStaticParams' &&
      statement.body !== undefined &&
      hasExportModifier(statement)
    ) {
      return statement.body;
    }
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'generateStaticParams' &&
        declaration.initializer !== undefined
      ) {
        const initializer = unwrapExpression(declaration.initializer);
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          return initializer.body;
        }
      }
    }
  }
  return undefined;
}

/** Reads a direct literal, local literal-array value, or mapped callback item property. */
async function readStaticParameterValue(
  expression: ts.Expression,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
): Promise<PreviewInspectorNextAppParamValue | undefined> {
  const current = unwrapExpression(expression);
  const direct = readDirectStaticParameterValue(current);
  if (direct !== undefined) return direct;
  const binding = ts.isIdentifier(current)
    ? { localName: current.text, propertyName: undefined }
    : ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression)
      ? { localName: current.expression.text, propertyName: current.name.text }
      : undefined;
  if (binding === undefined) return undefined;
  const item = await readMappedCollectionItem(current, binding.localName, scope, context);
  if (item === undefined) return undefined;
  if (typeof item === 'string' || isStaticParameterArray(item)) {
    return binding.propertyName === undefined ? item : undefined;
  }
  return binding.propertyName === undefined ? undefined : item[binding.propertyName];
}

/** Resolves the first local literal collection item feeding the callback that owns an expression. */
async function readMappedCollectionItem(
  expression: ts.Expression,
  localName: string,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
): Promise<StaticCollectionItem | undefined> {
  for (let current = expression.parent; !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) continue;
    if (
      !current.parameters.some(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === localName,
      )
    ) {
      continue;
    }
    const call = readOwningCollectionCall(current);
    if (call === undefined || !ts.isPropertyAccessExpression(call.expression)) return undefined;
    return readFirstStaticCollectionItem(call.expression.expression, scope, context);
  }
  return undefined;
}

/** Accepts a callback wrapped only by syntax-transparent parentheses before `map`/`flatMap`. */
function readOwningCollectionCall(
  callback: ts.FunctionExpression | ts.ArrowFunction,
): ts.CallExpression | undefined {
  let current: ts.Node = callback;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(current as ts.Expression))
    return undefined;
  const expression = parent.expression;
  return ts.isPropertyAccessExpression(expression) &&
    /^(?:flatMap|map)$/u.test(expression.name.text)
    ? parent
    : undefined;
}

/** Reads the first safe collection item through local, imported, spread, and conditional bindings. */
async function readFirstStaticCollectionItem(
  expression: ts.Expression,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
): Promise<StaticCollectionItem | undefined> {
  const current = unwrapExpression(expression);
  const direct = readDirectStaticCollectionItem(current);
  if (direct !== undefined) return direct;
  if (ts.isArrayLiteralExpression(current)) {
    for (const element of current.elements.slice(0, MAXIMUM_STATIC_ARRAY_ITEMS)) {
      if (ts.isOmittedExpression(element)) continue;
      const item = await readFirstStaticCollectionItem(
        ts.isSpreadElement(element) ? element.expression : element,
        scope,
        context,
      );
      if (item !== undefined) return item;
    }
    return undefined;
  }
  if (ts.isConditionalExpression(current)) {
    return (
      (await readFirstStaticCollectionItem(current.whenTrue, scope, context)) ??
      (await readFirstStaticCollectionItem(current.whenFalse, scope, context))
    );
  }
  if (ts.isIdentifier(current)) {
    return resolveStaticCollectionBinding(current.text, scope, context);
  }
  if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression)) {
    const binding = findStaticImportBinding(scope.sourceFile, current.expression.text);
    if (binding?.exportName !== '*') return undefined;
    return resolveImportedStaticCollection(
      { exportName: current.name.text, moduleSpecifier: binding.moduleSpecifier },
      scope,
      context,
    );
  }
  return undefined;
}

/** Resolves one named collection without revisiting the same file/binding pair. */
async function resolveStaticCollectionBinding(
  localName: string,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
): Promise<StaticCollectionItem | undefined> {
  if (scope.depth > MAXIMUM_STATIC_IMPORT_DEPTH) return undefined;
  const bindingKey = `${path.normalize(scope.sourcePath)}\0${localName}`;
  if (scope.visitedBindings.has(bindingKey)) return undefined;
  const visitedBindings = new Set(scope.visitedBindings);
  visitedBindings.add(bindingKey);
  const nextScope = { ...scope, visitedBindings };
  const initializer = findLocalVariableInitializer(scope.sourceFile, localName);
  if (initializer !== undefined) {
    return readFirstStaticCollectionItem(initializer, nextScope, context);
  }
  const binding =
    findStaticImportBinding(scope.sourceFile, localName) ??
    findStaticReexportBinding(scope.sourceFile, localName);
  return binding === undefined
    ? undefined
    : resolveImportedStaticCollection(binding, nextScope, context);
}

/** Loads one exact project import and continues resolving its exported binding statically. */
async function resolveImportedStaticCollection(
  binding: StaticImportBinding,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
): Promise<StaticCollectionItem | undefined> {
  if (scope.depth >= MAXIMUM_STATIC_IMPORT_DEPTH || binding.exportName === '*') return undefined;
  const resolved = context.resolveModule(binding.moduleSpecifier, scope.sourcePath);
  if (resolved === undefined) return undefined;
  const sourcePath = path.normalize(resolved);
  if (!context.inventory.has(sourcePath)) return undefined;
  const sourceFile = await readStaticSourceFile(sourcePath, context);
  if (sourceFile === undefined) return undefined;
  context.dependencies.add(sourcePath);
  return resolveStaticCollectionBinding(
    binding.exportName,
    {
      depth: scope.depth + 1,
      sourceFile,
      sourcePath,
      visitedBindings: scope.visitedBindings,
    },
    context,
  );
}

/** Reads and parses one imported source at most once during a candidate build. */
async function readStaticSourceFile(
  sourcePath: string,
  context: StaticParameterReadContext,
): Promise<ts.SourceFile | undefined> {
  throwIfPreviewBuildCancelled(context.signal);
  const cached = context.sourceFiles.get(sourcePath);
  if (cached !== undefined) return cached;
  const sourceText = await context.readSource(sourcePath);
  if (sourceText === undefined) return undefined;
  const sourceFile = createSourceFile(sourcePath, sourceText);
  context.sourceFiles.set(sourcePath, sourceFile);
  return sourceFile;
}

/** Reads a direct scalar/object expression without resolving identifiers or calling project code. */
function readDirectStaticCollectionItem(
  expression: ts.Expression,
): StaticCollectionItem | undefined {
  const scalar = readSafeScalar(expression);
  if (scalar !== undefined) return scalar;
  if (!ts.isObjectLiteralExpression(expression)) return undefined;
  const record: Record<string, PreviewInspectorNextAppParamValue> = {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = readStaticPropertyName(property.name);
    const value = readDirectStaticParameterValue(unwrapExpression(property.initializer));
    if (name !== undefined && value !== undefined) record[name] = value;
  }
  return Object.keys(record).length === 0 ? undefined : Object.freeze(record);
}

/** Reads a route-safe scalar or a complete route-safe literal array. */
function readDirectStaticParameterValue(
  expression: ts.Expression,
): PreviewInspectorNextAppParamValue | undefined {
  const scalar = readSafeScalar(expression);
  if (scalar !== undefined) return scalar;
  if (!ts.isArrayLiteralExpression(expression)) return undefined;
  const values = expression.elements
    .slice(0, MAXIMUM_STATIC_ARRAY_ITEMS)
    .map((element) =>
      ts.isOmittedExpression(element) || ts.isSpreadElement(element)
        ? undefined
        : readSafeScalar(unwrapExpression(element)),
    );
  return values.length === expression.elements.length &&
    values.every((value) => value !== undefined)
    ? Object.freeze(values)
    : undefined;
}

/** Finds a top-level local initializer while leaving destructuring and runtime assignments opaque. */
function findLocalVariableInitializer(
  sourceFile: ts.SourceFile,
  localName: string,
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === localName) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

/** Maps an imported local identifier to the exact binding visible in its source module. */
function findStaticImportBinding(
  sourceFile: ts.SourceFile,
  localName: string,
): StaticImportBinding | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name?.text === localName) {
      return { exportName: 'default', moduleSpecifier: statement.moduleSpecifier.text };
    }
    const bindings = clause?.namedBindings;
    if (
      bindings !== undefined &&
      ts.isNamespaceImport(bindings) &&
      bindings.name.text === localName
    ) {
      return { exportName: '*', moduleSpecifier: statement.moduleSpecifier.text };
    }
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.name.text !== localName) continue;
      return {
        exportName: element.propertyName?.text ?? element.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      };
    }
  }
  return undefined;
}

/** Follows an exact `export { value } from './module'` barrel without scanning unrelated exports. */
function findStaticReexportBinding(
  sourceFile: ts.SourceFile,
  exportName: string,
): StaticImportBinding | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      if (element.name.text !== exportName) continue;
      return {
        exportName: element.propertyName?.text ?? element.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      };
    }
  }
  return undefined;
}

/** Narrows the array branch that `Array.isArray` cannot infer for a readonly union. */
function isStaticParameterArray(item: StaticCollectionItem): item is readonly string[] {
  return Array.isArray(item);
}

/** Converts static property syntax without evaluating computed expressions. */
function readStaticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Accepts pathname-safe string/number literals and rejects arbitrary conversions. */
function readSafeScalar(expression: ts.Expression): string | undefined {
  const value =
    ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)
      ? expression.text
      : undefined;
  return value !== undefined &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

/** Removes type-only wrappers while preserving every runtime call or property access. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression;
  return current;
}

/** Tests a standard TypeScript export modifier without accepting a later alias export. */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}

/** Parses TS/JS and JSX/TSX with parent links needed for callback-to-collection tracing. */
function createSourceFile(sourcePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
