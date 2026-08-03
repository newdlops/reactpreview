/**
 * Finds a route catalog through factory dependency imports rather than repository filename scans.
 *
 * Only JSON data is interpreted. JavaScript and TypeScript files contribute import/identifier
 * edges, never executable values, and traversal stops at small fixed module and edge budgets.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { joinPreviewInspectorRouteSegments } from './previewInspectorRoutePattern';

/** One JSON-backed pattern with the exact catalog source that supplied it. */
export interface PreviewInspectorRouteCatalogPatternEvidence {
  readonly catalogSourcePath: string;
  readonly pattern: string;
}

/** Runtime collision behavior proven by an exact immutable catalog transform. */
type PreviewInspectorRouteCatalogCollisionPolicy = 'all' | 'last';

/** Collects expected page-name leaves from JSON reachable through a factory catalog binding. */
export async function collectPreviewInspectorRouteFactoryCatalog(options: {
  readonly catalogBindingKind?: 'export' | 'local';
  readonly catalogBindingName: string;
  readonly expectedComponentNames: ReadonlySet<string>;
  readonly maximumModules?: number;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
}): Promise<{
  readonly dependencyPaths: readonly string[];
  readonly entriesByComponentName: ReadonlyMap<
    string,
    readonly PreviewInspectorRouteCatalogPatternEvidence[]
  >;
  readonly patternsByComponentName: ReadonlyMap<string, readonly string[]>;
}> {
  const maximumModules = options.maximumModules ?? 12;
  const dependencies = new Set<string>();
  const entries = new Map<string, PreviewInspectorRouteCatalogPatternEvidence[]>();
  const patterns = new Map<string, string[]>();
  const visited = new Set<string>();
  let edges = 0;

  const addPatterns = (
    value: unknown,
    catalogSourcePath: string,
    collisionPolicy: PreviewInspectorRouteCatalogCollisionPolicy,
  ): void => {
    const visit = (node: unknown, segments: readonly string[]): void => {
      if (typeof node === 'string') {
        if (!options.expectedComponentNames.has(node)) return;
        const pattern = joinPreviewInspectorRouteSegments(segments);
        const values = collisionPolicy === 'last' ? [] : (patterns.get(node) ?? []);
        if (!values.includes(pattern)) values.push(pattern);
        patterns.set(node, values);
        const evidence =
          collisionPolicy === 'last' ? [] : (entries.get(node) ?? []);
        if (
          !evidence.some(
            (entry) =>
              entry.pattern === pattern &&
              path.normalize(entry.catalogSourcePath) === path.normalize(catalogSourcePath),
          )
        ) {
          evidence.push(
            Object.freeze({
              catalogSourcePath: path.normalize(catalogSourcePath),
              pattern,
            }),
          );
        }
        entries.set(node, evidence);
        return;
      }
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
      for (const [key, child] of Object.entries(node)) {
        visit(child, key === 'index' || key.length === 0 ? segments : [...segments, key]);
      }
    };
    visit(value, []);
  };

  const walk = async (
    sourcePath: string,
    requestedName?: string,
    requestedKind: 'export' | 'local' = 'local',
    collisionPolicy: PreviewInspectorRouteCatalogCollisionPolicy = 'all',
  ): Promise<void> => {
    if (visited.size >= maximumModules || edges >= 96) return;
    const normalizedPath = path.normalize(sourcePath);
    const key = `${normalizedPath}\0${requestedKind}\0${requestedName ?? '*'}\0${collisionPolicy}`;
    if (visited.has(key)) return;
    visited.add(key);
    dependencies.add(normalizedPath);
    const sourceText = await options.readSource(normalizedPath);
    if (sourceText === undefined) return;
    if (normalizedPath.toLowerCase().endsWith('.json')) {
      try {
        addPatterns(JSON.parse(sourceText), normalizedPath, collisionPolicy);
      } catch {
        // Invalid editor JSON remains unavailable until the next snapshot; no partial evaluation.
      }
      return;
    }
    const sourceFile = ts.createSourceFile(
      normalizedPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      normalizedPath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const imports = collectImports(sourceFile);
    const exportedBinding =
      requestedName === undefined || requestedKind === 'local'
        ? undefined
        : readExportedBinding(sourceFile, requestedName);
    if (requestedKind === 'export' && requestedName !== undefined && exportedBinding === undefined) {
      return;
    }
    if (exportedBinding?.reexport !== undefined) {
      if (options.resolveModule === undefined || edges >= 96) return;
      edges += 1;
      const resolved = options.resolveModule(
        exportedBinding.reexport.moduleSpecifier,
        normalizedPath,
      );
      if (resolved !== undefined)
        await walk(
          resolved,
          exportedBinding.reexport.exportName,
          'export',
          collisionPolicy,
        );
      return;
    }
    const requestedLocalName =
      requestedKind === 'export' ? exportedBinding?.localName : requestedName;
    const initializer =
      exportedBinding?.expression ??
      (requestedLocalName === undefined
        ? undefined
        : findLocalInitializer(sourceFile, requestedLocalName));
    const invertedCatalogName =
      initializer === undefined ? undefined : readLodashInvertInput(initializer, imports);
    if (invertedCatalogName !== undefined) {
      if (edges >= 96) return;
      edges += 1;
      await walk(normalizedPath, invertedCatalogName, 'local', 'last');
      return;
    }
    /* Same-file immutable data is always followed before imports.  Real route maps commonly use
       `const a = helper(raw); export const b = helper(a)`, where no imported symbol names `a`. */
    if (initializer !== undefined) {
      for (const identifier of collectIdentifiers(initializer)) {
        if (edges >= 96) break;
        const local = findLocalInitializer(sourceFile, identifier);
        if (local !== undefined && identifier !== requestedLocalName) {
          edges += 1;
          await walk(normalizedPath, identifier, 'local', collisionPolicy);
        }
      }
    }
    const requestedImports =
      requestedLocalName === undefined
        ? imports
        : imports.filter((binding) => binding.localName === requestedLocalName);
    for (const binding of requestedImports) {
      if (edges >= 96 || options.resolveModule === undefined) break;
      edges += 1;
      const resolved = options.resolveModule(binding.moduleSpecifier, normalizedPath);
      if (resolved !== undefined)
        await walk(resolved, binding.exportName, 'export', collisionPolicy);
    }
    if (initializer !== undefined) {
      for (const identifier of collectIdentifiers(initializer)) {
        if (edges >= 96) break;
        edges += 1;
        const binding = imports.find((candidate) => candidate.localName === identifier);
        if (binding === undefined || options.resolveModule === undefined) continue;
        const resolved = options.resolveModule(binding.moduleSpecifier, normalizedPath);
        if (resolved !== undefined)
          await walk(resolved, binding.exportName, 'export', collisionPolicy);
      }
    }
  };

  await walk(
    options.sourcePath,
    options.catalogBindingName,
    options.catalogBindingKind ?? 'local',
  );
  return Object.freeze({
    dependencyPaths: Object.freeze([...dependencies].sort()),
    entriesByComponentName: new Map(
      [...entries].map(([name, values]) => [name, Object.freeze(values)]),
    ),
    patternsByComponentName: new Map(
      [...patterns].map(([name, values]) => [name, Object.freeze(values)]),
    ),
  });
}

/** One import binding that can be followed without invoking a module. */
interface ImportBinding {
  readonly exportName: string;
  readonly localName: string;
  readonly moduleSpecifier: string;
}

/** Reads only the exact lodash `invert(catalog)` form whose duplicate values use last-write wins. */
function readLodashInvertInput(
  expression: ts.Expression,
  imports: readonly ImportBinding[],
): string | undefined {
  const value = unwrap(expression);
  if (!ts.isCallExpression(value) || value.arguments.length !== 1) return undefined;
  const input = value.arguments[0] === undefined ? undefined : unwrap(value.arguments[0]);
  if (input === undefined || !ts.isIdentifier(input)) return undefined;
  const callee = unwrap(value.expression);
  if (ts.isIdentifier(callee)) {
    const binding = imports.find((candidate) => candidate.localName === callee.text);
    return binding?.moduleSpecifier === 'lodash' && binding.exportName === 'invert'
      ? input.text
      : undefined;
  }
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'invert' ||
    !ts.isIdentifier(callee.expression)
  ) {
    return undefined;
  }
  const receiverName = callee.expression.text;
  const receiver = imports.find(
    (candidate) => candidate.localName === receiverName,
  );
  return receiver?.moduleSpecifier === 'lodash' && receiver.exportName === 'default'
    ? input.text
    : undefined;
}

/** Exact public export resolution; re-exports remain bounded import edges. */
interface ExportedBinding {
  readonly expression?: ts.Expression;
  readonly localName?: string;
  readonly reexport?: {
    readonly exportName: string;
    readonly moduleSpecifier: string;
  };
}

/** Maps one requested public export to its unique local value or exact re-export. */
function readExportedBinding(
  sourceFile: ts.SourceFile,
  exportName: string,
): ExportedBinding | undefined {
  const matches: ExportedBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement)) {
      const value = unwrap(statement.expression);
      matches.push(
        ts.isIdentifier(value) ? { localName: value.text } : { expression: statement.expression },
      );
      continue;
    }
    if (
      ts.isVariableStatement(statement) &&
      hasExportModifier(statement) &&
      exportName !== 'default'
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
          matches.push({ localName: declaration.name.text });
        }
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasExportModifier(statement) &&
      statement.name?.text === exportName
    ) {
      matches.push({ localName: exportName });
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamespaceExport(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== exportName) continue;
        const localOrExportName = (element.propertyName ?? element.name).text;
        if (statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)) {
          matches.push({
            reexport: {
              exportName: localOrExportName,
              moduleSpecifier: statement.moduleSpecifier.text,
            },
          });
        } else {
          matches.push({ localName: localOrExportName });
        }
      }
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Checks authored `export` without treating `default` as a separate value edge. */
function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) ?? false)
    : false;
}

/** Reads value imports only; type-only imports cannot establish a runtime catalog edge. */
function collectImports(sourceFile: ts.SourceFile): readonly ImportBinding[] {
  const result: ImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (clause.name !== undefined)
      result.push({ exportName: 'default', localName: clause.name.text, moduleSpecifier });
    const bindings = clause.namedBindings;
    if (bindings === undefined || ts.isNamespaceImport(bindings)) continue;
    for (const binding of bindings.elements) {
      if (!binding.isTypeOnly)
        result.push({
          exportName: (binding.propertyName ?? binding.name).text,
          localName: binding.name.text,
          moduleSpecifier,
        });
    }
  }
  return result;
}

/** Finds an immutable same-file value initializer for identifier-only dependency traversal. */
function findLocalInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  const matches: ts.Expression[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined
      )
        matches.push(declaration.initializer);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Collects identifier references while skipping nested declarations that would require scope analysis. */
function collectIdentifiers(expression: ts.Expression): readonly string[] {
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isFunctionLike(node) && node !== expression) return;
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return [...identifiers];
}

/** Removes inert TypeScript wrappers without evaluating the expression. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
