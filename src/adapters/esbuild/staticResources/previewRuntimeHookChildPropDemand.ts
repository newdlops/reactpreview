/**
 * Carries a reached child component's local prop demand back to a hook-fed JSX attribute.
 *
 * Hook inference is normally lexical: `query.data.data` is visible in the parent, while the fact
 * that `<HistoryTable data={query.data.data}>` later reads `data.rows.map(...)` lives in another
 * module. This bounded catalog resolves only imported components that are actually used as JSX,
 * reads their syntax-only exported-prop inference, and exposes operation-proven leaf requirements
 * to the parent hook analyzer. No application module is imported or executed.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  collectReactExportPropInference,
  type PreviewInferredPropShape,
} from './reactExportPropInference';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import type { PreviewRuntimeFunction } from './previewRuntimeHookSyntax';

const MAX_COMPONENT_IMPORTS = 16;
const MAX_PROP_DEMANDS = 32;
const MAX_PROP_DEPTH = 8;
const MAX_SOURCE_CHARACTERS = 512 * 1024;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Operation-shaped use compatible with the hook analyzer's internal property-path contract. */
export interface PreviewRuntimeHookChildPropUsage {
  readonly called: boolean;
  readonly collectionProperty?: string;
  readonly names: readonly string[];
  readonly stringProperty?: string;
}

/** Child prop shapes indexed by the local JSX component binding and authored attribute name. */
export type PreviewRuntimeHookChildPropDemandCatalog = ReadonlyMap<
  string,
  ReadonlyMap<string, PreviewInferredPropShape>
>;

/** Minimal read-only module operations needed by the cross-component syntax catalog. */
export interface PreviewRuntimeHookChildPropDemandOptions {
  /** Returns a dirty editor snapshot before the catalog consults TypeScript's read-only host. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Resolves an authored import according to the active tsconfig/jsconfig aliases. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Trusted workspace boundary outside which component source is never inspected. */
  readonly workspaceRoot: string;
}

/** Imported component binding before its module is resolved and parsed. */
interface ImportedComponentBinding {
  readonly exportName: string;
  readonly moduleSpecifier: string;
}

/**
 * Caches child prop inference for one compilation attempt while keeping every traversal bounded.
 */
export class PreviewRuntimeHookChildPropDemandCatalogBuilder {
  private readonly inferenceCache = new Map<
    string,
    Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> | undefined
  >();
  private readonly workspaceRoot: string;

  /** Creates a catalog builder without executing project resolvers or configuration code. */
  public constructor(private readonly options: PreviewRuntimeHookChildPropDemandOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  /** Resolves only component imports rendered by the current source module. */
  public collect(sourcePath: string, sourceText: string): PreviewRuntimeHookChildPropDemandCatalog {
    if (!sourceText.includes('<') || !sourceText.includes('import')) return new Map();
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(sourcePath),
    );
    if (hasParseDiagnostics(sourceFile)) return new Map();
    const imports = collectImportedComponentBindings(sourceFile);
    const usedComponents = collectUsedJsxComponentBindings(
      sourceFile,
      collectHookResultBindings(sourceFile),
    );
    const catalog = new Map<string, ReadonlyMap<string, PreviewInferredPropShape>>();
    for (const localName of usedComponents) {
      if (catalog.size >= MAX_COMPONENT_IMPORTS) break;
      const imported = imports.get(localName);
      if (imported === undefined) continue;
      const resolvedPath = this.options.resolveModule(imported.moduleSpecifier, sourcePath);
      if (resolvedPath === undefined || !this.isInspectableSource(resolvedPath)) continue;
      const inference = this.readInference(resolvedPath)?.[imported.exportName];
      const properties = inference?.shape.properties;
      if (properties === undefined || Object.keys(properties).length === 0) continue;
      catalog.set(localName, new Map(Object.entries(properties)));
    }
    return catalog;
  }

  /** Reads and caches one resolved component source under strict path and text-size limits. */
  private readInference(
    sourcePath: string,
  ): Readonly<Record<string, { readonly shape: PreviewInferredPropShape }>> | undefined {
    const normalizedPath = path.normalize(sourcePath);
    if (this.inferenceCache.has(normalizedPath)) return this.inferenceCache.get(normalizedPath);
    const sourceText = this.options.readSource?.(normalizedPath) ?? ts.sys.readFile(normalizedPath);
    const inference =
      sourceText === undefined || sourceText.length > MAX_SOURCE_CHARACTERS
        ? undefined
        : collectReactExportPropInference(normalizedPath, sourceText);
    this.inferenceCache.set(normalizedPath, inference);
    return inference;
  }

  /** Rejects generated declarations, non-source assets, and workspace-escaping resolution. */
  private isInspectableSource(sourcePath: string): boolean {
    const normalizedPath = path.resolve(sourcePath);
    const relative = path.relative(this.workspaceRoot, normalizedPath);
    return (
      SOURCE_PATTERN.test(normalizedPath) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }
}

/**
 * Finds JSX attributes rooted at one hook result and appends the child component's proven demand.
 * Optional source chains stay authored: only a non-optional identity path can make a missing child
 * field a hard requirement on the hook fallback.
 */
export function readPreviewRuntimeHookChildPropUsages(
  identifier: ts.Identifier,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
): readonly PreviewRuntimeHookChildPropUsage[] {
  if (catalog === undefined || catalog.size === 0) return [];
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return [];
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
      const sourcePath =
        expression === undefined
          ? undefined
          : readRequiredIdentifierPath(expression, identifier.text);
      const propName = ts.isIdentifier(node.name) ? node.name.text : undefined;
      const componentName = readJsxAttributeComponentName(node);
      const shape =
        sourcePath === undefined || propName === undefined || componentName === undefined
          ? undefined
          : catalog.get(componentName)?.get(propName);
      if (shape !== undefined && sourcePath !== undefined) {
        appendShapeUsages(shape, sourcePath, [], usages, 0);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return deduplicateUsages(usages);
}

/** Indexes default and named imports; namespace/member JSX remains conservatively unsupported. */
function collectImportedComponentBindings(
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
function collectHookResultBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
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
function isHookCallee(expression: ts.LeftHandSideExpression): boolean {
  const unwrapped = unwrapPreviewRuntimeExpression(expression);
  const name = ts.isIdentifier(unwrapped)
    ? unwrapped.text
    : ts.isPropertyAccessExpression(unwrapped)
      ? unwrapped.name.text
      : '';
  return /^use[A-Z0-9_$]/u.test(name);
}

/** Records identifier leaves from one hook-result binding pattern. */
function appendBindingNames(binding: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(binding)) {
    names.add(binding.text);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNames(element.name, names);
  }
}

/** Collects JSX components whose attribute directly receives one hook-result identity path. */
function collectUsedJsxComponentBindings(
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
function readHookResultRootName(
  expression: ts.Expression,
  hookResultBindings: ReadonlySet<string>,
): string | undefined {
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && hookResultBindings.has(current.text)
    ? current.text
    : undefined;
}

/** Reads the owning simple JSX tag for one attribute. */
function readJsxAttributeComponentName(attribute: ts.JsxAttribute): string | undefined {
  const attributes = attribute.parent;
  const element = attributes.parent;
  return (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
    ts.isIdentifier(element.tagName)
    ? element.tagName.text
    : undefined;
}

/** Reads a non-optional identifier/property chain rooted at the requested hook local. */
function readRequiredIdentifierPath(
  expression: ts.Expression,
  identifierName: string,
): readonly string[] | undefined {
  const suffix: string[] = [];
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && current.text === identifierName ? suffix : undefined;
}

/** Flattens operation-proven child leaves onto the hook-relative carrier path. */
function appendShapeUsages(
  shape: PreviewInferredPropShape,
  sourcePath: readonly string[],
  relativePath: readonly string[],
  usages: PreviewRuntimeHookChildPropUsage[],
  depth: number,
): void {
  if (depth > MAX_PROP_DEPTH || usages.length >= MAX_PROP_DEMANDS) return;
  const names = [...sourcePath, ...relativePath];
  if (shape.kind === 'array') {
    usages.push({ called: false, collectionProperty: 'map', names });
    return;
  }
  if (shape.kind === 'function') {
    usages.push({ called: true, names });
    return;
  }
  if (shape.kind === 'string') {
    usages.push({ called: false, names, stringProperty: 'trim' });
    return;
  }
  if (shape.kind !== 'object' || shape.properties === undefined) return;
  for (const [propertyName, child] of Object.entries(shape.properties)) {
    if (usages.length >= MAX_PROP_DEMANDS) break;
    appendShapeUsages(child, sourcePath, [...relativePath, propertyName], usages, depth + 1);
  }
}

/** Keeps one source-ordered occurrence of every propagated component-prop demand. */
function deduplicateUsages(
  usages: readonly PreviewRuntimeHookChildPropUsage[],
): readonly PreviewRuntimeHookChildPropUsage[] {
  const retained = new Map<string, PreviewRuntimeHookChildPropUsage>();
  for (const usage of usages) {
    const key = `${usage.names.join('.')}\u0000${usage.collectionProperty ?? usage.stringProperty ?? (usage.called ? 'call' : 'value')}`;
    if (!retained.has(key)) retained.set(key, usage);
  }
  return [...retained.values()];
}

/** Detects a nested function parameter that replaces the analyzed hook-result identifier. */
function functionShadowsName(scope: PreviewRuntimeFunction, identifierName: string): boolean {
  return scope.parameters.some((parameter) => bindingContainsName(parameter.name, identifierName));
}

/** Recursively checks one parameter pattern without evaluating authored defaults. */
function bindingContainsName(binding: ts.BindingName, identifierName: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === identifierName;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, identifierName),
  );
}

/** Selects the parser grammar without trusting file contents. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
    return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Rejects TypeScript parser recovery before relying on source offsets or binding identities. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}

/** Mirrors React's conventional component identifier casing without guessing lowercase wrappers. */
function isPascalCase(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}\u200C\u200D]*$/u.test(name);
}
