/** Keeps final bundle identities fresh between calls, including aliases, package locators, and overflow. */
import { mkdir, mkdtemp, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { verifyPreviewInspectorBundleFrontierMetafile } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontierMetafile';

type Options = Parameters<typeof verifyPreviewInspectorBundleFrontierMetafile>[0];

describe('bundle frontier metafile physical identities', () => {
  it('rechecks the same logical path after its symlink target changes between calls', async () => {
    const fixture = await createWorkspace();
    const linked = path.join(fixture.root, 'current');
    await symlink(path.dirname(fixture.target), linked, 'junction');
    const options = createOptions(fixture.root, [fixture.target], ['current/Target.ts']);
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).not.toThrow();
    const other = path.join(fixture.root, 'other');
    await mkdir(other);
    await writeFile(path.join(other, 'Target.ts'), 'export const target = 2;\n');
    await rename(linked, path.join(fixture.root, 'retired-current'));
    await symlink(other, linked, 'junction');
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).toThrow('outside its verified module frontier');
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile({
        ...options,
        authenticSourcePaths: [path.join(other, 'Target.ts')],
      });
    }).not.toThrow();
  });

  it('does not treat a dependency spelling as proof that its physical target is a dependency', async () => {
    const fixture = await createWorkspace();
    await writeFile(path.join(fixture.root, 'src/Unexpected.ts'), 'export const unexpected = 1;\n');
    await mkdir(path.join(fixture.root, 'node_modules'));
    await symlink(
      path.join(fixture.root, 'src'),
      path.join(fixture.root, 'node_modules/linked'),
      'junction',
    );
    const options = createOptions(
      fixture.root,
      [fixture.target],
      ['src/Target.ts', 'node_modules/linked/Unexpected.ts'],
    );
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).toThrow('outside its verified module frontier');
  });

  it('distinguishes lexical and physical workspace roots when resolving a surface input', async () => {
    const fixture = await createWorkspace();
    const alias = path.join(fixture.container, 'workspace-alias');
    await symlink(fixture.root, alias, 'junction');
    const physicalSibling = path.join(path.dirname(fixture.root), 'Outside.ts');
    const lexicalSibling = path.join(fixture.container, 'Outside.ts');
    await writeFile(physicalSibling, 'export const physical = 1;\n');
    await writeFile(lexicalSibling, 'export const lexical = 1;\n');
    const options = {
      ...createOptions(alias, [fixture.target], ['src/Target.ts', '../Outside.ts']),
      executionSurfaces: [
        { id: 'outside', sourcePath: physicalSibling, strategy: 'authored-module' },
      ],
    };
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).toThrow('outside its verified module frontier');
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile({
        ...options,
        executionSurfaces: [
          { id: 'outside', sourcePath: lexicalSibling, strategy: 'authored-module' },
        ],
      });
    }).not.toThrow();
  });

  it('requires current package identity and frozen demand for a virtual workspace package', async () => {
    const fixture = await createWorkspace();
    const packageRoot = path.join(fixture.root, 'packages/pkg');
    await mkdir(path.join(packageRoot, 'src'), { recursive: true });
    const manifest = path.join(packageRoot, 'package.json');
    await writeFile(manifest, JSON.stringify({ name: '@fixture/pkg' }));
    await writeFile(path.join(packageRoot, 'src/index.ts'), 'export const pkg = 1;\n');
    const virtual = path.join(
      fixture.root,
      '.yarn/__virtual__/fixture-locator/1/packages/pkg/src/index.ts',
    );
    const base = createOptions(fixture.root, [fixture.target], ['src/Target.ts', virtual]);
    base.metafile.inputs['src/Target.ts']?.imports.push({
      kind: 'import-statement',
      original: '@fixture/pkg',
      path: virtual,
    });
    const options = { ...base, packageDemandSourcePaths: [fixture.target] };
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).not.toThrow();
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile({ ...options, packageDemandSourcePaths: [] });
    }).toThrow('outside its verified module frontier');
    await writeFile(manifest, JSON.stringify({ name: '@fixture/changed' }));
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).toThrow('outside its verified module frontier');
  });

  it('keeps checking late inputs and execution surfaces after the reuse cache fills', async () => {
    const fixture = await createWorkspace();
    const inputs = Array.from({ length: 4200 }, (_, index) => `missing/File${String(index)}.ts`);
    const paths = inputs.map((name) => path.join(fixture.root, name));
    const lastPath = paths.at(-1) ?? fixture.target;
    const options = {
      ...createOptions(fixture.root, paths, inputs),
      executionSurfaces: [{ id: 'late', sourcePath: lastPath, strategy: 'authored-module' }],
    };
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile(options);
    }).not.toThrow();
    expect(() => {
      verifyPreviewInspectorBundleFrontierMetafile({
        ...options,
        authenticSourcePaths: paths.slice(0, -1),
      });
    }).toThrow('outside its verified module frontier');
  });
});

/** Creates only test-owned files, keeping physical and lexical sibling roots distinguishable. */
async function createWorkspace(): Promise<{
  readonly container: string;
  readonly root: string;
  readonly target: string;
}> {
  const container = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'react-preview-meta-identity-')),
  );
  const root = path.join(container, 'physical/workspace');
  await mkdir(path.join(root, 'src'), { recursive: true });
  const target = path.join(root, 'src/Target.ts');
  await writeFile(target, 'export const target = 1;\n');
  return { container, root, target };
}

/** Supplies a real verifier input without requiring a source compiler for filesystem cases. */
function createOptions(
  root: string,
  authenticPaths: readonly string[],
  inputs: readonly string[],
): Options {
  const metafile: Metafile = {
    inputs: Object.fromEntries(inputs.map((name) => [name, { bytes: 1, imports: [] }])),
    outputs: {},
  };
  return {
    activity: {
      analysisCandidateCount: 1,
      authoredEdgeCount: 1,
      corridorSourceCount: 1,
      dependencySnapshotCount: 0,
      discoveryScope: 'selected-corridor',
      discoveryTruncated: false,
      exactModuleCount: 1,
      executableCandidateCount: 1,
      frontierSourceBytes: 20,
      graphAdmission: 'unbounded',
      kind: 'bundle-frontier',
      maximumDepth: 0,
      optionalComponentCount: 0,
      packageDemandSourceCount: 0,
      phase: 'planned',
      preparationMode: 'fast',
      projectedEdgeCount: 0,
      styleSnapshotCount: 0,
      supportModuleCount: 0,
      totalAuthoredModuleCount: 1,
      truncated: false,
      truncationReasons: [],
    },
    authenticSourcePaths: authenticPaths,
    metafile,
    target: authenticPaths[0] ?? path.join(root, 'Target.ts'),
    workspaceRoot: root,
  };
}
