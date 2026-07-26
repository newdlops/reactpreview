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

/** Collects expected page-name leaves from JSON reachable through a factory catalog binding. */
export async function collectPreviewInspectorRouteFactoryCatalog(options: {
  readonly catalogBindingName: string;
  readonly expectedComponentNames: ReadonlySet<string>;
  readonly maximumModules?: number;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
}): Promise<{
  readonly dependencyPaths: readonly string[];
  readonly patternsByComponentName: ReadonlyMap<string, readonly string[]>;
}> {
  const maximumModules = options.maximumModules ?? 12;
  const dependencies = new Set<string>();
  const patterns = new Map<string, string[]>();
  const visited = new Set<string>();
  let edges = 0;

  const addPatterns = (value: unknown): void => {
    const visit = (node: unknown, segments: readonly string[]): void => {
      if (typeof node === 'string') {
        if (!options.expectedComponentNames.has(node)) return;
        const values = patterns.get(node) ?? [];
        const pattern = joinPreviewInspectorRouteSegments(segments);
        if (!values.includes(pattern)) values.push(pattern);
        patterns.set(node, values);
        return;
      }
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
      for (const [key, child] of Object.entries(node)) {
        visit(child, key === 'index' || key.length === 0 ? segments : [...segments, key]);
      }
    };
    visit(value, []);
  };

  const walk = async (sourcePath: string, requestedName?: string): Promise<void> => {
    if (visited.size >= maximumModules || edges >= 96) return;
    const normalizedPath = path.normalize(sourcePath);
    const key = `${normalizedPath}\0${requestedName ?? '*'}`;
    if (visited.has(key)) return;
    visited.add(key);
    dependencies.add(normalizedPath);
    const sourceText = await options.readSource(normalizedPath);
    if (sourceText === undefined) return;
    if (normalizedPath.toLowerCase().endsWith('.json')) {
      try {
        addPatterns(JSON.parse(sourceText));
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
    const initializer =
      requestedName === undefined ? undefined : findLocalInitializer(sourceFile, requestedName);
    /* Same-file immutable data is always followed before imports.  Real route maps commonly use
       `const a = helper(raw); export const b = helper(a)`, where no imported symbol names `a`. */
    if (initializer !== undefined) {
      for (const identifier of collectIdentifiers(initializer)) {
        if (edges >= 96) break;
        const local = findLocalInitializer(sourceFile, identifier);
        if (local !== undefined && identifier !== requestedName) {
          edges += 1;
          await walk(normalizedPath, identifier);
        }
      }
    }
    const requestedImports =
      requestedName === undefined
        ? imports
        : imports.filter(
            (binding) =>
              binding.localName === requestedName || binding.exportName === requestedName,
          );
    for (const binding of requestedImports) {
      if (edges >= 96 || options.resolveModule === undefined) break;
      edges += 1;
      const resolved = options.resolveModule(binding.moduleSpecifier, normalizedPath);
      if (resolved !== undefined) await walk(resolved, binding.exportName);
    }
    if (initializer !== undefined) {
      for (const identifier of collectIdentifiers(initializer)) {
        if (edges >= 96) break;
        edges += 1;
        const binding = imports.find((candidate) => candidate.localName === identifier);
        if (binding === undefined || options.resolveModule === undefined) continue;
        const resolved = options.resolveModule(binding.moduleSpecifier, normalizedPath);
        if (resolved !== undefined) await walk(resolved, binding.exportName);
      }
    }
  };

  await walk(options.sourcePath, options.catalogBindingName);
  return Object.freeze({
    dependencyPaths: Object.freeze([...dependencies]),
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
