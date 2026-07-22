/**
 * Extracts package roots from esbuild's unresolved-module diagnostics for one bounded acquisition
 * retry. Only package names already declared by the active project are admitted; strict npm aliases
 * are supported while local links, URLs, Node built-ins, typos, and plugin-private identities fail.
 */
import { builtinModules } from 'node:module';
import type { Message } from 'esbuild';
import {
  findPreviewDependencySpecifier,
  type PreviewDependencyProfile,
} from '../node/previewDependencyProfile';
import type {
  PreviewManagedDependencyEnvironment,
  PreviewManagedDependencyStore,
} from '../node/previewManagedDependencyStore';

const UNRESOLVED_PACKAGE_PATTERN = /^Could not resolve "([^"]+)"$/u;
const PACKAGE_ROOT_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const NODE_BUILTIN_NAMES = new Set(
  builtinModules.flatMap((moduleName) => {
    const normalizedName = moduleName.replace(/^node:/u, '');
    return [normalizedName, `node:${normalizedName}`];
  }),
);

/** Environment facts retained outside the main compile try block for one bounded retry. */
export interface PreviewMissingDependencyAcquisitionContext {
  readonly environment: PreviewManagedDependencyEnvironment;
  readonly projectRoot: string;
  readonly reportAcquisition?: () => void;
  readonly workspaceRoot: string;
}

/** Parameters needed to turn one build failure into a verified store acquisition attempt. */
export interface PreviewMissingDependencyAcquisitionOptions {
  readonly context: PreviewMissingDependencyAcquisitionContext | undefined;
  readonly errors: readonly Message[];
  readonly signal: AbortSignal;
  readonly store:
    Pick<PreviewManagedDependencyStore, 'acquireLockedDependencies' | 'prepare'> | undefined;
}

/**
 * Finds exact declared package roots that may be restored from the project's lockfile.
 *
 * @param messages Esbuild failures produced after normal local and managed resolution both miss.
 * @param profile Active dependency profile whose declarations bound supply-chain acquisition.
 * @returns Stable, deduplicated npm package roots suitable for one lockfile acquisition batch.
 */
export function collectPreviewMissingDependencyRequirements(
  messages: readonly Message[],
  profile: PreviewDependencyProfile | undefined,
): readonly string[] {
  if (profile?.hasReusableLockEvidence !== true) return Object.freeze([]);
  const packageNames = new Set<string>();
  for (const message of messages) {
    const match = UNRESOLVED_PACKAGE_PATTERN.exec(message.text.trim());
    const moduleSpecifier = match?.[1];
    if (moduleSpecifier === undefined || !isSafeBareSpecifier(moduleSpecifier)) continue;
    const packageName = readPackageRoot(moduleSpecifier);
    const dependencySpecifier =
      packageName === undefined ? undefined : findPreviewDependencySpecifier(profile, packageName);
    if (
      packageName === undefined ||
      NODE_BUILTIN_NAMES.has(packageName) ||
      dependencySpecifier === undefined ||
      !isRegistryDependencySpecifier(dependencySpecifier)
    ) {
      continue;
    }
    packageNames.add(packageName);
  }
  return Object.freeze([...packageNames].sort());
}

/** Acquires one declared unresolved package batch and converts unsupported/network failures to miss. */
export async function tryAcquirePreviewMissingDependencies(
  options: PreviewMissingDependencyAcquisitionOptions,
): Promise<boolean> {
  const requirements = collectPreviewMissingDependencyRequirements(
    options.errors,
    options.context?.environment.profile,
  );
  if (requirements.length === 0 || options.context === undefined || options.store === undefined) {
    return false;
  }
  options.context.reportAcquisition?.();
  try {
    const acquired = await options.store.acquireLockedDependencies({
      profile: options.context.environment.profile,
      projectRoot: options.context.projectRoot,
      requiredPackageNames: requirements,
      signal: options.signal,
    });
    if (!acquired) return false;
    const refreshedEnvironment = await options.store.prepare(
      options.context.projectRoot,
      options.context.workspaceRoot,
    );
    return refreshedEnvironment.identity !== options.context.environment.identity;
  } catch (error) {
    if (options.signal.aborted) throw error;
    return false;
  }
}

/** Admits registry ranges and strict npm aliases while rejecting every local or remote source URL. */
function isRegistryDependencySpecifier(dependencySpecifier: string): boolean {
  const normalizedSpecifier = dependencySpecifier.trim();
  if (normalizedSpecifier.startsWith('npm:')) {
    return isStrictNpmAliasSpecifier(normalizedSpecifier.slice('npm:'.length));
  }
  return isRegistryRange(normalizedSpecifier);
}

/** Requires `npm:<real-name>@<range>` so aliases cannot smuggle another package protocol. */
function isStrictNpmAliasSpecifier(aliasReference: string): boolean {
  const scopeSlash = aliasReference.startsWith('@') ? aliasReference.indexOf('/') : -1;
  const delimiterIndex = aliasReference.indexOf('@', scopeSlash >= 0 ? scopeSlash + 1 : 0);
  if (delimiterIndex <= 0) return false;
  const packageName = aliasReference.slice(0, delimiterIndex);
  const range = aliasReference.slice(delimiterIndex + 1);
  return PACKAGE_ROOT_PATTERN.test(packageName) && isRegistryRange(range);
}

/** Accepts ordinary tags and semver syntax without accepting path, protocol, or fragment syntax. */
function isRegistryRange(range: string): boolean {
  return (
    range.length > 0 &&
    range.length <= 2048 &&
    range === range.trim() &&
    !range.startsWith('.') &&
    !range.startsWith('/') &&
    !/[\\/@\0\r\n?!#]/u.test(range) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(range)
  );
}

/** Rejects every syntax that may denote source aliases, loader requests, or non-registry modules. */
function isSafeBareSpecifier(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier.length > 0 &&
    !moduleSpecifier.startsWith('.') &&
    !moduleSpecifier.startsWith('/') &&
    !moduleSpecifier.startsWith('#') &&
    !moduleSpecifier.includes('\\') &&
    !/[\0\s?!#]/u.test(moduleSpecifier) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(moduleSpecifier)
  );
}

/** Converts a package subpath to its npm root while requiring a complete scoped name. */
function readPackageRoot(moduleSpecifier: string): string | undefined {
  const segments = moduleSpecifier.split('/');
  const packageName = moduleSpecifier.startsWith('@')
    ? segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
  return packageName !== undefined && PACKAGE_ROOT_PATTERN.test(packageName)
    ? packageName
    : undefined;
}
