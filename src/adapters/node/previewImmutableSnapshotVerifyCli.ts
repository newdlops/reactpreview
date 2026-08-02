/** Revalidates an accepted immutable source/dependency snapshot before an operational phase. */
import path from 'node:path';
import { verifyPreviewDependencyView } from './previewDependencyView';
import { verifyPreviewTrackedSourceSnapshot } from './previewTrackedSourceSnapshot';

export async function runPreviewImmutableSnapshotVerifyCli(
  arguments_: readonly string[],
): Promise<number> {
  if (arguments_.length !== 2 || arguments_[0] !== '--snapshot' || arguments_[1] === undefined) {
    throw new Error('Snapshot verification requires exactly --snapshot <path>.');
  }
  const snapshotPath = path.resolve(arguments_[1]);
  const source = await verifyPreviewTrackedSourceSnapshot(snapshotPath);
  const dependency = await verifyPreviewDependencyView(snapshotPath);
  if (dependency.sourceManifestDigest !== source.manifestDigest) {
    throw new Error('Snapshot source and dependency lineage do not match.');
  }
  process.stdout.write(
    `${JSON.stringify({
      archiveSha256: source.archiveSha256,
      commit: source.commit,
      dependencyViewDigest: dependency.dependencyViewDigest,
      policyDigest: dependency.policyDigest,
      snapshotPath,
      sourceManifestDigest: source.manifestDigest,
      tree: source.tree,
    })}\n`,
  );
  return 0;
}
