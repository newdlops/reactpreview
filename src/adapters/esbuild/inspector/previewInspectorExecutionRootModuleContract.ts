/**
 * Freezes the compiler-owned execution-root binding independently from the selected-target facade.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PreviewCompilationError } from '../../../domain/preview';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { collectPreviewTargetModuleExportEvidence } from '../previewTargetExports';

/** Stable identity for absence-safe health transport and exact execution-root imports. */
export const PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_VERSION = 2;
export const PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      arrayUndefined: 'json-null-position',
      defaultBindingFallback: 'selected-route-surface-only-when-explicitly-proven',
      executionRootBinding: 'compiler-proven-static-exact-import',
      executionRootTargetRoles: 'independent-source-export-surface-contracts',
      objectUndefined: 'omit-member',
      optionalErrors: 'present-normalized-string-only',
      policyVersion: PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_VERSION,
      preserveExplicitNull: true,
    }),
  )
  .digest('hex');

/** Exact prepared-source evidence for the module binding that owns PageExecution. */
export interface PreviewInspectorExecutionRootModuleContract {
  /** Exact prepared-module export imported by generated PageExecution source. */
  readonly bindingExportName: string;
  readonly explicitExportNames: readonly string[];
  /** Planner-owned surface export identity retained for route-plan equality. */
  readonly exportName: string;
  readonly hasWildcardExport: boolean;
  readonly preparedSourceDigest: string;
  readonly sourcePath: string;
  readonly surfaceId: string;
}

export interface CreatePreviewInspectorExecutionRootModuleContractOptions {
  /** Allows an uncertain route-local JSX name to resolve to a proven default module binding. */
  readonly allowDefaultExportFallback?: boolean;
  readonly exportName: string;
  readonly preparedSourceText: string;
  readonly sourcePath: string;
  readonly surfaceId: string;
}

/** Proves the exact root binding from the prepared module and rejects unresolved guesses. */
export function createPreviewInspectorExecutionRootModuleContract(
  options: CreatePreviewInspectorExecutionRootModuleContractOptions,
): PreviewInspectorExecutionRootModuleContract {
  if (!path.isAbsolute(options.sourcePath)) {
    throw new RangeError('Preview inspector execution-root path must be absolute.');
  }
  if (options.surfaceId.length === 0) {
    throw new TypeError('Preview inspector execution-root surface id cannot be empty.');
  }
  const sourcePath = canonicalizeExistingPath(path.normalize(options.sourcePath));
  const evidence = collectPreviewTargetModuleExportEvidence(sourcePath, options.preparedSourceText);
  const bindingExportName = evidence.explicitExportNames.includes(options.exportName)
    ? options.exportName
    : options.allowDefaultExportFallback === true &&
        evidence.explicitExportNames.includes('default')
      ? 'default'
      : undefined;
  if (bindingExportName === undefined) {
    throw new PreviewCompilationError(
      `React Preview could not prove the execution-root export "${options.exportName}".`,
      [
        {
          location: { column: 0, file: sourcePath, line: 1 },
          message: `The exact prepared execution-root module does not explicitly export "${options.exportName}".`,
          severity: 'error',
        },
      ],
    );
  }
  return Object.freeze({
    bindingExportName,
    explicitExportNames: evidence.explicitExportNames,
    exportName: options.exportName,
    hasWildcardExport: evidence.hasWildcardExport,
    preparedSourceDigest: createHash('sha256').update(options.preparedSourceText).digest('hex'),
    sourcePath,
    surfaceId: options.surfaceId,
  });
}
