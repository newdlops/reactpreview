/**
 * Verifies typed server queries: a thenable query type settles like a promise of its result, and
 * query calls rooted at a render-only contract import settle to the call site's declared payload,
 * so spreading or reading selected relations keeps fields; nullable free-form JSON reads as null,
 * required free-form JSON keeps the neutral value, string columns take the schema default of the
 * queried model, and other calls stay untouched.
 */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewDependencyResolutionHintPlugin } from '../../../src/adapters/esbuild/previewDependencyResolutionHintPlugin';
import { typePreviewServerQueries } from '../../../src/adapters/esbuild/staticResources/previewServerQueryTyping';
import {
  createPreviewBuildTypeOracleView,
  PreviewTypeOracle,
} from '../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoots: string[] = [];

/**
 * A thenable query type like Prisma's `PrismaPromise`, and a client typed with it. Results pass
 * through a mapped type, as generated clients' `DefaultSelection` does.
 */
const CLIENT_TYPES = [
  'export interface Query<T> {',
  '  then<R>(onFulfilled?: (value: T) => R): Promise<R>;',
  '  catch<R>(onRejected?: (reason: unknown) => R): Promise<T | R>;',
  '}',
  'export type JsonValue = string | number | boolean | { [key: string]: JsonValue } | JsonValue[] | null;',
  'export interface Event {',
  '  id: string;',
  '  title: string;',
  '  status: string;',
  '  reviewers: { id: string }[];',
  '  config: JsonValue | null;',
  '  notes: any | null;',
  '  payload: JsonValue;',
  '}',
  'export type Row<T> = { [K in keyof T]: T[K] };',
  'export interface Client {',
  '  event: { findUnique(args: unknown): Query<Row<Event> | null>; findMany(args?: unknown): Query<Event[]> };',
  '}',
].join('\n');

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('typed server queries', () => {
  /** Contract queries settle to declared payloads; local helpers keep their own calls. */
  it('settles contract queries to their declared payloads', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/server-query-typing-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'src');
    const dbPath = path.join(source, 'db.ts');
    const repositoryPath = path.join(source, 'repository.ts');
    const repositoryText = [
      "import { prisma } from './db';",
      "import { local } from './local';",
      'export function findEvent(slug: string) {',
      '  return prisma.event',
      '    .findUnique({ where: { slug }, select: { id: true, title: true, reviewers: true } })',
      '    .then((event) => (event ? { ...event, reviewer: event.reviewers[0] } : null));',
      '}',
      'export const countLocal = () => local.count();',
    ].join('\n');
    await mkdir(source, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
        }),
      ),
      writeFile(path.join(source, 'client.ts'), CLIENT_TYPES),
      writeFile(
        dbPath,
        [
          'import "server-only";',
          "import type { Client } from './client';",
          'import { createClient } from "missing-db";',
          'export const prisma: Client = createClient();',
        ].join('\n'),
      ),
      writeFile(path.join(source, 'local.ts'), 'export const local = { count: () => 7 };'),
      writeFile(repositoryPath, repositoryText),
    ]);
    const oracle = createPreviewBuildTypeOracleView(new PreviewTypeOracle(), {
      managedNodeModulesPaths: [],
      plan: undefined,
      request: { documentPath: repositoryPath },
      snapshotSourceByPath: new Map(),
    });
    const typedText = typePreviewServerQueries(repositoryPath, repositoryText, {
      contractSourcePaths: new Set([dbPath]),
      oracle,
      prismaColumnDefaults: {
        models: new Map([
          ['Event', { defaults: new Map([['status', 'draft']]), relations: new Map() }],
        ]),
      },
      resolveModule: (specifier, importerPath) =>
        path.resolve(path.dirname(importerPath), `${specifier}.ts`),
    });

    expect(typedText).toContain('__reactPreviewTypedServerQuery(prisma.event');
    expect(typedText).toContain('local.count()');
    expect(typedText).not.toContain('__reactPreviewTypedServerQuery(local');

    await writeFile(repositoryPath, typedText);
    const result = await build({
      absWorkingDir: root,
      bundle: true,
      entryPoints: [repositoryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [dbPath],
          workspaceRoot: root,
        }),
      ],
      write: false,
    });
    const outputText = result.outputFiles[0]?.text;
    if (outputText === undefined) throw new Error('The repository did not emit JavaScript.');
    const executed = (await import(
      `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    )) as {
      readonly countLocal: () => number;
      readonly findEvent: (slug: string) => Promise<Readonly<Record<string, unknown>>>;
    };

    const { config, notes, payload, ...fields } = await executed.findEvent('demo');
    expect(fields).toEqual({
      id: 'preview-id',
      reviewer: { id: 'preview-id' },
      reviewers: [{ id: 'preview-id' }],
      status: 'draft',
      title: 'Title',
    });
    expect([config, notes]).toEqual([null, null]);
    expect(typeof payload).toBe('function');
    expect(JSON.stringify(payload)).toBe('{}');
    expect(executed.countLocal()).toBe(7);
  });

  /** A build without contract imports leaves the module text as it is. */
  it('leaves modules without contract imports unchanged', () => {
    const text = "import { db } from './db';\nexport const rows = () => db.event.findMany();\n";
    const oracle = createPreviewBuildTypeOracleView(new PreviewTypeOracle(), {
      managedNodeModulesPaths: [],
      plan: undefined,
      request: { documentPath: '/w/src/repository.ts' },
      snapshotSourceByPath: new Map([[path.normalize('/w/src/repository.ts'), text]]),
    });

    expect(
      typePreviewServerQueries('/w/src/repository.ts', text, {
        contractSourcePaths: new Set(['/w/src/other.ts']),
        oracle,
        resolveModule: () => '/w/src/db.ts',
      }),
    ).toBe(text);
  });
});
