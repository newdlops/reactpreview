/** Classifies compiler and browser evidence into stable campaign categories. */
import type { PreviewHeadlessResult } from './previewHeadlessRenderer';
import { readPreviewHeadlessFatalBrowserErrors } from './previewHeadlessRenderer';
import {
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusCategory,
  type PreviewTsxCorpusCompilerEvent,
  type PreviewTsxCorpusManifestRow,
  type PreviewTsxCorpusStageEvent,
  type PreviewTsxCorpusWorkerLifecycleEvent,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';
import { targetSourceIsExact } from './previewTsxCorpusPreparation';

/** Selects failed or uncertain primary outcomes that require a fresh isolated worker before canonical promotion. */
export function attemptRequiresIsolation(attempt: PreviewTsxCorpusAttemptRecord): boolean {
  return (
    attempt.result === undefined ||
    attempt.timedOut ||
    !attempt.cleanupConfirmed ||
    attempt.infrastructureReason !== undefined
  );
}

/** Admits only isolated outcomes whose execution and cleanup evidence satisfy canonical promotion requirements. */
export function isolatedCanBecomeCanonical(attempt: PreviewTsxCorpusAttemptRecord): boolean {
  if (!attempt.cleanupConfirmed || attempt.infrastructureReason !== undefined) return false;
  if (attempt.result !== undefined) return true;
  return (
    attempt.timedOut &&
    attempt.stageHistory.some((event) =>
      ['compile-started', 'render-started'].includes(event.stage),
    )
  );
}

/** Chooses the canonical category from primary and isolated attempts without promoting incomplete infrastructure evidence. */
export function classifyCanonical(
  attempt: PreviewTsxCorpusAttemptRecord,
  row: PreviewTsxCorpusManifestRow,
  sourceRoot: string,
): { readonly category: PreviewTsxCorpusCategory; readonly reason: string } {
  if (attempt.result === undefined) {
    const lastCompiler = attempt.compilerProgress.at(-1);
    const nativeActivity =
      lastCompiler?.activity?.kind === 'native-build' ? lastCompiler.activity : undefined;
    return {
      category: 'runtime/build failure',
      reason: `isolated ${attempt.lastStage ?? 'unknown-stage'} outer deadline at 90000 ms with confirmed cleanup; stall=${attempt.stallClassification ?? 'unclassified'}; lastCompiler=${lastCompiler?.stage ?? 'none'}${nativeActivity === undefined ? '' : `/${nativeActivity.phase}/pass-${nativeActivity.pass.toString()}`}`,
    };
  }
  if (attempt.result.kind === 'compile-or-render-failure') {
    return {
      category: 'runtime/build failure',
      reason:
        `${attempt.result.errorName ?? 'Error'}: ${attempt.result.error ?? 'target-bound compile/render failure'}`.slice(
          0,
          2_000,
        ),
    };
  }
  const result = attempt.result.headless;
  if (result === undefined) {
    return {
      category: 'runtime/build failure',
      reason: 'target-bound worker result omitted headless evidence',
    };
  }
  return classifyHeadlessResult(result, row, sourceRoot);
}

/** Keeps one existing renderer-owned scalar readable and bounded in durable classifications. */
export function formatClassificationDiagnosticText(value: string, maximumLength: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximumLength) || 'none';
}

/** Formats bounded, snapshot-only first-break evidence for target reachability blockers. */
export function formatTargetReachabilityFirstBreak(
  composition: NonNullable<
    NonNullable<PreviewHeadlessResult['stabilization']>['compositionSnapshot']
  >,
): string {
  const mounted = composition.targetMounted;
  const wasMounted = composition.targetWasMounted === true;
  const hasOutput = composition.targetHasOutput;
  const fallbackRequested = composition.targetContextualFallbackRequested === true;
  const scalar = (value: string): string => {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    return normalized.length === 0 ? 'none' : normalized.slice(0, 80);
  };
  const chain = composition.targetRenderCommitChain;
  const mountedDecision = chain?.mountedChildrenGateDecision;
  const corridor = `; corridor=(candidate=${scalar(composition.pageExecutionCandidateId ?? 'none')},root=${scalar(composition.pageExecutionRootSurfaceId ?? 'none')},route=${scalar(composition.selectedRoutePathname ?? 'none')},status=${scalar(composition.targetStatus)},stage=${scalar(composition.targetStage)},search=${scalar(composition.requirementSearchStatus)},pass=${(composition.requirementSearchPass ?? 0).toString()},paths=${(composition.requirementSearchObservedPathCount ?? 0).toString()},host-output=${composition.hostOutput.toString()})`;
  const targetState = `; target-state=(page-root=${composition.targetPageRootCommitted ? '1' : '0'},mounted=${mounted ? '1' : '0'},was-mounted=${wasMounted ? '1' : '0'},has-output=${hasOutput ? '1' : '0'},fallback-requested=${fallbackRequested ? '1' : '0'},output-kind=${scalar(composition.targetOutputKind)},direct-output=${composition.targetDirectElementOutput === true ? '1' : '0'},projected-output=${composition.targetProjectedCompatibilityOutput === true ? '1' : '0'},detached-output=${composition.targetDetachedBoundaryOutput === true ? '1' : '0'},current-file-mounted=${composition.currentFileMounted.toString()})`;
  const topology =
    chain === undefined
      ? ''
      : `; topology-verdict=${chain.topologyVerdict}; topology-support=(reason=${scalar(chain.topologyReason)},effect-continuation=${chain.topologyEffectContinuationAccepted ? '1' : '0'},delayed-probe=${chain.topologyDelayedProbeFired ? '1' : '0'},boundary-identity=${chain.topologyBoundaryIdentityRetained ? '1' : '0'},current-ambiguous=${chain.topologyCurrentBranchAmbiguous ? '1' : '0'},current-exact=${chain.topologyCurrentExactTargetCount.toString()},locator-exact=${chain.topologyLocatorExactTargetCount.toString()},target-children=${chain.topologyCurrentTargetChildCount.toString()},retained-children=${chain.topologyCurrentRetainedChildCount.toString()},current-hosts=${chain.topologyCurrentConnectedVisibleHostCount.toString()},descendant-hosts=${chain.topologyCurrentDescendantHostCount.toString()},stale-exact=${chain.topologyStaleExactTargetCount.toString()},stale-hosts=${chain.topologyStaleConnectedVisibleHostCount.toString()})`;
  if (
    chain !== undefined &&
    mountedDecision !== undefined &&
    mountedDecision.mountedChildrenGateFirstReject !== 'not-evaluated'
  ) {
    return `mountedChildrenGateFirstReject=${mountedDecision.mountedChildrenGateFirstReject}; mounted-children-support=(registrations=${mountedDecision.registrationCount.toString()},conflict=${mountedDecision.registrationConflict ? '1' : '0'},transparent-capability=${mountedDecision.transparentCapability ? '1' : '0'},retained-route-available=${mountedDecision.retainedRouteAvailable ? '1' : '0'},retained-route-owned=${mountedDecision.retainedRouteOwned ? '1' : '0'},boundary-count=${mountedDecision.boundaryCount.toString()},logical-target-count=${mountedDecision.logicalTargetCount.toString()},current-mount=${mountedDecision.currentMount ? '1' : '0'},alternate=${mountedDecision.alternateFiber ? '1' : '0'},rerender=${mountedDecision.stableRerender ? '1' : '0'},input-state=${mountedDecision.inputChildrenState},marked-call=${mountedDecision.markedCall ? '1' : '0'},effect=${mountedDecision.effectCompleted ? '1' : '0'},returned-child=${mountedDecision.returnedChild ? '1' : '0'},owned-host=${mountedDecision.ownedHost ? '1' : '0'},target-output=${mountedDecision.targetOutput ? '1' : '0'},render-error=${mountedDecision.renderError ? '1' : '0'},repair-error=${mountedDecision.repairError ? '1' : '0'},direct-target=${mountedDecision.directTarget ? '1' : '0'},page-root=${mountedDecision.pageRootCommitted ? '1' : '0'},active-key=${mountedDecision.activeKey ? '1' : '0'},latch-before=${mountedDecision.latchBefore ? '1' : '0'},request-attempted=${mountedDecision.requestAttempted ? '1' : '0'},request-accepted=${mountedDecision.requestAccepted ? '1' : '0'},notification-issued=${mountedDecision.notificationIssued ? '1' : '0'}); support=(replacement=${chain.specializedReplacementExecuted ? '1' : '0'},resolver=${scalar(chain.resolverOutcome)},marked-call=${chain.markedCallResult ? '1' : '0'},path=${scalar(chain.markedCallPropertyPath)},effect=${chain.effectCompletedAfterMarkedCall ? '1' : '0'},rerender=${chain.stableRerenderObserved ? '1' : '0'},children=${chain.childrenForwarded ? '1' : '0'},owned-host=${chain.ownedHostObserved ? '1' : '0'},connected-hosts=${chain.connectedHostCount.toString()},private-owned=${chain.privateOwnershipCount.toString()})${targetState}${corridor}${topology}`;
  }
  if (chain !== undefined && chain.firstBreak !== 'unknown') {
    return `first-break=${chain.firstBreak}; support=(replacement=${chain.specializedReplacementExecuted ? '1' : '0'},resolver=${scalar(chain.resolverOutcome)},marked-call=${chain.markedCallResult ? '1' : '0'},path=${scalar(chain.markedCallPropertyPath)},effect=${chain.effectCompletedAfterMarkedCall ? '1' : '0'},rerender=${chain.stableRerenderObserved ? '1' : '0'},children=${chain.childrenForwarded ? '1' : '0'},owned-host=${chain.ownedHostObserved ? '1' : '0'},connected-hosts=${chain.connectedHostCount.toString()},private-owned=${chain.privateOwnershipCount.toString()})${targetState}${corridor}${topology}`;
  }
  const ownership = [
    'compiler-export-evidence',
    'facade-resolution',
    'facade-evaluation',
    'wrapper-render',
    'boundary-commit',
    'source-export-match',
    'fiber-availability',
  ]
    .map((phase) => `${phase}:${composition.targetOwnershipPhases[phase] === true ? '1' : '0'}`)
    .join(',');
  const mountedWithoutHistory = mounted && !wasMounted;
  const outputWithoutMount = hasOutput && !mounted && !wasMounted;
  const firstBreak = !composition.targetPageRootCommitted
    ? 'page-root-not-committed'
    : mountedWithoutHistory || outputWithoutMount
      ? 'unknown'
      : !mounted && !wasMounted && !fallbackRequested
        ? 'contextual-fallback-unavailable-or-not-requested'
        : !mounted && !wasMounted && fallbackRequested
          ? 'contextual-boundary-never-mounted'
          : (mounted || wasMounted) && !hasOutput
            ? 'mounted-without-owned-output'
            : 'unknown';
  return `first-break=${firstBreak}; support=(page-root=${composition.targetPageRootCommitted ? '1' : '0'},fallback-requested=${fallbackRequested ? '1' : '0'},mounted=${mounted ? '1' : '0'},was-mounted=${wasMounted ? '1' : '0'},has-output=${hasOutput ? '1' : '0'},stage=${scalar(composition.targetStage)},status=${scalar(composition.targetStatus)},output-kind=${scalar(composition.targetOutputKind)},detached-placement=${scalar(composition.targetDetachedTargetPlacement ?? '')},ownership=${ownership},continuation-skip=${scalar(composition.targetLastContinuationSkipReason ?? '')},search-status=${scalar(composition.requirementSearchStatus)},search-settled=${composition.requirementSearchSettled ? '1' : '0'},search-exhausted=${composition.requirementSearchExhausted ? '1' : '0'})${topology}`;
}

/** Classifies one cleaned headless result identically across serial and pipelined campaigns. */
export function classifyHeadlessResult(
  result: PreviewHeadlessResult,
  row: PreviewTsxCorpusManifestRow,
  sourceRoot: string,
): { readonly category: PreviewTsxCorpusCategory; readonly reason: string } {
  const composition = result.stabilization?.compositionSnapshot;
  const fatalBrowserErrors = readPreviewHeadlessFatalBrowserErrors(result);
  const errorEvidence =
    result.status !== 'ready' ||
    result.protocolError !== undefined ||
    result.runtimeErrorText !== undefined ||
    fatalBrowserErrors.length > 0 ||
    (result.evidence.requiredArtifactFailures?.length ?? 0) > 0 ||
    composition?.targetError === true;
  if (errorEvidence) {
    const errorDetails: string[] = [];
    if (composition?.targetErrorOwner !== undefined) {
      errorDetails.push(
        `owner=${formatClassificationDiagnosticText(composition.targetErrorOwner, 240)}`,
      );
    }
    if (composition?.targetErrorPhase !== undefined) {
      errorDetails.push(
        `phase=${formatClassificationDiagnosticText(composition.targetErrorPhase, 240)}`,
      );
    }
    if (composition?.targetErrorLocation !== undefined) {
      errorDetails.push(
        `location=${formatClassificationDiagnosticText(composition.targetErrorLocation, 320)}`,
      );
    }
    if (composition?.targetErrorStack !== undefined) {
      errorDetails.push(
        `stack=${formatClassificationDiagnosticText(composition.targetErrorStack, 900)}`,
      );
    }
    const consoleFailure =
      result.evidence.consoleFailures.find((value) =>
        /Invalid JSX element type object|Element type is invalid/iu.test(value),
      ) ?? result.evidence.consoleFailures.at(-1);
    if (consoleFailure !== undefined) {
      errorDetails.push(`console=${formatClassificationDiagnosticText(consoleFailure, 900)}`);
    }
    if (composition?.targetErrorDetails !== undefined) {
      errorDetails.push(
        `details=${formatClassificationDiagnosticText(composition.targetErrorDetails, 800)}`,
      );
    }
    const fallbackSummaries = (composition?.targetRuntimeFallbackSummaries ?? [])
      .slice(0, 2)
      .map((value) => formatClassificationDiagnosticText(value, 360));
    if (fallbackSummaries.length > 0) {
      errorDetails.push(`fallbacks=${fallbackSummaries.join(' | ')}`);
    }
    const primaryReason =
      result.protocolError ??
      result.runtimeErrorText ??
      fatalBrowserErrors.at(0) ??
      composition?.targetErrorMessage ??
      `headless status ${result.status}`;
    return {
      category: 'runtime/build failure',
      reason:
        `${primaryReason}${errorDetails.length === 0 ? '' : `; target-error=(${errorDetails.join('; ')})`}`.slice(
          0,
          2_000,
        ),
    };
  }
  if (result.rootHtml.includes('Unrendered')) {
    return {
      category: 'Unrendered',
      reason: 'captured target output contains the explicit Unrendered sentinel',
    };
  }
  if (
    /no direct default or PascalCase component exports to preview/iu.test(result.rootHtml) &&
    composition?.targetMounted === false &&
    !composition.targetHasOutput
  ) {
    return {
      category: 'explicitly structurally non-renderable',
      reason: 'compiler export evidence proves no direct default or PascalCase component export',
    };
  }
  if ((composition?.activeBlockers ?? 0) > 0) {
    const activeBlockerRecord = composition?.activeBlockerProvenance.at(0);
    const activeBlocker = activeBlockerRecord?.kind ?? 'unknown';
    const blockerIdentity =
      activeBlockerRecord === undefined
        ? ''
        : `; name=${formatClassificationDiagnosticText(activeBlockerRecord.name, 240)}; owner=${formatClassificationDiagnosticText(activeBlockerRecord.ownerPath, 320)}`;
    return {
      category: 'blocker',
      reason:
        activeBlocker === 'target-reachability' && composition !== undefined
          ? `active blocker: ${activeBlocker}; ${formatTargetReachabilityFirstBreak(composition)}`
          : `active blocker: ${activeBlocker}${blockerIdentity}`,
    };
  }
  if (
    result.rootHtml.trim().length === 0 ||
    result.stabilizedOutcome === 'ready-empty' ||
    (composition?.targetRenderedEmpty === true && composition.targetEffectControllerOutput !== true)
  ) {
    return {
      category: 'blank/empty output',
      reason: `settled capture contains no target-owned visible output; ${formatTargetReachabilityFirstBreak(composition ?? ({ targetMounted: false, targetWasMounted: false, targetHasOutput: false, targetContextualFallbackRequested: false, targetPageRootCommitted: false, targetOwnershipPhases: {}, targetStage: 'unknown', targetStatus: 'unknown', targetOutputKind: 'none', requirementSearchStatus: 'unknown', requirementSearchSettled: false, requirementSearchExhausted: false } as NonNullable<NonNullable<PreviewHeadlessResult['stabilization']>['compositionSnapshot']>))}`,
    };
  }
  const exactTarget = targetSourceIsExact(composition?.targetSourcePath, row.path, sourceRoot);
  const exactContextModule =
    ['import-chain', 'next-app-filesystem'].includes(
      composition?.contextModuleEvidenceKind ?? '',
    ) &&
    (composition?.contextModuleImportPathLength ?? 0) > 0 &&
    targetSourceIsExact(composition?.contextModuleSourcePath, row.path, sourceRoot);
  const fidelity = composition?.pageExecutionFidelity ?? 'none';
  const standaloneTarget = composition?.pageExecutionStandaloneTarget === true;
  const hasVerifiedTargetOutput =
    composition?.targetStage === 'target-output' &&
    composition.targetOutputKind === 'target-output';
  const hasConclusiveTargetOutput =
    hasVerifiedTargetOutput &&
    composition.targetStatus === 'reached' &&
    composition.targetHasOutput;
  const hasCurrentFileOutput =
    hasVerifiedTargetOutput ||
    ((composition?.currentFileMounted ?? 0) > 0 && (composition?.hostOutput ?? 0) > 0);
  const strictSuccess =
    result.stabilizedOutcome === 'ready' &&
    (exactTarget || exactContextModule) &&
    fidelity !== 'none' &&
    (fidelity !== 'target-only' || standaloneTarget) &&
    composition !== undefined &&
    composition.targetExportName.trim().length !== 0 &&
    composition.targetPageRootCommitted &&
    composition.targetMounted &&
    composition.targetHasOutput &&
    hasCurrentFileOutput &&
    (hasConclusiveTargetOutput || composition.requirementSearchSettled) &&
    result.stabilization?.postTerminalSnapshotReceived === true &&
    (hasConclusiveTargetOutput ||
      (result.stabilization.quiet && !result.stabilization.capReached)) &&
    !composition.criticalEvidenceTruncated;
  if (strictSuccess) {
    return {
      category: 'successful meaningful render',
      reason:
        composition.targetEffectControllerOutput === true
          ? `strict target-owned effect-controller ${fidelity} Page Context render`
          : standaloneTarget
            ? 'strict target-owned standalone Page Context render'
            : exactTarget
              ? `strict target-owned ${fidelity} Page Context render`
              : `strict context-module-owned ${fidelity} Page Context render`,
    };
  }
  return {
    category: 'incomplete page composition',
    reason: [
      `non-strict composition: outcome=${result.stabilizedOutcome ?? 'none'}`,
      `fidelity=${fidelity}`,
      `stage=${composition?.targetStage ?? 'none'}`,
      `target-export=${composition?.targetExportName ?? 'none'}`,
      `candidate=${composition?.pageExecutionCandidateId ?? 'none'}`,
      `route=${composition?.selectedRoutePathname ?? 'none'}`,
      `context=${composition?.contextModuleEvidenceKind ?? 'none'}:${composition?.contextModuleSourcePath ?? 'none'}`,
      composition === undefined
        ? 'composition=missing'
        : formatTargetReachabilityFirstBreak(composition),
    ]
      .join('; ')
      .slice(0, 2_000),
  };
}

/** Correlates worker, process, and transport evidence into an infrastructure failure reason when execution cannot be trusted. */
export function identifyInfrastructureReason(input: {
  readonly cleanupConfirmed: boolean;
  readonly protocolValid: boolean;
  readonly result?: PreviewTsxCorpusWorkerResult;
  readonly stageHistory: readonly PreviewTsxCorpusStageEvent[];
  readonly stderr: string;
  readonly timedOut: boolean;
}): string | undefined {
  if (!input.protocolValid) return 'diagnostic-protocol-invalid';
  if (!input.cleanupConfirmed) return 'cleanup-unconfirmed';
  if (input.result === undefined) {
    if (
      input.timedOut &&
      input.stageHistory.some((event) =>
        ['compile-started', 'render-started'].includes(event.stage),
      )
    ) {
      return undefined;
    }
    return input.timedOut ? 'outer-timeout-without-result' : 'worker-exited-without-result';
  }
  if (input.result.kind === 'compile-or-render-failure') {
    if (!input.stageHistory.some((event) => event.stage === 'compile-started')) {
      return 'failure-before-compile-started';
    }
    if (
      /esbuild JavaScript API cannot be bundled|Cannot find package ['"]esbuild|ERR_MODULE_NOT_FOUND/iu.test(
        input.result.error ?? '',
      )
    ) {
      return 'native-esbuild-bootstrap-failure';
    }
    return undefined;
  }
  const protocolError = input.result.headless?.protocolError ?? '';
  if (
    /listen EPERM|No local Chromium executable|CDP pipe descriptors|spawn .*ENOENT/iu.test(
      protocolError,
    )
  ) {
    return `shared-headless-infrastructure: ${protocolError.slice(0, 500)}`;
  }
  return undefined;
}

/** Separates bounded compiler stalls from ordinary component failures using the recorded stage evidence. */
export function classifyCompilerStall(
  timedOut: boolean,
  stages: readonly PreviewTsxCorpusStageEvent[],
  compilerProgress: readonly PreviewTsxCorpusCompilerEvent[],
  workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[],
): PreviewTsxCorpusAttemptRecord['stallClassification'] | undefined {
  if (stages.some((event) => event.stage === 'compile-finished')) {
    return 'normal-compiler-completion';
  }
  if (!timedOut || !stages.some((event) => event.stage === 'compile-started')) return undefined;
  const nativeBuildStarted = compilerProgress.some(
    (event) => event.activity?.kind === 'native-build',
  );
  const signalAcknowledged = workerLifecycle.some((event) => event.event === 'signal-received');
  if (nativeBuildStarted) {
    return signalAcknowledged
      ? 'event-loop-responsive-native-or-shutdown-wait'
      : 'same-thread-plugin-blockage-during-native-build';
  }
  return signalAcknowledged
    ? 'event-loop-responsive-pre-native-wait'
    : 'pre-native-same-thread-blockage';
}
