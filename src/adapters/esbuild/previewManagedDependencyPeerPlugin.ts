/**
 * Preserves Node peer-dependency ownership when a package is loaded from global managed storage.
 * A managed consumer's declared peer is re-issued from the active project first, preventing React,
 * router, styling, and context libraries from being duplicated across local and cached roots.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';

const BARE_PACKAGE_PATTERN = /^(@[^/]+\/[^/]+|[^./][^/]*)/;
const REACT_SINGLETON_PACKAGES = new Set(['react', 'react-dom']);

/** Immutable project and managed roots selected before the esbuild context is created. */
export interface PreviewManagedDependencyPeerPluginOptions {
  /** Managed node_modules fallbacks visible to this exact build plan. */
  readonly managedNodeModulesPaths: readonly string[];
  /** Active application package that must own project-provided peer singletons. */
  readonly projectRoot: string;
}

/** Minimal installed manifest shape used only for exact peer-name membership. */
interface ManagedPackageManifest {
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

/**
 * Creates a resolver that redirects only declared peers imported by a managed package.
 *
 * @param options Active project and immutable managed package boundaries.
 * @returns Stateless esbuild plugin with compilation-local manifest memoization.
 */
export function createPreviewManagedDependencyPeerPlugin(
  options: PreviewManagedDependencyPeerPluginOptions,
): Plugin {
  const managedRoots = [
    ...new Set(options.managedNodeModulesPaths.map((root) => canonicalizeExistingPath(root))),
  ];
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const manifestByDirectory = new Map<string, Promise<ManagedPackageManifest | undefined>>();

  return {
    name: 'react-preview-managed-dependency-peers',
    setup(build): void {
      build.onResolve({ filter: BARE_PACKAGE_PATTERN }, async (arguments_) => {
        if (
          arguments_.namespace !== 'file' ||
          (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
          !path.isAbsolute(arguments_.importer)
        ) {
          return undefined;
        }
        const managedRoot = managedRoots.find((root) => isPathInside(root, arguments_.importer));
        const packageName = readBarePackageName(arguments_.path);
        if (managedRoot === undefined || packageName === undefined) return undefined;
        const requiresProjectSingleton = REACT_SINGLETON_PACKAGES.has(packageName);
        if (
          !requiresProjectSingleton &&
          !(await hasNearestManagedPeer(
            path.dirname(arguments_.importer),
            managedRoot,
            packageName,
            manifestByDirectory,
          ))
        ) {
          return undefined;
        }

        const projectIssuer = path.join(projectRoot, '__react_preview_peer_issuer__.js');
        const resolution = await build.resolve(arguments_.path, {
          importer: projectIssuer,
          kind: arguments_.kind,
          namespace: 'file',
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: projectRoot,
          with: arguments_.with,
        });
        return selectUsableResolution(resolution);
      });
    },
  };
}

/** Finds the package manifest owning one immutable managed importer. */
async function hasNearestManagedPeer(
  startDirectory: string,
  managedRoot: string,
  packageName: string,
  cache: Map<string, Promise<ManagedPackageManifest | undefined>>,
): Promise<boolean> {
  let directoryPath = path.resolve(startDirectory);
  while (isPathInside(managedRoot, directoryPath)) {
    let manifestPromise = cache.get(directoryPath);
    if (manifestPromise === undefined) {
      manifestPromise = readManagedManifest(path.join(directoryPath, 'package.json'));
      cache.set(directoryPath, manifestPromise);
    }
    const manifest = await manifestPromise;
    if (hasOwnPeer(manifest, packageName)) return true;
    directoryPath = path.dirname(directoryPath);
  }
  return false;
}

/** Reads untrusted cached JSON as inert data and narrows only object-shaped peer maps. */
async function readManagedManifest(
  manifestPath: string,
): Promise<ManagedPackageManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const peers = 'peerDependencies' in parsed ? parsed.peerDependencies : undefined;
    return typeof peers === 'object' && peers !== null && !Array.isArray(peers)
      ? { peerDependencies: peers as Readonly<Record<string, unknown>> }
      : {};
  } catch {
    return undefined;
  }
}

/** Extracts the npm package root while retaining the original subpath for final resolution. */
function readBarePackageName(moduleSpecifier: string): string | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
  if (cleanSpecifier === undefined || cleanSpecifier.length === 0) return undefined;
  const segments = cleanSpecifier.split('/');
  return cleanSpecifier.startsWith('@')
    ? segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
}

/** Reports exact own peer declarations without trusting inherited JSON properties. */
function hasOwnPeer(manifest: ManagedPackageManifest | undefined, packageName: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest?.peerDependencies ?? {}, packageName);
}

/** Returns a successful bundled filesystem resolution and lets normal fallback handle misses. */
function selectUsableResolution(
  resolution: Awaited<ReturnType<Parameters<Plugin['setup']>[0]['resolve']>>,
): OnResolveResult | undefined {
  return resolution.errors.length === 0 && !resolution.external ? resolution : undefined;
}

/** Checks strict containment without admitting the node_modules root itself. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}
