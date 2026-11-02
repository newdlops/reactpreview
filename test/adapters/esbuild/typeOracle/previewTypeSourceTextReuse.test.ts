/** Real programs must reuse validated disk text without freezing edits or bypassing admission. */
import { statSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgram,
  type PreviewTypeProgramInput,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { readPreviewTypedComponentProps } from '../../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';
import { PreviewTypeSourceTextCache } from '../../../../src/adapters/esbuild/typeOracle/previewTypeSourceTextCache';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('validated type source text reuse', () => {
  it('does not retain decoded candidates that cannot fit the admission limit', async () => {
    const fixture = await createFixture();
    const reads = observeReads(fixture.props);
    const cache = new PreviewTypeSourceTextCache();
    // The ASCII file fits the coarse UTF-8 preflight (3 * 20 bytes), but not 20 text units.
    expect(cache.read(fixture.props, 20)).toBe("export interface Props { status: 'first'; }");
    expect(cache.read(fixture.props, 20)).toBe("export interface Props { status: 'first'; }");
    expect(reads).toEqual([fixture.props, fixture.props]);
  });

  it('avoids reopening unchanged admitted text while preserving real checker results', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    const reads = observeReads(fixture.props);
    const first = createPreviewTypeProgram(fixture.input, cache);
    const second = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
    expect(readProps(second, fixture.page)).toEqual({ status: 'first' });
    expect(second.status.admittedBytes).toBe(first.status.admittedBytes);
    expect(reads).toEqual([fixture.props]);
    cache.clear();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
    expect(reads).toEqual([fixture.props, fixture.props]);
  });

  it('observes a same-size edit even after its modification time is restored', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    const timestamp = new Date('2020-01-01T00:00:00Z');
    await utimes(fixture.props, timestamp, timestamp);
    const before = statSync(fixture.props, { bigint: true });
    const first = createPreviewTypeProgram(fixture.input, cache);
    await writeFile(fixture.props, "export interface Props { status: 'later'; }");
    await utimes(fixture.props, timestamp, timestamp);
    const after = statSync(fixture.props, { bigint: true });
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);
    const second = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(second, fixture.page)).toEqual({ status: 'later' });
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
  });

  it('prefers dirty text then rereads changed disk after the snapshot is discarded', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
    fixture.snapshots.set(fixture.props, "export interface Props { status: 'dirty'; }");
    await writeFile(fixture.props, "export interface Props { status: 'saved'; }");
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'dirty',
    });
    fixture.snapshots.clear();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'saved',
    });
  });

  it('does not resurrect deleted text and observes an atomic replacement', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    const first = createPreviewTypeProgram(fixture.input, cache);
    await unlink(fixture.props);
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toBeUndefined();
    const replacement = fixture.props + '.new';
    await writeFile(replacement, "export interface Props { status: 'later'; }");
    await rename(replacement, fixture.props);
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'later',
    });
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
  });

  it('charges reused text to a smaller admission budget', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    createPreviewTypeProgram(fixture.input, cache);
    const limited = createPreviewTypeProgram(fixture.input, cache, {
      maxFileBytes: 1,
      maxProjectFiles: 400,
      maxTextBytes: 8 * 1024 * 1024,
    });
    expect(limited.program.getSourceFile(fixture.props)).toBeUndefined();
    expect(limited.status.refusedModules).toBe(1);
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
  });

  it('does not retain bytes read while the file is being replaced', async () => {
    const fixture = await createFixture();
    const read = ts.sys.readFile.bind(ts.sys);
    let changed = false;
    vi.spyOn(ts.sys, 'readFile').mockImplementation((name, encoding) => {
      const text = read(name, encoding);
      if (name === fixture.props && !changed) {
        changed = true;
        writeFileSync(name, "export interface Props { status: 'later'; }");
      }
      return text;
    });
    const cache = new PreviewTypeSourceFileCache();
    const first = createPreviewTypeProgram(fixture.input, cache);
    const second = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(first, fixture.page)).toEqual({ status: 'first' });
    expect(readProps(second, fixture.page)).toEqual({ status: 'later' });
  });

  it('drops disk text when a later program no longer admits that dependency', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    const reads = observeReads(fixture.props);
    createPreviewTypeProgram(fixture.input, cache);
    fixture.snapshots.set(fixture.page, 'export function Page() { return null; }');
    expect(
      createPreviewTypeProgram(fixture.input, cache).program.getSourceFile(fixture.props),
    ).toBeUndefined();
    fixture.snapshots.clear();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
    expect(reads).toEqual([fixture.props, fixture.props]);
  });

  it('retries a failed read rather than retaining a missing answer', async () => {
    const fixture = await createFixture();
    const cache = new PreviewTypeSourceFileCache();
    const read = ts.sys.readFile.bind(ts.sys);
    let failed = false;
    vi.spyOn(ts.sys, 'readFile').mockImplementation((name, encoding) => {
      if (name === fixture.props && !failed) {
        failed = true;
        return undefined;
      }
      return read(name, encoding);
    });
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toBeUndefined();
    expect(readProps(createPreviewTypeProgram(fixture.input, cache), fixture.page)).toEqual({
      status: 'first',
    });
  });
});

/** Counts actual disk reads while letting TypeScript decode and analyze the real fixture. */
function observeReads(sourcePath: string): string[] {
  const reads: string[] = [];
  const read = ts.sys.readFile.bind(ts.sys);
  vi.spyOn(ts.sys, 'readFile').mockImplementation((name, encoding) => {
    if (name === sourcePath) reads.push(name);
    return read(name, encoding);
  });
  return reads;
}

/** Extracts values using the production checker adapter, including missing-module behavior. */
function readProps(analysis: PreviewTypeProgram, page: string): unknown {
  const source = analysis.program.getSourceFile(page);
  if (source === undefined) throw new Error('Fixture page not admitted');
  return readPreviewTypedComponentProps(analysis.checker, source, 'Page');
}

/** Creates an importing page and one small mutable declaration in a disposable root. */
async function createFixture(): Promise<{
  readonly props: string;
  readonly page: string;
  readonly snapshots: Map<string, string>;
  readonly input: PreviewTypeProgramInput;
}> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'type-source-reuse-')));
  roots.push(root);
  const page = path.join(root, 'page.ts');
  const props = path.join(root, 'props.ts');
  const tsconfigPath = path.join(root, 'tsconfig.json');
  await writeFile(
    tsconfigPath,
    JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' } }),
  );
  await writeFile(
    page,
    "import type { Props } from './props'; export function Page(props: Props) { return null; }",
  );
  await writeFile(props, "export interface Props { status: 'first'; }");
  const snapshots = new Map<string, string>();
  return {
    page,
    props,
    snapshots,
    input: {
      managedNodeModulesPaths: [],
      readSnapshot: (name) => snapshots.get(name),
      rootPaths: [page],
      tsconfigPath,
    },
  };
}
