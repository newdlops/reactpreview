/**
 * Generates a bounded GraphQL-over-HTTP selection parser for the Page Inspector data boundary.
 *
 * Apollo operations already expose a structured DocumentNode. This fallback exists for fetch-based
 * clients such as urql or small custom wrappers that send a serialized query body. It recognizes
 * response field aliases, nested selections, inline fragments, and named fragment spreads without
 * importing a GraphQL parser into every preview bundle.
 */

/**
 * Creates browser source that converts a GraphQL query string into the common payload shape.
 *
 * The emitted helper expects semantic scalar/collection functions from the surrounding data runtime.
 * Invalid, excessively large, or unfamiliar documents safely return an unknown shape.
 *
 * @returns Plain JavaScript source concatenated into the no-network data runtime.
 */
export function createPreviewInspectorGraphqlShapeRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_GRAPHQL_TOKEN_LIMIT = 8192;
const PREVIEW_INSPECTOR_GRAPHQL_FIELD_LIMIT = 512;

/** Tokenizes only GraphQL punctuation and names while discarding comments and literal contents. */
function tokenizePreviewInspectorGraphql(source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 1_000_000) return [];
  const tokens = [];
  const matcher = /#[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|\.\.\.|[_A-Za-z][_0-9A-Za-z]*|[!$():=@\[\]{|}]/gu;
  for (const match of source.matchAll(matcher)) {
    const token = match[0];
    if (token.startsWith('#') || token.startsWith('"')) continue;
    tokens.push(token);
    if (tokens.length >= PREVIEW_INSPECTOR_GRAPHQL_TOKEN_LIMIT) return [];
  }
  return tokens;
}

/** Skips one balanced argument/variable/list group without interpreting values or directives. */
function skipPreviewInspectorGraphqlBalanced(tokens, cursor, opening, closing) {
  if (tokens[cursor.index] !== opening) return;
  let depth = 0;
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index++];
    if (token === opening) depth += 1;
    if (token === closing) depth -= 1;
    if (depth === 0) return;
  }
}

/** Skips directives and their optional argument groups before a field selection set. */
function skipPreviewInspectorGraphqlDirectives(tokens, cursor) {
  while (tokens[cursor.index] === '@') {
    cursor.index += 1;
    if (/^[_A-Za-z]/u.test(tokens[cursor.index] ?? '')) cursor.index += 1;
    skipPreviewInspectorGraphqlBalanced(tokens, cursor, '(', ')');
  }
}

/** Merges fragment fields without allowing prototype names or overwriting explicit local fields. */
function mergePreviewInspectorGraphqlFields(target, source) {
  for (const [name, shape] of Object.entries(source ?? {})) {
    if (!blockedInspectorPropNames.has(name) && !Object.hasOwn(target, name)) target[name] = shape;
  }
}

/**
 * Detects a selected pagination/connection wrapper whose own name happens to end in List or Items.
 * The wrapper itself is an object; only its objectList/nodes/edges/items child is the collection.
 */
function isPreviewInspectorGraphqlConnectionSelection(shape) {
  const fields = shape?.fields;
  if (fields === null || typeof fields !== 'object') return false;
  const names = Object.keys(fields);
  const hasPagination = names.some((name) =>
    /^(?:pageInfo|pagination|paginator|meta)$/u.test(name),
  );
  const hasCollection = names.some((name) =>
    /^(?:edges|items|nodes|objectList|records|results|rows)$/u.test(name) ||
    looksLikePreviewInspectorCollection(name),
  );
  return hasPagination && hasCollection;
}

/** Parses one selection set into object fields and deferred named-fragment references. */
function parsePreviewInspectorGraphqlSelectionSet(tokens, cursor, budget) {
  if (tokens[cursor.index] !== '{') return { fields: {}, kind: 'object', spreads: [] };
  cursor.index += 1;
  const fields = {};
  const spreads = [];
  while (cursor.index < tokens.length && tokens[cursor.index] !== '}') {
    if (budget.fields >= PREVIEW_INSPECTOR_GRAPHQL_FIELD_LIMIT) break;
    if (tokens[cursor.index] === '...') {
      cursor.index += 1;
      if (tokens[cursor.index] === 'on') {
        cursor.index += 2;
        skipPreviewInspectorGraphqlDirectives(tokens, cursor);
        const inline = parsePreviewInspectorGraphqlSelectionSet(tokens, cursor, budget);
        mergePreviewInspectorGraphqlFields(fields, inline.fields);
        spreads.push(...inline.spreads);
      } else {
        const fragmentName = tokens[cursor.index++];
        if (/^[_A-Za-z]/u.test(fragmentName ?? '')) spreads.push(fragmentName);
        skipPreviewInspectorGraphqlDirectives(tokens, cursor);
      }
      continue;
    }
    const firstName = tokens[cursor.index++];
    if (!/^[_A-Za-z]/u.test(firstName ?? '')) continue;
    const hasAlias = tokens[cursor.index] === ':';
    if (hasAlias) cursor.index += 1;
    const fieldName = hasAlias ? tokens[cursor.index++] : firstName;
    const responseName = firstName;
    if (!/^[_A-Za-z]/u.test(fieldName ?? '') || blockedInspectorPropNames.has(responseName)) continue;
    skipPreviewInspectorGraphqlBalanced(tokens, cursor, '(', ')');
    skipPreviewInspectorGraphqlDirectives(tokens, cursor);
    budget.fields += 1;
    if (tokens[cursor.index] === '{') {
      const child = parsePreviewInspectorGraphqlSelectionSet(tokens, cursor, budget);
      fields[responseName] = looksLikePreviewInspectorCollection(fieldName) &&
        !isPreviewInspectorGraphqlConnectionSelection(child)
        ? { items: child, kind: 'array' }
        : child;
    } else {
      const scalarShape = { kind: inferPreviewInspectorSemanticKind(fieldName) };
      fields[responseName] = looksLikePreviewInspectorCollection(fieldName)
        ? { items: scalarShape, kind: 'array' }
        : scalarShape;
    }
  }
  if (tokens[cursor.index] === '}') cursor.index += 1;
  return { fields, kind: 'object', spreads };
}

/** Resolves named fragment fields recursively while dropping parser-only spread metadata. */
function resolvePreviewInspectorGraphqlFragments(shape, fragments, active = new Set(), depth = 0) {
  if (shape === null || typeof shape !== 'object' || depth > 12) return { kind: 'unknown' };
  if (shape.kind === 'array') {
    return {
      items: resolvePreviewInspectorGraphqlFragments(shape.items, fragments, active, depth + 1),
      kind: 'array',
    };
  }
  if (shape.kind !== 'object') return { kind: shape.kind ?? 'unknown' };
  const fields = {};
  for (const fragmentName of shape.spreads ?? []) {
    if (active.has(fragmentName)) continue;
    const fragment = fragments.get(fragmentName);
    if (fragment === undefined) continue;
    const nextActive = new Set(active).add(fragmentName);
    const resolvedFragment = resolvePreviewInspectorGraphqlFragments(
      fragment,
      fragments,
      nextActive,
      depth + 1,
    );
    mergePreviewInspectorGraphqlFields(fields, resolvedFragment.fields);
  }
  for (const [name, child] of Object.entries(shape.fields ?? {})) {
    fields[name] = resolvePreviewInspectorGraphqlFragments(child, fragments, active, depth + 1);
  }
  return { fields, kind: 'object' };
}

/** Infers one selected operation shape from a serialized GraphQL request document. */
function inferPreviewInspectorGraphqlQueryShape(source, requestedOperationName) {
  const tokens = tokenizePreviewInspectorGraphql(source);
  if (tokens.length === 0) return { kind: 'unknown' };
  const cursor = { index: 0 };
  const budget = { fields: 0 };
  const fragments = new Map();
  const operations = [];
  while (cursor.index < tokens.length && budget.fields < PREVIEW_INSPECTOR_GRAPHQL_FIELD_LIMIT) {
    const token = tokens[cursor.index];
    if (token === 'fragment') {
      cursor.index += 1;
      const fragmentName = tokens[cursor.index++];
      if (tokens[cursor.index] === 'on') cursor.index += 2;
      skipPreviewInspectorGraphqlDirectives(tokens, cursor);
      const shape = parsePreviewInspectorGraphqlSelectionSet(tokens, cursor, budget);
      if (typeof fragmentName === 'string') fragments.set(fragmentName, shape);
      continue;
    }
    if (token === 'query' || token === 'mutation' || token === 'subscription') {
      cursor.index += 1;
      const operationName = /^[_A-Za-z]/u.test(tokens[cursor.index] ?? '')
        ? tokens[cursor.index++]
        : '';
      skipPreviewInspectorGraphqlBalanced(tokens, cursor, '(', ')');
      skipPreviewInspectorGraphqlDirectives(tokens, cursor);
      operations.push({
        name: operationName,
        shape: parsePreviewInspectorGraphqlSelectionSet(tokens, cursor, budget),
      });
      continue;
    }
    if (token === '{') {
      operations.push({ name: '', shape: parsePreviewInspectorGraphqlSelectionSet(tokens, cursor, budget) });
      continue;
    }
    cursor.index += 1;
  }
  const selected = operations.find((operation) => operation.name === requestedOperationName) ?? operations[0];
  return selected === undefined
    ? { kind: 'unknown' }
    : resolvePreviewInspectorGraphqlFragments(selected.shape, fragments);
}
`;
}
