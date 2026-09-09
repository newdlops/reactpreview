/** Executes real exception-to-typed-prop recovery without granting ownership over user input. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewAutomaticPropsRuntimeSource } from '../../../../src/adapters/esbuild/previewAutomaticPropsRuntimeSource';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorSmartPropsRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorSmartPropsRuntimeSource';

/** Only descriptor inputs and commit delivery are synthetic; diagnosis and mutation use production code. */
function scenario(body: string): unknown {
  return vm.runInNewContext(
    `
    const blockedInspectorPropNames = new Set(['__proto__', 'prototype', 'constructor']);
    const state = { targetExportName: 'Panel', targetSourcePath: '/src/Panel.tsx' };
    const descriptor = { exportName: 'Panel', inspector: {
      target: { exportName: 'Panel' },
      targetInferredProps: [{ path: 'items', kind: 'array', source: 'type' }],
      targetInferredPropShape: { kind: 'object', properties: { items: { kind: 'array' } } },
    } };
    const previewInspectorSession = {
      selectedExportName: 'Panel', descriptors: [descriptor],
      basePropsByExport: new Map(), overridesByExport: new Map(), resolverPropsByExport: new Map(),
    };
    const readSelectedPreviewInspectorPageCandidate = () => undefined;
    const createPreviewInspectorRootName = (root) => root.exportName;
    const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
    const createRuntimeErrorHeadline = (error) => error.message;
    const setPreviewInspectorFallbackValuesEnabled = () => true;
    const setPreviewInspectorResolverPropsOverride = (name, value) => {
      previewInspectorSession.resolverPropsByExport.set(name, value); return true;
    };
    ${createPreviewAutomaticPropsRuntimeSource()}
    ${createPreviewInspectorFailureEvidenceRuntimeSource()}
    ${createPreviewInspectorGeneratedValueRuntimeSource()}
    ${createPreviewInspectorBlockerValueRuntimeSource()}
    ${createPreviewInspectorSmartPropsRuntimeSource()}
    function repair(error, ownerName = 'Panel', mutationState = state) {
      const failure = createPreviewInspectorTargetFailureRepairRecord(state, error, { ownerName });
      const mutation = createPreviewInspectorTargetFailurePropMutation(failure, {
        automatic: true, state: mutationState,
      });
      return applyPreviewInspectorTargetFailurePropMutation(mutation);
    }
    ${body}
  `,
    {},
    { timeout: 5_000 },
  );
}

describe('bounded automatic exception recovery', () => {
  it('recovers a real wrapped iteration exception and reruns the operation successfully', () => {
    expect(
      scenario(`
      function Panel(props) {
        try { return [...props.items].length >= 0 ? 'ready' : 'empty'; }
        catch (cause) { throw new Error('Panel rendering failed', { cause }); }
      }
      let failure;
      try { Panel({}); } catch (error) { failure = error; }
      const applied = repair(failure);
      const props = previewInspectorSession.resolverPropsByExport.get('Panel');
      ({ changed: applied.changed, paths: applied.changedPaths,
        output: props ? Panel(props) : undefined, manualCount: previewInspectorSession.overridesByExport.size });
    `),
    ).toEqual({ changed: true, paths: ['items'], output: 'ready', manualCount: 0 });
  });

  it.each([
    "undefined is not an object (evaluating 'props.items.length')",
    'can\'t access property "length", props.items is undefined',
  ])('uses the same compiler-proven array repair for %s', (message) => {
    expect(
      scenario(`
      const applied = repair(new TypeError(${JSON.stringify(message)}));
      ({ changed: applied.changed, paths: applied.changedPaths,
        array: Array.isArray(previewInspectorSession.resolverPropsByExport.get('Panel')?.items) });
    `),
    ).toEqual({ changed: true, paths: ['items'], array: true });
  });

  it('keeps explicit user values and unrelated props unchanged', () => {
    expect(
      scenario(`
      const user = { items: null, title: 'human choice' };
      previewInspectorSession.overridesByExport.set('Panel', user);
      const result = repair(new TypeError('props.items is not iterable'));
      ({ changed: result.changed, user, resolverCount: previewInspectorSession.resolverPropsByExport.size });
    `),
    ).toEqual({ changed: false, user: { items: null, title: 'human choice' }, resolverCount: 0 });
  });

  it.each([
    ['string', 'title', 'props.title.trim is not a function'],
    ['string', 'title', "undefined is not an object (evaluating 'props.title.length')"],
    ['function', 'onSubmit', 'this.props.onSubmit is not a function'],
  ])('repairs a compiler-proven %s without filling unrelated props', (kind, field, message) => {
    expect(
      scenario(`
      descriptor.inspector.targetInferredProps.push({ path: '${field}', kind: '${kind}', source: 'type' });
      descriptor.inspector.targetInferredPropShape.properties['${field}'] = { kind: '${kind}' };
      const applied = repair(new Error('Render wrapper', { cause: new TypeError(${JSON.stringify(message)}) }));
      const props = materializePreviewInspectorRuntimeFallbackOverride(
        previewInspectorSession.resolverPropsByExport.get('Panel'),
      );
      ({ changed: applied.changed, paths: applied.changedPaths,
        type: typeof props?.['${field}'], keys: Object.keys(props ?? {}) });
    `),
    ).toEqual({
      changed: true,
      paths: [field + (kind === 'function' ? '()' : '')],
      type: kind,
      keys: [field],
    });
  });

  it('does not choose between two compiler-proven suffix matches', () => {
    expect(
      scenario(`
      descriptor.inspector.targetInferredProps = [
        { path: 'first.items', kind: 'array' }, { path: 'second.items', kind: 'array' },
      ];
      descriptor.inspector.targetInferredPropShape = undefined;
      repair(new TypeError('props.items is not iterable')).changed;
    `),
    ).toBe(false);
  });

  it('does not reinterpret an explicit props receiver as a unique nested suffix', () => {
    expect(
      scenario(`
      descriptor.inspector.targetInferredProps = [{ path: 'other.items', kind: 'array' }];
      descriptor.inspector.targetInferredPropShape = { kind: 'object', properties: {
        other: { kind: 'object', properties: { items: { kind: 'array' } } },
      } };
      repair(new TypeError('props.items is not iterable')).changed;
    `),
    ).toBe(false);
  });

  it('fills only the explicit receiver when a nested sibling has the same field name', () => {
    expect(
      scenario(`
      descriptor.inspector.targetInferredProps.push({ path: 'other.items', kind: 'array' });
      descriptor.inspector.targetInferredPropShape.properties.other = {
        kind: 'object', properties: { items: { kind: 'array' } },
      };
      const applied = repair(new TypeError('props.items is not iterable'));
      ({ changed: applied.changed, paths: applied.changedPaths,
        keys: Object.keys(previewInspectorSession.resolverPropsByExport.get('Panel') ?? {}) });
    `),
    ).toEqual({ changed: true, paths: ['items'], keys: ['items'] });
  });

  it('requires a known kind and never widens an unknown length receiver', () => {
    expect(
      scenario(`
      descriptor.inspector.targetInferredProps = [{ path: 'items', kind: 'unknown' }];
      descriptor.inspector.targetInferredPropShape = undefined;
      [repair(new TypeError('props.items is not iterable')).changed,
        repair(new TypeError("undefined is not an object (evaluating 'props.items.length')")).changed];
    `),
    ).toEqual([false, false]);
  });

  it.each([
    "repair(new TypeError('items is not iterable'))",
    "repair(new TypeError('query.items is not iterable'))",
    "repair(new TypeError('props.items is not iterable'), 'Child')",
    "repair(new TypeError('props.items is not iterable'), 'Panel', { ...state, targetSourcePath: '/src/Other.tsx' })",
    "repair(new Error('Wrapped', { cause: new ReferenceError('React is not defined') }))",
    "repair(new TypeError('Cannot convert undefined or null to object'))",
  ])('fails closed for unowned, ambiguous, or lexical evidence: %s', (expression) => {
    expect(
      scenario(`
      const result = ${expression};
      ({ changed: result.changed, resolverCount: previewInspectorSession.resolverPropsByExport.size });
    `),
    ).toEqual({ changed: false, resolverCount: 0 });
  });

  it('does not repeatedly commit the same repair when an exception persists', () => {
    expect(
      scenario(`
      const error = new TypeError('props.items is not iterable');
      [repair(error).changed, repair(error).changed];
    `),
    ).toEqual([true, false]);
  });
});
