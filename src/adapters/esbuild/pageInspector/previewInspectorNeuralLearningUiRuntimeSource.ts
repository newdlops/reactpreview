/** Generates the compact local-model progress indicator rendered in Inspector chrome. */

/** Creates presentation-only browser source for the toolbar learning status. */
export function createPreviewInspectorNeuralLearningUiRuntimeSource(): string {
  return String.raw`
/** Announces only real model activity retained by the renderer-owned learning status runtime. */
function PreviewInspectorNeuralLearningStatus() {
  const status = typeof readPreviewInspectorNeuralLearningStatus === 'function'
    ? readPreviewInspectorNeuralLearningStatus()
    : undefined;
  if (status === undefined) return null;
  const reportedPhase = [
    'applied',
    'applying',
    'learning',
    'needs-choice',
    'paused',
    'unchanged',
    'yielded',
  ].includes(status.phase)
    ? status.phase
    : 'learned';
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  const targetRendered = reachability?.targetHasOutput === true;
  const refining = targetRendered &&
    typeof hasPreviewInspectorNeuralPageGenerationWork === 'function' &&
    hasPreviewInspectorNeuralPageGenerationWork();
  const verifying = reportedPhase === 'applying' && status.verifying === true;
  const collecting = reportedPhase === 'applying' && status.collecting === true && !verifying;
  const restoring = reportedPhase === 'applying' && status.restoring === true;
  const phase = targetRendered && !refining && reportedPhase === 'needs-choice'
    ? 'applied'
    : targetRendered && !refining && reportedPhase === 'applying' &&
        !collecting && !restoring && !verifying
      ? 'applied'
      : reportedPhase;
  const updates = Number.isSafeInteger(status.updates) && status.updates >= 0
    ? status.updates
    : 0;
  const testingFiniteChoice = phase === 'applying' &&
    !collecting && !restoring && !verifying &&
    Number.isSafeInteger(status.choiceAttempt) && Number.isSafeInteger(status.choiceCount) &&
    status.choiceAttempt > 0 && status.choiceCount >= status.choiceAttempt;
  const successCount = Number.isSafeInteger(status.successCount) && status.successCount > 0
    ? status.successCount
    : 0;
  const label = phase === 'learning' || phase === 'applying'
    ? phase === 'learning'
      ? 'Neural learning…'
      : verifying
        ? 'Verifying output…'
        : restoring
        ? 'Restoring best path…'
        : collecting
          ? 'Collecting paths · ' + String(successCount) + ' verified'
      : testingFiniteChoice
        ? 'Testing choice ' + String(status.choiceAttempt) + ' of ' +
          String(status.choiceCount) + '…'
        : refining ? 'Optimizing page path…' : 'Neural testing one path…'
    : phase === 'paused'
      ? 'Neural could not continue'
      : phase === 'yielded'
        ? 'Neural yielded · Continue'
      : phase === 'needs-choice'
        ? 'Your choice is needed'
      : phase === 'unchanged'
        ? 'Neural checked · ' + String(updates)
      : phase === 'applied'
          ? 'Neural applied · ' + String(updates) +
            (successCount > 0 ? ' · ' + String(successCount) + ' paths' : '')
          : 'Neural learned · ' + String(updates);
  const title = phase === 'learning' || phase === 'applying'
      ? phase === 'learning'
      ? 'The local neural model is learning from verified preview evidence.'
      : verifying
        ? 'Visible target output is being checked across delayed observations before this path is learned or saved.'
        : restoring
        ? 'The bounded sweep is complete. The viewer is restoring its best verified rendered path.'
        : collecting
          ? 'A rendered path is checkpointed. The viewer is testing the remaining finite source-proven paths and will restore the best verified result.'
      : testingFiniteChoice
        ? 'The viewer is testing source-proven choice ' + String(status.choiceAttempt) +
          ' of ' + String(status.choiceCount) +
          ' and will keep it only if the selected file renders.'
        : refining
          ? 'Visible output is checkpointed while the local model settles one remaining viewer-owned choice per render.'
          : 'The local neural model is keeping one admitted path fixed while the verifier checks it.'
    : phase === 'paused'
      ? 'The local neural model stopped after a resolver error. Open the active blocker for details.'
      : phase === 'yielded'
        ? 'The viewer paused after one bounded work slice to keep this window and the other preview tabs responsive. Run blocker resolution again to continue.'
      : phase === 'needs-choice'
        ? 'The safe automatic paths are exhausted. Review the highlighted source-proven choice.'
      : phase === 'unchanged'
        ? 'The local neural model re-evaluated this preview without changing a value.'
      : 'The local neural model automatically uses ' + String(updates) + ' verified update' +
        (updates === 1 ? '.' : 's.');
  return React.createElement(
    'span',
    {
      'aria-atomic': 'true',
      'aria-label': title,
      'aria-live': 'polite',
      className: 'rpi-neural-status',
      'data-phase': phase,
      role: 'status',
      title,
    },
    React.createElement(
      'span',
      { 'aria-hidden': 'true', className: 'rpi-neural-status-indicator' },
      phase === 'learned' || phase === 'applied' || phase === 'unchanged'
        ? '✓'
        : phase === 'needs-choice' ? '?' : phase === 'paused' ? '×' : phase === 'yielded' ? 'Ⅱ' : '',
    ),
    React.createElement('span', { className: 'rpi-neural-status-label' }, label),
  );
}

/** Formats one source-proven scalar without hiding its primitive type. */
function formatPreviewInspectorNeuralChoiceValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.label === 'string') {
    return value.label;
  }
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Creates a collision-safe state key because several active blockers may expose the same path. */
function createPreviewInspectorNeuralChoiceSelectionKey(choice, choiceIndex, record) {
  return String(choice?.id ?? choice?.choiceKind ?? 'choice-' + String(choiceIndex)) + ':' +
    String(record?.path ?? 'value');
}

/** Labels the apply action according to the concrete decision rather than the model mechanism. */
function formatPreviewInspectorNeuralChoiceApplyLabel(choice, recordCount) {
  if (choice?.choiceKind === 'source-proven-prop') {
    return recordCount > 1 ? 'Apply choices' : 'Apply choice';
  }
  if (choice?.choiceKind === 'render-condition') {
    return choice.choiceRecords?.[0]?.kind === 'page-control' ? 'Continue on page' : 'Apply branch';
  }
  if (choice?.choiceKind === 'target-reachability') return 'Load page path';
  return 'Apply strategy';
}

/** Explains where a choice came from without implying that the neural model invented it. */
function describePreviewInspectorNeuralChoiceProvenance(choice) {
  if (choice?.choiceKind === 'source-proven-prop') {
    return 'Candidates come from authored source branches.';
  }
  if (choice?.choiceKind === 'render-condition') {
    return choice.choiceRecords?.[0]?.kind === 'page-control'
      ? 'These controls were discovered in the rendered page, including options below the viewport.'
      : 'Branches come from the authored JSX condition.';
  }
  if (choice?.choiceKind === 'target-reachability') {
    return 'Paths come from statically proven consuming pages.';
  }
  return 'Values stay inside this preview and never change project data.';
}

/** Maps only the currently visible portion of one derived path back to concrete choice controls. */
function readPreviewInspectorNeuralChoicePathSelections(path, choices) {
  const selections = {};
  for (const step of (Array.isArray(path?.steps) ? path.steps : [])) {
    if (
      step?.current !== true || !Number.isInteger(step.candidateIndex) || step.candidateIndex < 0
    ) continue;
    const preferredChoiceIndex = Number.isInteger(step.choiceIndex) ? step.choiceIndex : -1;
    const preferredChoice = choices[preferredChoiceIndex];
    const choiceIndex = String(
      preferredChoice?.id ?? preferredChoice?.choiceKind ?? preferredChoiceIndex,
    ) === step.choiceId
      ? preferredChoiceIndex
      : choices.findIndex((choice, index) =>
          String(choice?.id ?? choice?.choiceKind ?? index) === step.choiceId);
    const choice = choices[choiceIndex];
    const record = choice?.choiceRecords?.find((item) => item?.path === step.path);
    const candidate = record?.candidates?.[step.candidateIndex];
    if (
      choice === undefined || record === undefined ||
      step.candidateIndex >= record.candidates.length ||
      (candidate !== null && typeof candidate === 'object' && candidate.disabled === true)
    ) continue;
    selections[createPreviewInspectorNeuralChoiceSelectionKey(choice, choiceIndex, record)] =
      step.candidateIndex;
  }
  return selections;
}

/** Finds every complete current choice group represented by one finite path. */
function readPreviewInspectorNeuralChoicePathApplyPlans(path, choices) {
  const selections = readPreviewInspectorNeuralChoicePathSelections(path, choices);
  const plans = [];
  for (const [choiceIndex, choice] of choices.entries()) {
    const choiceRecords = choice.choiceRecords.filter((record) =>
      typeof record?.path === 'string' && record.path.length > 0 &&
      Array.isArray(record.candidates) && record.candidates.length > 0,
    );
    if (choiceRecords.length === 0) continue;
    const selectedForApply = {};
    let complete = true;
    for (const record of choiceRecords) {
      const selectionKey = createPreviewInspectorNeuralChoiceSelectionKey(
        choice,
        choiceIndex,
        record,
      );
      if (!Object.prototype.hasOwnProperty.call(selections, selectionKey)) {
        complete = false;
        break;
      }
      selectedForApply[record.path] = selections[selectionKey];
    }
    if (complete) {
      plans.push({
        choice,
        selections,
        selectedForApply,
      });
    }
  }
  return plans;
}

/** Presents the bounded graph separately from the concrete controls that execute one edge. */
function PreviewInspectorNeuralChoicePathSummary({
  applyError,
  canApply,
  derivation,
  onApply,
  onSelect,
  selectedPathId,
}) {
  const paths = Array.isArray(derivation?.paths) ? derivation.paths : [];
  const recommendedPath = derivation?.recommendedPath;
  if (paths.length === 0 || recommendedPath === undefined) return null;
  const selectedPath = paths.find((path) => path.id === selectedPathId);
  const activePath = selectedPath ?? recommendedPath;
  const stateCount = Number.isSafeInteger(derivation.stateCount) ? derivation.stateCount : 1;
  const completedCount = Array.isArray(derivation.completedPaths)
    ? derivation.completedPaths.length
    : 0;
  return React.createElement(
    'section',
    {
      'aria-label': 'Derived page choice paths',
      className: 'rpi-neural-choice-paths',
      'data-path-count': String(paths.length),
    },
    React.createElement(
      'div',
      { className: 'rpi-neural-choice-path-heading' },
      React.createElement(
        'strong',
        undefined,
        paths.length === 1 ? 'Derived path' : 'Derived paths · ' + String(paths.length),
      ),
      React.createElement(
        'span',
        undefined,
        'Finite graph · ' + String(stateCount) + ' state' + (stateCount === 1 ? '' : 's'),
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-neural-choice-path-recommendation' },
      React.createElement(
        'div',
        { className: 'rpi-neural-choice-path-copy' },
        React.createElement('span', undefined, selectedPath === undefined ? 'Suggested path' : 'Selected path'),
        React.createElement('strong', { title: activePath.label }, activePath.label),
      ),
      React.createElement(
        'div',
        { className: 'rpi-neural-choice-path-actions' },
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            disabled: !canApply(activePath),
            onClick: () => onApply(activePath),
            title: canApply(activePath)
              ? 'Apply every current choice represented by this path'
              : 'This path has no executable choice in the current page state',
          },
          selectedPath === undefined ? 'Apply suggestion' : 'Apply selected',
        ),
        React.createElement(
          PreviewInspectorDevtoolsButton,
          {
            onClick: () => onSelect(recommendedPath),
            pressed: selectedPathId === recommendedPath.id,
            title: 'Select the current choices from the highest-ranked finite path',
          },
          selectedPathId === recommendedPath.id ? 'Suggestion selected' : 'Select suggestion',
        ),
      ),
    ),
    typeof applyError === 'string' && applyError.length > 0
      ? React.createElement(
          'div',
          { className: 'rpi-error rpi-neural-choice-path-error', role: 'alert' },
          applyError,
        )
      : null,
    derivation?.cycle?.label
      ? React.createElement(
          'div',
          { className: 'rpi-neural-choice-path-cycle' },
          'Cycle closed · ' + derivation.cycle.label,
        )
      : null,
    completedCount > 0
      ? React.createElement(
          'div',
          { className: 'rpi-neural-choice-path-verified' },
          'Stable target paths · ' + String(completedCount),
        )
      : null,
    React.createElement(
      'details',
      { className: 'rpi-neural-choice-path-alternatives' },
      React.createElement(
        'summary',
        undefined,
        paths.length === 1 ? 'View path' : 'Compare all ' + String(paths.length) + ' paths',
      ),
      React.createElement(
        'ol',
        undefined,
        paths.map((path, index) => {
          const status = [
            index === 0 ? 'Suggested' : '',
            path.verified === true ? 'Verified' : '',
            path.cyclic === true ? 'Cycle' : '',
            path.blocked === true ? 'Blocked' : '',
            path.bounded === true ? 'Depth limit' : '',
            path.verified !== true && path.cyclic !== true && path.blocked !== true
              ? 'Untested'
              : '',
          ].filter(Boolean).join(' · ');
          const selected = selectedPathId === path.id;
          const applicable = canApply(path);
          return React.createElement(
            'li',
            {
              'data-path-status': path.verified === true
                ? 'verified'
                : path.cyclic === true
                  ? 'cycle'
                  : path.blocked === true
                    ? 'blocked'
                    : 'open',
              'data-recommended': index === 0 ? 'true' : 'false',
              'data-selected': selected ? 'true' : 'false',
              key: path.id,
            },
            React.createElement(
              'div',
              { className: 'rpi-neural-choice-path-item-copy' },
              React.createElement('span', { title: path.label }, path.label),
              status.length > 0 ? React.createElement('strong', undefined, status) : null,
            ),
            React.createElement(
              'div',
              { className: 'rpi-neural-choice-path-actions' },
              React.createElement(
                PreviewInspectorDevtoolsButton,
                {
                  onClick: () => onSelect(path),
                  pressed: selected,
                  title: 'Select the current choices from this path',
                },
                'Select',
              ),
              React.createElement(
                PreviewInspectorDevtoolsButton,
                {
                  disabled: !applicable,
                  onClick: () => onApply(path),
                  title: applicable
                    ? 'Apply every current choice represented by this path'
                    : 'This path has no executable choice in the current page state',
                },
                'Apply',
              ),
            ),
          );
        }),
      ),
      derivation.truncated === true
        ? React.createElement(
            'div',
            { className: 'rpi-neural-choice-path-note' },
            'Showing the first ' + String(paths.length) + ' bounded paths.',
          )
        : null,
    ),
  );
}

/** Shows every active semantic decision after safe automatic work has been exhausted. */
function PreviewInspectorNeuralChoiceList() {
  const choices = typeof readPreviewInspectorNeuralUserChoices === 'function'
    ? readPreviewInspectorNeuralUserChoices({ explicitOnly: true })
    : typeof readPreviewInspectorNeuralUserChoice === 'function'
      ? [readPreviewInspectorNeuralUserChoice({ explicitOnly: true })].filter(Boolean)
      : [];
  const normalizedChoices = choices.filter((choice) => choice !== undefined &&
    choice.surface !== 'page-context' && Array.isArray(choice.choiceRecords));
  const reachability = typeof readPreviewInspectorNeuralAssistanceReachability === 'function'
    ? readPreviewInspectorNeuralAssistanceReachability()
    : undefined;
  const targetRendered = reachability?.targetHasOutput === true;
  const choiceIdentity = JSON.stringify(normalizedChoices.map((choice, choiceIndex) => [
    choice.id ?? choice.choiceKind ?? choiceIndex,
    choice.choiceRecords.map((record) => [
      record.path,
      record.candidates?.map((candidate) =>
        candidate !== null && typeof candidate === 'object'
          ? [candidate.id, candidate.label, candidate.selected]
          : candidate),
    ]),
  ]));
  const [applyErrors, setApplyErrors] = React.useState({});
  const [pathApplyError, setPathApplyError] = React.useState('');
  const [selectedIndexes, setSelectedIndexes] = React.useState({});
  const [selectedPathId, setSelectedPathId] = React.useState(undefined);
  const learningStatus = typeof readPreviewInspectorNeuralLearningStatus === 'function'
    ? readPreviewInspectorNeuralLearningStatus()
    : undefined;
  React.useEffect(() => {
    setApplyErrors({});
    setPathApplyError('');
    setSelectedIndexes({});
    setSelectedPathId(undefined);
  }, [choiceIdentity]);
  if (learningStatus?.collecting === true || learningStatus?.restoring === true) return null;
  if (normalizedChoices.length === 0) return null;
  const pathDerivation = typeof readPreviewInspectorNeuralDerivedChoicePaths === 'function'
    ? readPreviewInspectorNeuralDerivedChoicePaths(normalizedChoices)
    : undefined;
  const decisionCount = normalizedChoices.reduce(
    (total, choice) => total + Math.max(1, choice.choiceRecords.length),
    0,
  );
  const onlyChoice = normalizedChoices.length === 1 ? normalizedChoices[0] : undefined;
  const onlyChoiceRecords = onlyChoice?.choiceRecords ?? [];
  const automaticChoicesExhausted = onlyChoice?.choiceKind === 'source-proven-prop' &&
    Number.isSafeInteger(onlyChoice?.automaticAttemptCount) &&
    Number.isSafeInteger(onlyChoice?.automaticCandidateCount) &&
    onlyChoice.automaticCandidateCount > 0 &&
    onlyChoice.automaticAttemptCount >= onlyChoice.automaticCandidateCount;
  const selectChoicePath = (path) => {
    const selections = readPreviewInspectorNeuralChoicePathSelections(path, normalizedChoices);
    if (Object.keys(selections).length === 0) return false;
    setPathApplyError('');
    setSelectedIndexes(selections);
    setSelectedPathId(path.id);
    return true;
  };
  const canApplyChoicePath = (path) =>
    readPreviewInspectorNeuralChoicePathApplyPlans(path, normalizedChoices).length > 0;
  const applyChoicePath = (path) => {
    const plans = readPreviewInspectorNeuralChoicePathApplyPlans(path, normalizedChoices);
    if (plans.length === 0) {
      setPathApplyError(
        'This path has no executable choice in the current page state. Select another path or wait for the next state.',
      );
      return false;
    }
    setSelectedIndexes(plans[0].selections);
    setSelectedPathId(path.id);
    if (typeof setPreviewInspectorNeuralActiveChoicePath === 'function') {
      setPreviewInspectorNeuralActiveChoicePath(path.id);
    }
    if (
      typeof readPreviewInspectorNeuralUserChoiceSelections === 'function' &&
      typeof recordPreviewInspectorNeuralChoicePathSelection === 'function'
    ) {
      for (const plan of plans) {
        const pathSelections = readPreviewInspectorNeuralUserChoiceSelections(
          plan.choice,
          plan.selectedForApply,
        );
        if (Array.isArray(pathSelections) && pathSelections.length > 0) {
          recordPreviewInspectorNeuralChoicePathSelection(plan.choice, pathSelections, {
            pathId: path.id,
          });
        }
      }
    }
    let applied = true;
    for (const plan of plans) {
      if (!applyPreviewInspectorNeuralUserChoices(
        plan.choice,
        plan.selectedForApply,
        { pathId: path.id, recordSelection: false },
      )) {
        applied = false;
        break;
      }
    }
    setPathApplyError(applied
      ? ''
      : 'The path could not be applied. The page may have changed; choose a refreshed path or open details.');
    return applied;
  };
  return React.createElement(
    'fieldset',
    {
      'aria-label': targetRendered
        ? 'Optional source-proven rendered variants'
        : 'Choices required to continue the preview',
      className: 'rpi-neural-choice-list',
      'data-choice-count': String(decisionCount),
      'data-choice-purpose': targetRendered ? 'explore' : 'resolve',
    },
    React.createElement(
      'legend',
      undefined,
      targetRendered
        ? decisionCount > 1 ? 'Explore variants · ' + String(decisionCount) : 'Explore variant'
        : decisionCount > 1 ? 'Choices needed · ' + String(decisionCount) : 'Choice needed',
    ),
    React.createElement(
      'div',
      {
        'aria-label': 'Scrollable source-proven choices',
        className: 'rpi-neural-choice-scroll',
        role: 'region',
        tabIndex: 0,
      },
      React.createElement(
        'div',
      { className: 'rpi-neural-choice-intro' },
      targetRendered
        ? 'The page is rendered. Alternatives remain unverified until their output stays stable; apply a path to test it.'
        : normalizedChoices.length > 1
        ? 'Several independent decisions remain. Apply a complete derived path, or apply one group below to decide incrementally.'
        : automaticChoicesExhausted
          ? 'The viewer tested all ' + String(onlyChoice.automaticCandidateCount) +
            ' source-proven values. Choose the value to keep or open details.'
          : onlyChoice?.choiceKind === 'render-condition' &&
              onlyChoiceRecords[0]?.kind === 'page-control'
            ? 'Choose the same page option here or directly in the rendered page. The viewer will activate the real control.'
            : 'Review every available option, choose one, and apply it to this preview.',
    ),
    PreviewInspectorNeuralChoicePathSummary({
      applyError: pathApplyError,
      canApply: canApplyChoicePath,
      derivation: pathDerivation,
      onApply: applyChoicePath,
      onSelect: selectChoicePath,
      selectedPathId,
    }),
    normalizedChoices.map((choice, choiceIndex) => {
      const choiceRecords = choice.choiceRecords.filter((record) =>
        typeof record?.path === 'string' && record.path.length > 0 &&
        Array.isArray(record.candidates) && record.candidates.length > 0,
      );
      const choiceKey = String(choice.id ?? choice.choiceKind ?? choiceIndex);
      const selectionComplete = choiceRecords.length > 0 && choiceRecords.every((record) =>
        Object.prototype.hasOwnProperty.call(
          selectedIndexes,
          createPreviewInspectorNeuralChoiceSelectionKey(choice, choiceIndex, record),
        ),
      );
      const selectedForApply = {};
      for (const record of choiceRecords) {
        selectedForApply[record.path] = selectedIndexes[
          createPreviewInspectorNeuralChoiceSelectionKey(choice, choiceIndex, record)
        ];
      }
      return React.createElement(
        'article',
        {
          className: 'rpi-neural-choice-block',
          'data-choice-kind': choice.choiceKind,
          key: choiceKey,
        },
        React.createElement(
          'div',
          { className: 'rpi-neural-choice-block-heading' },
          React.createElement('strong', undefined, choice.title ?? 'Choose how to continue'),
          React.createElement(
            'span',
            undefined,
            String(Math.max(1, choiceRecords.length)) + ' decision' +
              (choiceRecords.length === 1 ? '' : 's'),
          ),
        ),
        choiceRecords.length === 0
          ? React.createElement(
              'div',
              { className: 'rpi-neural-choice-empty' },
              'No safe inline value is available. Open details for the focused editor.',
            )
          : choiceRecords.map((record) => {
              const selectionKey = createPreviewInspectorNeuralChoiceSelectionKey(
                choice,
                choiceIndex,
                record,
              );
              const selectedIndex = selectedIndexes[selectionKey];
              const selectedCandidate = Number.isInteger(selectedIndex)
                ? record.candidates[selectedIndex]
                : undefined;
              const currentValueLabel = selectedCandidate !== undefined
                ? 'Selected: ' + formatPreviewInspectorNeuralChoiceValue(selectedCandidate)
                : record.currentValue === undefined
                  ? 'No value selected'
                  : 'Current: ' + formatPreviewInspectorNeuralChoiceValue(record.currentValue);
              return React.createElement(
                'section',
                { className: 'rpi-neural-choice-group', key: record.path },
                React.createElement(
                  'div',
                  { className: 'rpi-neural-choice-heading' },
                  React.createElement('strong', { title: record.path }, record.path),
                  React.createElement('span', { title: currentValueLabel }, currentValueLabel),
                ),
                React.createElement(
                  'ul',
                  {
                    'aria-label': 'Available values for ' + record.path,
                    className: 'rpi-neural-choice-options',
                  },
                  record.candidates.map((candidate, index) => {
                    const candidateLabel = formatPreviewInspectorNeuralChoiceValue(candidate);
                    const description = candidate !== null && typeof candidate === 'object' &&
                      typeof candidate.description === 'string'
                        ? candidate.description
                        : '';
                    const selected = selectedIndexes[selectionKey] === index;
                    const disabled = candidate !== null && typeof candidate === 'object' &&
                      candidate.disabled === true;
                    return React.createElement(
                      'li',
                      { key: String(candidate?.id ?? index) },
                      React.createElement(
                        'button',
                        {
                          'aria-pressed': selected,
                          className: 'rpi-button',
                          'data-choice-index': String(index),
                          'data-choice-path': record.path,
                          disabled,
                          onClick: () => {
                            setPathApplyError('');
                            setSelectedPathId(undefined);
                            setSelectedIndexes((current) => ({
                              ...current,
                              [selectionKey]: index,
                            }));
                          },
                          title: description || 'Use ' + candidateLabel + ' for ' + record.path,
                          type: 'button',
                        },
                        candidateLabel,
                      ),
                      description.length > 0
                        ? React.createElement(
                            'span',
                            { className: 'rpi-neural-choice-option-copy' },
                            description,
                          )
                        : null,
                    );
                  }),
                ),
              );
            }),
        React.createElement(
          'div',
          { className: 'rpi-neural-choice-footer' },
          React.createElement('span', undefined, describePreviewInspectorNeuralChoiceProvenance(choice)),
          React.createElement(
            'div',
            { className: 'rpi-neural-choice-actions' },
            React.createElement(
              PreviewInspectorDevtoolsButton,
              {
                onClick: () => revealPreviewInspectorNeuralUserChoice(choice),
                title: 'Open this blocker and its full focused editor',
              },
              'Open details',
            ),
            React.createElement(
              PreviewInspectorDevtoolsButton,
              {
                disabled: !selectionComplete,
                onClick: () => {
                  setPathApplyError('');
                  setSelectedPathId(undefined);
                  if (typeof setPreviewInspectorNeuralActiveChoicePath === 'function') {
                    setPreviewInspectorNeuralActiveChoicePath(undefined);
                  }
                  const applied = applyPreviewInspectorNeuralUserChoices(choice, selectedForApply);
                  setApplyErrors((current) => ({
                    ...current,
                    [choiceKey]: applied
                      ? ''
                      : 'The selected option could not be applied. The page may have changed; review the refreshed list or open details.',
                  }));
                },
                title: selectionComplete
                  ? 'Apply this decision and retry the preview'
                  : choiceRecords.length === 0
                    ? 'Open details because no safe inline option is available'
                    : 'Choose one value for every path in this group first',
              },
              formatPreviewInspectorNeuralChoiceApplyLabel(choice, choiceRecords.length),
            ),
          ),
        ),
        typeof applyErrors[choiceKey] === 'string' && applyErrors[choiceKey].length > 0
          ? React.createElement('div', { className: 'rpi-error', role: 'alert' }, applyErrors[choiceKey])
          : null,
      );
      }),
    ),
  );
}

/** Lets the user explicitly re-evaluate one admitted blocker with the latest local model. */
function PreviewInspectorNeuralRequestButton() {
  const availability = typeof readPreviewInspectorNeuralAssistanceAvailability === 'function'
    ? readPreviewInspectorNeuralAssistanceAvailability()
    : { actionable: false, mode: 'none', pending: false, title: 'Neural assistance is unavailable.' };
  return React.createElement(
    PreviewInspectorDevtoolsButton,
    {
      busy: availability.pending,
      disabled: !availability.actionable,
      onClick: activatePreviewInspectorNeuralAssistance,
      title: availability.title,
    },
    availability.pending
      ? availability.restoring === true
        ? 'Restoring best path…'
        : availability.collecting === true
          ? 'Collecting paths · ' + String(availability.successCount ?? 0) + '…'
      : Number.isSafeInteger(availability.choiceAttempt) &&
        Number.isSafeInteger(availability.choiceCount)
        ? 'Testing choice ' + String(availability.choiceAttempt) + ' of ' +
          String(availability.choiceCount) + '…'
        : 'Testing one path…'
      : availability.mode === 'choice'
        ? availability.rendered === true
          ? Number(availability.choiceGroupCount ?? 0) > 1
            ? 'Review ' + String(availability.choiceGroupCount) + ' variants'
            : 'Review variant'
          : Number(availability.choiceGroupCount ?? 0) > 1
            ? 'Review ' + String(availability.choiceGroupCount) + ' choices'
            : 'Review choice'
        : availability.rendered === true ? 'Page resolved' : 'Resolve blockers',
  );
}
`;
}
