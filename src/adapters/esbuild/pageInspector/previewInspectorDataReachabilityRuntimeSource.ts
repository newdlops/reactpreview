/**
 * Generates batched backend-payload completion for one authored page reachability corridor.
 *
 * The general data runtime owns request registration and explicit editor actions. This small adapter
 * owns only DFS convergence so deterministic automatic traversal can preserve every explicit user
 * payload while the broader, user-invoked Smart action can still complete a custom fixture.
 */

/** Creates browser source for one bounded reachability-key payload completion pass. */
export function createPreviewInspectorDataReachabilityRuntimeSource(): string {
  return String.raw`
/** Splits route/component identities and payload fields into comparable semantic words. */
function readPreviewInspectorReachabilityWords(values) {
  return new Set(
    (Array.isArray(values) ? values : [values])
      .flatMap((value) => String(value ?? '')
        .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
        .split(/[^A-Za-z\d]+/u))
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 1),
  );
}

/**
 * Extracts role evidence only from application identity containers, not arbitrary subject pages.
 *
 * A route such as CompanyOwnerApp -> LegalPartnerSelectPage describes an owner selecting a partner;
 * treating every word in that path as the current user's role incorrectly enables partner/staff
 * branches. App, layout, portal, shell, and provider identities are durable role boundaries across
 * frameworks, so their compound words are the conservative evidence used for generated access flags.
 */
function readPreviewInspectorReachabilityRoleWords(applicationPath) {
  const identityContainers = (Array.isArray(applicationPath) ? applicationPath : [])
    .filter((value) =>
      /(?:app|application|boundary|console|dashboard|layout|portal|provider|root|shell|workspace)$/iu.test(
        String(value ?? '').replace(/[^A-Za-z\d_$]/gu, ''),
      ),
    );
  return readPreviewInspectorReachabilityWords(identityContainers);
}

/**
 * Opens only boolean identity/role fields positively evidenced by the selected application path.
 * Error, loading, two-factor, and session flags retain the general least-disruptive value.
 */
function readPreviewInspectorReachabilityBoolean(fieldName, value, routeWords, roleRouteWords) {
  if (value !== false) return value;
  const normalizedName = String(fieldName).replaceAll('_', '').toLowerCase();
  if (normalizedName === 'isauthenticated') {
    const targetsAuthenticationScreen =
      routeWords.has('login') || routeWords.has('logout') ||
      routeWords.has('signin') || routeWords.has('signup') ||
      routeWords.has('authentication');
    return !targetsAuthenticationScreen;
  }
  // A role word inside a status flag is not role evidence: isStaffLoading must remain false even
  // when the selected route itself contains Staff. Enabling these flags usually selects a fallback.
  if (/error|fail|invalid|loading|pending|fetching|blocked|disabled|forbidden|redirect|concurrent|twofactor|expired|suspended/u.test(normalizedName)) {
    return value;
  }
  const rolePrefixes = /^(?:is|has|can)(.+)$/u.exec(normalizedName);
  if (rolePrefixes?.[1] === undefined) return value;
  const roleWords = readPreviewInspectorReachabilityWords(fieldName);
  roleWords.delete('is');
  roleWords.delete('has');
  roleWords.delete('can');
  const recognizedRoles = new Set([
    'admin', 'agent', 'employee', 'manager', 'member', 'owner', 'partner', 'staff', 'user',
  ]);
  const requiredRoles = [...roleWords].filter((word) => recognizedRoles.has(word));
  return requiredRoles.length > 0 && requiredRoles.every((word) => roleRouteWords.has(word))
    ? true
    : value;
}

/** Copies one generated payload while applying path-proven role values under fixed depth bounds. */
function guidePreviewInspectorPayloadTowardReachability(
  value,
  routeWords,
  roleRouteWords,
  fieldName = '',
  depth = 0,
) {
  if (depth > PREVIEW_INSPECTOR_DATA_DEPTH_LIMIT) return value;
  if (typeof value === 'boolean') {
    return readPreviewInspectorReachabilityBoolean(fieldName, value, routeWords, roleRouteWords);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      guidePreviewInspectorPayloadTowardReachability(
        item,
        routeWords,
        roleRouteWords,
        fieldName,
        depth + 1,
      ),
    );
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [
    name,
    blockedInspectorPropNames.has(name)
      ? child
      : guidePreviewInspectorPayloadTowardReachability(
          child,
          routeWords,
          roleRouteWords,
          name,
          depth + 1,
        ),
  ]));
}

/** Smart-fills observed requests once, optionally leaving every explicit payload untouched. */
function smartFillPreviewInspectorDataPayloadsForReachability(reachabilityKey, options = {}) {
  initializePreviewInspectorDataState();
  const preserveUserValues = options?.preserveUserValues === true;
  const applicationPath = options?.applicationPath ?? [];
  const routeWords = readPreviewInspectorReachabilityWords(applicationPath);
  const roleRouteWords = readPreviewInspectorReachabilityRoleWords(applicationPath);
  let changed = false;
  for (const record of previewInspectorSession.dataRequests.values()) {
    if (record.reachabilityKey !== reachabilityKey) continue;
    const current = previewInspectorSession.dataPayloadOverrides.get(record.id);
    if (preserveUserValues && current !== undefined) continue;
    const generated = generatePreviewInspectorDataValue(record.shape, '', 'smart');
    const minimum = guidePreviewInspectorPayloadTowardReachability(
      generated,
      routeWords,
      roleRouteWords,
    );
    const retainUserPayload = current?.mode === 'custom' || current?.mode === 'smart-custom';
    const payload = retainUserPayload
      ? completePreviewInspectorDataSmartPayload(current.payload, minimum)
      : minimum;
    const mode = retainUserPayload ? 'smart-custom' : 'smart';
    const payloadChanged = current?.mode !== mode ||
      stringifyPreviewInspectorProps(current?.payload) !== stringifyPreviewInspectorProps(payload);
    if (payloadChanged) {
      changed = applyPreviewInspectorDataPayloadOverride(record.id, payload, mode) || changed;
    }
  }
  if (changed) previewInspectorSession.dataAutoEnabled = true;
  return changed;
}
`;
}
