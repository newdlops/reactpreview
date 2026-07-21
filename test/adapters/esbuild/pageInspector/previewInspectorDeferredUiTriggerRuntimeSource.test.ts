/** Verifies dormant metadata, mounted-callable safety, and explicit trigger activation. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createPreviewInspectorDeferredUiTriggerRuntimeSource,
  PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDeferredUiTriggerRuntimeSource';

interface DeferredUiTriggerHarness {
  readonly getOwnDataReadCount: () => number;
  readonly invoke: (id: string) => boolean;
  readonly read: () => readonly Record<string, unknown>[];
  readonly register: (handler: unknown, metadata: Record<string, unknown>) => unknown;
  readonly registerMetadata: (metadata: Record<string, unknown>) => void;
  readonly resetOwnDataReadCount: () => void;
  readonly session: {
    boundariesByExport: Map<string, Set<{ fiber: TestFiber }>>;
    deferredUiTriggerRecords?: Map<string, unknown>;
    selectedExportName: string;
  };
  readonly warnings: unknown[][];
}

interface TestFiber {
  readonly child?: TestFiber;
  readonly memoizedProps?: Record<string, unknown>;
  readonly sibling?: TestFiber;
}

const BASE_METADATA = {
  column: 18,
  eventName: 'onClick',
  expression: '() => modal.show()',
  id: 'deferred-ui:example',
  invocationSafe: true,
  line: 7,
  methodName: 'show',
  ownerName: 'Example',
  sourcePath: '/workspace/Example.tsx',
};

describe('Preview Inspector deferred UI trigger runtime source', () => {
  it('shows inert metadata before mount and enables only the exact mounted callable', async () => {
    const handler = vi.fn();
    const harness = createHarness();

    harness.registerMetadata(BASE_METADATA);
    await Promise.resolve();
    expect(harness.read()).toEqual([
      expect.objectContaining({ available: false, id: BASE_METADATA.id, status: 'dormant' }),
    ]);
    expect(harness.invoke(BASE_METADATA.id)).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    expect(harness.register(handler, BASE_METADATA)).toBe(handler);
    expect(harness.read()[0]).toMatchObject({ available: false, status: 'dormant' });
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );

    expect(harness.read()[0]).toMatchObject({ available: true, status: 'ready' });
    expect(harness.invoke(BASE_METADATA.id)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith();
    expect(harness.read()[0]).toMatchObject({
      activationCount: 1,
      available: true,
      status: 'invoked',
    });

    harness.session.boundariesByExport.clear();
    expect(harness.invoke(BASE_METADATA.id)).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('warns and records a bounded message when a mounted handler throws', () => {
    const harness = createHarness();
    const handler = vi.fn(() => {
      throw new Error('dialog service unavailable');
    });
    harness.register(handler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );

    expect(harness.invoke(BASE_METADATA.id)).toBe(false);
    expect(harness.read()[0]).toMatchObject({
      available: true,
      lastError: 'dialog service unavailable',
      status: 'failed',
    });
    expect(harness.warnings).toEqual([
      expect.arrayContaining([
        expect.stringContaining('Deferred UI trigger failed: show()'),
        'dialog service unavailable',
      ]),
    ]);
  });

  it('keeps direct property references dormant even when their exact function is mounted', () => {
    const harness = createHarness();
    const handler = vi.fn();
    const metadata = {
      ...BASE_METADATA,
      expression: 'actions.show',
      invocationSafe: false,
    };
    harness.register(handler, metadata);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );

    expect(harness.read()[0]).toMatchObject({
      available: false,
      invocationSafe: false,
      mounted: true,
      unavailableReason: 'zero-argument invocation contract not proven',
    });
    expect(harness.invoke(metadata.id)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects different mounted closures registered by multiple instances of one source ID', () => {
    const harness = createHarness();
    const firstInstanceHandler = vi.fn();
    const secondInstanceHandler = vi.fn();
    harness.register(firstInstanceHandler, BASE_METADATA);
    harness.register(secondInstanceHandler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([
        {
          fiber: {
            child: {
              memoizedProps: { onClick: firstInstanceHandler },
              sibling: { memoizedProps: { onClick: secondInstanceHandler } },
            },
          },
        },
      ]),
    );

    expect(harness.read()[0]).toMatchObject({
      ambiguous: true,
      available: false,
      mounted: true,
      unavailableReason: 'handler occurrence cannot be uniquely matched to this source',
    });
    expect(harness.invoke(BASE_METADATA.id)).toBe(false);
    expect(firstInstanceHandler).not.toHaveBeenCalled();
    expect(secondInstanceHandler).not.toHaveBeenCalled();
  });

  it('invokes the only mounted closure instead of the most recently registered closure', () => {
    const harness = createHarness();
    const mountedHandler = vi.fn();
    const laterUnmountedHandler = vi.fn();
    harness.register(mountedHandler, BASE_METADATA);
    harness.register(laterUnmountedHandler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: mountedHandler } } } }]),
    );

    expect(harness.read()[0]).toMatchObject({ ambiguous: false, available: true, mounted: true });
    expect(harness.invoke(BASE_METADATA.id)).toBe(true);
    expect(mountedHandler).toHaveBeenCalledOnce();
    expect(laterUnmountedHandler).not.toHaveBeenCalled();
  });

  it('does not escape through a boundary root sibling and rejects shared occurrence identities', () => {
    const harness = createHarness();
    const handler = vi.fn();
    harness.register(handler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([
        {
          fiber: {
            child: { memoizedProps: {} },
            sibling: { memoizedProps: { onClick: handler } },
          },
        },
      ]),
    );
    expect(harness.read()[0]).toMatchObject({ available: false, mounted: false });

    const secondMetadata = {
      ...BASE_METADATA,
      expression: '() => modal.show() /* second */',
      id: 'deferred-ui:second',
    };
    harness.register(handler, secondMetadata);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );
    expect(harness.read()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ambiguous: true, available: false, id: BASE_METADATA.id }),
        expect.objectContaining({ ambiguous: true, available: false, id: secondMetadata.id }),
      ]),
    );
    expect(harness.invoke(BASE_METADATA.id)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('collapses composite-to-host forwarding but rejects two sibling handler occurrences', () => {
    const harness = createHarness();
    const handler = vi.fn();
    harness.register(handler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([
        {
          fiber: {
            child: {
              child: { memoizedProps: { onClick: handler } },
              memoizedProps: { onClick: handler },
            },
          },
        },
      ]),
    );
    expect(harness.read()[0]).toMatchObject({ ambiguous: false, available: true });

    harness.session.boundariesByExport.set(
      'default',
      new Set([
        {
          fiber: {
            child: {
              memoizedProps: { onClick: handler },
              sibling: { memoizedProps: { onClick: handler } },
            },
          },
        },
      ]),
    );
    expect(harness.read()[0]).toMatchObject({ ambiguous: true, available: false });
  });

  it('never proves a selected trigger from another export boundary', () => {
    const harness = createHarness();
    const handler = vi.fn();
    harness.register(handler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: {} } } }]),
    );
    harness.session.boundariesByExport.set(
      'other',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );

    expect(harness.read()[0]).toMatchObject({ available: false, mounted: false });
  });

  it('marks repeated identifier source occurrences ambiguous before every handler registers', () => {
    const harness = createHarness();
    const handler = vi.fn();
    const identifierMetadata = { ...BASE_METADATA, expression: 'handleOpen' };
    harness.register(handler, identifierMetadata);
    harness.registerMetadata({ ...identifierMetadata, id: 'deferred-ui:identifier-second' });
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );

    expect(harness.read()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ambiguous: true, available: false, id: BASE_METADATA.id }),
        expect.objectContaining({
          ambiguous: true,
          available: false,
          id: 'deferred-ui:identifier-second',
        }),
      ]),
    );
  });

  it('scans the boundary child subtree once regardless of trigger record count', () => {
    const harness = createHarness();
    const handler = vi.fn();
    harness.register(handler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: createFiberChain(40, handler) } }]),
    );
    harness.resetOwnDataReadCount();
    harness.read();
    const oneRecordReads = harness.getOwnDataReadCount();

    for (let index = 0; index < 80; index += 1) {
      harness.register(() => undefined, {
        ...BASE_METADATA,
        expression: `() => dialog${index.toString()}.open()`,
        id: `deferred-ui:scan-${index.toString()}`,
      });
    }
    harness.resetOwnDataReadCount();
    harness.read();

    expect(harness.getOwnDataReadCount()).toBe(oneRecordReads);
  });

  it('assimilates a returned thenable once and never coerces hostile thrown objects', async () => {
    const harness = createHarness();
    let thenReads = 0;
    const thenable = {
      get then() {
        thenReads += 1;
        return (resolve: (value?: unknown) => void): void => {
          resolve();
        };
      },
    };
    const handler = vi.fn(() => thenable);
    harness.register(handler, BASE_METADATA);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: handler } } } }]),
    );
    expect(harness.invoke(BASE_METADATA.id)).toBe(true);
    await Promise.resolve();
    expect(thenReads).toBe(1);

    let coercions = 0;
    const thrownValue = {
      toString() {
        coercions += 1;
        throw new Error('must not coerce');
      },
    };
    const throwingHandler = (): never => {
      throw thrownValue as unknown as Error;
    };
    const thrownMetadata = { ...BASE_METADATA, id: 'deferred-ui:hostile-throw' };
    harness.register(throwingHandler, thrownMetadata);
    harness.session.boundariesByExport.set(
      'default',
      new Set([{ fiber: { child: { memoizedProps: { onClick: throwingHandler } } } }]),
    );
    expect(harness.invoke(thrownMetadata.id)).toBe(false);
    expect(coercions).toBe(0);
    expect(harness.read()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: thrownMetadata.id, lastError: '[Thrown object]' }),
      ]),
    );
  });

  it('bounds metadata-only source placeholders and evicts the oldest records', () => {
    const harness = createHarness();
    for (let index = 0; index < PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT + 3; index += 1) {
      harness.registerMetadata({ ...BASE_METADATA, id: `deferred-ui:${index.toString()}` });
    }

    const records = harness.read();
    expect(records).toHaveLength(PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT);
    expect(records[0]).toMatchObject({ id: 'deferred-ui:3' });
    expect(records.at(-1)).toMatchObject({
      id: `deferred-ui:${(PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT + 2).toString()}`,
    });
  });

  it('rejects malformed metadata and never treats registration as an activation', () => {
    const harness = createHarness();
    const handler = vi.fn();

    expect(harness.register(handler, { ...BASE_METADATA, eventName: 'onclick' })).toBe(handler);
    expect(harness.register(handler, { ...BASE_METADATA, methodName: 'deleteEverything' })).toBe(
      handler,
    );
    expect(harness.read()).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });
});

/** Evaluates the generated runtime against a descriptor-safe synthetic Fiber boundary. */
function createHarness(): DeferredUiTriggerHarness {
  const session: DeferredUiTriggerHarness['session'] = {
    boundariesByExport: new Map(),
    selectedExportName: 'default',
  };
  const warnings: unknown[][] = [];
  const context: Record<string, unknown> = {
    __session: session,
    __readCount: 0,
    __warnings: warnings,
    console: { warn: (...values: unknown[]) => warnings.push(values) },
    queueMicrotask,
    setTimeout,
  };
  vm.runInNewContext(
    `
      const previewEntryRevision = 'revision-a';
      const previewInspectorSession = globalThis.__session;
      const markPreviewInspectorTreeDirty = () => { previewInspectorSession.treeDirty = true; };
      const notifyPreviewInspector = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const schedulePreviewInspectorCommitRefresh = () => undefined;
      const readPreviewInspectorOwnData = (value, name) => {
        globalThis.__readCount += 1;
        if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
          ? descriptor.value
          : undefined;
      };
      const readPreviewInspectorFiberLink = (fiber, name) => {
        const value = readPreviewInspectorOwnData(fiber, name);
        return value && typeof value === 'object' ? value : undefined;
      };
      const readPreviewInspectorBoundaryFiber = (boundary) => boundary?.fiber;
      ${createPreviewInspectorDeferredUiTriggerRuntimeSource()}
      globalThis.__registerMetadata = registerPreviewInspectorDeferredUiTriggerMetadata;
      globalThis.__register = registerPreviewInspectorDeferredUiTrigger;
      globalThis.__read = readPreviewInspectorDeferredUiTriggers;
      globalThis.__invoke = invokePreviewInspectorDeferredUiTrigger;
    `,
    context,
  );
  return {
    getOwnDataReadCount: () => context.__readCount as number,
    invoke: context.__invoke as DeferredUiTriggerHarness['invoke'],
    read: context.__read as DeferredUiTriggerHarness['read'],
    register: context.__register as DeferredUiTriggerHarness['register'],
    registerMetadata: context.__registerMetadata as DeferredUiTriggerHarness['registerMetadata'],
    resetOwnDataReadCount: () => {
      context.__readCount = 0;
    },
    session,
    warnings,
  };
}

/** Creates a sibling-free child chain whose last Fiber owns the tested event prop. */
function createFiberChain(length: number, handler: () => unknown): TestFiber {
  let fiber: TestFiber = { memoizedProps: { onClick: handler } };
  for (let index = 1; index < length; index += 1) {
    fiber = { child: fiber, memoizedProps: {} };
  }
  return fiber;
}
