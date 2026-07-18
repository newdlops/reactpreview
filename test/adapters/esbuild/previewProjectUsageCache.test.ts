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

  /** Rechecks an unresolved entry chain even when a valid parent Inspector root already exists. */
  it('admits a newly created application entry after the provisional graph window', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-entry-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const pagePath = path.join(projectRoot, 'src', 'Page.tsx');
    const entryPath = path.join(projectRoot, 'src', 'main.tsx');
    let currentTime = 1_000;
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeConsumer(pagePath, 'ExistingPage'),
      ]);
      const cache = new PreviewProjectUsageCache({ now: () => currentTime });

      const withoutEntry = await cache.discover(createInspectorOptions(projectRoot, targetPath));
      await writeFile(
        entryPath,
        [
          "import { createRoot } from 'react-dom/client';",
          "import { Page } from './Page';",
          'createRoot(document.body).render(<Page />);',
        ].join('\n'),
        'utf8',
      );
      currentTime += 5_001;
      const withEntry = await cache.discover(createInspectorOptions(projectRoot, targetPath));

      expect(withoutEntry.inspectorPlan?.edges).toHaveLength(1);
      expect(withoutEntry.renderChainsByExport?.Breadcrumb?.reachability).toBe('entry-unreachable');
      expect(withEntry.renderChainsByExport?.Breadcrumb?.reachability).toBe('entry-connected');
      expect(withEntry.renderChainsByExport?.Breadcrumb?.paths[0]?.entryPoint?.sourcePath).toBe(
        entryPath,
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

  /** Keeps an incomplete target graph cached when another open editor cannot reference it. */
  it('ignores unrelated dirty snapshots while validating provisional inspector evidence', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-inspector-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const unrelatedPath = path.join(projectRoot, 'src', 'UnrelatedEditor.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeFile(unrelatedPath, 'export const Saved = () => <p>saved</p>;', 'utf8'),
      ]);
      const cache = new PreviewProjectUsageCache();
      const first = await cache.discover(createInspectorOptions(projectRoot, targetPath));

      const retained = await cache.discover({
        ...createInspectorOptions(projectRoot, targetPath),
        snapshots: [
          {
            documentPath: unrelatedPath,
            language: 'tsx',
            sourceText: 'export const UnrelatedEditor = () => <section>dirty</section>;',
          },
        ],
      });

      expect(retained).toBe(first);
      expect(retained.inspectorPlan?.edges).toEqual([]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Uses the current target editor text and its fingerprint instead of reusing a saved graph seed. */
  it('invalidates Inspector entry chains when the unsaved target source changes', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-inspector-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Target.tsx');
    const entryPath = path.join(projectRoot, 'src', 'main.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export default function SavedTarget() { return null; }', 'utf8'),
        writeFile(
          entryPath,
          [
            "import { createRoot } from 'react-dom/client';",
            "import Target from './Target';",
            'createRoot(document.body).render(<Target />);',
          ].join('\n'),
          'utf8',
        ),
      ]);
      const cache = new PreviewProjectUsageCache();
      const createEntryOptions = (
        componentName: string,
      ): Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'> => ({
        documentPath: targetPath,
        exports: [{ displayName: 'default', exportName: 'default', kind: 'explicit' as const }],
        inspectorExportName: 'default',
        projectRoot,
        snapshots: [],
        sourceText: `export default function ${componentName}() { return null; }`,
        workspaceRoot: projectRoot,
      });

      const first = await cache.discover(createEntryOptions('FirstUnsavedTarget'));
      const second = await cache.discover(createEntryOptions('SecondUnsavedTarget'));

      expect(first.inspectorPlan?.renderChain.paths[0]?.steps[0]?.label).toBe(
        'FirstUnsavedTarget (default)',
      );
      expect(second.inspectorPlan?.renderChain.paths[0]?.steps[0]?.label).toBe(
        'SecondUnsavedTarget (default)',
      );
      expect(second.inspectorPlan?.renderChain.reachability).toBe('entry-connected');
      expect(
        (cache as unknown as { readonly usageResults: ReadonlyMap<string, unknown> }).usageResults
          .size,
      ).toBe(1);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Invalidates the shared plan when only a non-selected export's application path changes. */
  it('tracks hot-reload dependencies for every current-file export chain', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-all-export-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Targets.tsx');
    const primaryEntryPath = path.join(projectRoot, 'src', 'primary-entry.tsx');
    const secondaryPagePath = path.join(projectRoot, 'src', 'SecondaryPage.tsx');
    const secondaryEntryPath = path.join(projectRoot, 'src', 'secondary-entry.tsx');
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(
          targetPath,
          [
            'export const Primary = () => <article />;',
            'export const Secondary = () => <article />;',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          primaryEntryPath,
          [
            "import { createRoot } from 'react-dom/client';",
            "import { Primary } from './Targets';",
            'createRoot(document.body).render(<Primary />);',
          ].join('\n'),
          'utf8',
        ),
        writeSecondaryPage(secondaryPagePath, 'SecondaryPage'),
        writeFile(
          secondaryEntryPath,
          [
            "import { createRoot } from 'react-dom/client';",
            "import SecondaryRoot from './SecondaryPage';",
            'createRoot(document.body).render(<SecondaryRoot />);',
          ].join('\n'),
          'utf8',
        ),
      ]);
      const cache = new PreviewProjectUsageCache();
      const options: Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'> = {
        climbParentSlices: false,
        documentPath: targetPath,
        exports: [
          { displayName: 'Primary', exportName: 'Primary', kind: 'explicit' },
          { displayName: 'Secondary', exportName: 'Secondary', kind: 'explicit' },
        ],
        inspectorExportName: 'Primary',
        projectRoot,
        snapshots: [],
        workspaceRoot: projectRoot,
      };

      const first = await cache.discover(options);
      await writeSecondaryPage(secondaryPagePath, 'LongerSecondaryPage');
      const second = await cache.discover(options);

      expect(first.renderChainsByExport?.Secondary?.paths[0]?.steps[1]?.label).toBe(
        'SecondaryPage',
      );
      expect(second.renderChainsByExport?.Secondary?.paths[0]?.steps[1]?.label).toBe(
        'LongerSecondaryPage',
      );
      expect(second.dependencyPaths).toContain(secondaryPagePath);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps proven parent evidence when inventory refresh finds the same authored path set. */
  it('does not expire a partial positive render chain solely because inventory TTL elapsed', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-positive-cache-'));
    const targetPath = path.join(projectRoot, 'src', 'Breadcrumb.tsx');
    const consumerPath = path.join(projectRoot, 'src', 'Page.tsx');
    let currentTime = 1_000;
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export const Breadcrumb = () => null;', 'utf8'),
        writeConsumer(consumerPath, 'StablePage'),
      ]);
      const cache = new PreviewProjectUsageCache({ now: () => currentTime });

      const first = await cache.discover(createInspectorOptions(projectRoot, targetPath));
      currentTime += 5_001;
      const retained = await cache.discover(createInspectorOptions(projectRoot, targetPath));

      expect(retained).toBe(first);
      expect(retained.inspectorPlan?.edges).toHaveLength(1);
      expect(retained.renderChainsByExport?.Breadcrumb?.reachability).toBe('entry-unreachable');
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

/** Writes a default page whose declaration label exposes non-selected-chain cache refreshes. */
function writeSecondaryPage(sourcePath: string, componentName: string): Promise<void> {
  return writeFile(
    sourcePath,
    [
      "import { Secondary } from './Targets';",
      `export default function ${componentName}() { return <Secondary />; }`,
    ].join('\n'),
    'utf8',
  );
}
