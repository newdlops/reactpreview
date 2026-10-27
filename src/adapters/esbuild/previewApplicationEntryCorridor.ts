/**
 * Proves a bounded runtime-import corridor from an inert application entry to a selected page.
 * Only sources on the successful path become style owners; unrelated branches and installed
 * packages are never promoted. The per-lookup source cache also avoids reparsing shared entries.
 */
import path from 'node:path';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { readPreviewAnalysisSourceFile } from './previewAnalysisSourceFile';
import type { ReadPreviewProjectSourceOptions } from './previewProjectFileAnalysisCache';

const MAX_CORRIDOR_MODULES = 32;
const MAX_CORRIDOR_DEPTH = 4;
const MAX_CORRIDOR_SOURCE_BYTES = 1024 * 1024;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const DECLARATION_PATTERN = /\.d\.[cm]?[jt]sx?$/iu;

/** Exact runtime binding imported by the preceding application owner. */
export interface PreviewApplicationStyleOwner {
  /** Absolute authored source whose initialization belongs to the selected application. */
  readonly sourcePath: string;
  /** Public runtime binding; namespace imports cannot seed component-style discovery. */
  readonly exportName: string;
}

/** Immutable syntax facts retained only for this one entry lookup. */
interface ModuleFacts {
  readonly imports: readonly { readonly moduleSpecifier: string; readonly exportName: string }[];
}

/** Inputs shared by all conventional entry candidates in one style lookup. */
export interface PreviewApplicationEntryCorridorOptions {
  /** Canonical application boundary; package and outside-project traversal is rejected. */
  readonly projectRoot: string;
  /** Current, byte-bounded source reader with unsaved snapshot precedence. */
  readonly readSource: (options: ReadPreviewProjectSourceOptions) => Promise<string | undefined>;
  /** Static project-aware module resolution, without evaluating configuration. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Existing page-corridor modules that an application entry must reach. */
  readonly rootSourcePaths: readonly string[];
}

/** Creates a bounded, current-source proof function without executing any entry or configuration. */
export function createPreviewApplicationEntryCorridor(
  options: PreviewApplicationEntryCorridorOptions,
): (
  sourcePath: string,
  sourceText: string,
) => Promise<readonly PreviewApplicationStyleOwner[] | undefined> {
  const roots = new Set(options.rootSourcePaths.map(canonicalizeExistingPath));
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const factsByPath = new Map<string, Promise<ModuleFacts | undefined>>();
  let sourceBytes = 0;

  /** Reads and parses each physical module at most once under the shared style-proof budget. */
  const readFacts = (
    sourcePath: string,
    suppliedText?: string,
  ): Promise<ModuleFacts | undefined> => {
    const existing = factsByPath.get(sourcePath);
    if (existing !== undefined) return existing;
    if (factsByPath.size >= MAX_CORRIDOR_MODULES) return Promise.resolve(undefined);
    const pending = (async () => {
      const remaining = MAX_CORRIDOR_SOURCE_BYTES - sourceBytes;
      if (remaining <= 0) return undefined;
      const sourceText =
        suppliedText ?? (await options.readSource({ sourcePath, maximumBytes: remaining }));
      if (sourceText === undefined) return undefined;
      const bytes = Buffer.byteLength(sourceText, 'utf8');
      if (bytes > MAX_CORRIDOR_SOURCE_BYTES - sourceBytes) return undefined;
      sourceBytes += bytes;
      const extension = path.extname(sourcePath).toLowerCase();
      const scriptKind =
        extension === '.tsx'
          ? ts.ScriptKind.TSX
          : extension === '.jsx'
            ? ts.ScriptKind.JSX
            : ['.js', '.cjs', '.mjs'].includes(extension)
              ? ts.ScriptKind.JS
              : ts.ScriptKind.TS;
      const sourceFile = readPreviewAnalysisSourceFile(sourcePath, sourceText, scriptKind);
      if (
        (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
          .parseDiagnostics?.length
      )
        return undefined;
      return { imports: collectRuntimeImports(sourceFile) };
    })();
    factsByPath.set(sourcePath, pending);
    return pending;
  };

  return async (entryPath, entryText) => {
    const visitedDepth = new Map<string, number>();
    /** Finds one exact import path; affinity changes search order, never admission or proof. */
    const visit = async (
      sourcePath: string,
      depth: number,
      exportName: string,
      suppliedText?: string,
    ): Promise<readonly PreviewApplicationStyleOwner[] | undefined> => {
      const relative = path.relative(projectRoot, sourcePath);
      if (
        depth > MAX_CORRIDOR_DEPTH ||
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative) ||
        relative.split(path.sep).includes('node_modules')
      )
        return undefined;
      if (roots.has(sourcePath)) return [];
      if ((visitedDepth.get(sourcePath) ?? Infinity) <= depth) return undefined;
      visitedDepth.set(sourcePath, depth);
      const facts = await readFacts(sourcePath, suppliedText);
      if (facts === undefined) return undefined;
      const children = facts.imports
        .flatMap((binding) => {
          const resolved = options.resolveModule(binding.moduleSpecifier, sourcePath);
          if (resolved === undefined) return [];
          const childPath = canonicalizeExistingPath(resolved);
          const relative = path.relative(projectRoot, childPath);
          if (
            !SOURCE_PATTERN.test(childPath) ||
            DECLARATION_PATTERN.test(childPath) ||
            relative.startsWith('..' + path.sep) ||
            relative === '..' ||
            path.isAbsolute(relative) ||
            relative.split(path.sep).includes('node_modules')
          )
            return [];
          return [{ ...binding, sourcePath: childPath }];
        })
        .sort(
          (left, right) => affinity(right.sourcePath, roots) - affinity(left.sourcePath, roots),
        );
      for (const child of children) {
        const tail = await visit(child.sourcePath, depth + 1, child.exportName);
        if (tail !== undefined) return Object.freeze([{ sourcePath, exportName }, ...tail]);
      }
      return undefined;
    };
    return visit(canonicalizeExistingPath(entryPath), 0, 'default', entryText);
  };
}

/** Collects literal runtime ESM edges while ignoring erased imports and nonliteral code. */
function collectRuntimeImports(sourceFile: ts.SourceFile): ModuleFacts['imports'] {
  const imports: { moduleSpecifier: string; exportName: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause === undefined) {
        imports.push({ moduleSpecifier: node.moduleSpecifier.text, exportName: '*' });
        return;
      }
      if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return;
      if (clause.name !== undefined)
        imports.push({ moduleSpecifier: node.moduleSpecifier.text, exportName: 'default' });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        imports.push({ moduleSpecifier: node.moduleSpecifier.text, exportName: '*' });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements)
          if (!element.isTypeOnly)
            imports.push({
              moduleSpecifier: node.moduleSpecifier.text,
              exportName: element.propertyName?.text ?? element.name.text,
            });
      }
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements)
          if (!element.isTypeOnly)
            imports.push({
              moduleSpecifier: node.moduleSpecifier.text,
              exportName: element.propertyName?.text ?? element.name.text,
            });
      } else imports.push({ moduleSpecifier: node.moduleSpecifier.text, exportName: '*' });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        imports.push({ moduleSpecifier: argument.text, exportName: 'default' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

/** Prefers imports sharing a deeper directory with the already-proven page corridor. */
function affinity(sourcePath: string, roots: ReadonlySet<string>): number {
  const parts = path.dirname(sourcePath).split(path.sep);
  let best = 0;
  for (const root of roots) {
    const rootParts = path.dirname(root).split(path.sep);
    let common = 0;
    while (
      common < parts.length &&
      common < rootParts.length &&
      parts[common] === rootParts[common]
    )
      common++;
    best = Math.max(best, common);
  }
  return best;
}
