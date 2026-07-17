/**
 * Creates deterministic identities for reusable native esbuild contexts and adaptive evidence.
 * Only JSON-like build-plan data belongs here: editor source bytes are intentionally excluded so
 * hot updates can reuse a context while its mutable source boundary advances independently.
 */
import { createHash } from 'node:crypto';

/**
 * Hashes a complete static build plan after recursively sorting object keys.
 * Sorting makes the identity independent from incidental property insertion order while arrays
 * retain their semantic ordering, such as selected exports and provider composition.
 *
 * @param plan JSON-like values that determine esbuild options or generated virtual modules.
 * @returns Compact SHA-256 identity suitable for bounded in-memory cache keys.
 */
export function createPreviewBuildPlanIdentity(plan: unknown): string {
  return createHash('sha256').update(serializePlanValue(plan)).digest('hex').slice(0, 32);
}

/** Serializes one supported value with explicit tags for otherwise ambiguous primitives. */
function serializePlanValue(value: unknown): string {
  if (value === undefined) {
    return 'u';
  }
  if (value === null) {
    return 'n';
  }
  if (typeof value === 'boolean') {
    return value ? 'b1' : 'b0';
  }
  if (typeof value === 'number') {
    return `d${Number.isFinite(value) ? value.toString() : JSON.stringify(value)}`;
  }
  if (typeof value === 'string') {
    return `s${JSON.stringify(value)}`;
  }
  if (Array.isArray(value)) {
    return `a[${value.map(serializePlanValue).join(',')}]`;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported preview build-plan value: ${typeof value}`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `o{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializePlanValue(record[key])}`)
    .join(',')}}`;
}
