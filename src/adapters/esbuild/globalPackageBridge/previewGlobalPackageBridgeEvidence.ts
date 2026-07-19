/**
 * Converts the bounded implicit-global source inventory into generic bridge hints.
 * Keeping this adapter beside the bridge avoids coupling the evidence parser to esbuild while still
 * preserving canonical workspace module identity, export shape, and consumer resolution context.
 */
import { existsSync } from 'node:fs';
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
    inventory.evidence.map((evidence) => {
      /*
       * TypeScript intentionally resolves many bare packages to their declaration entry. That is
       * correct for static identity analysis but importing an absolute `.d.ts` yields no browser
       * value (for example the `Buffer` constructor becomes an empty object). Preserve the authored
       * package/alias specifier in that case so esbuild selects the actual browser implementation.
       */
      const declarationOnlyModule = /\.d\.[cm]?ts$/iu.test(evidence.modulePath);
      const adjacentRuntimeModule = declarationOnlyModule
        ? selectAdjacentPreviewRuntimeModule(evidence.modulePath)
        : undefined;
      return Object.freeze({
        evidence: evidence.evidenceKind,
        exportKind: evidence.exportKind,
        ...(evidence.exportName === undefined ? {} : { exportName: evidence.exportName }),
        globalName: evidence.globalName,
        moduleSpecifier:
          adjacentRuntimeModule ??
          (declarationOnlyModule ? evidence.moduleSpecifier : evidence.modulePath),
        resolveDir: path.dirname(evidence.sourcePath),
        watchPath: adjacentRuntimeModule ?? evidence.modulePath,
      });
    }),
  );
}

/**
 * Maps a declaration entry to an adjacent implementation without interpreting package metadata.
 * Absolute implementation paths also bypass the Node-built-in compatibility shim when a browser
 * polyfill package intentionally owns the same spelling, as with the `buffer` npm package.
 */
function selectAdjacentPreviewRuntimeModule(declarationPath: string): string | undefined {
  const basePath = declarationPath.replace(/\.d\.[cm]?ts$/iu, '');
  const extension = path.extname(declarationPath).toLowerCase();
  const preferredExtension = extension === '.mts' ? '.mjs' : extension === '.cts' ? '.cjs' : '.js';
  return [
    `${basePath}${preferredExtension}`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
  ].find((candidate) => existsSync(candidate));
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
