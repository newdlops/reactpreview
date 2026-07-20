/**
 * Generates the ReactDOM imports and root adapter embedded in the browser preview entry.
 * Keeping version-specific mounting behavior here prevents the main entry generator from knowing
 * React 16/17 lifecycle details while preserving one root contract for hot reload and React 18+.
 */
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

/** ReactDOM root API proven to exist in the selected project's installed runtime. */
export type PreviewReactDomRootKind = 'client' | 'legacy';

/** Immutable source fragments required to mount and unmount one generated preview entry. */
export interface PreviewReactDomRootRuntimeSource {
  /** Static ReactDOM imports placed before all generated runtime statements. */
  readonly importSource: string;
  /** Version-neutral `createPreviewRoot` implementation consumed by preview activation. */
  readonly runtimeSource: string;
}

/** Inputs that determine which ReactDOM APIs the generated entry may safely reference. */
export interface PreviewReactDomRootRuntimeSourceOptions {
  /** Whether the installed project exposes the concurrent or legacy root API. */
  readonly rootKind: PreviewReactDomRootKind;
  /** Whether Page Inspector also needs the ReactDOM namespace for portal inspection. */
  readonly requiresReactDomNamespace: boolean;
}

/**
 * Selects the root API that is actually resolvable from the current monorepo package boundary.
 * React 16/17 never shipped `react-dom/client`; probing through the same static resolver used by
 * graph discovery prevents that absent subpath from entering esbuild's generated module graph.
 *
 * @param resolver Project-configured resolver shared with static graph discovery.
 * @param consumerPath Absolute component path that determines the owning package installation.
 * @returns Client-root mode when the subpath resolves, or legacy mode otherwise.
 */
export function selectPreviewReactDomRootKind(
  resolver: Pick<PreviewStaticModuleResolver, 'resolve'>,
  consumerPath: string,
): PreviewReactDomRootKind {
  return resolver.resolve('react-dom/client', consumerPath) === undefined ? 'legacy' : 'client';
}

/**
 * Creates a single ReactDOM import plan and a version-neutral root adapter.
 * Legacy projects receive only the package root import, so an absent `react-dom/client` subpath can
 * never fail their preview build. Inspector mode reuses that namespace instead of importing it
 * twice. Client projects retain React 18's root options and add the namespace only when inspection
 * requires it.
 *
 * @param options Installed root capability and optional Inspector namespace requirement.
 * @returns Source fragments interpolated into the generated browser entry.
 */
export function createPreviewReactDomRootRuntimeSource(
  options: PreviewReactDomRootRuntimeSourceOptions,
): PreviewReactDomRootRuntimeSource {
  if (options.rootKind === 'legacy') {
    return Object.freeze({
      importSource: "import * as ReactDOMNamespace from 'react-dom';",
      runtimeSource: `
/** Adapts React 16/17's legacy renderer to the root contract shared by hot reload. */
function createPreviewRoot(container) {
  let mounted = false;
  return Object.freeze({
    render(element) {
      ReactDOMNamespace.render(element, container);
      mounted = true;
    },
    unmount() {
      if (!mounted) return;
      ReactDOMNamespace.unmountComponentAtNode(container);
      mounted = false;
    },
  });
}`,
    });
  }

  const namespaceImport = options.requiresReactDomNamespace
    ? "\nimport * as ReactDOMNamespace from 'react-dom';"
    : '';
  return Object.freeze({
    importSource:
      "import { createRoot as createPreviewClientRoot } from 'react-dom/client';" + namespaceImport,
    runtimeSource: `
/** Creates the concurrent root supplied by React 18 and newer project runtimes. */
function createPreviewRoot(container, options) {
  return createPreviewClientRoot(container, options);
}`,
  });
}
