/**
 * Exercises the post-build portal refinement that closes gaps in reverse component analysis.
 * The fixture uses a Yarn virtual input because PnP workspace packages are the important case
 * where TypeScript-only resolution cannot enumerate the application shell's transitive modules.
 */
import path from 'node:path';
import type { Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { refinePreviewPortalHostsFromBuild } from '../../../src/adapters/esbuild/previewPortalHostBuildRefinement';

const WORKSPACE_ROOT = path.resolve('/workspace');
const TARGET_PATH = path.join(WORKSPACE_ROOT, 'projects', 'app', 'src', 'Target.tsx');
const PHYSICAL_PORTAL_PATH = path.join(
  WORKSPACE_ROOT,
  'shared',
  'ui',
  'src',
  'Portal',
  'index.tsx',
);
const VIRTUAL_PORTAL_INPUT = '.yarn/__virtual__/ui-virtual-123/1/shared/ui/src/Portal/index.tsx';
const HOST_REGISTRY_PATH = path.join(
  WORKSPACE_ROOT,
  'shared',
  'ui',
  'src',
  'Modal',
  'HostRegistry.tsx',
);

/** Creates the smallest valid esbuild metadata graph containing one virtual portal module. */
function createMetafile(additionalInputs: Metafile['inputs'] = {}): Metafile {
  return {
    inputs: {
      [path.relative(WORKSPACE_ROOT, TARGET_PATH)]: { bytes: 32, imports: [] },
      [VIRTUAL_PORTAL_INPUT]: { bytes: 512, imports: [] },
      ...additionalInputs,
    },
    outputs: {},
  };
}

/** Creates one immutable request used only to restore metafile paths to filesystem identities. */
function createRequest(): PreviewBuildRequest {
  return {
    dependencySnapshots: [],
    documentPath: TARGET_PATH,
    language: 'tsx',
    renderMode: 'page-inspector',
    sourceText: 'export const Target = () => <main />;',
    workspaceRoot: WORKSPACE_ROOT,
  };
}

describe('refinePreviewPortalHostsFromBuild', () => {
  /** Devirtualizes reached PnP inputs and requests exactly one rebuild for newly proven hosts. */
  it('discovers portal roots from the loaded build graph', async () => {
    const portalSource = `
      import ReactDOM from 'react-dom';
      export const Portal = ({ id, children }) => {
        const host = document.getElementById(id);
        return ReactDOM.createPortal(children, host);
      };
      enum PortalId { DIM = 'dim-root', TOAST = 'toast-root' }
      const roots = [PortalId.DIM, PortalId.TOAST];
      export const Hosts = () => <>{roots.map((id) => <div id={id} />)}</>;
    `;
    const refinement = await refinePreviewPortalHostsFromBuild({
      baselineHostIds: [],
      currentHostIds: [],
      metafile: createMetafile(),
      readSource: (sourcePath) =>
        Promise.resolve(
          path.normalize(sourcePath) === path.normalize(PHYSICAL_PORTAL_PATH)
            ? portalSource
            : undefined,
        ),
      request: createRequest(),
    });

    expect(refinement).toEqual({
      changed: true,
      hostIds: ['dim-root', 'toast-root'],
    });
  });

  /** Stops the adaptive pass once the generated entry already contains the exact reached IDs. */
  it('reports a stable host plan without another rebuild', async () => {
    const refinement = await refinePreviewPortalHostsFromBuild({
      baselineHostIds: ['toast-root'],
      currentHostIds: ['toast-root'],
      metafile: { inputs: {}, outputs: {} },
      readSource: () => Promise.resolve(undefined),
      request: createRequest(),
    });

    expect(refinement).toEqual({ changed: false, hostIds: ['toast-root'] });
  });

  /** Does not promote ordinary form IDs merely because a portal imports their host registry. */
  it('rejects unrelated element ids elsewhere in a large reached graph', async () => {
    const portalSource = `
      import ReactDOM from 'react-dom';
      import './HostRegistry';
      export const Portal = ({ children, host }) => ReactDOM.createPortal(children, host);
    `;
    const registrySource = `
      const fieldIds = ['statusSelect', 'conditionSelect'];
      export const HostRegistry = () => <>{fieldIds.map((id) => <label id={id} />)}</>;
    `;
    const refinement = await refinePreviewPortalHostsFromBuild({
      baselineHostIds: [],
      currentHostIds: [],
      metafile: createMetafile({
        [path.relative(WORKSPACE_ROOT, HOST_REGISTRY_PATH)]: { bytes: 256, imports: [] },
      }),
      readSource: (sourcePath) => {
        const normalizedPath = path.normalize(sourcePath);
        if (normalizedPath === path.normalize(PHYSICAL_PORTAL_PATH)) {
          return Promise.resolve(portalSource);
        }
        return Promise.resolve(
          normalizedPath === path.normalize(HOST_REGISTRY_PATH) ? registrySource : undefined,
        );
      },
      request: createRequest(),
    });

    expect(refinement).toEqual({ changed: false, hostIds: [] });
  });
});
