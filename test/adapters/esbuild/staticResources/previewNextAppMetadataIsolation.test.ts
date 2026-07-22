/** Verifies that server-owned Next metadata cannot prevent an App Router layout preview. */
import { describe, expect, it } from 'vitest';
import { PreviewSourceTransformer } from '../../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

const WORKSPACE_ROOT = '/workspace';

/** Applies the production workspace transform so the framework façade is covered end to end. */
async function transform(
  sourcePath: string,
  sourceText: string,
  projectUsesNextRuntime = false,
): Promise<string> {
  const transformer = new PreviewSourceTransformer({
    projectRoot: WORKSPACE_ROOT,
    projectUsesNextRuntime,
    workspaceRoot: WORKSPACE_ROOT,
  });
  return (await transformer.transform(sourcePath, sourceText)).contents;
}

describe('Next App Router metadata isolation', () => {
  /** Keeps RootLayout executable and its children visible without owning the preview document. */
  it('inerts direct metadata initialization while preserving safe default layout content', async () => {
    const source = [
      `import type { Metadata } from 'next';`,
      `export const metadata: Metadata = {`,
      `  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL!),`,
      `  icon: new URL('./icon.png', import.meta.url),`,
      `  title: 'Application 🚀',`,
      `};`,
      `export default function RootLayout({ children }) {`,
      `  return <html lang="en"><body>{children}</body></html>;`,
      `}`,
    ].join('\n');

    const result = await transform('/workspace/apps/v4/app/layout.tsx', source);

    expect(result).toContain('export const metadata: Metadata = 0');
    expect(result).not.toContain('process.env.NEXT_PUBLIC_APP_URL');
    expect(result).not.toContain('./icon.png');
    expect(result).toContain('export default function RootLayout({ children })');
    expect(result).toContain('<div  lang="en"><div >{children}</div ></div >');
    expect(result.length).toBe(source.length);
    expect(result.indexOf('export default function RootLayout')).toBe(
      source.indexOf('export default function RootLayout'),
    );
  });

  /** Requires both the App Router directory and exact layout filename before editing metadata. */
  it('preserves metadata in non-layout and non-App-Router modules', async () => {
    const source = [
      `import type { Metadata } from 'next';`,
      `export const metadata: Metadata = createMetadata(process.env.PUBLIC_URL);`,
    ].join('\n');

    await expect(transform('/workspace/src/layout.tsx', source)).resolves.toBe(source);
    await expect(transform('/workspace/app/page.tsx', source)).resolves.toBe(source);
    await expect(transform('/workspace/pages/layout.tsx', source)).resolves.toBe(source);
  });

  /** Requires source-level Next evidence even when a generic project uses the same path names. */
  it('preserves metadata in a framework-neutral src app layout', async () => {
    const source = [
      `import type { Metadata } from './domain';`,
      `export const metadata: Metadata = createMetadata(process.env.PUBLIC_URL);`,
      `export default function Layout() { return <main />; }`,
    ].join('\n');

    await expect(transform('/workspace/src/app/layout.tsx', source)).resolves.toBe(source);
  });

  /** Supports JavaScript Next layouts when the compiler proves the nearest project dependency. */
  it('isolates import-free metadata only with compiler-proven runtime evidence', async () => {
    const source = [
      `export const metadata = { base: new URL(process.env.PUBLIC_URL) };`,
      `export default function RootLayout() { return <main />; }`,
    ].join('\n');
    const sourcePath = '/workspace/src/app/layout.jsx';

    await expect(transform(sourcePath, source)).resolves.toBe(source);
    const provenResult = await transform(sourcePath, source, true);
    expect(provenResult).not.toContain('process.env.PUBLIC_URL');
    expect(provenResult.indexOf('export default function RootLayout')).toBe(
      source.indexOf('export default function RootLayout'),
    );
  });

  /** Edits only an exact declaration initializer and leaves aliases and sibling bindings authored. */
  it('avoids alias and similarly named exports while preserving declaration-list siblings', async () => {
    const source = [
      `import type { Metadata } from 'next';`,
      `const candidate = createMetadata('candidate');`,
      `export { candidate as metadata };`,
      `export const metadataAlias = createMetadata('alias');`,
      `export const metadata = createMetadata('server'), viewport = createViewport();`,
      `export default function RootLayout() { return <main />; }`,
    ].join('\n');

    const result = await transform('/workspace/src/app/(account)/layout.tsx', source);

    expect(result).toContain(`const candidate = createMetadata('candidate');`);
    expect(result).toContain('export { candidate as metadata };');
    expect(result).toContain(`export const metadataAlias = createMetadata('alias');`);
    expect(result).toMatch(/export const metadata = 0\s*, viewport = createViewport\(\);/u);
    expect(result).not.toContain(`createMetadata('server')`);
    expect(result).toContain('export default function RootLayout() { return <main />; }');
  });

  /** Does not reinterpret aliases as the direct Next convention when no exact export exists. */
  it('leaves alias-only metadata exports untouched', async () => {
    const source = [
      `import type { Metadata } from 'next';`,
      `const value = new URL(process.env.NEXT_PUBLIC_APP_URL);`,
      `export { value as metadata };`,
      `export default function RootLayout() { return <main />; }`,
    ].join('\n');

    await expect(transform('/workspace/app/layout.tsx', source)).resolves.toBe(source);
  });
});
