/** Generates the headless browser bridge and timeout probe inside the preview document. */
import type { PreviewInspectorNeuralModel } from '../../presentation/previewInspectorNeuralModelProtocol';
import { PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY } from '../esbuild/inspector/previewInspectorRouteExecutionRuntimeSource';
import {
  MAX_CAPTURE_BYTES,
  PREVIEW_HEADLESS_FAILED_CAPTURE_MS,
  PREVIEW_HEADLESS_STABILIZATION_CAP_MS,
  PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
} from './previewHeadlessModel';
import { createPreviewHeadlessNeuralStateSource } from './previewHeadlessNeuralModel';

/** Builds the bounded page snapshot evaluated only after terminal timeout. */
export function createPreviewHeadlessTimeoutExpression(bindingName: string): string {
  const stateName = `${bindingName}State`;
  return `(() => {
    const state = globalThis[${JSON.stringify(stateName)}];
    const root = document.querySelector?.('[data-react-preview-mount]') ?? document.getElementById('react-preview-root');
    const progressHost = document.getElementById('react-preview-progress-host');
    const progressRoot = progressHost?.shadowRoot;
    const hotRuntime = globalThis[Symbol.for('newdlops.react-file-preview.hot-runtime')];
    const entryScript = document.querySelector('script[type="module"][src]');
    let entryResource;
    try {
      entryResource = entryScript?.src === undefined
        ? undefined
        : performance.getEntriesByName(entryScript.src, 'resource').at(-1);
    } catch {
      entryResource = undefined;
    }
    const portalHtml = [...(document.body?.children ?? [])]
      .filter((node) => node !== root && node?.contains?.(root) !== true && node?.id !== 'react-preview-progress-host' && node?.hasAttribute?.('data-react-preview-inspector-ui') !== true && !['SCRIPT', 'STYLE'].includes(node?.tagName))
      .map((node) => node.outerHTML ?? '')
      .join('');
    return {
      bodyPreviewState: document.body?.dataset?.reactPreviewState,
      bridgeInstalled: state?.installed === true,
      composition: state?.latestComposition,
      documentReadyState: document.readyState,
      entryModule: {
        duration: Number.isFinite(entryResource?.duration) ? entryResource.duration : undefined,
        initiatorType: typeof entryResource?.initiatorType === 'string' ? entryResource.initiatorType.slice(0, 80) : undefined,
        present: entryScript !== null,
        resourceObserved: entryResource !== undefined,
        responseEnd: Number.isFinite(entryResource?.responseEnd) ? entryResource.responseEnd : undefined,
        source: typeof entryScript?.src === 'string' ? entryScript.src.slice(-1_024) : undefined,
        state: entryScript === null ? 'missing-script' : entryResource === undefined ? 'requested-or-pending' : 'loaded',
        transferSize: Number.isFinite(entryResource?.transferSize) ? entryResource.transferSize : undefined,
      },
      hotRuntime: {
        bootstrapPromisePresent: hotRuntime?.bootstrapPromise !== undefined,
        preparedEntryPresent: hotRuntime?.preparedEntry !== undefined,
        preparationPromisePresent: hotRuntime?.preparedEntry?.preparationPromise !== undefined,
        present: hotRuntime !== undefined,
        rootPresent: hotRuntime?.root !== undefined,
      },
      messageCount: Array.isArray(state?.messages) ? state.messages.length : 0,
      messages: state?.messages?.slice(-16) ?? [],
      mount: {
        ariaBusy: root?.getAttribute?.('aria-busy'),
        childElementCount: root?.childElementCount ?? 0,
        html: (String(root?.innerHTML ?? '') + portalHtml).slice(0, 65_536),
        isConnected: root?.isConnected === true,
        present: root !== null,
      },
      progress: {
        detail: progressRoot?.getElementById('react-preview-progress-detail')?.textContent?.slice(0, 400),
        label: progressRoot?.getElementById('react-preview-progress-label')?.textContent?.slice(0, 240),
        openShadowRootPresent: progressRoot !== null && progressRoot !== undefined,
        present: progressHost !== null,
        step: progressRoot?.getElementById('react-preview-progress-step')?.textContent?.slice(0, 160),
        visible: progressHost !== null && progressHost.hidden !== true,
      },
      runtimeErrorText: root?.querySelector('.react-preview-runtime-error')?.textContent?.slice(0, 4_096),
      snapshotCount: state?.snapshotCount ?? 0,
      terminal: state?.terminal,
    };
  })()`;
}

/** Produces the pre-entry VS Code shim and terminal binding publisher. */
export function createPreviewHeadlessBridgeSource(
  token: string,
  revision: number,
  bindingName: string,
  requireCompositionSnapshot = false,
  neuralResidualModel?: PreviewInspectorNeuralModel,
): string {
  const stateName = `${bindingName}State`;
  return String.raw`
(() => {
  const expectedToken = ${JSON.stringify(token)};
  const expectedRevision = ${revision.toString()};
  const bindingName = ${JSON.stringify(bindingName)};
  const requireCompositionSnapshot = ${JSON.stringify(requireCompositionSnapshot)};
  const stateName = ${JSON.stringify(stateName)};
  const routeErrorProbeSymbol = Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY)});
  const limit = 64;
  const maxText = 4096;
  const messages = [];
  const consoleFailures = [];
  const windowErrors = [];
  let evidenceTruncated = false;
  let vscodeState = ${createPreviewHeadlessNeuralStateSource(neuralResidualModel)};
  let latestNeuralModel;
  const bridgeState = {
    installed: true,
    messages,
    terminal: undefined,
    terminalAt: undefined,
    lastActivityAt: undefined,
    latestComposition: undefined,
    mountMutationCount: 0,
    openRenderAttempts: new Set(),
    published: false,
    routerScopeTransition: undefined,
    snapshotCount: 0,
    structuredRuntimeError: false,
  };
  globalThis[stateName] = bridgeState;
  const bounded = (value) => normalizeEvidence(value, new WeakSet(), 0).slice(0, maxText);
  const normalizeEvidence = (value, seen, depth) => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
    if (type === 'symbol') return value.toString();
    if (type === 'function') return '[function]';
    if (depth >= 4) return '[max-depth]';
    if (type !== 'object') return String(value);
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    try {
      const record = value;
      const name = typeof record.name === 'string' ? record.name : undefined;
      const message = typeof record.message === 'string' ? record.message : undefined;
      const cause = record.cause;
      if (name !== undefined || message !== undefined || cause !== undefined) {
        const head = (name ?? 'Error') + (message === undefined || message.length === 0 ? '' : ': ' + message);
        return head + (cause === undefined ? '' : '; cause=' + normalizeEvidence(cause, seen, depth + 1));
      }
      const fields = Object.keys(record).sort().slice(0, 12).map((key) => {
        let field;
        try { field = record[key]; } catch { return key + '=[unreadable]'; }
        return key + '=' + normalizeEvidence(field, seen, depth + 1);
      });
      return fields.length === 0 ? Object.prototype.toString.call(value) : '{' + fields.join(', ') + '}';
    } catch { return Object.prototype.toString.call(value); }
    finally { seen.delete(value); }
  };
  const retain = (list, value) => {
    if (list.length < limit) list.push(bounded(value));
    else evidenceTruncated = true;
  };
  const markActivity = () => {
    if (bridgeState.terminalAt !== undefined) bridgeState.lastActivityAt = Date.now();
  };
  const selectMountNode = () =>
    document.querySelector?.('[data-react-preview-mount]') ??
    document.getElementById('react-preview-root');
  const readRenderedHtml = (root, maximumLength) => {
    const portalHtml = [...(document.body?.children ?? [])]
      .filter((node) =>
        node !== root &&
        node?.contains?.(root) !== true &&
        node?.id !== 'react-preview-progress-host' &&
        node?.hasAttribute?.('data-react-preview-inspector-ui') !== true &&
        !['SCRIPT', 'STYLE'].includes(node?.tagName)
      )
      .map((node) => node.outerHTML ?? '')
      .join('');
    return (String(root?.innerHTML ?? '') + portalHtml).slice(0, maximumLength);
  };
  const readComposition = (message) => {
    const detail = message?.event?.detail;
    const target = detail?.targetState;
    const pageExecution = detail?.pageExecution;
    const search = detail?.requirementSearch;
    const counts = detail?.statusCounts;
    const ownershipPhases =
      target?.ownershipPhases !== null && typeof target?.ownershipPhases === 'object'
        ? Object.fromEntries(
            [
              'compiler-export-evidence',
              'facade-resolution',
              'facade-evaluation',
              'wrapper-render',
              'boundary-commit',
              'source-export-match',
              'fiber-availability',
            ].map((phase) => [
              phase,
              target.ownershipPhases[phase] === true,
            ]),
          )
        : {};
    if (detail === null || typeof detail !== 'object') return undefined;
    const blockerProvenance = Array.isArray(detail?.activeBlockerProvenance)
      ? detail.activeBlockerProvenance
      : detail?.blockerSummary?.items;
    const activeBlockerProvenance = Array.isArray(blockerProvenance)
      ? blockerProvenance
          .filter((item) => item?.active === true)
          .slice(0, 16)
          .map((item) => ({
            kind: String(item?.kind ?? 'unknown').slice(0, 80),
            name: String(item?.name ?? 'Unknown blocker').slice(0, 240),
            ownerPath: String(item?.ownerPath ?? '').slice(0, 320),
          }))
      : [];
    const targetErrorMessage =
      typeof target?.errorMessage === 'string' ? target.errorMessage.slice(0, 1_200) : undefined;
    const targetErrorDetails =
      typeof target?.errorDetails === 'string' ? target.errorDetails.slice(0, 2_400) : undefined;
    const targetErrorLocation =
      typeof target?.errorLocation === 'string' ? target.errorLocation.slice(0, 1_024) : undefined;
    const targetErrorOwner =
      typeof target?.errorOwner === 'string' ? target.errorOwner.slice(0, 240) : undefined;
    const targetErrorPhase =
      typeof target?.errorPhase === 'string' ? target.errorPhase.slice(0, 240) : undefined;
    const targetErrorStack =
      typeof target?.errorStack === 'string' ? target.errorStack.slice(0, 4_000) : undefined;
    const targetFallbackOwner =
      typeof target?.fallbackOwner === 'string' ? target.fallbackOwner.slice(0, 240) : undefined;
    const rawChain = target?.targetRenderCommitChain;
    const mountedGateRejects = new Set([
      'not-evaluated', 'prior-latch-set', 'direct-target', 'page-root-not-committed',
      'current-mount-not-observed', 'target-output-observed', 'repair-error-present',
      'active-key-not-owned', 'render-error-present', 'registration-not-unique',
      'registration-conflict', 'transparent-capability-unavailable',
      'retained-route-unavailable', 'retained-route-not-owned', 'boundary-count-not-one',
      'render-chain-unavailable', 'alternate-fiber-not-observed',
      'stable-rerender-not-observed', 'marked-context-call-not-used',
      'effect-not-completed-after-marked-call', 'logical-target-count-not-one',
      'input-children-not-absent', 'returned-child-observed', 'owned-host-observed', 'none',
    ]);
    const rawMountedDecision = rawChain?.mountedChildrenGateDecision;
    const mountedChildrenGateDecision = rawMountedDecision !== null &&
      typeof rawMountedDecision === 'object'
      ? {
          latchBefore: rawMountedDecision.latchBefore === true,
          directTarget: rawMountedDecision.directTarget === true,
          pageRootCommitted: rawMountedDecision.pageRootCommitted === true,
          currentMount: rawMountedDecision.currentMount === true,
          targetOutput: rawMountedDecision.targetOutput === true,
          repairError: rawMountedDecision.repairError === true,
          activeKey: rawMountedDecision.activeKey === true,
          renderError: rawMountedDecision.renderError === true,
          registrationCount: Number.isSafeInteger(rawMountedDecision.registrationCount) ? Math.max(0, rawMountedDecision.registrationCount) : 0,
          registrationConflict: rawMountedDecision.registrationConflict === true,
          transparentCapability: rawMountedDecision.transparentCapability === true,
          retainedRouteAvailable: rawMountedDecision.retainedRouteAvailable === true,
          retainedRouteOwned: rawMountedDecision.retainedRouteOwned === true,
          boundaryCount: Number.isSafeInteger(rawMountedDecision.boundaryCount) ? Math.max(0, rawMountedDecision.boundaryCount) : 0,
          chainAvailable: rawMountedDecision.chainAvailable === true,
          alternateFiber: rawMountedDecision.alternateFiber === true,
          stableRerender: rawMountedDecision.stableRerender === true,
          markedCall: rawMountedDecision.markedCall === true,
          effectCompleted: rawMountedDecision.effectCompleted === true,
          logicalTargetCount: Number.isSafeInteger(rawMountedDecision.logicalTargetCount) ? Math.max(0, rawMountedDecision.logicalTargetCount) : 0,
          inputChildrenState: rawMountedDecision.inputChildrenState === 'absent' ? 'absent' : 'meaningful-or-unsupported',
          returnedChild: rawMountedDecision.returnedChild === true,
          ownedHost: rawMountedDecision.ownedHost === true,
          latchAfter: rawMountedDecision.latchAfter === true,
          requestAttempted: rawMountedDecision.requestAttempted === true,
          requestAccepted: rawMountedDecision.requestAccepted === true,
          notificationIssued: rawMountedDecision.notificationIssued === true,
          mountedChildrenGateFirstReject: mountedGateRejects.has(rawMountedDecision.mountedChildrenGateFirstReject)
            ? rawMountedDecision.mountedChildrenGateFirstReject
            : 'not-evaluated',
        }
      : {
          latchBefore: false, directTarget: false, pageRootCommitted: false, currentMount: false,
          targetOutput: false, repairError: false, activeKey: false, renderError: false,
          registrationCount: 0, registrationConflict: false, transparentCapability: false,
          retainedRouteAvailable: false, retainedRouteOwned: false, boundaryCount: 0,
          chainAvailable: false, alternateFiber: false, stableRerender: false, markedCall: false,
          effectCompleted: false, logicalTargetCount: 0,
          inputChildrenState: 'meaningful-or-unsupported', returnedChild: false,
          ownedHost: false, latchAfter: false, requestAttempted: false, requestAccepted: false,
          notificationIssued: false, mountedChildrenGateFirstReject: 'not-evaluated',
        };
    const targetRenderCommitChain = rawChain !== null && typeof rawChain === 'object'
      ? {
          alternateFiberObserved: rawChain.alternateFiberObserved === true,
          childrenForwarded: rawChain.childrenForwarded === true,
          connectedHostCount: Number.isSafeInteger(rawChain.connectedHostCount) ? Math.max(0, rawChain.connectedHostCount) : 0,
          effectCompletedAfterMarkedCall: rawChain.effectCompletedAfterMarkedCall === true,
          firstBreak: String(rawChain.firstBreak ?? 'unknown').slice(0, 80),
          markedCallEffectId: String(rawChain.markedCallEffectId ?? '').slice(0, 240),
          markedCallPropertyPath: String(rawChain.markedCallPropertyPath ?? '').slice(0, 240),
          markedCallResult: rawChain.markedCallResult === true,
          ownedHostObserved: rawChain.ownedHostObserved === true,
          inputChildrenState: rawChain.inputChildrenState === 'absent' ? 'absent' : 'meaningful-or-unsupported',
          logicalTargetCount: Number.isSafeInteger(rawChain.logicalTargetCount) ? Math.max(0, rawChain.logicalTargetCount) : 0,
          privateOwnershipCount: Number.isSafeInteger(rawChain.privateOwnershipCount) ? Math.max(0, rawChain.privateOwnershipCount) : 0,
          resolverOutcome: String(rawChain.resolverOutcome ?? 'unknown').slice(0, 80),
          specializedReplacementExecuted: rawChain.specializedReplacementExecuted === true,
          stableRerenderObserved: rawChain.stableRerenderObserved === true,
          topologyVerdict: ['A', 'B', 'C', 'D'].includes(rawChain.topologyVerdict)
            ? rawChain.topologyVerdict : 'D',
          topologyReason: String(rawChain.topologyReason ?? 'current-root-ambiguous-or-resolver-disagrees').slice(0, 80),
          topologyEffectContinuationAccepted: rawChain.topologyEffectContinuationAccepted === true,
          topologyDelayedProbeFired: rawChain.topologyDelayedProbeFired === true,
          topologyBoundaryIdentityRetained: rawChain.topologyBoundaryIdentityRetained === true,
          topologyCurrentBranchAmbiguous: rawChain.topologyCurrentBranchAmbiguous === true,
          topologyCurrentExactTargetCount: Number.isSafeInteger(rawChain.topologyCurrentExactTargetCount) ? Math.max(0, rawChain.topologyCurrentExactTargetCount) : 0,
          topologyLocatorExactTargetCount: Number.isSafeInteger(rawChain.topologyLocatorExactTargetCount) ? Math.max(0, rawChain.topologyLocatorExactTargetCount) : 0,
          topologyCurrentTargetChildCount: Number.isSafeInteger(rawChain.topologyCurrentTargetChildCount) ? Math.max(0, rawChain.topologyCurrentTargetChildCount) : 0,
          topologyCurrentRetainedChildCount: Number.isSafeInteger(rawChain.topologyCurrentRetainedChildCount) ? Math.max(0, rawChain.topologyCurrentRetainedChildCount) : 0,
          topologyCurrentConnectedVisibleHostCount: Number.isSafeInteger(rawChain.topologyCurrentConnectedVisibleHostCount) ? Math.max(0, rawChain.topologyCurrentConnectedVisibleHostCount) : 0,
          topologyCurrentDescendantHostCount: Number.isSafeInteger(rawChain.topologyCurrentDescendantHostCount) ? Math.max(0, rawChain.topologyCurrentDescendantHostCount) : 0,
          topologyStaleExactTargetCount: Number.isSafeInteger(rawChain.topologyStaleExactTargetCount) ? Math.max(0, rawChain.topologyStaleExactTargetCount) : 0,
          topologyStaleConnectedVisibleHostCount: Number.isSafeInteger(rawChain.topologyStaleConnectedVisibleHostCount) ? Math.max(0, rawChain.topologyStaleConnectedVisibleHostCount) : 0,
          thunkTexts: Array.isArray(rawChain.thunkTexts) ? rawChain.thunkTexts.filter((text) => typeof text === 'string').slice(0, 4).map((text) => text.slice(0, 320)) : [],
          mountedChildrenGateDecision,
        }
      : undefined;
    return {
      activeBlockerProvenance,
      activeBlockers: Number.isSafeInteger(detail?.blockerSummary?.active)
        ? Math.max(0, detail.blockerSummary.active)
        : 0,
      criticalEvidenceTruncated:
        detail?.visitLimitReached === true ||
        ['[Depth limit]', '[Node limit]'].includes(detail?.statusCounts) ||
        ['[Depth limit]', '[Node limit]'].includes(detail?.targetState),
      ...(typeof detail?.contextModule?.evidenceKind === 'string'
        ? { contextModuleEvidenceKind: detail.contextModule.evidenceKind.slice(0, 80) }
        : {}),
      ...(Number.isSafeInteger(detail?.contextModule?.importPathLength)
        ? {
            contextModuleImportPathLength: Math.max(
              0,
              Number(detail.contextModule.importPathLength),
            ),
          }
        : {}),
      ...(typeof detail?.contextModule?.sourcePath === 'string'
        ? { contextModuleSourcePath: detail.contextModule.sourcePath.slice(0, 1_024) }
        : {}),
      currentFileMounted: Number.isSafeInteger(counts?.currentFileMounted)
        ? Math.max(0, counts.currentFileMounted)
        : 0,
      hostOutput: Number.isSafeInteger(counts?.hostOutput) ? Math.max(0, counts.hostOutput) : 0,
      ...(typeof pageExecution?.candidateId === 'string'
        ? { pageExecutionCandidateId: pageExecution.candidateId.slice(0, 160) }
        : {}),
      ...(typeof pageExecution?.fidelity === 'string'
        ? { pageExecutionFidelity: pageExecution.fidelity.slice(0, 80) }
        : {}),
      ...(Number.isSafeInteger(pageExecution?.nestedMountCount)
        ? {
            pageExecutionNestedMountCount: Math.max(
              0,
              Number(pageExecution.nestedMountCount),
            ),
          }
        : {}),
      ...(typeof pageExecution?.executionRootSurfaceId === 'string'
        ? { pageExecutionRootSurfaceId: pageExecution.executionRootSurfaceId.slice(0, 240) }
        : {}),
      pageExecutionStandaloneTarget: pageExecution?.standaloneTarget === true,
      ...(typeof pageExecution?.runtimeTargetSurfaceId === 'string'
        ? { pageExecutionTargetSurfaceId: pageExecution.runtimeTargetSurfaceId.slice(0, 240) }
        : {}),
      ...(typeof pageExecution?.targetRole === 'string'
        ? { pageExecutionTargetRole: pageExecution.targetRole.slice(0, 80) }
        : {}),
      requirementSearchExhausted: search?.exhausted === true,
      requirementSearchObservedPathCount: Number.isSafeInteger(search?.observedPathCount)
        ? Math.max(0, Number(search.observedPathCount))
        : 0,
      requirementSearchPass: Number.isSafeInteger(search?.pass)
        ? Math.max(0, Number(search.pass))
        : 0,
      requirementSearchSettled: search?.settled === true,
      requirementSearchStatus: String(search?.searchStatus ?? 'untracked').slice(0, 80),
      requirementSearchTotalPasses: Number.isSafeInteger(search?.totalPasses)
        ? Math.max(0, Number(search.totalPasses))
        : 0,
      targetAppliedConditionCount: Number.isSafeInteger(target?.appliedConditionCount)
        ? Math.max(0, Number(target.appliedConditionCount))
        : 0,
      targetDetachedBoundaryOutput: target?.detachedBoundaryOutput === true,
      frameworkNavigationPending: target?.frameworkNavigationPending === true,
      frameworkControlBlocked: target?.frameworkControlBlocked === true,
      targetDetachedTargetPlacement: String(target?.detachedTargetPlacement ?? '').slice(0, 80),
      targetDirectElementOutput: target?.directElementOutput === true,
      targetAttempt: Number.isSafeInteger(target?.attempt)
        ? Math.max(0, Number(target.attempt))
        : 0,
      targetAutoAttemptMode: String(target?.activeAutoAttemptMode ?? '').slice(0, 80),
      targetAutoAttemptResumeHandled: target?.activeAutoAttemptResumeHandled === true,
      targetAutoAttemptResumeScheduled: target?.activeAutoAttemptResumeScheduled === true,
      targetAutoAttemptSettled: target?.activeAutoAttemptSettled === true,
      targetContextualFallbackRequested: target?.contextualTargetFallbackRequested === true,
      targetError:
        targetErrorMessage !== undefined ||
        targetErrorDetails !== undefined ||
        targetErrorLocation !== undefined ||
        targetErrorOwner !== undefined ||
        targetErrorPhase !== undefined ||
        targetErrorStack !== undefined ||
        targetFallbackOwner !== undefined,
      ...(targetErrorDetails === undefined ? {} : { targetErrorDetails }),
      ...(targetErrorLocation === undefined ? {} : { targetErrorLocation }),
      ...(targetErrorMessage === undefined ? {} : { targetErrorMessage }),
      ...(targetErrorOwner === undefined ? {} : { targetErrorOwner }),
      ...(targetErrorPhase === undefined ? {} : { targetErrorPhase }),
      ...(targetErrorStack === undefined ? {} : { targetErrorStack }),
      targetExportName: String(target?.exportName ?? 'default').slice(0, 160),
      targetHasOutput: target?.hasOutput === true || target?.reachabilityHasOutput === true,
      targetIdlePasses: Number.isSafeInteger(target?.idlePasses)
        ? Math.max(0, Number(target.idlePasses))
        : 0,
      targetLastContinuationSkipReason: String(
        target?.lastContinuationSkipReason ?? '',
      ).slice(0, 120),
      targetMounted: target?.mounted === true,
      targetOutputKind: String(target?.outputKind ?? 'none').slice(0, 80),
      targetOwnershipPhases: ownershipPhases,
      targetPageRootCommitted: target?.pageRootCommitted === true,
      targetProbeRevision: Number.isSafeInteger(target?.probeRevision)
        ? Math.max(0, Number(target.probeRevision))
        : 0,
      targetProjectedCompatibilityOutput: target?.projectedCompatibilityOutput === true,
      targetRejectedConditionCount: Number.isSafeInteger(target?.rejectedConditionCount)
        ? Math.max(0, Number(target.rejectedConditionCount))
        : 0,
      targetRuntimeFallbackSummaries: Array.isArray(target?.runtimeFallbackSummaries)
        ? target.runtimeFallbackSummaries
            .filter((value) => typeof value === 'string')
            .slice(0, 12)
            .map((value) => value.slice(0, 1_000))
        : [],
      targetEffectControllerOutput: target?.targetEffectControllerOutput === true,
      targetRenderedEmpty: target?.targetRenderedEmpty === true,
      ...(targetRenderCommitChain === undefined ? {} : { targetRenderCommitChain }),
      ...(typeof detail?.evidence?.sourcePath === 'string'
        ? { targetSourcePath: detail.evidence.sourcePath.slice(0, 1_024) }
        : {}),
      targetStage: String(target?.stage ?? 'unknown').slice(0, 80),
      targetStatus: String(target?.status ?? 'unknown').slice(0, 80),
      targetWasMounted: target?.wasMounted === true,
      ...(typeof detail?.route?.pathname === 'string'
        ? { selectedRoutePathname: detail.route.pathname.slice(0, 2_048) }
        : {}),
    };
  };
  const pendingCompositionStatuses = new Set([
    'activating-authored-state',
    'advancing',
    'blocked',
    'filling-requirements',
    'mounting-contextual-target',
    'page-root-pending',
    'probing',
    'recovering-after-rejected-gate',
    'resolving-deferred-render-contract',
    'retrying-page-execution',
    'resuming-new-requirements',
    'revealing-overlay',
    'searching-deterministic-requirements',
    'searching-requirements',
    'settling-auto-attempt',
    'settling-neural-render-state',
  ]);
  const isCompositionPending = () => {
    const composition = bridgeState.latestComposition;
    if (composition === undefined) return true;
    if (composition.frameworkNavigationPending === true || composition.frameworkControlBlocked === true) return true;
    if (
      composition.targetStage === 'target-output' &&
      composition.targetStatus === 'reached' &&
      composition.targetHasOutput === true
    ) return false;
    // A file-only component has no Page Execution corridor or requirement-search lifecycle. Its
    // runtime-ready signal plus one quiet composition snapshot is already the complete contract.
    if (composition.pageExecutionFidelity === 'none') return false;
    // An attempt's own start/settle events decide whether it is in flight. The snapshot copy can
    // stay stale: snapshots are re-published only when their digest changes, and only corridor
    // modes ever set the resume flags, so a settled data or neural attempt looked open forever.
    if (bridgeState.openRenderAttempts.size > 0) return true;
    if (
      composition.targetAutoAttemptMode &&
      composition.targetAutoAttemptResumeScheduled === true
    ) return true;
    if (
      composition.targetStatus === 'settling-neural-render-state' ||
      composition.targetStatus === 'retrying-page-execution'
    ) return true;
    if (pendingCompositionStatuses.has(composition.targetStatus)) {
      return composition.requirementSearchExhausted !== true;
    }
    return composition.requirementSearchSettled !== true &&
      composition.requirementSearchExhausted !== true;
  };
  const capturePayload = () => {
    if (bridgeState.published) return;
    bridgeState.published = true;
    const root = selectMountNode();
    const progressHost = document.getElementById('react-preview-progress-host');
    const runtimeError = root?.querySelector('.react-preview-runtime-error');
    const now = Date.now();
    const payload = {
      evidence: { consoleFailures, extensionMessages: messages, windowErrors },
      neuralResidualModel: latestNeuralModel,
      rootHtml: readRenderedHtml(root, ${MAX_CAPTURE_BYTES.toString()}),
      runtimeErrorText: runtimeError?.textContent?.slice(0, maxText),
      stabilization: {
        capReached:
          bridgeState.terminal?.type === 'react-preview-runtime-ready' &&
          now - bridgeState.terminalAt >= ${PREVIEW_HEADLESS_STABILIZATION_CAP_MS.toString()},
        ...(bridgeState.latestComposition === undefined
          ? {}
          : { compositionSnapshot: bridgeState.latestComposition }),
        durationMs: Math.max(0, now - bridgeState.terminalAt),
        messagesTruncated: evidenceTruncated,
        mountMutationCount: bridgeState.mountMutationCount,
        postTerminalSnapshotReceived: bridgeState.snapshotCount > 0,
        progressVisible: progressHost !== null && progressHost.hidden !== true,
        quiet:
          bridgeState.terminal?.type === 'react-preview-runtime-ready' &&
          bridgeState.snapshotCount > 0 &&
          !isCompositionPending() &&
          now - bridgeState.lastActivityAt >= ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()},
        ...(bridgeState.routerScopeTransition === undefined
          ? {}
          : { routerScopeTransition: bridgeState.routerScopeTransition }),
        snapshotCount: bridgeState.snapshotCount,
        structuredRuntimeError: bridgeState.structuredRuntimeError,
      },
      terminal: bridgeState.terminal,
    };
    const binding = globalThis[bindingName];
    if (typeof binding === 'function') binding(JSON.stringify(payload));
  };
  const scheduleReadyCheck = () => {
    if (!requireCompositionSnapshot) {
      setTimeout(capturePayload, 0);
      return;
    }
    const check = () => {
      if (bridgeState.published || bridgeState.terminalAt === undefined) return;
      const now = Date.now();
      const quiet =
        bridgeState.snapshotCount > 0 &&
        now - bridgeState.lastActivityAt >= ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()};
      const capped =
        now - bridgeState.terminalAt >= ${PREVIEW_HEADLESS_STABILIZATION_CAP_MS.toString()};
      if ((quiet && !isCompositionPending()) || capped) capturePayload();
      else setTimeout(check, Math.min(50, Math.max(1,
        ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()} -
          (now - bridgeState.lastActivityAt))));
    };
    setTimeout(check, 0);
  };
  const settle = (message) => {
    if (bridgeState.terminal !== undefined) return;
    bridgeState.terminal = { revision: message.revision, token: message.token, type: message.type };
    bridgeState.terminalAt = Date.now();
    bridgeState.lastActivityAt = bridgeState.terminalAt;
    if (message.type === 'react-preview-runtime-failed') {
      setTimeout(capturePayload, ${PREVIEW_HEADLESS_FAILED_CAPTURE_MS.toString()});
    } else {
      scheduleReadyCheck();
    }
  };
  const vscode = Object.freeze({
    getState: () => vscodeState,
    postMessage: (message) => {
      retain(messages, message);
      if (message?.type === 'react-preview-neural-model-sync') latestNeuralModel = message.model;
      if (
        message?.type === 'react-preview-runtime-health' &&
        message?.runtimeRevision === expectedRevision
      ) {
        const event = message?.event?.event;
        const category = message?.event?.category;
        const transition = message?.event?.detail?.transition;
        if (
          category === 'router-scope' &&
          (transition === 'recovering' || transition === 'recovered' || transition === 'unresolved')
        ) {
          bridgeState.routerScopeTransition = transition;
        }
        if (event === 'page-composition-snapshot') {
          const composition = readComposition(message);
          if (composition !== undefined) {
            bridgeState.latestComposition = composition;
            bridgeState.snapshotCount += 1;
            markActivity();
          }
        } else if (
          event === 'render-attempt-started' ||
          event === 'render-attempt-settled' ||
          String(event ?? '').startsWith('runtime-error')
        ) {
          if (String(event ?? '').startsWith('runtime-error')) {
            bridgeState.structuredRuntimeError = true;
          }
          const traceId = message?.event?.detail?.traceId;
          if (typeof traceId === 'string' && event === 'render-attempt-started') {
            bridgeState.openRenderAttempts.add(traceId);
          } else if (typeof traceId === 'string' && event === 'render-attempt-settled') {
            bridgeState.openRenderAttempts.delete(traceId);
          }
          markActivity();
        }
      }
      if (
        (message?.type === 'react-preview-runtime-ready' ||
          message?.type === 'react-preview-runtime-failed') &&
        message.token === expectedToken &&
        message.revision === expectedRevision
      ) settle(message);
      return Promise.resolve(true);
    },
    setState: (value) => { vscodeState = value; return value; },
  });
  globalThis.acquireVsCodeApi = () => vscode;
  for (const method of ['error', 'warn']) {
    const original = console[method].bind(console);
    console[method] = (...values) => { retain(consoleFailures, values); original(...values); };
  }
  addEventListener('error', (event) => {
    try {
      if (event.error?.[routeErrorProbeSymbol] === true) {
        event.preventDefault?.();
        return;
      }
    } catch { /* An uninspectable project error follows the ordinary evidence path. */ }
    retain(windowErrors, event.error ?? event.message);
    markActivity();
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const retainUnhandledRejection = () => {
      /*
       * The generated preview entry may prove that a render-only rejection is non-fatal and call
       * preventDefault from a listener installed after this pre-entry bridge. Defer observation
       * until dispatch completes so headless classification follows the browser runtime's final
       * decision instead of preserving a false post-commit blocker.
       */
      if (event.defaultPrevented) return;
      retain(windowErrors, reason);
      markActivity();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(retainUnhandledRejection);
    else Promise.resolve().then(retainUnhandledRejection, retainUnhandledRejection);
  });
  const observeMount = () => {
    const root = selectMountNode();
    if (root === null) {
      setTimeout(observeMount, 10);
      return;
    }
    new MutationObserver(() => {
      if (bridgeState.terminal?.type !== 'react-preview-runtime-ready') return;
      bridgeState.mountMutationCount += 1;
      markActivity();
    }).observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
  };
  observeMount();
})();
`;
}
