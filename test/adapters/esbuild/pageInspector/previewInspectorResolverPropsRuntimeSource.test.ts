/** Verifies that temporary prop repairs preserve real React children and inert runtime values. */
import { createContext, runInContext } from 'node:vm';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorNeuralSuccessSnapshotRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessSnapshotRuntimeSource';
import { createPreviewInspectorResolverPropsRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorResolverPropsRuntimeSource';
import { createPreviewInspectorStateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStateRuntimeSource';

/** Composes the production storage/materialization boundary in a browser-like isolated realm. */
function createRuntime(): {
  set(value: unknown): boolean;
  read(): Readonly<Record<string, unknown>>;
  checkpoint(): Readonly<Record<string, unknown>>;
} {
  const context = createContext({});
  runInContext(
    "const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);" +
      'const previewInspectorSession = { selectedExportName: "Layout", resolverPropsByExport: new Map(), propsRevisionByExport: new Map() };' +
      'const PREVIEW_INSPECTOR_NEURAL_SUCCESS_VALUE_LIMIT = 64;' +
      createPreviewInspectorGeneratedValueRuntimeSource() +
      createPreviewInspectorBlockerValueRuntimeSource() +
      createPreviewInspectorNeuralSuccessSnapshotRuntimeSource() +
      createPreviewInspectorStateRuntimeSource() +
      createPreviewInspectorResolverPropsRuntimeSource() +
      'globalThis.api = { set: value => setPreviewInspectorResolverPropsOverride("Layout", value, false),' +
      'read: () => materializePreviewInspectorRuntimeFallbackOverride(previewInspectorSession.resolverPropsByExport.get("Layout")),' +
      'checkpoint: () => createPreviewInspectorNeuralSuccessSnapshot({targetExportName:"Layout"})?.resolverProps };',
    context,
  );
  return runInContext('globalThis.api', context) as ReturnType<typeof createRuntime>;
}

describe('runtime resolver props', () => {
  /** The real Next layout error came from converting a children element into a JSON record. */
  it('keeps a real React subtree renderable after an unrelated prop repair', () => {
    const runtime = createRuntime();
    const child = createElement('span', { className: 'authored-theme' }, 'Authored child');

    expect(runtime.set({ children: child, title: 'Repaired title' })).toBe(true);
    const props = runtime.read();

    expect(isValidElement(props.children)).toBe(true);
    expect(props.children).toBe(child);
    expect(renderToStaticMarkup(createElement('main', null, props.children as ReactNode))).toBe(
      '<main><span class="authored-theme">Authored child</span></main>',
    );
  });

  /** Generated event callbacks and native receiver behavior must survive this in-memory boundary. */
  it('preserves generated callbacks and patterns without sharing mutable native state', () => {
    const runtime = createRuntime();
    const callback = (): number => 7;
    const pattern = /company/gi;
    pattern.lastIndex = 2;

    expect(runtime.set({ callback, pattern })).toBe(true);
    const props = runtime.read() as { callback: () => number; pattern: RegExp };

    expect(props.callback()).toBe(7);
    expect(props.pattern).not.toBe(pattern);
    expect(props.pattern.source).toBe('company');
    expect(props.pattern.flags).toBe('gi');
    expect(props.pattern.lastIndex).toBe(2);
  });

  /** A failed copy must leave the preceding usable layer intact and never run a project getter. */
  it('rejects an accessor without damaging the current resolver layer', () => {
    const runtime = createRuntime();
    runtime.set({ title: 'Previous' });
    let reads = 0;
    const value = {
      get title(): string {
        reads += 1;
        return 'Unexpected';
      },
    };

    expect(runtime.set(value)).toBe(false);
    expect(reads).toBe(0);
    expect(runtime.read().title).toBe('Previous');
  });

  /** A later recovery pass must not undo the valid subtree already admitted by the resolver. */
  it('retains renderable children in the stored success checkpoint', () => {
    const runtime = createRuntime();
    const owner: { cycle?: unknown } = {};
    owner.cycle = owner;
    const child = Object.freeze({
      ...createElement('span', null, 'Checkpoint child'),
      _owner: owner,
    });
    runtime.set({ children: child, title: 'Layout' });

    const checkpoint = runtime.checkpoint();

    expect(checkpoint.children).toBe(child);
    expect(isValidElement(checkpoint.children)).toBe(true);
  });
});
