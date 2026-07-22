/**
 * Selects compatible immutable dependency layers without allowing locally learned package bytes to
 * hide lockfile-verified or extension-bundled packages for the same portable npm slot.
 */
import type { PreviewManagedPackageIdentity } from './previewManagedDependencyAdmission';

/** Explains which evidence produced one persisted package layer. */
export type PreviewManagedDependencyLayerCoverage = 'bundled' | 'lockfile' | 'reached';

/** Minimal persisted layer shape needed by the conflict-selection policy. */
export interface PreviewManagedDependencyLayerDescriptor {
  /** Trust class used to prefer reproducible bytes over workspace-observed bytes. */
  readonly coverage: PreviewManagedDependencyLayerCoverage;
  /** Verified package identities and portable destinations contained by this layer. */
  readonly packages: readonly PreviewManagedPackageIdentity[];
}

/**
 * Keeps authoritative layers and only reached layers that do not participate in a conflict.
 *
 * Two conflicting lockfile layers invalidate the complete selection because neither exact result
 * may be chosen arbitrarily. Lockfile bytes outrank the compatible bundled seed, and both outrank
 * locally reached bytes. Conflicting lower-trust layers are discarded without hiding unrelated
 * private or workspace-provided dependencies.
 *
 * @param layers Validated immutable layers in deterministic storage order.
 * @returns A frozen compatible subset retaining each input object's concrete type.
 */
export function selectCompatiblePreviewManagedLayers<
  Layer extends PreviewManagedDependencyLayerDescriptor,
>(layers: readonly Layer[]): readonly Layer[] {
  const locked = layers.filter(({ coverage }) => coverage === 'lockfile');
  if (findConflictingLayerIndexes(locked).size > 0) return Object.freeze([]);

  const bundled = layers.filter(({ coverage }) => coverage === 'bundled');
  const rejectedBundled = findConflictingLayerIndexes(bundled);
  for (const [index, candidate] of bundled.entries()) {
    if (locked.some((trusted) => layersConflict(candidate, trusted))) rejectedBundled.add(index);
  }
  const compatibleBundled = bundled.filter((_layer, index) => !rejectedBundled.has(index));

  const reached = layers.filter(({ coverage }) => coverage === 'reached');
  const rejectedReached = findConflictingLayerIndexes(reached);
  for (const [index, candidate] of reached.entries()) {
    if ([...locked, ...compatibleBundled].some((trusted) => layersConflict(candidate, trusted))) {
      rejectedReached.add(index);
    }
  }
  return Object.freeze([
    ...locked,
    ...compatibleBundled,
    ...reached.filter((_layer, index) => !rejectedReached.has(index)),
  ]);
}

/** Returns every layer index participating in a competing package-slot identity. */
function findConflictingLayerIndexes(
  layers: readonly PreviewManagedDependencyLayerDescriptor[],
): Set<number> {
  const conflicts = new Set<number>();
  for (let leftIndex = 0; leftIndex < layers.length; leftIndex += 1) {
    const left = layers[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < layers.length; rightIndex += 1) {
      const right = layers[rightIndex];
      if (right !== undefined && layersConflict(left, right)) {
        conflicts.add(leftIndex);
        conflicts.add(rightIndex);
      }
    }
  }
  return conflicts;
}

/** Compares package identities only when two layers occupy the same case-folded npm slot. */
function layersConflict(
  left: PreviewManagedDependencyLayerDescriptor,
  right: PreviewManagedDependencyLayerDescriptor,
): boolean {
  const rightIdentityByPath = new Map(
    right.packages.map((identity) => [packageSlotKey(identity), packageIdentityKey(identity)]),
  );
  return left.packages.some((identity) => {
    const rightIdentity = rightIdentityByPath.get(packageSlotKey(identity));
    return rightIdentity !== undefined && rightIdentity !== packageIdentityKey(identity);
  });
}

/** Builds the portable case-folded slot key already enforced by package admission. */
function packageSlotKey(identity: PreviewManagedPackageIdentity): string {
  return identity.relativePath.normalize('NFC').toLowerCase();
}

/** Keeps name, version, and content bytes inseparable when comparing one installed slot. */
function packageIdentityKey(identity: PreviewManagedPackageIdentity): string {
  return `${identity.name}\0${identity.version}\0${identity.contentDigest}`;
}
