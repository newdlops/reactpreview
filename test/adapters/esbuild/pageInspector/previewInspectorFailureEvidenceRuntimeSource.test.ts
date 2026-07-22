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
