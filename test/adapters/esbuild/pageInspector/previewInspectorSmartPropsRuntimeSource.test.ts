/** Verifies descriptor-, JSX-, observation-, and error-backed Smart component prop generation. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewAutomaticPropsRuntimeSource } from '../../../../src/adapters/esbuild/previewAutomaticPropsRuntimeSource';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorSmartPropsRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorSmartPropsRuntimeSource';

/** JSON-safe Smart draft exposed from the generated browser fixture. */
interface SmartPropsDraft {
  readonly evidenceFound: boolean;
  readonly generatedPaths: readonly string[];
  readonly requiredPaths: readonly string[];
  readonly value: Readonly<Record<string, unknown>>;
}

/** Generated runtime surface used by behavioral assertions. */
interface SmartPropsRuntime {
  readonly applied: SmartPropsDraft;
  readonly draft: SmartPropsDraft;
  readonly fallbackEnabled: boolean;
  readonly storedOverride: Readonly<Record<string, unknown>>;
}

describe('Preview Inspector Smart props runtime source', () => {
  /** Produces useful props before a failed target can commit its live-prop registration effect. */
  it('joins inferred shape, parent JSX, observed props, overrides, and blocker paths', () => {
    const runtime = evaluateSmartPropsRuntime();

    expect(runtime.draft.evidenceFound).toBe(true);
    expect(runtime.draft.requiredPaths).toEqual(['field.value', 'isLoading', 'onSubmit()']);
    expect(runtime.draft.value).toEqual({
      count: 3,
      field: { value: { address: '' } },
      fromParent: 'observed',
      isLoading: false,
      onChange: '[Preview no-op function]',
      onSubmit: '[Preview no-op function]',
      title: '',
      variant: 'edit',
    });
    expect(runtime.draft.generatedPaths).toEqual(
      expect.arrayContaining([
        'field.value',
        'field.value.address',
        'isLoading',
        'onChange',
        'onSubmit()',
        'title',
      ]),
    );
    expect(runtime.fallbackEnabled).toBe(true);
    expect(runtime.storedOverride).toEqual(runtime.applied.value);
  });
});

/** Evaluates generated helpers with one nested target descriptor and no project React execution. */
function evaluateSmartPropsRuntime(): SmartPropsRuntime {
  const context: { __smartProps?: SmartPropsRuntime } = {};
  vm.runInNewContext(
    `
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      let fallbackEnabled = false;
      let storedOverride = {};
      const previewInspectorSession = {
        basePropsByExport: new Map([['CheckField', { fromParent: 'observed' }]]),
        descriptors: [{
          automaticProps: {},
          exportName: 'CheckField',
          inspector: {
            pageCandidates: [{
              id: 'page-candidate',
              root: { exportName: 'Page' },
              rootAutomaticProps: { route: '/preview' },
              targetAutomaticProps: { variant: 'edit' },
            }],
            root: { exportName: 'Page' },
            target: { exportName: 'CheckField' },
            targetAutomaticProps: { variant: 'fallback' },
            targetInferredPropShape: {
              kind: 'object',
              properties: {
                field: {
                  kind: 'object',
                  properties: {
                    value: {
                      kind: 'object',
                      properties: { address: { kind: 'string' } },
                    },
                  },
                },
                onChange: { kind: 'function' },
                title: { kind: 'string' },
              },
            },
            targetInferredProps: [
              { kind: 'object', path: 'field', source: 'usage' },
              { kind: 'object', path: 'field.value', source: 'usage' },
              { kind: 'string', path: 'field.value.address', source: 'usage' },
              { kind: 'function', path: 'onChange', source: 'type' },
              { kind: 'string', path: 'title', source: 'type' },
            ],
          },
        }],
        overridesByExport: new Map([['CheckField', { count: 3 }]]),
      };
      const readSelectedPreviewInspectorPageCandidate = (descriptor) =>
        descriptor.inspector.pageCandidates[0];
      const createPreviewInspectorRootName = (root) => root.exportName;
      const setPreviewInspectorFallbackValuesEnabled = (value) => { fallbackEnabled = value; };
      const setPreviewInspectorPropsOverride = (_exportName, value) => { storedOverride = value; };
      ${createPreviewAutomaticPropsRuntimeSource()}
      ${createPreviewInspectorFailureEvidenceRuntimeSource()}
      ${createPreviewInspectorGeneratedValueRuntimeSource()}
      ${createPreviewInspectorBlockerValueRuntimeSource()}
      ${createPreviewInspectorSmartPropsRuntimeSource()}
      const draft = createPreviewInspectorSmartPropsDraft(
        'CheckField',
        ['value', 'isLoading', 'onSubmit()'],
      );
      const applied = applyPreviewInspectorSmartProps(
        'CheckField',
        ['value', 'isLoading', 'onSubmit()'],
      );
      globalThis.__smartProps = { applied, draft, fallbackEnabled, storedOverride };
    `,
    context,
  );
  if (context.__smartProps === undefined) {
    throw new Error('Smart props runtime fixture did not initialize.');
  }
  return context.__smartProps;
}
