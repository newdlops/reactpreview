/** Creates a stable package-barrel demand set for one frozen build frontier. */
export function createPreviewInspectorPackageDemandPathSet(
  sourcePaths: Iterable<string>,
): ReadonlySet<string> {
  return new Set([...new Set(sourcePaths)].sort());
}
