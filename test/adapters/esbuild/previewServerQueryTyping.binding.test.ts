/**
 * Exercises contract receiver identity through the real declared-type oracle. Identical query
 * text in unrelated lexical scopes must retain occurrence order without replacing local results.
 * Also verifies nested query evaluation, import forms, and the existing successful-query budget.
 */
import { transform } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { typePreviewServerQueries } from '../../../src/adapters/esbuild/staticResources/previewServerQueryTyping';
import {
  PreviewTypeOracle,
  type PreviewTypeOracleView,
} from '../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const roots: string[] = [];
const views: PreviewTypeOracleView[] = [];
const CALL = 'prisma.event.findMany()';
const LOCAL = "{ event: { findMany: () => Promise.resolve([{ id: 'authored-local' as const }]) } }";
const CLIENT = [
  'declare const prisma: {',
  '  event: { findMany(): Promise<{ id: "contract-row" }[]> };',
  '  $transaction<T>(queries: Promise<T>[]): Promise<T[]>;',
  '};',
  'export { prisma }; export default prisma;',
].join('\n');

afterEach(async () => {
  for (const view of views.splice(0)) view.release();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('typed contract query binding identity', () => {
  /** Each import form keeps the lexical alias rather than following its imported value symbol. */
  it.each([
    ["import prisma from './db';", CALL],
    ["import { prisma } from './db';", CALL],
    ["import { prisma as db } from './db';", 'db.event.findMany()'],
    ["import * as db from './db';", 'db.prisma.event.findMany()'],
    ["import { prisma as \\u0070risma } from './db';", CALL],
  ])('accepts a runtime contract import: %s', async (importText, call) => {
    const fixture = await createFixture(`${importText}\nexport const rows = () => ${call};`);
    expect(fixture.typed()).toContain(`__reactPreviewTypedServerQuery(${call},`);
  });

  /** Hoisting, TDZ, loop, catch, destructuring, and named expression scopes stay checker-owned. */
  it.each([
    `export function local(prisma: any) { return ${CALL}; }`,
    `export function local({ prisma }: any) { return ${CALL}; }`,
    `export function local() { const rows = ${CALL}; var prisma = ${LOCAL}; return rows; }`,
    `export function local() { return (() => { const rows = ${CALL}; let prisma = ${LOCAL}; return rows; })(); }`,
    `export function local() { try { throw ${LOCAL}; } catch (prisma) { return ${CALL}; } }`,
    `export function local() { for (const prisma of [${LOCAL}]) { return ${CALL}; } }`,
    `export const local = function prisma() { return ${CALL}; };`,
    `export const local = class prisma { method() { return ${CALL}; } };`,
    `export function local() { switch (1) { case 1: return ${CALL}; default: const prisma = ${LOCAL}; } }`,
  ])('preserves identically named local receivers: %s', async (localSource) => {
    const source = [
      "import { prisma } from './db';",
      `export const before = () => ${CALL};`,
      localSource,
      `export const after = () => ${CALL};`,
    ].join('\n');
    const fixture = await createFixture(source);
    const read = vi.spyOn(fixture.oracle, 'readTypedCallValue');
    const typed = fixture.typed();
    expect(typed).toContain(localSource);
    expect(typed.match(/__reactPreviewTypedServerQuery\(prisma\.event/g)).toHaveLength(2);
    expect(read.mock.calls.map(([request]) => request.occurrence)).toEqual([0, 1, 2]);
  });

  /** The guard is opt-in; ordinary hook questions may still read a local declared return value. */
  it('constrains only callers that require import proof', async () => {
    const fixture = await createFixture(
      [
        "import { prisma } from './db';",
        `export function local() { const prisma = ${LOCAL}; return ${CALL}; }`,
      ].join('\n'),
    );
    const request = {
      callText: CALL,
      occurrence: 0,
      requiredPaths: [],
      sourcePath: fixture.sourcePath,
    };
    expect(fixture.oracle.readTypedCallValue(request)?.value).toMatchObject({
      $previewTyped: 'promise',
      value: [{ id: 'authored-local' }],
    });
    expect(
      fixture.oracle.readTypedCallValue({
        ...request,
        receiverImport: { localName: 'prisma', moduleSpecifier: './db' },
      }),
    ).toBeUndefined();
    expect(fixture.typed()).toBe(fixture.source);
  });

  /** A different alias/module or a type-only declaration cannot prove a runtime receiver. */
  it.each([
    ["import { prisma } from './db';", 'other', './db'],
    ["import { prisma } from './db';", 'prisma', './other'],
    ["import type { prisma } from './db';", 'prisma', './db'],
    ["import { type prisma } from './db';", 'prisma', './db'],
  ])(
    'rejects mismatched or type-only proof: %s %s %s',
    async (importText, localName, moduleSpecifier) => {
      const fixture = await createFixture(`${importText}\nexport const rows = () => ${CALL};`);
      expect(
        fixture.oracle.readTypedCallValue({
          callText: CALL,
          occurrence: 0,
          receiverImport: { localName, moduleSpecifier },
          requiredPaths: [],
          sourcePath: fixture.sourcePath,
        }),
      ).toBeUndefined();
    },
  );

  /** Runtime evaluation verifies the local result and evaluation count, not just emitted syntax. */
  it('keeps local results while settling nested contract calls once each', async () => {
    const fixture = await createFixture(
      [
        "import { prisma } from './db';",
        `export function local() { const prisma = ${LOCAL}; return ${CALL}; }`,
        'export const nested = () => prisma.$transaction([prisma.event.findMany()]);',
      ].join('\n'),
    );
    const executable = fixture
      .typed()
      .replace(
        "import { prisma } from './db';",
        [
          'let queryCount = 0;',
          'const prisma = { event: { findMany: () => { queryCount++; return Promise.resolve([]); } },',
          '  $transaction: (queries) => { queryCount++; return Promise.all(queries); } };',
          'export const readCount = () => queryCount;',
        ].join('\n'),
      );
    const output = await transform(executable, { loader: 'ts', format: 'esm' });
    const loaded = (await import(
      `data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`
    )) as {
      readonly local: () => Promise<unknown>;
      readonly nested: () => Promise<unknown>;
      readonly readCount: () => number;
    };
    expect(await loaded.local()).toEqual([{ id: 'authored-local' }]);
    expect(await loaded.nested()).toEqual([[{ id: 'contract-row' }]]);
    expect(loaded.readCount()).toBe(2);
  });

  /** Unresolved candidates do not consume the cap; successful candidates retain source order. */
  it('bounds successful wrappers while leaving the remaining authored calls intact', async () => {
    const fixture = await createFixture(
      [
        "import { prisma } from './db';",
        `export function local(prisma: any) { return ${CALL}; }`,
        `export const rows = [${Array.from({ length: 80 }, () => CALL).join(',')}];`,
      ].join('\n'),
    );
    const read = vi.spyOn(fixture.oracle, 'readTypedCallValue');
    const typed = fixture.typed();
    expect(typed.match(/__reactPreviewTypedServerQuery\(prisma\.event/g)).toHaveLength(64);
    expect(read.mock.calls.map(([request]) => request.occurrence)).toEqual(
      Array.from({ length: 65 }, (_, index) => index),
    );
    expect(typed).toContain(`${Array.from({ length: 16 }, () => CALL).join(',')}];`);
    const output = await transform(typed, { loader: 'ts', format: 'esm' });
    expect(output.warnings).toEqual([]);
  });

  /** An unavailable type program keeps the original source; lexical proof never becomes a guess. */
  it('keeps authored source when the oracle cannot answer', async () => {
    const fixture = await createFixture(
      `import { prisma } from './db';\nexport const rows = () => ${CALL};`,
    );
    vi.spyOn(fixture.oracle, 'readTypedCallValue').mockReturnValue(undefined);
    expect(fixture.typed()).toBe(fixture.source);
  });
});

/** Builds a small real program; only test-owned files are written and every view is released. */
async function createFixture(source: string): Promise<{
  readonly oracle: PreviewTypeOracleView;
  readonly source: string;
  readonly sourcePath: string;
  readonly typed: () => string;
}> {
  const root = await mkdtemp(path.join(ROOT, 'test/fixtures/query-binding-'));
  roots.push(root);
  const sourcePath = path.join(root, 'repository.ts');
  const dbPath = path.join(root, 'db.ts');
  await Promise.all([
    writeFile(sourcePath, source),
    writeFile(dbPath, CLIENT),
    writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
      }),
    ),
  ]);
  const oracle = new PreviewTypeOracle().createView({
    managedNodeModulesPaths: [],
    readSnapshot: () => undefined,
    rootPaths: [sourcePath],
  });
  views.push(oracle);
  return {
    oracle,
    source,
    sourcePath,
    typed: () =>
      typePreviewServerQueries(sourcePath, source, {
        contractSourcePaths: new Set([dbPath]),
        oracle,
        resolveModule: () => dbPath,
      }),
  };
}
