/** Same-sized file replacements must invalidate context facts even when mtime is preserved. */
import { mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { PreviewProjectFileAnalysisCache } from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';

describe('project source file identity', () => {
  it.each(['atomic replacement', 'in-place rewrite'])(
    'reads new source and import facts after a same-size, same-mtime %s',
    async (mode) => {
      const root = await mkdtemp(path.join(tmpdir(), 'react-preview-file-identity-'));
      const sourcePath = path.join(root, 'Page.tsx');
      const original = 'import { Old } from "./Old"; export const Page = () => <Old />;';
      const updated = 'import { New } from "./New"; export const Page = () => <New />;';
      try {
        const timestamp = new Date('2026-01-01T00:00:00.000Z');
        await writeFile(sourcePath, original);
        await utimes(sourcePath, timestamp, timestamp);
        const before = await stat(sourcePath);
        const cache = new PreviewProjectFileAnalysisCache();
        const first = await cache.readSource({ sourcePath, maximumBytes: 1024 });
        const firstFacts = cache.analyzeRenderSource(sourcePath, original);
        expect(cache.collectModuleSpecifiers(sourcePath, original)).toEqual(['./Old']);
        if (mode === 'atomic replacement') {
          const replacement = path.join(root, 'replacement.tsx');
          await writeFile(replacement, updated);
          await utimes(replacement, timestamp, timestamp);
          await rename(replacement, sourcePath);
        } else {
          await writeFile(sourcePath, updated);
          await utimes(sourcePath, timestamp, timestamp);
        }
        const after = await stat(sourcePath);
        expect(after.size).toBe(before.size);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        const next = await cache.readSource({ sourcePath, maximumBytes: 1024 });
        expect(next?.sourceText).toBe(updated);
        expect(next?.fingerprint).not.toBe(first?.fingerprint);
        expect(cache.collectModuleSpecifiers(sourcePath, next?.sourceText ?? '')).toEqual([
          './New',
        ]);
        expect(cache.analyzeRenderSource(sourcePath, next?.sourceText ?? '')).not.toBe(firstFacts);
        expect(await cache.readSource({ sourcePath, maximumBytes: 1024 })).toBe(next);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});
