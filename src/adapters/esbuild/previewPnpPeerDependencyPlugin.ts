/**
 * Restores declared dependency bindings for Yarn PnP virtual workspace packages.
 * Source transforms sometimes need to read a virtual package through its physical files; when
 * esbuild subsequently mixes those identities, a valid direct dependency or peer can be reported
 * as undeclared. Recovery remains manifest-proven and never executes the PnP manifest.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';
import { collectPreviewPnpApplicationRoots } from './previewPnpApplicationRoots';
import { createPreviewWorkspacePackageResolver } from './previewWorkspacePackageResolver';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const BARE_PACKAGE_PATTERN = /^(@[^/]+\/[^/]+|[^./][^/]*)/;
const PACKAGE_MANIFEST_NAME = 'package.json';
const PREVIEW_ENTRY_NAME = '<react-preview-entry>';

/** Minimal package metadata needed to prove that a PnP peer retry is legitimate. */
interface PreviewPackageManifest {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

/** Manifest plus the physical package directory that owns the virtual importer. */
interface PreviewPackageManifestRecord {
  readonly manifest: PreviewPackageManifest;
  readonly root: string;
}

/** Trusted application and workspace boundaries used by the peer resolver. */
export interface PreviewPnpPeerDependencyPluginOptions {
  /** Page and framework-wrapper sources that may belong to a sibling consuming application. */
  readonly applicationSourcePaths?: readonly string[];
  /** Nearest application package that owns the selected React target. */
  readonly projectRoot: string;
  /** Workspace boundary containing application and virtual workspace packages. */
  readonly workspaceRoot: string;
}

/**
 * Creates a resolver that retries a proven dependency from its physical workspace package issuer.
 * Peers are retried from the selected application package because that package owns their concrete
 * version. The fallback never invents a module and still delegates final identity to esbuild/PnP.
 */
export function createPreviewPnpPeerDependencyPlugin(
  options: PreviewPnpPeerDependencyPluginOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const projectRoot = canonicalizeExistingPath(options.projectRoot);
  const workspacePackageResolver = createPreviewWorkspacePackageResolver(workspaceRoot);
  const reactDomCompanionRootsPromise = readPackageManifest(
    path.join(projectRoot, PACKAGE_MANIFEST_NAME),
  ).then((manifest) =>
    collectReactDomCompanionRoots(
      manifest,
      projectRoot,
      workspacePackageResolver.findExactDependencyProviderRoots.bind(workspacePackageResolver),
    ),
  );
  const applicationManifestsPromise = collectPreviewPnpApplicationRoots({
    projectRoot,
    sourcePaths: options.applicationSourcePaths ?? [],
    workspaceRoot,
  }).then((roots) =>
    Promise.all(
      roots.map(async (root) => ({
        manifest: await readPackageManifest(path.join(root, PACKAGE_MANIFEST_NAME)),
        root,
      })),
    ),
  );
  const manifestByDirectory = new Map<string, Promise<PreviewPackageManifestRecord | undefined>>();
  const warnedPackages = new Set<string>();

  return {
    name: 'react-preview-pnp-peer-dependency',
    setup(build): void {
      /** Preserves normal resolution first and retries only a manifest-proven missing peer. */
      async function resolvePeerDependency(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (isSyntheticReactDomCompanionRequest(arguments_, workspaceRoot)) {
          for (const providerRoot of await reactDomCompanionRootsPromise) {
            const providerIssuer = path.join(providerRoot, '__react_preview_peer_issuer__.js');
            const providerResolution = await resolveWithImporter(build, arguments_, providerIssuer);
            if ((providerResolution.errors?.length ?? 0) > 0 || providerResolution.external) {
              continue;
            }
            const warningKey = `react-dom\0${providerRoot}\0companion`;
            const includeWarning = !warnedPackages.has(warningKey);
            warnedPackages.add(warningKey);
            return {
              ...providerResolution,
              warnings: [
                ...(providerResolution.warnings ?? []),
                ...(includeWarning
                  ? [
                      {
                        text:
                          'React Preview restored the Yarn PnP React DOM companion ' +
                          `from workspace package ${formatWorkspacePath(providerRoot, workspaceRoot)}.`,
                      },
                    ]
                  : []),
              ],
            };
          }
          return undefined;
        }
        if (!isEligibleVirtualPeerRequest(arguments_, workspaceRoot)) return undefined;
        const packageName = readBarePackageName(arguments_.path);
        const physicalImporter = resolvePreviewYarnVirtualPath(arguments_.importer, workspaceRoot);
        if (packageName === undefined || physicalImporter === undefined) return undefined;

        const [ownerPackage, applicationManifests] = await Promise.all([
          findNearestPackageManifest(
            path.dirname(physicalImporter),
            workspaceRoot,
            manifestByDirectory,
          ),
          applicationManifestsPromise,
        ]);
        const ownerManifest = ownerPackage?.manifest;
        const ownerDeclaresDirectDependency = doesPackageProvideDirectDependency(
          ownerManifest,
          packageName,
        );
        const peerApplicationRoots = hasDependency(ownerManifest?.peerDependencies, packageName)
          ? applicationManifests
              .filter(
                ({ manifest, root }) =>
                  root !== ownerPackage?.root &&
                  doesApplicationProvideDependency(manifest, packageName),
              )
              .map(({ root }) => root)
          : [];
        const ownerDeclaresApplicationPeer = peerApplicationRoots.length > 0;
        if (!ownerDeclaresDirectDependency && !ownerDeclaresApplicationPeer) {
          return undefined;
        }

        const normalResolution = await resolveWithImporter(build, arguments_, arguments_.importer);
        if ((normalResolution.errors?.length ?? 0) === 0) return normalResolution;

        if (ownerDeclaresDirectDependency) {
          const physicalResolution = await resolveWithImporter(build, arguments_, physicalImporter);
          if ((physicalResolution.errors?.length ?? 0) === 0 && !physicalResolution.external) {
            const warningKey = `${packageName}\0${path.dirname(physicalImporter)}\0direct`;
            const includeWarning = !warnedPackages.has(warningKey);
            warnedPackages.add(warningKey);
            return {
              ...physicalResolution,
              warnings: [
                ...(physicalResolution.warnings ?? []),
                ...(includeWarning
                  ? [
                      {
                        text:
                          `React Preview restored the Yarn PnP dependency "${packageName}" ` +
                          `from its physical workspace package issuer.`,
                      },
                    ]
                  : []),
              ],
            };
          }
        }

        if (!ownerDeclaresApplicationPeer) return normalResolution;

        for (const applicationRoot of peerApplicationRoots) {
          const applicationIssuer = path.join(applicationRoot, '__react_preview_peer_issuer__.js');
          const applicationResolution = await resolveWithImporter(
            build,
            arguments_,
            applicationIssuer,
          );
          if ((applicationResolution.errors?.length ?? 0) > 0 || applicationResolution.external) {
            continue;
          }

          const warningKey = `${packageName}\0${path.dirname(physicalImporter)}\0${applicationRoot}`;
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
                        `from application package ${formatWorkspacePath(applicationRoot, workspaceRoot)}.`,
                    },
                  ]
                : []),
            ],
          };
        }
        return normalResolution;
      }

      build.onResolve({ filter: BARE_PACKAGE_PATTERN }, resolvePeerDependency);
    },
  };
}

/**
 * Finds a PnP issuer whose exact React and React DOM ranges match a React-only target package.
 * The same workspace lock then binds both descriptors to one concrete pair without mixing an
 * extension-owned React DOM version into the project's already installed React singleton.
 */
function collectReactDomCompanionRoots(
  projectManifest: PreviewPackageManifest | undefined,
  projectRoot: string,
  findProviderRoots: (requirements: Readonly<Record<string, string>>) => readonly string[],
): readonly string[] {
  const reactSpecifier = readDirectProductionSpecifier(projectManifest, 'react');
  if (
    reactSpecifier === undefined ||
    !isOrdinaryRegistryRange(reactSpecifier) ||
    doesApplicationProvideDependency(projectManifest, 'react-dom')
  ) {
    return Object.freeze([]);
  }
  return Object.freeze(
    findProviderRoots({ react: reactSpecifier, 'react-dom': reactSpecifier }).filter(
      (root) => root !== projectRoot,
    ),
  );
}

/** Limits companion inference to the extension-owned root import in the generated browser entry. */
function isSyntheticReactDomCompanionRequest(
  arguments_: OnResolveArgs,
  workspaceRoot: string,
): boolean {
  return (
    arguments_.namespace === 'file' &&
    (arguments_.pluginData as unknown) !== PREVIEW_RESOLVE_GUARD &&
    arguments_.path === 'react-dom' &&
    path.isAbsolute(arguments_.importer) &&
    path.basename(arguments_.importer) === PREVIEW_ENTRY_NAME &&
    canonicalizeExistingPath(path.dirname(arguments_.importer)) === workspaceRoot
  );
}

/** Reads one exact production dependency string without admitting inherited manifest properties. */
function readDirectProductionSpecifier(
  manifest: PreviewPackageManifest | undefined,
  packageName: string,
): string | undefined {
  const value = manifest?.dependencies?.[packageName];
  return Object.prototype.hasOwnProperty.call(manifest?.dependencies ?? {}, packageName) &&
    typeof value === 'string'
    ? value
    : undefined;
}

/** Rejects aliases, paths, URLs, workspace protocols, and malformed ranges for inferred pairs. */
function isOrdinaryRegistryRange(specifier: string): boolean {
  return (
    specifier.length > 0 &&
    specifier.length <= 2048 &&
    specifier === specifier.trim() &&
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !/[\\/@\0\r\n?!#]/u.test(specifier) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(specifier)
  );
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
  cache: Map<string, Promise<PreviewPackageManifestRecord | undefined>>,
): Promise<PreviewPackageManifestRecord | undefined> {
  let directory = canonicalizeExistingPath(startDirectory);
  while (isPathInside(workspaceRoot, directory)) {
    const manifestPath = path.join(directory, PACKAGE_MANIFEST_NAME);
    let manifestPromise = cache.get(manifestPath);
    if (manifestPromise === undefined) {
      manifestPromise = readPackageManifest(manifestPath).then((manifest) =>
        manifest === undefined ? undefined : { manifest, root: directory },
      );
      cache.set(manifestPath, manifestPromise);
    }
    const record = await manifestPromise;
    if (record !== undefined) return record;
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

/** Accepts only dependency kinds that the physical workspace package owns itself. */
function doesPackageProvideDirectDependency(
  manifest: PreviewPackageManifest | undefined,
  packageName: string,
): boolean {
  return (
    hasDependency(manifest?.dependencies, packageName) ||
    hasDependency(manifest?.devDependencies, packageName) ||
    hasDependency(manifest?.optionalDependencies, packageName)
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
