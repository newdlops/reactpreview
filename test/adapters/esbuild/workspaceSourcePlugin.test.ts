/** Verifies project source loading across Yarn PnP's non-materialized virtual path identities. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { PreviewSourceTransformer } from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';
import { createWorkspaceSourcePlugin } from '../../../src/adapters/esbuild/workspaceSourcePlugin';

describe('createWorkspaceSourcePlugin', () => {
  /** Reads the real workspace source when esbuild reports its missing Yarn virtual equivalent. */
  it('loads a devirtualized PnP workspace module', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-pnp-source-'));
    const physicalPath = path.join(workspaceRoot, 'shared', 'hooks', 'src', 'index.ts');
    const virtualPath = path.join(
      workspaceRoot,
      '.yarn',
      '__virtual__',
      '@scope-hooks-virtual-49683bb2f7',
      '1',
      'shared',
      'hooks',
      'src',
      'index.ts',
    );
    try {
      await mkdir(path.dirname(physicalPath), { recursive: true });
      await writeFile(physicalPath, "export const marker = 'physical-pnp-source';", 'utf8');

      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [
          createVirtualResolutionPlugin(virtualPath),
          createWorkspaceSourcePlugin({
            snapshots: [],
            transformer: new PreviewSourceTransformer({
              projectRoot: workspaceRoot,
              workspaceRoot,
            }),
            workspaceRoot,
          }),
        ],
        stdin: {
          contents: "import { marker } from '@scope/hooks'; console.log(marker);",
          loader: 'ts',
          resolveDir: workspaceRoot,
        },
        write: false,
      });

      expect(result.outputFiles[0]?.text).toContain('physical-pnp-source');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Keeps relative children virtual so a consumer-provided peer resolves from the same PnP issuer. */
  it('preserves a virtual issuer across relative workspace imports', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-pnp-peer-'));
    const packageRoot = path.join(workspaceRoot, 'shared', 'common');
    const physicalIndex = path.join(packageRoot, 'src', 'index.ts');
    const physicalChild = path.join(packageRoot, 'src', 'PageConfig.ts');
    const virtualIndex = path.join(
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
    try {
      await mkdir(path.dirname(physicalIndex), { recursive: true });
      await Promise.all([
        writeFile(physicalIndex, "export { value } from './PageConfig';", 'utf8'),
        writeFile(
          physicalChild,
          "import peerValue from 'peer-package'; export const value = peerValue;",
          'utf8',
        ),
      ]);
      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [
          createPeerBoundVirtualResolutionPlugin(virtualIndex),
          createWorkspaceSourcePlugin({
            snapshots: [],
            transformer: new PreviewSourceTransformer({
              projectRoot: workspaceRoot,
              workspaceRoot,
            }),
            workspaceRoot,
          }),
        ],
        stdin: {
          contents: "import { value } from '@scope/common'; console.log(value);",
          loader: 'ts',
          resolveDir: workspaceRoot,
        },
        write: false,
      });

      expect(result.outputFiles[0]?.text).toContain('PEER_BOUND_VALUE');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Creates the exact synthetic file resolution shape returned by Yarn-aware module resolution. */
function createVirtualResolutionPlugin(virtualPath: string): Plugin {
  return {
    name: 'test-yarn-virtual-resolution',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^@scope\/hooks$/ }, () => ({ path: virtualPath }));
    },
  };
}

/** Requires a virtual importer before exposing a peer, reproducing Yarn's peer binding semantics. */
function createPeerBoundVirtualResolutionPlugin(virtualPath: string): Plugin {
  return {
    name: 'test-peer-bound-yarn-resolution',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^@scope\/common$/ }, () => ({ path: virtualPath }));
      buildContext.onResolve({ filter: /^peer-package$/ }, (arguments_) =>
        arguments_.importer.includes(`${path.sep}__virtual__${path.sep}`)
          ? { namespace: 'test-peer-package', path: 'peer-package' }
          : {
              errors: [
                { text: `Peer package requires its Yarn virtual issuer: ${arguments_.importer}` },
              ],
            },
      );
      buildContext.onLoad({ filter: /.*/, namespace: 'test-peer-package' }, () => ({
        contents: "export default 'PEER_BOUND_VALUE';",
        loader: 'js',
      }));
    },
  };
}
