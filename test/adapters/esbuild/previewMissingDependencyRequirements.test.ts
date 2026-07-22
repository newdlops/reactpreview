/** Verifies that automatic acquisition accepts only declared unresolved npm package roots. */
import type { Message } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewMissingDependencyRequirements,
  tryAcquirePreviewMissingDependencies,
} from '../../../src/adapters/esbuild/previewMissingDependencyRequirements';
import type { PreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';

const PROFILE: PreviewDependencyProfile = {
  dependencyPaths: ['/workspace/package.json', '/workspace/package-lock.json'],
  fingerprint: 'profile',
  hasReusableLockEvidence: true,
  lockfileDigests: { 'package-lock.json': 'lock' },
  lockfileEvidenceStatus: 'reusable',
  manifestPath: '/workspace/package.json',
  requirementsByField: {
    dependencies: {
      '@mui/styled-engine': 'npm:@mui/styled-engine-sc@latest',
      '@scope/widget': '2.0.0',
      'aliased-package': 'npm:real-package@1.0.0',
      'bad-alias-path': 'npm:../real-package@1.0.0',
      'bad-alias-protocol': 'npm:real-package@workspace:*',
      'local-package': 'file:../local-package',
      'react-dom': '19.2.7',
    },
    devDependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  },
  schemaVersion: 2,
};

describe('collectPreviewMissingDependencyRequirements', () => {
  /** Normalizes package subpaths and removes repeated build diagnostics. */
  it('collects declared package roots in stable order', () => {
    const result = collectPreviewMissingDependencyRequirements(
      [
        message('Could not resolve "react-dom/client"'),
        message('Could not resolve "@scope/widget/subpath"'),
        message('Could not resolve "react-dom/client"'),
      ],
      PROFILE,
    );

    expect(result).toEqual(['@scope/widget', 'react-dom']);
  });

  /** Admits only complete npm aliases, including a scoped real package and authored alias slot. */
  it('collects strict npm alias declarations', () => {
    const result = collectPreviewMissingDependencyRequirements(
      [
        message('Could not resolve "aliased-package/subpath"'),
        message('Could not resolve "@mui/styled-engine"'),
      ],
      PROFILE,
    );

    expect(result).toEqual(['@mui/styled-engine', 'aliased-package']);
  });

  /** Keeps malformed aliases, local files, built-ins, URLs, and undeclared typos off the network. */
  it('rejects every unresolved identity that lacks exact declaration evidence', () => {
    const result = collectPreviewMissingDependencyRequirements(
      [
        message('Could not resolve "./generated"'),
        message('Could not resolve "@/components/Button"'),
        message('Could not resolve "common/ui"'),
        message('Could not resolve "fs/promises"'),
        message('Could not resolve "node:path"'),
        message('Could not resolve "https://example.com/module.js"'),
        message('Could not resolve "react-dom/client?worker"'),
        message('Could not resolve "react-dmo"'),
        message('Could not resolve "bad-alias-path"'),
        message('Could not resolve "bad-alias-protocol"'),
        message('Could not resolve "local-package"'),
      ],
      PROFILE,
    );

    expect(result).toEqual([]);
  });

  /** Disables acquisition when no reusable lock evidence exists. */
  it('requires reusable lock evidence', () => {
    expect(
      collectPreviewMissingDependencyRequirements([message('Could not resolve "react-dom"')], {
        ...PROFILE,
        hasReusableLockEvidence: false,
        lockfileEvidenceStatus: 'absent',
      }),
    ).toEqual([]);
  });

  /** Preserves caller cancellation instead of replacing it with the original missing-import error. */
  it('rethrows an acquisition failure when the active preview was cancelled', async () => {
    const controller = new AbortController();
    const cancellation = new Error('preview replaced');
    const acquisition = tryAcquirePreviewMissingDependencies({
      context: {
        environment: { identity: 'before-acquisition', nodeModulesPaths: [], profile: PROFILE },
        projectRoot: '/workspace',
        workspaceRoot: '/workspace',
      },
      errors: [message('Could not resolve "react-dom/client"')],
      signal: controller.signal,
      store: {
        acquireLockedDependencies: () => {
          controller.abort(cancellation);
          return Promise.reject(cancellation);
        },
        prepare: () => Promise.reject(new Error('Cancelled acquisition must not prepare.')),
      },
    });

    await expect(acquisition).rejects.toBe(cancellation);
  });

  /** Keeps registry or unsupported-lock failures recoverable when the preview remains current. */
  it('returns a miss for a non-cancellation acquisition failure', async () => {
    await expect(
      tryAcquirePreviewMissingDependencies({
        context: {
          environment: { identity: 'before-acquisition', nodeModulesPaths: [], profile: PROFILE },
          projectRoot: '/workspace',
          workspaceRoot: '/workspace',
        },
        errors: [message('Could not resolve "react-dom/client"')],
        signal: new AbortController().signal,
        store: {
          acquireLockedDependencies: () => Promise.reject(new Error('registry unavailable')),
          prepare: () => Promise.reject(new Error('Failed acquisition must not prepare.')),
        },
      }),
    ).resolves.toBe(false);
  });

  /** Avoids an expensive rebuild when acquisition published no new resolution environment. */
  it('returns a miss when the acquired layer was already selected', async () => {
    let progressReports = 0;
    await expect(
      tryAcquirePreviewMissingDependencies({
        context: {
          environment: { identity: 'unchanged', nodeModulesPaths: [], profile: PROFILE },
          projectRoot: '/workspace',
          reportAcquisition: () => {
            progressReports += 1;
          },
          workspaceRoot: '/workspace',
        },
        errors: [message('Could not resolve "react-dom/client"')],
        signal: new AbortController().signal,
        store: {
          acquireLockedDependencies: () => Promise.resolve(true),
          prepare: () =>
            Promise.resolve({ identity: 'unchanged', nodeModulesPaths: [], profile: PROFILE }),
        },
      }),
    ).resolves.toBe(false);
    expect(progressReports).toBe(1);
  });
});

/** Creates the subset of esbuild Message used by the pure diagnostic parser. */
function message(text: string): Message {
  return {
    detail: undefined,
    id: '',
    location: null,
    notes: [],
    pluginName: '',
    text,
  };
}
