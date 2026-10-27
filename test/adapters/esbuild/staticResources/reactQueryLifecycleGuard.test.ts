/** Prevents query-loading bypasses from turning valid async lifecycles into data dereference errors. */
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

/** Instruments inert component syntax and reads only the selected early-return metadata. */
function protects(
  declarations: string,
  condition: string,
  continuation = 'records.length',
): boolean {
  const transformed = instrumentReactConditionalRendering(
    '/workspace/Page.tsx',
    `
    export function Page(props) {
      ${declarations}
      if (${condition}) return <Skeleton />;
      return <main>{${continuation}}</main>;
    }`,
  );
  return transformed.includes('"requiresAuthoredState":true');
}

describe('query lifecycle continuation safety', () => {
  it.each(['pending', 'loading', 'error'])(
    'preserves an aliased %s result before its own data.length',
    (status) => {
      expect(
        protects(
          'const query = useRows(); const { data: records, status: phase } = query;',
          `phase === '${status}'`,
        ),
      ).toBe(true);
    },
  );

  it('correlates direct query destructuring and a later map receiver', () => {
    expect(
      protects(
        'const { data: records, status } = useRows();',
        "status === 'pending'",
        'records.map(renderRow)',
      ),
    ).toBe(true);
  });

  it.each([
    'query.isPending',
    'query.isLoading',
    'query.isError',
    '!query.isSuccess',
    "query.status !== 'success'",
  ])('retains a source-correlated lifecycle guard: %s', (condition) => {
    expect(protects('const query = useRows();', condition, 'query.data.length')).toBe(true);
  });

  it.each([
    [
      'unrelated query',
      'const first = useRows(); const second = useOther(); const { data: records } = second;',
      "first.status === 'pending'",
      'records.length',
    ],
    ['standalone loading flag', 'const { loading, records } = props;', 'loading', 'records.length'],
    [
      'ordinary status field',
      'const { status, records } = props;',
      "status === 'pending'",
      'records.length',
    ],
    [
      'optional data read',
      'const { data: records, status } = useRows();',
      "status === 'pending'",
      'records?.length',
    ],
    [
      'defaulted data binding',
      'const { data: records = [], status } = useRows();',
      "status === 'pending'",
      'records.length',
    ],
    [
      'defaulted status binding',
      "const { data: records, status = 'pending' } = useRows();",
      "status === 'pending'",
      'records.length',
    ],
    [
      'other lifecycle value',
      'const { data: records, status } = useRows();',
      "status === 'idle'",
      'records.length',
    ],
    [
      'nested shadow',
      'const { data: records, status } = useRows();',
      "status === 'pending'",
      'items.map(records => records.length)',
    ],
  ])('keeps %s selectable', (_label, declarations, condition, continuation) => {
    expect(protects(declarations, condition, continuation)).toBe(false);
  });
});
