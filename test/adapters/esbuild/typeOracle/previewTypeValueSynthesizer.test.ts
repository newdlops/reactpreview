/**
 * Verifies declared-type value synthesis against a real TypeScript checker over virtual files.
 * The cases mirror the placeholder crashes observed in authored pages: numeric leaves, finite
 * literal lookups, discriminated form state, and success-shaped query results.
 */
import ts from 'typescript';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_TYPED_VALUE_TAG,
  synthesizePreviewTypedValue,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeValueSynthesizer';

const ENTRY = '/virtual/page.tsx';

describe('synthesizePreviewTypedValue', () => {
  it('keeps React component constructors callable even when their type owns metadata properties', () => {
    const reactTypes = path.resolve('node_modules/@types/react/index.d.ts').replaceAll('\\', '/');
    const declared = synthesizeCall(
      [
        `import type { ComponentType, ForwardRefExoticComponent } from ${JSON.stringify(reactTypes)};`,
        'declare function useIcons(): { Icon: ComponentType<{ size?: number }> | null; Forwarded: ForwardRefExoticComponent<{ color?: string }> };',
        'const probe = useIcons();',
      ].join('\n'),
      ['Icon', 'Forwarded'],
    );
    expect(declared?.value).toEqual({
      Icon: { [PREVIEW_TYPED_VALUE_TAG]: 'function', returns: null },
      Forwarded: { [PREVIEW_TYPED_VALUE_TAG]: 'function', returns: null },
    });
    const ordinary = synthesizeCall(
      'interface FunctionComponent { current: null }; declare function useData(): FunctionComponent; const probe = useData();',
      ['current'],
    );
    expect(ordinary?.value).toEqual({ current: null });
  });

  it('tags genuine React ref contracts while keeping a same-named authored record ordinary', () => {
    const reactTypes = path.resolve('node_modules/@types/react/index.d.ts').replaceAll('\\', '/');
    const declared = synthesizeCall(
      [
        `import type { RefObject, MutableRefObject } from ${JSON.stringify(reactTypes)};`,
        'declare function useRefs(): { container: RefObject<object | null>; counter: MutableRefObject<number> };',
        'const probe = useRefs();',
      ].join('\n'),
      ['container', 'counter'],
    );
    expect(declared?.value).toEqual({
      container: { [PREVIEW_TYPED_VALUE_TAG]: 'ref', value: null },
      counter: { [PREVIEW_TYPED_VALUE_TAG]: 'ref', value: 1 },
    });
    const ordinary = synthesizeCall(
      'interface RefObject { current: null }; declare function useData(): RefObject; const probe = useData();',
      ['current'],
    );
    expect(ordinary?.value).toEqual({ current: null });
  });

  /**
   * A typed value shown as-is fills lists like the browser's generated lists: SimSheet showed one
   * "W+1" header from a one-item `future: string[]`. Tuples keep their declared length.
   */
  it('fills declared Arrays with item-specific dates and ids when asked for longer lists', () => {
    const source = [
      'interface Row { id: string; name: string; createdAt: Date; startDate: string }',
      'declare function useBoard(): { rows: Row[]; pair: [number, number] };',
      'export const probe = useBoard();',
    ].join('\n');

    const longer = synthesizeCall(source, [], undefined, { listLength: 3 })?.value as {
      pair: unknown[];
      rows: Record<string, unknown>[];
    };
    const single = synthesizeCall(source, [])?.value as { rows: unknown[] };

    expect(longer.rows.map(({ id, name, startDate }) => [id, name, startDate])).toEqual([
      ['preview-id', 'Name', '2026-01-15'],
      ['preview-id-2', 'Name 2', '2026-01-14'],
      ['preview-id-3', 'Name 3', '2026-01-13'],
    ]);
    expect(longer.rows.map((row) => (row.createdAt as Record<string, unknown>).iso)).toEqual([
      '2026-01-15T09:00:00.000Z',
      '2026-01-14T09:00:00.000Z',
      '2026-01-13T09:00:00.000Z',
    ]);
    expect(longer.pair).toHaveLength(2);
    expect(single.rows).toHaveLength(1);
  });

  /** SimSheet's `future` week headers went backwards (W+1 10/9, W+2 10/8): future lists count up. */
  it('steps future-named date lists forward and other date lists back', () => {
    const source = [
      'interface Weeks { pastDates: string[]; futureDates: string[]; upcomingEvents: { startDate: string }[] }',
      'declare function useWeeks(): Weeks;',
      'export const probe = useWeeks();',
    ].join('\n');

    const value = synthesizeCall(source, [], undefined, { listLength: 3 })?.value as {
      futureDates: string[];
      pastDates: string[];
      upcomingEvents: { startDate: string }[];
    };

    expect(value.pastDates).toEqual(['2026-01-15', '2026-01-14', '2026-01-13']);
    expect(value.futureDates).toEqual(['2026-01-15', '2026-01-16', '2026-01-17']);
    expect(value.upcomingEvents.map((event) => event.startDate)).toEqual([
      '2026-01-15',
      '2026-01-16',
      '2026-01-17',
    ]);
  });

  /** A one-day typed period hid every generated row but today's (InboundTab's period filter). */
  it('opens typed date ranges nine days back so sample rows fall inside them', () => {
    const source = [
      'interface Scope { periodStart: string; periodEnd: string; valid_from: string; activeSince: string }',
      'declare function useScope(): Scope;',
      'export const probe = useScope();',
    ].join('\n');

    expect(synthesizeCall(source, [])?.value).toEqual({
      activeSince: '2026-01-06',
      periodEnd: '2026-01-15',
      periodStart: '2026-01-06',
      valid_from: '2026-01-06',
    });
  });

  /** SKUTable's `depleteMD: string // 'M/D'` showed the label "Deplete md" instead of a day. */
  it('writes year-less month/day text in the documented format', () => {
    const source = [
      'interface Row {',
      "  depleteMD: string // 'M/D' (테이블)",
      '  dayLabel: string // MM/DD',
      '}',
      'declare function useRows(): { rows: Row[] };',
      'export const probe = useRows();',
    ].join('\n');

    const rows = (
      synthesizeCall(source, [], undefined, { listLength: 3 })?.value as {
        rows: Record<string, string>[];
      }
    ).rows;

    expect(rows.map((row) => row.depleteMD)).toEqual(['1/15', '1/14', '1/13']);
    expect(rows.map((row) => row.dayLabel)).toEqual(['01/15', '01/14', '01/13']);
  });

  /** Record leaves demanded by authored reads become declared numbers instead of `{}`. */
  it('synthesizes demanded numeric record keys and optional fields', () => {
    const result = synthesizeCall(
      [
        'export interface Summary {',
        '  attention_required_skus?: number;',
        '  status_counts: Record<string, number>;',
        '  total_inventory_value: number;',
        '}',
        'declare function useSummary(): { data: Summary | null; isError: boolean };',
        'export const probe = useSummary();',
      ].join('\n'),
      ['data.status_counts.OUT_OF_STOCK', 'data.attention_required_skus', 'isError'],
    );
    const data = (result?.value as Record<string, Record<string, unknown>>).data;

    expect(typeof data?.total_inventory_value).toBe('number');
    expect(typeof data?.attention_required_skus).toBe('number');
    expect(typeof (data?.status_counts as Record<string, unknown>).OUT_OF_STOCK).toBe('number');
    expect((result?.value as Record<string, unknown>).isError).toBe(false);
  });

  /** A finite literal union is honored and recorded so the runtime can repair invalid text. */
  it('selects and records finite literal unions inside collections', () => {
    const result = synthesizeCall(
      [
        "type Grade = 'S' | 'A' | 'B' | 'C';",
        'declare function useRows(): { items: { code: string; grade: Grade }[] };',
        'export const probe = useRows();',
      ].join('\n'),
      ['items[].grade'],
    );

    expect(result?.value).toEqual({ items: [{ code: 'Code', grade: 'S' }] });
    expect(result?.literals['items[].grade']).toEqual(['S', 'A', 'B', 'C']);
  });

  /** A literal another module created first ('warn' of a toast kind) must not lead a status union. */
  it('selects literals in declared order regardless of which types were checked first', () => {
    const source = [
      "type ToastKind = 'info' | 'warn' | 'error';",
      "type Status = 'crit' | 'risk' | 'warn' | 'ok';",
      "interface Row { status: Status; kind: 'x' | 'warn'; phase: 'idle' | 'loading' | 'success' }",
      'declare function useRows(): { rows: Row[] };',
      "export const toastKind: ToastKind = 'warn';",
      'export const probe = useRows();',
    ].join('\n');
    const paths = ['rows[].status', 'rows[].kind', 'rows[].phase'];

    const primed = synthesizeCall(source, paths, 'toastKind');
    const cold = synthesizeCall(source, paths);

    // A settled phase still wins over the declared initial state.
    expect(primed?.value).toEqual({ rows: [{ kind: 'x', phase: 'success', status: 'crit' }] });
    expect(primed?.literals['rows[].status']).toEqual(['crit', 'risk', 'warn', 'ok']);
    expect(cold).toEqual(primed);
  });

  /**
   * `Omit`/`Pick` list keys in their literals' creation order, so a Prisma row's sample object
   * changed key order between compiles; keys follow the declaration however checking went.
   */
  it('keeps mapped-type property order independent of which literals were checked first', () => {
    const source = [
      "type Keys = 'title' | 'body' | 'id';",
      'interface Notice { id: string; title: string; body: string; read: boolean }',
      "declare function useNotice(): Omit<Notice, 'read'>;",
      "export const keys: Keys = 'body';",
      'export const probe = useNotice();',
    ].join('\n');

    const primed = synthesizeCall(source, [], 'keys')?.value as object;
    const cold = synthesizeCall(source, [])?.value as object;

    expect(Object.keys(primed)).toEqual(['id', 'title', 'body']);
    expect(Object.keys(cold)).toEqual(['id', 'title', 'body']);
  });

  /** Bigint fields become tagged integer samples instead of disappearing (`Number(undefined)`). */
  it('tags bigint fields with integer samples and keeps bigint literals', () => {
    const source = [
      'interface Usage { costMicros: bigint; totalTokens: number; plan: 7n; debt: -3n; large: 9007199254740993n }',
      'declare function useUsage(): Usage;',
      'export const probe = useUsage();',
    ].join('\n');

    expect(synthesizeCall(source, [])?.value).toEqual({
      costMicros: { $previewTyped: 'bigint', value: '1' },
      debt: { $previewTyped: 'bigint', value: '-3' },
      large: { $previewTyped: 'bigint', value: '9007199254740993' },
      plan: { $previewTyped: 'bigint', value: '7' },
      totalTokens: 0,
    });
  });

  /** A selector result carries no annotation; enum members still follow their declarations. */
  it('orders enum members by declaration without an annotated union', () => {
    const source = [
      "enum Permission { ReadPatients = 'read:patients', WritePatients = 'write:patients', CancelLab = 'cancel:lab' }",
      'declare function useSelector(): (Permission | null)[];',
      'export const cancel: Permission = Permission.CancelLab;',
      'export const probe = useSelector();',
    ].join('\n');

    const primed = synthesizeCall(source, ['[]'], 'cancel');

    expect(primed?.value).toEqual(['read:patients']);
    expect(primed?.literals['[]']).toEqual(['read:patients', 'write:patients', 'cancel:lab']);
  });

  /** Authored reads select the union member that owns every demanded field. */
  it('chooses the discriminated member that satisfies required paths', () => {
    const result = synthesizeCall(
      [
        'interface Row { id: string; quantity: number }',
        "type FormState = { mode: 'create' } | { mode: 'edit'; rows: Row[] } | null;",
        'declare function useForm(): FormState;',
        'export const probe = useForm();',
      ].join('\n'),
      ['mode', 'rows'],
    );

    expect(result?.value).toEqual({ mode: 'edit', rows: [{ id: 'preview-id', quantity: 0 }] });
  });

  /** Query-like result unions prefer the settled success variant with present data. */
  it('prefers the success variant of a query result union', () => {
    const result = synthesizeCall(
      [
        'interface Item { name: string }',
        'type Result<T> =',
        "  | { status: 'pending'; data: undefined; isLoading: true; isError: false; error: null }",
        "  | { status: 'error'; data: undefined; isLoading: false; isError: true; error: Error }",
        "  | { status: 'success'; data: T; isLoading: false; isError: false; error: null; refetch: () => void };",
        'declare function useItems(): Result<Item[]>;',
        'export const probe = useItems();',
      ].join('\n'),
      ['data.map()'],
    );
    const value = result?.value as Record<string, unknown>;

    expect(value.status).toBe('success');
    expect(value.data).toEqual([{ name: 'Name' }]);
    expect(value.isLoading).toBe(false);
    expect(value.error).toBeNull();
    expect(value.refetch).toEqual({ [PREVIEW_TYPED_VALUE_TAG]: 'function' });
  });

  /** Runtime-only values are tagged; tuples keep positional element types. */
  it('tags dates and functions and keeps tuple positions', () => {
    const result = synthesizeCall(
      [
        'declare function useThing(): {',
        '  createdAt: Date;',
        '  onSelect: (id: string) => boolean;',
        '  pair: [string, number];',
        '};',
        'export const probe = useThing();',
      ].join('\n'),
      [],
    );
    const value = result?.value as Record<string, unknown>;

    expect(value.createdAt).toEqual({
      [PREVIEW_TYPED_VALUE_TAG]: 'date',
      iso: '2026-01-15T09:00:00.000Z',
    });
    expect(value.onSelect).toEqual({ [PREVIEW_TYPED_VALUE_TAG]: 'function', returns: false });
    expect(value.pair).toEqual(['Pair0', 1]);
  });

  /** Date-named text uses calendar dates, timestamp names use ISO date-times. */
  it('formats date-named strings by their conventional calendar shape', () => {
    const result = synthesizeCall(
      [
        'declare function usePromotion(): {',
        '  created_at: string;',
        '  end_date: string;',
        '  startDate: string;',
        '  updatedAt: string;',
        '  week: string;',
        '};',
        'export const probe = usePromotion();',
      ].join('\n'),
      [],
    );

    expect(result?.value).toEqual({
      created_at: '2026-01-15T09:00:00.000Z',
      end_date: '2026-01-15',
      startDate: '2026-01-15',
      updatedAt: '2026-01-15T09:00:00.000Z',
      week: '2026-01-15',
    });
  });

  /** Untyped roots keep the caller's syntax fallback, and error slots stay absent. */
  it('returns nothing for any and null for nullable error slots', () => {
    const untyped = synthesizeCall(
      ['declare function useLoose(): any;', 'export const probe = useLoose();'].join('\n'),
      [],
    );
    const withError = synthesizeCall(
      [
        'declare function useSave(): { error: Error | null; title: string };',
        'export const probe = useSave();',
      ].join('\n'),
      [],
    );

    expect(untyped).toBeUndefined();
    expect(withError?.value).toEqual({ error: null, title: 'Title' });
  });
});

/** Creates a checker over one virtual module and synthesizes the type of `probe`'s initializer. */
function synthesizeCall(
  source: string,
  requiredPaths: readonly string[],
  primedDeclaration?: string,
  synthesisOptions?: Parameters<typeof synthesizePreviewTypedValue>[4],
): ReturnType<typeof synthesizePreviewTypedValue> {
  const options: ts.CompilerOptions = {
    lib: ['lib.es2022.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options, true);
  const readDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion) =>
    fileName === ENTRY
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : readDisk(fileName, languageVersion);
  const program = ts.createProgram({ host, options, rootNames: [ENTRY] });
  const sourceFile = program.getSourceFile(ENTRY);
  if (sourceFile === undefined) throw new Error('The virtual module was not loaded.');
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer)
    ) {
      call = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (call === undefined) throw new Error('The probe call was not found.');
  const checker = program.getTypeChecker();
  // Checking another declaration first creates its literal types first, as an earlier site would.
  const primed = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((declaration) => declaration.name.getText(sourceFile) === primedDeclaration);
  if (primed !== undefined) checker.getTypeAtLocation(primed.name);
  return synthesizePreviewTypedValue(
    checker,
    checker.getTypeAtLocation(call),
    call,
    requiredPaths,
    synthesisOptions,
  );
}
