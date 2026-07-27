/** Serializes one selected preview pathname and its statically inferred query values. */
export function createPreviewInspectorRouteHref(
  pathname: string,
  searchParams: Readonly<Record<string, string | readonly string[]>>,
): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(searchParams).sort((left, right) => left.localeCompare(right))) {
    const value = searchParams[key];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      query.append(key, value);
      continue;
    }
    for (const item of value) query.append(key, item);
  }
  const serialized = query.toString();
  return serialized.length === 0 ? pathname : `${pathname}?${serialized}`;
}
