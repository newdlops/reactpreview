/** Verifies the bounded Inspector Console runtime without evaluating project React modules. */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createPreviewInspectorConsoleRuntimeSource,
  PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConsoleRuntimeSource';

/** Serializable console row exposed by the generated runtime fixture. */
interface TestConsoleEntry {
  readonly componentStack?: string;
  readonly count: number;
  readonly details: string;
  readonly exportName?: string;
  readonly id: string;
  readonly level: string;
  readonly message: string;
  readonly source: string;
}

/** Functions deliberately exported from the VM only for behavioral tests. */
interface TestConsoleRuntime {
  clear(): void;
  install(): void;
  read(): TestConsoleEntry[];
  record(candidate: Record<string, unknown>): TestConsoleEntry;
  report(error: Error, context: Record<string, unknown>): void;
}

describe('Preview Inspector Console runtime', () => {
  /** Routes chatty project logs to Inspector chrome without rerendering the application tree. */
  it('uses the bounded Inspector refresh lane instead of the semantic application store', () => {
    const source = createPreviewInspectorConsoleRuntimeSource();

    expect(source).toContain('schedulePreviewInspectorTreeRefresh()');
    expect(source).not.toContain('notifyPreviewInspector()');
  });

  /** Preserves exact hook/provider diagnostics and coalesces an immediate repeated failure. */
  it('records structured React boundary failures without retaining Error objects', () => {
    const fixture = createConsoleRuntimeFixture();
    const error = new Error('useQueryParams must be used within a QueryParamProvider');
    const context = {
      componentStack: '\n    at SearchFilters',
      exportName: 'SearchFilters',
      phase: 'React Page Inspector selected target render or lifecycle',
    };

    fixture.runtime.record({ error, level: 'error', source: 'react-boundary', ...context });
    fixture.runtime.record({ error, level: 'error', source: 'react-boundary', ...context });

    const entries = fixture.runtime.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      componentStack: '\n    at SearchFilters',
      count: 2,
      exportName: 'SearchFilters',
      level: 'error',
      message: 'useQueryParams must be used within a QueryParamProvider',
      source: 'react-boundary',
    });
    expect(entries[0]?.details).toContain('SearchFilters');
    expect(entries[0]).not.toHaveProperty('error');
  });

  /** Mirrors normal console methods, forwards their original arguments, and bounds stored rows. */
  it('keeps the browser console behavior while retaining only the newest bounded entries', () => {
    const fixture = createConsoleRuntimeFixture();
    fixture.runtime.install();

    fixture.console.warn('provider missing', { hook: 'useQueryParams' });
    fixture.console.error('render failed');

    expect(fixture.originalWarnings).toEqual([['provider missing', { hook: 'useQueryParams' }]]);
    expect(fixture.originalErrors).toEqual([['render failed']]);
    expect(fixture.runtime.read().map((entry) => entry.level)).toEqual(['warn', 'error']);
    expect(fixture.runtime.read()[0]?.message).toContain('useQueryParams');

    for (let index = 0; index < PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT + 8; index += 1) {
      fixture.runtime.record({ level: 'log', message: 'row-' + String(index) });
    }
    const bounded = fixture.runtime.read();
    expect(bounded).toHaveLength(PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT);
    expect(bounded[0]?.message).not.toBe('provider missing {hook: useQueryParams}');
    expect(bounded.at(-1)?.message).toBe(
      'row-' + String(PREVIEW_INSPECTOR_CONSOLE_ENTRY_LIMIT + 7),
    );

    fixture.runtime.clear();
    expect(fixture.runtime.read()).toEqual([]);
  });

  /** Uses the native warning once while storing a detailed selected-target boundary event. */
  it('reports selected-target failures through one structured row and one native warning', () => {
    const fixture = createConsoleRuntimeFixture();
    const error = new Error('context provider missing');

    fixture.runtime.report(error, {
      componentStack: '\n    at ContextConsumer',
      exportName: 'ContextConsumer',
      phase: 'selected target',
    });

    expect(fixture.originalWarnings).toHaveLength(1);
    expect(fixture.originalWarnings[0]?.[0]).toContain('Selected target failed');
    expect(fixture.runtime.read()).toHaveLength(1);
    expect(fixture.runtime.read()[0]).toMatchObject({
      exportName: 'ContextConsumer',
      level: 'error',
      message: 'context provider missing',
      source: 'react-boundary',
    });
  });
});

/** Complete VM fixture observations returned to each independent behavior test. */
interface ConsoleRuntimeFixture {
  readonly console: Record<
    'debug' | 'error' | 'info' | 'log' | 'warn',
    (...args: unknown[]) => void
  >;
  readonly originalErrors: unknown[][];
  readonly originalWarnings: unknown[][];
  readonly runtime: TestConsoleRuntime;
}

/** Creates the lexical browser bindings expected by the generated console source. */
function createConsoleRuntimeFixture(): ConsoleRuntimeFixture {
  const originalErrors: unknown[][] = [];
  const originalWarnings: unknown[][] = [];
  const consoleObject = {
    debug: vi.fn(),
    error: (...args: unknown[]): void => {
      originalErrors.push(args);
    },
    info: vi.fn(),
    log: vi.fn(),
    warn: (...args: unknown[]): void => {
      originalWarnings.push(args);
    },
  };
  const sandbox: Record<string, unknown> & { __runtime?: TestConsoleRuntime } = {
    console: consoleObject,
    createRuntimeErrorHeadline(error: Error) {
      return error.message;
    },
    describeRuntimeError(
      error: Error,
      context: { readonly componentStack?: string; readonly exportName?: string },
    ) {
      return [error.message, context.exportName, context.componentStack].filter(Boolean).join('\n');
    },
    schedulePreviewInspectorTreeRefresh: vi.fn(),
    previewHotRuntime: {},
    previewInspectorSession: {},
    queueMicrotask(callback: () => void) {
      callback();
    },
  };
  const source = [
    createPreviewInspectorConsoleRuntimeSource(),
    `globalThis.__runtime = {
      clear: clearPreviewInspectorConsoleEntries,
      install: installPreviewInspectorConsoleCapture,
      read: readPreviewInspectorConsoleEntries,
      record: recordPreviewInspectorConsoleEntry,
      report: reportPreviewInspectorTargetFailure,
    };`,
  ].join('\n');
  runInContext(source, createContext(sandbox));
  if (sandbox.__runtime === undefined) {
    throw new Error('The generated Inspector Console runtime was not exposed by the test fixture.');
  }
  return {
    console: consoleObject,
    originalErrors,
    originalWarnings,
    runtime: sandbox.__runtime,
  };
}
