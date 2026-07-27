import { describe, expect, it } from 'vitest';
import { requiresPreviewDependencyCompatibility } from '../../../../src/adapters/esbuild/staticResources/previewDependencyCompatibility';

/** Verifies selected-corridor native pass-through without dropping mount contracts. */
describe('requiresPreviewDependencyCompatibility', () => {
  /** Keeps literal render assets on the exact source path so public URLs become bundle imports. */
  it('retains static JSX and variable render asset values during corridor preparation', () => {
    expect(
      requiresPreviewDependencyCompatibility(
        'export const Logo = () => <img src="/logo.png" />;',
        false,
      ),
    ).toBe(true);
    expect(
      requiresPreviewDependencyCompatibility(
        'const companyLogoUrl = "/logo.png"; export const Logo = () => <img src={companyLogoUrl} />;',
        false,
      ),
    ).toBe(true);
  });

  /** Plain TSX and literal lazy imports are native esbuild inputs and need no preview AST pass. */
  it('passes ordinary component dependencies through', () => {
    expect(
      requiresPreviewDependencyCompatibility(
        `import('./Panel').then((module) => module.Panel); export const Card = () => <article />;`,
        false,
      ),
    ).toBe(false);
  });

  /** Provider consumers retain automatic boundaries throughout selected-corridor preparation. */
  it.each(['react-router-dom', 'formik', 'useAppContext', 'react-redux'])(
    'retains the %s runtime boundary',
    (token) => {
      expect(requiresPreviewDependencyCompatibility(`const value = ${token};`, false)).toBe(true);
    },
  );

  /** Keeps a shallow-projected hook caller on the demand-shaped runtime fallback pipeline. */
  it('retains imported project hook calls including aliases and generic type arguments', () => {
    expect(
      requiresPreviewDependencyCompatibility(
        [
          `import { useQuery as readQuery } from '../use-query';`,
          'const result = readQuery<QueryData, QueryVariables>(document);',
        ].join('\n'),
        false,
      ),
    ).toBe(true);
    expect(
      requiresPreviewDependencyCompatibility(
        `import useCompany from './use-company'; const company = useCompany();`,
        false,
      ),
    ).toBe(true);
    expect(
      requiresPreviewDependencyCompatibility(
        `import * as hooks from './hooks'; const value = hooks.useCompany();`,
        false,
      ),
    ).toBe(true);
  });

  /** React primitive hooks remain native pass-through source instead of triggering an AST transform. */
  it('does not classify imported React primitive calls as project runtime boundaries', () => {
    expect(
      requiresPreviewDependencyCompatibility(
        `import React, { useMemo, useState } from 'react'; const value = useMemo(() => 1, []);`,
        false,
      ),
    ).toBe(false);
  });

  /** Dynamic resource patterns still require finite filesystem expansion before esbuild runs. */
  it('retains non-native resource macros', () => {
    expect(
      requiresPreviewDependencyCompatibility(
        'const pages = import.meta.glob("./pages/*.tsx");',
        false,
      ),
    ).toBe(true);
    expect(
      requiresPreviewDependencyCompatibility('const page = import(`./pages/${name}.tsx`);', false),
    ).toBe(true);
  });

  /** Next metadata remains a compile-time contract only when the selected project uses Next. */
  it('scopes metadata compatibility to Next projects', () => {
    const source = 'export const metadata = { title: "Preview" };';
    expect(requiresPreviewDependencyCompatibility(source, false)).toBe(false);
    expect(requiresPreviewDependencyCompatibility(source, true)).toBe(true);
  });
});
