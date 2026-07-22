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

  /** JSX owned by another library must retain that library's authored runtime contract. */
  it('does not infer React from JSX without an exact React runtime import', () => {
    const source = "import { h } from 'preact'; export const View = () => <main data-h={h} />;";

    expect(collectCompatibilityImport(source)).toBeUndefined();
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
function collectCompatibilityImport(source: string): string | undefined {
  return createPreviewReactJsxNamespaceCompatibilityImport(
    new StaticSourceAnalysis(SOURCE_PATH, source),
  );
}
