/**
 * Exercises the complete compiler boundary for named targets and project runtime setup conventions.
 * Temporary package roots prove setup selection, dependency tracking, Storybook reuse, and safe
 * fallback behavior without depending on another repository or starting a server.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBundle } from '../../../src/domain/preview';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler runtime setup', () => {
  /** Keeps CommonJS default interop usable for source variants accepted by the target policy. */
  it('bundles a CommonJS module.exports component target', async () => {
    const projectRoot = await createTemporaryProject('commonjs-runtime-preview-');
    const documentPath = path.join(projectRoot, 'CommonPreview.cjs');
    const sourceText =
      'module.exports = function CommonPreview() { return <main>COMMONJS_TARGET_MARKER</main>; };';

    try {
      await writeFile(documentPath, sourceText, 'utf8');
      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'jsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });

      expect(decodeBundleJavascript(bundle)).toContain('COMMONJS_TARGET_MARKER');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Bundles every named component with the conventional initialize, props, and provider hooks. */
  it('bundles named export galleries with project runtime hooks', async () => {
    const projectRoot = await createTemporaryProject('custom-runtime-preview-');
    const sourceDirectory = path.join(projectRoot, 'src');
    const setupDirectory = path.join(projectRoot, '.react-preview');
    const documentPath = path.join(sourceDirectory, 'named-preview.tsx');
    const publicIndexPath = path.join(projectRoot, 'public', 'index.html');
    const setupModulePath = path.join(setupDirectory, 'setup.tsx');
    const sourceText = [
      'export const FirstPreview = () => <p>FIRST_TARGET_MARKER</p>;',
      'export const NamedPreview = ({ label = "missing" }) => <main>{label}</main>;',
    ].join('\n');
    const dirtySetupSourceText = [
      "import type { PropsWithChildren } from 'react';",
      'export async function initializePreview() { globalThis.PROJECT_SETUP_MARKER = {}; }',
      "export const previewProps = { label: 'SETUP_PROPS_MARKER' };",
      'export function PreviewProviders({ children }: PropsWithChildren) {',
      '  return <section data-provider="SETUP_PROVIDER_MARKER">{children}</section>;',
      '}',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(setupDirectory, { recursive: true }),
        mkdir(path.join(projectRoot, 'public'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          setupModulePath,
          dirtySetupSourceText.replace('SETUP_PROPS_MARKER', 'DISK_SETUP_PROPS_MARKER'),
          'utf8',
        ),
        writeFile(
          publicIndexPath,
          '<script>window.PROJECT_CONFIG = window.PROJECT_CONFIG || {};</script>',
          'utf8',
        ),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [
          {
            documentPath: setupModulePath,
            language: 'tsx',
            sourceText: dirtySetupSourceText,
          },
        ],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('SETUP_PROPS_MARKER');
      expect(javascript).not.toContain('DISK_SETUP_PROPS_MARKER');
      expect(javascript).toContain('SETUP_PROVIDER_MARKER');
      expect(javascript).toContain('PROJECT_SETUP_MARKER');
      expect(javascript).toContain('PROJECT_CONFIG');
      expect(javascript).toContain('FIRST_TARGET_MARKER');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([documentPath, publicIndexPath, setupModulePath]),
      );
      expect(bundle.watchDirectories).toEqual(
        expect.arrayContaining([path.join(projectRoot, '.react-preview')]),
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Reuses named Storybook preview decorators without loading its main configuration. */
  it('bundles a valid Storybook preview as the automatic setup boundary', async () => {
    const projectRoot = await createTemporaryProject('storybook-runtime-preview-');
    const storybookDirectory = path.join(projectRoot, '.storybook');
    const documentPath = path.join(projectRoot, 'Preview.tsx');
    const storybookPreviewPath = path.join(storybookDirectory, 'preview.tsx');
    const sourceText = 'export default function Preview() { return <main>Target</main>; }';

    try {
      await mkdir(storybookDirectory, { recursive: true });
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          storybookPreviewPath,
          [
            'export const decorators = [',
            '  (Story) => <section data-storybook="STORYBOOK_DECORATOR_MARKER"><Story /></section>,',
            '];',
            'export const parameters = { layout: "centered" };',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          path.join(storybookDirectory, 'main.ts'),
          'export default { previewHead: () => `window.STORY_GLOBAL = window.STORY_GLOBAL || {};` };',
          'utf8',
        ),
      ]);

      const compiler = new EsbuildPreviewCompiler();
      const fastBundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        preparationMode: 'fast',
        sourceText,
        workspaceRoot: projectRoot,
      });
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(decodeBundleJavascript(fastBundle)).not.toContain('STORYBOOK_DECORATOR_MARKER');
      expect(fastBundle.dependencies).not.toContain(storybookPreviewPath);
      expect(fastBundle.chunks).toEqual([]);
      expect(javascript).toContain('STORYBOOK_DECORATOR_MARKER');
      expect(javascript).toContain('STORY_GLOBAL');
      expect(bundle.dependencies).toContain(storybookPreviewPath);
      expect(bundle.diagnostics).toEqual([]);
      await compiler.shutdown();
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Discards a broken auto-discovered Storybook graph and reports the successful setup-free retry. */
  it('falls back when an automatic Storybook preview cannot be bundled', async () => {
    const projectRoot = await createTemporaryProject('storybook-fallback-preview-');
    const storybookDirectory = path.join(projectRoot, '.storybook');
    const providerDirectory = path.join(projectRoot, 'src', 'providers');
    const documentPath = path.join(projectRoot, 'Preview.tsx');
    const storybookPreviewPath = path.join(storybookDirectory, 'preview.tsx');
    const storybookProviderPath = path.join(storybookDirectory, 'preview-provider.ts');
    const recoveredProviderPath = path.join(providerDirectory, 'missing-provider.tsx');
    const sourceText =
      'export default function Preview() { return <main>FALLBACK_TARGET_MARKER</main>; }';
    const compiler = new EsbuildPreviewCompiler();

    try {
      await Promise.all([
        mkdir(storybookDirectory, { recursive: true }),
        mkdir(providerDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          storybookPreviewPath,
          "import provider from './preview-provider'; export default { decorators: [provider] };",
          'utf8',
        ),
        writeFile(
          storybookProviderPath,
          "import missing from '../src/providers/missing-provider'; export default missing;",
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: projectRoot,
      });

      expect(decodeBundleJavascript(bundle)).toContain('FALLBACK_TARGET_MARKER');
      expect(bundle.dependencies).toContain(storybookPreviewPath);
      expect(bundle.dependencies).toContain(storybookProviderPath);
      expect(bundle.watchDirectories).toContain(providerDirectory);
      expect(bundle.diagnostics).toHaveLength(1);
      expect(bundle.diagnostics[0]?.severity).toBe('warning');
      expect(bundle.diagnostics[0]?.message).toContain(
        'Automatic Storybook preview setup was skipped',
      );
      const cachedFallbackBundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: projectRoot,
      });
      expect(cachedFallbackBundle.diagnostics).toEqual([]);

      await writeFile(
        recoveredProviderPath,
        'export default (Story) => <section>RECOVERED_STORYBOOK_PROVIDER<Story /></section>;',
        'utf8',
      );
      const recoveredBundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: projectRoot,
      });
      expect(decodeBundleJavascript(recoveredBundle)).toContain('RECOVERED_STORYBOOK_PROVIDER');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Decodes the entry and lazy chunks when an assertion targets the complete runtime graph. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}

/** Creates an isolated nearest-package boundary beneath the repository's installed React modules. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}
