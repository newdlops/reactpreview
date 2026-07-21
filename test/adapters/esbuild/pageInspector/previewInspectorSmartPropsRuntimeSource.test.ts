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

/** Result of the deterministic hidden-overlay recovery path. */
interface OverlayRevealRuntime {
  readonly commits: number;
  readonly decisions: readonly Readonly<Record<string, unknown>>[];
  readonly fallbackCommitModes: readonly boolean[];
  readonly fallbackEnabled: boolean;
  readonly manualOverride: Readonly<Record<string, unknown>>;
  readonly path?: string;
  readonly persists: number;
  readonly propsCommitModes: readonly boolean[];
  readonly repeatedPath?: string;
  readonly storedOverride: Readonly<Record<string, unknown>>;
  readonly updates: number;
}

/** Result of correlating one React target error to compiler-proven external props. */
interface TargetPropFailureRuntime {
  readonly paths: readonly string[];
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

  /** Opens an overlay only when a compiler-proven boolean visibility prop has one safe answer. */
  it('reveals a cold modal target and records the generated visibility value', () => {
    const runtime = evaluateOverlayRevealRuntime();

    expect(runtime.path).toBe('show');
    expect(runtime.repeatedPath).toBeUndefined();
    expect(runtime.fallbackEnabled).toBe(true);
    expect(runtime.manualOverride).toEqual({});
    expect(runtime.storedOverride).toEqual({ show: true });
    expect(runtime.fallbackCommitModes).toEqual([false]);
    expect(runtime.propsCommitModes).toEqual([false]);
    expect(runtime).toMatchObject({ commits: 1, persists: 1, updates: 1 });
    expect(runtime.decisions).toEqual([
      expect.objectContaining({
        blockerId: 'target-overlay:DeleteModal',
        generatedPaths: ['show'],
        mode: 'target-overlay-auto',
        selectedValue: { show: true },
        startsRenderAttempt: true,
        targetReachabilityKey: 'page:DeleteModal',
      }),
    ]);
  });

  /** Never replaces an explicit false entered by the user merely to make a hidden target visible. */
  it('keeps a user visibility override authoritative', () => {
    const runtime = evaluateOverlayRevealRuntime({ show: false });

    expect(runtime.path).toBeUndefined();
    expect(runtime.fallbackEnabled).toBe(false);
    expect(runtime.manualOverride).toEqual({ show: false });
    expect(runtime.storedOverride).toEqual({});
    expect(runtime.decisions).toEqual([]);
    expect(runtime).toMatchObject({ commits: 0, persists: 0, updates: 0 });
  });

  /** Preserves unrelated user JSON while adding visibility in the lower automatic prop layer. */
  it('reveals a modal without replacing an unrelated user prop', () => {
    const runtime = evaluateOverlayRevealRuntime({ title: 'Delete account' });

    expect(runtime.path).toBe('show');
    expect(runtime.manualOverride).toEqual({ title: 'Delete account' });
    expect(runtime.storedOverride).toEqual({ show: true });
    expect(runtime).toMatchObject({ commits: 1, persists: 1, updates: 1 });
  });

  /** Leaves two independent visibility switches for the user because neither is uniquely proven. */
  it('does not guess between multiple overlay visibility props', () => {
    const runtime = evaluateOverlayRevealRuntime(undefined, ['open', 'visible']);

    expect(runtime.path).toBeUndefined();
    expect(runtime.fallbackEnabled).toBe(false);
    expect(runtime.storedOverride).toEqual({});
    expect(runtime.decisions).toEqual([]);
    expect(runtime).toMatchObject({ commits: 0, persists: 0, updates: 0 });
  });

  /** Maps React's authored function name back to a default export before filling its array prop. */
  it('correlates a default export runtime owner with one compiler-proven prop path', () => {
    const runtime = evaluateTargetPropFailureRuntime({
      blockedComponentName: 'PageComponent',
      errorMessage: "Cannot read properties of undefined (reading 'map')",
      exportName: 'default',
      inferredProps: [{ kind: 'array', path: 'filters.items', source: 'type' }],
      runtimeOwnerNames: ['PageComponent'],
    });

    expect(runtime.paths).toEqual(['filters.items.map()']);
  });

  /** Keeps a target-owned hook/local receiver out of external props even under the same component. */
  it('does not project a hook-local receiver path onto the selected export props', () => {
    const runtime = evaluateTargetPropFailureRuntime({
      blockedComponentName: 'InvestmentPage',
      errorMessage: 'captableRequestNotification.count is not a function',
      exportName: 'InvestmentPage',
      inferredProps: [{ kind: 'string', path: 'title', source: 'type' }],
      runtimeOwnerNames: ['InvestmentPage'],
    });

    expect(runtime.paths).toEqual([]);
  });
});

/** Inputs for the selected-export owner and error-path correlation fixture. */
interface TargetPropFailureFixtureOptions {
  readonly blockedComponentName: string;
  readonly errorMessage: string;
  readonly exportName: string;
  readonly inferredProps: readonly Readonly<Record<string, unknown>>[];
  readonly runtimeOwnerNames: readonly string[];
}

/** Evaluates target prop correlation independently from React mounting and the blocker UI. */
function evaluateTargetPropFailureRuntime(
  options: TargetPropFailureFixtureOptions,
): TargetPropFailureRuntime {
  const context: { __targetPropFailure?: TargetPropFailureRuntime } = {};
  vm.runInNewContext(
    `
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const previewInspectorSession = {
        basePropsByExport: new Map(),
        descriptors: [{
          exportName: ${JSON.stringify(options.exportName)},
          inspector: {
            pageCandidates: [],
            target: { exportName: ${JSON.stringify(options.exportName)} },
            targetInferredProps: ${JSON.stringify(options.inferredProps)},
          },
        }],
        directTargetRuntimeOwnerNamesByExport: new Map([[
          ${JSON.stringify(options.exportName)},
          new Set(${JSON.stringify(options.runtimeOwnerNames)}),
        ]]),
        overridesByExport: new Map(),
      };
      const readSelectedPreviewInspectorPageCandidate = () => undefined;
      const createPreviewInspectorRootName = (root) => root.exportName;
      ${createPreviewAutomaticPropsRuntimeSource()}
      ${createPreviewInspectorFailureEvidenceRuntimeSource()}
      ${createPreviewInspectorGeneratedValueRuntimeSource()}
      ${createPreviewInspectorBlockerValueRuntimeSource()}
      ${createPreviewInspectorSmartPropsRuntimeSource()}
      const paths = readPreviewInspectorTargetPropFailurePaths(
        ${JSON.stringify(options.exportName)},
        ${JSON.stringify(options.blockedComponentName)},
        new TypeError(${JSON.stringify(options.errorMessage)}),
      );
      globalThis.__targetPropFailure = { paths };
    `,
    context,
  );
  if (context.__targetPropFailure === undefined) {
    throw new Error('Target prop failure runtime fixture did not initialize.');
  }
  return context.__targetPropFailure;
}

/** Evaluates the overlay-only recovery without mounting project React or invoking a modal portal. */
function evaluateOverlayRevealRuntime(
  overrideProps?: Readonly<Record<string, unknown>>,
  visibilityNames: readonly string[] = ['show'],
): OverlayRevealRuntime {
  const inferredProperties: Record<string, { readonly kind: string }> = {
    title: { kind: 'string' },
  };
  for (const visibilityName of visibilityNames) {
    inferredProperties[visibilityName] = { kind: 'boolean' };
  }
  const inferredProps = [
    ...visibilityNames.map((path) => ({ kind: 'boolean', path, source: 'type' })),
    { kind: 'string', path: 'title', source: 'type' },
  ];
  const context: { __overlayReveal?: OverlayRevealRuntime } = {};
  vm.runInNewContext(
    `
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      let commits = 0;
      const decisions = [];
      const fallbackCommitModes = [];
      let fallbackEnabled = false;
      let persists = 0;
      const propsCommitModes = [];
      let storedOverride = {};
      let updates = 0;
      const previewInspectorSession = {
        basePropsByExport: new Map(),
        descriptors: [{
          exportName: 'DeleteModal',
          inspector: {
            pageCandidates: [],
            target: { exportName: 'DeleteModal' },
            targetInferredPropShape: {
              kind: 'object',
              properties: ${JSON.stringify(inferredProperties)},
            },
            targetInferredProps: ${JSON.stringify(inferredProps)},
          },
        }],
        overridesByExport: new Map(${JSON.stringify(
          overrideProps === undefined ? [] : [['DeleteModal', overrideProps]],
        )}),
        resolverPropsByExport: new Map(),
      };
      const readSelectedPreviewInspectorPageCandidate = () => undefined;
      const createPreviewInspectorRootName = (root) => root.exportName;
      const setPreviewInspectorFallbackValuesEnabled = (value, commit = true) => {
        fallbackCommitModes.push(commit);
        fallbackEnabled = value;
      };
      const setPreviewInspectorResolverPropsOverride = (exportName, value, commit = true) => {
        propsCommitModes.push(commit);
        storedOverride = value;
        previewInspectorSession.resolverPropsByExport.set(exportName, value);
      };
      const persistPreviewInspectorState = () => { persists += 1; };
      const notifyPreviewInspector = () => { updates += 1; };
      const schedulePreviewInspectorCommitRefresh = () => { commits += 1; };
      const recordPreviewInspectorBlockerAutoDecision = (decision) => decisions.push(decision);
      ${createPreviewAutomaticPropsRuntimeSource()}
      ${createPreviewInspectorFailureEvidenceRuntimeSource()}
      ${createPreviewInspectorGeneratedValueRuntimeSource()}
      ${createPreviewInspectorBlockerValueRuntimeSource()}
      ${createPreviewInspectorSmartPropsRuntimeSource()}
      const path = autoRevealPreviewInspectorOverlayTarget('DeleteModal', 'page:DeleteModal');
      const repeatedPath = autoRevealPreviewInspectorOverlayTarget(
        'DeleteModal',
        'page:DeleteModal',
      );
      globalThis.__overlayReveal = {
        commits,
        decisions,
        fallbackCommitModes,
        fallbackEnabled,
        manualOverride: previewInspectorSession.overridesByExport.get('DeleteModal') ?? {},
        path,
        persists,
        propsCommitModes,
        repeatedPath,
        storedOverride,
        updates,
      };
    `,
    context,
  );
  if (context.__overlayReveal === undefined) {
    throw new Error('Overlay reveal runtime fixture did not initialize.');
  }
  return context.__overlayReveal;
}

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
