/**
 * Verifies sample timestamps: ending-state timestamps (`deletedAt`) are absent so tombstone and
 * deletion notices stay closed, while ordinary timestamps are dates, both in the neutral server
 * contract and in declared-type values.
 */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewDependencyResolutionHintPlugin } from '../../../src/adapters/esbuild/previewDependencyResolutionHintPlugin';
import { isPreviewOrdinaryTimestampName } from '../../../src/adapters/esbuild/previewLifecycleTimestamp';
import { PreviewTypeOracle } from '../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIB = 1024 * 1024;
const ROOMY_HEAP = Object.freeze({ heap_size_limit: 4096 * MIB, used_heap_size: 64 * MIB });
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('sample timestamps', () => {
  /** Ending states, ordinary instants, and timestamp-like method names are told apart. */
  it('classifies timestamp names', () => {
    expect(
      ['createdAt', 'start_date', 'timestamp', 'expiresAt', 'closedAt'].map(
        isPreviewOrdinaryTimestampName,
      ),
    ).toEqual([true, true, true, true, true]);
    expect(
      ['deletedAt', 'purged_at', 'deletionScheduledAt', 'getTime', 'toDate', 'status'].map(
        isPreviewOrdinaryTimestampName,
      ),
    ).toEqual([false, false, false, false, false, false]);
  });

  /** The neutral contract closes ending-state branches and formats ordinary timestamps. */
  it('reads timestamps from the neutral server contract by name', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-timestamp-contract-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    await Promise.all([
      writeFile(
        entryPath,
        [
          'import { readOrganization } from "./server";',
          'export function readContract() {',
          '  const organization = readOrganization();',
          '  return {',
          '    banner: organization.deletionScheduledAt ? "deletion banner" : "none",',
          '    created: organization.createdAt.toISOString(),',
          '    method: typeof organization.getTime,',
          '    name: organization.name,',
          '    title: String(organization.title),',
          '  };',
          '}',
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; import db from "missing-db"; export const readOrganization = () => db.organization();',
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
    )) as { readonly readContract: () => unknown };
    expect(executed.readContract()).toEqual({
      banner: 'none',
      created: '2026-01-15T09:00:00.000Z',
      method: 'function',
      name: 'Name',
      title: 'Preview value',
    });
  });

  /** A nullable ending-state timestamp is null; other timestamps keep their sample date. */
  it('leaves nullable ending-state timestamps empty in declared values', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/lifecycle-timestamp-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'src', 'ticket.ts');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
        }),
      ),
      writeFile(
        sourcePath,
        [
          'interface Ticket {',
          '  createdAt: Date | null;',
          '  purgedAt: Date | null;',
          '  deletedAt: Date;',
          '}',
          'export async function getTicket(): Promise<Ticket> { throw new Error(); }',
        ].join('\n'),
      ),
    ]);
    const value = new PreviewTypeOracle(undefined, () => ROOMY_HEAP)
      .createView({
        managedNodeModulesPaths: [],
        readSnapshot: () => undefined,
        rootPaths: [sourcePath],
      })
      .readTypedExportValue({ exportName: 'getTicket', requiredPaths: [], sourcePath })?.value;

    expect(value).toEqual({
      $previewTyped: 'function',
      returns: {
        $previewTyped: 'promise',
        value: {
          createdAt: { $previewTyped: 'date', iso: '2026-01-15T09:00:00.000Z' },
          deletedAt: { $previewTyped: 'date', iso: '2026-01-15T09:00:00.000Z' },
          purgedAt: null,
        },
      },
    });
  });
});
