/** Normalizes thrown values into bounded-depth diagnostic text without retaining browser or process state. */

/** Keeps CDP and browser causes useful when their prototypes do not cross a realm boundary. */
export function normalizeHeadlessEvidence(value: unknown, seen = new WeakSet(), depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return '[function]';
    case 'object':
      break;
  }
  if (depth >= 4) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    const cause = record.cause;
    if (name !== undefined || message !== undefined || cause !== undefined) {
      return `${name ?? 'Error'}${message === undefined || message.length === 0 ? '' : `: ${message}`}${cause === undefined ? '' : `; cause=${normalizeHeadlessEvidence(cause, seen, depth + 1)}`}`;
    }
    const fields = Object.keys(record)
      .sort()
      .slice(0, 16)
      .map((key) => {
        try {
          return `${key}=${normalizeHeadlessEvidence(record[key], seen, depth + 1)}`;
        } catch {
          return `${key}=[unreadable]`;
        }
      });
    return fields.length === 0 ? Object.prototype.toString.call(value) : `{${fields.join(', ')}}`;
  } catch {
    return Object.prototype.toString.call(value);
  } finally {
    seen.delete(value);
  }
}

/** Preserves native errors and wraps non-Error rejections with readable evidence and their original cause. */
export function asPreviewHeadlessError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(normalizeHeadlessEvidence(value), { cause: value });
}
