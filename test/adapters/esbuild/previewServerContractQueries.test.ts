/**
 * Verifies that Prisma query methods on a neutral server contract behave like `PrismaPromise`:
 * `.then`, `.catch`, and `await` settle to the neutral value, while other reads stay plain.
 */
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewDependencyResolutionHintPlugin } from '../../../src/adapters/esbuild/previewDependencyResolutionHintPlugin';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('neutral contract query methods', () => {
  /** Promise chains on query results run; property reads and other calls stay neutral values. */
  it('returns promises from Prisma query methods only', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-contract-query-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    await Promise.all([
      writeFile(
        entryPath,
        [
          'import { prisma } from "./server";',
          'export async function readContract() {',
          '  const event = await prisma.irEvent',
          '    .findUnique({ where: { id: "1" } })',
          '    .then((found) => (found ? "found" : "none"));',
          '  const groups = await prisma.announcement.groupBy({ by: ["status"] }).then((rows) => typeof rows);',
          '  const caught = await prisma.user.count().catch(() => "failed");',
          '  const transaction = await prisma.$transaction([]);',
          '  return {',
          '    caught: typeof caught,',
          '    event,',
          '    groups,',
          '    promise: prisma.user.findFirst() instanceof Promise,',
          '    property: typeof prisma.user.profile,',
          '    other: prisma.user.summarize() instanceof Promise,',
          '    transaction: typeof transaction,',
          '  };',
          '}',
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; import { PrismaClient } from "missing-prisma"; export const prisma = new PrismaClient();',
        'utf8',
      ),
    ]);

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [serverPath],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    const outputText = result.outputFiles[0]?.text;
    if (outputText === undefined) throw new Error('The contract did not emit JavaScript.');
    const executed = (await import(
      `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    )) as { readonly readContract: () => Promise<unknown> };
    await expect(executed.readContract()).resolves.toEqual({
      caught: 'function',
      event: 'found',
      groups: 'function',
      other: false,
      promise: true,
      property: 'function',
      transaction: 'function',
    });
  });
});
