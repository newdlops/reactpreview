/**
 * Generates the data-only parent/child model for current-file JSX Boolean switches.
 *
 * Static render outcomes retain their outer-to-inner condition paths. A condition is considered a
 * parent only when it precedes the child on every path where that child occurs and every occurrence
 * requires the same parent branch. This conservative dominance rule makes `a && b && <Panel />`
 * appear as `a → b` without inventing a hierarchy for unrelated or ambiguous return branches.
 */

/**
 * Creates browser source that annotates and orders scenario records as a switch lineage.
 *
 * The generated helpers depend only on the static-outcome condition matcher and normalized scenario
 * records already present in the Inspector runtime. They do not evaluate project expressions or
 * retain AST/Fiber objects, and every traversal is bounded by the scenario inventory limit.
 *
 * @returns Plain JavaScript concatenated into the isolated Inspector runtime.
 */
export function createPreviewInspectorJsxScenarioLineageRuntimeSource(): string {
  return String.raw`
/** Converts one static outcome arm into the Boolean value required to follow that path. */
function readPreviewInspectorJsxScenarioBranchRequirement(condition) {
  const branch = condition?.branch ?? condition?.arm;
  return branch === 'truthy' || branch === true
    ? true
    : branch === 'falsy' || branch === false ? false : undefined;
}

/** Reads the stable serializable identity shared by lineage paths and rendered rows. */
function readPreviewInspectorJsxScenarioIdentity(record) {
  return String(
    record?.conditionTreeId ??
    record?.id ??
    createPreviewInspectorJsxScenarioStaticKey(record),
  );
}

/** Provides one deterministic source-order comparator for roots and sibling switches. */
function comparePreviewInspectorJsxScenarioSourceOrder(left, right) {
  return String(left?.sourcePath ?? '').localeCompare(String(right?.sourcePath ?? '')) ||
    (left?.line ?? 0) - (right?.line ?? 0) ||
    (left?.column ?? 0) - (right?.column ?? 0) ||
    String(left?.expression ?? '').localeCompare(String(right?.expression ?? ''));
}

/**
 * Joins one static path edge to its normalized table record.
 *
 * An exact group key handles static ordinary conditions. Logical-AND and live-only records fall back
 * to the shared source matcher, which requires source path, coordinates, and expression evidence.
 */
function findPreviewInspectorJsxScenarioLineageRecord(condition, records) {
  const staticKey = createPreviewInspectorJsxScenarioStaticKey(condition);
  const exact = records.find((record) =>
    record?.staticKey === staticKey ||
    createPreviewInspectorJsxScenarioStaticKey(record) === staticKey);
  if (exact !== undefined) return exact;
  return records.find((record) =>
    typeof matchesPreviewInspectorRenderOutcomeCondition === 'function' &&
    matchesPreviewInspectorRenderOutcomeCondition(condition, record));
}

/**
 * Collects every source-proven occurrence of a switch and its preceding path conditions.
 *
 * Repeated truthy/falsy outcomes intentionally contribute separate occurrences. The later
 * intersection therefore proves a parent only when it dominates every authored way to the child.
 */
function collectPreviewInspectorJsxScenarioLineageOccurrences(outcomes, records) {
  const occurrences = new Map();
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const path = [];
    const pathIds = new Set();
    for (
      const condition of Array.isArray(outcome?.conditions)
        ? outcome.conditions.slice(0, PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT)
        : []
    ) {
      if (condition?.kind === 'switch') continue;
      const requiredEnabled = readPreviewInspectorJsxScenarioBranchRequirement(condition);
      if (typeof requiredEnabled !== 'boolean') continue;
      const record = findPreviewInspectorJsxScenarioLineageRecord(condition, records);
      if (record === undefined) continue;
      const id = readPreviewInspectorJsxScenarioIdentity(record);
      if (pathIds.has(id)) continue;
      pathIds.add(id);
      path.push({ id, record, requiredEnabled });
    }
    for (let index = 0; index < path.length; index += 1) {
      const occurrence = path[index];
      const values = occurrences.get(occurrence.id) ?? [];
      values.push({
        ancestors: path.slice(0, index).map((ancestor) => ({
          id: ancestor.id,
          requiredEnabled: ancestor.requiredEnabled,
        })),
      });
      occurrences.set(occurrence.id, values);
    }
  }
  return occurrences;
}

/**
 * Chooses the nearest common dominating condition with one consistent required branch.
 *
 * Minimizing the worst distance to the child selects the immediate common parent even when sibling
 * return outcomes have unequal path lengths. Ties are resolved by source order for hot stability.
 */
function findPreviewInspectorJsxScenarioParentRelation(childId, occurrences, recordsById) {
  const childOccurrences = occurrences.get(childId) ?? [];
  if (childOccurrences.length === 0 || childOccurrences[0].ancestors.length === 0) {
    return undefined;
  }
  const commonIds = new Set(childOccurrences[0].ancestors.map((ancestor) => ancestor.id));
  for (const occurrence of childOccurrences.slice(1)) {
    const ids = new Set(occurrence.ancestors.map((ancestor) => ancestor.id));
    for (const candidateId of [...commonIds]) {
      if (!ids.has(candidateId)) commonIds.delete(candidateId);
    }
  }
  const candidates = [];
  for (const candidateId of commonIds) {
    const requirements = [];
    let maximumDistance = 0;
    let valid = candidateId !== childId && recordsById.has(candidateId);
    for (const occurrence of childOccurrences) {
      const ancestorIndex = occurrence.ancestors.findIndex(
        (ancestor) => ancestor.id === candidateId,
      );
      const ancestor = occurrence.ancestors[ancestorIndex];
      if (ancestor === undefined || typeof ancestor.requiredEnabled !== 'boolean') {
        valid = false;
        break;
      }
      requirements.push(ancestor.requiredEnabled);
      maximumDistance = Math.max(
        maximumDistance,
        occurrence.ancestors.length - ancestorIndex,
      );
    }
    if (
      !valid ||
      requirements.length === 0 ||
      requirements.some((value) => value !== requirements[0])
    ) {
      continue;
    }
    candidates.push({
      id: candidateId,
      maximumDistance,
      requiredEnabled: requirements[0],
    });
  }
  return candidates.sort((left, right) =>
    left.maximumDistance - right.maximumDistance ||
    comparePreviewInspectorJsxScenarioSourceOrder(
      recordsById.get(right.id),
      recordsById.get(left.id),
    ))[0];
}

/**
 * Annotates records with parent requirements, descendant counts, blocking state, and DFS order.
 *
 * A previously reached child may remain in the runtime registry after its parent is disabled. The
 * derived lineage-blocked flag makes the table report the actual render reachability rather than
 * presenting that stale child value as active.
 */
function attachPreviewInspectorJsxScenarioLineage(outcomes, records) {
  const sourceOrdered = [...records].sort(comparePreviewInspectorJsxScenarioSourceOrder);
  const recordsById = new Map(
    sourceOrdered.map((record) => [readPreviewInspectorJsxScenarioIdentity(record), record]),
  );
  const occurrences = collectPreviewInspectorJsxScenarioLineageOccurrences(
    outcomes,
    sourceOrdered,
  );
  const parentById = new Map();
  for (const childId of recordsById.keys()) {
    const relation = findPreviewInspectorJsxScenarioParentRelation(
      childId,
      occurrences,
      recordsById,
    );
    if (relation !== undefined) parentById.set(childId, relation);
  }
  const childrenById = new Map();
  for (const [childId, relation] of parentById) {
    const children = childrenById.get(relation.id) ?? [];
    children.push(childId);
    childrenById.set(relation.id, children);
  }
  for (const children of childrenById.values()) {
    children.sort((leftId, rightId) => comparePreviewInspectorJsxScenarioSourceOrder(
      recordsById.get(leftId),
      recordsById.get(rightId),
    ));
  }

  /** Counts transitive children with a cycle guard for malformed analyzer input. */
  const countDescendants = (id, visiting = new Set()) => {
    if (visiting.has(id)) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    return (childrenById.get(id) ?? []).reduce(
      (total, childId) => total + 1 + countDescendants(childId, nextVisiting),
      0,
    );
  };

  /** Finds the first currently unsatisfied ancestor needed to reach one switch. */
  const findBlockedAncestor = (id, visiting = new Set()) => {
    if (visiting.has(id)) return undefined;
    const relation = parentById.get(id);
    if (relation === undefined) return undefined;
    const parent = recordsById.get(relation.id);
    if (parent === undefined) return undefined;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const inherited = findBlockedAncestor(relation.id, nextVisiting);
    if (inherited !== undefined) return inherited;
    const parentReached = parent.reached !== false && typeof parent.id === 'string';
    return !parentReached || (parent.effectiveEnabled === true) !== relation.requiredEnabled
      ? parent
      : undefined;
  };

  /** Resolves a bounded depth without trusting the generated parent map to be acyclic. */
  const readDepth = (id, visiting = new Set()) => {
    if (visiting.has(id)) return 0;
    const relation = parentById.get(id);
    if (relation === undefined) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    return 1 + readDepth(relation.id, nextVisiting);
  };

  const annotatedById = new Map();
  for (const [id, record] of recordsById) {
    const relation = parentById.get(id);
    const parent = relation === undefined ? undefined : recordsById.get(relation.id);
    const blockedBy = findBlockedAncestor(id);
    annotatedById.set(id, {
      ...record,
      lineageBlocked: blockedBy !== undefined,
      lineageBlockedByExpression: blockedBy?.expression,
      lineageChildCount: (childrenById.get(id) ?? []).length,
      lineageDepth: Math.min(readDepth(id), PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT),
      lineageDescendantCount: countDescendants(id),
      lineageId: id,
      lineageParentExpression: parent?.expression,
      lineageParentId: relation?.id,
      lineageParentRequiredEnabled: relation?.requiredEnabled,
    });
  }

  const ordered = [];
  const visited = new Set();
  const appendLineage = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    const record = annotatedById.get(id);
    if (record !== undefined) ordered.push(record);
    for (const childId of childrenById.get(id) ?? []) appendLineage(childId);
  };
  for (const record of sourceOrdered) {
    const id = readPreviewInspectorJsxScenarioIdentity(record);
    if (!parentById.has(id)) appendLineage(id);
  }
  for (const record of sourceOrdered) {
    appendLineage(readPreviewInspectorJsxScenarioIdentity(record));
  }
  return ordered.slice(0, PREVIEW_INSPECTOR_JSX_SCENARIO_LIMIT);
}
`;
}
