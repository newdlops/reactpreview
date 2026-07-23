/**
 * Infers safe values for dynamic Next.js Pages Router segments from authored static records.
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

interface ImportBinding {
  readonly exportName: string;
  readonly moduleSpecifier?: string;
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
  const parameterNames = collectDynamicParameterNames(options.shell.routeLocation.pattern);
  if (parameterNames.length === 0) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), shell: options.shell });
  }
  const inventory = new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  const resolveModule =
    options.resolveModule ?? createLexicalInspectorModuleResolver(options.sourcePaths);
  const traversed = await traversePageDependencies({
    inventory,
    pagePath: options.shell.routeLocation.sourcePath,
    readSource: options.readSource,
    resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.staticParameterSourceBoundary === undefined
      ? {}
      : { sourceBoundary: path.resolve(options.staticParameterSourceBoundary) }),
  });
  const sourceByPath = new Map(traversed.map((source) => [source.sourcePath, source]));
  const valueByParameter: Record<string, string> = {};
  const dependencies = new Set<string>();

  for (const parameterName of parameterNames) {
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
          ...(options.staticParameterSourceBoundary === undefined
            ? {}
            : { sourceBoundary: path.resolve(options.staticParameterSourceBoundary) }),
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

  if (Object.keys(valueByParameter).length === 0) {
    return Object.freeze({ dependencyPaths: Object.freeze([]), shell: options.shell });
  }
  const refinedShell = collectPreviewInspectorNextPagesShell({
    dynamicParameterValues: valueByParameter,
    exportName: 'default',
    pagePath: options.shell.routeLocation.sourcePath,
    sourcePaths: options.sourcePaths,
  });
  return Object.freeze({
    dependencyPaths: Object.freeze([...dependencies].sort()),
    shell: refinedShell ?? options.shell,
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
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly source: TraversedSource;
  readonly sourceByPath: Map<string, TraversedSource>;
  readonly sourceBoundary?: string;
}): Promise<{ readonly dependencyPaths: readonly string[]; readonly keys: readonly string[] }> {
  const reference = readRecordReference(options.expression, options.source.sourceFile);
  if (reference === undefined) return { dependencyPaths: [], keys: [] };
  if (reference.moduleSpecifier === undefined) {
    return {
      dependencyPaths: [options.source.sourcePath],
      keys: readNamedObjectKeys(options.source.sourceFile, reference.exportName),
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
    keys: readNamedObjectKeys(target.sourceFile, reference.exportName),
  };
}

/** Maps a record receiver to either its local declaration or exact imported export. */
function readRecordReference(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): ImportBinding | undefined {
  const current = unwrapExpression(expression);
  let localName: string;
  let namespaceProperty: string | undefined;
  if (ts.isIdentifier(current)) {
    localName = current.text;
  } else if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression)) {
    localName = current.expression.text;
    namespaceProperty = current.name.text;
  } else {
    return undefined;
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name?.text === localName && namespaceProperty === undefined) {
      return { exportName: 'default', moduleSpecifier: statement.moduleSpecifier.text };
    }
    const bindings = clause?.namedBindings;
    if (
      bindings !== undefined &&
      ts.isNamespaceImport(bindings) &&
      bindings.name.text === localName
    ) {
      return namespaceProperty === undefined
        ? undefined
        : { exportName: namespaceProperty, moduleSpecifier: statement.moduleSpecifier.text };
    }
    if (bindings !== undefined && ts.isNamedImports(bindings) && namespaceProperty === undefined) {
      for (const element of bindings.elements) {
        if (element.name.text !== localName) continue;
        return {
          exportName: element.propertyName?.text ?? element.name.text,
          moduleSpecifier: statement.moduleSpecifier.text,
        };
      }
    }
  }
  return namespaceProperty === undefined ? { exportName: localName } : undefined;
}

/** Extracts safe direct keys from a named variable or default object export. */
function readNamedObjectKeys(sourceFile: ts.SourceFile, exportName: string): readonly string[] {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
        const keys = readObjectLiteralKeys(declaration.initializer);
        if (keys.length > 0) return keys;
      }
    }
    if (exportName === 'default' && ts.isExportAssignment(statement)) {
      const keys = readObjectLiteralKeys(statement.expression);
      if (keys.length > 0) return keys;
    }
  }
  return Object.freeze([]);
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
