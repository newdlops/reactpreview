/** Edits deliberately malformed JSON fixtures without asserting that their transport payload is typed. */
export type FixturePath = readonly (number | string)[];

/** Reads fixture field values; negative numeric segments use Array.at indexing. */
export function fixtureValue(root: unknown, path: FixturePath = []): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    const container = Object(current) as object;
    const key = fixtureKey(container, segment);
    current = Reflect.get(container, key) as unknown;
  }
  return current;
}

/** Requires an object-shaped fixture location before a test changes or enumerates its fields. */
export function fixtureObject(root: unknown, path: FixturePath = []): Record<string, unknown> {
  const value = fixtureValue(root, path);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Expected fixture object at ${JSON.stringify(path)}.`);
  return value as Record<string, unknown>;
}

/** Requires an existing fixture list so its mutations preserve the original array identity. */
export function fixtureArray(root: unknown, path: FixturePath = []): unknown[] {
  const value = fixtureValue(root, path);
  if (!Array.isArray(value)) throw new Error(`Expected fixture array at ${JSON.stringify(path)}.`);
  return value as unknown[];
}

/** Sets one test field while preserving property order, array identity, and the supplied value. */
export function setFixtureValue(root: unknown, path: FixturePath, value: unknown): void {
  const { container, key } = fixtureMutationTarget(root, path);
  Object.defineProperty(container, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Removes the exact test field; other fixture values and their insertion order are retained. */
export function deleteFixtureValue(root: unknown, path: FixturePath): void {
  const { container, key } = fixtureMutationTarget(root, path);
  if (!Reflect.deleteProperty(container, key))
    throw new Error('Fixture field could not be removed.');
}

/** Resolves a mutation parent without creating containers that the original fixture never had. */
function fixtureMutationTarget(
  root: unknown,
  path: FixturePath,
): { readonly container: object; readonly key: string } {
  const leaf = path.at(-1);
  if (leaf === undefined) throw new Error('A fixture mutation requires a field path.');
  const container = fixtureValue(root, path.slice(0, -1));
  if (container === null || typeof container !== 'object')
    throw new Error(`Expected fixture mutation parent at ${JSON.stringify(path)}.`);
  return { container, key: fixtureKey(container, leaf) };
}

/** Converts Array.at-style negative positions to physical indices and retains ordinary JSON keys. */
function fixtureKey(container: object, segment: number | string): string {
  return typeof segment === 'number' && segment < 0 && Array.isArray(container)
    ? (container.length + segment).toString()
    : segment.toString();
}
