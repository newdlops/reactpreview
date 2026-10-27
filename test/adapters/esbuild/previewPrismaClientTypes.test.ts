/**
 * Verifies Prisma schema types for projects whose client was never generated: the schema parser,
 * the one-level relation declaration, discovery rules, and typed server values through the oracle.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewPrismaClientTypes } from '../../../src/adapters/esbuild/previewPrismaClientTypes';
import {
  createPreviewPrismaClientDeclaration,
  parsePreviewPrismaSchema,
} from '../../../src/adapters/esbuild/typeOracle/previewPrismaSchemaDeclaration';
import {
  createPreviewBuildTypeOracleView,
  PreviewTypeOracle,
} from '../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoots: string[] = [];

/** Two models with a required relation, a list relation, and an enum declared out of order. */
const SCHEMA = [
  '// Comments may hold { braces } and "quotes".',
  'generator client {',
  '  provider = "prisma-client-js"',
  '}',
  'datasource db {',
  '  provider = "postgresql"',
  '}',
  'enum MembershipRole {',
  '  OWNER // billing',
  '  ADMIN',
  '  MEMBER @map("member")',
  '}',
  'model Organization {',
  '  id                  String       @id @default(cuid())',
  '  name                String',
  '  settings            Json         @default("{}")',
  '  seats               BigInt',
  '  deletionScheduledAt DateTime?',
  '  memberships         Membership[]',
  '  @@map("organizations")',
  '}',
  'model Membership {',
  '  id             String         @id',
  '  role           MembershipRole',
  '  organizationId String',
  '  organization   Organization   @relation(fields: [organizationId], references: [id])',
  '}',
].join('\n');

/** Source text that imports the default Prisma client. */
const SCHEMA_IMPORT = "import { PrismaClient } from '@prisma/client';";

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('Prisma schema types', () => {
  /** Relations carry the related model's scalars only; list relations add `_count`. */
  it('declares models, enums, and one-level relations', () => {
    const schema = parsePreviewPrismaSchema(SCHEMA);
    const declaration = createPreviewPrismaClientDeclaration(schema);

    expect(schema.generators).toEqual([{ provider: 'prisma-client-js' }]);
    expect(schema.enums.get('MembershipRole')).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
    expect(declaration).toContain(
      "type PreviewEnum_MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER';",
    );
    expect(declaration).toContain(
      'export type Organization = { id: string; name: string; settings: any; seats: number; deletionScheduledAt: Date | null; memberships: PreviewScalars_Membership[]; _count: { memberships: number; }; };',
    );
    expect(declaration).toContain(
      'type PreviewScalars_Organization = { id: string; name: string; settings: any; seats: number; deletionScheduledAt: Date | null; };',
    );
    expect(declaration).toContain('  membership: PreviewPrismaDelegate<Membership>;');
  });

  /** A server function over an ungenerated client gets enum literals and nullable timestamps. */
  it('types server values through the schema when the client was never generated', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/prisma-schema-types-'));
    temporaryRoots.push(root);
    const tenantPath = path.join(root, 'src', 'tenant.ts');
    await mkdir(path.dirname(tenantPath), { recursive: true });
    await mkdir(path.join(root, 'prisma'), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, 'package.json'), '{"name":"fixture","private":true}'),
      writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
        }),
      ),
      writeFile(path.join(root, 'prisma', 'schema.prisma'), SCHEMA),
      writeFile(
        tenantPath,
        [
          "import { PrismaClient } from '@prisma/client';",
          'const prisma = new PrismaClient();',
          'export async function requireMember() {',
          '  const membership = await prisma.membership.findFirstOrThrow({ include: { organization: true } });',
          '  return { organization: membership.organization, role: membership.role };',
          '}',
        ].join('\n'),
      ),
    ]);
    const virtualModule = await collectPreviewPrismaClientTypes({
      frontierSourcePaths: [tenantPath],
      projectRoot: root,
      readSource: (sourcePath) => Promise.resolve(sourcePath === tenantPath ? SCHEMA_IMPORT : ''),
      workspaceRoot: root,
    });
    const view = createPreviewBuildTypeOracleView(new PreviewTypeOracle(), {
      managedNodeModulesPaths: [],
      plan: undefined,
      request: { documentPath: tenantPath },
      snapshotSourceByPath: new Map(),
      ...(virtualModule === undefined ? {} : { virtualModules: [virtualModule] }),
    });

    expect(virtualModule?.specifier).toBe('@prisma/client');
    expect(
      view.readTypedExportValue({
        exportName: 'requireMember',
        requiredPaths: [],
        sourcePath: tenantPath,
      })?.value,
    ).toEqual({
      $previewTyped: 'function',
      returns: {
        $previewTyped: 'promise',
        value: {
          organization: {
            deletionScheduledAt: null,
            id: 'preview-id',
            name: 'Name',
            seats: 1,
            settings: { $previewTyped: 'unknown' },
          },
          role: 'OWNER',
        },
      },
    });
  });

  /** A build without the import, a generated client, or a custom output gets no declaration. */
  it('serves the declaration only for an imported, ungenerated default client', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/prisma-schema-skip-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'src', 'db.ts');
    await mkdir(path.join(root, 'prisma'), { recursive: true });
    await writeFile(path.join(root, 'prisma', 'schema.prisma'), SCHEMA);
    const collect = (sourceText: string): ReturnType<typeof collectPreviewPrismaClientTypes> =>
      collectPreviewPrismaClientTypes({
        frontierSourcePaths: [sourcePath],
        projectRoot: root,
        readSource: () => Promise.resolve(sourceText),
        workspaceRoot: root,
      });

    expect(await collect("import { useState } from 'react';")).toBeUndefined();
    expect(await collect(SCHEMA_IMPORT)).toBeDefined();
    await writeFile(
      path.join(root, 'prisma', 'schema.prisma'),
      SCHEMA.replace(
        'provider = "prisma-client-js"',
        'provider = "prisma-client-js"\n  output = "../src/generated"',
      ),
    );
    expect(await collect(SCHEMA_IMPORT)).toBeUndefined();
    await writeFile(path.join(root, 'prisma', 'schema.prisma'), SCHEMA);
    await mkdir(path.join(root, 'node_modules', '.prisma', 'client'), { recursive: true });
    await writeFile(
      path.join(root, 'node_modules', '.prisma', 'client', 'index.d.ts'),
      'export {};',
    );
    expect(await collect(SCHEMA_IMPORT)).toBeUndefined();
  });
});
