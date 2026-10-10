/**
 * Verifies the budgeted analysis program behind declared-type hook values.
 * A temporary project proves cross-file project types, managed-layer package typings, dirty
 * editor snapshots, the byte budget, and the heap gate without touching a user workspace.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectPreviewTypeProgramBudget } from '../../../../src/adapters/esbuild/typeOracle/previewTypeHeap';
import { PreviewTypeOracle } from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';
import {
  PREVIEW_TYPE_PROGRAM_DEFAULT_BUDGET,
  PreviewTypeSourceFileCache,
  createPreviewTypeProgram,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('PreviewTypeOracle', () => {
  /** Project types from sibling modules and package typings from managed layers both resolve. */
  it('types a hook call across modules and managed package layers', async () => {
    const fixture = await createFixture();
    try {
      const view = new PreviewTypeOracle().createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [fixture.pagePath],
      });

      const summary = view.readTypedCallValue({
        callText: 'useSummary()',
        occurrence: 0,
        requiredPaths: ['counts.OUT_OF_STOCK'],
        sourcePath: fixture.pagePath,
      });
      const managed = view.readTypedCallValue({
        callText: 'useManagedValue()',
        occurrence: 0,
        requiredPaths: [],
        sourcePath: fixture.pagePath,
      });

      expect(summary?.value).toEqual({ counts: { OUT_OF_STOCK: 1 }, grade: 'S', total: 0 });
      expect(summary?.typeText).toBe('Summary');
      expect(managed?.value).toEqual({ amount: 0, label: 'Label' });

      // A finished build drops its program but keeps the coverage facts.
      view.release();
      expect(
        view.readTypedCallValue({
          callText: 'useSummary()',
          occurrence: 0,
          requiredPaths: [],
          sourcePath: fixture.pagePath,
        }),
      ).toBeUndefined();
      expect(view.readStatus()).toMatchObject({ projectFiles: 3 });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Unsaved editor contents replace the saved file inside the analysis program. */
  it('reads dirty editor snapshots before saved files', async () => {
    const fixture = await createFixture();
    try {
      const dirtyTypes = [
        "export type Grade = 'Z';",
        'export interface Summary { counts: Record<string, number>; grade: Grade; total: number }',
      ].join('\n');
      const view = new PreviewTypeOracle().createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: (sourcePath) => (sourcePath === fixture.typesPath ? dirtyTypes : undefined),
        rootPaths: [fixture.pagePath],
      });

      const summary = view.readTypedCallValue({
        callText: 'useSummary()',
        occurrence: 0,
        requiredPaths: [],
        sourcePath: fixture.pagePath,
      });

      expect((summary?.value as Record<string, unknown>).grade).toBe('Z');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Files beyond the admission budget stay unresolved, so the value is simply unavailable. */
  it('fails open when the project-file budget excludes the declaring module', async () => {
    const fixture = await createFixture();
    try {
      const analysis = createPreviewTypeProgram(
        {
          managedNodeModulesPaths: [fixture.managedNodeModules],
          readSnapshot: () => undefined,
          rootPaths: [fixture.pagePath],
        },
        new PreviewTypeSourceFileCache(),
        { maxFileBytes: 1024 * 1024, maxProjectFiles: 1, maxTextBytes: 8 * 1024 * 1024 },
      );

      expect(analysis.status.projectFiles).toBe(1);
      expect(analysis.status.refusedModules).toBeGreaterThan(0);
      expect(analysis.program.getSourceFile(fixture.typesPath)).toBeUndefined();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe('declared response shapes', () => {
  /** An imported response type resolves through promise and HTTP response wrappers. */
  it('shapes an imported response body behind promise and transport wrappers', async () => {
    const fixture = await createFixture();
    try {
      const apiPath = path.join(path.dirname(fixture.pagePath), 'api.ts');
      await writeFile(
        apiPath,
        [
          "import type { Summary } from './types';",
          'interface HttpResponse<T> { data: T; status: number; headers: Record<string, string> }',
          'declare const client: { get<T>(url: string): Promise<HttpResponse<T>> };',
          "export const load = () => client.get<Summary>('/summary');",
          'declare const cache: Map<string, Summary>;',
          "export const cached = () => cache.get('/summary');",
          'export type Loaded = Promise<HttpResponse<Summary>>;',
        ].join('\n'),
      );
      const view = new PreviewTypeOracle(undefined, () => ROOMY_HEAP).createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [apiPath],
      });
      const summaryShape = {
        fields: {
          counts: { fields: {}, kind: 'object' },
          grade: { kind: 'literal', value: 'S' },
          total: { kind: 'number' },
        },
        kind: 'object',
      };

      expect(
        view.readTypedResponseShape({ occurrence: 0, sourcePath: apiPath, typeText: 'Summary' }),
      ).toEqual(summaryShape);
      expect(
        view.readTypedResponseShape({
          occurrence: 0,
          sourcePath: apiPath,
          typeText: 'Promise<HttpResponse<Summary>>',
        }),
      ).toEqual(summaryShape);
      // A promise-returning request call resolves the same body; a synchronous `get` does not.
      expect(
        view.readTypedCallResponseShape({
          callText: "client.get<Summary>('/summary')",
          occurrence: 0,
          sourcePath: apiPath,
        }),
      ).toEqual(summaryShape);
      expect(
        view.readTypedCallResponseShape({
          callText: "cache.get('/summary')",
          occurrence: 0,
          sourcePath: apiPath,
        }),
      ).toBeUndefined();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe('payloads declared by the returning function', () => {
  /** `const { data } = await client.get(url); return data;` under `Promise<Summary>`. */
  it('types an untyped client body only when the annotated function returns it unchanged', async () => {
    const fixture = await createFixture();
    try {
      const apiPath = path.join(path.dirname(fixture.pagePath), 'untyped-api.ts');
      await writeFile(
        apiPath,
        [
          "import type { Summary } from './types';",
          'interface HttpResponse<T> { data: T; status: number; headers: Record<string, string> }',
          'declare const client: { get<T = any>(url: string): Promise<HttpResponse<T>> };',
          'export const byBinding = async (id: number): Promise<Summary> => {',
          '  const { data } = await client.get(`/binding/${id}`);',
          '  return data;',
          '};',
          'export async function byAccess(): Promise<Summary> {',
          "  const response = await client.get('/access');",
          '  return response.data;',
          '}',
          "export const byAwait = async (): Promise<Summary> => (await client.get('/await')).data;",
          'export const byThen = (): Promise<Summary> =>',
          "  client.get('/then').then((response) => response.data);",
          "export const picked = async (): Promise<Summary['total']> => {",
          "  const { data } = await client.get('/picked');",
          '  return data.total;',
          '};',
          'export const unannotated = async () => {',
          "  const { data } = await client.get('/unannotated');",
          '  return data;',
          '};',
        ].join('\n'),
      );
      const view = new PreviewTypeOracle(undefined, () => ROOMY_HEAP).createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [apiPath],
      });
      const read = (callText: string): unknown =>
        view.readTypedCallResponseShape({ callText, occurrence: 0, sourcePath: apiPath });
      const summaryShape = {
        fields: {
          counts: { fields: {}, kind: 'object' },
          grade: { kind: 'literal', value: 'S' },
          total: { kind: 'number' },
        },
        kind: 'object',
      };

      expect(read('client.get(`/binding/${id}`)')).toEqual(summaryShape);
      expect(read("client.get('/access')")).toEqual(summaryShape);
      expect(read("client.get('/await')")).toEqual(summaryShape);
      expect(read("client.get('/then')")).toEqual(summaryShape);
      // A picked field or an unannotated function says nothing about the whole body.
      expect(read("client.get('/picked')")).toBeUndefined();
      expect(read("client.get('/unannotated')")).toBeUndefined();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe('record-typed response fields', () => {
  /** `Record<string, number>` has no declared keys; the keys come from the project's own reads. */
  it('fills a record field with the literal keys the project reads from that field only', async () => {
    const fixture = await createFixture();
    try {
      const source = path.dirname(fixture.pagePath);
      const apiPath = path.join(source, 'trend-api.ts');
      await writeFile(
        path.join(source, 'trend-types.ts'),
        [
          'export interface Row {',
          '  trend?: Record<string, number>;',
          '  totals: Record<string, number>;',
          '  untouched: Record<string, number>;',
          '  sku: string;',
          '}',
        ].join('\n'),
      );
      await writeFile(
        path.join(source, 'trend-use.ts'),
        [
          "import type { Row } from './trend-types';",
          'export function buildTrend(trend: Record<string, number> | undefined): number[] {',
          '  if (!trend) return [];',
          "  return ['w-2', 'w-1'].map((k) => trend[k] ?? 0);",
          '}',
          "const TOTAL_KEYS = ['in', 'out'] as const;",
          'export function describe(row: Row): number {',
          '  let sum = buildTrend(row.trend).length;',
          '  for (const key of TOTAL_KEYS) sum += row.totals[key] ?? 0;',
          "  return sum + (row.totals['net'] ?? 0);",
          '}',
        ].join('\n'),
      );
      await writeFile(
        apiPath,
        [
          "import type { Row } from './trend-types';",
          "import './trend-use';",
          'declare const client: { get<T>(url: string): Promise<{ data: T; status: number; headers: unknown }> };',
          "export const load = () => client.get<Row[]>('/rows');",
        ].join('\n'),
      );
      const view = new PreviewTypeOracle(undefined, () => ROOMY_HEAP).createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [apiPath],
      });

      expect(
        view.readTypedResponseShape({ occurrence: 0, sourcePath: apiPath, typeText: 'Row[]' }),
      ).toEqual({
        items: {
          fields: {
            sku: { kind: 'string' },
            totals: {
              fields: { in: { kind: 'number' }, net: { kind: 'number' }, out: { kind: 'number' } },
              kind: 'object',
            },
            trend: {
              fields: { 'w-1': { kind: 'number' }, 'w-2': { kind: 'number' } },
              kind: 'object',
            },
            untouched: { fields: {}, kind: 'object' },
          },
          kind: 'object',
        },
        kind: 'array',
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe('typed component props', () => {
  /** A required prop typed as another module's closed key set gets a member, not `undefined`. */
  it('synthesizes required scalar props and leaves optional, callable, and children props', async () => {
    const fixture = await createFixture();
    try {
      const source = path.dirname(fixture.pagePath);
      const chipPath = path.join(source, 'chip.tsx');
      await writeFile(
        path.join(source, 'tokens.ts'),
        [
          'export const STATUS: Record<',
          "  'crit' | 'ok',",
          '  { bg: string }',
          "> = { crit: { bg: 'red' }, ok: { bg: 'green' } };",
        ].join('\n'),
      );
      await writeFile(
        chipPath,
        [
          "import { STATUS } from './tokens';",
          'type StatusKey = keyof typeof STATUS;',
          'export function StatusChip({ status, count, onPick, children, dot = true }: {',
          '  status: StatusKey;',
          '  count: number;',
          '  onPick: () => void;',
          '  children: unknown;',
          '  dot?: boolean;',
          '}) {',
          '  return STATUS[status].bg + String(count) + String(dot) + String(onPick) + String(children);',
          '}',
        ].join('\n'),
      );
      const view = new PreviewTypeOracle(undefined, () => ROOMY_HEAP).createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [chipPath],
      });

      const props = view.readTypedComponentProps({
        exportName: 'StatusChip',
        sourcePath: chipPath,
      });
      expect(props?.status).toBe('crit');
      expect(typeof props?.count).toBe('number');
      expect(Object.keys(props ?? {}).sort()).toEqual(['count', 'status']);
      expect(view.readTypedComponentProps({ exportName: 'Missing', sourcePath: chipPath })).toBe(
        undefined,
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** SimSheet's `weeks.past` was guessed as `{ length: 0 }` and `weeks.current` was missing. */
  it('synthesizes structured required props with dates as text and without functions', async () => {
    const fixture = await createFixture();
    try {
      const source = path.dirname(fixture.pagePath);
      const sheetPath = path.join(source, 'sheet.tsx');
      await writeFile(
        sheetPath,
        [
          'interface Weeks {',
          '  past: string[];',
          '  /** 이번 주 월요일 */',
          '  current: string;',
          '  periodStart: string;',
          '  at: Date;',
          '  format: () => string;',
          '}',
          'export function Sheet({ weeks, rows }: { weeks: Weeks; rows: { name: string }[] }) {',
          '  return weeks.current + weeks.past.join() + rows.length;',
          '}',
        ].join('\n'),
      );
      const view = new PreviewTypeOracle(undefined, () => ROOMY_HEAP).createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [sheetPath],
      });

      const props = view.readTypedComponentProps({ exportName: 'Sheet', sourcePath: sheetPath });
      const weeks = props?.weeks as Record<string, unknown> | undefined;

      expect(Array.isArray(weeks?.past)).toBe(true);
      expect(weeks?.current).toBe('2026-01-15');
      // A range opening endpoint starts nine days back so the period holds every sample row.
      expect(weeks?.periodStart).toBe('2026-01-06');
      expect(weeks?.at).toBe('2026-01-15T09:00:00.000Z');
      expect(weeks).not.toHaveProperty('format');
      expect(Array.isArray(props?.rows)).toBe(true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe('type program byte budget', () => {
  /** A generated module larger than the per-file limit is refused; nearer small modules stay. */
  it('refuses an oversized module without stopping smaller ones', async () => {
    const fixture = await createFixture();
    try {
      const generatedPath = path.join(path.dirname(fixture.pagePath), 'generated.ts');
      await writeFile(
        generatedPath,
        `export const schema = ${JSON.stringify('x'.repeat(6000))};\n`,
      );
      await writeFile(
        fixture.pagePath,
        `import './generated';\n${await readFile(fixture.pagePath, 'utf8')}`,
      );
      const oracle = new PreviewTypeOracle(undefined, () => ROOMY_HEAP);
      const view = oracle.createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [fixture.pagePath],
      });
      const analysis = createPreviewTypeProgram(
        {
          managedNodeModulesPaths: [fixture.managedNodeModules],
          readSnapshot: () => undefined,
          rootPaths: [fixture.pagePath],
        },
        new PreviewTypeSourceFileCache(),
        { ...PREVIEW_TYPE_PROGRAM_DEFAULT_BUDGET, maxFileBytes: 4000 },
      );

      expect(analysis.program.getSourceFile(generatedPath)).toBeUndefined();
      expect(analysis.program.getSourceFile(fixture.typesPath)).toBeDefined();
      expect(analysis.status.refusedModules).toBe(1);
      expect(analysis.status.refusedBytes).toBeGreaterThan(6000);
      expect(analysis.status.admittedBytes).toBeLessThanOrEqual(analysis.status.budgetBytes);
      expect(
        view.readTypedCallValue({
          callText: 'useSummary()',
          occurrence: 0,
          requiredPaths: [],
          sourcePath: fixture.pagePath,
        })?.typeText,
      ).toBe('Summary');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Triple-slash references in admitted declarations cannot load files the budget never saw. */
  it('serves only admitted modules and lib files', async () => {
    const fixture = await createFixture();
    try {
      const managedIndex = path.join(fixture.managedNodeModules, 'managed-lib', 'index.d.ts');
      const extraPath = path.join(fixture.managedNodeModules, 'managed-lib', 'extra.d.ts');
      await writeFile(extraPath, 'declare const unbudgeted: number;\n');
      await writeFile(
        managedIndex,
        `/// <reference path="./extra.d.ts" />\n/// <reference types="node" />\n${await readFile(managedIndex, 'utf8')}`,
      );
      const analysis = createPreviewTypeProgram(
        {
          managedNodeModulesPaths: [fixture.managedNodeModules],
          readSnapshot: () => undefined,
          rootPaths: [fixture.pagePath],
        },
        new PreviewTypeSourceFileCache(),
      );
      const loaded = analysis.program.getSourceFiles().map((file) => file.fileName);

      expect(loaded.some((fileName) => fileName.endsWith('/managed-lib/index.d.ts'))).toBe(true);
      expect(loaded.some((fileName) => fileName.endsWith('/extra.d.ts'))).toBe(false);
      expect(loaded.some((fileName) => fileName.includes('@types/node'))).toBe(false);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** A worker without enough headroom skips the program, so the build keeps syntax fallbacks. */
  it('skips analysis when the worker heap cannot afford a program', async () => {
    const fixture = await createFixture();
    try {
      const view = new PreviewTypeOracle(undefined, () => ({
        heap_size_limit: 432 * MIB,
        used_heap_size: 240 * MIB,
      })).createView({
        managedNodeModulesPaths: [fixture.managedNodeModules],
        readSnapshot: () => undefined,
        rootPaths: [fixture.pagePath],
      });

      expect(
        view.readTypedCallValue({
          callText: 'useSummary()',
          occurrence: 0,
          requiredPaths: [],
          sourcePath: fixture.pagePath,
        }),
      ).toBeUndefined();
      expect(view.readStatus()).toMatchObject({ skippedForHeap: true });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Budgets follow live headroom in fixed steps and credit parses the cache will reuse. */
  it('sizes the text budget from heap headroom', () => {
    const limit = 432 * MIB;

    expect(
      selectPreviewTypeProgramBudget({ heap_size_limit: limit, used_heap_size: 60 * MIB }, 0),
    ).toMatchObject({ maxTextBytes: 4 * MIB });
    expect(
      selectPreviewTypeProgramBudget({ heap_size_limit: limit, used_heap_size: 140 * MIB }, 0),
    ).toMatchObject({ maxTextBytes: 2 * MIB });
    expect(
      selectPreviewTypeProgramBudget({ heap_size_limit: limit, used_heap_size: 220 * MIB }, 0),
    ).toBeUndefined();
    expect(
      selectPreviewTypeProgramBudget(
        { heap_size_limit: limit, used_heap_size: 164 * MIB },
        2 * MIB,
      ),
    ).toMatchObject({ maxTextBytes: 2 * MIB });
  });
});

const MIB = 1024 * 1024;
const ROOMY_HEAP = Object.freeze({ heap_size_limit: 4096 * MIB, used_heap_size: 64 * MIB });

/** Writes a two-module project plus a managed layer that the project cannot resolve itself. */
async function createFixture(): Promise<{
  readonly managedNodeModules: string;
  readonly pagePath: string;
  readonly root: string;
  readonly typesPath: string;
}> {
  const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/type-oracle-'));
  const source = path.join(root, 'app', 'src');
  const managedNodeModules = path.join(root, 'managed', 'node_modules');
  const managedPackage = path.join(managedNodeModules, 'managed-lib');
  await mkdir(source, { recursive: true });
  await mkdir(managedPackage, { recursive: true });
  const typesPath = path.join(source, 'types.ts');
  const pagePath = path.join(source, 'page.ts');
  await Promise.all([
    writeFile(
      path.join(root, 'app', 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
      }),
    ),
    writeFile(
      typesPath,
      [
        "export type Grade = 'S' | 'A';",
        'export interface Summary { counts: Record<string, number>; grade: Grade; total: number }',
      ].join('\n'),
    ),
    writeFile(
      path.join(source, 'hooks.ts'),
      [
        "import type { Summary } from './types';",
        'export declare function useSummary(): Summary;',
      ].join('\n'),
    ),
    writeFile(
      pagePath,
      [
        "import { useSummary } from './hooks';",
        "import { useManagedValue } from 'managed-lib';",
        'export const summary = useSummary();',
        'export const managed = useManagedValue();',
      ].join('\n'),
    ),
    writeFile(
      path.join(managedPackage, 'package.json'),
      JSON.stringify({ name: 'managed-lib', types: 'index.d.ts' }),
    ),
    writeFile(
      path.join(managedPackage, 'index.d.ts'),
      'export declare function useManagedValue(): { amount: number; label: string };\n',
    ),
  ]);
  return { managedNodeModules, pagePath, root, typesPath };
}
