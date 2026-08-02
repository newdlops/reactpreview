/**
 * Creates the compiler-owned prepared-source contract consumed by the selected-target facade.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PreviewCompilationError } from '../../../domain/preview';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { collectPreviewTargetModuleExportEvidence } from '../previewTargetExports';

/** Stable policy identity for prepared export proof through committed exact Fiber ownership. */
export const PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_VERSION = 1;
export const PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      boundaryIdentity: 'normalized-source-path-and-export',
      compilerEvidence: 'prepared-source-explicit-runtime-exports',
      facadeBindings: 'static-private-original-edge',
      mountedOwnership: 'live-committed-boundary-fiber-only',
      policyVersion: PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_VERSION,
      preFiberPhasesAreDiagnosticOnly: true,
    }),
  )
  .digest('hex');

/** Exact source and export evidence shared by compiler, PageExecution, and facade generation. */
export interface PreviewInspectorTargetModuleContract {
  /** Every syntax-proven runtime export in the prepared target source. */
  readonly explicitExportNames: readonly string[];
  /** Whether the prepared target source explicitly provides a default binding. */
  readonly hasDefaultExport: boolean;
  /** Whether unresolved bare wildcard re-exports remain present. */
  readonly hasWildcardExport: boolean;
  /** Non-secret identity of the exact prepared source used to derive this contract. */
  readonly preparedSourceDigest: string;
  /** Exact selected facade bindings, each proven in `explicitExportNames`. */
  readonly selectedExportNames: readonly string[];
  /** Canonical absolute runtime ownership source path. */
  readonly sourcePath: string;
}

export interface CreatePreviewInspectorTargetModuleContractOptions {
  readonly preparedSourceText: string;
  readonly selectedExportNames: readonly string[];
  readonly sourcePath: string;
}

/**
 * Proves all selected bindings from the prepared module itself and fails closed on ambiguity.
 *
 * A bare `export *` is deliberately not enough to prove a selected binding because that would
 * require resolving a second module graph outside this contract. Explicit aliased re-exports are
 * proven by their public names and remain supported.
 */
export function createPreviewInspectorTargetModuleContract(
  options: CreatePreviewInspectorTargetModuleContractOptions,
): PreviewInspectorTargetModuleContract {
  if (!path.isAbsolute(options.sourcePath)) {
    throw new RangeError('Preview inspector target path must be absolute.');
  }
  const sourcePath = canonicalizeExistingPath(path.normalize(options.sourcePath));
  const selectedExportNames = Object.freeze([...new Set(options.selectedExportNames)]);
  if (selectedExportNames.length === 0) {
    throw new TypeError('Preview inspector requires at least one selected target export.');
  }
  const evidence = collectPreviewTargetModuleExportEvidence(sourcePath, options.preparedSourceText);
  const explicitExports = new Set(evidence.explicitExportNames);
  const missingExport = selectedExportNames.find((exportName) => !explicitExports.has(exportName));
  if (missingExport !== undefined) {
    throw new PreviewCompilationError(
      `React Preview could not prove the selected export "${missingExport}" in the prepared target module.`,
      [
        {
          location: { column: 0, file: sourcePath, line: 1 },
          message: `The exact prepared target module does not explicitly export "${missingExport}".`,
          severity: 'error',
        },
      ],
    );
  }
  return Object.freeze({
    explicitExportNames: evidence.explicitExportNames,
    hasDefaultExport: explicitExports.has('default'),
    hasWildcardExport: evidence.hasWildcardExport,
    preparedSourceDigest: createHash('sha256').update(options.preparedSourceText).digest('hex'),
    selectedExportNames,
    sourcePath,
  });
}
