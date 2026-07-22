/**
 * Verifies that dotenv discovery supplies useful browser values without leaking server secrets.
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPreviewImportMetaEnvironment,
  createPreviewPublicEnvironmentCandidatePaths,
  MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS,
  parsePublicEnvironmentSource,
  resolvePreviewPublicEnvironment,
} from '../../../src/adapters/esbuild/previewPublicEnvironment';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('preview public environment', () => {
  /** Keeps public toolchain prefixes, dotenv quoting, and literal non-expanded references. */
  it('parses only browser-public assignments without expanding secret references', () => {
    expect(
      Object.fromEntries(
        parsePublicEnvironmentSource(
          [
            'DATABASE_URL=https://secret.example/database',
            'NEXT_PUBLIC_API_URL=https://public.example/api#fragment',
            'NEXT_PUBLIC_QUOTED_URL="http://localhost:3000" # local browser origin',
            'VITE_LABEL="line\\nlabel" # readable public label',
            "REACT_APP_LITERAL='$SERVER_SECRET'",
            'export PUBLIC_MODE=demo # public comment',
            'INTERNAL_TOKEN=secret',
          ].join('\n'),
        ),
      ),
    ).toEqual({
      NEXT_PUBLIC_API_URL: 'https://public.example/api#fragment',
      NEXT_PUBLIC_QUOTED_URL: 'http://localhost:3000',
      PUBLIC_MODE: 'demo',
      REACT_APP_LITERAL: '$SERVER_SECRET',
      VITE_LABEL: 'line\nlabel',
    });
  });

  /** Exposes Vite-prefixed values while keeping preview execution flags authoritative. */
  it('creates a Vite-compatible import.meta environment without unrelated public prefixes', () => {
    expect(
      createPreviewImportMetaEnvironment({
        MODE: 'production',
        NEXT_PUBLIC_APP_URL: 'https://next.example/',
        VITE_API_URL: 'https://vite.example/api',
        VITE_LABEL: 'Preview',
      }),
    ).toEqual({
      BASE_URL: '/',
      DEV: true,
      MODE: 'development',
      PROD: false,
      SSR: false,
      VITE_API_URL: 'https://vite.example/api',
      VITE_LABEL: 'Preview',
    });
  });

  /** Applies real development files over `.env.example` and never returns private neighbors. */
  it('merges fixed project-root files in deterministic development precedence', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    await Promise.all([
      writeFile(
        path.join(projectRoot, '.env.example'),
        'NEXT_PUBLIC_APP_URL=https://example.invalid/\nPUBLIC_COLOR=gray\nSECRET=example-secret',
      ),
      writeFile(
        path.join(projectRoot, '.env'),
        'NEXT_PUBLIC_APP_URL=https://base.example/\nVITE_STAGE=base\nAPI_TOKEN=base-secret',
      ),
      writeFile(
        path.join(projectRoot, '.env.development'),
        [
          'VITE_STAGE=development',
          'VITE_CONFLICT=development',
          'NEXT_PUBLIC_CONFLICT=development',
          'REACT_APP_CONFLICT=development',
          'PUBLIC_CONFLICT=development',
        ].join('\n'),
      ),
      writeFile(
        path.join(projectRoot, '.env.local'),
        [
          'PUBLIC_COLOR=blue',
          'VITE_CONFLICT=local',
          'NEXT_PUBLIC_CONFLICT=local',
          'REACT_APP_CONFLICT=local',
          'PUBLIC_CONFLICT=local',
        ].join('\n'),
      ),
      writeFile(
        path.join(projectRoot, '.env.development.local'),
        'NEXT_PUBLIC_APP_URL=https://local.example/',
      ),
    ]);

    const environment = await resolvePreviewPublicEnvironment(
      await realpath(projectRoot),
      await realpath(workspaceRoot),
    );

    expect(environment).toEqual({
      NEXT_PUBLIC_APP_URL: 'https://local.example/',
      NEXT_PUBLIC_CONFLICT: 'local',
      PUBLIC_COLOR: 'blue',
      PUBLIC_CONFLICT: 'local',
      REACT_APP_CONFLICT: 'local',
      VITE_CONFLICT: 'development',
      VITE_STAGE: 'development',
    });
    expect(environment).not.toHaveProperty('SECRET');
    expect(environment).not.toHaveProperty('API_TOKEN');
    expect(Object.isFrozen(environment)).toBe(true);
  });

  /** Enforces the unique-key budget across all files instead of resetting it per parser call. */
  it('rejects a merged public environment that exceeds the global key limit', async () => {
    const { projectRoot, workspaceRoot } = await createWorkspaceProject();
    const firstKeyCount = Math.floor(MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS / 2);
    const createAssignments = (start: number, count: number): string =>
      Array.from(
        { length: count },
        (_value, index) => `VITE_MERGED_${(start + index).toString()}=value`,
      ).join('\n');
    await Promise.all([
      writeFile(path.join(projectRoot, '.env'), createAssignments(0, firstKeyCount)),
      writeFile(
        path.join(projectRoot, '.env.local'),
        createAssignments(firstKeyCount, MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS - firstKeyCount + 1),
      ),
    ]);

    await expect(
      resolvePreviewPublicEnvironment(await realpath(projectRoot), await realpath(workspaceRoot)),
    ).rejects.toThrow('merged key safety limit');
  });

  /** Skips an optional dotenv symlink whose canonical target leaves the trusted workspace. */
  it('does not read public values through an external symlink', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const projectRoot = path.join(workspaceRoot, 'project');
    const outsideEnvironmentPath = path.join(temporaryRoot, 'outside.env');
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      writeFile(outsideEnvironmentPath, 'NEXT_PUBLIC_LEAK=external'),
    ]);
    await symlink(outsideEnvironmentPath, path.join(projectRoot, '.env'), 'file');

    await expect(
      resolvePreviewPublicEnvironment(projectRoot, await realpath(workspaceRoot)),
    ).resolves.toEqual({});
  });

  /** Exposes exact future paths in stable order so runtime watchers can invalidate the build. */
  it('creates a bounded deterministic candidate inventory', () => {
    expect(createPreviewPublicEnvironmentCandidatePaths('/workspace/client')).toEqual([
      path.normalize('/workspace/client/.env.example'),
      path.normalize('/workspace/client/.env'),
      path.normalize('/workspace/client/.env.development'),
      path.normalize('/workspace/client/.env.local'),
      path.normalize('/workspace/client/.env.development.local'),
    ]);
  });
});

/** Creates a workspace with one nested package root and registers it for cleanup. */
async function createWorkspaceProject(): Promise<{
  readonly projectRoot: string;
  readonly workspaceRoot: string;
}> {
  const workspaceRoot = await createTemporaryRoot();
  const projectRoot = path.join(workspaceRoot, 'packages', 'client');
  await mkdir(projectRoot, { recursive: true });
  return { projectRoot, workspaceRoot };
}

/** Creates and tracks one isolated filesystem fixture root. */
async function createTemporaryRoot(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-public-env-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}
