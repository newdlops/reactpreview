/**
 * Protects GraphQL tagged-template composition from preview-only circular initialization order.
 * Application bundles commonly export a fragment from a UI module that also imports the query
 * consuming that fragment. A partial page graph can therefore observe the imported binding before
 * initialization and make `graphql-tag` append the word `undefined`, aborting the whole page shell.
 *
 * This module never executes application code. It follows only statically resolved workspace
 * imports, extracts authored `gql` fragment text with a strict traversal budget, and wraps the
 * original interpolation with an Inspector resolver. Real initialized DocumentNodes remain
 * untouched; the authored fragment text is used only when the binding is nullish or throws.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { StaticSourceAnalysis } from './staticCallParser';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const MAX_DOCUMENT_CHARACTERS = 64 * 1024;
const MAX_FRAGMENT_NAMES = 32;
const MAX_RESOLUTION_DEPTH = 16;
const GRAPHQL_MODULE_PATTERN = /^(?:graphql-tag|@apollo\/client|apollo-client)(?:\/|$)/u;
const FRAGMENT_DEFINITION_PATTERN = /\bfragment\s+([_A-Za-z][_0-9A-Za-z]*)\s+on\s+/gu;

/** Static module operations deliberately narrower than the compiler's full resolver. */
export interface PreviewGraphqlDocumentInstrumentationOptions {
  /** Dirty-editor lookup; returning undefined delegates to TypeScript's read-only disk host. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Resolves one authored import under the active tsconfig/jsconfig alias policy. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Trusted boundary outside which source is never parsed or copied into generated output. */
  readonly workspaceRoot: string;
}

/** One imported binding needed for local expression resolution. */
interface ImportedBinding {
  /** Export name requested from the resolved dependency. */
  readonly exportName: string;
  /** Authored module specifier retained until the resolver proves a workspace path. */
  readonly moduleSpecifier: string;
}

/** Syntax inventory cached per fragment-bearing source module. */
interface GraphqlModuleRecord {
  /** Imported local identifiers, including imports unrelated to `gql`. */
  readonly imports: ReadonlyMap<string, ImportedBinding>;
  /** Every local variable initializer addressable by a direct identifier. */
  readonly initializers: ReadonlyMap<string, ts.Expression>;
  /** Namespace imports used by `Apollo.gql` and `Fragments.X` syntax. */
  readonly namespaceImports: ReadonlyMap<string, string>;
  /** Absolute normalized source identity. */
  readonly sourcePath: string;
  /** Parser-owned source tree. */
  readonly sourceFile: ts.SourceFile;
  /** Current editor or disk text corresponding to the tree. */
  readonly sourceText: string;
  /** Local bindings statically proven to be GraphQL template tags. */
  readonly tagBindings: ReadonlySet<string>;
}

/** Authored fragment source plus the module that supplied the outer export. */
interface ResolvedGraphqlDocument {
  /** Fully expanded GraphQL source with nested imported fragments included. */
  readonly source: string;
  /** Source module that contains the exported document definition. */
  readonly sourcePath: string;
}

/** Bounded DFS state shared while one interpolation is expanded. */
interface GraphqlResolutionState {
  /** Current recursion depth across imports, exports, local aliases, and nested templates. */
  readonly depth: number;
  /** Semantic binding identities already visited by this one resolution. */
  readonly seen: ReadonlySet<string>;
}

/**
 * Builds source replacements for GraphQL fragment interpolations reached by Page Inspector.
 * The per-build instance caches parsed dependency modules, avoiding repeated reads when a large
 * query composes the same fragments or several reached queries share a barrel module.
 */
export class PreviewGraphqlDocumentInstrumentation {
  private readonly moduleCache = new Map<string, GraphqlModuleRecord | undefined>();
  private readonly workspaceRoot: string;

  /** Creates a bounded, read-only fragment catalog for one compilation attempt. */
  public constructor(private readonly options: PreviewGraphqlDocumentInstrumentationOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  /**
   * Wraps only interpolations whose fallback fragment can be proven from authored workspace source.
   *
   * @param sourcePath Absolute module currently loaded by esbuild.
   * @param sourceText Current dirty-editor or disk source.
   * @param analysis Existing syntax-valid AST index owned by the main source transformer.
   * @returns Non-overlapping expression replacements inside GraphQL template spans.
   */
  public createReplacements(
    sourcePath: string,
    sourceText: string,
    analysis: StaticSourceAnalysis,
  ): readonly PreviewSourceReplacement[] {
    const record = this.createModuleRecord(sourcePath, sourceText, analysis.getSourceFile());
    this.moduleCache.set(path.normalize(sourcePath), record);
    const replacements: PreviewSourceReplacement[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && this.isGraphqlTag(node.tag, record)) {
        if (ts.isTemplateExpression(node.template)) {
          for (const span of node.template.templateSpans) {
            const resolution = this.resolveExpression(record, span.expression, {
              depth: 0,
              seen: new Set<string>(),
            });
            const fragmentNames =
              resolution === undefined ? [] : collectGraphqlFragmentNames(resolution.source);
            if (resolution === undefined || fragmentNames.length === 0) continue;
            const start = span.expression.getStart(record.sourceFile);
            const location = record.sourceFile.getLineAndCharacterOfPosition(start);
            const originalExpression = sourceText.slice(start, span.expression.end);
            const metadata = {
              bindingName: readExpressionLabel(span.expression, record.sourceFile),
              column: location.character + 1,
              fragmentNames,
              fragmentSourcePath: resolution.sourcePath,
              id: createGraphqlInterpolationIdentity(
                record.sourcePath,
                start,
                resolution.sourcePath,
                fragmentNames,
              ),
              line: location.line + 1,
              sourcePath: record.sourcePath,
            };
            replacements.push({
              end: span.expression.end,
              replacement: createGraphqlInterpolationResolver(
                originalExpression,
                resolution.source,
                metadata,
              ),
              start,
            });
          }
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(record.sourceFile);
    return replacements;
  }

  /** Resolves a local, imported, namespace, or directly tagged GraphQL expression. */
  private resolveExpression(
    record: GraphqlModuleRecord,
    expression: ts.Expression,
    state: GraphqlResolutionState,
  ): ResolvedGraphqlDocument | undefined {
    if (state.depth > MAX_RESOLUTION_DEPTH) return undefined;
    const unwrapped = unwrapGraphqlExpression(expression);
    if (ts.isTaggedTemplateExpression(unwrapped) && this.isGraphqlTag(unwrapped.tag, record)) {
      const source = this.expandTemplate(record, unwrapped.template, state);
      return source === undefined ? undefined : { source, sourcePath: record.sourcePath };
    }
    if (ts.isIdentifier(unwrapped)) {
      return this.resolveLocalBinding(record, unwrapped.text, state);
    }
    if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
      const moduleSpecifier = record.namespaceImports.get(unwrapped.expression.text);
      return moduleSpecifier === undefined
        ? undefined
        : this.resolveImportedExport(record, moduleSpecifier, unwrapped.name.text, state);
    }
    return undefined;
  }

  /** Resolves one local variable alias or named/default import without evaluating either module. */
  private resolveLocalBinding(
    record: GraphqlModuleRecord,
    bindingName: string,
    state: GraphqlResolutionState,
  ): ResolvedGraphqlDocument | undefined {
    const identity = `${record.sourcePath}\0local\0${bindingName}`;
    const nextState = advanceGraphqlResolutionState(state, identity);
    if (nextState === undefined) return undefined;
    const initializer = record.initializers.get(bindingName);
    if (initializer !== undefined) {
      return this.resolveExpression(record, initializer, nextState);
    }
    const imported = record.imports.get(bindingName);
    return imported === undefined
      ? undefined
      : this.resolveImportedExport(
          record,
          imported.moduleSpecifier,
          imported.exportName,
          nextState,
        );
  }

  /** Resolves an import specifier, rejects external paths, then follows its requested export. */
  private resolveImportedExport(
    consumer: GraphqlModuleRecord,
    moduleSpecifier: string,
    exportName: string,
    state: GraphqlResolutionState,
  ): ResolvedGraphqlDocument | undefined {
    const resolvedPath = this.options.resolveModule(moduleSpecifier, consumer.sourcePath);
    if (resolvedPath === undefined || !isPathInside(this.workspaceRoot, resolvedPath)) {
      return undefined;
    }
    return this.resolveExport(resolvedPath, exportName, state);
  }

  /** Follows direct exports, named re-exports, local export aliases, and bounded export stars. */
  private resolveExport(
    sourcePath: string,
    exportName: string,
    state: GraphqlResolutionState,
  ): ResolvedGraphqlDocument | undefined {
    const record = this.readModuleRecord(sourcePath);
    if (record === undefined) return undefined;
    const identity = `${record.sourcePath}\0export\0${exportName}`;
    const nextState = advanceGraphqlResolutionState(state, identity);
    if (nextState === undefined) return undefined;

    if (exportName === 'default') {
      const assignment = record.sourceFile.statements.find(
        (statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement),
      );
      if (assignment !== undefined) {
        return this.resolveExpression(record, assignment.expression, nextState);
      }
    }
    const direct = record.initializers.get(exportName);
    if (direct !== undefined && isLocallyExported(record.sourceFile, exportName)) {
      return this.resolveExpression(record, direct, nextState);
    }

    for (const statement of record.sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      const moduleSpecifier = readModuleSpecifier(statement.moduleSpecifier);
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text !== exportName) continue;
          const localName = element.propertyName?.text ?? element.name.text;
          return moduleSpecifier === undefined
            ? this.resolveLocalBinding(record, localName, nextState)
            : this.resolveImportedExport(record, moduleSpecifier, localName, nextState);
        }
      } else if (statement.exportClause === undefined && moduleSpecifier !== undefined) {
        const wildcard = this.resolveImportedExport(record, moduleSpecifier, exportName, nextState);
        if (wildcard !== undefined) return wildcard;
      }
    }
    return undefined;
  }

  /** Expands nested fragment interpolations into one static GraphQL source string. */
  private expandTemplate(
    record: GraphqlModuleRecord,
    template: ts.TemplateLiteral,
    state: GraphqlResolutionState,
  ): string | undefined {
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      return boundGraphqlDocumentSource(readTemplateLiteralText(template));
    }
    let source = readTemplateLiteralText(template.head);
    for (const span of template.templateSpans) {
      const nested = this.resolveExpression(record, span.expression, {
        depth: state.depth + 1,
        seen: state.seen,
      });
      if (nested === undefined) return undefined;
      source += nested.source + readTemplateLiteralText(span.literal);
      if (source.length > MAX_DOCUMENT_CHARACTERS) return undefined;
    }
    return boundGraphqlDocumentSource(source);
  }

  /** Reads and parses one trusted module once, preferring the active editor snapshot. */
  private readModuleRecord(sourcePath: string): GraphqlModuleRecord | undefined {
    const normalizedPath = path.normalize(sourcePath);
    if (this.moduleCache.has(normalizedPath)) return this.moduleCache.get(normalizedPath);
    if (!isPathInside(this.workspaceRoot, normalizedPath)) {
      this.moduleCache.set(normalizedPath, undefined);
      return undefined;
    }
    const sourceText = this.options.readSource?.(normalizedPath) ?? ts.sys.readFile(normalizedPath);
    if (sourceText === undefined || sourceText.length > 4 * MAX_DOCUMENT_CHARACTERS) {
      this.moduleCache.set(normalizedPath, undefined);
      return undefined;
    }
    const sourceFile = ts.createSourceFile(
      normalizedPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(normalizedPath),
    );
    const record = this.createModuleRecord(normalizedPath, sourceText, sourceFile);
    this.moduleCache.set(normalizedPath, record);
    return record;
  }

  /** Creates the small binding inventory needed by GraphQL source resolution. */
  private createModuleRecord(
    sourcePath: string,
    sourceText: string,
    sourceFile: ts.SourceFile,
  ): GraphqlModuleRecord {
    const imports = new Map<string, ImportedBinding>();
    const initializers = new Map<string, ts.Expression>();
    const namespaceImports = new Map<string, string>();
    const tagBindings = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        const moduleSpecifier = readModuleSpecifier(statement.moduleSpecifier);
        const clause = statement.importClause;
        if (moduleSpecifier === undefined || clause === undefined) continue;
        if (clause.name !== undefined) {
          imports.set(clause.name.text, { exportName: 'default', moduleSpecifier });
          if (isGraphqlModule(moduleSpecifier)) tagBindings.add(clause.name.text);
        }
        if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            imports.set(element.name.text, { exportName: importedName, moduleSpecifier });
            if (
              isGraphqlModule(moduleSpecifier) &&
              (importedName === 'gql' ||
                (moduleSpecifier === 'graphql-tag' && importedName === 'default'))
            ) {
              tagBindings.add(element.name.text);
            }
          }
        } else if (
          clause.namedBindings !== undefined &&
          ts.isNamespaceImport(clause.namedBindings)
        ) {
          namespaceImports.set(clause.namedBindings.name.text, moduleSpecifier);
        }
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          initializers.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    return {
      imports,
      initializers,
      namespaceImports,
      sourceFile,
      sourcePath: path.normalize(sourcePath),
      sourceText,
      tagBindings,
    };
  }

  /** Recognizes only GraphQL package imports, avoiding unrelated local template tag functions. */
  private isGraphqlTag(tag: ts.LeftHandSideExpression, record: GraphqlModuleRecord): boolean {
    const unwrapped = unwrapGraphqlExpression(tag);
    if (ts.isIdentifier(unwrapped)) return record.tagBindings.has(unwrapped.text);
    if (!ts.isPropertyAccessExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) {
      return false;
    }
    const moduleSpecifier = record.namespaceImports.get(unwrapped.expression.text);
    return (
      unwrapped.name.text === 'gql' &&
      moduleSpecifier !== undefined &&
      isGraphqlModule(moduleSpecifier)
    );
  }
}

/** Produces a runtime call that preserves the real binding and contains an inert no-API fallback. */
function createGraphqlInterpolationResolver(
  originalExpression: string,
  fallbackSource: string,
  metadata: Readonly<Record<string, unknown>>,
): string {
  const fallback = JSON.stringify(fallbackSource);
  const api = `globalThis[Symbol.for(${JSON.stringify(INSPECTOR_API_SYMBOL)})]`;
  return `((__reactPreviewGraphqlApi) => typeof __reactPreviewGraphqlApi?.resolveGraphqlInterpolation === 'function' ? __reactPreviewGraphqlApi.resolveGraphqlInterpolation(() => (${originalExpression}), ${fallback}, ${JSON.stringify(metadata)}) : (() => { try { const __reactPreviewGraphqlValue = (${originalExpression}); return __reactPreviewGraphqlValue ?? ${fallback}; } catch { return ${fallback}; } })())(${api})`;
}

/** Advances immutable DFS state while rejecting cycles and excessive dependency depth. */
function advanceGraphqlResolutionState(
  state: GraphqlResolutionState,
  identity: string,
): GraphqlResolutionState | undefined {
  if (state.depth >= MAX_RESOLUTION_DEPTH || state.seen.has(identity)) return undefined;
  return { depth: state.depth + 1, seen: new Set([...state.seen, identity]) };
}

/** Removes TypeScript-only wrappers without changing the underlying runtime expression. */
function unwrapGraphqlExpression(expression: ts.Expression): ts.Expression {
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
  return current;
}

/** Reports whether a direct variable declaration carries an export modifier. */
function isLocallyExported(sourceFile: ts.SourceFile, bindingName: string): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
        true &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === bindingName,
      ),
  );
}

/** Reads a string-literal module specifier without evaluating arbitrary expressions. */
function readModuleSpecifier(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** Recognizes established GraphQL tag packages without admitting arbitrary local template tags. */
function isGraphqlModule(moduleSpecifier: string): boolean {
  return moduleSpecifier === 'graphql-tag' || GRAPHQL_MODULE_PATTERN.test(moduleSpecifier);
}

/** Preserves raw template escape spelling where TypeScript exposes it. */
function readTemplateLiteralText(node: ts.TemplateLiteralLikeNode): string {
  const rawText = (node as ts.TemplateLiteralLikeNode & { readonly rawText?: string }).rawText;
  return rawText ?? node.text;
}

/** Rejects oversized or blank document fallbacks before they can enter generated JavaScript. */
function boundGraphqlDocumentSource(source: string): string | undefined {
  return source.trim().length > 0 && source.length <= MAX_DOCUMENT_CHARACTERS ? source : undefined;
}

/** Extracts stable fragment names for diagnostics and rejects non-fragment interpolation values. */
function collectGraphqlFragmentNames(source: string): readonly string[] {
  const names: string[] = [];
  FRAGMENT_DEFINITION_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(FRAGMENT_DEFINITION_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
    if (names.length >= MAX_FRAGMENT_NAMES) break;
  }
  return names;
}

/** Creates a human-readable binding label without trusting it as a generated identifier. */
function readExpressionLabel(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return expression.getText(sourceFile).slice(0, 512);
}

/** Creates a hot-reload-stable identity from authored interpolation and fragment semantics. */
function createGraphqlInterpolationIdentity(
  sourcePath: string,
  start: number,
  fragmentSourcePath: string,
  fragmentNames: readonly string[],
): string {
  return `graphql:${createHash('sha256')
    .update(JSON.stringify([path.normalize(sourcePath), start, fragmentSourcePath, fragmentNames]))
    .digest('hex')
    .slice(0, 24)}`;
}

/** Keeps fragment resolution inside the trusted workspace, including the workspace root itself. */
function isPathInside(workspaceRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, path.resolve(sourcePath));
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/** Selects TypeScript's parser grammar from the resolved source extension. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
