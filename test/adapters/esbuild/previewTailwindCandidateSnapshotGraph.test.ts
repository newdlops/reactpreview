/**
 * Protects target-first Tailwind candidate discovery from regressing into a broad workspace scan.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPreviewTailwindCandidateSnapshotGraph } from '../../../src/adapters/esbuild/previewTailwindCandidateSnapshotGraph';

const ROOT = path.resolve('/workspace');
const TARGET = path.join(ROOT, 'src', 'feature', 'Target.tsx');
const BUTTON = path.join(ROOT, 'src', 'ui', 'Button.tsx');
const VARIANTS = path.join(ROOT, 'src', 'ui', 'buttonVariants.ts');
const LAYOUT = path.join(ROOT, 'src', 'app', 'layout.tsx');

describe('collectPreviewTailwindCandidateSnapshotGraph', () => {
  it('prioritizes the target forward graph before page-corridor sources', async () => {
    const sources = new Map<string, string>([
      [TARGET, `import { Button } from '../../ui/Button'; export const Target = () => <Button />;`],
      [
        BUTTON,
        `export { buttonVariants } from './buttonVariants'; export const Button = () => <button className="rounded-md" />;`,
      ],
      [VARIANTS, `export const buttonVariants = 'inline-flex items-center gap-2';`],
      [
        LAYOUT,
        `export default ({ children }) => <main className="min-h-screen">{children}</main>;`,
      ],
    ]);
    const resolutions = new Map<string, string>([
      [`${TARGET}:../../ui/Button`, BUTTON],
      [`${BUTTON}:./buttonVariants`, VARIANTS],
    ]);

    const snapshots = await collectPreviewTailwindCandidateSnapshotGraph({
      corridorPaths: [LAYOUT],
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, consumerPath) => resolutions.get(`${consumerPath}:${specifier}`),
      targetPath: TARGET,
      workspaceRoot: ROOT,
    });

    expect(snapshots.map((snapshot) => snapshot.documentPath)).toEqual([
      TARGET,
      BUTTON,
      VARIANTS,
      LAYOUT,
    ]);
    expect(snapshots.map((snapshot) => snapshot.sourceText).join('\n')).toContain('gap-2');
  });

  it('ignores type-only imports and resolved sources outside the workspace', async () => {
    const externalPath = path.resolve('/outside/Secret.tsx');
    const sources = new Map<string, string>([
      [
        TARGET,
        `import type { Secret } from 'secret'; import { External } from 'external'; export const Target = () => <div />;`,
      ],
      [externalPath, `export const External = () => <div className="should-not-leak" />;`],
    ]);

    const snapshots = await collectPreviewTailwindCandidateSnapshotGraph({
      corridorPaths: [],
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => externalPath,
      targetPath: TARGET,
      workspaceRoot: ROOT,
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.documentPath).toBe(TARGET);
  });
});
