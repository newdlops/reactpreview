/** Generates the observable availability state shared by neural UI controls. */
export function createPreviewInspectorNeuralAssistanceAvailabilityRuntimeSource(): string {
  return String.raw`
/** Describes button availability without subscribing the application tree to Inspector state. */
function readPreviewInspectorNeuralAssistanceAvailability() {
  const blockers = readPreviewInspectorNeuralAssistanceBlockers();
  const actionableBlockers = blockers.active.filter((node) =>
    previewInspectorNeuralAssistanceBlockerKinds.has(node?.blockerKind),
  );
  const reachability = readPreviewInspectorNeuralAssistanceReachability();
  const modelUpdates = typeof readPreviewInspectorNeuralLearningModelUpdates === 'function'
    ? readPreviewInspectorNeuralLearningModelUpdates()
    : 0;
  const learningStatus = typeof readPreviewInspectorNeuralLearningStatus === 'function'
    ? readPreviewInspectorNeuralLearningStatus()
    : undefined;
  const collecting = learningStatus?.collecting === true;
  const restoring = learningStatus?.restoring === true;
  const assistanceKey = reachability !== undefined &&
    typeof createPreviewInspectorAutomaticNeuralAssistanceKey === 'function'
      ? createPreviewInspectorAutomaticNeuralAssistanceKey(reachability)
      : undefined;
  const assistanceRecord = typeof assistanceKey === 'string'
    ? previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(assistanceKey)
    : undefined;
  const verifying = learningStatus?.verifying === true ||
    typeof isPreviewInspectorNeuralSuccessVerificationPending === 'function' &&
      isPreviewInspectorNeuralSuccessVerificationPending(assistanceRecord);
  const pending = (
    previewInspectorSession.neuralAssistancePending === true &&
    previewInspectorSession.neuralAssistanceRevision === previewEntryRevision
  ) || collecting || restoring || verifying;
  const choiceAttempt = pending && Number.isSafeInteger(learningStatus?.choiceAttempt)
    ? learningStatus.choiceAttempt
    : undefined;
  const choiceCount = pending && Number.isSafeInteger(learningStatus?.choiceCount)
    ? learningStatus.choiceCount
    : undefined;
  const learning = learningStatus?.phase === 'learning' &&
    Number(learningStatus?.activeCount ?? 0) > 0;
  const selectedExportName = typeof previewInspectorSession.selectedExportName === 'string'
    ? previewInspectorSession.selectedExportName
    : '';
  const renderedCorridor = reachability?.targetHasOutput === true;
  const unresolvedCorridor = reachability !== undefined && !renderedCorridor;
  const temporalPinned = typeof isPreviewInspectorNeuralTemporalStateContractActive === 'function' &&
    isPreviewInspectorNeuralTemporalStateContractActive(
      previewInspectorSession.selectedPageCandidateId,
    );
  const temporalReleased =
    typeof isPreviewInspectorNeuralTemporalStateContractReleased === 'function' &&
    isPreviewInspectorNeuralTemporalStateContractReleased(
      previewInspectorSession.selectedPageCandidateId,
    );
  const temporalLocked = temporalPinned || temporalReleased;
  const choiceAvailability = readPreviewInspectorNeuralChoiceAvailabilityState(
    blockers,
    reachability,
    learningStatus,
  );
  const { automaticWorkAvailable, userChoice, userChoices } = choiceAvailability;
  const successfulPathSettled =
    typeof isPreviewInspectorNeuralSuccessCollectionSettled === 'function' &&
    isPreviewInspectorNeuralSuccessCollectionSettled(reachability);
  const pageGenerationAvailable = !temporalLocked && !successfulPathSettled &&
    typeof hasPreviewInspectorNeuralPageGenerationWork === 'function' &&
    hasPreviewInspectorNeuralPageGenerationWork();
  const resolutionAvailable = !temporalLocked && (pageGenerationAvailable || !renderedCorridor &&
    (actionableBlockers.length > 0 || unresolvedCorridor));
  const mode = temporalLocked
    ? 'none'
    : !renderedCorridor && automaticWorkAvailable || pageGenerationAvailable
      ? 'resolve'
      : userChoice !== undefined
        ? 'choice'
        : resolutionAvailable ? 'resolve' : 'none';
  const actionable = !pending && !learning && mode !== 'none';
  return Object.freeze({
    actionable,
    blockerCount: renderedCorridor && !pageGenerationAvailable ? 0 : actionableBlockers.length,
    choiceAttempt,
    choiceAvailable: userChoice !== undefined,
    choiceCount,
    choiceGroupCount: userChoices.length,
    collecting,
    learning,
    mode,
    modelUpdates,
    pending,
    rendered: renderedCorridor,
    refining: renderedCorridor && pageGenerationAvailable,
    restoring,
    successCount: Number(learningStatus?.successCount ?? 0),
    temporalPinned,
    temporalReleased,
    verifying,
    title: temporalPinned
      ? 'This loading checkpoint is intentionally pinned. Choose Resume in Page Context Paths to let pending application work continue.'
      : temporalReleased
        ? 'The loading checkpoint was released. Authored application time is progressing without automatic repair treating its disappearance as failure.'
      : pending
      ? verifying
        ? 'Visible target output is being checked across delayed observations before this path is learned or saved.'
        : restoring
        ? 'The bounded sweep is restoring its best verified rendered path.'
        : collecting
          ? 'A working path is saved while the viewer tests every remaining finite source-proven path.'
      : choiceAttempt !== undefined && choiceCount !== undefined
        ? 'The viewer is testing source-proven choice ' + String(choiceAttempt) + ' of ' +
          String(choiceCount) + ' and will keep it only if the selected file renders.'
        : 'The local neural model is testing one admitted path and will change it only after verified failure.'
      : learning
        ? 'Wait for the current verified learning update to finish.'
        : userChoice !== undefined
          ? renderedCorridor
            ? 'This page is rendered. Review a source-proven variant only if you want to compare another branch.'
            : userChoices.length > 1
              ? String(userChoices.length) + ' independent choices need review.'
              : userChoice.title
        : actionable
          ? modelUpdates > 0
            ? renderedCorridor && pageGenerationAvailable
              ? 'Visible output is checkpointed. Continue the learned finite path sweep to settle remaining viewer-owned choices.'
              : 'Learned updates apply automatically. Run the admitted blocker sweep now.'
            : 'Run the safe blocker sweep now; verified outcomes will train the local model.'
          : renderedCorridor && modelUpdates > 0 && selectedExportName.length > 0
            ? 'This preview is already rendered; neural assistance will preserve it.'
            : 'No learned model or eligible preview blocker is available yet.',
  });
}
`;
}
