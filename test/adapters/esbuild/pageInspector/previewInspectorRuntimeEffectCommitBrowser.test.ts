/** Exercises the production compiler and commit guard against real React 18/19 in Chromium. */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { discoverPreviewChromiumPath } from '../../../../src/adapters/node/previewChromiumPath';
import { renderPreviewHeadlessly } from '../../../../src/adapters/node/previewHeadlessRenderer';
import { PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import { canonicalizeExistingPath } from '../../../../src/shared/pathIdentity';
import {
  writeEffectCommitBrowserFixture,
  type EffectCommitScene,
} from './previewInspectorRuntimeEffectCommitBrowserFixtures';

const scenes: readonly EffectCommitScene[] = [
  'siblings',
  'layout-siblings',
  'insertion-siblings',
  'strict-siblings',
  'update',
  'remount',
  'growth',
  'other-root',
];
const chromiumPath = discoverPreviewChromiumPath();

describe('owned effect commits with real React', () => {
  for (const major of [18, 19] as const)
    for (const scene of scenes) {
      it.skipIf(chromiumPath === undefined)(
        `preserves ${scene} with React ${String(major)}`,
        async () => {
          // The run-scoped test root owns these files and removes them at global teardown.
          if (chromiumPath === undefined) throw new Error('Chromium became unavailable');
          const root = canonicalizeExistingPath(
            await mkdtemp(path.join(os.tmpdir(), 'react-preview-effect-commits-')),
          );
          const sourceText = await writeEffectCommitBrowserFixture(root, major, scene);
          const compiler = new EsbuildPreviewCompiler();
          try {
            const result = await renderPreviewHeadlessly(
              compiler,
              {
                workspaceRoot: root,
                documentPath: path.join(root, 'Page.tsx'),
                sourceText,
                language: 'tsx',
                dependencySnapshots: [],
                renderMode: 'page-inspector',
                preparationMode: 'fast',
              },
              { chromiumPath, remoteStylesheets: false, timeoutMs: 20_000, virtualTimeMs: 2_000 },
            );
            expect(
              result.status,
              JSON.stringify({
                protocolError: result.protocolError,
                diagnostics: result.diagnostics,
                evidence: result.evidence,
              }),
            ).toBe('ready');
            expect(result.evidence.windowErrors).toEqual([]);
            expect(result.evidence.cdpExceptions).toEqual([]);
            expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
            const expected = scene.endsWith('siblings')
              ? 40
              : PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT;
            expect(result.rootHtml).toContain(
              `<output id="executions">${String(expected)}</output>`,
            );
            const repeated = result.evidence.consoleFailures.filter((value) =>
              value.includes('repeated effect execution'),
            );
            if (scene.endsWith('siblings')) {
              expect(result.rootHtml.match(/data-sibling=/gu)).toHaveLength(40);
              expect(repeated).toEqual([]);
            } else {
              expect(repeated.length).toBeGreaterThan(0);
              if (scene === 'remount')
                expect(result.rootHtml).toContain(
                  `<output id="cleanups">${String(expected)}</output>`,
                );
            }
          } finally {
            await compiler.shutdown();
          }
        },
        40_000,
      );
    }
});
