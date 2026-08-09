/**
 * Infers safe values for dynamic Next.js route segments from authored static records.
 *
 * Filesystem routes such as `[hotelName]` do not contain a usable runtime value. Using the
 * parameter name itself is deterministic, but it fails when application code immediately indexes
 * a finite registry (`HOTELS[hotelName]`) or validates the value through
 * `Object.keys(HOTELS).includes(hotelName)`. This analyzer follows only literal project imports,
 * never evaluates application code, and selects the first authored key from such a proven record.
 */
import path from 'node:path';
import ts from 'typescript';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import {
  collectPreviewRenderModuleSpecifiers,
  type ResolvePreviewRenderGraphModule,
} from '../renderGraph';
import { createLexicalInspectorModuleResolver } from './previewInspectorLexicalResolver';
import { isPathInsideStaticSourceBoundary } from './previewInspectorNextAppStaticSyntax';
import {
  collectPreviewInspectorNextPagesShell,
  type PreviewInspectorNextPagesShell,
} from './previewInspectorNextPagesShell';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';

const MAX_EVIDENCE_MODULES = 48;
const MAX_IMPORT_DEPTH = 4;
const MAX_STATIC_RECORD_KEYS = 32;

/** Inputs retained inside the same bounded source inventory as the ancestor planner. */
export interface RefinePreviewInspectorNextPagesShellOptions {
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly shell: PreviewInspectorNextPagesShell;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  /** Optional trusted root for exact reached imports absent from a fast filesystem inventory. */
  readonly staticParameterSourceBoundary?: string;
}

/** Framework-neutral inputs for finite-record route parameter evidence. */
export interface CollectPreviewInspectorStaticRecordParameterValuesOptions {
  /** Already proven values used to resolve a later nested registry lookup. */
  readonly initialValues?: Readonly<Record<string, string | readonly string[]>>;
  readonly pagePath: string;
  readonly pattern: string;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  /** Optional trusted root for exact reached imports absent from a fast filesystem inventory. */
  readonly staticParameterSourceBoundary?: string;
}

/** Proven route values plus every source that must invalidate that evidence. */
export interface PreviewInspectorStaticRecordParameterValues {
  readonly dependencyPaths: readonly string[];
  readonly values: Readonly<Record<string, string>>;
}

/** Refined shell plus the static evidence files that must participate in hot reload. */
export interface RefinedPreviewInspectorNextPagesShell {
  readonly dependencyPaths: readonly string[];
  readonly shell: PreviewInspectorNextPagesShell;
}

/** Candidate-scoped cache that prevents repeated import traversal for alternative page roots. */
export interface PreviewInspectorNextPagesShellRefiner {
  refine(shell: PreviewInspectorNextPagesShell): Promise<RefinedPreviewInspectorNextPagesShell>;
}

/** Creates one bounded refiner whose cache lives only for the current ancestor-plan build. */
export function createPreviewInspectorNextPagesShellRefiner(
  options: Omit<RefinePreviewInspectorNextPagesShellOptions, 'shell'>,
): PreviewInspectorNextPagesShellRefiner {
  const refinementByPage = new Map<string, Promise<RefinedPreviewInspectorNextPagesShell>>();
  return Object.freeze({
    refine(shell: PreviewInspectorNextPagesShell) {
      const key = `${path.normalize(shell.routeLocation.sourcePath)}\0${shell.routeLocation.pattern}`;
      let refinement = refinementByPage.get(key);
      if (refinement === undefined) {
        refinement = refinePreviewInspectorNextPagesShell({ ...options, shell });
        refinementByPage.set(key, refinement);
      }
      return refinement;
    },
  });
}

interface RecordReference {
  readonly exportName: string;
  readonly moduleSpecifier?: string;
  readonly propertyPath: readonly string[];
}

interface RecordLookup {
  readonly occurrenceStart: number;
  readonly recordExpression: ts.Expression;
  /** Validation through `Object.keys` is stronger than an unchecked element access. */
  readonly strength: 0 | 1;
}

interface ParameterValueCandidate {
  readonly dependencyPaths: readonly string[];
  readonly occurrenceStart: number;
  readonly sourceDepth: number;
  readonly sourcePath: string;
  readonly strength: 0 | 1;
  readonly value: string;
}

interface TraversedSource {
  readonly depth: number;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
  readonly sourceText: string;
}

/**
 * Replaces visibly synthetic route values only when a reached static registry proves one value.
 *
 * The original shell is returned unchanged when evidence is absent or ambiguous. Dependencies are
 * reported separately so callers can invalidate the candidate when a guard or registry changes.
 */
export async function refinePreviewInspectorNextPagesShell(
  options: RefinePreviewInspectorNextPagesShellOptions,
): Promise<RefinedPreviewInspectorNextPagesShell> {
  if (options.shell.routeLocation.evidenceKind !== 'next-pages-filesystem') {
    return Object.freeze({ dependencyPaths: Object.freeze([]), shell: options.shell });
  }
  const evidence = await collectPreviewInspectorStaticRecordParameterValues({
    pagePath: options.shell.routeLocation.sourcePath,
    pattern: options.shell.routeLocation.pattern,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths: options.sourcePaths,
    ...(options.staticParameterSourceBoundary === undefined
      ? {}
      : { staticParameterSourceBoundary: options.staticParameterSourceBoundary }),
  });
  if (Object.keys(evidence.values).length === 0) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), shell: options.shell });
  }
  const refinedShell = collectPreviewInspectorNextPagesShell({
    dynamicParameterValues: evidence.values,
    exportName: 'default',
    pagePath: options.shell.routeLocation.sourcePath,
    sourcePaths: options.sourcePaths,
  });
  return Object.freeze({
    dependencyPaths: evidence.dependencyPaths,
    shell: refinedShell ?? options.shell,
  });
}

/** Collects finite record keys without evaluating the page or any imported project module. */
export async function collectPreviewInspectorStaticRecordParameterValues(
  options: CollectPreviewInspectorStaticRecordParameterValuesOptions,
): Promise<PreviewInspectorStaticRecordParameterValues> {
  const parameterNames = collectDynamicParameterNames(options.pattern);
  if (parameterNames.length === 0) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), values: Object.freeze({}) });
  }
  const inventory = new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  const resolveModule =
    options.resolveModule ?? createLexicalInspectorModuleResolver(options.sourcePaths);
  const sourceBoundary =
    options.staticParameterSourceBoundary === undefined
      ? undefined
      : path.resolve(options.staticParameterSourceBoundary);
  const traversed = await traversePageDependencies({
    inventory,
    pagePath: options.pagePath,
    readSource: options.readSource,
    resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(sourceBoundary === undefined ? {} : { sourceBoundary }),
  });
  const sourceByPath = new Map(traversed.map((source) => [source.sourcePath, source]));
  const valueByParameter: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.initialValues ?? {})) {
    if (typeof value === 'string') valueByParameter[name] = value;
  }
  const dependencies = new Set<string>();

  for (const parameterName of parameterNames) {
    if (valueByParameter[parameterName] !== undefined) continue;
    const candidates: ParameterValueCandidate[] = [];
    for (const source of traversed) {
      const lookups = collectRecordLookups(source.sourceFile, parameterName);
      for (const lookup of lookups) {
        const record = await readStaticRecordKeys({
          expression: lookup.recordExpression,
          inventory,
          readSource: options.readSource,
          resolveModule,
          source,
          sourceByPath,
          parameterValues: valueByParameter,
          ...(sourceBoundary === undefined ? {} : { sourceBoundary }),
        });
        const value = record.keys[0];
        if (value === undefined) continue;
        candidates.push({
          dependencyPaths: record.dependencyPaths,
          occurrenceStart: lookup.occurrenceStart,
          sourceDepth: source.depth,
          sourcePath: source.sourcePath,
          strength: lookup.strength,
          value,
        });
      }
    }
    candidates.sort(compareParameterValueCandidates);
    const selected = candidates[0];
    if (selected === undefined) continue;
    valueByParameter[parameterName] = selected.value;
    dependencies.add(selected.sourcePath);
    for (const dependencyPath of selected.dependencyPaths) dependencies.add(dependencyPath);
  }

  return Object.freeze({
    dependencyPaths: Object.freeze([...dependencies].sort()),
    values: Object.freeze(valueByParameter),
  });
}

/** Reads a small literal-import closure beginning at the selected route leaf. */
async function traversePageDependencies(options: {
  readonly inventory: ReadonlySet<string>;
  readonly pagePath: string;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourceBoundary?: string;
}): Promise<readonly TraversedSource[]> {
  const queue = [{ depth: 0, sourcePath: path.normalize(options.pagePath) }];
  const visited = new Set<string>();
  const traversed: TraversedSource[] = [];
  while (queue.length > 0 && traversed.length < MAX_EVIDENCE_MODULES) {
    throwIfPreviewBuildCancelled(options.signal);
    const current = queue.shift();
    if (current === undefined || visited.has(current.sourcePath)) continue;
    visited.add(current.sourcePath);
    const sourceText = await options.readSource(current.sourcePath);
    if (sourceText === undefined) continue;
    const sourceFile = createSourceFile(current.sourcePath, sourceText);
    traversed.push({ ...current, sourceFile, sourceText });
    if (current.depth >= MAX_IMPORT_DEPTH) continue;
    for (const moduleSpecifier of collectPreviewRenderModuleSpecifiers(
      current.sourcePath,
      sourceText,
    )) {
      const resolved = options.resolveModule(moduleSpecifier, current.sourcePath);
      if (resolved === undefined) continue;
      const normalized = path.normalize(resolved);
      if (
        !isPathInsideStaticSourceBoundary(normalized, options.inventory, options.sourceBoundary) ||
        visited.has(normalized)
      ) {
        continue;
      }
      queue.push({ depth: current.depth + 1, sourcePath: normalized });
    }
  }
  return Object.freeze(traversed);
}

/** Collects ordinary, catch-all, and optional catch-all parameter names in authored order. */
function collectDynamicParameterNames(pattern: string): readonly string[] {
  const names: string[] = [];
  for (const segment of pattern.split('/').filter(Boolean)) {
    const match = /^\[\[?\.\.\.([^\]]+)\]\]?$|^\[([^\]]+)\]$/u.exec(segment);
    const name = match?.[1] ?? match?.[2];
    if (name !== undefined && name.length > 0 && !names.includes(name)) names.push(name);
  }
  return Object.freeze(names);
}

/** Locates finite-record validation and indexed reads controlled by one route parameter. */
function collectRecordLookups(
  sourceFile: ts.SourceFile,
  parameterName: string,
): readonly RecordLookup[] {
  const lookups: RecordLookup[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes' &&
      node.arguments.some((argument) => isParameterExpression(argument, parameterName))
    ) {
      const keysCall = unwrapExpression(node.expression.expression);
      if (
        ts.isCallExpression(keysCall) &&
        ts.isPropertyAccessExpression(keysCall.expression) &&
        ts.isIdentifier(keysCall.expression.expression) &&
        keysCall.expression.expression.text === 'Object' &&
        keysCall.expression.name.text === 'keys' &&
        keysCall.arguments[0] !== undefined
      ) {
        lookups.push({
          occurrenceStart: node.getStart(sourceFile),
          recordExpression: keysCall.arguments[0],
          strength: 0,
        });
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      isParameterExpression(node.argumentExpression, parameterName)
    ) {
      lookups.push({
        occurrenceStart: node.getStart(sourceFile),
        recordExpression: node.expression,
        strength: 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(lookups);
}

/** Accepts the route-named local alias or a direct `query.<parameter>` expression. */
function isParameterExpression(expression: ts.Expression, parameterName: string): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text === parameterName;
  return (
    ts.isPropertyAccessExpression(current) &&
    current.name.text === parameterName &&
    expressionContainsQueryIdentity(current.expression)
  );
}

/** Confirms that a direct property chain contains a query object rather than an arbitrary record. */
function expressionContainsQueryIdentity(expression: ts.Expression): boolean {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    if (current.name.text === 'query') return true;
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) && current.text === 'query';
}

/** Resolves one local/imported record expression and extracts authored object-literal keys. */
async function readStaticRecordKeys(options: {
  readonly expression: ts.Expression;
  readonly inventory: ReadonlySet<string>;
  readonly parameterValues: Readonly<Record<string, string>>;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly source: TraversedSource;
  readonly sourceByPath: Map<string, TraversedSource>;
  readonly sourceBoundary?: string;
}): Promise<{ readonly dependencyPaths: readonly string[]; readonly keys: readonly string[] }> {
  const reference = readRecordReference(
    options.expression,
    options.source.sourceFile,
    options.parameterValues,
  );
  if (reference === undefined) return { dependencyPaths: [], keys: [] };
  if (reference.moduleSpecifier === undefined) {
    return {
      dependencyPaths: [options.source.sourcePath],
      keys: readNamedObjectKeys(
        options.source.sourceFile,
        reference.exportName,
        reference.propertyPath,
      ),
    };
  }
  const resolved = options.resolveModule(reference.moduleSpecifier, options.source.sourcePath);
  if (resolved === undefined) return { dependencyPaths: [], keys: [] };
  const normalized = path.normalize(resolved);
  if (!isPathInsideStaticSourceBoundary(normalized, options.inventory, options.sourceBoundary)) {
    return { dependencyPaths: [], keys: [] };
  }
  let target = options.sourceByPath.get(normalized);
  if (target === undefined) {
    const sourceText = await options.readSource(normalized);
    if (sourceText === undefined) return { dependencyPaths: [], keys: [] };
    target = {
      depth: options.source.depth + 1,
      sourceFile: createSourceFile(normalized, sourceText),
      sourcePath: normalized,
      sourceText,
    };
    options.sourceByPath.set(normalized, target);
  }
  return {
    dependencyPaths: [normalized],
    keys: readNamedObjectKeys(target.sourceFile, reference.exportName, reference.propertyPath),
  };
}

/** Maps a possibly nested record receiver to its local declaration or exact imported export. */
function readRecordReference(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  parameterValues: Readonly<Record<string, string>>,
): RecordReference | undefined {
  const access = readRecordAccess(expression, parameterValues);
  if (access === undefined) return undefined;
  const { localName } = access;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name?.text === localName) {
      return {
        exportName: 'default',
        moduleSpecifier: statement.moduleSpecifier.text,
        propertyPath: access.propertyPath,
      };
    }
    const bindings = clause?.namedBindings;
    if (
      bindings !== undefined &&
      ts.isNamespaceImport(bindings) &&
      bindings.name.text === localName
    ) {
      const [exportName, ...propertyPath] = access.propertyPath;
      return exportName === undefined
        ? undefined
        : { exportName, moduleSpecifier: statement.moduleSpecifier.text, propertyPath };
    }
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.name.text !== localName) continue;
        return {
          exportName: element.propertyName?.text ?? element.name.text,
          moduleSpecifier: statement.moduleSpecifier.text,
          propertyPath: access.propertyPath,
        };
      }
    }
  }
  return { exportName: localName, propertyPath: access.propertyPath };
}

/** Resolves a root identifier plus literal or previously proven nested record keys. */
function readRecordAccess(
  expression: ts.Expression,
  parameterValues: Readonly<Record<string, string>>,
): { readonly localName: string; readonly propertyPath: readonly string[] } | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return { localName: current.text, propertyPath: Object.freeze([]) };
  }
  const owner =
    ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
      ? readRecordAccess(current.expression, parameterValues)
      : undefined;
  if (owner === undefined) return undefined;
  const propertyName = ts.isPropertyAccessExpression(current)
    ? current.name.text
    : ts.isElementAccessExpression(current)
      ? readRecordAccessProperty(current.argumentExpression, parameterValues)
      : undefined;
  return propertyName === undefined || !isSafeRouteValue(propertyName)
    ? undefined
    : {
        localName: owner.localName,
        propertyPath: Object.freeze([...owner.propertyPath, propertyName]),
      };
}

/** Reads a literal selector or a route key already proven by an outer record. */
function readRecordAccessProperty(
  expression: ts.Expression,
  parameterValues: Readonly<Record<string, string>>,
): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current) || ts.isNumericLiteral(current)) return current.text;
  return ts.isIdentifier(current) ? parameterValues[current.text] : undefined;
}

/** Extracts safe keys below a named variable/default export and an exact nested property path. */
function readNamedObjectKeys(
  sourceFile: ts.SourceFile,
  exportName: string,
  propertyPath: readonly string[],
): readonly string[] {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
        const keys = readObjectLiteralKeys(
          readObjectPropertyPath(declaration.initializer, propertyPath),
        );
        if (keys.length > 0) return keys;
      }
    }
    if (exportName === 'default' && ts.isExportAssignment(statement)) {
      const keys = readObjectLiteralKeys(
        readObjectPropertyPath(statement.expression, propertyPath),
      );
      if (keys.length > 0) return keys;
    }
  }
  return Object.freeze([]);
}

/** Walks only directly authored object-literal properties; getters, spreads, and calls fail closed. */
function readObjectPropertyPath(
  expression: ts.Expression | undefined,
  propertyPath: readonly string[],
): ts.Expression | undefined {
  let current = expression;
  for (const propertyName of propertyPath) {
    if (current === undefined) return undefined;
    const object = unwrapExpression(current);
    if (!ts.isObjectLiteralExpression(object)) return undefined;
    const property = object.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) &&
        readStaticPropertyName(candidate.name) === propertyName,
    );
    current = property?.initializer;
  }
  return current;
}

/** Reads only literal property names; spreads, methods, and computed runtime keys are ignored. */
function readObjectLiteralKeys(expression: ts.Expression | undefined): readonly string[] {
  if (expression === undefined) return Object.freeze([]);
  const current = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(current)) return Object.freeze([]);
  const keys: string[] = [];
  for (const property of current.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = readStaticPropertyName(property.name);
    if (key === undefined || !isSafeRouteValue(key)) continue;
    keys.push(key);
    if (keys.length >= MAX_STATIC_RECORD_KEYS) break;
  }
  return Object.freeze(keys);
}

/** Converts identifier/string/numeric property syntax into a route-safe scalar. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

/** Rejects values that could escape a single local pathname segment or distort the preview. */
function isSafeRouteValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}

/** Removes syntax-only wrappers without executing conversion helpers or callbacks. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  if (
    ts.isCallExpression(current) &&
    current.arguments[0] !== undefined &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    current.expression.expression.text === 'Object' &&
    current.expression.name.text === 'freeze'
  ) {
    return unwrapExpression(current.arguments[0]);
  }
  return current;
}

/** Prefers explicit membership guards, then nearer and earlier authored evidence. */
function compareParameterValueCandidates(
  left: ParameterValueCandidate,
  right: ParameterValueCandidate,
): number {
  return (
    left.strength - right.strength ||
    left.sourceDepth - right.sourceDepth ||
    left.occurrenceStart - right.occurrenceStart ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.value.localeCompare(right.value)
  );
}

/** Parses TS/JS and JSX/TSX fixtures with the same conservative syntax surface. */
function createSourceFile(sourcePath: string, sourceText: string): ts.SourceFile {
  const lowerPath = sourcePath.toLowerCase();
  const scriptKind = lowerPath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}
