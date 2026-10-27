/** Verifies bounded Tailwind snapshot admission before the native scanner is invoked. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewTailwindSnapshotSources,
  scanPreviewTailwindInlineCandidates,
  type PreviewTailwindScanner,
} from '../../../src/adapters/esbuild/previewTailwindCandidates';

describe('collectPreviewTailwindSnapshotSources', () => {
  it('keeps the early graph and the complete final corridor together under the same byte ceiling', () => {
    const root = path.resolve('/workspace');
    const snapshots = Array.from({ length: 640 }, (_, index) => ({
      documentPath: path.join(root, 'src', `Exact${index.toString()}.tsx`),
      language: 'tsx' as const,
      sourceText:
        index === 639 ? '<a className="underline underline-offset-4">Link</a>' : '<div />',
    }));
    const sources = collectPreviewTailwindSnapshotSources(snapshots, root, root);
    expect(sources).toHaveLength(640);
    expect(sources.at(-1)?.sourceText).toContain('underline underline-offset-4');
    expect(
      collectPreviewTailwindSnapshotSources(
        [
          {
            documentPath: path.join(root, 'Large.tsx'),
            language: 'tsx',
            sourceText: 'x'.repeat(4 * 1024 * 1024 + 1),
          },
        ],
        root,
        root,
      ),
    ).toEqual([]);
  });

  it('deduplicates canonical source identities before applying the file ceiling', () => {
    const workspaceRoot = path.resolve('/workspace');
    const repeatedPath = path.join(workspaceRoot, 'src', 'Repeated.tsx');
    const essentialPath = path.join(workspaceRoot, 'src', 'Essential.tsx');
    const snapshots = [
      ...Array.from({ length: 128 }, () => ({
        documentPath: repeatedPath,
        language: 'tsx' as const,
        sourceText: 'export const Repeated = () => <div className="repeat" />;',
      })),
      {
        documentPath: essentialPath,
        language: 'tsx' as const,
        sourceText: 'export const Essential = () => <div className="essential" />;',
      },
    ];

    const sources = collectPreviewTailwindSnapshotSources(snapshots, workspaceRoot, workspaceRoot);

    expect(sources).toHaveLength(2);
    expect(sources[1]?.sourceText).toContain('essential');
  });

  it('retains exact final-frontier sources beyond the initial 128-file graph', () => {
    const workspaceRoot = path.resolve('/workspace');
    const snapshots = Array.from({ length: 138 }, (_, index) => ({
      documentPath: path.join(workspaceRoot, 'src', `Candidate${index.toString()}.tsx`),
      language: 'tsx' as const,
      sourceText:
        index === 137
          ? 'export const SelectedLazyLeaf = () => <div className="flex-col max-w-lg" />;'
          : `export const Candidate${index.toString()} = () => null;`,
    }));

    const sources = collectPreviewTailwindSnapshotSources(snapshots, workspaceRoot, workspaceRoot);

    expect(sources).toHaveLength(138);
    expect(sources.at(-1)?.sourceText).toContain('flex-col max-w-lg');
  });

  /**
   * A large application shell can expose more candidates than the inline safety limit. The current
   * target is the first snapshot, so its classes must survive even when the native scanner returns
   * every candidate in lexical order.
   */
  it('retains target-first candidates ahead of a large page shell', () => {
    const decoyCandidates = Array.from(
      { length: 9_000 },
      (_, index) => `a-decoy-${index.toString().padStart(5, '0')}`,
    ).join(' ');
    /** Deterministic fake matching Oxide's globally sorted candidate behavior. */
    class LexicalScanner implements PreviewTailwindScanner {
      /** Returns every whitespace token in lexical order for one scanner invocation. */
      scanFiles(
        inputs: readonly { readonly content: string; readonly extension: string }[],
      ): readonly string[] {
        return inputs
          .flatMap((input) => input.content.split(/\s+/u))
          .filter(Boolean)
          .sort();
      }
    }

    const candidates = scanPreviewTailwindInlineCandidates(LexicalScanner, [
      { extension: 'tsx', sourceText: 'w-full' },
      { extension: 'tsx', sourceText: decoyCandidates },
    ]);

    expect(candidates).toContain('w-full');
    expect(candidates).toHaveLength(8_192);
  });

  it('retains late authored markup classes before generated type tokens spend the candidate budget', () => {
    /** Models native lexical ordering without loading or executing workspace packages. */
    class LexicalScanner implements PreviewTailwindScanner {
      /** Returns inert string tokens; the adapter still owns every count and byte limit. */
      scanFiles(
        inputs: readonly { readonly content: string; readonly extension: string }[],
      ): readonly string[] {
        return inputs
          .flatMap((input) => input.content.split(/\s+/u))
          .filter(Boolean)
          .sort();
      }
    }
    const generated = Array.from(
      { length: 9_000 },
      (_, index) => `a-type-${index.toString()}`,
    ).join(' ');
    const candidates = scanPreviewTailwindInlineCandidates(LexicalScanner, [
      { extension: 'tsx', sourceText: 'target-class' },
      { extension: 'ts', sourceText: generated },
      ...Array.from({ length: 8 }, () => ({ extension: 'ts', sourceText: 'shared-type' })),
      { extension: 'tsx', sourceText: 'text-3xl sm:text-4xl text-center text-lg' },
      { extension: 'vue', sourceText: 'vue-class' },
    ]);

    for (const name of [
      'target-class',
      'text-3xl',
      'sm:text-4xl',
      'text-center',
      'text-lg',
      'vue-class',
    ])
      expect(candidates.includes(name), name).toBe(true);
    expect(candidates).toHaveLength(8_192);
    expect(Buffer.byteLength(candidates.join(' '), 'utf8')).toBeLessThan(256 * 1024);
  });
});
