/**
 * Verifies the next-auth bridge at runtime: a project-owned zero-argument `auth()` reports the
 * sample session without the real lookup, while other call forms, other exports, package-internal
 * importers, and login routes keep the installed package.
 */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewNextAuthSessionExpression } from '../../../src/adapters/esbuild/previewNextAuthSession';
import { createPreviewNextAuthSessionPlugin } from '../../../src/adapters/esbuild/previewNextAuthSessionPlugin';
import { createPreviewSampleDateApiExpression } from '../../../src/adapters/esbuild/previewSampleDateRuntimeSource';

/** Fake next-auth v5 surface whose zero-argument `auth()` delegates to the config. */
const FAKE_NEXT_AUTH_SOURCE = [
  'export class AuthError extends Error {}',
  'export default function NextAuth(config) {',
  '  return {',
  '    auth: (...args) => (args.length === 0 ? config.readSession() : `handled:${args.length}`),',
  '    handlers: { GET() {}, POST() {} },',
  "    signIn: () => 'signIn',",
  "    signOut: () => 'signOut',",
  '  };',
  '}',
].join('\n');

/** Project module exercising every call form, plus a package importing next-auth itself. */
const ENTRY_SOURCE = [
  "import NextAuth, { AuthError } from 'next-auth';",
  "import { packageAuth } from 'auth-helper';",
  'let realCalls = 0;',
  'const read = () => {',
  '  realCalls += 1;',
  '  return Promise.resolve(null);',
  '};',
  'const { auth, signIn } = NextAuth({ readSession: read });',
  '(async () => {',
  '  const result = {};',
  '  result.signedIn = await auth();',
  '  result.realCallsOutsideLogin = realCalls;',
  '  result.packageInternal = await packageAuth();',
  '  result.handler = auth(() => {});',
  "  result.named = typeof AuthError === 'function' && signIn() === 'signIn';",
  "  const routeKey = Symbol.for('newdlops.react-file-preview.next-app-route');",
  "  globalThis[routeKey] = { pathname: '/admin/login' };",
  '  result.loginRoute = await auth();',
  '  result.realCallsOnLogin = realCalls;',
  "  globalThis[routeKey] = { pathname: '/admin/logins-report' };",
  '  result.otherRoute = await auth();',
  '  globalThis.__result = result;',
  '})();',
].join('\n');

/**
 * Bundles the entry with the bridge and runs it until it records its result.
 *
 * @returns The `__result` object recorded by the entry.
 */
async function runSessionFixture(): Promise<Record<string, unknown>> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-next-auth-'));
  try {
    const nextAuthDirectory = path.join(projectRoot, 'node_modules', 'next-auth');
    const helperDirectory = path.join(projectRoot, 'node_modules', 'auth-helper');
    const entryPath = path.join(projectRoot, 'src', 'auth.js');
    await mkdir(nextAuthDirectory, { recursive: true });
    await mkdir(helperDirectory, { recursive: true });
    await mkdir(path.dirname(entryPath), { recursive: true });
    const packageJson = (name: string): string =>
      JSON.stringify({ exports: './index.js', module: './index.js', name, type: 'module' });
    await Promise.all([
      writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture","private":true}'),
      writeFile(entryPath, ENTRY_SOURCE),
      writeFile(path.join(nextAuthDirectory, 'package.json'), packageJson('next-auth')),
      writeFile(path.join(nextAuthDirectory, 'index.js'), FAKE_NEXT_AUTH_SOURCE),
      writeFile(path.join(helperDirectory, 'package.json'), packageJson('auth-helper')),
      writeFile(
        path.join(helperDirectory, 'index.js'),
        [
          "import NextAuth from 'next-auth';",
          'export const { auth: packageAuth } = NextAuth({ readSession: () => Promise.resolve(null) });',
        ].join('\n'),
      ),
    ]);
    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'iife',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewNextAuthSessionPlugin({
          readSessionExpression: () => createPreviewNextAuthSessionExpression(undefined),
        }),
      ],
      target: 'es2022',
      write: false,
    });
    const sandbox: Record<string, unknown> = { clearTimeout, console, setTimeout };
    sandbox.globalThis = sandbox;
    const context = createContext(sandbox);
    runInContext(
      `${createPreviewSampleDateApiExpression()}.baseOverride = new Date(2027, 2, 6, 12);`,
      context,
    );
    runInContext(result.outputFiles[0]?.text ?? '', context);
    for (let waited = 0; sandbox.__result === undefined && waited < 5_000; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return JSON.parse(JSON.stringify(sandbox.__result ?? null)) as Record<string, unknown>;
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

describe('next-auth session bridge', () => {
  /** Only the zero-argument session read outside login routes changes. */
  it('signs in a zero-argument auth() and keeps every other behavior', async () => {
    const sample = {
      expires: expect.stringMatching(/^2027-03-06T/u) as unknown,
      user: { email: 'preview@example.invalid', id: 'preview-id', image: null, name: 'Name' },
    };

    const result = await runSessionFixture();

    expect(result).toEqual({
      handler: 'handled:1',
      loginRoute: null,
      named: true,
      otherRoute: sample,
      packageInternal: null,
      realCallsOnLogin: 1,
      realCallsOutsideLogin: 0,
      signedIn: sample,
    });
  });
});
