/** Verifies that Next document singleton JSX cannot take ownership of the preview webview DOM. */
import { describe, expect, it } from 'vitest';
import { createNextAppDocumentElementReplacements } from '../../../../src/adapters/esbuild/staticResources/previewNextAppDocumentElementIsolation';
import { applyPreviewSourceReplacements } from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';

describe('Next App document element isolation', () => {
  /** Keeps layout source coordinates while converting global singleton tags to ordinary hosts. */
  it('rewrites html, head, and body tags in a proven Next root layout', () => {
    const source = [
      'export default function RootLayout({ children }) {',
      '  return <html lang="ko"><head><title>Preview</title></head><body>{children}</body></html>;',
      '}',
    ].join('\n');
    const transformed = applyPreviewSourceReplacements(
      source,
      createNextAppDocumentElementReplacements('/workspace/apps/site/app/layout.tsx', source, true),
    );

    expect(transformed).toHaveLength(source.length);
    expect(transformed).toContain(
      '<div  lang="ko"><div ><title>Preview</title></div ><div >{children}</div ></div >',
    );
    expect(transformed).not.toMatch(/<\/?(?:html|head|body)\b/u);
  });

  /** Avoids changing ordinary email JSX, non-Next trees, custom components, and dirty source. */
  it('fails closed outside a compiler-proven Next App layout', () => {
    const source = 'export const Email = () => <html><body /></html>;';
    expect(
      createNextAppDocumentElementReplacements('/workspace/src/email.tsx', source, true),
    ).toEqual([]);
    expect(
      createNextAppDocumentElementReplacements('/workspace/app/layout.tsx', source, false),
    ).toEqual([]);
    const importedNextSource = `import type { Metadata } from 'next';\n${source}`;
    expect(
      createNextAppDocumentElementReplacements(
        '/workspace/app/layout.tsx',
        importedNextSource,
        false,
      ),
    ).not.toEqual([]);
    expect(
      createNextAppDocumentElementReplacements(
        '/workspace/app/layout.tsx',
        'export default () => <Html><Body /></Html>;',
        true,
      ),
    ).toEqual([]);
    expect(
      createNextAppDocumentElementReplacements(
        '/workspace/app/layout.tsx',
        'export default () => <html><body></html>;',
        true,
      ),
    ).toEqual([]);
  });
});
