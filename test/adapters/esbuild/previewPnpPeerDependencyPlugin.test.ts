/** Verifies bounded Yarn PnP peer recovery without accepting undeclared package fallbacks. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type BuildResult, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewPnpPeerDependencyPlugin } from '../../../src/adapters/esbuild/previewPnpPeerDependencyPlugin';
import { createPreviewWorkspacePackageResolver } from '../../../src/adapters/esbuild/previewWorkspacePackageResolver';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';
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

  /** Recovers a direct dependency when only the transformed virtual issuer lost its locator. */
  it('retries a declared workspace dependency from the physical package issuer', async () => {
    const fixture = await createPeerFixture(false, 'direct');
    try {
      const result = await buildPeerFixture(fixture);

      expect(result.outputFiles?.[0]?.text).toContain('APPLICATION_PEER_VALUE');
      expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
        'restored the Yarn PnP dependency "peer-package"',
      );
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Uses the proven page package when the selected component belongs to a sibling workspace. */
  it('restores peers from an Inspector page candidate application', async () => {
    const fixture = await createPeerFixture(true);
    try {
      const applicationSourcePaths = [path.join(fixture.applicationRoot, 'pages', 'index.tsx')];
      const result = await buildPeerFixture(fixture, fixture.sharedRoot, applicationSourcePaths);

      expect(result.outputFiles?.[0]?.text).toContain('APPLICATION_PEER_VALUE');
      expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
        'from application package projects/application',
      );
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Restores React DOM for the generated entry from an exact React-paired workspace issuer. */
  it('restores an exact React DOM companion for a React-only Yarn PnP package', async () => {
    const fixture = await createReactDomCompanionFixture('latest');
    try {
      expect(
        createPreviewWorkspacePackageResolver(
          fixture.workspaceRoot,
        ).findExactDependencyProviderRoots({ react: 'latest', 'react-dom': 'latest' }),
      ).toEqual([canonicalizeExistingPath(fixture.applicationRoot)]);
      const result = await buildReactDomCompanionFixture(fixture);

      expect(result.outputFiles?.[0]?.text).toContain('MATCHED_REACT_DOM');
      expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
        'restored the Yarn PnP React DOM companion from workspace package projects/application',
      );
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Refuses a sibling React DOM issuer whose declarative range differs from target React. */
  it('does not infer a React DOM companion from a mismatched workspace range', async () => {
    const fixture = await createReactDomCompanionFixture('^18.0.0');
    try {
      await expect(buildReactDomCompanionFixture(fixture)).rejects.toThrow(
        'synthetic preview entry denied',
      );
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Paths needed by the synthetic virtual workspace package and consuming application. */
interface PeerFixture {
  readonly allowPhysicalDependency: boolean;
  readonly applicationRoot: string;
  readonly peerPath: string;
  readonly sharedRoot: string;
  readonly virtualIndexPath: string;
  readonly workspaceRoot: string;
}

/** Paths proving the generated preview entry may borrow one exact React DOM PnP issuer. */
interface ReactDomCompanionFixture {
  readonly applicationRoot: string;
  readonly projectRoot: string;
  readonly reactDomPath: string;
  readonly workspaceRoot: string;
}

/** Creates physical sources plus a non-materialized Yarn-style virtual package identity. */
async function createPeerFixture(
  applicationDeclaresPeer: boolean,
  ownerDependencyKind: 'direct' | 'peer' = 'peer',
): Promise<PeerFixture> {
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
      JSON.stringify({
        ...(ownerDependencyKind === 'direct'
          ? { dependencies: { 'peer-package': '1.0.0' } }
          : { peerDependencies: { 'peer-package': '*' } }),
        name: '@scope/common',
      }),
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
  return {
    allowPhysicalDependency: ownerDependencyKind === 'direct',
    applicationRoot,
    peerPath,
    sharedRoot,
    virtualIndexPath,
    workspaceRoot,
  };
}

/** Bundles the virtual package with normal preview plugins and a deterministic PnP stand-in. */
async function buildPeerFixture(
  fixture: PeerFixture,
  projectRoot = fixture.applicationRoot,
  applicationSourcePaths: readonly string[] = [],
): Promise<BuildResult> {
  return build({
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      createPreviewPnpPeerDependencyPlugin({
        applicationSourcePaths,
        projectRoot,
        workspaceRoot: fixture.workspaceRoot,
      }),
      createSyntheticPnpResolver(
        fixture.virtualIndexPath,
        fixture.peerPath,
        fixture.allowPhysicalDependency,
      ),
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

/** Creates a React-only target plus one sibling application offering a candidate React pair. */
async function createReactDomCompanionFixture(
  reactDomSpecifier: string,
): Promise<ReactDomCompanionFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-pnp-companion-'));
  const applicationRoot = path.join(workspaceRoot, 'projects', 'application');
  const projectRoot = path.join(workspaceRoot, 'plugin');
  const reactDomPath = path.join(workspaceRoot, 'installed', 'react-dom.js');
  await Promise.all([
    mkdir(applicationRoot, { recursive: true }),
    mkdir(projectRoot, { recursive: true }),
    mkdir(path.dirname(reactDomPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'workspace', private: true, workspaces: ['projects/*', 'plugin'] }),
      'utf8',
    ),
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ dependencies: { react: 'latest' }, name: 'react-only-plugin' }),
      'utf8',
    ),
    writeFile(
      path.join(applicationRoot, 'package.json'),
      JSON.stringify({
        dependencies: { react: 'latest', 'react-dom': reactDomSpecifier },
        name: 'application',
      }),
      'utf8',
    ),
    writeFile(reactDomPath, "export default 'MATCHED_REACT_DOM';", 'utf8'),
  ]);
  return { applicationRoot, projectRoot, reactDomPath, workspaceRoot };
}

/** Bundles the generated preview entry against a resolver that enforces Yarn PnP issuer ownership. */
async function buildReactDomCompanionFixture(
  fixture: ReactDomCompanionFixture,
): Promise<BuildResult> {
  return build({
    absWorkingDir: fixture.workspaceRoot,
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      createPreviewPnpPeerDependencyPlugin({
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
      }),
      createSyntheticReactDomPnpResolver(fixture.applicationRoot, fixture.reactDomPath),
    ],
    stdin: {
      contents: "import reactDom from 'react-dom'; console.log(reactDom);",
      loader: 'ts',
      resolveDir: fixture.projectRoot,
      sourcefile: path.join(fixture.workspaceRoot, '<react-preview-entry>'),
    },
    write: false,
  });
}

/** Reproduces esbuild rejecting a virtual peer while allowing the same app-owned package. */
function createSyntheticPnpResolver(
  virtualIndexPath: string,
  peerPath: string,
  allowPhysicalDependency: boolean,
): Plugin {
  return {
    name: 'test-synthetic-pnp-peer-resolver',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^@scope\/common$/ }, () => ({ path: virtualIndexPath }));
      buildContext.onResolve({ filter: /^peer-package$/ }, (arguments_) =>
        path.basename(arguments_.importer) === '__react_preview_peer_issuer__.js' ||
        (allowPhysicalDependency && !arguments_.importer.includes(`${path.sep}.yarn${path.sep}`))
          ? { path: peerPath }
          : { errors: [{ text: `virtual peer denied for ${arguments_.importer}` }] },
      );
    },
  };
}

/** Allows React DOM only when resolution is retried from the declared sibling application. */
function createSyntheticReactDomPnpResolver(applicationRoot: string, reactDomPath: string): Plugin {
  return {
    name: 'test-synthetic-react-dom-pnp-resolver',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^react-dom$/ }, (arguments_) =>
        path.basename(arguments_.importer) === '__react_preview_peer_issuer__.js' &&
        canonicalizeExistingPath(path.dirname(arguments_.importer)) ===
          canonicalizeExistingPath(applicationRoot)
          ? { path: reactDomPath }
          : {
              errors: [
                {
                  text:
                    `synthetic preview entry denied for ${arguments_.importer} ` +
                    `(namespace: ${arguments_.namespace})`,
                },
              ],
            },
      );
    },
  };
}
