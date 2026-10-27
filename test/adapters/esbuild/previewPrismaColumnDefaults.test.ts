/**
 * Verifies Prisma string column defaults: only literal `@default("…")` values of `String` columns
 * are read, delegates name their models, and typed rows take the defaults through relations
 * while other values stay as synthesized.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyPreviewPrismaColumnDefaults,
  collectPreviewPrismaColumnDefaults,
  findPreviewPrismaDelegateModel,
} from '../../../src/adapters/esbuild/previewPrismaColumnDefaults';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoots: string[] = [];

/** An event with a defaulted status and a reviewer relation whose role has a default. */
const SCHEMA = [
  'model IrEvent {',
  '  id        String     @id @default(cuid())',
  '  status    String     @default("draft")',
  '  title     String',
  '  note      String?    @default("say \\"hi\\"")',
  '  settings  Json       @default("{}")',
  '  tags      String[]   @default(["a"])',
  '  reviewers Reviewer[]',
  '}',
  'model Reviewer {',
  '  id      String  @id',
  '  role    String  @default("member")',
  '  eventId String',
  '  event   IrEvent @relation(fields: [eventId], references: [id])',
  '}',
].join('\n');

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('Prisma column defaults', () => {
  /** Reads string literal defaults of String columns and applies them through relations. */
  it('puts schema string defaults into typed rows by model', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/prisma-defaults-'));
    temporaryRoots.push(root);
    await mkdir(path.join(root, 'prisma'), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, 'package.json'), '{"name":"defaults"}'),
      writeFile(path.join(root, 'prisma', 'schema.prisma'), SCHEMA),
    ]);

    const columns = await collectPreviewPrismaColumnDefaults(root);
    if (columns === undefined) throw new Error('The schema defaults were not read.');
    const row = {
      $previewTyped: 'promise',
      value: null,
    };

    expect(columns.models.get('IrEvent')?.defaults).toEqual(
      new Map([
        ['status', 'draft'],
        ['note', 'say "hi"'],
      ]),
    );
    expect(findPreviewPrismaDelegateModel(columns, 'irEvent')).toBe('IrEvent');
    expect(findPreviewPrismaDelegateModel(columns, 'missing')).toBeUndefined();
    expect(
      applyPreviewPrismaColumnDefaults(
        {
          createdAt: { $previewTyped: 'date', iso: '2026-01-15T09:00:00.000Z' },
          id: 'preview-id',
          reviewers: [{ id: 'preview-id', role: 'Role' }],
          status: 'Status',
          title: 'Title',
        },
        'IrEvent',
        columns,
      ),
    ).toEqual({
      createdAt: { $previewTyped: 'date', iso: '2026-01-15T09:00:00.000Z' },
      id: 'preview-id',
      reviewers: [{ id: 'preview-id', role: 'member' }],
      status: 'draft',
      title: 'Title',
    });
    expect(applyPreviewPrismaColumnDefaults(row, 'IrEvent', columns)).toBe(row);
  });

  /** A schema without string defaults gives nothing to apply. */
  it('reports no defaults for a schema without string defaults', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/prisma-defaults-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'schema.prisma'), 'model A {\n  id String @id\n}\n');

    expect(await collectPreviewPrismaColumnDefaults(root)).toBeUndefined();
  });
});
