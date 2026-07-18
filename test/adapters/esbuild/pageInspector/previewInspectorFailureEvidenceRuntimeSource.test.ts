/** Verifies bounded component/property evidence recovered after React removes a failed subtree. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';

/** Generated helper surface exposed only to this dependency-free VM fixture. */
interface FailureEvidenceRuntime {
  readonly names: (componentStack: string, fallback?: string) => readonly string[];
  readonly paths: (error: unknown) => readonly string[];
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
    expect(runtime.paths(new TypeError('props.theme.spacing is not a function'))).toEqual([
      'props.theme.spacing()',
    ]);
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
      ' names: readPreviewInspectorComponentStackNames,' +
      ' paths: readPreviewInspectorErrorPropertyPaths' +
      '};',
    context,
  );
  if (context.__failureEvidence === undefined) {
    throw new Error('Failure evidence fixture did not initialize.');
  }
  return context.__failureEvidence;
}
