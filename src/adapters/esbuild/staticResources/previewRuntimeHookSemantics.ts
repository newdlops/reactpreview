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
  /** Concise generated-value description displayed in blocker diagnostics. */
  readonly label: string;
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
      label: 'generated viewport match',
    };
  }
  if (/^(?:is|matches)(?:small|narrow|mobile)/u.test(normalized)) {
    return {
      expression: `(typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) < 768)`,
      label: 'generated viewport match',
    };
  }
  if (
    /^(?:is|has|can|should|will|did|does|was|were)(?=[A-Z0-9_$]|$)/u.test(semanticName) ||
    /(?:enabled|disabled|visible|loading|valid|active|selected|checked|suspended|touched|dirty|pristine|pending|matches)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'false', label: 'generated boolean false' };
  }
  if (
    /^(?:set|on|handle|toggle|open|close|submit|refetch|refresh|mutate|dispatch|navigate|reset|update|remove|add)(?=[A-Z0-9_$]|$)/u.test(
      semanticName,
    ) ||
    /(?:handler|callback)$/u.test(normalized)
  ) {
    return { expression: 'Object.freeze(() => undefined)', label: 'generated no-op function' };
  }
  if (
    /(?:items|rows|list|options|results|nodes|edges|records|files|users|companies)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'Object.freeze([])', label: 'generated empty list' };
  }
  if (
    /(?:count|total|index|length|size|page|amount|rate|percent|number|seconds|milliseconds|durationms|timestamp)$/u.test(
      normalized,
    )
  ) {
    return { expression: '0', label: 'generated number 0' };
  }
  if (
    /(?:props|context|form|data|filter|params|state|values|config|settings|location|router|navigation|user|company|fragment)$/u.test(
      normalized,
    )
  ) {
    return { expression: 'Object.freeze({})', label: 'generated object' };
  }
  if (/(?:fallback|element|component|children|content)$/u.test(normalized)) {
    return { expression: 'null', label: 'generated empty render value' };
  }
  if (/(?:error|exception)$/u.test(normalized)) {
    return { expression: 'null', label: 'generated empty error value' };
  }
  if (/(?:search|query)$/u.test(normalized)) {
    return {
      expression: JSON.stringify(createPreviewRuntimeSemanticString(semanticName)),
      label: 'generated key text',
    };
  }
  if (
    /(?:value|id|name|title|status|type|kind|code|message|description|text|slug|url|path|email)$/u.test(
      normalized,
    )
  ) {
    return {
      expression: JSON.stringify(createPreviewRuntimeSemanticString(semanticName)),
      label: 'generated key text',
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
