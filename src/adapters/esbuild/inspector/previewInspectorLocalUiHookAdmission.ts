/** Bounds source-only local UI-controller proof before the bundle frontier is frozen. */
import { Buffer } from 'node:buffer';
import ts from 'typescript';
import { hasPreviewInspectorLocalUiStateHookInSourceFile } from './previewInspectorLocalUiStateHook';
import { hasPreviewInspectorQueryUiStateHookInSourceFile } from './previewInspectorQueryUiStateHook';
import { hasPreviewInspectorThemeUiHookInSourceFile } from './previewInspectorThemeUiHook';
import type { PreviewInspectorBundleResolvedStaticEdge } from './previewInspectorBundleSourceInventoryMemo';

/**
 * Creates request-owned evidence; admitted hooks still consume the ordinary source/module budget.
 * At most 64 source probes admit 1 MiB of proof text; the caller also bounds raw source reads.
 * No source or package is evaluated.
 */
export function createPreviewInspectorLocalUiHookAdmission(
  readSource: (sourcePath: string) => Promise<string | undefined>,
): (edge: PreviewInspectorBundleResolvedStaticEdge) => Promise<boolean> {
  const pending = new Map<string, Promise<boolean>>();
  let textBytes = 0;
  return (edge) => {
    const projection = edge.projection;
    const names = projection?.runtimeHookExportNames;
    if (
      edge.targetPath === undefined ||
      names === undefined ||
      names.length === 0 ||
      names.length !== projection?.exportNames.length
    )
      return Promise.resolve(false);
    const sourcePath = edge.targetPath;
    const key = sourcePath + '\0' + [...names].sort().join('\0');
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    if (pending.size >= 64 || textBytes >= 1024 * 1024) return Promise.resolve(false);
    const proof = readSource(sourcePath).then((source) => {
      if (source === undefined) return false;
      const bytes = Buffer.byteLength(source, 'utf8');
      if (bytes > 32 * 1024 || textBytes + bytes > 1024 * 1024) return false;
      textBytes += bytes;
      const sourceFile = ts.createSourceFile(
        sourcePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        /\.[cm]?ts$/iu.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
      );
      const diagnostics = (
        sourceFile as ts.SourceFile & {
          readonly parseDiagnostics?: readonly ts.Diagnostic[];
        }
      ).parseDiagnostics;
      if ((diagnostics?.length ?? 0) > 0) return false;
      return (
        hasPreviewInspectorLocalUiStateHookInSourceFile(sourceFile, names) ||
        hasPreviewInspectorQueryUiStateHookInSourceFile(sourceFile, names) ||
        hasPreviewInspectorThemeUiHookInSourceFile(sourceFile, names)
      );
    });
    pending.set(key, proof);
    return proof;
  };
}
