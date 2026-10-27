/** Retained programs must observe current filesystem and editor inputs without changing old types. */
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgram,
  type PreviewTypeProgramInput,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { readPreviewTypedComponentProps } from '../../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('retained type resolution freshness', () => {
  it('rescans changed import text and preserves the earlier program result', async () => {
    const fixture = await createFixture('./first');
    await writeFile(
      path.join(fixture.root, 'first.ts'),
      "export interface Props { status: 'first'; }",
    );
    await writeFile(
      path.join(fixture.root, 'later.ts'),
      "export interface Props { status: 'later'; }",
    );
    const cache = new PreviewTypeSourceFileCache();
    const first = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
    fixture.snapshots.set(
      fixture.page,
      "import type { Props } from './later'; export function Page(props: Props) { return null; }",
    );
    const later = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(later, fixture.page)).toEqual({ status: 'later' });
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
  });

  it.each(['disk', 'snapshot'] as const)(
    'discovers a previously missing %s module next build',
    async (mode) => {
      const fixture = await createFixture('./props');
      const cache = new PreviewTypeSourceFileCache();
      const missing = createPreviewTypeProgram(fixture.input, cache);
      expect(readProps(missing, fixture.page)).toBeUndefined();
      const text = "export interface Props { status: 'ready'; }";
      if (mode === 'disk') await writeFile(fixture.props, text);
      else fixture.snapshots.set(fixture.props, text);
      const changed = createPreviewTypeProgram(fixture.input, cache);
      expect(readProps(changed, fixture.page)).toEqual({ status: 'ready' });
      expect(readProps(missing, fixture.page)).toBeUndefined();
    },
  );

  it('rechecks package entry metadata even when the previous file still exists', async () => {
    const fixture = await createFixture('payload-kit');
    const packageRoot = path.join(fixture.root, 'node_modules', 'payload-kit');
    await mkdir(packageRoot, { recursive: true });
    const manifest = path.join(packageRoot, 'package.json');
    await writeFile(
      path.join(packageRoot, 'first.d.ts'),
      "export interface Props { status: 'first'; }",
    );
    await writeFile(
      path.join(packageRoot, 'second.d.ts'),
      "export interface Props { status: 'second'; }",
    );
    await writeFile(manifest, JSON.stringify({ name: 'payload-kit', types: 'first.d.ts' }));
    const cache = new PreviewTypeSourceFileCache();
    const first = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
    await writeFile(manifest, JSON.stringify({ name: 'payload-kit', types: 'second.d.ts' }));
    const second = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(second, fixture.page)).toEqual({ status: 'second' });
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
  });

  it('observes unsaved package metadata and then its discarded snapshot', async () => {
    const fixture = await createFixture('payload-kit');
    const packageRoot = path.join(fixture.root, 'node_modules', 'payload-kit');
    await mkdir(packageRoot, { recursive: true });
    const manifest = path.join(packageRoot, 'package.json');
    await writeFile(
      path.join(packageRoot, 'first.d.ts'),
      "export interface Props { status: 'first'; }",
    );
    await writeFile(
      path.join(packageRoot, 'second.d.ts'),
      "export interface Props { status: 'second'; }",
    );
    await writeFile(manifest, JSON.stringify({ name: 'payload-kit', types: 'first.d.ts' }));
    const cache = new PreviewTypeSourceFileCache();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
    fixture.snapshots.set(manifest, JSON.stringify({ name: 'payload-kit', types: 'second.d.ts' }));
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'second',
    });
    fixture.snapshots.clear();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
  });

  it('rechecks a package symlink after retargeting while both physical entries remain valid', async () => {
    const fixture = await createFixture('payload-kit');
    const logical = path.join(fixture.root, 'node_modules', 'payload-kit');
    await mkdir(path.dirname(logical), { recursive: true });
    const packageRoots = ['first', 'second'].map((name) =>
      path.join(fixture.root, 'packages', name),
    );
    for (const [index, root] of packageRoots.entries()) {
      await mkdir(root, { recursive: true });
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'payload-kit', types: 'index.d.ts' }),
      );
      await writeFile(
        path.join(root, 'index.d.ts'),
        `export interface Props { value: ${String(index + 1)}; }`,
      );
    }
    const [firstRoot, secondRoot] = packageRoots;
    if (firstRoot === undefined || secondRoot === undefined)
      throw new Error('Package fixture missing');
    await symlink(firstRoot, logical);
    const cache = new PreviewTypeSourceFileCache();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      value: 1,
    });
    await rename(logical, logical + '-previous');
    await symlink(secondRoot, logical);
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      value: 2,
    });
  });

  it('selects a newly created higher-priority sibling and recovers when it is removed', async () => {
    const fixture = await createFixture('./props');
    const previous = fixture.props.replace(/\.ts$/u, '.tsx');
    await writeFile(previous, "export interface Props { status: 'tsx'; }");
    const cache = new PreviewTypeSourceFileCache();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'tsx',
    });
    await writeFile(fixture.props, "export interface Props { status: 'ts'; }");
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'ts',
    });
    await rename(fixture.props, fixture.props + '.previous');
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'tsx',
    });
  });
});

/** Reads neutral props from the real checker, so stale module answers remain observable. */
function readProps(program: PreviewTypeProgram, page: string): unknown {
  const source = program.program.getSourceFile(page);
  if (source === undefined) throw new Error('Fixture page not admitted');
  return readPreviewTypedComponentProps(program.checker, source, 'Page');
}

/** Owns the importing page and a mutable editor-snapshot map inside a disposable test root. */
async function createFixture(specifier: string): Promise<{
  readonly root: string;
  readonly page: string;
  readonly props: string;
  readonly snapshots: Map<string, string>;
  readonly input: PreviewTypeProgramInput;
}> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'preview-type-freshness-')));
  roots.push(root);
  const page = path.join(root, 'page.ts');
  const props = path.join(root, 'props.ts');
  const config = path.join(root, 'tsconfig.json');
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        moduleResolution: 'Bundler',
        module: 'ESNext',
        jsx: 'preserve',
        strict: true,
      },
    }),
  );
  await writeFile(
    page,
    `import type { Props } from '${specifier}'; export function Page(props: Props) { return null; }`,
  );
  const snapshots = new Map<string, string>();
  return {
    root,
    page,
    props,
    snapshots,
    input: {
      managedNodeModulesPaths: [],
      rootPaths: [page],
      readSnapshot: (file) => snapshots.get(file),
      tsconfigPath: config,
    },
  };
}
