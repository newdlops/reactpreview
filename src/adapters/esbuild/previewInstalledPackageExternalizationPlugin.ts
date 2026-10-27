/** Externalizes browser package modules while preserving workspace aliases and compiler namespaces. */
import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

export interface PreviewInstalledPackageExternalizationOptions {
  readonly documentPath: string;
  readonly staticModuleResolver: PreviewStaticModuleResolver;
}

const BARE_MODULE_SPECIFIER =
  /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/u;
const INSTANCE_BOUND_PACKAGE_NAMES = new Set([
  '@apollo/client',
  '@emotion/react',
  '@tanstack/react-query',
  'formik',
  'react',
  'react-dom',
  'react-query',
  'react-redux',
  'react-router',
  'react-router-dom',
  'styled-components',
]);
const STATIC_RENDER_BOUNDARY_SPECIFIERS = new Set(['server-only']);
const MAX_MANIFEST_DEPENDENCIES = 512;

/** Reports whether a specifier can be represented by the preview's closed browser import map. */
export function isPreviewBareModuleSpecifier(specifier: string): boolean {
  return BARE_MODULE_SPECIFIER.test(specifier);
}

/** Creates the measured package-externalization seam used by product and headless compilation. */
export function createPreviewInstalledPackageExternalizationPlugin(
  options: PreviewInstalledPackageExternalizationOptions,
): Plugin {
  const externalizationSafetyByPackageRoot = new Map<string, Promise<boolean>>();
  let sharedPeerNames: Promise<ReadonlySet<string>> | undefined;
  return {
    name: 'preview-installed-package-externalization',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (
          !isPreviewBareModuleSpecifier(args.path) ||
          STATIC_RENDER_BOUNDARY_SPECIFIERS.has(args.path) ||
          (args.pluginData as unknown) === PREVIEW_RESOLVE_GUARD
        ) {
          return undefined;
        }
        // Import maps resolve browser ESM imports only. Externalizing a CommonJS require leaves
        // esbuild's dynamic-require fallback in the generated browser chunk, so keep that package
        // subtree inside the current bundle instead. CSS imports and URL tokens likewise cannot
        // consume the document's JavaScript import map.
        if (args.kind !== 'import-statement' && args.kind !== 'dynamic-import') return undefined;
        const consumerPath = path.isAbsolute(args.importer) ? args.importer : options.documentPath;
        // Keep an installed package's dependency closure in one bundle. Splitting an internal
        // package edge can detach a peer-bound wrapper from the constructors that it re-exports
        // (for example react-query from query-core), even though each package is valid alone.
        // Application-owned imports remain eligible for the independently cached vendor seam.
        if (hasNodeModulesSegment(consumerPath)) return undefined;
        const resolved = options.staticModuleResolver.resolve(args.path, consumerPath);
        if (resolved === undefined || !hasNodeModulesSegment(resolved)) return undefined;
        // A package another dependency declares as a peer shares that dependency's instance: the
        // dependency stays in this bundle and reaches the peer from inside it, so a separate vendor
        // copy would run beside the bundled one (`@tiptap/react` and `@tiptap/pm/state` give two
        // `prosemirror-state` modules whose plugin keys collide).
        sharedPeerNames ??= readApplicationSharedPeerNames(
          options.documentPath,
          options.staticModuleResolver,
        );
        const packageName = readPackageName(args.path);
        if (packageName !== undefined && (await sharedPeerNames).has(packageName)) return undefined;
        if (
          !(await isPackageExternalizationSafe(
            args.path,
            resolved,
            externalizationSafetyByPackageRoot,
          ))
        ) {
          return undefined;
        }
        return { external: true, path: args.path };
      });
    },
  };
}

/** Uses path segments rather than substring matching so similarly named workspace folders are safe. */
function hasNodeModulesSegment(filePath: string): boolean {
  return path.normalize(filePath).split(path.sep).includes('node_modules');
}

/** Keeps provider, renderer, and peer-owned packages inside the application singleton graph. */
async function isPackageExternalizationSafe(
  specifier: string,
  resolvedPath: string,
  cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
  const packageName = readPackageName(specifier);
  if (packageName === undefined || INSTANCE_BOUND_PACKAGE_NAMES.has(packageName)) return false;
  const packageRoot = findPackageRoot(resolvedPath, packageName);
  if (packageRoot === undefined) return false;
  let pending = cache.get(packageRoot);
  if (pending === undefined) {
    pending = readPackageExternalizationSafety(packageRoot, packageName);
    cache.set(packageRoot, pending);
  }
  return pending;
}

/** Treats every peer contract as instance-sensitive at the independent vendor-bundle seam. */
async function readPackageExternalizationSafety(
  packageRoot: string,
  packageName: string,
): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    if (!isRecord(parsed) || parsed.name !== packageName) return false;
    const peerDependencies = readDependencyNames(parsed.peerDependencies);
    if (peerDependencies.length > 0) return false;
    const runtimeDependencies = [
      ...readDependencyNames(parsed.dependencies),
      ...readDependencyNames(parsed.optionalDependencies),
    ];
    return runtimeDependencies.every((name) => !INSTANCE_BOUND_PACKAGE_NAMES.has(name));
  } catch {
    return false;
  }
}

/**
 * Collects the packages that the application's own dependencies declare as peers.
 *
 * @param documentPath Previewed file; its nearest package manifest names the dependencies.
 * @param resolver Resolves each dependency the way the preview build does.
 * @returns Peer package names, empty when no manifest or peer contract is readable.
 */
async function readApplicationSharedPeerNames(
  documentPath: string,
  resolver: PreviewStaticModuleResolver,
): Promise<ReadonlySet<string>> {
  const peers = new Set<string>();
  const manifest = await readNearestPackageManifest(path.dirname(documentPath));
  if (manifest === undefined) return peers;
  const dependencyNames = new Set([
    ...readDependencyNames(manifest.dependencies),
    ...readDependencyNames(manifest.devDependencies),
    ...readDependencyNames(manifest.optionalDependencies),
  ]);
  await Promise.all(
    [...dependencyNames].slice(0, MAX_MANIFEST_DEPENDENCIES).map(async (name) => {
      const entry = resolver.resolve(name, documentPath);
      const packageRoot = entry === undefined ? undefined : findPackageRoot(entry, name);
      if (packageRoot === undefined) return;
      try {
        const parsed: unknown = JSON.parse(
          await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
        );
        if (!isRecord(parsed)) return;
        for (const peer of readDependencyNames(parsed.peerDependencies)) peers.add(peer);
      } catch {
        // An unreadable manifest adds no peer contract.
      }
    }),
  );
  return peers;
}

/** Reads the closest package manifest at or above a directory. */
async function readNearestPackageManifest(
  directory: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  let current = path.resolve(directory);
  for (;;) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(current, 'package.json'), 'utf8'),
      );
      if (isRecord(parsed)) return parsed;
    } catch {
      // Keep walking up past folders without a readable manifest.
    }
    const parent = path.dirname(current);
    if (parent === current || path.basename(current) === 'node_modules') return undefined;
    current = parent;
  }
}

/** Finds the exact installed package directory without following similarly named parent folders. */
function findPackageRoot(resolvedPath: string, packageName: string): string | undefined {
  const segments = path.normalize(resolvedPath).split(path.sep);
  const packageSegments = packageName.split('/');
  for (let index = segments.length - packageSegments.length - 1; index >= 0; index -= 1) {
    if (segments[index] !== 'node_modules') continue;
    if (
      packageSegments.every(
        (segment, packageIndex) => segments[index + packageIndex + 1] === segment,
      )
    ) {
      return segments.slice(0, index + packageSegments.length + 1).join(path.sep);
    }
  }
  return undefined;
}

/** Extracts the npm package root while retaining scoped package identity. */
function readPackageName(specifier: string): string | undefined {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
}

/** Reads only own dependency keys from inert package-manifest objects. */
function readDependencyNames(value: unknown): readonly string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

/** Narrows parsed package metadata without trusting inherited keys. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
