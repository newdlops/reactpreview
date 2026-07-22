/**
 * Verifies that compiler-level Next conventions are selected from the package that owns the
 * target, not from an unrelated dependency hoisted at a broader workspace boundary.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBundle } from '../../../src/domain/preview';

const EXTENSION_PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REACT_VERSION = '19.2.7';

describe('EsbuildPreviewCompiler Next runtime evidence', () => {
  /**
   * A workspace-level tool may hoist Next beside a framework-neutral React package. Resolving that
   * installation is not sufficient evidence to rewrite the leaf package's authored `metadata`.
   */
  it('preserves metadata for a non-Next leaf package despite a hoisted Next installation', async () => {
    const fixture = await createWorkspaceFixture(false, 'NON_NEXT_METADATA_INITIALIZER');
    const compiler = createCompiler(fixture.workspaceRoot);

    try {
      const bundle = await compileLayout(compiler, fixture);

      expect(decodeBundleJavascript(bundle)).toContain('NON_NEXT_METADATA_INITIALIZER');
    } finally {
      await compiler.shutdown();
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Import-free App Router layouts still receive server-metadata isolation when the leaf declares Next. */
  it('inerts metadata when the nearest leaf manifest explicitly declares Next', async () => {
    const fixture = await createWorkspaceFixture(true, 'DECLARED_NEXT_METADATA_INITIALIZER');
    const compiler = createCompiler(fixture.workspaceRoot);

    try {
      const bundle = await compileLayout(compiler, fixture);

      expect(decodeBundleJavascript(bundle)).not.toContain('DECLARED_NEXT_METADATA_INITIALIZER');
    } finally {
      await compiler.shutdown();
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Isolated monorepo paths and authored source shared by one compiler integration case. */
interface WorkspaceFixture {
  /** Exact target module below the nearest leaf package manifest. */
  readonly documentPath: string;
  /** Editor snapshot supplied to the compiler without rereading the target. */
  readonly sourceText: string;
  /** Trusted monorepo boundary containing both the leaf and hoisted dependency. */
  readonly workspaceRoot: string;
}

/**
 * Creates a nested React package plus a resolvable fake Next installation owned by the workspace.
 * The optional leaf declaration is the only difference that may activate Next source conventions.
 */
async function createWorkspaceFixture(
  leafDeclaresNext: boolean,
  metadataMarker: string,
): Promise<WorkspaceFixture> {
  const workspaceRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), 'react-preview-next-evidence-')),
  );
  const workspaceNodeModules = path.join(workspaceRoot, 'node_modules');
  const leafRoot = path.join(workspaceRoot, 'packages', 'leaf');
  const sourceDirectory = path.join(leafRoot, 'src', 'app');
  const documentPath = path.join(sourceDirectory, 'layout.jsx');
  const fakeNextRoot = path.join(workspaceNodeModules, 'next');
  const sourceText = [
    `export const metadata = { title: '${metadataMarker}' };`,
    'export default function RootLayout() {',
    '  return <main>{metadata.title}</main>;',
    '}',
  ].join('\n');

  await Promise.all([
    mkdir(sourceDirectory, { recursive: true }),
    mkdir(fakeNextRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({
        dependencies: { next: '1.0.0' },
        private: true,
        workspaces: ['packages/*'],
      }),
      'utf8',
    ),
    writeFile(
      path.join(leafRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          ...(leafDeclaresNext ? { next: '1.0.0' } : {}),
          react: REACT_VERSION,
          'react-dom': REACT_VERSION,
        },
        name: 'framework-neutral-leaf',
        private: true,
      }),
      'utf8',
    ),
    writeFile(
      path.join(fakeNextRoot, 'package.json'),
      JSON.stringify({ main: './index.js', name: 'next', version: '1.0.0' }),
      'utf8',
    ),
    writeFile(path.join(fakeNextRoot, 'index.js'), 'module.exports = {};', 'utf8'),
    writeFile(documentPath, sourceText, 'utf8'),
  ]);
  await Promise.all(
    ['react', 'react-dom', 'scheduler'].map(async (packageName) =>
      linkInstalledPackage(packageName, workspaceNodeModules),
    ),
  );

  return { documentPath, sourceText, workspaceRoot };
}

/** Creates a production-shaped compiler whose dependency profile reads the nearest leaf manifest. */
function createCompiler(workspaceRoot: string): EsbuildPreviewCompiler {
  return new EsbuildPreviewCompiler({
    bundledNodeModulesPath: path.join(EXTENSION_PROJECT_ROOT, 'node_modules'),
    managedDependencyStoreRoot: path.join(workspaceRoot, '.preview-global-store'),
  });
}

/** Bundles the import-free layout through the real source-transform and target-bridge pipeline. */
async function compileLayout(
  compiler: EsbuildPreviewCompiler,
  fixture: WorkspaceFixture,
): Promise<PreviewBundle> {
  return compiler.compile({
    dependencySnapshots: [],
    documentPath: fixture.documentPath,
    language: 'jsx',
    sourceText: fixture.sourceText,
    useStorybookPreview: false,
    workspaceRoot: fixture.workspaceRoot,
  });
}

/** Links a known test runtime without allowing resolution through this repository's ancestors. */
async function linkInstalledPackage(
  packageName: string,
  destinationNodeModules: string,
): Promise<void> {
  await symlink(
    path.join(EXTENSION_PROJECT_ROOT, 'node_modules', packageName),
    path.join(destinationNodeModules, packageName),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

/** Decodes the entry and lazy chunks because the selected target may be emitted outside the entry. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}
