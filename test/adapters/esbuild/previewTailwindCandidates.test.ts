/** Verifies bounded Tailwind snapshot admission before the native scanner is invoked. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewTailwindSnapshotSources,
  scanPreviewTailwindInlineCandidates,
  type PreviewTailwindScanner,
} from '../../../src/adapters/esbuild/previewTailwindCandidates';

describe('collectPreviewTailwindSnapshotSources', () => {
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
});
