/** Verifies syntax-only hook circuit breakers without executing project modules or React hooks. */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('createPreviewRuntimeHookReplacements', () => {
  /** Preserves the authored query default and substitutes only an inert setter after failure. */
  it('instruments use-query-params with a local render-only tuple', () => {
    const source = [
      `import { JsonParam, useQueryParam, withDefault } from 'use-query-params';`,
      'export function List({ variables }) {',
      '  const [filters, setFilters] = useQueryParam(',
      "    'where',",
      '    withDefault(JsonParam, variables?.where || {}),',
      '  );',
      '  return <button onClick={() => setFilters(filters)}>{Object.keys(filters).length}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/List.tsx', source),
    );

    expect(transformed).toContain('.resolveRuntimeHook(');
    expect(transformed).toContain('() => (useQueryParam(');
    expect(transformed).toContain('variables?.where || {}');
    expect(transformed).toContain('Object.freeze(() => undefined)');
    expect(transformed).toContain('"hookName":"useQueryParam"');
    expect(transformed).toContain('"fallbackLabel":"static query value + no-op setter"');
  });

  /** Infers boolean and destructured object fields for project-alias custom hooks. */
  it('creates bounded static values from custom-hook bindings', () => {
    const source = [
      `import { useIsSuspendedSubscription, usePagePermissionCheck } from 'common/ui/hooks';`,
      'export function Page() {',
      '  const suspended = useIsSuspendedSubscription();',
      '  const { isStaffMode, userName, refresh } = usePagePermissionCheck();',
      '  return <main>{suspended ? "paused" : userName}<button onClick={refresh}>{String(isStaffMode)}</button></main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source),
    );

    expect(transformed.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(2);
    expect(transformed).toContain('() => (false)');
    expect(transformed).toContain('"isStaffMode": false');
    expect(transformed).toContain('"userName": "Preview name"');
    expect(transformed).toContain('"refresh": Object.freeze(() => undefined)');
  });

  /** Follows required property reads so a generated object does not fail at the next access. */
  it('materializes nested callable and numeric fields from local hook-result usage', () => {
    const source = [
      `import { usePagination } from '../pagination/use-pagination';`,
      'export function List() {',
      '  const paginationContext = usePagination();',
      '  paginationContext.helpers.setPage(1);',
      '  return <span>{paginationContext.page}/{paginationContext.perPage}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/List.tsx', source),
    );

    expect(transformed).toContain(
      '"helpers": Object.freeze({ "setPage": Object.freeze(() => undefined) })',
    );
    expect(transformed).toContain('"page": 0');
    expect(transformed).toContain('"perPage": 0');
    expect(transformed).toContain('"fallbackLabel":"generated required property shape"');
  });

  /** Leaves framework hooks, external package hooks, and exact Context hooks to dedicated bridges. */
  it('does not wrap unrelated or already identity-bridged hooks', () => {
    const source = [
      `import { useState } from 'react';`,
      `import { useQuery } from '@apollo/client';`,
      `import { useAppContext } from 'legal/app/app-context';`,
      'export function Page() {',
      '  const [count] = useState(0);',
      '  const query = useQuery(DOCUMENT);',
      '  const { user } = useAppContext();',
      '  return <main>{count}{query.data}{user.name}</main>;',
      '}',
    ].join('\n');

    expect(createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source)).toEqual([]);
  });

  /** Keeps one outer replacement when nested hook arguments overlap the same source range. */
  it('selects a deterministic non-overlapping hook edge', () => {
    const source = [
      `import { useCount, useFilter } from './hooks';`,
      'export function Page() {',
      '  const total = useCount(useFilter());',
      '  return total;',
      '}',
    ].join('\n');

    const replacements = createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source);

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('useCount(useFilter())');
  });
});

/** Applies test replacements with the same right-to-left offset policy as the source transformer. */
function applyHookReplacements(
  source: string,
  replacements: ReturnType<typeof createPreviewRuntimeHookReplacements>,
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
