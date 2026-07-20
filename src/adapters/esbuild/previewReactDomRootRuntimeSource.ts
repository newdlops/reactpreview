/**
 * Generates the ReactDOM imports and root adapter embedded in the browser preview entry.
 * Keeping version-specific mounting behavior here prevents the main entry generator from knowing
 * React 16/17 lifecycle details while preserving one root contract for hot reload and React 18+.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

/** Declaration packages can describe a subpath that the installed JavaScript package lacks. */
const TYPESCRIPT_DECLARATION_PATTERN = /\.d\.[cm]?ts$/iu;

/** Inert package fields used to prove the installed ReactDOM runtime's client-root capability. */
interface ReactDomRuntimeManifest {
  /** Conditional/subpath exports published by modern ReactDOM packages. */
  readonly exports?: unknown;
  /** Exact npm package identity; prevents an alias declaration package from being trusted. */
  readonly name?: unknown;
  /** Installed runtime version used when older packages omit an exports map. */
  readonly version?: unknown;
}

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
  const manifestPath = resolver.resolve('react-dom/package.json', consumerPath);
  const runtimeManifest = readReactDomRuntimeManifest(manifestPath);
  if (runtimeManifest !== undefined && manifestPath !== undefined) {
    return manifestSupportsClientRoot(runtimeManifest, manifestPath) ? 'client' : 'legacy';
  }

  const resolvedClientPath = resolver.resolve('react-dom/client', consumerPath);
  return resolvedClientPath !== undefined &&
    !TYPESCRIPT_DECLARATION_PATTERN.test(resolvedClientPath)
    ? 'client'
    : 'legacy';
}

/**
 * Reads only the nearest resolved runtime manifest without importing or evaluating package code.
 * TypeScript may independently resolve `@types/react-dom/client.d.ts`; anchoring the decision to
 * `react-dom/package.json` prevents a newer declaration package from inventing a runtime subpath.
 */
function readReactDomRuntimeManifest(
  manifestPath: string | undefined,
): ReactDomRuntimeManifest | undefined {
  if (manifestPath === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!isUnknownRecord(parsed) || parsed.name !== 'react-dom') return undefined;
    return parsed;
  } catch {
    // Unreadable transient installs fall back to a conservative implementation-path check.
    return undefined;
  }
}

/**
 * Proves client-root support from runtime-owned evidence rather than ambient type declarations.
 * ReactDOM 18 introduced the API; modern export maps and the physical `client.js` file provide
 * equivalent evidence for patched or nonstandard packages whose semantic version is unavailable.
 */
function manifestSupportsClientRoot(
  manifest: ReactDomRuntimeManifest,
  manifestPath: string,
): boolean {
  // Once a package publishes an exports map, that map is the authoritative public surface. A
  // physical client.js file or a modern-looking version cannot override an explicitly blocked
  // subpath because esbuild must obey the same package boundary when it creates the preview graph.
  if (manifest.exports !== undefined) return hasClientExport(manifest.exports);
  const majorVersion =
    typeof manifest.version === 'string'
      ? Number.parseInt(manifest.version.split('.', 1)[0] ?? '', 10)
      : Number.NaN;
  if (Number.isFinite(majorVersion) && majorVersion >= 18) return true;
  return existsSync(path.join(path.dirname(manifestPath), 'client.js'));
}

/** Recognizes an explicit non-null `./client` package export without interpreting conditions. */
function hasClientExport(exportsValue: unknown): boolean {
  return (
    isUnknownRecord(exportsValue) &&
    Object.prototype.hasOwnProperty.call(exportsValue, './client') &&
    exportsValue['./client'] !== null &&
    exportsValue['./client'] !== false
  );
}

/** Narrows inert JSON values without reading inherited package metadata. */
function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
