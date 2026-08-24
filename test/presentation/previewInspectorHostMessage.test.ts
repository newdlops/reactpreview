/**
 * Verifies Page Inspector host routing for non-focusing tree-source selections. Claimed malformed
 * messages must stop at this boundary, while validated location and clear requests are delegated to
 * the panel-owned decoration service before unrelated runtime handlers run.
 */
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handlePreviewInspectorHostMessage,
  type PreviewInspectorHostMessageContext,
} from '../../src/presentation/previewInspectorHostMessage';

const handlerState = vi.hoisted(() => ({
  blocker: vi.fn(() => false),
  health: vi.fn(() => false),
  navigation: vi.fn(() => false),
}));

vi.mock('../../src/presentation/previewBlockerTraceLogger', () => ({
  handlePreviewBlockerTraceMessage: handlerState.blocker,
}));
vi.mock('../../src/presentation/previewRuntimeHealthLogger', () => ({
  handlePreviewRuntimeHealthMessage: handlerState.health,
}));
vi.mock('../../src/presentation/previewInspectorSourceNavigation', () => ({
  handlePreviewInspectorSourceNavigationMessage: handlerState.navigation,
}));

const SOURCE_PATH = path.normalize('/workspace/src/Card.tsx');

beforeEach(() => {
  vi.clearAllMocks();
  handlerState.blocker.mockReturnValue(false);
  handlerState.health.mockReturnValue(false);
  handlerState.navigation.mockReturnValue(false);
});

describe('handlePreviewInspectorHostMessage source selection', () => {
  /** Accepts the newest loading revision so persisted learning is not lost before ready settles. */
  it('routes a bounded anonymous neural model from the expected runtime revision', () => {
    const { context, synchronizeNeuralResidualModel } = createContext();
    const model = createNeuralModel();

    expect(
      handlePreviewInspectorHostMessage(
        {
          model,
          runtimeRevision: 13,
          type: 'react-preview-neural-model-sync',
        },
        { ...context, expectedNeuralRuntimeRevision: 13 },
      ),
    ).toBe(true);
    expect(synchronizeNeuralResidualModel).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateOutcomes: {},
        outcomeSequence: 0,
        updates: 3,
        version: 4,
      }),
      13,
    );
    expect(handlerState.health).not.toHaveBeenCalled();
  });

  /** Consumes model-shaped hostile traffic without persisting raw candidate identifiers. */
  it('rejects malformed or stale neural model synchronization', () => {
    const { context, debug, synchronizeNeuralResidualModel } = createContext();

    expect(
      handlePreviewInspectorHostMessage(
        {
          model: {
            ...createNeuralModel(),
            candidateOutcomes: {
              'condition:raw-project-candidate': {
                attempts: 1,
                consecutiveFailures: 0,
                lastLabel: 1,
                rewardSum: 1,
                sequence: 1,
              },
            },
          },
          runtimeRevision: 11,
          type: 'react-preview-neural-model-sync',
        },
        context,
      ),
    ).toBe(true);
    expect(synchronizeNeuralResidualModel).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      'Ignored a malformed, disabled, or stale React Inspector neural model.',
    );
  });

  /** Rebuilds only for a route hierarchy offered by the currently committed runtime revision. */
  it('routes a current hierarchical application path selection', () => {
    const { context, selectRoute } = createContext();
    const selectionPath = [
      { componentName: 'CompanyApp', pattern: '/company/:companyId/*' },
      { componentName: 'SettingsPage', pattern: '/company/:companyId/settings' },
    ];

    expect(
      handlePreviewInspectorHostMessage(
        {
          branchId: 'route-0123456789abcdef0123',
          interactionId: 'route:12:1',
          runtimeRevision: 12,
          selectionPath,
          type: 'react-preview-inspector-route-selected',
        },
        context,
      ),
    ).toBe(true);
    expect(selectRoute).toHaveBeenCalledWith({
      branchId: 'route-0123456789abcdef0123',
      interactionId: 'route:12:1',
      runtimeRevision: 12,
      selectionPath,
      type: 'react-preview-inspector-route-selected',
    });
    expect(handlerState.health).not.toHaveBeenCalled();
  });

  /** The protocol envelope must not reintroduce the former eight-owner compiler graph budget. */
  it('accepts a deeply nested compiler-proven route selection path', () => {
    const { context, selectRoute } = createContext();
    const selectionPath = Array.from({ length: 12 }, (_value, index) => ({
      componentName: `Owner${index.toString()}`,
      pattern: `/${Array.from(
        { length: index + 1 },
        (_segment, segmentIndex) => `level-${segmentIndex.toString()}`,
      ).join('/')}`,
    }));

    expect(
      handlePreviewInspectorHostMessage(
        {
          branchId: 'route-0123456789abcdef0123',
          interactionId: 'route:12:deep',
          runtimeRevision: 12,
          selectionPath,
          type: 'react-preview-inspector-route-selected',
        },
        context,
      ),
    ).toBe(true);
    expect(selectRoute).toHaveBeenCalledWith(expect.objectContaining({ selectionPath }));
  });

  /** Rebuilds one active candidate while keeping all alternate candidates descriptor-only. */
  it('routes a current page candidate selection', () => {
    const { context, selectPageCandidate } = createContext();

    expect(
      handlePreviewInspectorHostMessage(
        {
          candidateId: 'page:settings-1',
          interactionId: 'page:12:1',
          runtimeRevision: 12,
          type: 'react-preview-inspector-page-candidate-selected',
        },
        context,
      ),
    ).toBe(true);
    expect(selectPageCandidate).toHaveBeenCalledWith({
      candidateId: 'page:settings-1',
      interactionId: 'page:12:1',
      runtimeRevision: 12,
      type: 'react-preview-inspector-page-candidate-selected',
    });
  });

  /** Consumes a stale route click without allowing an old webview to replace the new branch. */
  it('rejects a stale hierarchical application path selection', () => {
    const { context, debug, selectRoute } = createContext();

    expect(
      handlePreviewInspectorHostMessage(
        {
          branchId: 'route-0123456789abcdef0123',
          interactionId: 'route:11:1',
          runtimeRevision: 11,
          selectionPath: [{ componentName: 'OldPage', pattern: '/old' }],
          type: 'react-preview-inspector-route-selected',
        },
        context,
      ),
    ).toBe(true);
    expect(selectRoute).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('stale'));
  });

  /** Routes a valid passive JSX branch inventory before any unrelated runtime protocol. */
  it('routes branch source decorations to the panel-owned decoration service', () => {
    const { context, decorateBranches } = createContext();
    const message = {
      runtimeRevision: 12,
      sequence: 2,
      sources: [{ column: 4, line: 7, sourcePath: SOURCE_PATH }],
      type: 'react-preview-inspector-branch-sources',
    };

    expect(handlePreviewInspectorHostMessage(message, context)).toBe(true);
    expect(decorateBranches).toHaveBeenCalledWith(message, context);
    expect(handlerState.health).not.toHaveBeenCalled();
    expect(handlerState.navigation).not.toHaveBeenCalled();
  });

  /** Delegates validated source metadata and the complete current session context synchronously. */
  it('routes a located tree selection to the decoration service', () => {
    const { context, select } = createContext();
    const message = {
      approximate: false,
      column: 4,
      line: 7,
      runtimeRevision: 12,
      sequence: 3,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-source-selected',
    };

    expect(handlePreviewInspectorHostMessage(message, context)).toBe(true);

    expect(select).toHaveBeenCalledWith(message, context);
    expect(handlerState.health).not.toHaveBeenCalled();
    expect(handlerState.navigation).not.toHaveBeenCalled();
  });

  /** Preserves the path-free clear envelope so the service can remove an existing editor mark. */
  it('routes a clear selection to the decoration service', () => {
    const { context, select } = createContext();
    const message = {
      runtimeRevision: 12,
      sequence: 4,
      type: 'react-preview-inspector-source-selected',
    };

    expect(handlePreviewInspectorHostMessage(message, context)).toBe(true);
    expect(select).toHaveBeenCalledWith(message, context);
  });

  /** Consumes a malformed claimed message and reports it without reaching another host protocol. */
  it('rejects malformed claimed selections at the routing boundary', () => {
    const { context, debug, select } = createContext();

    expect(
      handlePreviewInspectorHostMessage(
        {
          runtimeRevision: 12,
          sequence: 0,
          type: 'react-preview-inspector-source-selected',
        },
        context,
      ),
    ).toBe(true);

    expect(select).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('malformed'));
    expect(handlerState.health).not.toHaveBeenCalled();
  });

  /** Leaves unrelated traffic on the established health, blocker, and source-navigation chain. */
  it('retains existing host routing for unrelated messages', () => {
    const { context, select } = createContext();
    handlerState.navigation.mockReturnValue(true);

    expect(handlePreviewInspectorHostMessage({ type: 'unrelated' }, context)).toBe(true);

    expect(select).not.toHaveBeenCalled();
    expect(handlerState.health).toHaveBeenCalledTimes(1);
    expect(handlerState.blocker).toHaveBeenCalledTimes(1);
    expect(handlerState.navigation).toHaveBeenCalledTimes(1);
  });

  /** Stops optional replacement only after the current runtime proves detail-complete output. */
  it('settles a current detail-complete target-output health event', () => {
    const { context, settleVerifiedTargetOutput } = createContext();
    handlerState.health.mockReturnValue(true);
    const message = createTargetOutputHealthMessage();

    expect(handlePreviewInspectorHostMessage(message, context)).toBe(true);

    expect(settleVerifiedTargetOutput).toHaveBeenCalledTimes(1);
    expect(settleVerifiedTargetOutput).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: '0123456789abcdef', runtimeRevision: 12 }),
    );
  });

  /** A useful fast paint still receives corridor refinement while visual projections remain. */
  it('does not settle target output with incomplete context or shallow visual debt', () => {
    const { context, settleVerifiedTargetOutput } = createContext();
    handlerState.health.mockReturnValue(true);

    expect(
      handlePreviewInspectorHostMessage(
        createTargetOutputHealthMessage({ candidateComplete: false }),
        context,
      ),
    ).toBe(true);
    expect(
      handlePreviewInspectorHostMessage(
        createTargetOutputHealthMessage({ projectionCount: 3 }),
        context,
      ),
    ).toBe(true);

    expect(settleVerifiedTargetOutput).not.toHaveBeenCalled();
  });

  /** The session owns artifact overlap correlation while a newer replacement is preparing. */
  it('forwards exact target output after the displayed revision marker has advanced', () => {
    const { context, settleVerifiedTargetOutput } = createContext();
    handlerState.health.mockReturnValue(true);
    const message = createTargetOutputHealthMessage();

    expect(
      handlePreviewInspectorHostMessage(message, { ...context, currentRuntimeRevision: 13 }),
    ).toBe(true);

    expect(settleVerifiedTargetOutput).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: '0123456789abcdef', runtimeRevision: 12 }),
    );
  });

  /** A partial render or active blocker must not suppress the enrichment that may repair it. */
  it('does not settle target output while active blocker provenance remains', () => {
    const { context, settleVerifiedTargetOutput } = createContext();
    handlerState.health.mockReturnValue(true);
    const message = createTargetOutputHealthMessage({ activeBlockers: 1 });

    expect(handlePreviewInspectorHostMessage(message, context)).toBe(true);

    expect(settleVerifiedTargetOutput).not.toHaveBeenCalled();
  });

  /** Forwards the panel-owned direct command while leaving all Inspector gates disabled. */
  it('routes direct blocker traces with the direct command expectation only', () => {
    const { context } = createContext();
    const directContext: PreviewInspectorHostMessageContext = {
      ...context,
      enabled: false,
      expectedPreviewCommand: 'direct-preview',
    };
    handlerState.blocker.mockReturnValue(true);

    expect(
      handlePreviewInspectorHostMessage({ type: 'react-preview-blocker-trace' }, directContext),
    ).toBe(true);
    expect(handlerState.health).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
    expect(handlerState.blocker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false, expectedPreviewCommand: 'direct-preview' }),
    );
    expect(handlerState.navigation).not.toHaveBeenCalled();
  });
});

/** Test context plus direct spy references that avoid extracting class methods from typed objects. */
interface TestPreviewInspectorHostMessageContext {
  readonly context: PreviewInspectorHostMessageContext;
  readonly debug: ReturnType<typeof vi.fn>;
  readonly decorateBranches: ReturnType<typeof vi.fn>;
  readonly select: ReturnType<typeof vi.fn>;
  readonly selectRoute: ReturnType<typeof vi.fn>;
  readonly selectPageCandidate: ReturnType<typeof vi.fn>;
  readonly settleVerifiedTargetOutput: ReturnType<typeof vi.fn>;
  readonly synchronizeNeuralResidualModel: ReturnType<typeof vi.fn>;
}

/** Creates the smallest structurally complete host context used by protocol routing tests. */
function createContext(): TestPreviewInspectorHostMessageContext {
  const debug = vi.fn();
  const decorateBranches = vi.fn();
  const select = vi.fn();
  const selectRoute = vi.fn();
  const selectPageCandidate = vi.fn();
  const settleVerifiedTargetOutput = vi.fn();
  const synchronizeNeuralResidualModel = vi.fn();
  const context = {
    currentRuntimeRevision: 12,
    dependencyPaths: new Set([SOURCE_PATH]),
    enabled: true,
    expectedPreviewCommand: 'page-inspector' as const,
    gestureGate: {} as PreviewInspectorHostMessageContext['gestureGate'],
    log: { debug, info: vi.fn() } as unknown as PreviewInspectorHostMessageContext['log'],
    panelViewColumn: undefined,
    pinnedDocumentUri: {} as PreviewInspectorHostMessageContext['pinnedDocumentUri'],
    selectRoute,
    selectPageCandidate,
    settleVerifiedTargetOutput,
    sourceDecoration: {
      decorateBranches,
      select,
    } as unknown as PreviewInspectorHostMessageContext['sourceDecoration'],
    synchronizeNeuralResidualModel,
    targetPath: SOURCE_PATH,
  };
  return {
    context,
    debug,
    decorateBranches,
    select,
    selectRoute,
    selectPageCandidate,
    settleVerifiedTargetOutput,
    synchronizeNeuralResidualModel,
  };
}

/** Creates the previous version-three shape to prove host-side migration keeps its weights. */
function createNeuralModel(): Record<string, unknown> {
  return {
    heads: {
      condition: {
        outputBias: 0.25,
        outputWeights: Array(16).fill(0.1),
        updates: 3,
      },
    },
    updates: 3,
    version: 3,
  };
}

/** Creates one fully correlated composition record accepted by the untrusted health protocol. */
function createTargetOutputHealthMessage(
  options: {
    readonly activeBlockers?: number;
    readonly candidateComplete?: boolean;
    readonly projectionCount?: number;
  } = {},
): Record<string, unknown> {
  const activeBlockers = options.activeBlockers ?? 0;
  return {
    artifactId: '0123456789abcdef',
    event: {
      category: 'page-composition',
      detail: {
        activeBlockerProvenance:
          activeBlockers === 0
            ? []
            : [{ active: true, kind: 'target-reachability', name: 'Target blocked' }],
        blockerSummary: { active: activeBlockers },
        candidate: { complete: options.candidateComplete ?? true },
        projectionSummary: { count: options.projectionCount ?? 0, observed: true },
        targetState: {
          hasOutput: true,
          mounted: true,
          outputKind: 'target-output',
          pageRootCommitted: true,
          stage: 'target-output',
          status: 'reached',
        },
      },
      event: 'page-composition-snapshot',
      eventId: 'runtime-health-1',
      revision: 0,
      sequence: 1,
      severity: 'info',
      timestamp: '2026-08-02T00:00:00.000Z',
    },
    runtimeRevision: 12,
    runtimeSessionId: 'rp-0123456789abcdef01234567',
    type: 'react-preview-runtime-health',
  };
}
