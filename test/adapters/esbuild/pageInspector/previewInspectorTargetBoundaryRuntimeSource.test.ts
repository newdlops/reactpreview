/** Verifies selected-target error containment without mounting a project application. */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorTargetBoundaryRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetBoundaryRuntimeSource';

/** Minimal React element shape returned by the browser-source fixture. */
interface TestElement {
  readonly props: Record<string, unknown> & { readonly children?: unknown };
  readonly type: string;
}

/** Mutable class instance contract exercised as React would exercise an error boundary. */
interface TestBoundary {
  componentDidCatch(error: Error, info: { readonly componentStack: string }): void;
  props: { readonly children: TestElement; readonly exportName: string };
  render(): TestElement;
  retry(): void;
  state: { componentStack: string; error: Error | undefined };
}

/** Static side of the generated target boundary exposed only inside this VM fixture. */
interface TestBoundaryConstructor {
  getDerivedStateFromError(error: Error): { readonly error: Error };
  new (props: TestBoundary['props']): TestBoundary;
}

describe('Preview Inspector selected-target boundary runtime', () => {
  /**
   * Proves the success path is transparent and a failed child becomes a retryable local marker
   * while the complete diagnostic is remembered and emitted to the browser console.
   */
  it('contains a selected-target failure and keeps its scoped remount contract', () => {
    const rememberedErrors: Error[] = [];
    const remountedExports: string[] = [];
    const warnings: string[] = [];
    const source = [
      createPreviewInspectorTargetBoundaryRuntimeSource(),
      'globalThis.__TestBoundary = PreviewInspectorTargetBoundary;',
    ].join('\n');
    const sandbox = createTargetBoundarySandbox({
      rememberedErrors,
      remountedExports,
      warnings,
    });
    runInContext(source, createContext(sandbox));
    const Boundary = sandbox.__TestBoundary;
    if (Boundary === undefined) {
      throw new Error('The generated target boundary was not exposed to the test sandbox.');
    }
    const child: TestElement = { props: { children: 'healthy' }, type: 'main' };
    const boundary = new Boundary({ children: child, exportName: 'SelectedCard' });

    expect(boundary.render()).toBe(child);

    const error = new Error('SELECTED_TARGET_FAILURE');
    boundary.state = { ...boundary.state, ...Boundary.getDerivedStateFromError(error) };
    boundary.componentDidCatch(error, { componentStack: '\n    at BrokenChild' });
    const fallback = boundary.render();

    expect(rememberedErrors).toEqual([error]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('SELECTED_TARGET_FAILURE');
    expect(warnings[0]).toContain('BrokenChild');
    expect(fallback.type).toBe('react-preview-target-error');
    expect(fallback.props.role).toBe('alert');
    expect(fallback.props['data-react-preview-target-error']).toBe('SelectedCard');

    const children = fallback.props.children as readonly TestElement[];
    expect(children[0]?.props.children).toBe('SelectedCard failed');
    expect(children[1]?.props.children).toBe('SELECTED_TARGET_FAILURE');
    expect(children[2]?.props.children).toBe('Retry');
    boundary.retry();
    expect(remountedExports).toEqual(['SelectedCard']);
  });
});

/** Mutable observations supplied to the generated browser-source sandbox. */
interface TargetBoundaryObservations {
  readonly rememberedErrors: Error[];
  readonly remountedExports: string[];
  readonly warnings: string[];
}

/**
 * Creates only the lexical bindings used by the generated error-boundary implementation.
 * Its tiny React class applies synchronous setState updates so componentDidCatch is observable.
 */
function createTargetBoundarySandbox(
  observations: TargetBoundaryObservations,
): Record<string, unknown> & { __TestBoundary?: TestBoundaryConstructor } {
  /** Small synchronous stand-in for the React.Component state contract used by the boundary. */
  class TestReactComponent {
    props: TestBoundary['props'];
    state: TestBoundary['state'] = { componentStack: '', error: undefined };

    /** Stores constructor props exactly as React.Component does. */
    constructor(props: TestBoundary['props']) {
      this.props = props;
    }

    /** Applies the object updates used by this generated boundary. */
    setState(update: Partial<TestBoundary['state']>): void {
      this.state = { ...this.state, ...update };
    }
  }

  return {
    React: {
      Component: TestReactComponent,
      createElement(
        type: string,
        props: Record<string, unknown> | undefined,
        ...children: unknown[]
      ) {
        return {
          props: {
            ...(props ?? {}),
            children: children.length === 1 ? children[0] : children,
          },
          type,
        };
      },
    },
    createRuntimeErrorHeadline: (error: Error): string => error.message,
    describeRuntimeError(error: Error, context: { readonly componentStack?: string }) {
      return error.message + (context.componentStack ?? '');
    },
    reportPreviewInspectorTargetFailure(
      error: Error,
      context: { readonly componentStack?: string },
    ) {
      return observations.warnings.push(error.message + (context.componentStack ?? ''));
    },
    registerPreviewInspectorBoundary: vi.fn(() => vi.fn()),
    rememberCapturedReactError: (error: Error): number => observations.rememberedErrors.push(error),
    remountPreviewInspectorExport: (exportName: string): number =>
      observations.remountedExports.push(exportName),
    schedulePreviewInspectorCommitRefresh: vi.fn(),
  };
}
