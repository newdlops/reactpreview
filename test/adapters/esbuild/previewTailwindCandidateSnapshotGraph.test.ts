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

  it('does not spend the candidate budget on runtime imports resolved to declaration files', async () => {
    const declarationPath = path.join(ROOT, 'node_modules', 'next', 'link.d.ts');
    const sources = new Map<string, string>([
      [
        TARGET,
        `import Link from 'next/link'; export const Target = () => <Link className="md:flex" />;`,
      ],
      [declarationPath, `export default function Link(): never;`],
    ]);

    const snapshots = await collectPreviewTailwindCandidateSnapshotGraph({
      corridorPaths: [],
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => declarationPath,
      scope: 'critical',
      targetPath: TARGET,
      workspaceRoot: ROOT,
    });

    expect(snapshots.map((snapshot) => snapshot.documentPath)).toEqual([TARGET]);
  });

  it('retains responsive candidates from every exact source in a component-heavy critical corridor', async () => {
    const corridorPaths = Array.from({ length: 72 }, (_, index) =>
      path.join(ROOT, 'src', 'app', `Corridor${index.toString()}.tsx`),
    );
    const sources = new Map<string, string>([
      [TARGET, `export const Target = () => <div className="block" />;`],
      ...corridorPaths.map(
        (sourcePath, index) =>
          [
            sourcePath,
            `export const Corridor${index.toString()} = () => <div className="md:grid lg:grid-cols-${(
              (index % 4) +
              1
            ).toString()}" />;`,
          ] as const,
      ),
    ]);

    const snapshots = await collectPreviewTailwindCandidateSnapshotGraph({
      corridorPaths,
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => undefined,
      scope: 'critical',
      targetPath: TARGET,
      workspaceRoot: ROOT,
    });

    expect(snapshots).toHaveLength(corridorPaths.length + 1);
    expect(snapshots.at(-1)?.documentPath).toBe(corridorPaths.at(-1));
    expect(snapshots.at(-1)?.sourceText).toContain('md:grid');
  });

  it('follows every bounded static import from a wide component composition module', async () => {
    const importedPaths = Array.from({ length: 40 }, (_, index) =>
      path.join(ROOT, 'src', 'cards', `Card${index.toString()}.tsx`),
    );
    const targetSource = importedPaths
      .map((_, index) => `import './cards/Card${index.toString()}';`)
      .join('\n');
    const sources = new Map<string, string>([
      [TARGET, targetSource],
      ...importedPaths.map(
        (sourcePath, index) =>
          [
            sourcePath,
            `export const Card${index.toString()} = () => <div className="xl:col-span-${(
              (index % 4) +
              1
            ).toString()}" />;`,
          ] as const,
      ),
    ]);

    const snapshots = await collectPreviewTailwindCandidateSnapshotGraph({
      corridorPaths: [],
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) => {
        const match = /^\.\/cards\/Card(?<index>\d+)$/u.exec(specifier);
        return match?.groups?.index === undefined
          ? undefined
          : importedPaths[Number.parseInt(match.groups.index, 10)];
      },
      scope: 'critical',
      targetPath: TARGET,
      workspaceRoot: ROOT,
    });

    expect(snapshots).toHaveLength(importedPaths.length + 1);
    expect(snapshots.some((snapshot) => snapshot.documentPath === importedPaths.at(-1))).toBe(true);
  });
});
