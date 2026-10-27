/**
 * Emits a side-effect-free JavaScript expression for a declared-type value descriptor.
 *
 * Instrumented modules embed the expression directly (for example as a module-level constant), so
 * it must be valid in any ES2020 module, deterministic, and free of project references. Objects and
 * arrays are frozen to match other generated preview values; declared React ref cells stay writable.
 */
import {
  createPreviewSampleDateRebaseExpression,
  PREVIEW_CANONICAL_SAMPLE_DATE,
  PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
} from '../previewSampleDateRuntimeSource';
import { PREVIEW_TYPED_VALUE_TAG, type PreviewTypedValue } from './previewTypeValueSynthesizer';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Serializes one descriptor as a JavaScript expression.
 *
 * @param value Descriptor produced by `synthesizePreviewTypedValue`.
 * @param unknownExpression Expression for `unknown`-tagged slots (unresolved types).
 * @returns Expression text; runtime-only tags become functions, dates, or collections.
 */
export function createPreviewTypedValueExpression(
  value: PreviewTypedValue,
  unknownExpression = 'undefined',
): string {
  if (value === null) return 'null';
  // The canonical sample day lands on the current day once the page's sample-date API exists.
  if (value === PREVIEW_CANONICAL_SAMPLE_DATE || value === PREVIEW_CANONICAL_SAMPLE_DATE_TIME) {
    return createPreviewSampleDateRebaseExpression(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (Array.isArray(value)) {
    const items = value as readonly PreviewTypedValue[];
    return `Object.freeze([${items.map((item) => createPreviewTypedValueExpression(item, unknownExpression)).join(', ')}])`;
  }
  const record = value as Readonly<Record<string, PreviewTypedValue>>;
  const tag = record[PREVIEW_TYPED_VALUE_TAG];
  if (tag === 'unknown') return unknownExpression;
  if (tag === 'ref') {
    return `({ current: ${createPreviewTypedValueExpression(record.value ?? null, unknownExpression)} })`;
  }
  if (tag === 'function') {
    const returns = record.returns;
    return returns === undefined
      ? 'Object.freeze(() => undefined)'
      : `Object.freeze(() => (${createPreviewTypedValueExpression(returns, unknownExpression)}))`;
  }
  if (tag === 'date') {
    return `new Date(${createPreviewSampleDateRebaseExpression(
      typeof record.iso === 'string' ? record.iso : PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
    )})`;
  }
  if (tag === 'bigint') {
    return `BigInt(${JSON.stringify(typeof record.value === 'string' ? record.value : '0')})`;
  }
  if (tag === 'map') return 'new Map()';
  if (tag === 'set') return 'new Set()';
  if (tag === 'promise') {
    const settled = record.value;
    return `Promise.resolve(${settled === undefined ? 'undefined' : createPreviewTypedValueExpression(settled, unknownExpression)})`;
  }
  const entries = Object.entries(record)
    .filter(([key]) => !BLOCKED_KEYS.has(key))
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}: ${createPreviewTypedValueExpression(item, unknownExpression)}`,
    );
  return `Object.freeze({ ${entries.join(', ')} })`;
}

/**
 * Serializes a callable descriptor, such as a server function's declared type.
 *
 * @param value Descriptor produced by `synthesizePreviewTypedValue`.
 * @param unknownExpression Expression for slots whose type could not be resolved.
 * @returns Function expression, or `undefined` when the descriptor is not a function.
 */
export function createPreviewTypedFunctionExpression(
  value: PreviewTypedValue,
  unknownExpression?: string,
): string | undefined {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Readonly<Record<string, PreviewTypedValue>>)[PREVIEW_TYPED_VALUE_TAG] === 'function'
    ? createPreviewTypedValueExpression(value, unknownExpression)
    : undefined;
}
