/**
 * Verifies that source-authored render URLs become bounded bundle imports without scanning a public
 * directory or changing unresolved and remote browser locations.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { PreviewSourceTransformer } from '../../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('static render asset transformation', () => {
  /** Bundles public, relative, responsive, SVG-fragment, and inline-style render resources. */
  it('rewrites proven local render URLs to explicit data URL imports', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const projectRoot = path.join(workspaceRoot, 'apps', 'site');
    const publicDirectory = path.join(projectRoot, 'public');
    const sourceDirectory = path.join(projectRoot, 'src', 'cards');
    const localDirectory = path.join(projectRoot, 'src', 'media');
    const sourcePath = path.join(sourceDirectory, 'Card.tsx');
    const logoPath = path.join(publicDirectory, 'logo.png');
    const iconPath = path.join(publicDirectory, 'icons.svg');
    const posterPath = path.join(localDirectory, 'poster.webp');
    await Promise.all([
      mkdir(publicDirectory, { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(localDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(logoPath, new Uint8Array([1, 2, 3])),
      writeFile(iconPath, '<svg xmlns="http://www.w3.org/2000/svg" />', 'utf8'),
      writeFile(posterPath, new Uint8Array([4, 5, 6])),
    ]);
    const sourceText = [
      'const logoUrl = "/logo.png?cache=1";',
      'export function Card() {',
      '  return <section style={{ backgroundImage: "url(\'/logo.png\')" }}>',
      '    <img src="/logo.png" srcSet="/logo.png 1x, /logo.png 2x" />',
      '    <video poster="../media/poster.webp" />',
      '    <svg><use href="/icons.svg#mark" /></svg>',
      '    <img src={logoUrl} />',
      '    <img src="https://cdn.example.invalid/remote.png" />',
      '    <img src="/missing.png" />',
      '  </section>;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      projectRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents).toContain('from "/logo.png?url";');
    expect(transformed.contents).toContain(`${JSON.stringify(posterPath + '?url')};`);
    expect(transformed.contents).toContain('from "/icons.svg?url#mark";');
    expect(transformed.contents.match(/import __reactPreview_renderAsset_/gu)).toHaveLength(3);
    expect(transformed.contents).toContain('backgroundImage: `url("${');
    expect(transformed.contents).toContain('srcSet={[__reactPreview_renderAsset_');
    expect(transformed.contents).toContain('src={__reactPreview_renderAsset_');
    expect(transformed.contents).toContain('src="https://cdn.example.invalid/remote.png"');
    expect(transformed.contents).toContain('src="/missing.png"');
    expect(transformed.contents).not.toContain('"/logo.png?cache=1"');
  });

  /** Leaves URL-looking values unchanged when the file is outside the workspace or absent. */
  it('does not turn unproven browser paths into filesystem reads', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    await writeFile(path.join(workspaceRoot, 'secret.png'), new Uint8Array([1]));
    const sourceText = [
      'export default function Preview() {',
      '  return <><img src="/absent.png" /><img src="/../secret.png" /><a href="file:///outside/private.pdf">x</a></>;',
      '}',
    ].join('\n');
    const transformer = new PreviewSourceTransformer({
      projectRoot: workspaceRoot,
      workspaceRoot,
    });

    const transformed = await transformer.transform(sourcePath, sourceText);

    expect(transformed.contents).toBe(sourceText);
  });

  /** Exercises the complete source-transform and asset-loader path used by a ready webview bundle. */
  it('embeds a literal public image into the compiled preview artifact', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(process.cwd(), 'test', 'fixtures', 'static-render-assets-'),
    );
    temporaryRoots.push(workspaceRoot);
    const publicDirectory = path.join(workspaceRoot, 'public');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const imagePath = path.join(publicDirectory, 'logo.png');
    const sourceText =
      'export default function Preview() { return <img alt="Logo" src="/logo.png" />; }';
    await mkdir(publicDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(workspaceRoot, 'package.json'), '{"private":true}', 'utf8'),
      writeFile(sourcePath, sourceText, 'utf8'),
      writeFile(imagePath, new Uint8Array([1, 2, 3])),
    ]);

    const bundle = await new EsbuildPreviewCompiler().compile({
      dependencySnapshots: [],
      documentPath: sourcePath,
      language: 'tsx',
      sourceText,
      workspaceRoot,
    });
    const decoder = new TextDecoder();
    const javascript = [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
      .map((contents) => decoder.decode(contents))
      .join('\n');

    expect(bundle.dependencies).toContain(imagePath);
    expect(javascript.match(/data:image\/png[^"'`\s]*/gu)).toEqual(['data:image/png,%01%02%03']);
    expect(javascript).not.toContain('src: "/logo.png"');
  });
});

/** Creates and records one empty workspace directory for deterministic cleanup. */
async function createTemporaryWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-assets-'));
  temporaryRoots.push(workspaceRoot);
  return workspaceRoot;
}
