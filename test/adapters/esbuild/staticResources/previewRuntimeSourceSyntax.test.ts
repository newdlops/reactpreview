/** Verifies private syntax reuse without changing authored offsets, grammar, or request state. */
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentPreviewDeferredUiTriggers } from '../../../../src/adapters/esbuild/staticResources/previewDeferredUiTriggerInstrumentation';
import { instrumentPreviewReactEffects } from '../../../../src/adapters/esbuild/staticResources/previewReactEffectInstrumentation';
import { isolatePreviewAsyncReactComponents } from '../../../../src/adapters/esbuild/staticResources/previewAsyncReactComponentIsolation';
import {
  instrumentPreviewRuntimeSource,
  mayRequirePreviewRuntimeSourceInstrumentation,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceInstrumentation';
import { createPreviewRuntimeSourceSyntax } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceSyntax';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
} from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

const observed = vi.hoisted(() => ({ grammars: [] as number[], trees: [] as object[] }));
vi.mock(
  '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceSyntax',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceSyntax')
      >();
    return {
      ...actual,
      createPreviewRuntimeSourceSyntax() {
        const syntax = actual.createPreviewRuntimeSourceSyntax();
        return {
          readSourceFile(...args: Parameters<typeof syntax.readSourceFile>) {
            const tree = syntax.readSourceFile(...args);
            observed.grammars.push(args[2]);
            observed.trees.push(tree);
            return tree;
          },
        };
      },
    };
  },
);

const unchangedSource = [
  'export function Page({ onClick, asyncValue, useEffect, items, current }) {',
  '  switch (current) { case 0: break; }',
  '  const value = current ? 1 : 0;',
  '  return <main onClick={onClick}>{items[value]}{asyncValue}</main>;',
  '}',
].join('\n');
const options = { isolateEffects: true, renderConditions: true };

beforeEach(() => {
  observed.trees.length = 0;
  observed.grammars.length = 0;
});

describe('private runtime source syntax', () => {
  it('parses unchanged TSX once across all six runtime stages', () => {
    const result = instrumentPreviewRuntimeSource('/workspace/Page.tsx', unchangedSource, options);

    expect(result.source).toBe(unchangedSource);
    expect(observed.trees).toHaveLength(6);
    expect(new Set(observed.trees).size).toBe(1);
  });

  it('reuses syntax during a fail-closed no-op probe without retaining it for the next request', () => {
    const sourcePath = '/workspace/ProbeSyntax.tsx';
    expect(mayRequirePreviewRuntimeSourceInstrumentation(sourcePath, unchangedSource)).toBe(false);
    expect(observed.trees.length).toBeGreaterThan(5);
    expect(new Set(observed.trees).size).toBe(1);
    const probeTree = observed.trees[0];

    instrumentPreviewRuntimeSource(sourcePath, unchangedSource, options);

    expect(observed.trees.at(-1)).not.toBe(probeTree);
  });

  it('invalidates exact path, text, and grammar independently and retains only the latest input', () => {
    const syntax = createPreviewRuntimeSourceSyntax();
    const first = syntax.readSourceFile('/workspace/One.tsx', unchangedSource, ts.ScriptKind.TSX);
    expect(syntax.readSourceFile('/workspace/One.tsx', unchangedSource, ts.ScriptKind.TSX)).toBe(
      first,
    );
    const edited = syntax.readSourceFile(
      '/workspace/One.tsx',
      `${unchangedSource}\n// edit`,
      ts.ScriptKind.TSX,
    );
    expect(edited).not.toBe(first);
    const renamed = syntax.readSourceFile('/workspace/Two.tsx', edited.text, ts.ScriptKind.TSX);
    expect(renamed).not.toBe(edited);
    expect(renamed.fileName).toBe('/workspace/Two.tsx');
    const grammarChanged = syntax.readSourceFile(
      '/workspace/Two.tsx',
      edited.text,
      ts.ScriptKind.TS,
    );
    expect(grammarChanged).not.toBe(renamed);
    expect(grammarChanged.languageVariant).toBe(ts.LanguageVariant.Standard);
    expect(renamed.languageVariant).toBe(ts.LanguageVariant.JSX);
    expect(
      syntax.readSourceFile('/workspace/One.tsx', unchangedSource, ts.ScriptKind.TSX),
    ).not.toBe(first);
  });

  it('preserves distinct JavaScript and JSX parser modes within one pipeline', () => {
    instrumentPreviewRuntimeSource('/workspace/Grammar.js', unchangedSource, options);

    expect(observed.grammars).toContain(ts.ScriptKind.JS);
    expect(observed.grammars).toContain(ts.ScriptKind.JSX);
    expect(new Set(observed.trees).size).toBeGreaterThan(1);
  });

  it('reparses every changed stage and matches isolated transforms including stable metadata', () => {
    const sourcePath = '/workspace/Changed.tsx';
    const source = [
      'import { useEffect } from "react";',
      'async function ServerPanel() { return <section>server</section>; }',
      'export function Page({ modal, visible, step }) {',
      '  useEffect(() => subscribe(), []);',
      '  const items = [<section>one</section>, <section>two</section>];',
      '  switch (step) { case 0: return <ServerPanel />; default: break; }',
      '  return <main>{items[step]}{visible && <button onClick={() => modal.show()}>Show</button>}</main>;',
      '}',
    ].join('\n');
    const deferred = instrumentPreviewDeferredUiTriggers(sourcePath, source);
    const deferredSource = applyPreviewSourceReplacements(
      source,
      selectCompatiblePreviewSourceReplacements(deferred.replacements),
    );
    const registrations: string[] = [];
    const conditional = instrumentReactConditionalRendering(
      sourcePath,
      deferredSource,
      registrations,
    );
    const effect = instrumentPreviewReactEffects(sourcePath, conditional);
    const expected = isolatePreviewAsyncReactComponents(sourcePath, effect);
    observed.trees.length = 0;

    const result = instrumentPreviewRuntimeSource(sourcePath, source, options);

    expect(result).toEqual({
      registrations: [...deferred.registrations, ...registrations],
      source: expected,
    });
    expect(new Set(observed.trees).size).toBe(6);
    expect(result.source).toContain('.resolveRenderChoice(');
    expect(result.source).toContain('.resolveRenderConditionLazy(');
    expect(result.source).toContain('.registerDeferredUiTrigger?.(');
    expect(result.source).toContain('data-react-preview-async-component="ServerPanel"');
  });

  it('keeps parse recovery conservative even after a valid revision was analyzed', () => {
    const sourcePath = '/workspace/Recovery.tsx';
    const syntax = createPreviewRuntimeSourceSyntax();
    syntax.readSourceFile(sourcePath, unchangedSource, ts.ScriptKind.TSX);
    const malformed = 'export function Page() { return <main>{visible && <Panel />';

    expect(
      instrumentReactConditionalRendering(sourcePath, malformed, [], undefined, undefined, syntax),
    ).toBe(malformed);
    expect(mayRequirePreviewRuntimeSourceInstrumentation(sourcePath, malformed)).toBe(true);
    expect(observed.trees.at(-1)).not.toBe(observed.trees[0]);
  });

  it('does not share trees or selected-target state across requests and feature combinations', () => {
    const sourcePath = '/workspace/Selected.tsx';
    const source = 'export const Page = ({ open }) => open && <Panel />;';
    const first = instrumentPreviewRuntimeSource(sourcePath, source, {
      ...options,
      selectedTargetNames: new Set(['Page']),
    });
    const firstTrees = new Set(observed.trees);
    observed.trees.length = 0;
    const disabled = instrumentPreviewRuntimeSource(sourcePath, source, {
      isolateEffects: false,
      renderConditions: false,
    });
    expect(disabled).toEqual({ registrations: [], source });
    expect(observed.trees).toHaveLength(0);

    const repeated = instrumentPreviewRuntimeSource(sourcePath, source, options);

    expect(repeated).toEqual(first);
    expect(observed.trees.every((tree) => !firstTrees.has(tree))).toBe(true);
  });
});
