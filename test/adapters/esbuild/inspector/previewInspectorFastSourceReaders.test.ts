/** Verifies that reverse graph sampling cannot consume entry/forward first-paint capacity. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFastSourceReaders } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastSourceReaders';

const ROOT = path.resolve('/virtual/preview-project');

/** Builds a deterministic source map without allocating separate copies for repeated reads. */
function createSourceMap(): ReadonlyMap<string, string> {
  const sixMebibytes = 'r'.repeat(6 * 1024 * 1024);
  return new Map([
    [path.join(ROOT, 'reverse-large.ts'), sixMebibytes],
    [path.join(ROOT, 'reverse-overflow.ts'), 'overflow'],
    [path.join(ROOT, 'entry.tsx'), 'createRoot(root).render(<App />);'],
    [path.join(ROOT, 'app.tsx'), 'export default function App() { return null; }'],
    [path.join(ROOT, 'shared-large.ts'), 's'.repeat(3 * 1024 * 1024)],
  ]);
}

describe('createPreviewInspectorFastSourceReaders', () => {
  it('reserves entry and forward reads after reverse exhausts its own lane', async () => {
    const sourceByPath = createSourceMap();
    const readCounts = new Map<string, number>();
    const readers = createPreviewInspectorFastSourceReaders((sourcePath) => {
      readCounts.set(sourcePath, (readCounts.get(sourcePath) ?? 0) + 1);
      return Promise.resolve(sourceByPath.get(sourcePath));
    });

    expect(await readers.reverse(path.join(ROOT, 'reverse-large.ts'))).toHaveLength(
      6 * 1024 * 1024,
    );
    expect(await readers.reverse(path.join(ROOT, 'reverse-overflow.ts'))).toBeUndefined();
    expect(await readers.entry(path.join(ROOT, 'entry.tsx'))).toContain('createRoot');
    expect(await readers.forward(path.join(ROOT, 'app.tsx'))).toContain('function App');
  });

  it('shares a source admitted by one lane without charging another lane or rereading disk', async () => {
    const sourceByPath = createSourceMap();
    const sharedPath = path.join(ROOT, 'shared-large.ts');
    let reads = 0;
    const readers = createPreviewInspectorFastSourceReaders((sourcePath) => {
      reads += 1;
      return Promise.resolve(sourceByPath.get(sourcePath));
    });

    expect(await readers.forward(sharedPath)).toHaveLength(3 * 1024 * 1024);
    // The subtree lane is only 2 MiB, so this succeeds only by reusing the admitted source.
    expect(await readers.subtree(sharedPath)).toHaveLength(3 * 1024 * 1024);
    expect(reads).toBe(1);
  });
});
