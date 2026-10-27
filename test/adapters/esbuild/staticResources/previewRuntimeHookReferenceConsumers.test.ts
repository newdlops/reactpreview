/** Verifies name-indexed consumers retain captures, shadowing, and target-specific guard choices. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  applyPreviewRuntimeHookArrayLengthConstraints,
  type PreviewRuntimeHookArrayLengthConstraintMetadata,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookArrayLengthConstraints';
import { createPreviewRuntimeHookDirectUsageFallback } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookDirectUsage';
import { inferPreviewRuntimeHookTargetExitFallback } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookGuardValue';
import { inferPreviewRuntimeHookOverlayStateDemand } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookOverlayStateDemand';
import { createPreviewRuntimeHookReferenceTraversal } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookReferenceTraversal';
import { findNearestPreviewRuntimeFunction } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookSyntax';
import { registerPreviewSelectedTargetNames } from '../../../../src/adapters/esbuild/staticResources/previewSelectedTargetExit';

/** Keeps actual parser parents while locating one hook binding and an unrelated wide expression. */
function fixture(body: string): {
  readonly binding: ts.Identifier;
  readonly call: ts.CallExpression;
  readonly ignored: ts.ArrayLiteralExpression;
  readonly source: ts.SourceFile;
} {
  const source = ts.createSourceFile(
    '/workspace/Page.tsx',
    `function Page() { const value = useValue(); const ignored = [other(), another()]; ${body} }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let binding: ts.Identifier | undefined;
  let call: ts.CallExpression | undefined;
  let ignored: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'value' &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer)
    ) {
      binding = node.name;
      call = node.initializer;
    }
    if (ts.isArrayLiteralExpression(node)) ignored ??= node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (binding === undefined || call === undefined || ignored === undefined) {
    throw new Error('Hook reference fixture is incomplete.');
  }
  return { binding, call, ignored, source };
}

/** Counts actual child-array reads after indexing; repeated per-binding full walks would read it. */
function countUnrelatedReads(array: ts.ArrayLiteralExpression): () => number {
  const elements = array.elements;
  let reads = 0;
  Object.defineProperty(array, 'elements', {
    get: () => {
      reads += 1;
      return elements;
    },
  });
  return () => reads;
}

/** Mirrors the main hook analyzer's existing owner index before auxiliary consumers run. */
function prepareOwnerReferences(binding: ts.Identifier): void {
  const owner = findNearestPreviewRuntimeFunction(binding);
  if (owner === undefined) throw new Error('Hook reference fixture has no owner.');
  createPreviewRuntimeHookReferenceTraversal(owner, new Set([binding.text]));
}

describe('indexed hook reference consumers', () => {
  it('does not build an extra index for an isolated auxiliary scan', () => {
    const { binding, ignored } = fixture('return <main>{value}</main>;');
    const reads = countUnrelatedReads(ignored);

    expect(createPreviewRuntimeHookDirectUsageFallback(binding)?.label).toBe(
      'generated rendered key text',
    );
    expect(reads()).toBe(1);
  });

  it('retains a captured Promise call without reading unrelated syntax again', () => {
    const { binding, ignored } = fixture(
      'const capture = () => value().then(({ title }) => title); return <main />;',
    );
    const first = createPreviewRuntimeHookDirectUsageFallback(binding);
    prepareOwnerReferences(binding);
    const reads = countUnrelatedReads(ignored);
    const second = createPreviewRuntimeHookDirectUsageFallback(binding);

    expect(second).toEqual(first);
    expect(second?.callable).toBe(true);
    expect(second?.promiseReturning).toBe(true);
    expect(second?.promiseResultBindings?.map((name) => name.getText())).toEqual(['{ title }']);
    expect(reads()).toBe(0);
  });

  it('rejects a shadowed callable while keeping a direct rendered value', () => {
    const { binding } = fixture('const shadow = (value) => value(); return <main>{value}</main>;');

    expect(createPreviewRuntimeHookDirectUsageFallback(binding)).toMatchObject({
      label: 'generated rendered key text',
    });
    expect(createPreviewRuntimeHookDirectUsageFallback(binding)?.callable).toBeUndefined();
  });

  it('preserves a conditional overlay state and ignores nested component state', () => {
    const { binding, source, ignored } = fixture(
      'const nested = () => <Drawer state={value ? Mode.Hidden : Mode.Visible} />; return <Drawer state={value ? Mode.Visible : Mode.Hidden} />;',
    );
    expect(inferPreviewRuntimeHookOverlayStateDemand(binding, source)?.expression).toBe('true');
    prepareOwnerReferences(binding);
    const reads = countUnrelatedReads(ignored);

    expect(inferPreviewRuntimeHookOverlayStateDemand(binding, source)?.expression).toBe('true');
    expect(reads()).toBe(0);
  });

  it('retains captured Array length evidence but excludes shadowed and element arguments', () => {
    const captured = fixture('const capture = () => new Array(Math.min(5, value)); return null;');
    const first =
      applyPreviewRuntimeHookArrayLengthConstraints<PreviewRuntimeHookArrayLengthConstraintMetadata>(
        captured.call,
        {},
      );
    prepareOwnerReferences(captured.binding);
    const reads = countUnrelatedReads(captured.ignored);

    expect(applyPreviewRuntimeHookArrayLengthConstraints(captured.call, {})).toEqual(first);
    expect(first.nonNegativeNumberPaths).toEqual(['<root>']);
    expect(reads()).toBe(0);
    const shadowed = fixture('const shadow = (value) => new Array(value); return null;');
    expect(applyPreviewRuntimeHookArrayLengthConstraints(shadowed.call, {})).toEqual({});
    const elements = fixture('return new Array(value, 2);');
    expect(applyPreviewRuntimeHookArrayLengthConstraints(elements.call, {})).toEqual({});
  });

  it('keeps the selected target exit and does not retain its decision for an edited tree', () => {
    const before = fixture('if (!value) return <Selected />; return <Other />;');
    registerPreviewSelectedTargetNames(before.source, new Set(['Selected']));
    expect(inferPreviewRuntimeHookTargetExitFallback(before.binding)?.expression).toBe('false');
    registerPreviewSelectedTargetNames(before.source, new Set(['Other']));
    expect(inferPreviewRuntimeHookTargetExitFallback(before.binding)).toBeUndefined();
    const after = fixture('if (value) return <Selected />; return <Other />;');
    registerPreviewSelectedTargetNames(after.source, new Set(['Selected']));

    expect(inferPreviewRuntimeHookTargetExitFallback(after.binding)?.expression).toBe('true');
  });
});
