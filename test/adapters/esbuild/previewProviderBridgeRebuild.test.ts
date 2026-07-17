/** Verifies that persistent provider bridge plugins re-probe project packages on every rebuild. */
import type { OnResolveArgs, Plugin, PluginBuild } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewApolloBridgePlugin } from '../../../src/adapters/esbuild/previewApolloBridgePlugin';
import { createPreviewContextBridgePlugin } from '../../../src/adapters/esbuild/previewContextBridgePlugin';
import { createPreviewFormikBridgePlugin } from '../../../src/adapters/esbuild/previewFormikBridgePlugin';
import { createPreviewReduxBridgePlugin } from '../../../src/adapters/esbuild/previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';
import { createPreviewThemeBridgePlugin } from '../../../src/adapters/esbuild/previewThemeBridgePlugin';

const PROJECT_ROOT = '/workspace/package';

/** One provider bridge and the private specifier imported by the generated preview entry. */
interface ProviderBridgeFixture {
  readonly createPlugin: () => Plugin;
  readonly label: string;
  readonly specifier: string;
}

/** Exact callback contracts registered through esbuild's plugin setup API. */
type PreviewOnResolveCallback = Parameters<PluginBuild['onResolve']>[1];
type PreviewOnStartCallback = Parameters<PluginBuild['onStart']>[0];

const FIXTURES: readonly ProviderBridgeFixture[] = [
  {
    createPlugin: () => createPreviewApolloBridgePlugin({ projectRoot: PROJECT_ROOT }),
    label: 'Apollo',
    specifier: 'react-preview:apollo',
  },
  {
    createPlugin: () => createPreviewContextBridgePlugin({ projectRoot: PROJECT_ROOT }),
    label: 'Context',
    specifier: 'react-preview:context',
  },
  {
    createPlugin: () => createPreviewFormikBridgePlugin({ projectRoot: PROJECT_ROOT }),
    label: 'Formik',
    specifier: 'react-preview:formik',
  },
  {
    createPlugin: () => createPreviewReduxBridgePlugin({ projectRoot: PROJECT_ROOT }),
    label: 'Redux',
    specifier: 'react-preview:redux',
  },
  {
    createPlugin: () =>
      createPreviewRouterBridgePlugin({ enabled: true, projectRoot: PROJECT_ROOT }),
    label: 'Router',
    specifier: 'react-preview:router',
  },
  {
    createPlugin: () => createPreviewThemeBridgePlugin({ projectRoot: PROJECT_ROOT }),
    label: 'Theme',
    specifier: 'react-preview:theme',
  },
];

describe('persistent preview provider bridges', () => {
  it.each(FIXTURES)('re-probes $label package resolution after onStart', async (fixture) => {
    const harness = createPluginHarness();
    await fixture.createPlugin().setup(harness.build);
    const resolver = harness.resolveCallbacks[0];
    const start = harness.startCallbacks[0];
    if (resolver === undefined || start === undefined) {
      throw new Error(`${fixture.label} bridge did not register its persistent callbacks.`);
    }

    const arguments_ = { path: fixture.specifier } as OnResolveArgs;
    await resolver(arguments_);
    const firstResolutionCount = harness.resolve.mock.calls.length;
    await resolver(arguments_);
    expect(harness.resolve).toHaveBeenCalledTimes(firstResolutionCount);

    await start();
    await resolver(arguments_);
    expect(harness.resolve.mock.calls.length).toBeGreaterThan(firstResolutionCount);
  });
});

/** Minimal plugin setup surface that records rebuild and private resolution callbacks. */
function createPluginHarness(): {
  readonly build: PluginBuild;
  readonly resolve: ReturnType<typeof vi.fn>;
  readonly resolveCallbacks: PreviewOnResolveCallback[];
  readonly startCallbacks: PreviewOnStartCallback[];
} {
  const resolveCallbacks: PreviewOnResolveCallback[] = [];
  const startCallbacks: PreviewOnStartCallback[] = [];
  const resolve = vi.fn((specifier: string) =>
    Promise.resolve({
      errors: [],
      external: false,
      namespace: 'file',
      path: `/workspace/node_modules/${specifier.replaceAll('/', '-')}/index.js`,
      sideEffects: true,
      suffix: '',
      warnings: [],
    }),
  );
  const build = {
    initialOptions: {},
    onLoad: vi.fn(),
    onResolve: vi.fn(
      (_options: Parameters<PluginBuild['onResolve']>[0], callback: PreviewOnResolveCallback) => {
        resolveCallbacks.push(callback);
      },
    ),
    onStart: vi.fn((callback: PreviewOnStartCallback) => {
      startCallbacks.push(callback);
    }),
    resolve,
  } as unknown as PluginBuild;
  return { build, resolve, resolveCallbacks, startCallbacks };
}
