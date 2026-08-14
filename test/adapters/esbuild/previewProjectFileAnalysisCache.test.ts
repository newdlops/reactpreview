/** Verifies file-granular source, module-fact, and literal-import reuse across rebuilds. */
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { PreviewProjectFileAnalysisCache } from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';

describe('PreviewProjectFileAnalysisCache', () => {
  /** Reuses unchanged disk text by metadata and replaces only the source path that changed. */
  it('reuses a disk source record until its metadata identity changes', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-file-cache-'));
    const sourcePath = path.join(projectRoot, 'src', 'Page.tsx');
    try {
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, 'export const Page = () => null;', 'utf8');
      const cache = new PreviewProjectFileAnalysisCache();

      const first = await cache.readSource({ maximumBytes: 1024, sourcePath });
      const second = await cache.readSource({ maximumBytes: 1024, sourcePath });
      await writeFile(sourcePath, 'export const LongerPage = () => null;', 'utf8');
      const changed = await cache.readSource({ maximumBytes: 1024, sourcePath });

      expect(second).toBe(first);
      expect(changed).not.toBe(first);
      expect(changed?.sourceText).toContain('LongerPage');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps another module's AST and import facts when only the selected target snapshot changes. */
  it('invalidates module and import facts independently by source fingerprint', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    const targetPath = path.resolve('/workspace/src/Target.tsx');
    const pagePath = path.resolve('/workspace/src/Page.tsx');
    const firstTarget = 'export const Target = () => <button />;';
    const changedTarget = 'export const Target = () => <article />;';
    const pageSource = [
      "import { Target } from './Target';",
      'export const Page = () => <Target />;',
    ].join('\n');

    await cache.readSource({
      maximumBytes: 1024,
      snapshotText: firstTarget,
      sourcePath: targetPath,
    });
    await cache.readSource({
      maximumBytes: 1024,
      snapshotText: pageSource,
      sourcePath: pagePath,
    });
    const firstTargetAnalysis = cache.analyzeRenderSource(targetPath, firstTarget);
    const firstPageAnalysis = cache.analyzeRenderSource(pagePath, pageSource);
    const firstPageImports = cache.collectModuleSpecifiers(pagePath, pageSource);

    await cache.readSource({
      maximumBytes: 1024,
      snapshotText: changedTarget,
      sourcePath: targetPath,
    });
    const changedTargetAnalysis = cache.analyzeRenderSource(targetPath, changedTarget);
    const retainedPageAnalysis = cache.analyzeRenderSource(pagePath, pageSource);
    const retainedPageImports = cache.collectModuleSpecifiers(pagePath, pageSource);

    expect(changedTargetAnalysis).not.toBe(firstTargetAnalysis);
    expect(retainedPageAnalysis).toBe(firstPageAnalysis);
    expect(retainedPageImports).toBe(firstPageImports);
    expect(retainedPageImports).toEqual(['./Target']);
  });

  /** Uses content identity for unsaved overlays so equal snapshots share the same source record. */
  it('reuses equal editor snapshots without relying on disk timestamps', async () => {
    const cache = new PreviewProjectFileAnalysisCache();
    const sourcePath = path.resolve('/workspace/src/Unsaved.tsx');
    const sourceText = 'export const Unsaved = () => null;';

    const first = await cache.readSource({
      maximumBytes: 1024,
      snapshotText: sourceText,
      sourcePath,
    });
    const second = await cache.readSource({
      maximumBytes: 1024,
      snapshotText: sourceText,
      sourcePath,
    });

    expect(second).toBe(first);
    expect(second?.fingerprint).toMatch(/^snapshot:/u);
  });

  /** Reads and reuses exact source entries stored inside a Yarn PnP cache archive. */
  it('caches a bounded Yarn zip source without executing the PnP manifest', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-yarn-zip-cache-'));
    const archivePath = path.join(workspaceRoot, '.yarn', 'cache', 'legacy-npm-1.0.0.zip');
    const entryPath = 'node_modules/legacy/index.js';
    const virtualSourcePath = path.join(archivePath, ...entryPath.split('/'));
    const sourceText = 'module.exports = function legacy() { accidental = true; };';
    try {
      await mkdir(path.dirname(archivePath), { recursive: true });
      await writeSourceArchive(archivePath, entryPath, sourceText);
      const cache = new PreviewProjectFileAnalysisCache();

      const first = await cache.readSource({ maximumBytes: 1024, sourcePath: virtualSourcePath });
      const second = await cache.readSource({ maximumBytes: 1024, sourcePath: virtualSourcePath });
      const oversized = await cache.readSource({ maximumBytes: 8, sourcePath: virtualSourcePath });

      expect(first?.sourceText).toBe(sourceText);
      expect(first?.fingerprint).toMatch(/^yarn-zip:/u);
      expect(second).toBe(first);
      expect(oversized).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Writes one deterministic test source into the same cache archive shape Yarn PnP exposes. */
async function writeSourceArchive(
  archivePath: string,
  entryPath: string,
  sourceText: string,
): Promise<void> {
  const archive = new ZipFile();
  archive.addBuffer(Buffer.from(sourceText), entryPath);
  archive.end();
  await pipeline(archive.outputStream, createWriteStream(archivePath));
}
