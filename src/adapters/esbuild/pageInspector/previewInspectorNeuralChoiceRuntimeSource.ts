import { createPreviewInspectorNeuralChoicePathRuntimeSource } from './previewInspectorNeuralChoicePathRuntimeSource';
import { createPreviewInspectorNeuralPageGenerationRuntimeSource } from './previewInspectorNeuralPageGenerationRuntimeSource';

/** Generates the finite user-choice handoff shared by neural assistance and Inspector chrome. */

/** Creates browser source that exposes only source-proven values and their bounded apply path. */
export function createPreviewInspectorNeuralChoiceRuntimeSource(): string {
  const neuralChoicePathRuntimeSource = createPreviewInspectorNeuralChoicePathRuntimeSource();
  const neuralPageGenerationRuntimeSource =
    createPreviewInspectorNeuralPageGenerationRuntimeSource();
  return String.raw`
/** Produces a bounded anonymous key for one source-proven option domain. */
function hashPreviewInspectorNeuralFiniteChoiceSignature(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Reads one safe automatic domain; multiple domains remain an explicit combined user decision. */
function readPreviewInspectorNeuralFiniteChoiceDomain(node) {
  if (
    node?.blockerKind !== 'target-error' ||
    typeof readPreviewInspectorTargetFailurePropChoiceDomains !== 'function'
  ) return undefined;
  const domains = readPreviewInspectorTargetFailurePropChoiceDomains(node.blocker);
  if (!Array.isArray(domains) || domains.length !== 1) return undefined;
  const choice = domains[0];
  if (!Array.isArray(choice?.candidates) || choice.candidates.length < 2) return undefined;
  const currentCandidateIndex = choice.candidates.findIndex((candidate) =>
    typeof candidate === typeof choice.currentValue && Object.is(candidate, choice.currentValue),
  );
  if (
    choice.selectionOrigin === 'user-choice' ||
    (choice.userControlled === true && currentCandidateIndex >= 0 &&
      choice.selectionOrigin !== 'automatic-repair')
  ) return undefined;
  const signature = typeof createPreviewInspectorTargetFailurePropChoiceSignature === 'function'
    ? createPreviewInspectorTargetFailurePropChoiceSignature(node.blocker, choice)
    : JSON.stringify({
        candidates: choice.candidates,
        exportName: node.blocker?.exportName,
        path: choice.path,
      });
  if (typeof signature !== 'string') return undefined;
  return Object.freeze({ choice, currentCandidateIndex, signature });
}

/** Tracks option progress independently from changing blocker ids and error messages. */
function readPreviewInspectorNeuralFiniteChoiceProgress(node, record, initialize = false) {
  const domain = readPreviewInspectorNeuralFiniteChoiceDomain(node);
  if (domain === undefined || !(record?.finiteChoiceAttemptsBySignature instanceof Map)) {
    return undefined;
  }
  const activePathId = typeof previewInspectorSession.neuralActiveChoicePathId === 'string'
    ? previewInspectorSession.neuralActiveChoicePathId
    : '';
  const attemptSignature = activePathId.length > 0
    ? JSON.stringify([activePathId, domain.signature])
    : domain.signature;
  const retainedAttempts = record.finiteChoiceAttemptsBySignature.get(attemptSignature);
  const inferredAttempts = retainedAttempts === undefined &&
    domain.choice.selectionOrigin === 'automatic-repair' && domain.currentCandidateIndex >= 0
      ? domain.currentCandidateIndex + 1
      : 0;
  const attempts = Number.isSafeInteger(retainedAttempts)
    ? Math.max(0, retainedAttempts)
    : inferredAttempts;
  if (initialize && retainedAttempts === undefined && attempts > 0) {
    record.finiteChoiceAttemptsBySignature.set(attemptSignature, attempts);
  }
  const candidateCount = domain.choice.candidates.length;
  const choiceIndex = Math.min(attempts, candidateCount);
  const signatureHash = hashPreviewInspectorNeuralFiniteChoiceSignature(domain.signature);
  return Object.freeze({
    attempts,
    attemptSignature,
    candidateCount,
    candidateId: 'finite-choice:' + signatureHash + ':' + String(choiceIndex),
    choiceIndex,
    choiceOrdinal: choiceIndex + 1,
    exhausted: attempts >= candidateCount,
    path: domain.choice.path,
    signature: domain.signature,
  });
}

/** Keeps standalone exception corridors stable even when each option throws a different error. */
function createPreviewInspectorNeuralFiniteChoiceScopeKey(node) {
  const domain = readPreviewInspectorNeuralFiniteChoiceDomain(node);
  return domain === undefined
    ? undefined
    : 'active-finite-choice:' + hashPreviewInspectorNeuralFiniteChoiceSignature(domain.signature);
}

const PREVIEW_INSPECTOR_NEURAL_USER_CHOICE_LIMIT = 16;
const PREVIEW_INSPECTOR_NEURAL_PAGE_CHOICE_LIMIT = 24;
let previewInspectorNeuralPageChoiceElements = new Map();

/** Creates one stable UI identity without depending on an exception message that may change. */
function createPreviewInspectorNeuralUserChoiceIdentity(node) {
  const id = node?.id ?? node?.blocker?.id ?? node?.blocker?.key ?? node?.conditionId;
  return String(node?.blockerKind ?? node?.kind ?? 'choice') + ':' + String(id ?? 'unknown');
}

/** Reads a compact accessible label from one real preview control. */
function readPreviewInspectorNeuralPageChoiceLabel(element) {
  const normalize = (value) => typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, 120)
    : '';
  const labelledBy = normalize(element?.getAttribute?.('aria-labelledby'));
  const labelledText = labelledBy.length > 0
    ? labelledBy.split(/\s+/gu).map((id) =>
        normalize(globalThis.document?.getElementById?.(id)?.textContent)).filter(Boolean).join(' ')
    : '';
  const heading = element?.querySelector?.(
    '[data-choice-label],h1,h2,h3,h4,h5,h6,[class*="title"],strong',
  );
  const labels = Array.from(element?.labels ?? []).map((label) => normalize(label?.textContent))
    .filter(Boolean).join(' ');
  return [
    normalize(element?.getAttribute?.('aria-label')),
    labelledText,
    normalize(heading?.textContent),
    labels,
    normalize(element?.getAttribute?.('title')),
    normalize(element?.value),
    normalize(element?.textContent),
  ].find((value) => value.length > 0) ?? '';
}

/** Rejects hidden, disabled, covered, or Inspector-owned controls before offering a page action. */
function readPreviewInspectorNeuralPageChoiceGeometry(element) {
  if (
    element?.isConnected === false || element?.hidden === true ||
    element?.closest?.('[data-react-preview-inspector-ui]') !== null ||
    element?.closest?.('[aria-hidden="true"],[inert]') !== null ||
    element?.getAttribute?.('aria-hidden') === 'true' ||
    element?.getAttribute?.('aria-disabled') === 'true' ||
    element?.matches?.(':disabled') === true
  ) return undefined;
  try {
    const style = typeof globalThis.getComputedStyle === 'function'
      ? globalThis.getComputedStyle(element)
      : undefined;
    if (
      style?.display === 'none' || style?.visibility === 'hidden' || style?.pointerEvents === 'none' ||
      style?.opacity === '0'
    ) {
      return undefined;
    }
    const rect = element?.getBoundingClientRect?.();
    if (rect === undefined || rect.width < 2 || rect.height < 2) return undefined;
    const viewportHeight = Number(globalThis.innerHeight ?? Number.POSITIVE_INFINITY);
    const viewportWidth = Number(globalThis.innerWidth ?? Number.POSITIVE_INFINITY);
    const viewportVisible = rect.bottom > 0 && rect.right > 0 &&
      rect.top < viewportHeight && rect.left < viewportWidth;
    if (viewportVisible) {
      const centerX = Math.max(0, Math.min(viewportWidth - 1, rect.left + rect.width / 2));
      const centerY = Math.max(0, Math.min(viewportHeight - 1, rect.top + rect.height / 2));
      const hit = globalThis.document?.elementFromPoint?.(centerX, centerY);
      if (
        hit !== null && hit !== undefined && hit !== element &&
        element?.contains?.(hit) !== true && hit?.contains?.(element) !== true
      ) return undefined;
    }
    return {
      left: rect.left + Number(globalThis.scrollX ?? 0),
      top: rect.top + Number(globalThis.scrollY ?? 0),
      viewportVisible,
    };
  } catch {
    return undefined;
  }
}

/** Creates a structural family so one repeated authored choice group beats unrelated page chrome. */
function readPreviewInspectorNeuralPageChoiceFamily(element, role, inputType) {
  const normalize = (value) => typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, 160)
    : '';
  const tagName = String(element?.tagName ?? 'control').toLowerCase();
  const semanticKind = role === 'radio' || inputType === 'radio'
    ? 'radio'
    : role === 'option'
      ? 'option'
      : inputType === 'checkbox'
        ? 'checkbox'
        : role === 'button'
          ? 'role-button'
          : inputType === 'submit'
            ? 'submit'
            : 'button';
  const groupName = normalize(element?.getAttribute?.('name')) ||
    normalize(element?.getAttribute?.('aria-controls'));
  const rawClassName = normalize(element?.getAttribute?.('class')) ||
    normalize(typeof element?.className === 'string' ? element.className : '');
  const className = rawClassName.split(' ').filter(Boolean).sort().join('.');
  const familyKey = [semanticKind, tagName, groupName, className].join(':');
  const priority = semanticKind === 'radio' || semanticKind === 'option'
    ? 0
    : semanticKind === 'role-button'
      ? 1
      : semanticKind === 'checkbox'
        ? 2
        : semanticKind === 'button'
          ? 3
          : 4;
  return { familyKey, priority, semanticKind };
}

/** Keeps the strongest repeated option family instead of mixing in navigation and utility buttons. */
function selectPreviewInspectorNeuralPageChoiceFamily(controls) {
  const families = new Map();
  for (const control of controls) {
    const family = families.get(control.familyKey) ?? [];
    family.push(control);
    families.set(control.familyKey, family);
  }
  const repeatedFamilies = [...families.values()].filter((family) => family.length >= 2);
  repeatedFamilies.sort((left, right) =>
    left[0].priority - right[0].priority || right.length - left.length ||
      right.filter((control) => control.geometry.viewportVisible).length -
        left.filter((control) => control.geometry.viewportVisible).length ||
      left[0].geometry.top - right[0].geometry.top);
  if (repeatedFamilies.length > 0) return repeatedFamilies[0];

  const semanticFamilies = new Map();
  for (const control of controls) {
    const family = semanticFamilies.get(control.semanticKind) ?? [];
    family.push(control);
    semanticFamilies.set(control.semanticKind, family);
  }
  const repeatedSemanticFamilies = [...semanticFamilies.values()].filter((family) =>
    family.length >= 2,
  );
  repeatedSemanticFamilies.sort((left, right) =>
    left[0].priority - right[0].priority || right.length - left.length ||
      left[0].geometry.top - right[0].geometry.top);
  return repeatedSemanticFamilies[0] ?? controls.slice(0, 1);
}

/** Lists one complete authored option family, including choices below the current viewport. */
function readPreviewInspectorNeuralPageChoices() {
  const documentValue = globalThis.document;
  if (typeof documentValue?.querySelectorAll !== 'function') return [];
  const controls = [];
  const selector = [
    'button',
    'input[type="button"]',
    'input[type="checkbox"]',
    'input[type="radio"]',
    'input[type="submit"]',
    '[role="button"]',
    '[role="option"]',
    '[role="radio"]',
  ].join(',');
  for (const element of documentValue.querySelectorAll(selector)) {
    if (controls.length >= PREVIEW_INSPECTOR_NEURAL_PAGE_CHOICE_LIMIT * 3) break;
    const geometry = readPreviewInspectorNeuralPageChoiceGeometry(element);
    const label = geometry === undefined ? '' : readPreviewInspectorNeuralPageChoiceLabel(element);
    if (label.length === 0) continue;
    const role = element?.getAttribute?.('role') ?? '';
    const inputType = String(element?.getAttribute?.('type') ?? '').toLowerCase();
    const family = readPreviewInspectorNeuralPageChoiceFamily(element, role, inputType);
    controls.push({ element, geometry, inputType, label, role, ...family });
  }
  controls.sort((left, right) =>
    left.priority - right.priority || left.geometry.top - right.geometry.top ||
      left.geometry.left - right.geometry.left || left.label.localeCompare(right.label));
  const selectedControls = selectPreviewInspectorNeuralPageChoiceFamily(controls);
  const occurrenceBySignature = new Map();
  const nextElements = new Map();
  const choices = [];
  for (const control of selectedControls.slice(0, PREVIEW_INSPECTOR_NEURAL_PAGE_CHOICE_LIMIT)) {
    const tagName = String(control.element?.tagName ?? 'control').toLowerCase();
    const signature = [tagName, control.role, control.inputType, control.label].join(':');
    const occurrence = occurrenceBySignature.get(signature) ?? 0;
    occurrenceBySignature.set(signature, occurrence + 1);
    const id = 'page-control:' + hashPreviewInspectorNeuralFiniteChoiceSignature(
      signature + ':' + String(occurrence),
    );
    nextElements.set(id, control.element);
    choices.push(Object.freeze({
      actionKind: 'page-control',
      description: 'Activate this page option. The viewer will bring it into view if needed.',
      id,
      label: control.label,
      selected: control.element?.getAttribute?.('aria-checked') === 'true' ||
        control.element?.getAttribute?.('aria-pressed') === 'true' ||
        control.element?.checked === true,
    }));
  }
  previewInspectorNeuralPageChoiceElements = nextElements;
  return choices;
}

/** Activates an exact page option and fails closed when the DOM changed underneath it. */
function activatePreviewInspectorNeuralPageChoice(choiceId) {
  let element = previewInspectorNeuralPageChoiceElements.get(choiceId);
  if (element?.isConnected !== true) {
    readPreviewInspectorNeuralPageChoices();
    element = previewInspectorNeuralPageChoiceElements.get(choiceId);
  }
  if (element?.isConnected !== true || readPreviewInspectorNeuralPageChoiceGeometry(element) === undefined) {
    return false;
  }
  try {
    element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    element.focus?.({ preventScroll: true });
    element.click?.();
    return true;
  } catch {
    return false;
  }
}

/** Reads option exhaustion from the active corridor without allocating a retry record. */
function readPreviewInspectorCurrentNeuralFiniteChoiceProgress(node) {
  if (!(previewInspectorSession.automaticNeuralAssistanceByKey instanceof Map)) return undefined;
  const reachability = readPreviewInspectorAutomaticNeuralAssistanceCorridor();
  if (reachability === undefined) return undefined;
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
  const record = previewInspectorSession.automaticNeuralAssistanceByKey.get(key);
  return readPreviewInspectorNeuralFiniteChoiceProgress(node, record);
}

/** Creates a normalized source-proven props choice for one contained component exception. */
function createPreviewInspectorNeuralPropUserChoice(node) {
  if (node?.blockerKind !== 'target-error') return undefined;
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  const successfulPathSettled =
    typeof isPreviewInspectorNeuralSuccessCollectionSettled === 'function' &&
    isPreviewInspectorNeuralSuccessCollectionSettled(reachability);
  let choices = typeof readPreviewInspectorTargetFailurePropChoices === 'function'
    ? readPreviewInspectorTargetFailurePropChoices(node.blocker)
    : [];
  const finiteChoiceProgress = readPreviewInspectorCurrentNeuralFiniteChoiceProgress(node);
  if (
    choices.length === 0 && finiteChoiceProgress?.exhausted === true &&
    typeof readPreviewInspectorTargetFailurePropChoiceDomains === 'function'
  ) {
    choices = readPreviewInspectorTargetFailurePropChoiceDomains(node.blocker);
  }
  if (choices.length === 0) return undefined;
  const automaticMutation = typeof createPreviewInspectorFinitePropChoiceMutation === 'function'
    ? createPreviewInspectorFinitePropChoiceMutation(node.blocker)
    : undefined;
  if (
    automaticMutation !== undefined && finiteChoiceProgress?.exhausted !== true &&
    !successfulPathSettled
  ) return undefined;
  const choiceRecords = Object.freeze(choices.map((choice) => Object.freeze({
    candidates: Object.freeze([...choice.candidates]),
    currentValue: choice.currentValue,
    kind: choice.kind,
    path: choice.path,
    selectionOrigin: choice.selectionOrigin,
    userControlled: choice.userControlled === true,
  })));
  return Object.freeze({
    choiceKind: 'source-proven-prop',
    choiceRecords,
    automaticAttemptCount: finiteChoiceProgress?.attempts,
    automaticCandidateCount: finiteChoiceProgress?.candidateCount,
    exportName: node.blocker?.exportName,
    id: createPreviewInspectorNeuralUserChoiceIdentity(node),
    node,
    path: choices.length === 1 ? choices[0].path : undefined,
    title: finiteChoiceProgress?.exhausted === true
      ? 'Every source-proven value for ' + choices[0].path + ' was tested. Choose the value to keep.'
      : choices.length === 1
      ? 'Choose a source-proven value for ' + choices[0].path + '.'
      : 'Choose values for ' + String(choices.length) + ' source-proven component options.',
  });
}

/** Creates one safe action list for a choice-classified non-prop blocker. */
function createPreviewInspectorNeuralActionUserChoice(node) {
  const id = createPreviewInspectorNeuralUserChoiceIdentity(node);
  if (node?.blockerKind === 'render-condition') {
    const condition = node.condition ?? node.blocker;
    const requiresAuthoredState = condition?.requiresAuthoredState === true;
    const pageChoices = requiresAuthoredState ? readPreviewInspectorNeuralPageChoices() : [];
    const branchChoices = !requiresAuthoredState && typeof condition?.id === 'string'
      ? [
          Object.freeze({
            actionKind: 'condition-override',
            conditionId: condition.id,
            description: 'Pin the source-authored ' + String(condition.truthyLabel ?? 'true') + ' branch.',
            id: 'truthy',
            label: 'Show ' + String(condition.truthyLabel ?? 'true branch'),
            selected: condition.override === true,
            value: true,
          }),
          Object.freeze({
            actionKind: 'condition-override',
            conditionId: condition.id,
            description: 'Pin the source-authored ' + String(condition.falsyLabel ?? 'false') + ' branch.',
            id: 'falsy',
            label: 'Show ' + String(condition.falsyLabel ?? 'false branch'),
            selected: condition.override === false,
            value: false,
          }),
          ...(
            typeof condition.override === 'boolean' || typeof condition.autoOverride === 'boolean'
              ? [Object.freeze({
                  actionKind: 'condition-authored',
                  conditionId: condition.id,
                  description: 'Remove the preview override and follow the application value again.',
                  id: 'authored',
                  label: 'Use authored value',
                })]
              : []
          ),
        ]
      : [];
    const candidates = requiresAuthoredState ? pageChoices : branchChoices;
    const expression = String(condition?.expression ?? node?.name ?? 'Render condition');
    return Object.freeze({
      choiceKind: 'render-condition',
      choiceRecords: Object.freeze(candidates.length === 0 ? [] : [Object.freeze({
        candidates: Object.freeze(candidates),
        currentValue: requiresAuthoredState
          ? pageChoices.find((candidate) => candidate.selected === true)?.label
          : condition.effectiveEnabled === true
            ? condition.truthyLabel
            : condition.falsyLabel,
        kind: requiresAuthoredState ? 'page-control' : 'branch',
        path: requiresAuthoredState ? 'Page options' : expression,
      })]),
      id,
      node,
      title: requiresAuthoredState
        ? candidates.length > 0
          ? 'Choose from ' + String(candidates.length) + ' page option(s).'
          : 'Choose an option in the rendered page to continue.'
        : 'Choose which source-authored branch should stay visible.',
    });
  }
  if (node?.blockerKind === 'target-reachability') {
    const selectableNode = node.id === undefined &&
      typeof createPreviewInspectorTargetReachabilityTreeNode === 'function'
        ? createPreviewInspectorTargetReachabilityTreeNode(node.blocker)
        : node;
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const possibilities = typeof readPreviewInspectorPageContextPossibilities === 'function'
      ? readPreviewInspectorPageContextPossibilities(descriptor)
      : [];
    return Object.freeze({
      choiceKind: 'target-reachability',
      choiceRecords: Object.freeze([]),
      id,
      node: selectableNode,
      surface: 'page-context',
      title: possibilities.length > 0
        ? 'Choose one of ' + String(possibilities.length) +
          ' ranked source-proven paths in Page context.'
        : 'Review the selected path in Page context.',
    });
  }
  if (node?.blockerKind === 'runtime-fallback') {
    const fallbackId = node.blocker?.id;
    const candidates = typeof fallbackId === 'string' ? [
      Object.freeze({
        actionKind: 'runtime-smart', fallbackId, id: 'smart', label: 'Smart fill minimum',
        description: 'Generate only the value shape proven by downstream reads.',
      }),
      Object.freeze({
        actionKind: 'runtime-auto', fallbackId, id: 'auto', label: 'Auto pass',
        description: 'Use the viewer generated render-only value.',
      }),
    ] : [];
    return Object.freeze({
      choiceKind: 'runtime-fallback',
      choiceRecords: Object.freeze(candidates.length === 0 ? [] : [Object.freeze({
        candidates: Object.freeze(candidates),
        currentValue: node.blocker?.mode,
        kind: 'runtime-value',
        path: String(node.blocker?.hookName ?? 'Runtime value'),
      })]),
      id,
      node,
      title: 'Choose a bounded render-only value strategy.',
    });
  }
  if (node?.blockerKind === 'data-request') {
    const requestId = node.blocker?.id;
    const candidates = typeof requestId === 'string' ? [
      Object.freeze({
        actionKind: 'data-smart', requestId, id: 'smart', label: 'Smart fill minimum',
        description: 'Generate only the response fields proven by the rendered component.',
      }),
      Object.freeze({
        actionKind: 'data-auto', requestId, id: 'auto', label: 'Use Auto',
        description: 'Return to inferred automatic payload generation.',
      }),
      Object.freeze({
        actionKind: 'data-lorem', requestId, id: 'lorem', label: 'Generate Lorem',
        description: 'Generate deterministic display values while retaining inferred field types.',
      }),
    ] : [];
    return Object.freeze({
      choiceKind: 'data-request',
      choiceRecords: Object.freeze(candidates.length === 0 ? [] : [Object.freeze({
        candidates: Object.freeze(candidates),
        currentValue: node.blocker?.mode,
        kind: 'data-value',
        path: String(node.blocker?.label ?? 'Backend payload'),
      })]),
      id,
      node,
      title: 'Choose a local payload strategy for this request.',
    });
  }
  return undefined;
}

/** Keeps source-proven branch options visible after their first verified render is checkpointed. */
function readPreviewInspectorNeuralRetainedUserChoiceCandidates(reachability) {
  if (
    typeof isPreviewInspectorNeuralSuccessCollectionSettled !== 'function' ||
    !isPreviewInspectorNeuralSuccessCollectionSettled(reachability) ||
    typeof createPreviewInspectorAutomaticNeuralAssistanceKey !== 'function'
  ) return [];
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  return record?.retainedFiniteChoiceBlockers instanceof Map
    ? [...record.retainedFiniteChoiceBlockers.values()]
    : [];
}

/** Returns every semantic choice after deterministic viewer-owned repair has no safe answer. */
function readPreviewInspectorNeuralUserChoices(options = {}) {
  if (
    options.explicitOnly === true && options.includePending !== true &&
    previewInspectorSession.neuralAssistancePending === true &&
    previewInspectorSession.neuralAssistanceRevision === previewEntryRevision
  ) return Object.freeze([]);
  const blockers = readPreviewInspectorNeuralAssistanceBlockers();
  const reachability = readPreviewInspectorNeuralAssistanceReachability();
  const activeCandidates = readPreviewInspectorNeuralAssistanceCandidates(blockers, reachability);
  const seenCandidates = new Set(activeCandidates.map((node) =>
    createPreviewInspectorNeuralUserChoiceIdentity(node)));
  const candidates = [
    ...activeCandidates,
    ...readPreviewInspectorNeuralRetainedUserChoiceCandidates(reachability).filter((node) => {
      const identity = createPreviewInspectorNeuralUserChoiceIdentity(node);
      if (seenCandidates.has(identity)) return false;
      seenCandidates.add(identity);
      return true;
    }),
  ];
  const results = [];
  for (const node of candidates) {
    const propChoice = createPreviewInspectorNeuralPropUserChoice(node);
    if (propChoice !== undefined) {
      results.push(propChoice);
      if (results.length >= PREVIEW_INSPECTOR_NEURAL_USER_CHOICE_LIMIT) break;
      continue;
    }
    if (![
      'data-request',
      'render-condition',
      'runtime-fallback',
      'target-reachability',
    ].includes(node?.blockerKind)) continue;
    const resolutionKind = typeof readPreviewInspectorResolutionKind === 'function'
      ? readPreviewInspectorResolutionKind(node)
      : undefined;
    if (resolutionKind !== undefined && resolutionKind !== 'choice') continue;
    if (options.explicitOnly === true && resolutionKind !== 'choice') continue;
    if (
      node.blockerKind === 'target-reachability' && results.some((choice) =>
        choice.choiceKind === 'render-condition' &&
        choice.node?.condition?.requiresAuthoredState === true)
    ) continue;
    const actionChoice = createPreviewInspectorNeuralActionUserChoice(node);
    if (actionChoice !== undefined) results.push(actionChoice);
    if (results.length >= PREVIEW_INSPECTOR_NEURAL_USER_CHOICE_LIMIT) break;
  }
  return Object.freeze(results);
}

/** Retains the original first-choice API for status, navigation, and host compatibility. */
function readPreviewInspectorNeuralUserChoice(options = {}) {
  return readPreviewInspectorNeuralUserChoices(options)[0];
}

/** Lets automatic work continue beside waiting choices while preserving a complete handoff list. */
function readPreviewInspectorNeuralChoiceAvailabilityState(blockers, reachability, learningStatus) {
  const explicitChoices = readPreviewInspectorNeuralUserChoices({ explicitOnly: true });
  const deferredChoices = learningStatus?.phase === 'needs-choice' && explicitChoices.length === 0
    ? readPreviewInspectorNeuralUserChoices()
    : [];
  const userChoices = explicitChoices.length > 0 ? explicitChoices : deferredChoices;
  const userChoice = userChoices[0] ?? (
    learningStatus?.phase === 'needs-choice' ? readPreviewInspectorNeuralUserChoice() : undefined
  );
  const choiceNodeIdentities = new Set(userChoices.map((choice) =>
    createPreviewInspectorNeuralUserChoiceIdentity(choice.node),
  ));
  const candidates = readPreviewInspectorNeuralAssistanceCandidates(blockers, reachability);
  const automaticWorkAvailable = candidates.some((node) => {
    if (choiceNodeIdentities.has(createPreviewInspectorNeuralUserChoiceIdentity(node))) return false;
    const resolutionKind = typeof readPreviewInspectorResolutionKind === 'function'
      ? readPreviewInspectorResolutionKind(node)
      : 'automatic';
    return resolutionKind !== 'choice' && !(
      resolutionKind === 'error' &&
      typeof hasPreviewInspectorResolutionEffortExhausted === 'function' &&
      hasPreviewInspectorResolutionEffortExhausted(node)
    );
  });
  return Object.freeze({ automaticWorkAvailable, userChoice, userChoices });
}

/** Validates and returns one selected candidate per path without accepting arbitrary payloads. */
function readPreviewInspectorNeuralUserChoiceSelections(choice, selectedIndexes) {
  if (
    !Array.isArray(choice?.choiceRecords) || choice.choiceRecords.length === 0 ||
    selectedIndexes === null || typeof selectedIndexes !== 'object'
  ) return undefined;
  const selections = [];
  for (const choiceRecord of choice.choiceRecords) {
    if (!Object.prototype.hasOwnProperty.call(selectedIndexes, choiceRecord.path)) return false;
    const index = Number(selectedIndexes[choiceRecord.path]);
    if (!Number.isInteger(index) || index < 0 || index >= choiceRecord.candidates.length) {
      return false;
    }
    selections.push({ choiceRecord, selectedValue: choiceRecord.candidates[index] });
  }
  return selections;
}

/** Announces one explicit selection as an applying state while the preview remounts. */
function setPreviewInspectorNeuralApplyingChoiceStatus(labelReason) {
  const updates = typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
    ? readPreviewInspectorNeuralLearningModelUpdates()
    : 0;
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      labelReason,
      phase: 'applying',
      updates,
    });
  } else if (typeof notifyPreviewInspector === 'function') {
    notifyPreviewInspector();
  }
}

/** Applies one explicit value per ambiguous source path, then remounts the export exactly once. */
function applyPreviewInspectorNeuralPropUserChoices(choice, selections) {
  if (
    typeof choice?.exportName !== 'string' || choice.exportName.length === 0 ||
    typeof applyPreviewInspectorSmartPropChoice !== 'function'
  ) return false;
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    const applied = applyPreviewInspectorSmartPropChoice(
      choice.exportName,
      selection.choiceRecord,
      selection.selectedValue,
      index === selections.length - 1,
    );
    if (applied === undefined) return false;
  }
  setPreviewInspectorNeuralApplyingChoiceStatus(
    selections.map((selection) => selection.choiceRecord.path).join(', '),
  );
  return true;
}

/** Applies one normalized viewer/page action from the currently admitted choice record. */
function applyPreviewInspectorNeuralActionUserChoice(choice, selection) {
  const candidate = selection?.selectedValue;
  const node = choice?.node;
  if (candidate === null || typeof candidate !== 'object') return false;
  let applied = false;
  if (
    candidate.actionKind === 'condition-override' &&
    candidate.conditionId === (node?.condition ?? node?.blocker)?.id &&
    typeof setPreviewInspectorRenderConditionOverride === 'function'
  ) {
    setPreviewInspectorRenderConditionOverride(candidate.conditionId, candidate.value);
    applied = true;
  } else if (
    candidate.actionKind === 'condition-authored' &&
    candidate.conditionId === (node?.condition ?? node?.blocker)?.id &&
    typeof resetPreviewInspectorRenderConditionOverride === 'function'
  ) {
    resetPreviewInspectorRenderConditionOverride(candidate.conditionId);
    applied = true;
  } else if (candidate.actionKind === 'page-control') {
    applied = activatePreviewInspectorNeuralPageChoice(candidate.id);
  } else if (
    candidate.actionKind === 'runtime-smart' && candidate.fallbackId === node?.blocker?.id &&
    typeof smartFillPreviewInspectorRuntimeFallback === 'function'
  ) {
    applied = smartFillPreviewInspectorRuntimeFallback(candidate.fallbackId) !== false;
  } else if (
    candidate.actionKind === 'runtime-auto' && candidate.fallbackId === node?.blocker?.id &&
    typeof autoPassPreviewInspectorRuntimeFallback === 'function'
  ) {
    applied = autoPassPreviewInspectorRuntimeFallback(candidate.fallbackId) !== false;
  } else if (
    candidate.actionKind === 'data-smart' && candidate.requestId === node?.blocker?.id &&
    typeof smartFillPreviewInspectorDataPayload === 'function'
  ) {
    applied = smartFillPreviewInspectorDataPayload(candidate.requestId) !== false;
  } else if (
    candidate.actionKind === 'data-auto' && candidate.requestId === node?.blocker?.id &&
    typeof resetPreviewInspectorDataPayload === 'function' &&
    typeof setPreviewInspectorDataAutoEnabled === 'function'
  ) {
    resetPreviewInspectorDataPayload(candidate.requestId);
    setPreviewInspectorDataAutoEnabled(true);
    applied = true;
  } else if (
    candidate.actionKind === 'data-lorem' && candidate.requestId === node?.blocker?.id &&
    typeof generatePreviewInspectorLoremPayload === 'function'
  ) {
    applied = generatePreviewInspectorLoremPayload(candidate.requestId) !== false;
  }
  if (applied) {
    setPreviewInspectorNeuralApplyingChoiceStatus(
      String(candidate.label ?? selection.choiceRecord?.path ?? choice.choiceKind),
    );
  }
  return applied;
}

/** Applies one complete choice group; other listed blockers are re-read after its remount. */
function applyPreviewInspectorNeuralUserChoices(choice, selectedIndexes, options = {}) {
  const selections = readPreviewInspectorNeuralUserChoiceSelections(choice, selectedIndexes);
  if (!Array.isArray(selections) || selections.length === 0) return false;
  if (
    options?.recordSelection !== false &&
    typeof recordPreviewInspectorNeuralChoicePathSelection === 'function'
  ) {
    recordPreviewInspectorNeuralChoicePathSelection(choice, selections, {
      pathId: options?.pathId,
    });
  }
  const applied = choice?.choiceKind === 'source-proven-prop'
    ? applyPreviewInspectorNeuralPropUserChoices(choice, selections)
    : selections.length === 1
      ? applyPreviewInspectorNeuralActionUserChoice(choice, selections[0])
      : false;
  if (!applied && typeof cancelPreviewInspectorNeuralChoicePathSelection === 'function') {
    cancelPreviewInspectorNeuralChoicePathSelection();
  }
  return applied;
}

/** Opens the existing blocker editor without inventing a parallel choice dialog. */
function revealPreviewInspectorNeuralUserChoice(choice = readPreviewInspectorNeuralUserChoice()) {
  if (choice?.surface === 'page-context') {
    if (typeof focusPreviewInspectorPageChoice !== 'function') return false;
    focusPreviewInspectorPageChoice();
    return true;
  }
  const node = choice?.node;
  const nodeId = node?.id ?? node?.blocker?.id ?? node?.blocker?.key;
  if (node === undefined || typeof nodeId !== 'string' || nodeId.length === 0) return false;
  if (typeof requestPreviewInspectorTreeReveal === 'function') {
    requestPreviewInspectorTreeReveal(nodeId);
  }
  if (typeof selectPreviewInspectorUiNode === 'function') {
    selectPreviewInspectorUiNode({ ...node, id: nodeId }, true);
  }
  return true;
}

/** Marks a clean handoff without using the warning/error phase reserved for resolver failures. */
function setPreviewInspectorNeuralNeedsChoiceStatus(action = 'user-choice-required') {
  const choices = readPreviewInspectorNeuralUserChoices();
  const choice = choices[0];
  if (choice === undefined) return false;
  const updates = typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
    ? readPreviewInspectorNeuralLearningModelUpdates()
    : 0;
  if (typeof setPreviewInspectorNeuralLearningStatus === 'function') {
    setPreviewInspectorNeuralLearningStatus({
      activeCount: 0,
      labelReason: choices.length > 1
        ? String(choices.length) + ' choices'
        : choice.path ?? action,
      phase: 'needs-choice',
      updates,
    });
  } else if (typeof notifyPreviewInspector === 'function') {
    notifyPreviewInspector();
  }
  return true;
}
${neuralChoicePathRuntimeSource}
${neuralPageGenerationRuntimeSource}
`;
}
