/**
 * Selects package issuers that may satisfy Yarn PnP peers for an Inspector page composition.
 *
 * A component selected from a shared workspace package keeps that package as its compilation
 * project root, while the actual page may live in a sibling application. PnP peers belong to that
 * consuming app. This adapter derives only roots already proven by the bounded page plan and never
 * scans the workspace or executes `.pnp.cjs`.
 */
import { findPreviewProjectRoot } from './previewProjectRoot';
import {
  canonicalizeExistingPath,
  canonicalizePathThroughExistingAncestor,
} from '../../shared/pathIdentity';

const MAX_APPLICATION_ROOT_SOURCES = 16;

/** Inputs produced after Page Inspector ancestry and filesystem-page discovery complete. */
export interface CollectPreviewPnpApplicationRootsOptions {
  /** Nearest package containing the editor-selected component. */
  readonly projectRoot: string;
  /** Authored page and implicit wrapper sources already proven by the Inspector page plan. */
  readonly sourcePaths: readonly string[];
  /** Trusted workspace boundary for every nearest-package lookup. */
  readonly workspaceRoot: string;
}

/**
 * Returns selected-component and consuming-page package roots in stable priority order.
 * Candidate page roots lead their implicit wrappers to keep the most relevant application first.
 */
export async function collectPreviewPnpApplicationRoots(
  options: CollectPreviewPnpApplicationRootsOptions,
): Promise<readonly string[]> {
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const sourcePaths = options.sourcePaths.slice(0, MAX_APPLICATION_ROOT_SOURCES);
  const discoveredRoots = await Promise.all(
    sourcePaths.map((sourcePath) =>
      findPreviewProjectRoot(canonicalizePathThroughExistingAncestor(sourcePath), workspaceRoot),
    ),
  );
  return Object.freeze([...new Set([projectRoot, ...discoveredRoots])]);
}
