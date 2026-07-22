/**
 * Verifies the narrow source fallback for projects whose Babel and TypeScript JSX runtimes differ.
 * These tests operate before esbuild lowering so a missing classic `React` namespace cannot hide
 * behind an otherwise successful bundle result.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewSourceTransformer } from '../../../../src/adapters/esbuild/staticResources/previewSourceTransformer';
import { createPreviewReactJsxNamespaceCompatibilityImport } from '../../../../src/adapters/esbuild/staticResources/previewReactJsxNamespaceCompatibility';
import { StaticSourceAnalysis } from '../../../../src/adapters/esbuild/staticResources/staticCallParser';

const WORKSPACE_ROOT = path.join(process.cwd(), 'test', 'fixtures', 'react-jsx-namespace');
const SOURCE_PATH = path.join(WORKSPACE_ROOT, 'Target.tsx');
const GENERATED_REACT_IMPORT = 'import * as React from "react";';

describe('classic JSX React namespace compatibility', () => {
  /** Existing value imports already satisfy every classic `React.createElement` reference. */
  it.each([
    {
      label: 'default import',
      source: "import React from 'react'; export const View = () => <main />;",
    },
    {
      label: 'namespace import',
      source: "import * as React from 'react'; export const View = () => <main />;",
    },
  ])('preserves an existing React $label', ({ source }) => {
    expect(collectCompatibilityImport(source)).toBeUndefined();
  });

  /** A React runtime import without JSX has no factory reference that needs compatibility code. */
  it('does not add a namespace when the module contains no JSX', () => {
    const source = "import { StrictMode } from 'react'; export const mode = StrictMode;";

    expect(collectCompatibilityImport(source)).toBeUndefined();
  });

  /** Non-JSX dependencies avoid nearest-config work on large reached module graphs. */
  it('does not resolve project JSX ownership when the module contains no JSX', () => {
    let resolutionCount = 0;
    const source = 'export const value = 42;';

    expect(
      collectCompatibilityImport(source, true, () => {
        resolutionCount += 1;
        return true;
      }),
    ).toBeUndefined();
    expect(resolutionCount).toBe(0);
  });

  /** JSX owned by another library must retain that library's authored runtime contract. */
  it('does not infer React from JSX without an exact React runtime import', () => {
    const source = "import { h } from 'preact'; export const View = () => <main data-h={h} />;";

    expect(collectCompatibilityImport(source)).toBeUndefined();
  });

  /** A package-wide React declaration cannot override a module's Preact factory ownership. */
  it('does not inject React into a Preact module when the project also declares React', () => {
    const source = "import { h } from 'preact'; export const View = () => <main data-h={h} />;";

    expect(collectCompatibilityImport(source, true)).toBeUndefined();
  });

  /** Erased Preact types are not runtime ownership evidence in an otherwise React-authored file. */
  it('ignores type-only Preact imports when the project declares React', () => {
    const source = [
      "import type { ComponentChildren } from 'preact';",
      'export const View = ({ children }: { children: ComponentChildren }) => <main>{children}</main>;',
    ].join('\n');

    expect(collectCompatibilityImport(source, true)).toBe(GENERATED_REACT_IMPORT);
  });

  /** Per-file automatic-runtime pragmas are stronger evidence than an enclosing manifest. */
  it('preserves an explicit custom JSX import source in a hybrid React project', () => {
    const source = [
      '/** @jsxImportSource custom-jsx-runtime */',
      "import { useState } from 'react';",
      'export const View = () => <main>{useState(0)[0]}</main>;',
    ].join('\n');

    expect(collectCompatibilityImport(source, true)).toBeUndefined();
  });

  /** A classic custom factory must remain authoritative even when React is another dependency. */
  it('preserves an explicit classic JSX factory in a hybrid React project', () => {
    const source = [
      '/** @jsx h */',
      "import { h } from './custom-runtime';",
      'export const View = () => <main />;',
    ].join('\n');

    expect(collectCompatibilityImport(source, true)).toBeUndefined();
  });

  /** Nearest config evidence covers import-free custom-runtime source with no file pragma. */
  it('preserves a custom JSX runtime selected only by project configuration', () => {
    const source = 'export const View = () => <main>CUSTOM_CONFIG_RUNTIME</main>;';

    expect(collectCompatibilityImport(source, true, true)).toBeUndefined();
  });

  /** Text that resembles a pragma outside leading trivia must not suppress React compatibility. */
  it('ignores pragma-like runtime strings inside source statements', () => {
    const source = [
      "const note = '@jsxImportSource custom-jsx-runtime';",
      'export const View = () => <main data-note={note} />;',
    ].join('\n');

    expect(collectCompatibilityImport(source, true)).toBe(GENERATED_REACT_IMPORT);
  });

  /** Package metadata is sufficient ownership evidence for Babel-automatic modules with no import. */
  it('adds a namespace to import-free JSX when the project declares React', () => {
    const source = 'export const Header = () => <header>STORYBOOK_HEADER</header>;';

    expect(collectCompatibilityImport(source, true)).toBe(GENERATED_REACT_IMPORT);
    expect(collectCompatibilityImport(source, false)).toBeUndefined();
  });

  /**
   * Type-only declarations disappear before runtime and therefore cannot satisfy the classic
   * factory, while the named React import independently proves that React owns this JSX.
   */
  it('adds a runtime namespace beside a type-only React shadow and named React import', () => {
    const source = [
      "import type React from './react-types';",
      "import { StrictMode } from 'react';",
      'export const View = () => <StrictMode><main /></StrictMode>;',
    ].join('\n');

    expect(collectCompatibilityImport(source)).toBe(GENERATED_REACT_IMPORT);
  });

  /** Static CommonJS destructuring is runtime React evidence but does not bind the namespace. */
  it('adds a namespace for statically destructured React require calls', () => {
    const source = [
      "const { StrictMode } = require('react');",
      'export const View = () => <StrictMode><main /></StrictMode>;',
    ].join('\n');

    expect(collectCompatibilityImport(source)).toBe(GENERATED_REACT_IMPORT);
  });

  /** Module-scoped `var` remains an import collision even when authored inside a top-level block. */
  it('preserves a nested top-level var binding that owns the classic React namespace', () => {
    const source = [
      'if (globalThis.useCustomFactory) {',
      '  var React = globalThis.customReact;',
      '}',
      'export const View = () => <main />;',
    ].join('\n');

    expect(collectCompatibilityImport(source, true)).toBeUndefined();
  });

  /** The complete transformer appends the fallback only to source inside its trusted workspace. */
  it('appends the generated namespace through the workspace transformer', async () => {
    const source = [
      "import { StrictMode } from 'react';",
      'export default function View() {',
      '  return <StrictMode><main>TRANSFORMED_CLASSIC_JSX</main></StrictMode>;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      projectRoot: WORKSPACE_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
    });

    const transformed = await transformer.transform(SOURCE_PATH, source);

    expect(transformed.contents).toBe(`${source}\n${GENERATED_REACT_IMPORT}\n`);
    expect(transformed.watchDirectories).toEqual([]);
  });
});

/** Parses one TSX module with the same shared syntax index used by the production transformer. */
function collectCompatibilityImport(
  source: string,
  projectUsesReactRuntime = false,
  projectUsesAlternativeJsxRuntime: boolean | (() => boolean) = false,
): string | undefined {
  return createPreviewReactJsxNamespaceCompatibilityImport(
    new StaticSourceAnalysis(SOURCE_PATH, source),
    projectUsesReactRuntime,
    projectUsesAlternativeJsxRuntime,
  );
}
