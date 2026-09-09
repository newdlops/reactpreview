/**
 * Exercises host-revision-one cold entries in real Chromium for both preview modes. The production
 * compiler and HTML must render and acknowledge startup, or report a real bootstrap failure, without
 * mistaking a nonzero revision for a speculative hot import. Only disposable fixtures are written.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import {
  renderCompiledPreviewHeadlessly,
  renderPreviewHeadlessly,
} from '../../../src/adapters/node/previewHeadlessRenderer';
import type { PreviewBuildRequest } from '../../../src/domain/preview';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('cold preview startup in Chromium', () => {
  it.each(['component', 'page-inspector'] as const)(
    'renders and reports actual startup failures in %s mode',
    async (renderMode) => {
      const fixtureRoot = await mkdtemp(path.join(PROJECT_ROOT, 'test/fixtures/cold-startup-'));
      const compiler = new EsbuildPreviewCompiler();
      try {
        const documentPath = path.join(fixtureRoot, 'Preview.tsx');
        const vendorRoot = path.join(fixtureRoot, 'node_modules/cold-startup-vendor');
        await mkdir(vendorRoot, { recursive: true });
        const sourceText = [
          'import { prefix } from "cold-startup-vendor";',
          'import { suffix } from "cold-startup-vendor/marker";',
          'export default function Preview() { return <main id="cold-startup">{prefix() + suffix()}</main>; }',
        ].join('\n');
        await Promise.all([
          writeFile(path.join(fixtureRoot, 'package.json'), '{"private":true}', 'utf8'),
          writeFile(documentPath, sourceText, 'utf8'),
          writeFile(
            path.join(vendorRoot, 'package.json'),
            '{"name":"cold-startup-vendor","type":"module","exports":{".":"./index.js","./marker":"./marker.js"}}',
            'utf8',
          ),
          writeFile(
            path.join(vendorRoot, 'shared.js'),
            'export const parts = ["COLD_STARTUP_", "RENDERED"];',
            'utf8',
          ),
          writeFile(
            path.join(vendorRoot, 'index.js'),
            'import { parts } from "./shared.js"; export function prefix() { return parts[0]; }',
            'utf8',
          ),
          writeFile(
            path.join(vendorRoot, 'marker.js'),
            'import { parts } from "./shared.js"; export function suffix() { return parts[1]; }',
            'utf8',
          ),
        ]);
        const request: PreviewBuildRequest = {
          dependencySnapshots: [],
          documentPath,
          language: 'tsx',
          renderMode,
          sourceText,
          useStorybookPreview: false,
          workspaceRoot: fixtureRoot,
        };
        const options =
          process.env.CHROMIUM_PATH === undefined
            ? {}
            : { chromiumPath: process.env.CHROMIUM_PATH };
        const bundle = await compiler.compile(request);
        expect(bundle.moduleImports?.map((item) => item.specifier)).toEqual([
          'cold-startup-vendor',
          'cold-startup-vendor/marker',
        ]);
        expect(
          bundle.chunks.filter((chunk) => chunk.relativePath.endsWith('.js')).length,
        ).toBeGreaterThanOrEqual(3);
        const ready = await renderCompiledPreviewHeadlessly(bundle, request, options);

        expect(ready.status, ready.protocolError ?? ready.timeoutDiagnostic).toBe('ready');
        expect(ready.terminal).toMatchObject({ revision: 1, type: 'react-preview-runtime-ready' });
        expect(ready.terminal?.token).toMatch(/^1:/u);
        expect(ready.rootHtml).toMatch(
          /<main\b[^>]*\bid="cold-startup"[^>]*>COLD_STARTUP_RENDERED<\/main>/u,
        );
        expect(ready.stabilization?.progressVisible).toBe(false);
        expect(ready.evidence.requiredArtifactFailures ?? []).toEqual([]);
        expect(ready.evidence.cdpExceptions ?? []).toEqual([]);
        expect(ready.evidence.windowErrors).toEqual([]);
        expect(ready.cleanup).toEqual({
          browserTerminated: true,
          profileRemoved: true,
          serverClosed: true,
        });

        const setupModulePath = path.join(fixtureRoot, 'setup.tsx');
        await writeFile(
          setupModulePath,
          "throw new Error('COLD_STARTUP_FAILURE'); export const previewProps = {};",
          'utf8',
        );
        const failed = await renderPreviewHeadlessly(
          compiler,
          { ...request, setupModulePath },
          options,
        );

        expect(failed.status, failed.protocolError ?? failed.timeoutDiagnostic).toBe('failed');
        expect(failed.terminal).toMatchObject({
          revision: 1,
          type: 'react-preview-runtime-failed',
        });
        expect(failed.terminal?.token).toMatch(/^1:/u);
        expect(failed.runtimeErrorText).toContain('COLD_STARTUP_FAILURE');
        expect(failed.rootHtml).toContain('react-preview-runtime-error');
        expect(failed.evidence.requiredArtifactFailures ?? []).toEqual([]);
        expect(failed.cleanup).toEqual({
          browserTerminated: true,
          profileRemoved: true,
          serverClosed: true,
        });

        // Repair the same setup file, then prove initialization still precedes target evaluation.
        await writeFile(
          setupModulePath,
          [
            'export async function initializePreview() {',
            '  globalThis.__coldSetupReady = false;',
            '  await Promise.resolve();',
            '  globalThis.__coldSetupReady = true;',
            '}',
          ].join('\n'),
          'utf8',
        );
        const recovered = await renderPreviewHeadlessly(
          compiler,
          {
            ...request,
            setupModulePath,
            sourceText:
              'if (globalThis.__coldSetupReady !== true) throw new Error("TARGET_BEFORE_SETUP");\n' +
              sourceText,
          },
          options,
        );
        expect(recovered.status, recovered.protocolError ?? recovered.timeoutDiagnostic).toBe(
          'ready',
        );
        expect(recovered.terminal).toMatchObject({
          revision: 1,
          type: 'react-preview-runtime-ready',
        });
        expect(recovered.rootHtml).toContain('COLD_STARTUP_RENDERED');
        expect(recovered.evidence.requiredArtifactFailures ?? []).toEqual([]);
        expect(recovered.evidence.cdpExceptions ?? []).toEqual([]);
        expect(recovered.evidence.windowErrors).toEqual([]);
        expect(recovered.stabilization?.progressVisible).toBe(false);
        expect(recovered.cleanup).toEqual({
          browserTerminated: true,
          profileRemoved: true,
          serverClosed: true,
        });
      } finally {
        await compiler.shutdown();
        await rm(fixtureRoot, { force: true, recursive: true });
      }
    },
    60_000,
  );
});
