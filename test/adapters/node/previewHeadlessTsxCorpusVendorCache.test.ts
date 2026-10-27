/** Verifies typed cache admission and fail-open recovery without rerunning a rejected compiler. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewVendorBuildOutput } from '../../../src/adapters/esbuild/previewVendorModuleBuilder';
import { createPreviewHeadlessTsxCorpusVendorCache } from '../../../src/adapters/node/previewHeadlessTsxCorpusVendorCache';

const roots = new Set<string>();
const identity = 'a'.repeat(64);
const output: PreviewVendorBuildOutput = {
  chunks: [{ contents: new Uint8Array([1, 2, 3]), relativePath: 'vendor.js' }],
  moduleImports: [{ relativePath: 'vendor.js', specifier: 'fixture-package' }],
  stylesheet: new Uint8Array([4, 5]),
};

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { force: true, recursive: true })));
  roots.clear();
});

describe('campaign vendor cache admission', () => {
  it('reuses exact verified payloads across cache instances', async () => {
    const fixture = await createFixture();
    const build = vi.fn(() => Promise.resolve(output));
    await expect(fixture.cache.getOrBuild(identity, build)).resolves.toEqual(output);
    const second = createPreviewHeadlessTsxCorpusVendorCache(fixture.options);
    await expect(second.getOrBuild(identity, build)).resolves.toEqual(output);
    expect(build).toHaveBeenCalledOnce();
  });

  it.each(['primitive-payload', 'primitive-import', 'escaping-chunk'] as const)(
    'rebuilds once after a correctly checksummed %s manifest is rejected',
    async (corruption) => {
      const fixture = await createFixture();
      await fixture.cache.getOrBuild(identity, () => Promise.resolve(output));
      const parsed: unknown = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Expected the fixture cache to publish a manifest object.');
      }
      const record = parsed as Record<string, unknown>;
      if (corruption === 'primitive-payload') record.payloads = [null];
      else if (corruption === 'primitive-import') record.moduleImports = [null];
      else {
        record.payloads = [
          {
            bytes: 3,
            relativePath: '../../outside.js',
            role: 'chunk',
            sha256: createHash('sha256')
              .update(new Uint8Array([1, 2, 3]))
              .digest('hex'),
          },
        ];
      }
      const { manifestSha256: previousDigest, ...bare } = record;
      void previousDigest;
      const manifestSha256 = createHash('sha256').update(JSON.stringify(bare)).digest('hex');
      await writeFile(fixture.manifestPath, JSON.stringify({ ...bare, manifestSha256 }));
      const build = vi.fn(() => Promise.resolve(output));
      await expect(fixture.cache.getOrBuild(identity, build)).resolves.toEqual(output);
      expect(build).toHaveBeenCalledOnce();
    },
  );

  it('preserves a compiler rejection and never retries it as a cache miss', async () => {
    const fixture = await createFixture();
    const failure = new Error('intentional native compiler failure');
    const build = vi.fn<() => Promise<PreviewVendorBuildOutput>>().mockRejectedValue(failure);
    await expect(fixture.cache.getOrBuild(identity, build)).rejects.toBe(failure);
    expect(build).toHaveBeenCalledOnce();
  });
});

/** Allocates an isolated spool and the exact manifest path selected by its inert namespace. */
async function createFixture(): Promise<{
  readonly cache: ReturnType<typeof createPreviewHeadlessTsxCorpusVendorCache>;
  readonly manifestPath: string;
  readonly options: Parameters<typeof createPreviewHeadlessTsxCorpusVendorCache>[0];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-vendor-cache-test-'));
  roots.add(root);
  const options = {
    campaignId: 'fixture-campaign',
    engineDigest: 'fixture-engine',
    policyDigest: 'fixture-policy',
    spoolRoot: root,
  };
  return {
    cache: createPreviewHeadlessTsxCorpusVendorCache(options),
    manifestPath: path.join(
      root,
      'vendor-cache',
      options.engineDigest,
      options.policyDigest,
      options.campaignId,
      `${identity}.manifest.json`,
    ),
    options,
  };
}
