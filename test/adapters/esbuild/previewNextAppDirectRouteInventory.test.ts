/** Verifies that direct App Router preparation stays inside one bounded filesystem corridor. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewNextAppDirectRouteInventory } from '../../../src/adapters/esbuild/previewNextAppDirectRouteInventory';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('collectPreviewNextAppDirectRouteInventory', () => {
  /** A selected page needs ancestor layouts, but not unrelated sibling page graphs. */
  it('collects only the selected page ancestor corridor', async () => {
    const projectRoot = await createProjectRoot();
    const appRoot = path.join(projectRoot, 'src', 'app');
    const pagePath = path.join(appRoot, '(view)', 'preview', '[name]', 'page.tsx');
    const rootLayout = path.join(appRoot, 'layout.tsx');
    const groupLayout = path.join(appRoot, '(view)', 'layout.tsx');
    const previewTemplate = path.join(appRoot, '(view)', 'preview', 'template.tsx');
    const previewSlot = path.join(appRoot, '(view)', 'preview', '@drawer', 'default.tsx');
    const unrelatedPage = path.join(appRoot, 'admin', 'page.tsx');
    await Promise.all(
      [pagePath, rootLayout, groupLayout, previewTemplate, previewSlot, unrelatedPage].map(
        createSourceFile,
      ),
    );

    const result = await collectPreviewNextAppDirectRouteInventory({
      documentPath: pagePath,
      projectRoot,
    });

    expect(result).toEqual(
      expect.arrayContaining([pagePath, rootLayout, groupLayout, previewTemplate, previewSlot]),
    );
    expect(result).not.toContain(unrelatedPage);
  });

  /** A selected layout searches only its capped subtree so it can choose descendant pages/slots. */
  it('collects descendant pages and parallel-slot defaults for a selected layout', async () => {
    const projectRoot = await createProjectRoot();
    const appRoot = path.join(projectRoot, 'app');
    const layoutPath = path.join(appRoot, 'dashboard', 'layout.tsx');
    const pagePath = path.join(appRoot, 'dashboard', 'reports', 'page.tsx');
    const slotDefault = path.join(appRoot, 'dashboard', '@modal', 'default.tsx');
    const outsidePage = path.join(appRoot, 'settings', 'page.tsx');
    await Promise.all(
      [layoutPath, pagePath, slotDefault, outsidePage, path.join(appRoot, 'layout.tsx')].map(
        createSourceFile,
      ),
    );

    const result = await collectPreviewNextAppDirectRouteInventory({
      documentPath: layoutPath,
      projectRoot,
    });

    expect(result).toEqual(expect.arrayContaining([layoutPath, pagePath, slotDefault]));
    expect(result).not.toContain(outsidePage);
  });

  /** Dirty snapshots may augment the corridor but can never escape the selected App root. */
  it('admits only in-root dirty source identities', async () => {
    const projectRoot = await createProjectRoot();
    const pagePath = path.join(projectRoot, 'app', 'page.tsx');
    const dirtyLayout = path.join(projectRoot, 'app', 'draft', 'layout.tsx');
    const escapedSource = path.join(projectRoot, 'components', 'layout.tsx');
    await createSourceFile(pagePath);

    const result = await collectPreviewNextAppDirectRouteInventory({
      additionalSourcePaths: [dirtyLayout, escapedSource],
      documentPath: pagePath,
      projectRoot,
    });

    expect(result).toContain(dirtyLayout);
    expect(result).not.toContain(escapedSource);
  });

  /** A large dirty-editor set cannot bypass the same source cap used by directory traversal. */
  it('caps and filters dirty route-context snapshots', async () => {
    const projectRoot = await createProjectRoot();
    const pagePath = path.join(projectRoot, 'app', 'page.tsx');
    const ignoredHelper = path.join(projectRoot, 'app', 'helpers', 'format.ts');
    await createSourceFile(pagePath);
    const dirtyRoutes = Array.from({ length: 2_000 }, (_, index) =>
      path.join(projectRoot, 'app', 'draft', index.toString(), 'layout.tsx'),
    );

    const result = await collectPreviewNextAppDirectRouteInventory({
      additionalSourcePaths: [ignoredHelper, ...dirtyRoutes],
      documentPath: pagePath,
      projectRoot,
    });

    expect(result).toHaveLength(1_024);
    expect(result).not.toContain(ignoredHelper);
  });
});

/** Creates one isolated package root without installing framework dependencies. */
async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-next-inventory-'));
  temporaryRoots.push(projectRoot);
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/** Writes a minimal source file after creating its authored route directory. */
async function createSourceFile(sourcePath: string): Promise<void> {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, 'export default function Route() { return null; }', 'utf8');
}
