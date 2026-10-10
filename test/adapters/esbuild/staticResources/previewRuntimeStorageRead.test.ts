/** Verifies that a Web Storage parse in render code joins the hook fallback boundary. */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

/** Applies non-overlapping replacements from the end so earlier offsets stay valid. */
function transform(sourcePath: string, source: string): string {
  return [...createPreviewRuntimeHookReplacements(sourcePath, source)]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, replacement) =>
        text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end),
      source,
    );
}

describe('Web Storage reads in render code', () => {
  /** A fresh preview origin stores nothing; the parsed `null` must not crash the first read. */
  it('wraps a typed storage parse with a fallback built from local reads', () => {
    const source = [
      'interface StoredSession { user: { name: string; email: string }; expiresAt: string }',
      'export default function SessionPage() {',
      "  const session = JSON.parse(localStorage.getItem('session') ?? 'null') as StoredSession;",
      '  return <h1>{session.user.name} {session.user.email} {session.expiresAt}</h1>;',
      '}',
    ].join('\n');

    const transformed = transform('/workspace/SessionPage.tsx', source);

    expect(transformed).toContain(
      ".resolveRuntimeHook(() => (JSON.parse(localStorage.getItem('session') ?? 'null'))",
    );
    expect(transformed).toContain('"hookName":"JSON.parse(localStorage.getItem(\\"session\\"))"');
    expect(transformed).toContain('"moduleSpecifier":"web-storage"');
    expect(transformed).toContain('"requiredPaths":["user.name","user.email","expiresAt"]');
    // Every storage parse calls the same JSON.parse, so no shared hook identity is passed.
    expect(transformed).toContain('() => (undefined))');
  });

  /** `window.sessionStorage` is the same storage; a module-level read is not render code. */
  it('admits global storage owners and leaves module-level and plain parses untouched', () => {
    const source = [
      "const cached = JSON.parse(localStorage.getItem('cached') ?? '{}');",
      'export function Cart({ text }: { text: string }) {',
      "  const cart = JSON.parse(window.sessionStorage.getItem('cart') || 'null');",
      '  const parsed = JSON.parse(text);',
      '  return <p>{cart.total} {parsed.label} {cached.label}</p>;',
      '}',
    ].join('\n');

    const transformed = transform('/workspace/Cart.tsx', source);

    expect(transformed).toContain('"hookName":"JSON.parse(sessionStorage.getItem(\\"cart\\"))"');
    expect(transformed).toContain("const cached = JSON.parse(localStorage.getItem('cached')");
    expect(transformed).toContain('const parsed = JSON.parse(text);');
    expect(transformed.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(1);
  });
});
