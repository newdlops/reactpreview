/**
 * Maps common runtime value names to bounded, render-safe fallback expressions.
 *
 * The policy is shared by hook-result shape inference and its comparison helpers. Keeping this
 * name-only heuristic separate makes the syntax walker easier to audit: names can select a scalar
 * family, but they never authorize imports, project execution, or unbounded generated content.
 */

/** Static expression plus the user-facing generated-value family selected from one name. */
export interface PreviewRuntimeSemanticFallback {
  /** Side-effect-free JavaScript expression evaluated only by the Page Inspector boundary. */
  readonly expression: string;
  /** Data family shared with component-prop inference without evaluating the expression text. */
  readonly kind: 'array' | 'boolean' | 'function' | 'null' | 'number' | 'object' | 'string';
  /** Concise generated-value description displayed in blocker diagnostics. */
  readonly label: string;
  /** Optional JSON-safe scalar retained when the semantic fallback has one stable literal value. */
  readonly value?: boolean | number | string | null;
}

/** Infers a static scalar, collection, object, or no-op function from a semantic local name. */
export function inferPreviewRuntimeSemanticFallback(
  rawName: string,
): PreviewRuntimeSemanticFallback | undefined {
  // Strip a hook prefix only at an actual `useX` boundary; `userName` is a data key, not `useRName`.
  const name = rawName.replace(/^use(?=[A-Z0-9_$]|$)/u, '');
  const semanticName = name.length === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1);
  const normalized = name.toLowerCase();
  if (/^(?:is|matches)(?:large|wide|desktop)/u.test(normalized)) {
    return {
      expression: `(typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) >= 1024)`,
      kind: 'boolean',
      label: 'generated viewport match',
    };
  }
  if (/^(?:is|matches)(?:small|narrow|mobile)/u.test(normalized)) {
    return {
      expression: `(typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) < 768)`,
      kind: 'boolean',
      label: 'generated viewport match',
    };
  }
  if (
    /(?:isowner|owneraccess|canaccess|hasaccess|isallowed|haspermission|authorized)$/u.test(
      normalized,
    )
  ) {
    return {
      expression: 'true',
      kind: 'boolean',
      label: 'generated positive access capability',
      value: true,
    };
  }
  if (
    /^(?:is|has|can|should|requires|will|did|does|was|were)(?=[A-Z0-9_$]|$)/u.test(semanticName) ||
    /(?:enabled|disabled|visible|loading|valid|active|selected|checked|suspended|touched|dirty|pristine|pending|matches)$/u.test(
      normalized,
    )
  ) {
    return {
      expression: 'false',
      kind: 'boolean',
      label: 'generated boolean false',
      value: false,
    };
  }
  if (
    /^(?:set|on|handle|toggle|open|close|submit|refetch|refresh|mutate|dispatch|navigate|reset|update|remove|add)(?=[A-Z0-9_$]|$)/u.test(
      semanticName,
    ) ||
    /(?:handler|callback)$/u.test(normalized)
  ) {
    return {
      expression: 'Object.freeze(() => undefined)',
      kind: 'function',
      label: 'generated no-op function',
    };
  }
  if (
    /(?:items|rows|list|options|results|nodes|edges|records|files|users|companies|permissions|roles|scopes|claims|capabilities)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'Object.freeze([])', kind: 'array', label: 'generated empty list' };
  }
  if (
    /(?:At|On|Date|DateTime|Time)$/u.test(semanticName) ||
    /^(?:date|datetime|time)$/u.test(normalized) ||
    /^(?:birthdate|dateofbirth|dob)$/u.test(normalized) ||
    /(?:_at|_on|_date|_datetime|_time)$/u.test(normalized)
  ) {
    const value = '2024-01-01T00:00:00.000Z';
    return {
      expression: JSON.stringify(value),
      kind: 'string',
      label: 'generated ISO date-time',
      value,
    };
  }
  if (normalized === 'step') {
    return {
      expression: '1',
      kind: 'number',
      label: 'generated first wizard step',
      value: 1,
    };
  }
  if (
    /^(?:count|total|index|length|size|amount|rate|percent|number|num|den|numerator|denominator|price|unitPrice|shares|quantity|seconds|milliseconds|durationMs|timestamp)(?=[A-Z0-9_$]|$)/u.test(
      semanticName,
    ) ||
    /(?:count|total|index|length|size|page|amount|rate|percent|number|num|den|numerator|denominator|price|pricepershare|unitprice|shares|quantity|seconds|milliseconds|durationms|timestamp)$/u.test(
      normalized,
    )
  ) {
    return { expression: '0', kind: 'number', label: 'generated number 0', value: 0 };
  }
  if (
    /(?:props|context|form|data|filter|params|state|values|config|settings|location|router|navigation|user|company|fragment)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'Object.freeze({})', kind: 'object', label: 'generated object' };
  }
  if (/(?:fallback|element|component|children|content)$/u.test(normalized)) {
    return {
      expression: 'null',
      kind: 'null',
      label: 'generated empty render value',
      value: null,
    };
  }
  if (/(?:error|exception)$/u.test(normalized)) {
    return {
      expression: 'null',
      kind: 'null',
      label: 'generated empty error value',
      value: null,
    };
  }
  if (/^(?:avatar|image|photo|picture|thumbnail)(?:url|uri|href|src)$/u.test(normalized)) {
    return {
      expression: '""',
      kind: 'string',
      label: 'generated empty optional image source',
      value: '',
    };
  }
  if (/(?:url|uri)$/u.test(normalized)) {
    const value = 'https://example.invalid/';
    return {
      expression: JSON.stringify(value),
      kind: 'string',
      label: 'generated inert absolute URL',
      value,
    };
  }
  if (/(?:href|pathname|path|link|to)$/u.test(normalized)) {
    const value = '/';
    return {
      expression: JSON.stringify(value),
      kind: 'string',
      label: 'generated root-relative location',
      value,
    };
  }
  if (/(?:search|query)$/u.test(normalized)) {
    return {
      expression: JSON.stringify(createPreviewRuntimeSemanticString(semanticName)),
      kind: 'string',
      label: 'generated key text',
      value: createPreviewRuntimeSemanticString(semanticName),
    };
  }
  if (
    /^(?:value|id|name|label|title|status|type|kind|code|message|description|text|slug|link|url|path|email|phone)(?=[A-Z0-9_$]|$)/u.test(
      semanticName,
    ) ||
    /(?:value|id|name|label|title|status|type|kind|code|message|description|text|slug|link|url|path|email|phone)$/u.test(
      normalized,
    )
  ) {
    return {
      expression: JSON.stringify(createPreviewRuntimeSemanticString(semanticName)),
      kind: 'string',
      label: 'generated key text',
      value: createPreviewRuntimeSemanticString(semanticName),
    };
  }
  return undefined;
}

/** Produces compact key-derived text while preserving formats used by common runtime operations. */
export function createPreviewRuntimeSemanticString(rawName: string): string {
  const normalizedName = rawName.toLowerCase();
  if (normalizedName.endsWith('id')) return 'preview-id';
  if (normalizedName.endsWith('status')) return 'PREVIEW';
  if (normalizedName.endsWith('email')) return 'preview@example.invalid';
  return rawName.length <= 32 ? rawName : `${rawName.slice(0, 31)}…`;
}
