/** Verifies bounded Yarn PnP peer recovery without accepting undeclared package fallbacks. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type BuildResult, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewPnpPeerDependencyPlugin } from '../../../src/adapters/esbuild/previewPnpPeerDependencyPlugin';
import { PreviewSourceTransformer } from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';
import { createWorkspaceSourcePlugin } from '../../../src/adapters/esbuild/workspaceSourcePlugin';

describe('createPreviewPnpPeerDependencyPlugin', () => {
  /** Resolves a shared package peer only after the selected application proves ownership. */
  it('retries a declared virtual workspace peer from the application package', async () => {
    const fixture = await createPeerFixture(true);
    try {
      const result = await buildPeerFixture(fixture);

      expect(result.outputFiles?.[0]?.text).toContain('APPLICATION_PEER_VALUE');
      expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
        'restored the Yarn PnP peer "peer-package"',
      );
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Keeps a missing peer as a hard build error when the application did not declare it. */
  it('does not recover an undeclared application dependency', async () => {
    const fixture = await createPeerFixture(false);
    try {
      await expect(buildPeerFixture(fixture)).rejects.toThrow('virtual peer denied');
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Paths needed by the synthetic virtual workspace package and consuming application. */
interface PeerFixture {
  readonly applicationRoot: string;
  readonly peerPath: string;
  readonly virtualIndexPath: string;
  readonly workspaceRoot: string;
}

/** Creates physical sources plus a non-materialized Yarn-style virtual package identity. */
async function createPeerFixture(applicationDeclaresPeer: boolean): Promise<PeerFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-pnp-peer-fallback-'));
  const applicationRoot = path.join(workspaceRoot, 'projects', 'application');
  const sharedRoot = path.join(workspaceRoot, 'shared', 'common');
  const peerPath = path.join(workspaceRoot, 'installed', 'peer-package.js');
  const virtualIndexPath = path.join(
    workspaceRoot,
    '.yarn',
    '__virtual__',
    '@scope-common-virtual-1234567890',
    '1',
    'shared',
    'common',
    'src',
    'index.ts',
  );
  await Promise.all([
    mkdir(applicationRoot, { recursive: true }),
    mkdir(path.join(sharedRoot, 'src'), { recursive: true }),
    mkdir(path.dirname(peerPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(applicationRoot, 'package.json'),
      JSON.stringify({
        dependencies: applicationDeclaresPeer ? { 'peer-package': '1.0.0' } : {},
        name: 'application',
      }),
      'utf8',
    ),
    writeFile(
      path.join(sharedRoot, 'package.json'),
      JSON.stringify({ name: '@scope/common', peerDependencies: { 'peer-package': '*' } }),
      'utf8',
    ),
    writeFile(
      path.join(sharedRoot, 'src', 'index.ts'),
      "export { value } from './PageConfig';",
      'utf8',
    ),
    writeFile(
      path.join(sharedRoot, 'src', 'PageConfig.ts'),
      "import peerValue from 'peer-package'; export const value = peerValue;",
      'utf8',
    ),
    writeFile(peerPath, "export default 'APPLICATION_PEER_VALUE';", 'utf8'),
  ]);
  return { applicationRoot, peerPath, virtualIndexPath, workspaceRoot };
}

/** Bundles the virtual package with normal preview plugins and a deterministic PnP stand-in. */
async function buildPeerFixture(fixture: PeerFixture): Promise<BuildResult> {
  return build({
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      createPreviewPnpPeerDependencyPlugin({
        projectRoot: fixture.applicationRoot,
        workspaceRoot: fixture.workspaceRoot,
      }),
      createSyntheticPnpResolver(fixture.virtualIndexPath, fixture.peerPath),
      createWorkspaceSourcePlugin({
        snapshots: [],
        transformer: new PreviewSourceTransformer({
          projectRoot: fixture.applicationRoot,
          workspaceRoot: fixture.workspaceRoot,
        }),
        workspaceRoot: fixture.workspaceRoot,
      }),
    ],
    stdin: {
      contents: "import { value } from '@scope/common'; console.log(value);",
      loader: 'ts',
      resolveDir: fixture.applicationRoot,
    },
    write: false,
  });
}

/** Reproduces esbuild rejecting a virtual peer while allowing the same app-owned package. */
function createSyntheticPnpResolver(virtualIndexPath: string, peerPath: string): Plugin {
  return {
    name: 'test-synthetic-pnp-peer-resolver',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^@scope\/common$/ }, () => ({ path: virtualIndexPath }));
      buildContext.onResolve({ filter: /^peer-package$/ }, (arguments_) =>
        path.basename(arguments_.importer) === '__react_preview_peer_issuer__.js'
          ? { path: peerPath }
          : { errors: [{ text: `virtual peer denied for ${arguments_.importer}` }] },
      );
    },
  };
}
