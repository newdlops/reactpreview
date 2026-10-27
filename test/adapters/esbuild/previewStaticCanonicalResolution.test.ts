/** Positive issuer answers share path identities only while the bounded resolution cache retains them. */
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('request-owned canonical module resolution', () => {
  it('shares canonical runtime identities across distinct import issuers', async () => {
    const fixture = await createFixture();
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    const expected = await realpath(fixture.entry);
    const canonical = vi.spyOn(realpathSync, 'native');
    for (const consumer of fixture.consumers) {
      expect(resolver.resolve('shared-view', consumer)).toBe(expected);
    }
    expect(canonical.mock.calls.filter(([file]) => file === expected)).toHaveLength(1);
  });

  it('rechecks a runtime entry symlink when the next request starts', async () => {
    const fixture = await createFixture();
    const consumer = fixture.consumers[0];
    if (consumer === undefined) throw new Error('Missing fixture consumer');
    const first = path.join(fixture.packageRoot, 'first.js');
    const second = path.join(fixture.packageRoot, 'second.js');
    await rename(fixture.entry, first);
    await writeFile(second, 'export default "second";');
    await symlink(first, fixture.entry);
    const initial = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(initial.resolve('shared-view', consumer)).toBe(await realpath(first));
    await rename(fixture.entry, fixture.entry + '-before');
    await symlink(second, fixture.entry);
    const next = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(next.resolve('shared-view', consumer)).toBe(await realpath(second));
    expect(initial.resolve('shared-view', consumer)).toBe(await realpath(first));
  });

  it('drops a physical identity when its last issuer answer is evicted', async () => {
    const fixture = await createFixture();
    const consumer = fixture.consumers[0];
    if (consumer === undefined) throw new Error('Missing fixture consumer');
    const otherPackage = path.join(fixture.root, 'node_modules/other-view');
    await mkdir(otherPackage);
    await writeFile(
      path.join(otherPackage, 'package.json'),
      '{"name":"other-view","main":"index.js"}',
    );
    await writeFile(path.join(otherPackage, 'index.js'), 'export default "other";');
    const otherExpected = await realpath(path.join(otherPackage, 'index.js'));
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    const canonical = vi.spyOn(realpathSync, 'native');
    const initialExpected = await realpath(fixture.entry);
    expect(resolver.resolve('shared-view', consumer)).toBe(initialExpected);
    for (let index = 0; index < 4096; index += 1) {
      const issuer = path.join(fixture.root, 'src', `other-${String(index)}.tsx`);
      expect(resolver.resolve('other-view', issuer)).toBe(otherExpected);
    }
    const replacement = path.join(fixture.packageRoot, 'replacement.js');
    await writeFile(replacement, 'export default "replacement";');
    await rename(fixture.entry, fixture.entry + '-before');
    await symlink(replacement, fixture.entry);
    expect(resolver.resolve('shared-view', consumer)).toBe(await realpath(replacement));
    expect(canonical.mock.calls.filter(([file]) => file === initialExpected)).toHaveLength(2);
  });

  it('keeps identical package specifiers distinct for different issuer installations', async () => {
    const fixture = await createFixture();
    const nested = path.join(fixture.root, 'nested/node_modules/shared-view');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'package.json'), '{"name":"shared-view","main":"index.js"}');
    await writeFile(path.join(nested, 'index.js'), 'export default "nested";');
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    const consumer = fixture.consumers[0];
    if (consumer === undefined) throw new Error('Missing fixture consumer');
    expect(resolver.resolve('shared-view', consumer)).toBe(await realpath(fixture.entry));
    expect(resolver.resolve('shared-view', path.join(fixture.root, 'nested/consumer.tsx'))).toBe(
      await realpath(path.join(nested, 'index.js')),
    );
    expect(resolver.resolve('shared-view', consumer)).toBe(await realpath(fixture.entry));
  });

  it('shares runtime siblings while preserving declaration-based module selection', async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.packageRoot, 'index.d.ts'),
      'declare const view: string; export default view;',
    );
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    const expected = await realpath(fixture.entry);
    const canonical = vi.spyOn(realpathSync, 'native');
    for (const consumer of fixture.consumers) {
      expect(resolver.resolve('shared-view', consumer)).toBe(expected);
    }
    expect(canonical.mock.calls.filter(([file]) => file === expected)).toHaveLength(1);
  });
});

/** Creates actual import issuers that all resolve to one installed runtime entry. */
async function createFixture(): Promise<{
  readonly consumers: readonly string[];
  readonly entry: string;
  readonly packageRoot: string;
  readonly root: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'react-preview-canonical-resolution-'));
  roots.push(root);
  const packageRoot = path.join(root, 'node_modules/shared-view');
  const sourceRoot = path.join(root, 'src');
  await mkdir(packageRoot, { recursive: true });
  await mkdir(sourceRoot);
  const entry = path.join(packageRoot, 'index.js');
  await writeFile(
    path.join(packageRoot, 'package.json'),
    '{"name":"shared-view","main":"index.js"}',
  );
  await writeFile(entry, 'export default "first";');
  const consumers: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    const consumer = path.join(sourceRoot, `consumer-${String(index)}.tsx`);
    await writeFile(consumer, 'import View from "shared-view"; export default View;');
    consumers.push(consumer);
  }
  return { consumers, entry, packageRoot, root };
}
