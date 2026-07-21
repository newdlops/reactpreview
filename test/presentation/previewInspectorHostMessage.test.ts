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
});

/** Test context plus direct spy references that avoid extracting class methods from typed objects. */
interface TestPreviewInspectorHostMessageContext {
  readonly context: PreviewInspectorHostMessageContext;
  readonly debug: ReturnType<typeof vi.fn>;
  readonly select: ReturnType<typeof vi.fn>;
}

/** Creates the smallest structurally complete host context used by protocol routing tests. */
function createContext(): TestPreviewInspectorHostMessageContext {
  const debug = vi.fn();
  const select = vi.fn();
  const context = {
    currentRuntimeRevision: 12,
    dependencyPaths: new Set([SOURCE_PATH]),
    enabled: true,
    gestureGate: {} as PreviewInspectorHostMessageContext['gestureGate'],
    log: { debug, info: vi.fn() } as unknown as PreviewInspectorHostMessageContext['log'],
    panelViewColumn: undefined,
    pinnedDocumentUri: {} as PreviewInspectorHostMessageContext['pinnedDocumentUri'],
    sourceDecoration: {
      select,
    } as unknown as PreviewInspectorHostMessageContext['sourceDecoration'],
    targetPath: SOURCE_PATH,
  };
  return { context, debug, select };
}
