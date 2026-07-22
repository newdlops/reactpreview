/** Verifies that Next runtime activation needs package evidence rather than a coincidental path. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';
import { collectPreviewNextRuntimeEvidence } from '../../../src/adapters/esbuild/previewNextRuntimeEvidence';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('collectPreviewNextRuntimeEvidence', () => {
  /** A generic React project may legitimately use `src/app/page.tsx` as an ordinary module. */
  it('does not infer Next from App Router-looking paths alone', async () => {
    const projectRoot = await createProject({ dependencies: { react: '19.1.0' } });
    const documentPath = path.join(projectRoot, 'src', 'app', 'page.tsx');
    await writeSource(documentPath, 'export default function Page() { return <main />; }');

    const evidence = await collectPreviewNextRuntimeEvidence(
      await readPreviewDependencyProfile(projectRoot),
      projectRoot,
      { documentPath, sourceText: 'export default function Page() { return <main />; }' },
    );

    expect(evidence).toEqual({ projectRuntime: false, routeContext: false });
  });

  /** A generated next-env declaration proves route semantics without authorizing source rewrites. */
  it('uses next-env as route-only evidence for dependency-free projects', async () => {
    const projectRoot = await createProject({});
    const documentPath = path.join(projectRoot, 'app', 'page.tsx');
    await Promise.all([
      writeSource(documentPath, 'export default function Page() { return <main />; }'),
      writeFile(path.join(projectRoot, 'next-env.d.ts'), '/// <reference types="next" />', 'utf8'),
    ]);

    const evidence = await collectPreviewNextRuntimeEvidence(
      await readPreviewDependencyProfile(projectRoot),
      projectRoot,
      { documentPath, sourceText: 'export default function Page() { return <main />; }' },
    );

    expect(evidence).toEqual({ projectRuntime: false, routeContext: true });
  });

  /** A declared dependency remains sufficient even when the package has no node_modules folder. */
  it('accepts manifest declaration without an installed Next runtime', async () => {
    const projectRoot = await createProject({ dependencies: { next: '15.5.20' } });
    const documentPath = path.join(projectRoot, 'app', 'page.tsx');
    const sourceText = 'export default function Page() { return <main />; }';
    await writeSource(documentPath, sourceText);

    const evidence = await collectPreviewNextRuntimeEvidence(undefined, projectRoot, {
      documentPath,
      sourceText,
    });

    expect(evidence).toEqual({ projectRuntime: true, routeContext: true });
  });

  /** A static public Next import is exact current-file evidence even without package metadata. */
  it('accepts a parsed Next import while ignoring comments and ordinary strings', async () => {
    const projectRoot = await createProject({});
    const documentPath = path.join(projectRoot, 'src', 'preview.tsx');
    const sourceText = "import Link from 'next/link'; export default () => <Link href='/' />;";
    await writeSource(documentPath, sourceText);

    await expect(
      collectPreviewNextRuntimeEvidence(undefined, projectRoot, { documentPath, sourceText }),
    ).resolves.toEqual({ projectRuntime: true, routeContext: true });
    await expect(
      collectPreviewNextRuntimeEvidence(undefined, projectRoot, {
        documentPath,
        sourceText: "// import Link from 'next/link'\nconst note = 'next/link';",
      }),
    ).resolves.toEqual({ projectRuntime: false, routeContext: false });
  });
});

/** Creates one isolated package manifest with no installed dependencies. */
async function createProject(manifest: Record<string, unknown>): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-next-evidence-'));
  temporaryRoots.push(projectRoot);
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ private: true, ...manifest }),
    'utf8',
  );
  return projectRoot;
}

/** Writes a fixture source while preserving exact route directory spelling. */
async function writeSource(sourcePath: string, sourceText: string): Promise<void> {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
}
