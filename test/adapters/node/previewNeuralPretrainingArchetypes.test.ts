/** Verifies that the synthetic archetype projects are complete and routable. */
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PREVIEW_NEURAL_EXTENDED_ROUTES } from '../../../src/adapters/node/previewNeuralPretrainingArchetypeCatalog';
import { writePreviewNeuralArchetypes } from '../../../src/adapters/node/previewNeuralPretrainingArchetypes';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('writePreviewNeuralArchetypes', () => {
  /** Every listed page exists, and the single-page app routes every extended page. */
  it('writes both projects with every listed page', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'react-preview-archetypes-'));
    temporaryRoots.push(root);

    const workspaces = await writePreviewNeuralArchetypes(root);
    const app = await readFile(path.join(root, 'spa', 'src', 'App.tsx'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(root, 'spa', 'package.json'), 'utf8')) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };

    expect(workspaces.map(({ name, pages }) => [name, pages.length])).toEqual([
      ['archetypes-spa', 8 + PREVIEW_NEURAL_EXTENDED_ROUTES.length],
      ['archetypes-next', 5],
    ]);
    for (const workspace of workspaces) {
      for (const page of workspace.pages) {
        await expect(access(path.join(workspace.root, page))).resolves.toBeUndefined();
      }
    }
    for (const [route, component] of PREVIEW_NEURAL_EXTENDED_ROUTES) {
      expect(app).toContain(`import ${component} from './pages/${component}';`);
      expect(app).toContain(`<Route path="${route}" element={<${component}`);
    }
    expect(Object.keys(manifest.dependencies)).toEqual(
      expect.arrayContaining(['@apollo/client', 'react-redux', 'swr', 'zustand']),
    );
  });
});
