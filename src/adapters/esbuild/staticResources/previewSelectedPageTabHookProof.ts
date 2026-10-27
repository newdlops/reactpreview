/** Bounded request-owned source proof for hooks whose initial tab argument may be guided. */
import { Buffer } from 'node:buffer';
import ts from 'typescript';
import { hasPreviewInspectorQueryUiStateHookInSourceFile } from '../inspector/previewInspectorQueryUiStateHook';

/**
 * Proves exact resolved hook exports from dirty snapshots or bounded inert source reads.
 * At most 32 probes/512 KiB are retained for this build; ASTs are released after each decision.
 */
export function createPreviewSelectedPageTabHookProof(
  resolveModule: (specifier: string, importer: string) => string | undefined,
  readSource: (sourcePath: string, maximumBytes: number) => Promise<string | undefined>,
): (specifier: string, importer: string, exportName: string) => Promise<boolean> {
  const pending = new Map<string, Promise<boolean>>();
  let bytes = 0;
  return (specifier, importer, exportName) => {
    const sourcePath = resolveModule(specifier, importer);
    if (sourcePath === undefined) return Promise.resolve(false);
    const key = sourcePath + '\0' + exportName;
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    if (pending.size >= 32 || bytes >= 512 * 1024) return Promise.resolve(false);
    const proof = readSource(sourcePath, 32 * 1024).then((source) => {
      if (source === undefined) return false;
      const size = Buffer.byteLength(source, 'utf8');
      if (size > 32 * 1024 || bytes + size > 512 * 1024) return false;
      bytes += size;
      return hasPreviewInspectorQueryUiStateHookInSourceFile(
        ts.createSourceFile(
          sourcePath,
          source,
          ts.ScriptTarget.Latest,
          true,
          /\.[cm]?ts$/iu.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
        ),
        [exportName],
      );
    });
    pending.set(key, proof);
    return proof;
  };
}

/** Checks at most eight imported hook spellings, only in a selected module containing tab JSX. */
export async function readPreviewSelectedPageTabHookNames(
  sourcePath: string,
  sourceText: string,
  admit:
    ((specifier: string, importer: string, exportName: string) => Promise<boolean>) | undefined,
): Promise<ReadonlySet<string> | undefined> {
  if (admit === undefined || !/<Tab\b/u.test(sourceText)) return undefined;
  const source = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = new Set<string>();
  let probes = 0;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (
      clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
      clause?.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings)
    )
      continue;
    for (const binding of clause.namedBindings.elements) {
      if (binding.isTypeOnly || !/^use[A-Z]/u.test(binding.name.text) || probes >= 8) continue;
      probes += 1;
      if (
        await admit(
          statement.moduleSpecifier.text,
          sourcePath,
          (binding.propertyName ?? binding.name).text,
        )
      )
        names.add(binding.name.text);
    }
  }
  return names.size === 0 ? undefined : names;
}
