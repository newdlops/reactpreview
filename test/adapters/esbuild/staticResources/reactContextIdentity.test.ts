/**
 * Verifies syntax-only custom React Context identity proof independently from runtime integration.
 * Fixtures emphasize binding identity and conservative rejection so similarly named project hooks
 * cannot accidentally become preview registrations.
 */
import { describe, expect, it } from 'vitest';
import { collectReactContextIdentityPairs } from '../../../../src/adapters/esbuild/staticResources/reactContextIdentity';

describe('collectReactContextIdentityPairs', () => {
  /** Recognizes aliased named imports and returns pairs in authored hook declaration order. */
  it('pairs direct hooks with local Contexts through named React import aliases', () => {
    const source = [
      `import { createContext as makeContext, useContext as readContext } from 'react';`,
      'const AppContext = makeContext<{ user?: object } | null>(null);',
      'const ThemeContext = makeContext(undefined);',
      'export function useAppContext() {',
      '  return readContext(AppContext);',
      '}',
      'export const useThemeContext = () => readContext((ThemeContext));',
    ].join('\n');

    const inventory = collectReactContextIdentityPairs('/workspace/contexts.tsx', source);

    expect(inventory).toEqual({
      pairs: [
        { contextBinding: 'AppContext', hookBinding: 'useAppContext' },
        { contextBinding: 'ThemeContext', hookBinding: 'useThemeContext' },
      ],
      truncated: false,
    });
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory.pairs)).toBe(true);
    expect(Object.isFrozen(inventory.pairs[0])).toBe(true);
  });

  /** Covers React default, namespace, and named-default objects plus function-expression hooks. */
  it('supports default and namespace React object imports', () => {
    const source = [
      `import React from 'react';`,
      `import * as ReactNamespace from 'react';`,
      `import { default as ReactNamedDefault } from 'react';`,
      'const FirstContext = React.createContext(null);',
      'const SecondContext = ReactNamespace.createContext(undefined);',
      'const ThirdContext = ReactNamedDefault.createContext({});',
      'export default function useFirstContext() { return React.useContext(FirstContext); }',
      'export const useSecondContext = function namedHook() {',
      '  return ReactNamespace.useContext(SecondContext);',
      '};',
      'export const useThirdContext = () =>',
      '  ReactNamedDefault.useContext(ThirdContext as typeof ThirdContext);',
    ].join('\n');

    expect(collectReactContextIdentityPairs('/workspace/objects.tsx', source).pairs).toEqual([
      { contextBinding: 'FirstContext', hookBinding: 'useFirstContext' },
      { contextBinding: 'SecondContext', hookBinding: 'useSecondContext' },
      { contextBinding: 'ThirdContext', hookBinding: 'useThirdContext' },
    ]);
  });

  /** Requires direct returns and local immutable Context creation instead of names alone. */
  it('rejects indirect hooks, imported Contexts, mutable Contexts, and unrelated functions', () => {
    const source = [
      `import { createContext, useContext } from 'react';`,
      `import { ExternalContext, useForeignContext } from './foreign';`,
      'let MutableContext = createContext(null);',
      'const LocalContext = createContext(null);',
      'export const useMutableContext = () => useContext(MutableContext);',
      'export const useExternalContext = () => useContext(ExternalContext);',
      'export const useIndirectContext = () => {',
      '  const value = useContext(LocalContext);',
      '  return value;',
      '};',
      'export const useUnrelatedContext = () => useForeignContext();',
      'function Owner() {',
      '  function useNestedContext() { return useContext(LocalContext); }',
      '  return useNestedContext;',
      '}',
    ].join('\n');

    expect(collectReactContextIdentityPairs('/workspace/unsafe.tsx', source)).toEqual({
      pairs: [],
      truncated: false,
    });
  });

  /** Rejects lexical shadowing, duplicate declarations, async hooks, and non-direct blocks. */
  it('fails closed for ambiguous or contract-changing hook implementations', () => {
    const source = [
      `import { createContext, useContext } from 'react';`,
      'const AppContext = createContext(null);',
      'export const useParameterContext = (AppContext: unknown) => useContext(AppContext);',
      'export const useShadowedContext = function useContext() {',
      '  return useContext(AppContext);',
      '};',
      'export async function useAsyncContext() { return useContext(AppContext); }',
      'export function useBusyContext() {',
      '  void 0;',
      '  return useContext(AppContext);',
      '}',
      'export function useDuplicateContext() { return useContext(AppContext); }',
      'export function useDuplicateContext() { return useContext(AppContext); }',
    ].join('\n');

    expect(collectReactContextIdentityPairs('/workspace/ambiguous.tsx', source).pairs).toEqual([]);
  });

  /** Type-only/fake React bindings and unsupported file identities never establish API proof. */
  it('requires runtime React imports and project-owned executable source', () => {
    const source = [
      `import type { createContext, useContext } from 'react';`,
      'const AppContext = createContext(null);',
      'export const useAppContext = () => useContext(AppContext);',
    ].join('\n');

    expect(collectReactContextIdentityPairs('/workspace/types.ts', source).pairs).toEqual([]);
    expect(
      collectReactContextIdentityPairs('/workspace/node_modules/pkg/context.ts', source).pairs,
    ).toEqual([]);
    expect(collectReactContextIdentityPairs('/workspace/context.d.ts', source).pairs).toEqual([]);
    expect(
      collectReactContextIdentityPairs('/workspace/broken.tsx', 'export const = ;').pairs,
    ).toEqual([]);
  });

  /** Exceeding a source or candidate budget returns no partial identities and marks degradation. */
  it('fails closed when bounded analysis would be incomplete', () => {
    const oversizedSource = ' '.repeat(4 * 1024 * 1024 + 1);
    const boundedSource = [
      `import { createContext, useContext } from 'react';`,
      ...Array.from(
        { length: 65 },
        (_, index) => `const Context${index.toString()} = createContext(null);`,
      ),
      'export const useLastContext = () => useContext(Context64);',
    ].join('\n');

    expect(collectReactContextIdentityPairs('/workspace/oversized.tsx', oversizedSource)).toEqual({
      pairs: [],
      truncated: true,
    });
    expect(collectReactContextIdentityPairs('/workspace/bounded.tsx', boundedSource)).toEqual({
      pairs: [],
      truncated: true,
    });
  });
});
