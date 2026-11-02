/** Pins parser work and authored behavior across one compatibility transform's private scope. */
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPreviewRouterRequirement } from '../../../../src/adapters/esbuild/previewRouterRequirement';
import { createReactContextHookFallbackTransform } from '../../../../src/adapters/esbuild/staticResources/reactContextHookFallback';
import { createPreviewRuntimeSourceSyntax } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceSyntax';
import type { PreviewRuntimeHookTypedCallResolver } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookTypedFallback';
import { createPreviewThemeSourceInstrumentation } from '../../../../src/adapters/esbuild/staticResources/previewThemeSourceInstrumentation';
import { StaticSourceAnalysis } from '../../../../src/adapters/esbuild/staticResources/staticCallParser';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});

const sourcePath = '/workspace/Page.tsx';
const source = [
  `import styled from 'styled-components';`,
  `import { useLocation } from 'react-router-dom';`,
  `import { useAppContext } from './context';`,
  'const Box = styled.div`color: ${p => p.theme.colors.text}; padding: ${p => p.theme.space(2)};`;',
  'export function Page() { const value = useAppContext(); useLocation(); return <Box>{value.profile.name}</Box>; }',
].join('\n');

beforeEach(() => {
  vi.mocked(ts.createSourceFile).mockClear();
});

describe('private compatibility syntax reuse', () => {
  it('parses once across resources, router, Context and both styled passes while preserving contributions', () => {
    const syntax = createPreviewRuntimeSourceSyntax();
    const analysis = new StaticSourceAnalysis(sourcePath, source, syntax);
    const typed = vi.fn<PreviewRuntimeHookTypedCallResolver>(() => undefined);
    const router = collectPreviewRouterRequirement(sourcePath, source, syntax);
    const context = createReactContextHookFallbackTransform(
      sourcePath,
      source,
      undefined,
      undefined,
      undefined,
      typed,
      undefined,
      syntax,
    );
    const theme = createPreviewThemeSourceInstrumentation(
      sourcePath,
      source,
      (kind) => `__${kind}`,
      syntax,
    );

    expect(router).toEqual({ consumesRouter: true, ownsRouter: false });
    expect(context.replacements).toHaveLength(1);
    expect(context.replacements[0]?.priority).toBe(2);
    expect(context.replacements[0]?.replacement).toContain('useAppContext()');
    expect(typed).toHaveBeenCalledOnce();
    expect(typed.mock.calls[0]?.[1]).toBe(analysis.getSourceFile());
    expect(theme.replacements).toHaveLength(2);
    expect(theme.replacements.map((edit) => source.slice(edit.start, edit.end)).sort()).toEqual([
      'p.theme.colors.text',
      'p.theme.space',
    ]);
    expect(
      vi.mocked(ts.createSourceFile).mock.calls.filter(([name]) => name === sourcePath),
    ).toHaveLength(1);
  });

  it('reparses edited malformed Context input and keeps its fallback refusal', () => {
    const syntax = createPreviewRuntimeSourceSyntax();
    new StaticSourceAnalysis(sourcePath, source, syntax);
    const malformed = `import { useAppContext } from './context'; function Page() { const value = useAppContext(); return value.`;
    const result = createReactContextHookFallbackTransform(
      sourcePath,
      malformed,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      syntax,
    );
    expect(result.replacements).toEqual([]);
    expect(result.declarations).toEqual([]);
    expect(
      vi.mocked(ts.createSourceFile).mock.calls.filter(([name]) => name === sourcePath),
    ).toHaveLength(2);
  });

  it('retains each analyzers JS grammar and creates a new tree for the next scope', () => {
    const jsPath = '/workspace/Legacy.js';
    const text = `import { useLocation } from 'react-router-dom'; export const Page = () => <main />;`;
    const syntax = createPreviewRuntimeSourceSyntax();
    const first = new StaticSourceAnalysis(jsPath, text, syntax).getSourceFile();
    expect(collectPreviewRouterRequirement(jsPath, text, syntax)).toEqual({
      consumesRouter: true,
      ownsRouter: false,
    });
    expect(vi.mocked(ts.createSourceFile).mock.calls.map((args) => args[4])).toEqual([
      ts.ScriptKind.JS,
      ts.ScriptKind.JSX,
    ]);
    const next = new StaticSourceAnalysis(
      jsPath,
      text,
      createPreviewRuntimeSourceSyntax(),
    ).getSourceFile();
    expect(next).not.toBe(first);
  });
});
