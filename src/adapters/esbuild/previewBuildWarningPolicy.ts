/**
 * Filters compiler advisories only when disk evidence proves they cannot affect preview semantics.
 * Authored warnings remain visible; this boundary handles legacy pragmas left in already-emitted
 * dependency JavaScript without globally weakening esbuild's JSX diagnostics.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Message } from 'esbuild';
import ts from 'typescript';

const MAX_WARNING_EVIDENCE_BYTES = 2 * 1024 * 1024;
const UNSUPPORTED_JSX_COMMENT_ID = 'unsupported-jsx-comment';
const JAVASCRIPT_EXTENSION_PATTERN = /\.[cm]?js$/iu;

/**
 * Removes only unsupported JSX pragma warnings from transpiled dependency JavaScript.
 *
 * A `node_modules` path alone is insufficient because some packages publish raw JSX. The source is
 * therefore parsed as JSX and the advisory is suppressed only when no JSX syntax remains. Missing,
 * oversized, or unparseable evidence fails closed and preserves the original warning.
 *
 * @param warnings Successful esbuild result warnings for one preview revision.
 * @param workingDirectory Absolute directory used by esbuild for relative diagnostic paths.
 * @returns Warnings that still need to be shown to the user.
 */
export async function selectReportablePreviewBuildWarnings(
  warnings: readonly Message[],
  workingDirectory: string,
): Promise<Message[]> {
  const transpiledEvidenceByPath = new Map<string, Promise<boolean>>();
  const decisions = await Promise.all(
    warnings.map(async (warning) => {
      if (!isUnsupportedDependencyJsxCommentWarning(warning, workingDirectory)) {
        return warning;
      }
      const sourcePath = resolveWarningSourcePath(warning, workingDirectory);
      if (sourcePath === undefined) return warning;
      let evidence = transpiledEvidenceByPath.get(sourcePath);
      if (evidence === undefined) {
        evidence = hasNoRemainingJsxSyntax(sourcePath);
        transpiledEvidenceByPath.set(sourcePath, evidence);
      }
      return (await evidence) ? undefined : warning;
    }),
  );
  return decisions.filter((warning): warning is Message => warning !== undefined);
}

/** Checks the narrow diagnostic and dependency-file boundary before reading source evidence. */
function isUnsupportedDependencyJsxCommentWarning(
  warning: Message,
  workingDirectory: string,
): boolean {
  if (warning.id !== UNSUPPORTED_JSX_COMMENT_ID) return false;
  const sourcePath = resolveWarningSourcePath(warning, workingDirectory);
  if (sourcePath === undefined || !JAVASCRIPT_EXTENSION_PATTERN.test(sourcePath)) return false;
  const nodeModulesSegment = `${path.sep}node_modules${path.sep}`;
  return path.normalize(sourcePath).includes(nodeModulesSegment);
}

/** Resolves an esbuild diagnostic path without accepting a location-free warning as evidence. */
function resolveWarningSourcePath(warning: Message, workingDirectory: string): string | undefined {
  const diagnosticPath = warning.location?.file;
  if (diagnosticPath === undefined || diagnosticPath.length === 0) return undefined;
  return path.normalize(
    path.isAbsolute(diagnosticPath)
      ? diagnosticPath
      : path.resolve(workingDirectory, diagnosticPath),
  );
}

/**
 * Proves a bounded JavaScript file has no JSX nodes, making its stale factory pragma inert.
 * Parse uncertainty deliberately returns `false` so a potentially meaningful warning survives.
 */
async function hasNoRemainingJsxSyntax(sourcePath: string): Promise<boolean> {
  try {
    const metadata = await stat(sourcePath);
    if (!metadata.isFile() || metadata.size > MAX_WARNING_EVIDENCE_BYTES) return false;
    const source = await readFile(sourcePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      sourcePath,
      source,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JSX,
    );
    const parseDiagnostics = (
      sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
    ).parseDiagnostics;
    if ((parseDiagnostics?.length ?? 0) > 0) return false;

    let containsJsx = false;
    const visit = (node: ts.Node): void => {
      if (containsJsx) return;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        containsJsx = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return !containsJsx;
  } catch {
    return false;
  }
}
