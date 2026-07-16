/** Verifies package-scoped usage caching, invalidation, and monorepo isolation. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { PreviewProjectUsageCache } from '../../../src/adapters/esbuild/previewProjectUsageCache';
import type { PreviewTargetUsagePropsOptions } from '../../../src/adapters/esbuild/previewTargetUsageProps';

describe('PreviewProjectUsageCache', () => {
  /** Re-reads a selected parent when a save changes the literal props it contributes. */
  it('invalidates positive evidence when its consumer metadata changes', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'Page.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeConsumer(consumerPath, 'FirstPage'),
      ]);
      const cache = new PreviewProjectUsageCache();

      const first = await cache.discover(createOptions(projectRoot, targetPath));
      await writeConsumer(consumerPath, 'LongerSecondPage');
      const second = await cache.discover(createOptions(projectRoot, targetPath));

      expect(first.propsByExport).toEqual({ Breadcrumb: { pageName: 'FirstPage' } });
      expect(second.propsByExport).toEqual({ Breadcrumb: { pageName: 'LongerSecondPage' } });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Lets unsaved editor text override otherwise current disk-backed cache evidence. */
  it('bypasses a matching cached consumer for a dirty snapshot', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'Page.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeConsumer(consumerPath, 'SavedPage'),
      ]);
      const cache = new PreviewProjectUsageCache();
      await cache.discover(createOptions(projectRoot, targetPath));

      const result = await cache.discover({
        ...createOptions(projectRoot, targetPath),
        snapshots: [
          {
            documentPath: consumerPath,
            language: 'tsx',
            sourceText: createConsumerSource('UnsavedPage'),
          },
        ],
      });

      expect(result.propsByExport).toEqual({ Breadcrumb: { pageName: 'UnsavedPage' } });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Rebuilds a no-prop target's selected wrapper recipe after its parent source changes. */
  it('invalidates a cached parent render slice through its hot-reload dependency', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-slice-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'Page.tsx');
    const createSliceSource = (mode: string): string =>
      [
        "import { Breadcrumb } from './Breadcrumb';",
        `export const Page = () => <main data-mode=${JSON.stringify(mode)}><Breadcrumb /></main>;`,
      ].join('\n');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeFile(consumerPath, createSliceSource('first'), 'utf8'),
      ]);
      const cache = new PreviewProjectUsageCache();

      const first = await cache.discover(createOptions(projectRoot, targetPath));
      await writeFile(consumerPath, createSliceSource('longer-second'), 'utf8');
      const second = await cache.discover(createOptions(projectRoot, targetPath));

      expect(first.parentSlicesByExport.Breadcrumb?.frames[0]).toMatchObject({
        props: { 'data-mode': 'first' },
      });
      expect(second.parentSlicesByExport.Breadcrumb?.frames[0]).toMatchObject({
        props: { 'data-mode': 'longer-second' },
      });
      expect(second.dependencyPaths).toEqual([consumerPath]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Refreshes both a negative result and its path inventory so newly created usages appear. */
  it('admits a new consumer after the short negative-cache window', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-usage-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'NewPage.tsx');
    let currentTime = 1_000;
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8');
      const cache = new PreviewProjectUsageCache({ now: () => currentTime });

      const missing = await cache.discover(createOptions(projectRoot, targetPath));
      await writeConsumer(consumerPath, 'CreatedPage');
      currentTime += 5_001;
      const discovered = await cache.discover(createOptions(projectRoot, targetPath));

      expect(missing.propsByExport).toEqual({});
      expect(discovered.propsByExport).toEqual({ Breadcrumb: { pageName: 'CreatedPage' } });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Expires a target-only Inspector plan so a newly authored parent can become the actual root. */
  it('rechecks a zero-edge inspector plan after the bounded cache window', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-inspector-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'NewPage.tsx');
    let currentTime = 1_000;
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8');
      const cache = new PreviewProjectUsageCache({ now: () => currentTime });

      const targetOnly = await cache.discover(createInspectorOptions(projectRoot, targetPath));
      await writeConsumer(consumerPath, 'CreatedInspectorPage');
      currentTime += 5_001;
      const discovered = await cache.discover(createInspectorOptions(projectRoot, targetPath));

      expect(targetOnly.inspectorPlan?.edges).toEqual([]);
      expect(discovered.inspectorPlan?.root).toEqual({
        exportName: 'Page',
        sourcePath: consumerPath,
      });
      expect(discovered.inspectorPlan?.edges).toHaveLength(1);
      expect(discovered.dependencyPaths).toEqual(
        expect.arrayContaining([targetPath, consumerPath]),
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Invalidates a zero-edge plan immediately when a dirty package source adds a parent usage. */
  it('rechecks dirty source snapshots without waiting for inventory expiry', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-inspector-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'Page.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeFile(consumerPath, 'export const Page = () => <p>saved</p>;', 'utf8'),
      ]);
      const cache = new PreviewProjectUsageCache();
      const targetOnly = await cache.discover(createInspectorOptions(projectRoot, targetPath));

      const discovered = await cache.discover({
        ...createInspectorOptions(projectRoot, targetPath),
        snapshots: [
          {
            documentPath: consumerPath,
            language: 'tsx',
            sourceText: createConsumerSource('UnsavedInspectorPage'),
          },
        ],
      });

      expect(targetOnly.inspectorPlan?.edges).toEqual([]);
      expect(discovered.inspectorPlan?.root.sourcePath).toBe(consumerPath);
      expect(discovered.inspectorPlan?.targetAutomaticProps).toEqual({
        pageName: 'UnsavedInspectorPage',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates the repeated target query while preserving explicit package/workspace boundaries. */
function createOptions(
  projectRoot: string,
  documentPath: string,
): Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'> {
  return {
    documentPath,
    exports: [
      {
        displayName: 'Breadcrumb',
        exportName: 'Breadcrumb',
        kind: 'explicit' as const,
      },
    ],
    projectRoot,
    snapshots: [],
    workspaceRoot: projectRoot,
  };
}

/** Creates the same cache query with opt-in actual-parent Inspector discovery enabled. */
function createInspectorOptions(
  projectRoot: string,
  documentPath: string,
): Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'> {
  return {
    ...createOptions(projectRoot, documentPath),
    climbParentSlices: false,
    inspectorExportName: 'Breadcrumb',
  };
}

/** Writes one parent usage with a static string that can be compared across rebuilds. */
function writeConsumer(consumerPath: string, pageName: string): Promise<void> {
  return writeFile(consumerPath, createConsumerSource(pageName), 'utf8');
}

/** Creates inert TSX source without interpolating executable application expressions. */
function createConsumerSource(pageName: string): string {
  return [
    "import { Breadcrumb } from './Breadcrumb';",
    `export const Page = () => <Breadcrumb pageName=${JSON.stringify(pageName)} />;`,
  ].join('\n');
}
