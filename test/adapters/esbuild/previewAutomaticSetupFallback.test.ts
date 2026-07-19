/** Verifies that an obvious broken optional setup is skipped before the full native bundle. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareAutomaticPreviewSetupFallback } from '../../../src/adapters/esbuild/previewAutomaticSetupFallback';
import { PreviewSetupFailureCache } from '../../../src/adapters/esbuild/previewSetupFailureCache';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('automatic Storybook setup preflight', () => {
  /** Caches one direct missing runtime import and recovers as soon as its exact source is created. */
  it('avoids a known-doomed full build without treating comments or type imports as blockers', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/setup-preflight-'),
    );
    const storybookDirectory = path.join(workspaceRoot, '.storybook');
    const sourceDirectory = path.join(workspaceRoot, 'src');
    const setupModulePath = path.join(storybookDirectory, 'preview.tsx');
    const missingRuntimePath = path.join(sourceDirectory, 'moment.ts');
    const cache = new PreviewSetupFailureCache();
    await Promise.all([
      mkdir(storybookDirectory, { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
    ]);
    await writeFile(
      setupModulePath,
      [
        "// import ignored from '../src/commented';",
        "import type { Missing } from '../src/types';",
        "import moment from '../src/moment';",
        'export default { parameters: { moment } };',
      ].join('\n'),
      'utf8',
    );

    const prepare = (): ReturnType<typeof prepareAutomaticPreviewSetupFallback> =>
      prepareAutomaticPreviewSetupFallback({
        cache,
        dependencySnapshots: [],
        documentName: 'Preview.tsx',
        projectRoot: workspaceRoot,
        runtimeEnvironment: {
          globalNamespaces: [],
          setupKind: 'storybook',
          setupModulePath,
        },
        runtimeWatchInputs: { dependencyPaths: [], watchDirectories: [] },
        staticModuleResolver: createPreviewStaticModuleResolver({ workspaceRoot }),
        workspaceRoot,
      });

    try {
      const first = await prepare();
      expect(first.diagnostics[0]?.message).toContain('direct setup import');
      expect(first.plan?.dependencyPaths).toContain(missingRuntimePath);
      expect(first.plan?.watchDirectories).toContain(sourceDirectory);

      const cached = await prepare();
      expect(cached.plan).toBeDefined();
      expect(cached.diagnostics).toEqual([]);

      await writeFile(missingRuntimePath, 'export default "ready";', 'utf8');
      const recovered = await prepare();
      expect(recovered.plan).toBeUndefined();
      expect(recovered.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
