/** Coordinates bounded authored-source analysis for previewRuntimeHookInstrumentation. */
import ts from 'typescript';
import {
  type ResolvePreviewRuntimeHookImportedHelperItemFallback,
  type ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
} from './previewRuntimeHookAliasUsage';
import {
  type PreviewRuntimeHookChildPropDemandCatalog,
  type PreviewRuntimeHookChildPropDemandSource,
  type PreviewRuntimeHookLocalTypeFallback,
} from './previewRuntimeHookChildPropDemand';
import {
  collectRuntimeHookCandidates,
  collectRuntimeHookInventory,
} from './previewRuntimeHookInventory';
import {
  childPropDemandsBySourceFile,
  importedCollectionCallbackItemFallbackBySourceFile,
  importedHelperItemFallbackBySourceFile,
  importedHelperPropertyFallbackBySourceFile,
  localTypeFallbackBySourceFile,
  MAX_HOOKS_PER_MODULE,
} from './previewRuntimeHookModel';
import {
  createRuntimeHookReplacement,
  selectNonOverlappingHookReplacements,
} from './previewRuntimeHookReplacement';
import {
  hasPreviewRuntimeParseDiagnostics as hasParseDiagnostics,
  isPreviewRuntimeJavaScriptLikeSource as isJavaScriptLikeSource,
  selectPreviewRuntimeScriptKind as selectScriptKind,
} from './previewRuntimeHookSyntax';
import { type PreviewRuntimeHookTypedCallResolver } from './previewRuntimeHookTypedFallback';
import { hasPreviewRuntimeStorageReadText } from './previewRuntimeStorageRead';
import { registerPreviewSelectedTargetNames } from './previewSelectedTargetExit';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import type { StaticSourceAnalysis } from './staticCallParser';

/**
 * Creates Page Inspector replacements for render-critical project and query-parameter hooks.
 *
 * Replacements call the Inspector API through a global Symbol installed before project modules are
 * evaluated. Normal non-nullish values retain exact identity. A caught non-thenable exception or
 * required nullish value is replaced only while the user-controlled Auto values boundary is on.
 *
 * @param sourcePath Absolute workspace source identity retained in local Inspector diagnostics.
 * @param sourceText Original module source used for parser offsets and generated expressions.
 * @param sourceAnalysis Private transformer analysis for these exact bytes; never a type-checker tree.
 * @returns Non-overlapping source replacements ordered by their original offsets.
 */
export function createPreviewRuntimeHookReplacements(
  sourcePath: string,
  sourceText: string,
  childPropDemands?: PreviewRuntimeHookChildPropDemandSource,
  localTypeFallback?: (typeNode: ts.TypeNode) => PreviewRuntimeHookLocalTypeFallback | undefined,
  importedHelperItemFallback?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  importedHelperPropertyFallback?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
  importedCollectionCallbackItemFallback?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  resolveTypedCall?: PreviewRuntimeHookTypedCallResolver,
  selectedTargetNames?: ReadonlySet<string>,
  sourceAnalysis?: StaticSourceAnalysis,
): readonly PreviewSourceReplacement[] {
  const readsStorage = hasPreviewRuntimeStorageReadText(sourceText);
  if (!isJavaScriptLikeSource(sourcePath) || (!sourceText.includes('use') && !readsStorage)) {
    return [];
  }
  const prepared = sourceAnalysis?.getSourceFile();
  const sourceFile =
    prepared?.fileName === sourcePath && prepared.text === sourceText
      ? prepared
      : ts.createSourceFile(
          sourcePath,
          sourceText,
          ts.ScriptTarget.Latest,
          true,
          selectScriptKind(sourcePath),
        );
  if (hasParseDiagnostics(sourceFile)) {
    return [];
  }
  registerPreviewSelectedTargetNames(sourceFile, selectedTargetNames);
  if (childPropDemands !== undefined) {
    let catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined;
    childPropDemandsBySourceFile.set(
      sourceFile,
      typeof childPropDemands === 'function'
        ? () => (catalog ??= childPropDemands())
        : childPropDemands,
    );
  }
  if (localTypeFallback !== undefined) {
    localTypeFallbackBySourceFile.set(sourceFile, localTypeFallback);
  }
  if (importedHelperItemFallback !== undefined) {
    importedHelperItemFallbackBySourceFile.set(sourceFile, importedHelperItemFallback);
  }
  if (importedHelperPropertyFallback !== undefined) {
    importedHelperPropertyFallbackBySourceFile.set(sourceFile, importedHelperPropertyFallback);
  }
  if (importedCollectionCallbackItemFallback !== undefined) {
    importedCollectionCallbackItemFallbackBySourceFile.set(
      sourceFile,
      importedCollectionCallbackItemFallback,
    );
  }
  const inventory = collectRuntimeHookInventory(sourceFile);
  if (inventory.direct.size === 0 && inventory.namespaces.size === 0 && !readsStorage) {
    return [];
  }
  // prettier-ignore
  const candidates = collectRuntimeHookCandidates(sourceFile, sourceText, inventory, resolveTypedCall).slice(
    0,
    MAX_HOOKS_PER_MODULE,
  );
  return selectNonOverlappingHookReplacements(
    candidates.map((candidate, occurrence) =>
      createRuntimeHookReplacement(sourceFile, sourcePath, sourceText, candidate, occurrence),
    ),
  );
}

export { collectPreviewRuntimeHookProjectionEvidence } from './previewRuntimeHookProjectionEvidence';
export type { PreviewRuntimeHookProjectionEvidence } from './previewRuntimeHookModel';
export { inferPreviewRuntimeArrayItemFallback } from './previewRuntimeHookUsageFallback';
