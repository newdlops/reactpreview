/** Verifies bounded component/property evidence recovered after React removes a failed subtree. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';

/** Generated helper surface exposed only to this dependency-free VM fixture. */
interface FailureEvidenceRuntime {
  readonly isJsxRuntimeGlobal: (globalName: string) => boolean;
  readonly names: (componentStack: string, fallback?: string) => readonly string[];
  readonly paths: (
    error: unknown,
    sourceEvidence?: readonly (string | { readonly kind?: string; readonly path: string })[],
  ) => readonly string[];
  readonly runtimeGlobal: (error: unknown) => string | undefined;
}

describe('Preview Inspector failure evidence runtime', () => {
  /** Extracts immediate property/call evidence from the JavaScript diagnostics users actually see. */
  it('identifies blocked property paths without executing project code', () => {
    const runtime = evaluateFailureEvidenceRuntime();

    expect(
      runtime.paths(new TypeError("Cannot read properties of undefined (reading 'value')")),
    ).toEqual(['value']);
    expect(
      runtime.paths(new TypeError("Cannot destructure property 'formikProps' as it is undefined")),
    ).toEqual(['formikProps']);
    expect(
      runtime.paths(
        new TypeError(
          "Cannot destructure property 'count' of 'captableRequestNotification' as it is undefined.",
        ),
      ),
    ).toEqual(['captableRequestNotification.count']);
    expect(
      runtime.paths(
        new TypeError(
          "Cannot destructure property 'formikProps' of 'useFormContext(...)' as it is undefined.",
        ),
      ),
    ).toEqual(['formikProps']);
    expect(
      runtime.paths(
        new TypeError("Cannot destructure property 'value' of 'form.values' as it is undefined."),
      ),
    ).toEqual(['form.values.value']);
    expect(runtime.paths(new TypeError('props.theme.spacing is not a function'))).toEqual([
      'props.theme.spacing()',
    ]);
  });

  /** Keeps missing lexical bindings out of payload paths and recognizes JSX compiler factories. */
  it('classifies missing runtime globals separately from Smart Fill data', () => {
    const runtime = evaluateFailureEvidenceRuntime();

    expect(runtime.runtimeGlobal(new ReferenceError('React is not defined'))).toBe('React');
    expect(runtime.runtimeGlobal('ReferenceError: process is not defined')).toBe('process');
    expect(runtime.paths(new ReferenceError('React is not defined'))).toEqual([]);
    expect(runtime.isJsxRuntimeGlobal('React')).toBe(true);
    expect(runtime.isJsxRuntimeGlobal('_jsxDEV')).toBe(true);
    expect(runtime.isJsxRuntimeGlobal('process')).toBe(false);
  });

  /** Expands collection diagnostics only when static evidence proves one unambiguous receiver. */
  it('correlates bare collection methods with unique source evidence', () => {
    const runtime = evaluateFailureEvidenceRuntime();

    expect(
      runtime.paths(new TypeError("Cannot read properties of undefined (reading 'flatMap')"), [
        { kind: 'array', path: 'data.pages' },
      ]),
    ).toEqual(['data.pages.flatMap()']);
    expect(
      runtime.paths(new TypeError("Cannot read properties of undefined (reading 'map')"), [
        'profile.genres.map',
      ]),
    ).toEqual(['profile.genres.map()']);
    expect(
      runtime.paths(new TypeError("Cannot read properties of undefined (reading 'slice')"), [
        { kind: 'array', path: 'first.items' },
        { kind: 'array', path: 'second.items' },
      ]),
    ).toEqual(['slice']);
  });

  it.each([
    ['props.items is not iterable', ['props.items']],
    [
      'TypeError: this.props.items is not iterable (cannot read property Symbol(Symbol.iterator))',
      ['this.props.items'],
    ],
    ["undefined is not an object (evaluating 'props.profile.name')", ['props.profile.name']],
    ['can\'t access property "name", props.profile is undefined', ['props.profile.name']],
    ['can\'t access property "name", props.profile is null', ['props.profile.name']],
    ["undefined is not an object (evaluating 'loadProfile().name')", []],
    ['Cannot convert undefined or null to object', []],
  ])('reads only the explicit safe receiver in %s', (message, paths) => {
    expect(evaluateFailureEvidenceRuntime().paths(new TypeError(message))).toEqual(paths);
  });

  it('unwraps a cause without widening an already actionable outer failure', () => {
    const runtime = evaluateFailureEvidenceRuntime();
    const cause = new TypeError('props.items is not iterable');
    expect(runtime.paths(new Error('Render failed', { cause }))).toEqual(['props.items']);
    expect(runtime.paths(new TypeError('props.onSubmit is not a function', { cause }))).toEqual([
      'props.onSubmit()',
    ]);
    const missingGlobal = new Error('Render failed', {
      cause: new ReferenceError('React is not defined'),
    });
    expect(runtime.runtimeGlobal(missingGlobal)).toBe('React');
    expect(runtime.paths(missingGlobal, [{ path: 'React', kind: 'object' }])).toEqual([]);
  });

  it('does not invoke diagnostic getters or project string conversion while recovering', () => {
    const runtime = evaluateFailureEvidenceRuntime();
    let reads = 0;
    const hostile = {
      get message() {
        reads += 1;
        throw new Error('message accessor');
      },
      get cause() {
        reads += 1;
        throw new Error('cause accessor');
      },
      get name() {
        reads += 1;
        throw new Error('name accessor');
      },
      toString() {
        reads += 1;
        return 'props.items is not iterable';
      },
    };
    expect(runtime.paths(hostile)).toEqual([]);
    expect(runtime.runtimeGlobal(hostile)).toBeUndefined();
    expect(reads).toBe(0);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(runtime.paths(revoked.proxy)).toEqual([]);
  });

  it('bounds cause traversal, cycles, diagnostic bytes, and retained path count', () => {
    const runtime = evaluateFailureEvidenceRuntime();
    const cycle: { message: string; cause?: unknown } = { message: 'Render failed' };
    cycle.cause = cycle;
    expect(runtime.paths(cycle)).toEqual([]);
    let chain: unknown = new TypeError('props.items is not iterable');
    for (let depth = 0; depth < 8; depth += 1) chain = { message: 'Wrapped', cause: chain };
    expect(runtime.paths(chain)).toEqual([]);
    expect(runtime.paths('x'.repeat(4_096) + " reading 'hidden'")).toEqual([]);
    expect(runtime.paths('props.' + 'x'.repeat(241) + ' is not iterable')).toEqual([]);
    expect(
      runtime.paths(
        Array.from({ length: 80 }, (_, index) => `reading 'field${String(index)}'`).join(' '),
      ),
    ).toHaveLength(32);
  });

  /** Keeps authored stack hierarchy while removing React host and Inspector implementation rows. */
  it('reads unique authored component names from the innermost failure outward', () => {
    const runtime = evaluateFailureEvidenceRuntime();
    const names = runtime.names(
      [
        '    at ForwardRef(BrokenInput) (entry.js:1:2)',
        '    at PreviewInspectorTargetBoundary (entry.js:2:3)',
        '    at form',
        '    at MeetingForm (entry.js:3:4)',
        '    at MeetingForm (entry.js:4:5)',
      ].join('\n'),
    );

    expect(names).toEqual(['BrokenInput', 'MeetingForm']);
  });
});

/** Evaluates the emitted helpers in an empty realm so they cannot depend on React or VS Code. */
function evaluateFailureEvidenceRuntime(): FailureEvidenceRuntime {
  const context: { __failureEvidence?: FailureEvidenceRuntime } = {};
  vm.runInNewContext(
    `${createPreviewInspectorFailureEvidenceRuntimeSource()}\n` +
      'globalThis.__failureEvidence = {' +
      ' isJsxRuntimeGlobal: isPreviewInspectorJsxRuntimeGlobalName,' +
      ' names: readPreviewInspectorComponentStackNames,' +
      ' paths: readPreviewInspectorErrorPropertyPaths,' +
      ' runtimeGlobal: readPreviewInspectorMissingRuntimeGlobalName' +
      '};',
    context,
  );
  if (context.__failureEvidence === undefined) {
    throw new Error('Failure evidence fixture did not initialize.');
  }
  return context.__failureEvidence;
}
