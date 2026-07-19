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
  readonly generatedValue: Readonly<Record<string, unknown>>;
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

/** Optional runtime layers used to reproduce pre-commit nullish prop failures. */
interface SmartPropsFixtureOptions {
  readonly observedProps?: Readonly<Record<string, unknown>>;
  readonly overrideProps?: Readonly<Record<string, unknown>>;
  readonly requiredPaths?: readonly string[];
}

describe('Preview Inspector Smart props runtime source', () => {
  /** Produces useful props before a failed target can commit its live-prop registration effect. */
  it('joins inferred shape, parent JSX, observed props, overrides, and blocker paths', () => {
    const runtime = evaluateSmartPropsRuntime();

    expect(runtime.draft.evidenceFound).toBe(true);
    expect(runtime.draft.requiredPaths).toEqual(['field.value.address', 'isLoading', 'onSubmit()']);
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
    expect(runtime.draft.generatedValue).not.toHaveProperty('count');
    expect(runtime.draft.generatedValue).not.toHaveProperty('fromParent');
    expect(runtime.draft.generatedValue).toMatchObject({
      field: { value: { address: '' } },
      isLoading: false,
      onSubmit: '[Preview no-op function]',
    });
    expect(runtime.fallbackEnabled).toBe(true);
    expect(runtime.storedOverride).toEqual(runtime.applied.value);
  });

  /** Recreates an inferred nested prop when a parent or backend supplied a null container. */
  it('replaces a nullish observed container with its deepest proven minimum shape', () => {
    const runtime = evaluateSmartPropsRuntime({
      observedProps: { field: { value: null }, fromParent: 'observed' },
      requiredPaths: ['value'],
    });

    expect(runtime.draft.requiredPaths).toEqual(['field.value.address']);
    expect(runtime.draft.value.field).toEqual({
      value: { address: 'address' },
    });
    expect(runtime.draft.value.fromParent).toBe('observed');
  });

  /** Maps a browser receiver path back to a scalar prop and replaces its proven blocking null. */
  it('uses full shape evidence for a props-prefixed method failure', () => {
    const runtime = evaluateSmartPropsRuntime({
      observedProps: { field: { value: { address: null } } },
      requiredPaths: ['props.field.value.address.split()'],
    });

    expect(runtime.draft.requiredPaths).toEqual(['field.value.address']);
    expect(runtime.draft.value.field).toEqual({
      value: { address: 'address' },
    });
  });

  /** Keeps an explicit user value authoritative after the missing container has been diagnosed. */
  it('preserves a non-null user override at a generated descendant path', () => {
    const runtime = evaluateSmartPropsRuntime({
      observedProps: { field: { value: null } },
      overrideProps: { field: { value: { address: '서울특별시' } } },
      requiredPaths: ['value'],
    });

    expect(runtime.draft.value.field).toEqual({ value: { address: '서울특별시' } });
  });
});

/** Evaluates generated helpers with one nested target descriptor and no project React execution. */
function evaluateSmartPropsRuntime(options: SmartPropsFixtureOptions = {}): SmartPropsRuntime {
  const observedProps = options.observedProps ?? { fromParent: 'observed' };
  const overrideProps = options.overrideProps ?? { count: 3 };
  const requiredPaths = options.requiredPaths ?? ['value', 'isLoading', 'onSubmit()'];
  const context: { __smartProps?: SmartPropsRuntime } = {};
  vm.runInNewContext(
    `
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      let fallbackEnabled = false;
      let storedOverride = {};
      const previewInspectorSession = {
        basePropsByExport: new Map([['CheckField', ${JSON.stringify(observedProps)}]]),
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
              { kind: 'function', path: 'onChange', source: 'type' },
              { kind: 'string', path: 'title', source: 'type' },
            ],
          },
        }],
        overridesByExport: new Map([['CheckField', ${JSON.stringify(overrideProps)}]]),
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
        ${JSON.stringify(requiredPaths)},
      );
      const applied = applyPreviewInspectorSmartProps(
        'CheckField',
        ${JSON.stringify(requiredPaths)},
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
