/**
 * Converts the bounded implicit-global source inventory into generic bridge hints.
 * Keeping this adapter beside the bridge avoids coupling the evidence parser to esbuild while still
 * preserving canonical workspace module identity, export shape, and consumer resolution context.
 */
import path from 'node:path';
import type { PreviewImplicitGlobalEvidenceInventory } from '../previewImplicitGlobalEvidence';
import type { PreviewGlobalPackageBridgeHint } from './previewGlobalPackageBridge';

/** Discovery fields derived from selected and negative strong-evidence inventory. */
export interface PreviewGlobalPackageBridgeEvidencePolicy {
  /** Ambiguous/unresolved names forbidden from changing meaning through bare-package fallback. */
  readonly blockedGlobalNames: readonly string[];
  /** Prevents fallback when the evidence scan could have missed a stronger runtime assignment. */
  readonly disableDependencyFallback: boolean;
  /** Source and resolved module files required for cache/HMR invalidation. */
  readonly evidenceDependencyPaths: readonly string[];
  /** Selected exact module mappings that outrank dependency-name compatibility. */
  readonly hints: readonly PreviewGlobalPackageBridgeHint[];
}

/**
 * Maps selected runtime-assignment or ambient-declaration evidence into bridge discovery hints.
 *
 * The canonical resolved path is imported directly. This avoids resolving an alias from the
 * virtual inject namespace while still retaining the original source directory for diagnostics and
 * any future authored-specifier strategy. The evidence module itself becomes an HMR dependency.
 * Ambiguous or unresolved names are intentionally absent because their inventory did not select a
 * safe module identity.
 *
 * @param inventory Inert source evidence already resolved and conflict-checked by the analyzer.
 * @returns Frozen stronger-priority hints accepted by global bridge discovery.
 */
export function createPreviewGlobalPackageBridgeHintsFromEvidence(
  inventory: PreviewImplicitGlobalEvidenceInventory,
): readonly PreviewGlobalPackageBridgeHint[] {
  return Object.freeze(
    inventory.evidence.map((evidence) =>
      Object.freeze({
        evidence: evidence.evidenceKind,
        exportKind: evidence.exportKind,
        ...(evidence.exportName === undefined ? {} : { exportName: evidence.exportName }),
        globalName: evidence.globalName,
        moduleSpecifier: evidence.modulePath,
        resolveDir: path.dirname(evidence.sourcePath),
        watchPath: evidence.modulePath,
      }),
    ),
  );
}

/**
 * Creates a complete discovery policy from both positive and negative strong evidence.
 *
 * Ambiguous and unresolved names are blocked only from dependency fallback; any independently
 * selected hint remains eligible. A truncated inventory disables all fallback because an omitted
 * bootstrap file could contain a stronger assignment than package-name inference.
 *
 * @param inventory Bounded runtime/ambient evidence with ambiguity and truncation metadata.
 * @returns Frozen fields that may be spread into bridge discovery options.
 */
export function createPreviewGlobalPackageBridgeEvidencePolicy(
  inventory: PreviewImplicitGlobalEvidenceInventory,
): PreviewGlobalPackageBridgeEvidencePolicy {
  return Object.freeze({
    blockedGlobalNames: Object.freeze(
      [...new Set([...inventory.ambiguousGlobalNames, ...inventory.unresolvedGlobalNames])].sort(),
    ),
    disableDependencyFallback: inventory.truncated,
    evidenceDependencyPaths: Object.freeze([...inventory.dependencyPaths].sort()),
    hints: createPreviewGlobalPackageBridgeHintsFromEvidence(inventory),
  });
}
