/**
 * Selects the lockfile-specific public package acquisition strategy for one compiler retry.
 * Each adapter independently revalidates the frozen profile, so unsupported or competing evidence
 * fails closed without invoking package managers, scripts, or workspace writes.
 */
import {
  acquirePreviewPackageLockDependencies,
  type AcquirePreviewPackageLockDependenciesOptions,
} from './previewPackageLockAcquirer';
import {
  acquirePreviewYarnLockDependencies,
  type PreviewYarnMetadataTransport,
} from './previewYarnLockAcquirer';
import type { PreviewManagedPackageCopyResult } from './previewManagedDependencyAdmission';

/**
 * Shared options accepted by npm and Yarn public archive acquisition.
 *
 * `metadataTransport` is Yarn-Berry-specific: package-lock and Yarn classic already carry archive
 * integrity in the lockfile, while Berry needs one exact-version metadata lookup. Keeping this
 * boundary injectable lets the dispatcher be covered by deterministic offline tests as well.
 */
export interface AcquirePreviewLockedDependenciesOptions extends AcquirePreviewPackageLockDependenciesOptions {
  readonly metadataTransport?: PreviewYarnMetadataTransport;
}

/**
 * Attempts the exact npm lock format first, then Yarn v1/Berry using the same safe archive adapters.
 *
 * @param options Frozen dependency evidence, missing package roots, and unpublished destination.
 * @returns Verified package-set accounting, or `undefined` when no supported lock can satisfy it.
 */
export async function acquirePreviewLockedDependencies(
  options: AcquirePreviewLockedDependenciesOptions,
): Promise<PreviewManagedPackageCopyResult | undefined> {
  const packageLockResult = await acquirePreviewPackageLockDependencies(options);
  if (packageLockResult !== undefined) return packageLockResult;
  if (options.signal?.aborted === true) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error('Preview dependency acquisition aborted.');
  }
  return acquirePreviewYarnLockDependencies({
    ...(options.extractor === undefined ? {} : { extractor: options.extractor }),
    ...(options.metadataTransport === undefined
      ? {}
      : { metadataTransport: options.metadataTransport }),
    profile: options.profile,
    projectRoot: options.projectRoot,
    ...(options.requiredPackageNames === undefined
      ? {}
      : { requiredPackageNames: options.requiredPackageNames }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    targetNodeModulesPath: options.targetNodeModulesPath,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  });
}
