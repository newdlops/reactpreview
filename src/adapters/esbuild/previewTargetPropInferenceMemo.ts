/** Caches one successful exact-source prop-inference result for a compile attempt. */
export function createPreviewTargetPropInferenceMemo<Result>(
  collect: (sourcePath: string, sourceText: string) => Result,
): (sourcePath: string, sourceText: string) => Result {
  let entry: { sourcePath: string; sourceText: string; result: Result } | undefined;

  return (sourcePath, sourceText) => {
    if (entry?.sourcePath === sourcePath && entry.sourceText === sourceText) {
      return entry.result;
    }

    const result = collect(sourcePath, sourceText);
    entry = { sourcePath, sourceText, result };
    return result;
  };
}
