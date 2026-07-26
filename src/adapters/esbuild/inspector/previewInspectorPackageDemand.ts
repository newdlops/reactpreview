/** Creates a stable, bounded package-barrel demand set for one frozen build frontier. */
export function createPreviewInspectorPackageDemandPathSet(
  sourcePaths: Iterable<string>,
  maximumPaths: number,
): ReadonlySet<string> {
  const paths = [...new Set(sourcePaths)].sort();
  return new Set(paths.slice(0, Math.max(0, maximumPaths)));
}
