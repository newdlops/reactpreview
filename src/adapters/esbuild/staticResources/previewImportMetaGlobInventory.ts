/** Collects the exact authored modules materialized by bounded Vite glob transforms. */
import { parseStaticStringList, StaticSourceAnalysis } from './staticCallParser';
import { expandStaticPatterns, type StaticScanBudget } from './staticPattern';

/** Mirrors the transformer's hard per-build reference ceiling for one immutable frontier. */
export const PREVIEW_IMPORT_META_GLOB_MAX_MATCH_REFERENCES = 1024;

/** One explicit module import that the source transformer will generate from a glob call. */
export interface PreviewImportMetaGlobReference {
  readonly moduleSpecifier: string;
  readonly occurrenceStart: number;
}

export interface CollectPreviewImportMetaGlobInventoryOptions {
  readonly aggregateScanBudget?: StaticScanBudget;
  readonly projectRoot: string;
  readonly sourcePath: string;
  readonly sourceText: string;
  readonly workspaceRoot: string;
}

/**
 * Expands only literal `import.meta.glob` and `globEager` calls through the same bounded scanner as
 * the runtime transform. The result belongs to the authored frontier because esbuild will receive
 * these exact imports even though they are absent from the untransformed TypeScript syntax tree.
 */
export async function collectPreviewImportMetaGlobInventory(
  options: CollectPreviewImportMetaGlobInventoryOptions,
): Promise<readonly PreviewImportMetaGlobReference[]> {
  if (!options.sourceText.includes('import.meta.glob')) return Object.freeze([]);
  const analysis = new StaticSourceAnalysis(options.sourcePath, options.sourceText);
  const references: PreviewImportMetaGlobReference[] = [];
  for (const name of ['import.meta.globEager', 'import.meta.glob'] as const) {
    for (const call of analysis.findCalls(name)) {
      const patterns = parseStaticStringList(call.arguments[0] ?? '');
      // The source transformer owns the actionable invalid-pattern diagnostic.
      if (patterns === undefined) continue;
      const expansion = await expandStaticPatterns({
        ...(options.aggregateScanBudget === undefined
          ? {}
          : { aggregateScanBudget: options.aggregateScanBudget }),
        importerPath: options.sourcePath,
        maxMatches: PREVIEW_IMPORT_META_GLOB_MAX_MATCH_REFERENCES,
        patterns,
        rootRelativeBaseDirectory: options.projectRoot,
        workspaceRoot: options.workspaceRoot,
      });
      for (const match of expansion.matches) {
        references.push(
          Object.freeze({
            moduleSpecifier: match.specifier,
            occurrenceStart: call.start,
          }),
        );
      }
    }
  }
  const identities = new Set<string>();
  return Object.freeze(
    references
      .sort(
        (left, right) =>
          left.occurrenceStart - right.occurrenceStart ||
          left.moduleSpecifier.localeCompare(right.moduleSpecifier),
      )
      .filter((reference) => {
        const identity = `${reference.occurrenceStart.toString()}\0${reference.moduleSpecifier}`;
        if (identities.has(identity)) return false;
        identities.add(identity);
        return true;
      }),
  );
}
