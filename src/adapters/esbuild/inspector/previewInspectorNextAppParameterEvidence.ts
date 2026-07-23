/**
 * Refines Next App Router dynamic segments from local `generateStaticParams` evidence.
 *
 * The browser preview cannot ask Next's server to enumerate a route. This analyzer recognizes
 * literal return objects and bounded literal arrays used by `map`, `flatMap`, or synchronous
 * `for...of` pushes, then chooses one coherent authored parameter record. Imported collections are
 * followed only through the known inventory or an explicit package boundary; project modules are
 * never evaluated in the extension host.
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
import {
  bindingNameContainsIdentifier,
  findVisibleStaticLocalBinding,
  hasExportModifier,
  incrementStaticExpressionReadState,
  isExpressionInsideCollectionPush,
  isPathInsideStaticSourceBoundary,
  loopContainsCollectionPush,
  readAwaitedDynamicImportSpecifier,
  readForInLiteralIncludesGuard,
  readLoopBindingMatch,
  readSafeScalar,
  readStaticPropertyName,
  type StaticExpressionReadState,
  type StaticForInIncludesGuard,
  unwrapExpression,
  visitStaticExpressionBinding,
} from './previewInspectorNextAppStaticSyntax';

const MAXIMUM_STATIC_PARAM_OBJECTS = 32;
const MAXIMUM_STATIC_ARRAY_ITEMS = 16;
const MAXIMUM_STATIC_IMPORT_DEPTH = 4;
const MAXIMUM_STATIC_LOOP_DEPTH = 4;
const MAXIMUM_STATIC_OBJECT_PROPERTIES = 128;
const MAXIMUM_STATIC_EXPRESSION_DEPTH = 16;

/** Inputs for collecting and refining one exact default App Router page. */
export interface CollectRefinedPreviewInspectorNextAppLayoutChainOptions extends CollectPreviewInspectorNextAppLayoutChainOptions {
  /** Snapshot-aware source reader; dirty editor content remains authoritative. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Project-aware alias resolver used only for reached static collection bindings. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Optional package/source root that may supply reached evidence outside a direct inventory. */
  readonly staticParameterSourceBoundary?: string;
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

/** One source scope retained while an iteration binding is resolved across imports. */
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
  readonly sourceBoundary?: string;
  readonly sourceFiles: Map<string, ts.SourceFile>;
}

/** An unevaluated object literal retained with the source scope that owns its bindings. */
interface StaticObjectReference {
  readonly expression: ts.ObjectLiteralExpression;
  readonly kind: 'object';
  readonly scope: StaticExpressionScope;
}

/** An unevaluated array literal retained until one bounded iterator asks for its first item. */
interface StaticArrayReference {
  readonly expression: ts.ArrayLiteralExpression;
  readonly kind: 'array';
  readonly scope: StaticExpressionScope;
}

type StaticResolvedExpression =
  PreviewInspectorNextAppParamValue | StaticArrayReference | StaticObjectReference;

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
    ...(options.staticParameterSourceBoundary === undefined
      ? {}
      : { sourceBoundary: path.resolve(options.staticParameterSourceBoundary) }),
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

/** Reads a direct literal, local literal-array value, or statically bounded iteration item. */
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
  const item = await readStaticIterationItem(current, binding.localName, scope, context);
  if (item !== undefined) {
    if (typeof item === 'string' || isStaticParameterArray(item)) {
      return binding.propertyName === undefined ? item : undefined;
    }
    const itemProperty =
      binding.propertyName === undefined ? undefined : item[binding.propertyName];
    if (itemProperty !== undefined) return itemProperty;
  }
  const resolved = await readStaticExpressionValue(current, scope, context, {
    depth: 0,
    visited: new Set(),
  });
  return typeof resolved === 'string' || isResolvedStaticParameterArray(resolved)
    ? resolved
    : undefined;
}

/**
 * Resolves the first safe collection item bound to an expression by an authored iterator.
 *
 * Callback parameters retain the existing `map`/`flatMap` behavior. Synchronous `for...of` loops
 * are additionally accepted when the reached value is part of a `.push(...)` argument, which is
 * Next's common imperative `generateStaticParams` shape. Each nested loop independently selects
 * its first static item, so every property in one pushed object belongs to the same deterministic
 * first tuple rather than mixing values from separate route variants.
 */
async function readStaticIterationItem(
  expression: ts.Expression,
  localName: string,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
): Promise<StaticCollectionItem | undefined> {
  let loopDepth = 0;
  for (let current = expression.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const ownsBinding = current.parameters.some((parameter) =>
        bindingNameContainsIdentifier(parameter.name, localName),
      );
      if (!ownsBinding) continue;
      const parameter = current.parameters.find((candidate) =>
        bindingNameContainsIdentifier(candidate.name, localName),
      );
      if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
      const call = readOwningCollectionCall(current);
      if (call === undefined || !ts.isPropertyAccessExpression(call.expression)) return undefined;
      return readFirstStaticCollectionItem(call.expression.expression, scope, context);
    }
    if (!ts.isForOfStatement(current)) continue;
    loopDepth += 1;
    if (loopDepth > MAXIMUM_STATIC_LOOP_DEPTH) return undefined;
    const loopBinding = readLoopBindingMatch(current.initializer, localName);
    if (loopBinding === undefined) continue;
    if (loopBinding === 'unsupported') return undefined;
    if (
      current.awaitModifier !== undefined ||
      !isExpressionInsideCollectionPush(expression, current)
    ) {
      return undefined;
    }
    return readFirstStaticCollectionItem(current.expression, scope, context);
  }
  return undefined;
}

/**
 * Resolves a bounded subset of expressions used by imperative `generateStaticParams` builders.
 *
 * This is intentionally not a JavaScript evaluator. It follows literal arrays/objects, lexical
 * aliases, exact project imports, property reads, and iterator bindings only. Calls, mutations,
 * getters, computed runtime values, and arbitrary module initialization remain opaque.
 */
async function readStaticExpressionValue(
  expression: ts.Expression,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
  state: StaticExpressionReadState,
): Promise<StaticResolvedExpression | undefined> {
  if (state.depth > MAXIMUM_STATIC_EXPRESSION_DEPTH) return undefined;
  throwIfPreviewBuildCancelled(context.signal);
  const current = unwrapExpression(expression);
  const direct = readDirectStaticParameterValue(current);
  if (direct !== undefined) return direct;
  if (ts.isObjectLiteralExpression(current)) {
    return Object.freeze({ expression: current, kind: 'object', scope });
  }
  if (ts.isArrayLiteralExpression(current)) {
    return Object.freeze({ expression: current, kind: 'array', scope });
  }
  if (ts.isConditionalExpression(current)) {
    return (
      (await readStaticExpressionValue(
        current.whenTrue,
        scope,
        context,
        incrementStaticExpressionReadState(state),
      )) ??
      (await readStaticExpressionValue(
        current.whenFalse,
        scope,
        context,
        incrementStaticExpressionReadState(state),
      ))
    );
  }
  if (ts.isIdentifier(current)) {
    const iterationValue = await readStaticIteratorBindingValue(
      current,
      current.text,
      scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    if (iterationValue !== undefined) return iterationValue;
    const localBinding = findVisibleStaticLocalBinding(scope.sourceFile, current.text, current);
    if (localBinding !== undefined) {
      const nextState = visitStaticExpressionBinding(
        state,
        localBinding.bindingKey,
        MAXIMUM_STATIC_EXPRESSION_DEPTH,
      );
      if (nextState === undefined) return undefined;
      const dynamicImport = readAwaitedDynamicImportSpecifier(localBinding.initializer);
      if (dynamicImport !== undefined) {
        return localBinding.propertyName === undefined
          ? undefined
          : resolveImportedStaticExpression(
              { exportName: localBinding.propertyName, moduleSpecifier: dynamicImport },
              scope,
              context,
              nextState,
            );
      }
      const localValue = await readStaticExpressionValue(
        localBinding.initializer,
        scope,
        context,
        nextState,
      );
      return localBinding.propertyName === undefined
        ? localValue
        : readStaticObjectProperty(localValue, localBinding.propertyName, context, nextState);
    }
    const imported = findStaticImportBinding(scope.sourceFile, current.text);
    return imported === undefined || imported.exportName === '*'
      ? undefined
      : resolveImportedStaticExpression(
          imported,
          scope,
          context,
          incrementStaticExpressionReadState(state),
        );
  }
  if (ts.isPropertyAccessExpression(current)) {
    if (ts.isIdentifier(current.expression)) {
      const imported = findStaticImportBinding(scope.sourceFile, current.expression.text);
      if (imported?.exportName === '*') {
        return resolveImportedStaticExpression(
          { exportName: current.name.text, moduleSpecifier: imported.moduleSpecifier },
          scope,
          context,
          incrementStaticExpressionReadState(state),
        );
      }
    }
    const owner = await readStaticExpressionValue(
      current.expression,
      scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    return readStaticObjectProperty(
      owner,
      current.name.text,
      context,
      incrementStaticExpressionReadState(state),
    );
  }
  if (ts.isElementAccessExpression(current)) {
    const owner = await readStaticExpressionValue(
      current.expression,
      scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    const property = await readStaticExpressionValue(
      current.argumentExpression,
      scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    return typeof property === 'string'
      ? readStaticObjectProperty(
          owner,
          property,
          context,
          incrementStaticExpressionReadState(state),
        )
      : undefined;
  }
  return undefined;
}

/** Resolves the first item/key bound by a reached map, `for...of`, or `for...in` iterator. */
async function readStaticIteratorBindingValue(
  expression: ts.Expression,
  localName: string,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
  state: StaticExpressionReadState,
): Promise<StaticResolvedExpression | undefined> {
  let loopDepth = 0;
  for (let current = expression.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parameter = current.parameters.find((candidate) =>
        bindingNameContainsIdentifier(candidate.name, localName),
      );
      if (parameter === undefined) continue;
      if (!ts.isIdentifier(parameter.name)) return undefined;
      const call = readOwningCollectionCall(current);
      return call === undefined || !ts.isPropertyAccessExpression(call.expression)
        ? undefined
        : readFirstResolvedCollectionItem(
            call.expression.expression,
            scope,
            context,
            incrementStaticExpressionReadState(state),
          );
    }
    if (!ts.isForOfStatement(current) && !ts.isForInStatement(current)) continue;
    loopDepth += 1;
    if (loopDepth > MAXIMUM_STATIC_LOOP_DEPTH) return undefined;
    const loopBinding = readLoopBindingMatch(current.initializer, localName);
    if (loopBinding === undefined) continue;
    if (
      loopBinding === 'unsupported' ||
      (!isExpressionInsideCollectionPush(expression, current) &&
        !loopContainsCollectionPush(current))
    ) {
      return undefined;
    }
    if (ts.isForOfStatement(current)) {
      if (current.awaitModifier !== undefined) return undefined;
      return readFirstResolvedCollectionItem(
        current.expression,
        scope,
        context,
        incrementStaticExpressionReadState(state),
      );
    }
    const collection = await readStaticExpressionValue(
      current.expression,
      scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    const guard = readForInLiteralIncludesGuard(current, localName);
    return readFirstStaticObjectEntry(
      collection,
      context,
      incrementStaticExpressionReadState(state),
      guard,
    ).then((entry) => entry?.key);
  }
  return undefined;
}

/** Reads the first statically safe element of an array or `Object.keys(object)` collection. */
async function readFirstResolvedCollectionItem(
  expression: ts.Expression,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
  state: StaticExpressionReadState,
): Promise<StaticResolvedExpression | undefined> {
  const current = unwrapExpression(expression);
  if (
    ts.isCallExpression(current) &&
    current.arguments.length === 1 &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    current.expression.expression.text === 'Object' &&
    current.expression.name.text === 'keys'
  ) {
    const argument = current.arguments[0];
    if (argument === undefined) return undefined;
    const collection = await readStaticExpressionValue(
      argument,
      scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    return readFirstStaticObjectEntry(
      collection,
      context,
      incrementStaticExpressionReadState(state),
    ).then((entry) => entry?.key);
  }
  const collection = await readStaticExpressionValue(current, scope, context, state);
  if (isResolvedStaticParameterArray(collection)) return collection[0];
  if (!isStaticArrayReference(collection)) return undefined;
  for (const element of collection.expression.elements.slice(0, MAXIMUM_STATIC_ARRAY_ITEMS)) {
    if (ts.isOmittedExpression(element)) continue;
    const item = ts.isSpreadElement(element)
      ? await readFirstResolvedCollectionItem(
          element.expression,
          collection.scope,
          context,
          incrementStaticExpressionReadState(state),
        )
      : await readStaticExpressionValue(
          element,
          collection.scope,
          context,
          incrementStaticExpressionReadState(state),
        );
    if (item !== undefined) return item;
  }
  return undefined;
}

/** Returns one exact object field while following only literal spreads. */
async function readStaticObjectProperty(
  owner: StaticResolvedExpression | undefined,
  propertyName: string,
  context: StaticParameterReadContext,
  state: StaticExpressionReadState,
): Promise<StaticResolvedExpression | undefined> {
  if (!isStaticObjectReference(owner)) return undefined;
  for (const property of owner.expression.properties.slice(0, MAXIMUM_STATIC_OBJECT_PROPERTIES)) {
    if (ts.isSpreadAssignment(property)) {
      const spread = await readStaticExpressionValue(
        property.expression,
        owner.scope,
        context,
        incrementStaticExpressionReadState(state),
      );
      const spreadValue = await readStaticObjectProperty(
        spread,
        propertyName,
        context,
        incrementStaticExpressionReadState(state),
      );
      if (spreadValue !== undefined) return spreadValue;
      continue;
    }
    const name = readStaticPropertyName(property.name);
    if (name !== propertyName) continue;
    const initializer = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : undefined;
    return initializer === undefined
      ? undefined
      : readStaticExpressionValue(
          initializer,
          owner.scope,
          context,
          incrementStaticExpressionReadState(state),
        );
  }
  return undefined;
}

/** Selects the first literal property and retains both its key and lazily resolved value. */
async function readFirstStaticObjectEntry(
  owner: StaticResolvedExpression | undefined,
  context: StaticParameterReadContext,
  state: StaticExpressionReadState,
  guard?: StaticForInIncludesGuard,
): Promise<{ readonly key: string; readonly value: StaticResolvedExpression } | undefined> {
  if (!isStaticObjectReference(owner)) return undefined;
  for (const property of owner.expression.properties.slice(0, MAXIMUM_STATIC_OBJECT_PROPERTIES)) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const key = readStaticPropertyName(property.name);
    const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name;
    if (key === undefined) continue;
    const value = await readStaticExpressionValue(
      initializer,
      owner.scope,
      context,
      incrementStaticExpressionReadState(state),
    );
    if (value === undefined) continue;
    if (guard !== undefined) {
      const discriminator = await readStaticObjectProperty(
        value,
        guard.propertyName,
        context,
        incrementStaticExpressionReadState(state),
      );
      if (typeof discriminator !== 'string' || !guard.allowedValues.includes(discriminator)) {
        continue;
      }
    }
    return Object.freeze({ key, value });
  }
  return undefined;
}

/** Loads one exact exported initializer as an unevaluated expression reference. */
async function resolveImportedStaticExpression(
  binding: StaticImportBinding,
  scope: StaticExpressionScope,
  context: StaticParameterReadContext,
  state: StaticExpressionReadState,
): Promise<StaticResolvedExpression | undefined> {
  if (scope.depth >= MAXIMUM_STATIC_IMPORT_DEPTH || binding.exportName === '*') return undefined;
  const resolved = context.resolveModule(binding.moduleSpecifier, scope.sourcePath);
  if (resolved === undefined) return undefined;
  const sourcePath = path.normalize(resolved);
  if (!isPathInsideStaticSourceBoundary(sourcePath, context.inventory, context.sourceBoundary)) {
    return undefined;
  }
  const bindingKey = `import:${sourcePath}:${binding.exportName}`;
  const nextState = visitStaticExpressionBinding(
    state,
    bindingKey,
    MAXIMUM_STATIC_EXPRESSION_DEPTH,
  );
  if (nextState === undefined) return undefined;
  const sourceFile = await readStaticSourceFile(sourcePath, context);
  if (sourceFile === undefined) return undefined;
  context.dependencies.add(sourcePath);
  const nextScope: StaticExpressionScope = {
    depth: scope.depth + 1,
    sourceFile,
    sourcePath,
    visitedBindings: scope.visitedBindings,
  };
  const initializer = findLocalVariableInitializer(sourceFile, binding.exportName);
  if (initializer !== undefined) {
    return readStaticExpressionValue(initializer, nextScope, context, nextState);
  }
  const forwarded =
    findStaticImportBinding(sourceFile, binding.exportName) ??
    findStaticReexportBinding(sourceFile, binding.exportName);
  return forwarded === undefined
    ? undefined
    : resolveImportedStaticExpression(forwarded, nextScope, context, nextState);
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
  if (!isPathInsideStaticSourceBoundary(sourcePath, context.inventory, context.sourceBoundary)) {
    return undefined;
  }
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

/** Narrows route arrays without confusing them with retained literal-array syntax. */
function isResolvedStaticParameterArray(
  value: StaticResolvedExpression | undefined,
): value is readonly string[] {
  return Array.isArray(value);
}

/** Narrows an unevaluated literal array from scalar route values. */
function isStaticArrayReference(
  value: StaticResolvedExpression | undefined,
): value is StaticArrayReference {
  return typeof value === 'object' && 'kind' in value && value.kind === 'array';
}

/** Narrows an unevaluated literal object from scalar route values. */
function isStaticObjectReference(
  value: StaticResolvedExpression | undefined,
): value is StaticObjectReference {
  return typeof value === 'object' && 'kind' in value && value.kind === 'object';
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
