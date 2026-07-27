import type { PluginBuild } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewMissingSourceFallbackPlugin } from '../../../src/adapters/esbuild/previewMissingSourceFallbackPlugin';

const LARGE_BARREL_NAMESPACE = 'react-preview-large-package-barrel';

/**
 * Creates the setup-only surface needed to inspect child-plugin registration without resolving or
 * loading project code. Resolver callbacks are deliberately not invoked by this policy test.
 */
function createRecordingBuild(): {
  readonly build: PluginBuild;
  readonly loadNamespaces: string[];
} {
  const loadNamespaces: string[] = [];
  const build = {
    onEnd: vi.fn(),
    onLoad: vi.fn((options: { readonly namespace?: string }) => {
      if (options.namespace !== undefined) loadNamespaces.push(options.namespace);
    }),
    onResolve: vi.fn(),
    onStart: vi.fn(),
    resolve: vi.fn(),
  } as unknown as PluginBuild;
  return { build, loadNamespaces };
}

/** Verifies selected-corridor and workspace-complete builds use distinct safe policies. */
describe('createPreviewMissingSourceFallbackPlugin', () => {
  /** Selected-corridor preparation already owns exact package-demand projection. */
  it('omits the graph-wide large-barrel optimizer from selected-corridor preparation', () => {
    const recording = createRecordingBuild();
    void createPreviewMissingSourceFallbackPlugin({
      selectedCorridorPreparation: true,
      staticModuleResolver: {
        resolve: () => undefined,
        resolveMissingPathAliasCandidate: () => undefined,
      },
      workspaceRoot: '/workspace',
    }).setup(recording.build);

    expect(recording.loadNamespaces).not.toContain(LARGE_BARREL_NAMESPACE);
  });

  /** Workspace-complete preparation retains broad projection for genuinely oversized packages. */
  it('retains the large-barrel optimizer for workspace-complete preparation', () => {
    const recording = createRecordingBuild();
    void createPreviewMissingSourceFallbackPlugin({
      selectedCorridorPreparation: false,
      staticModuleResolver: {
        resolve: () => undefined,
        resolveMissingPathAliasCandidate: () => undefined,
      },
      workspaceRoot: '/workspace',
    }).setup(recording.build);

    expect(recording.loadNamespaces).toContain(LARGE_BARREL_NAMESPACE);
  });
});
