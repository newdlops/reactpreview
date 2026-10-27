/**
 * Verifies the signed-in sample session for next-auth: the project's augmented `Session` type is
 * read through the type oracle, the most privileged declared role is chosen, and only builds that
 * import next-auth scan for augmentation files.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewNextAuthAugmentationPaths,
  createPreviewNextAuthSessionExpression,
  PREVIEW_NEXT_AUTH_SESSION_PATHS,
} from '../../../src/adapters/esbuild/previewNextAuthSession';
import { createPreviewSampleDateApiExpression } from '../../../src/adapters/esbuild/previewSampleDateRuntimeSource';
import {
  PreviewTypeOracle,
  type PreviewTypedCallValue,
} from '../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIB = 1024 * 1024;
const ROOMY_HEAP = Object.freeze({ heap_size_limit: 4096 * MIB, used_heap_size: 64 * MIB });

/**
 * Evaluates one session expression on a fixed sample day.
 *
 * @param expression Output of `createPreviewNextAuthSessionExpression`.
 * @returns Plain JSON copy of the session.
 */
function evaluateSession(expression: string): unknown {
  const context = createContext({});
  runInContext(
    `${createPreviewSampleDateApiExpression()}.baseOverride = new Date(2027, 2, 6, 12);`,
    context,
  );
  return JSON.parse(JSON.stringify(runInContext(`(${expression})`, context))) as unknown;
}

describe('next-auth sample session', () => {
  /** An augmentation file adds `role`; the sample user takes the most privileged declared role. */
  it('reads the augmented Session type and picks the most privileged role', async () => {
    const fixture = await createSessionFixture();
    try {
      const read = (augmentationPaths: readonly string[]): PreviewTypedCallValue | undefined =>
        new PreviewTypeOracle(undefined, () => ROOMY_HEAP)
          .createView({
            managedNodeModulesPaths: [],
            readSnapshot: () => undefined,
            rootPaths: [fixture.authPath, ...augmentationPaths],
          })
          .readTypedModuleTypeValue({
            moduleSpecifier: 'next-auth',
            requiredPaths: PREVIEW_NEXT_AUTH_SESSION_PATHS,
            sourcePath: fixture.authPath,
            typeName: 'Session',
          });

      const plain = read([]);
      const augmented = read([fixture.augmentationPath]);

      expect(plain?.value).not.toHaveProperty('user.role');
      expect(augmented?.literals['user.role']).toEqual(
        expect.arrayContaining(['ADMIN', 'SUPER_ADMIN', 'USER']),
      );
      expect(evaluateSession(createPreviewNextAuthSessionExpression(augmented))).toEqual({
        expires: expect.stringMatching(/^2027-03-06T/u) as unknown,
        user: {
          email: 'preview@example.invalid',
          id: 'preview-id',
          image: null,
          name: 'Name',
          role: 'SUPER_ADMIN',
        },
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Role lists change every item; declared roles without a privileged name stay as synthesized. */
  it('replaces role lists and keeps unprivileged role sets', () => {
    const typed = (
      value: PreviewTypedCallValue['value'],
      roles: readonly string[],
    ): PreviewTypedCallValue => ({
      literals: { 'user.roles[]': roles },
      nodes: 1,
      typeText: 'Session',
      value,
    });
    const session = { expires: 'Expires', user: { roles: ['member', 'member'] } };

    expect(
      evaluateSession(createPreviewNextAuthSessionExpression(typed(session, ['member', 'owner']))),
    ).toMatchObject({ user: { roles: ['owner', 'owner'] } });
    expect(
      evaluateSession(createPreviewNextAuthSessionExpression(typed(session, ['member', 'guest']))),
    ).toMatchObject({ user: { roles: ['member', 'member'] } });
  });

  /** Without a declared type the standard next-auth user fields are used. */
  it('falls back to the standard session shape', () => {
    expect(evaluateSession(createPreviewNextAuthSessionExpression(undefined))).toEqual({
      expires: expect.stringMatching(/^2027-03-06T/u) as unknown,
      user: { email: 'preview@example.invalid', id: 'preview-id', image: null, name: 'Name' },
    });
  });

  /** Only builds importing next-auth read the inventory, and only augmenting `.d.ts` files count. */
  it('scans declaration files only when the build imports next-auth', async () => {
    const sources = new Map<string, string>([
      ['/w/src/auth.ts', "import NextAuth from 'next-auth';"],
      ['/w/src/page.tsx', "import { auth } from './auth';"],
      ['/w/src/types/next-auth.d.ts', "declare module 'next-auth' { interface Session {} }"],
      ['/w/src/types/env.d.ts', 'declare const VERSION: string;'],
      ['/w/src/types/session.ts', "declare module 'next-auth' { interface Session {} }"],
    ]);
    let inventoryReads = 0;
    const collect = (frontierSourcePaths: readonly string[]): Promise<readonly string[]> =>
      collectPreviewNextAuthAugmentationPaths({
        frontierSourcePaths,
        readInventory: () => {
          inventoryReads += 1;
          return Promise.resolve([...sources.keys()]);
        },
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      });

    expect(await collect(['/w/src/page.tsx'])).toEqual([]);
    expect(inventoryReads).toBe(0);
    expect(await collect(['/w/src/page.tsx', '/w/src/auth.ts'])).toEqual([
      '/w/src/types/next-auth.d.ts',
    ]);
  });
});

/** Writes a next-auth typing, an augmentation file, and a module that calls `NextAuth`. */
async function createSessionFixture(): Promise<{
  readonly augmentationPath: string;
  readonly authPath: string;
  readonly root: string;
}> {
  const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/next-auth-session-'));
  const source = path.join(root, 'src');
  const packageDirectory = path.join(root, 'node_modules', 'next-auth');
  await mkdir(path.join(source, 'types'), { recursive: true });
  await mkdir(packageDirectory, { recursive: true });
  const augmentationPath = path.join(source, 'types', 'next-auth.d.ts');
  const authPath = path.join(source, 'auth.ts');
  await Promise.all([
    writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
      }),
    ),
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'next-auth', types: 'index.d.ts' }),
    ),
    writeFile(
      path.join(packageDirectory, 'index.d.ts'),
      [
        'export interface DefaultSession {',
        '  user?: { name?: string | null; email?: string | null; image?: string | null };',
        '  expires: string;',
        '}',
        'export interface Session extends DefaultSession {}',
        'export default function NextAuth(config: unknown): { auth(): Promise<Session | null> };',
      ].join('\n'),
    ),
    writeFile(
      path.join(source, 'roles.ts'),
      [
        "export const Role = { USER: 'USER', ADMIN: 'ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' } as const;",
        'export type Role = (typeof Role)[keyof typeof Role];',
      ].join('\n'),
    ),
    writeFile(
      augmentationPath,
      [
        "import type { DefaultSession } from 'next-auth';",
        "import type { Role } from '../roles';",
        "declare module 'next-auth' {",
        "  interface Session { user: { id: string; role: Role } & DefaultSession['user'] }",
        '}',
      ].join('\n'),
    ),
    writeFile(
      authPath,
      ["import NextAuth from 'next-auth';", 'export const { auth } = NextAuth({});'].join('\n'),
    ),
  ]);
  return { augmentationPath, authPath, root };
}
