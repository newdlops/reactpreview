/**
 * Restores application-owned peer dependency bindings for Yarn PnP virtual workspace packages.
 * Source transforms sometimes need to read a virtual package through its physical files; when
 * esbuild subsequently forgets that virtual locator, a valid peer can be reported as undeclared.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const BARE_PACKAGE_PATTERN = /^(@[^/]+\/[^/]+|[^./][^/]*)/;
const PACKAGE_MANIFEST_NAME = 'package.json';

/** Minimal package metadata needed to prove that a PnP peer retry is legitimate. */
interface PreviewPackageManifest {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

/** Trusted application and workspace boundaries used by the peer resolver. */
export interface PreviewPnpPeerDependencyPluginOptions {
  /** Nearest application package that owns the selected React target. */
  readonly projectRoot: string;
  /** Workspace boundary containing application and virtual workspace packages. */
  readonly workspaceRoot: string;
}

/**
 * Creates a resolver that retries a proven workspace peer from the selected application package.
 * The fallback never invents a module: both manifests must declare the package and esbuild must
 * resolve its exact installed implementation through the application's normal Yarn PnP graph.
 */
export function createPreviewPnpPeerDependencyPlugin(
  options: PreviewPnpPeerDependencyPluginOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const projectManifestPromise = readPackageManifest(path.join(projectRoot, PACKAGE_MANIFEST_NAME));
  const manifestByDirectory = new Map<string, Promise<PreviewPackageManifest | undefined>>();
  const warnedPackages = new Set<string>();

  return {
    name: 'react-preview-pnp-peer-dependency',
    setup(build): void {
      /** Preserves normal resolution first and retries only a manifest-proven missing peer. */
      async function resolvePeerDependency(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (!isEligibleVirtualPeerRequest(arguments_, workspaceRoot)) return undefined;
        const packageName = readBarePackageName(arguments_.path);
        const physicalImporter = resolvePreviewYarnVirtualPath(arguments_.importer, workspaceRoot);
        if (packageName === undefined || physicalImporter === undefined) return undefined;

        const [ownerManifest, projectManifest] = await Promise.all([
          findNearestPackageManifest(
            path.dirname(physicalImporter),
            workspaceRoot,
            manifestByDirectory,
          ),
          projectManifestPromise,
        ]);
        if (
          !hasDependency(ownerManifest?.peerDependencies, packageName) ||
          !doesApplicationProvideDependency(projectManifest, packageName)
        ) {
          return undefined;
        }

        const normalResolution = await resolveWithImporter(build, arguments_, arguments_.importer);
        if ((normalResolution.errors?.length ?? 0) === 0) return normalResolution;

        const applicationIssuer = path.join(projectRoot, '__react_preview_peer_issuer__.js');
        const applicationResolution = await resolveWithImporter(
          build,
          arguments_,
          applicationIssuer,
        );
        if ((applicationResolution.errors?.length ?? 0) > 0 || applicationResolution.external) {
          return normalResolution;
        }

        const warningKey = `${packageName}\0${path.dirname(physicalImporter)}`;
        const includeWarning = !warnedPackages.has(warningKey);
        warnedPackages.add(warningKey);
        return {
          ...applicationResolution,
          warnings: [
            ...(applicationResolution.warnings ?? []),
            ...(includeWarning
              ? [
                  {
                    text:
                      `React Preview restored the Yarn PnP peer "${packageName}" ` +
                      `from application package ${formatWorkspacePath(projectRoot, workspaceRoot)}.`,
                  },
                ]
              : []),
          ],
        };
      }

      build.onResolve({ filter: BARE_PACKAGE_PATTERN }, resolvePeerDependency);
    },
  };
}

/** Delegates to esbuild while preventing this resolver from recursively handling its own retry. */
async function resolveWithImporter(
  build: Parameters<Plugin['setup']>[0],
  arguments_: OnResolveArgs,
  importer: string,
): Promise<OnResolveResult> {
  return build.resolve(arguments_.path, {
    importer,
    kind: arguments_.kind,
    namespace: 'file',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: path.dirname(importer),
    with: arguments_.with,
  });
}

/** Rejects ordinary modules, virtual preview namespaces, and recursive resolver calls cheaply. */
function isEligibleVirtualPeerRequest(arguments_: OnResolveArgs, workspaceRoot: string): boolean {
  if (
    arguments_.namespace !== 'file' ||
    (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
    !path.isAbsolute(arguments_.importer) ||
    arguments_.path.startsWith('.') ||
    path.isAbsolute(arguments_.path)
  ) {
    return false;
  }
  const physicalImporter = resolvePreviewYarnVirtualPath(arguments_.importer, workspaceRoot);
  return (
    physicalImporter !== undefined &&
    canonicalizeExistingPath(physicalImporter) !== canonicalizeExistingPath(arguments_.importer)
  );
}

/** Extracts an npm package identity while preserving subpath requests for actual resolution. */
function readBarePackageName(moduleSpecifier: string): string | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
  if (cleanSpecifier === undefined || cleanSpecifier.length === 0) return undefined;
  const segments = cleanSpecifier.split('/');
  if (cleanSpecifier.startsWith('@')) {
    return segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined;
  }
  return segments[0];
}

/** Locates the physical workspace package that declared the peer consumer contract. */
async function findNearestPackageManifest(
  startDirectory: string,
  workspaceRoot: string,
  cache: Map<string, Promise<PreviewPackageManifest | undefined>>,
): Promise<PreviewPackageManifest | undefined> {
  let directory = canonicalizeExistingPath(startDirectory);
  while (isPathInside(workspaceRoot, directory)) {
    const manifestPath = path.join(directory, PACKAGE_MANIFEST_NAME);
    let manifestPromise = cache.get(manifestPath);
    if (manifestPromise === undefined) {
      manifestPromise = readPackageManifest(manifestPath);
      cache.set(manifestPath, manifestPromise);
    }
    const manifest = await manifestPromise;
    if (manifest !== undefined) return manifest;
    if (directory === workspaceRoot) break;
    directory = path.dirname(directory);
  }
  return undefined;
}

/** Reads untrusted project JSON as data and returns only object-shaped dependency metadata. */
async function readPackageManifest(
  manifestPath: string,
): Promise<PreviewPackageManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Reports whether a dependency map owns an exact package key. */
function hasDependency(
  dependencies: Readonly<Record<string, unknown>> | undefined,
  packageName: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(dependencies ?? {}, packageName);
}

/** Allows production, development, optional, or peer bindings explicitly owned by the app. */
function doesApplicationProvideDependency(
  manifest: PreviewPackageManifest | undefined,
  packageName: string,
): boolean {
  return (
    hasDependency(manifest?.dependencies, packageName) ||
    hasDependency(manifest?.devDependencies, packageName) ||
    hasDependency(manifest?.optionalDependencies, packageName) ||
    hasDependency(manifest?.peerDependencies, packageName)
  );
}

/** Checks path containment without accepting sibling directories sharing a textual prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Produces a stable diagnostic path without revealing locations outside the selected workspace. */
function formatWorkspacePath(sourcePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, sourcePath);
  return relativePath.length === 0 ? '.' : relativePath.split(path.sep).join('/');
}
