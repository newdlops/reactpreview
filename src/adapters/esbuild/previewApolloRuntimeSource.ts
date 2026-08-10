/**
 * Generates the browser-only Apollo runtime used by the optional preview bridge.
 * Keeping this source separate from resolver policy makes the no-network behavior auditable and
 * lets future GraphQL adapters evolve without expanding the central compiler implementation.
 */

/** Resolved project modules required to build an Apollo preview boundary. */
export interface PreviewApolloRuntimeSourceOptions {
  /** Absolute browser-resolved entry for the project's Apollo core package. */
  readonly coreModulePath: string;
  /** Optional React integration entry used by Apollo Client versions with split exports. */
  readonly reactModulePath?: string;
}

/**
 * Creates a terminating Apollo link and provider wrapper as plain browser JavaScript.
 * The link never constructs an HttpLink, calls fetch, or forwards an operation. Instead it returns
 * a bounded neutral object matching the operation selection tree, with an optional setup override.
 *
 * @param options Project-owned Apollo module entries selected through esbuild resolution.
 * @returns JavaScript source loaded inside the private Apollo bridge namespace.
 */
export function createPreviewApolloRuntimeSource(
  options: PreviewApolloRuntimeSourceOptions,
): string {
  const encodedCorePath = JSON.stringify(normalizeImportPath(options.coreModulePath));
  const reactImport =
    options.reactModulePath === undefined
      ? 'const ApolloReact = ApolloCore;'
      : `import * as ApolloReact from ${JSON.stringify(normalizeImportPath(options.reactModulePath))};`;

  return `
import * as React from 'react';
import * as ApolloCore from ${encodedCorePath};
${reactImport}

const MAX_STATIC_APOLLO_DEPTH = 20;
const MAX_STATIC_APOLLO_FIELDS = 512;
let previewRuntimeStatus = 'available: static Apollo provider has not been composed yet';

/** Returns the last automatic Apollo decision for detailed preview runtime diagnostics. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}

/** Reports whether a value can safely hold setup configuration or generated response fields. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Selects the requested operation, falling back to the first operation in the document. */
function selectOperation(document, operationName) {
  const definitions = Array.isArray(document?.definitions) ? document.definitions : [];
  const operations = definitions.filter((definition) => definition?.kind === 'OperationDefinition');
  return operations.find((definition) => definition.name?.value === operationName) ?? operations[0];
}

/** Indexes named fragments so spreads can contribute the same response shape as inline fields. */
function collectFragments(document) {
  const fragments = new Map();
  const definitions = Array.isArray(document?.definitions) ? document.definitions : [];
  for (const definition of definitions) {
    if (definition?.kind === 'FragmentDefinition' && typeof definition.name?.value === 'string') {
      fragments.set(definition.name.value, definition);
    }
  }
  return fragments;
}

/** Infers interface/union membership only from sibling concrete inline branches in one operation. */
function collectStaticApolloPossibleTypes(document, operationName) {
  const fragments = collectFragments(document);
  const possibleTypes = new Map();
  const activeFragments = new Set();
  const budget = { selectionSets: 0 };
  function visit(selectionSet, depth) {
    if (
      depth > MAX_STATIC_APOLLO_DEPTH ||
      budget.selectionSets >= MAX_STATIC_APOLLO_FIELDS ||
      !Array.isArray(selectionSet?.selections)
    ) return;
    budget.selectionSets += 1;
    const concreteTypes = [...new Set(selectionSet.selections.flatMap((selection) => {
      const typeName = selection?.kind === 'InlineFragment'
        ? selection.typeCondition?.name?.value
        : undefined;
      return typeof typeName === 'string' && typeName.length > 0 ? [typeName] : [];
    }))];
    if (concreteTypes.length > 0) {
      for (const selection of selectionSet.selections) {
        if (selection?.kind !== 'FragmentSpread') continue;
        const fragmentName = selection.name?.value;
        const fragment = typeof fragmentName === 'string' ? fragments.get(fragmentName) : undefined;
        const abstractType = fragment?.typeCondition?.name?.value;
        if (typeof abstractType !== 'string' || concreteTypes.includes(abstractType)) continue;
        const registered = possibleTypes.get(abstractType) ?? new Set();
        for (const concreteType of concreteTypes) registered.add(concreteType);
        possibleTypes.set(abstractType, registered);
      }
    }
    for (const selection of selectionSet.selections) {
      if (selection?.kind === 'Field' || selection?.kind === 'InlineFragment') {
        visit(selection.selectionSet, depth + 1);
        continue;
      }
      if (selection?.kind !== 'FragmentSpread') continue;
      const fragmentName = selection.name?.value;
      if (typeof fragmentName !== 'string' || activeFragments.has(fragmentName)) continue;
      const fragment = fragments.get(fragmentName);
      if (fragment === undefined) continue;
      activeFragments.add(fragmentName);
      visit(fragment.selectionSet, depth + 1);
      activeFragments.delete(fragmentName);
    }
  }
  visit(selectOperation(document, operationName)?.selectionSet, 0);
  return Object.fromEntries(
    [...possibleTypes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([typeName, concreteTypes]) => [typeName, [...concreteTypes].sort()]),
  );
}

/** Adds only query-proven abstract-type relationships to Apollo's current memory cache. */
function registerStaticApolloPossibleTypes(cache, document, operationName) {
  const addPossibleTypes = cache?.policies?.addPossibleTypes;
  if (typeof addPossibleTypes !== 'function') return;
  const possibleTypes = collectStaticApolloPossibleTypes(document, operationName);
  if (Object.keys(possibleTypes).length === 0) return;
  addPossibleTypes.call(cache.policies, possibleTypes);
}

/** Recognizes field names that conventionally represent GraphQL lists without using a schema. */
function looksLikeCollection(fieldName) {
  const sourceName = String(fieldName);
  const lowerName = sourceName.toLowerCase();
  if (/(items|nodes|edges|list|collection|connections|results|features)$/.test(lowerName)) {
    return true;
  }
  if (
    /(status|address|business|success|access|process|progress|news|series|analysis|relations|statistics)$/.test(
      lowerName,
    )
  ) {
    return false;
  }
  if (hasNumericUnitFieldSuffix(sourceName)) return false;
  if (lowerName.startsWith('all') || lowerName.endsWith('ies') || lowerName.endsWith('s')) {
    return true;
  }
  const words = sourceName
    .replace(/([a-z\\d])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z\\d]+/u)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  const terminalSingularContainers = new Set([
    'connection', 'context', 'detail', 'entity', 'info', 'item', 'node', 'page', 'record',
    'request', 'response', 'result', 'state', 'summary',
  ]);
  if (terminalSingularContainers.has(words.at(-1) ?? '')) return false;
  const relationWords = new Set(['by', 'for', 'from', 'of', 'to', 'under', 'with']);
  const nonCollectionPlurals = new Set([
    'access', 'address', 'analysis', 'business', 'news', 'process', 'progress', 'relations', 'series',
    'days', 'hours', 'minutes', 'months', 'seconds', 'statistics', 'status', 'years',
  ]);
  return words.some((word, index) =>
    relationWords.has(words[index + 1] ?? '') &&
    !nonCollectionPlurals.has(word) &&
    (word.endsWith('ies') || word.endsWith('s')),
  );
}

/** Recognizes numeric units only at authored word boundaries, so holidays is still a list. */
function hasNumericUnitFieldSuffix(fieldName) {
  const source = String(fieldName);
  return /(?:Age|Years?|Months?|Days?|Hours?|Minutes?|Seconds?)$/u.test(source) ||
    /(?:^|_)(?:age|years?|months?|days?|hours?|minutes?|seconds?)$/u.test(source);
}

/** Produces a conservative scalar placeholder from a field name when schema types are unavailable. */
function createNeutralScalar(fieldName) {
  const lowerName = fieldName.toLowerCase();
  if (fieldName === '__typename') {
    return 'Preview';
  }
  if (lowerName === 'id' || lowerName.endsWith('id')) {
    return 'preview';
  }
  if (/^(is|has|can|should|allow|enable|disable|visible|active|selected|checked)/.test(lowerName)) {
    return false;
  }
  if (/(count|total|length|size|index|page|limit|offset)$/.test(lowerName) ||
    hasNumericUnitFieldSuffix(fieldName)) {
    return 0;
  }
  if (/(price|amount|balance|rate|ratio|percent|percentage|cost|fee|salary|wage)$/.test(lowerName)) {
    return '0';
  }
  if (/(date|time|timestamp|createdat|updatedat|deletedat)$/.test(lowerName)) {
    return '1970-01-01T00:00:00.000Z';
  }
  if (/(name|title|label|text|description|message|status|type|code|value|url|uri|path|email)$/.test(lowerName)) {
    return '';
  }
  return null;
}

/** Converts a neutral scalar into the shared Inspector payload-generator shape contract. */
function createStaticApolloScalarShape(fieldName) {
  const neutralValue = createNeutralScalar(fieldName);
  if (typeof neutralValue === 'boolean') return { kind: 'boolean' };
  if (typeof neutralValue === 'number') return { kind: 'number' };
  if (typeof neutralValue === 'string') return { kind: 'string' };
  return { kind: 'unknown' };
}

/**
 * Detects a schema-less pagination wrapper whose field name resembles a collection.
 * A field such as eventList can still return an object containing pageInfo and objectList; only the
 * nested objectList/nodes/edges/items field is an array in that common connection shape.
 */
function isStaticApolloConnectionSelection(selectionSet) {
  if (!Array.isArray(selectionSet?.selections)) return false;
  const names = selectionSet.selections.flatMap((selection) =>
    selection?.kind === 'Field' && typeof selection.name?.value === 'string'
      ? [selection.name.value]
      : [],
  );
  const hasPagination = names.some((name) =>
    /^(?:pageInfo|pagination|paginator|meta)$/u.test(name),
  );
  const hasCollection = names.some((name) =>
    /^(?:edges|items|nodes|objectList|records|results|rows)$/u.test(name) ||
    looksLikeCollection(name),
  );
  return hasPagination && hasCollection;
}

/** Selects one deterministic concrete branch when a collection item is a GraphQL union. */
function readStaticApolloRepresentativeTypeName(selectionSet) {
  if (!Array.isArray(selectionSet?.selections)) return undefined;
  for (const selection of selectionSet.selections) {
    if (selection?.kind !== 'InlineFragment') continue;
    const typeName = selection.typeCondition?.name?.value;
    if (typeof typeName === 'string' && typeName.length > 0) return typeName;
  }
  return undefined;
}

/** Proves one collection item can be materialized from one deterministic conditional branch. */
function isSafeStaticApolloRepresentativeSelection(
  selectionSet,
  fragments,
  budget,
  depth,
  activeFragments,
  responseNames,
) {
  if (
    depth > MAX_STATIC_APOLLO_DEPTH ||
    !Array.isArray(selectionSet?.selections) ||
    selectionSet.selections.length === 0
  ) {
    return false;
  }
  const representativeTypeName = readStaticApolloRepresentativeTypeName(selectionSet);
  for (const selection of selectionSet.selections) {
    if (Array.isArray(selection?.directives) && selection.directives.length > 0) return false;
    if (selection?.kind === 'Field') {
      if (budget.fields >= MAX_STATIC_APOLLO_FIELDS) return false;
      budget.fields += 1;
      const fieldName = selection.name?.value;
      if (typeof fieldName !== 'string') return false;
      const responseName = selection.alias?.value ?? fieldName;
      if (responseNames.has(responseName)) return false;
      responseNames.add(responseName);
      if (
        selection.selectionSet !== undefined &&
        !isSafeStaticApolloRepresentativeSelection(
          selection.selectionSet,
          fragments,
          budget,
          depth + 1,
          activeFragments,
          new Set(),
        )
      ) {
        return false;
      }
      continue;
    }
    if (selection?.kind === 'InlineFragment') {
      const typeName = selection.typeCondition?.name?.value;
      if (selection.typeCondition !== undefined && typeof typeName !== 'string') return false;
      if (
        representativeTypeName !== undefined &&
        typeof typeName === 'string' &&
        typeName !== representativeTypeName
      ) {
        continue;
      }
      if (
        !isSafeStaticApolloRepresentativeSelection(
          selection.selectionSet,
          fragments,
          budget,
          depth + 1,
          activeFragments,
          responseNames,
        )
      ) {
        return false;
      }
      continue;
    }
    if (selection?.kind !== 'FragmentSpread') return false;
    const fragmentName = selection.name?.value;
    if (typeof fragmentName !== 'string' || activeFragments.has(fragmentName)) return false;
    const fragment = fragments.get(fragmentName);
    if (
      fragment === undefined ||
      (Array.isArray(fragment.directives) && fragment.directives.length > 0)
    ) {
      return false;
    }
    const typeName = fragment.typeCondition?.name?.value;
    if (fragment.typeCondition !== undefined && typeof typeName !== 'string') return false;
    activeFragments.add(fragmentName);
    const safe = isSafeStaticApolloRepresentativeSelection(
      fragment.selectionSet,
      fragments,
      budget,
      depth + 1,
      activeFragments,
      responseNames,
    );
    activeFragments.delete(fragmentName);
    if (!safe) return false;
  }
  return true;
}

/** Builds one representative item only after the complete selection fits the shared limits. */
function createStaticApolloRepresentativeItem(
  selectionSet,
  fragments,
  budget,
  depth,
  activeFragments,
) {
  const validationBudget = { fields: budget.fields };
  if (
    !isSafeStaticApolloRepresentativeSelection(
      selectionSet,
      fragments,
      validationBudget,
      depth,
      new Set(activeFragments),
      new Set(),
    )
  ) {
    return undefined;
  }
  const item = {};
  const initialFieldCount = budget.fields;
  appendSelections(item, selectionSet, fragments, budget, depth, activeFragments);
  const representativeTypeName = readStaticApolloRepresentativeTypeName(selectionSet);
  if (representativeTypeName !== undefined && Object.hasOwn(item, '__typename')) {
    item.__typename = representativeTypeName;
  }
  return budget.fields - initialFieldCount === validationBudget.fields - initialFieldCount &&
    Object.keys(item).length > 0
    ? item
    : undefined;
}

/** Adds selections to one response object while enforcing field, depth, and fragment-cycle limits. */
function appendSelections(
  target,
  selectionSet,
  fragments,
  budget,
  depth,
  activeFragments,
  inheritedTypeName,
) {
  if (depth > MAX_STATIC_APOLLO_DEPTH || !Array.isArray(selectionSet?.selections)) {
    return;
  }

  const representativeTypeName =
    readStaticApolloRepresentativeTypeName(selectionSet) ?? inheritedTypeName;
  for (const selection of selectionSet.selections) {
    if (selection?.kind === 'Field') {
      if (budget.fields >= MAX_STATIC_APOLLO_FIELDS) {
        return;
      }
      budget.fields += 1;
      const fieldName = selection.name?.value;
      if (typeof fieldName !== 'string') {
        continue;
      }
      const responseName = selection.alias?.value ?? fieldName;
      if (looksLikeCollection(fieldName) && !isStaticApolloConnectionSelection(selection.selectionSet)) {
        const item = createStaticApolloRepresentativeItem(
          selection.selectionSet,
          fragments,
          budget,
          depth + 1,
          activeFragments,
        );
        target[responseName] = item === undefined ? [] : [item];
      } else if (selection.selectionSet !== undefined) {
        // GraphQL merges repeated fields with the same response name. Reuse the already-built
        // object so split companyInfo name/profileLogo selections retain both branches.
        const child = isRecord(target[responseName]) ? target[responseName] : {};
        appendSelections(child, selection.selectionSet, fragments, budget, depth + 1, activeFragments);
        target[responseName] = child;
      } else {
        target[responseName] = fieldName === '__typename' && representativeTypeName !== undefined
          ? representativeTypeName
          : createNeutralScalar(fieldName);
      }
      continue;
    }

    if (selection?.kind === 'InlineFragment') {
      const typeName = selection.typeCondition?.name?.value;
      if (
        representativeTypeName !== undefined &&
        typeof typeName === 'string' &&
        typeName !== representativeTypeName
      ) {
        continue;
      }
      appendSelections(
        target,
        selection.selectionSet,
        fragments,
        budget,
        depth + 1,
        activeFragments,
        typeof typeName === 'string' ? typeName : representativeTypeName,
      );
      continue;
    }

    if (selection?.kind !== 'FragmentSpread') {
      continue;
    }
    const fragmentName = selection.name?.value;
    if (typeof fragmentName !== 'string' || activeFragments.has(fragmentName)) {
      continue;
    }
    const fragment = fragments.get(fragmentName);
    if (fragment === undefined) {
      continue;
    }
    activeFragments.add(fragmentName);
    const fragmentTypeName = fragment.typeCondition?.name?.value;
    appendSelections(
      target,
      fragment.selectionSet,
      fragments,
      budget,
      depth + 1,
      activeFragments,
      representativeTypeName ??
        (typeof fragmentTypeName === 'string' ? fragmentTypeName : undefined),
    );
    activeFragments.delete(fragmentName);
  }
}

/** Builds a truthy GraphQL data root matching aliases, nested fields, and reachable fragments. */
function createStaticApolloData(document, operationName) {
  const operation = selectOperation(document, operationName);
  const data = {};
  appendSelections(
    data,
    operation?.selectionSet,
    collectFragments(document),
    { fields: 0 },
    0,
    new Set(),
  );
  return data;
}

/** Adds GraphQL selections to a JSON-safe type tree used by the editable payload generator. */
function appendSelectionShapes(target, selectionSet, fragments, budget, depth, activeFragments) {
  if (depth > MAX_STATIC_APOLLO_DEPTH || !Array.isArray(selectionSet?.selections)) return;
  for (const selection of selectionSet.selections) {
    if (selection?.kind === 'Field') {
      if (budget.fields >= MAX_STATIC_APOLLO_FIELDS) return;
      budget.fields += 1;
      const fieldName = selection.name?.value;
      if (typeof fieldName !== 'string') continue;
      const responseName = selection.alias?.value ?? fieldName;
      if (looksLikeCollection(fieldName) && !isStaticApolloConnectionSelection(selection.selectionSet)) {
        const previous = target[responseName];
        const items = selection.selectionSet === undefined
          ? { kind: 'unknown' }
          : previous?.kind === 'array' && previous.items?.kind === 'object' &&
              isRecord(previous.items.fields)
            ? previous.items
            : { fields: {}, kind: 'object' };
        if (selection.selectionSet !== undefined) {
          appendSelectionShapes(
            items.fields,
            selection.selectionSet,
            fragments,
            budget,
            depth + 1,
            activeFragments,
          );
        }
        target[responseName] = { items, kind: 'array' };
      } else if (selection.selectionSet !== undefined) {
        const previous = target[responseName];
        const fields = previous?.kind === 'object' && isRecord(previous.fields)
          ? previous.fields
          : {};
        appendSelectionShapes(fields, selection.selectionSet, fragments, budget, depth + 1, activeFragments);
        target[responseName] = { fields, kind: 'object' };
      } else {
        target[responseName] = createStaticApolloScalarShape(fieldName);
      }
      continue;
    }
    if (selection?.kind === 'InlineFragment') {
      appendSelectionShapes(target, selection.selectionSet, fragments, budget, depth + 1, activeFragments);
      continue;
    }
    if (selection?.kind !== 'FragmentSpread') continue;
    const fragmentName = selection.name?.value;
    if (typeof fragmentName !== 'string' || activeFragments.has(fragmentName)) continue;
    const fragment = fragments.get(fragmentName);
    if (fragment === undefined) continue;
    activeFragments.add(fragmentName);
    appendSelectionShapes(target, fragment.selectionSet, fragments, budget, depth + 1, activeFragments);
    activeFragments.delete(fragmentName);
  }
}

/** Creates an operation-local shape preserving aliases, nested objects, lists, and fragments. */
function createStaticApolloShape(document, operationName) {
  const operation = selectOperation(document, operationName);
  const fields = {};
  appendSelectionShapes(
    fields,
    operation?.selectionSet,
    collectFragments(document),
    { fields: 0 },
    0,
    new Set(),
  );
  return { fields, kind: 'object' };
}

/** Builds shared request metadata for editable Page Inspector GraphQL payloads. */
function createInspectorApolloRequestMetadata(operation, setupContext) {
  const seedData = createStaticApolloData(operation.query, operation.operationName);
  const selectedOperation = selectOperation(operation.query, operation.operationName);
  const operationKind = String(selectedOperation?.operation ?? 'query').toUpperCase();
  return {
    metadata: {
      evidence: 'GraphQL selection, aliases, fragments, and field-name inference',
      kind: 'graphql',
      label: (setupContext.documentName || 'GraphQL') + ' · ' + (operation.operationName || 'Anonymous operation'),
      method: operationKind,
      operationName: operation.operationName ?? '',
      shape: createStaticApolloShape(operation.query, operation.operationName),
      sourcePath: setupContext.documentName,
    },
    seedData,
  };
}

/** Delegates an Apollo operation to the stateful broker with payload-only API compatibility. */
function resolveInspectorApolloBackendResult(operation, setupContext) {
  const inspectorApi = globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')];
  const { metadata, seedData } = createInspectorApolloRequestMetadata(operation, setupContext);
  if (typeof inspectorApi?.resolveBackendRequest === 'function') {
    return inspectorApi.resolveBackendRequest(metadata, seedData, {
      body: operation.variables ?? {},
      rawUrl: 'graphql://' + (operation.operationName || 'anonymous'),
    });
  }
  if (typeof inspectorApi?.resolveDataPayload === 'function') {
    return {
      latencyMs: 0,
      payload: inspectorApi.resolveDataPayload(metadata, seedData),
      scenario: 'success',
      status: 200,
    };
  }
  return { latencyMs: 0, payload: seedData, scenario: 'success', status: 200 };
}

/** Waits for a virtual-backend latency before completing the terminating Apollo observable. */
async function waitForInspectorApolloBackendLatency(latencyMs) {
  if (!(latencyMs > 0) || typeof globalThis.setTimeout !== 'function') return;
  await new Promise((resolve) => globalThis.setTimeout(resolve, latencyMs));
}

/** Preserves explicit Apollo FetchResult objects and wraps plain setup data consistently. */
function normalizeFetchResult(configuredResult, operation) {
  if (configuredResult === undefined) {
    return { data: createStaticApolloData(operation.query, operation.operationName) };
  }
  if (
    isRecord(configuredResult) &&
    ('data' in configuredResult || 'errors' in configuredResult || 'extensions' in configuredResult)
  ) {
    return configuredResult;
  }
  return { data: configuredResult };
}

/** Resolves one operation through project setup or the bounded selection-shaped fallback. */
async function resolveStaticOperation(operation, configuration, setupContext) {
  const resolveOperation = isRecord(configuration) ? configuration.resolveOperation : undefined;
  if (typeof resolveOperation !== 'function') {
    const result = resolveInspectorApolloBackendResult(operation, setupContext);
    await waitForInspectorApolloBackendLatency(result.latencyMs);
    if (result.scenario === 'error') {
      return {
        data: null,
        errors: [{ message: 'Virtual backend returned HTTP ' + String(result.status) }],
      };
    }
    return { data: result.payload };
  }
  const configuredResult = await resolveOperation({
    documentName: setupContext.documentName,
    operationName: operation.operationName ?? '',
    query: operation.query,
    setupKind: setupContext.setupKind,
    variables: operation.variables ?? {},
  });
  return normalizeFetchResult(configuredResult, operation);
}

/** Creates a terminating observable link that cannot reach a backend transport. */
function createStaticApolloLink(configuration, setupContext, cache) {
  const registeredOperations = new WeakMap();
  return new ApolloCore.ApolloLink((operation) => new ApolloCore.Observable((observer) => {
    let subscribed = true;
    const document = operation?.query;
    const operationName = operation?.operationName ?? '';
    if (
      document !== null &&
      (typeof document === 'object' || typeof document === 'function')
    ) {
      const registeredNames = registeredOperations.get(document) ?? new Set();
      if (!registeredNames.has(operationName)) {
        registerStaticApolloPossibleTypes(cache, document, operationName);
        registeredNames.add(operationName);
        registeredOperations.set(document, registeredNames);
      }
    }
    void resolveStaticOperation(operation, configuration, setupContext).then(
      (result) => {
        if (!subscribed) {
          return;
        }
        observer.next(result);
        observer.complete();
      },
      (error) => {
        if (subscribed) {
          observer.error(error);
        }
      },
    );
    return () => {
      subscribed = false;
    };
  }));
}

/** Restores an optional cache seed without accepting a transport, URI, or application client. */
function createStaticApolloCache(configuration) {
  const cache = new ApolloCore.InMemoryCache({ addTypename: false });
  const initialState = isRecord(configuration) ? configuration.initialState : undefined;
  if (isRecord(initialState)) {
    cache.restore(initialState);
  }
  return cache;
}

/** Confirms that the installed project package exposes the APIs needed by the static boundary. */
function hasSupportedApolloRuntime() {
  return (
    typeof ApolloCore.ApolloClient === 'function' &&
    typeof ApolloCore.ApolloLink === 'function' &&
    typeof ApolloCore.InMemoryCache === 'function' &&
    typeof ApolloCore.Observable === 'function' &&
    typeof (ApolloReact.ApolloProvider ?? ApolloCore.ApolloProvider) === 'function'
  );
}

/**
 * Wraps an already-composed preview tree in one project-owned, memory-only Apollo provider.
 * Custom providers remain inside this outer boundary and therefore retain normal nearest-context
 * precedence. Passing apolloPreview=false from setup disables the automatic boundary.
 */
export function createApolloPreviewElement(children, options) {
  const configuration = options?.configuration;
  if (configuration === false) {
    previewRuntimeStatus = 'disabled by setup (apolloPreview=false)';
    return children;
  }
  if (!hasSupportedApolloRuntime()) {
    previewRuntimeStatus = 'unavailable: installed Apollo package lacks required client APIs';
    return children;
  }

  const cache = createStaticApolloCache(configuration);
  const client = new ApolloCore.ApolloClient({
    assumeImmutableResults: true,
    cache,
    connectToDevTools: false,
    defaultOptions: {
      mutate: { errorPolicy: 'all' },
      query: { errorPolicy: 'all', fetchPolicy: 'no-cache' },
      watchQuery: { errorPolicy: 'all', fetchPolicy: 'no-cache' },
    },
    devtools: { enabled: false },
    link: createStaticApolloLink(configuration, options ?? {}, cache),
    queryDeduplication: false,
  });
  const ApolloProvider = ApolloReact.ApolloProvider ?? ApolloCore.ApolloProvider;
  const inspectorApi = globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')];
  const inspectorDataActive = typeof inspectorApi?.resolveBackendRequest === 'function' ||
    typeof inspectorApi?.resolveDataPayload === 'function';
  previewRuntimeStatus = isRecord(configuration)
    ? 'active: memory-only client with setup-owned static overrides; network disabled'
    : inspectorDataActive
      ? 'active: memory-only client with editable selection-inferred preview payloads; network disabled'
    : 'active: memory-only client with selection-shaped static responses; network disabled';
  return React.createElement(ApolloProvider, { client }, children);
}
`;
}

/**
 * Normalizes Windows separators before embedding an absolute path as an ESM import specifier.
 *
 * @param modulePath Absolute file path selected by esbuild's browser-aware resolver.
 * @returns Slash-separated import path safe to JSON-encode into generated JavaScript.
 */
function normalizeImportPath(modulePath: string): string {
  return modulePath.replaceAll('\\', '/');
}
