/** Verifies bounded free-identifier discovery against real package and alias resolution evidence. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';
import { collectPreviewImplicitPackageGlobals } from '../../../../src/adapters/esbuild/staticResources/previewImplicitPackageGlobals';

describe('collectPreviewImplicitPackageGlobals', () => {
  /**
   * Approves an ambient build-provided `dayjs` value through its installed type entry while keeping
   * local bindings, member names, erased types, JSX host tags, and feature probes untouched.
   */
  it('collects only package-backed free runtime references and their exact spans', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-free-global-'));
    const sourcePath = path.join(workspaceRoot, 'src', 'page.tsx');
    const sourceText = [
      'declare const dayjs: any;',
      "const formatted = dayjs('2026-07-16');",
      'const utc = () => dayjs.utc();',
      'const values = { dayjs };',
      'const member = model.dayjs;',
      'const probe = typeof axios;',
      'type CalendarValue = dayjs.Dayjs;',
      'function shadow(moment: () => void) { moment(); }',
      'const intrinsic = <dayjs value="host" />;',
      'void formatted; void utc; void values; void member; void probe; void intrinsic;',
    ].join('\n');
    try {
      await Promise.all([
        mkdir(path.dirname(sourcePath), { recursive: true }),
        createFakePackage(workspaceRoot, 'axios'),
        createFakePackage(workspaceRoot, 'dayjs'),
        createFakePackage(workspaceRoot, 'moment'),
      ]);
      await writeFile(sourcePath, sourceText, 'utf8');

      const inventory = collectPreviewImplicitPackageGlobals({
        resolver: createPreviewStaticModuleResolver({ workspaceRoot }),
        sourcePath,
        sourceText,
      });

      expect(inventory).toMatchObject({ packageCandidateCount: 2, truncated: false });
      expect(inventory.globals).toHaveLength(1);
      expect(inventory.globals[0]).toMatchObject({
        globalName: 'dayjs',
        moduleSpecifier: 'dayjs',
      });
      expect(inventory.globals[0]?.resolvedPath).toMatch(
        /node_modules[/\\]dayjs[/\\]index\.d\.ts$/u,
      );
      expect(
        inventory.globals[0]?.references.map((reference) =>
          sourceText.slice(reference.start, reference.end),
        ),
      ).toEqual(['dayjs', 'dayjs', 'dayjs']);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Rejects a same-named tsconfig alias because it is project source, not an installed package. */
  it('does not reinterpret workspace aliases as package globals', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-free-alias-'));
    const sourceDirectory = path.join(workspaceRoot, 'src');
    const sourcePath = path.join(sourceDirectory, 'page.ts');
    const aliasedPath = path.join(sourceDirectory, 'service.ts');
    const sourceText = 'export const result = service();';
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(workspaceRoot, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: { baseUrl: '.', paths: { service: ['src/service.ts'] } },
          }),
          'utf8',
        ),
        writeFile(sourcePath, sourceText, 'utf8'),
        writeFile(aliasedPath, 'export const service = () => 1;', 'utf8'),
      ]);

      const inventory = collectPreviewImplicitPackageGlobals({
        resolver: createPreviewStaticModuleResolver({ workspaceRoot }),
        sourcePath,
        sourceText,
      });

      expect(inventory).toEqual({
        globals: [],
        packageCandidateCount: 1,
        truncated: false,
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Applies a stable alphabetical resolution budget and reports omitted package-shaped names. */
  it('bounds package resolution work deterministically', () => {
    const probes: string[] = [];
    const sourcePath = '/workspace/src/page.ts';
    const inventory = collectPreviewImplicitPackageGlobals({
      maximumCandidates: 2,
      resolver: {
        resolve(moduleSpecifier) {
          probes.push(moduleSpecifier);
          return `/workspace/node_modules/${moduleSpecifier}/index.d.ts`;
        },
      },
      sourcePath,
      sourceText: 'zeta(); alpha(); beta();',
    });

    expect(probes).toEqual(['alpha', 'beta']);
    expect(inventory).toMatchObject({ packageCandidateCount: 3, truncated: true });
    expect(inventory.globals.map((global) => global.globalName)).toEqual(['alpha', 'beta']);
  });

  /** Refuses a read-only package injection when the authored module also rebinds that global. */
  it('rejects direct and destructuring writes to an otherwise package-backed global', () => {
    const sourcePath = '/workspace/src/page.ts';
    const inventory = collectPreviewImplicitPackageGlobals({
      candidateNames: ['dayjs'],
      resolver: {
        resolve(moduleSpecifier) {
          return `/workspace/node_modules/${moduleSpecifier}/index.js`;
        },
      },
      sourcePath,
      sourceText: [
        'const before = dayjs();',
        '({ dayjs } = runtimeValues);',
        'dayjs.locale = "ko";',
        'void before;',
      ].join('\n'),
    });

    expect(inventory.globals).toEqual([]);
    expect(inventory.packageCandidateCount).toBe(0);
  });
});

/** Creates a type-first installed package without requiring any dependency code during discovery. */
async function createFakePackage(workspaceRoot: string, packageName: string): Promise<void> {
  const packageRoot = path.join(workspaceRoot, 'node_modules', packageName);
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ main: 'index.js', name: packageName, types: 'index.d.ts' }),
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'index.d.ts'),
      'declare const value: any; export = value;',
      'utf8',
    ),
    writeFile(path.join(packageRoot, 'index.js'), 'module.exports = function value() {};', 'utf8'),
  ]);
}
