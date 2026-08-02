/** Enforces an opt-in immutable source and approved installed-dependency resolution boundary. */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewResolutionConfinement,
} from '../../domain/preview';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  decodePreviewMetafileFileDependency,
  readPreviewMetafileNamespacePrefix,
} from './previewBuildResult';
import type { PreviewOwnedNamespaceRegistry } from './previewOwnedNamespaceRegistry';
import type { PreviewSyntheticInputRegistry } from './previewSyntheticInputRegistry';

const SHA256_PATTERN = /^[\da-f]{64}$/u;

/** Canonical, frozen confinement state used only when the caller opts in explicitly. */
export interface NormalizedPreviewResolutionConfinement extends PreviewResolutionConfinement {
  readonly approvedDependencyRoots: readonly string[];
}

/** Frozen audit state for one request-confined successful path-assertion memo. */
export interface PreviewResolutionConfinementPathMemoStatistics {
  readonly computations: number;
  readonly entries: number;
  readonly hits: number;
  readonly released: boolean;
  readonly requests: number;
}

/** Reuses only successful canonical assertions under one immutable confinement request. */
export interface PreviewResolutionConfinementPathMemo {
  readonly assert: (candidatePath: string, compute: () => string) => string;
  readonly getStatistics: () => PreviewResolutionConfinementPathMemoStatistics;
  readonly release: () => void;
}

/** Creates one exact-string memo whose successful canonical paths cannot cross request release. */
export function createPreviewResolutionConfinementPathMemo(): PreviewResolutionConfinementPathMemo {
  const canonicalPaths = new Map<string, string>();
  let computations = 0;
  let hits = 0;
  let released = false;
  let requests = 0;
  const assertActive = (): void => {
    if (released) {
      throw new Error('Preview resolution confinement path memo was already released.');
    }
  };
  return Object.freeze({
    assert(candidatePath: string, compute: () => string): string {
      assertActive();
      requests += 1;
      const retained = canonicalPaths.get(candidatePath);
      if (retained !== undefined) {
        hits += 1;
        return retained;
      }
      computations += 1;
      const canonicalPath = compute();
      canonicalPaths.set(candidatePath, canonicalPath);
      return canonicalPath;
    },
    getStatistics(): PreviewResolutionConfinementPathMemoStatistics {
      return Object.freeze({
        computations,
        entries: canonicalPaths.size,
        hits,
        released,
        requests,
      });
    },
    release(): void {
      if (released) return;
      canonicalPaths.clear();
      released = true;
    },
  });
}

/** Validates request identity fields and canonicalizes every trusted root. */
export function normalizePreviewResolutionConfinement(
  request: PreviewBuildRequest,
): NormalizedPreviewResolutionConfinement | undefined {
  const configured = request.resolutionConfinement;
  if (configured === undefined) return undefined;
  for (const [name, digest] of [
    ['source manifest', configured.sourceManifestDigest],
    ['dependency view', configured.dependencyViewDigest],
    ['policy', configured.policyDigest],
  ] as const) {
    if (!SHA256_PATTERN.test(digest)) {
      throw createConfinementError(`The ${name} digest is not a lowercase SHA-256 value.`);
    }
  }
  const sourceRoot = canonicalizeRequiredDirectory(configured.sourceRoot, 'source root');
  const dependencyRoots = configured.approvedDependencyRoots.map((root, index) =>
    canonicalizeRequiredDirectory(root, `approved dependency root ${index.toString()}`),
  );
  if (dependencyRoots.length === 0 || new Set(dependencyRoots).size !== dependencyRoots.length) {
    throw createConfinementError('Approved dependency roots must be non-empty and unique.');
  }
  if (!isPathInsideOrEqual(sourceRoot, canonicalizeExistingPath(request.workspaceRoot))) {
    throw createConfinementError(
      'The compiler workspace must remain inside the immutable source root.',
    );
  }
  for (const candidate of [
    request.documentPath,
    request.tsconfigPath,
    request.setupModulePath,
    ...request.dependencySnapshots.map((snapshot) => snapshot.documentPath),
  ]) {
    if (candidate !== undefined) {
      assertPreviewResolutionPath(
        {
          ...configured,
          approvedDependencyRoots: dependencyRoots,
          sourceRoot,
        },
        candidate,
      );
    }
  }
  return Object.freeze({
    approvedDependencyRoots: Object.freeze([...dependencyRoots].sort()),
    dependencyViewDigest: configured.dependencyViewDigest,
    policyDigest: configured.policyDigest,
    sourceManifestDigest: configured.sourceManifestDigest,
    sourceRoot,
  });
}

/** Rejects a resolved file unless its real path stays in source or an approved package root. */
export function assertPreviewResolutionPath(
  confinement: NormalizedPreviewResolutionConfinement,
  candidatePath: string,
): string {
  const cleanPath = stripImportSuffix(candidatePath);
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync.native(cleanPath);
  } catch {
    throw createConfinementError(`A confined compiler input does not exist: ${cleanPath}`);
  }
  if (
    isPathInsideOrEqual(confinement.sourceRoot, canonicalPath) ||
    confinement.approvedDependencyRoots.some((root) => isPathInsideOrEqual(root, canonicalPath))
  ) {
    return canonicalPath;
  }
  throw createConfinementError(
    `A compiler input escaped the immutable resolution roots: ${canonicalPath}`,
  );
}

/** Applies the same fail-closed check to inventory and final metafile dependency collections. */
export function assertPreviewResolutionPaths(
  confinement: NormalizedPreviewResolutionConfinement | undefined,
  candidatePaths: readonly string[],
): void {
  if (confinement === undefined) return;
  for (const candidatePath of candidatePaths) {
    assertPreviewResolutionPath(confinement, candidatePath);
  }
}

/**
 * Audits esbuild metafile identities without confusing compiler virtual payloads for disk paths.
 * Relative file identities are resolved against the exact build working directory.
 */
export function assertPreviewBuildInputIdentities(
  confinement: NormalizedPreviewResolutionConfinement | undefined,
  registry: PreviewOwnedNamespaceRegistry,
  syntheticInputRegistry: PreviewSyntheticInputRegistry,
  inputIdentities: readonly string[],
  workingDirectory: string,
): void {
  if (confinement === undefined) return;
  for (const inputIdentity of inputIdentities) {
    if (syntheticInputRegistry.owns(inputIdentity)) continue;
    const fileDependency = decodePreviewMetafileFileDependency(inputIdentity, workingDirectory);
    if (fileDependency !== undefined) {
      if (fileDependency.dependencyPath === undefined) {
        throw createConfinementError(
          `A dependency-carrying metafile namespace has an empty physical payload: ${fileDependency.namespace}`,
        );
      }
      assertPreviewResolutionPath(confinement, fileDependency.dependencyPath);
      continue;
    }
    const registered = findRegisteredVirtualInput(registry, inputIdentity);
    if (registered !== undefined) {
      if (registered.payload.length === 0) {
        throw createConfinementError(
          `A compiler-owned virtual input has an empty payload: ${registered.namespace}`,
        );
      }
      continue;
    }
    const namespacePrefix = readPreviewMetafileNamespacePrefix(inputIdentity);
    if (namespacePrefix !== undefined) {
      throw createConfinementError(
        `An unregistered compiler input namespace was observed: ${namespacePrefix}`,
      );
    }
    assertPreviewResolutionPath(
      confinement,
      path.isAbsolute(inputIdentity)
        ? inputIdentity
        : path.resolve(workingDirectory, inputIdentity),
    );
  }
}

/** Observes every esbuild load before compiler or project handlers can provide module content. */
export function createPreviewResolutionConfinementPlugin(
  confinement: NormalizedPreviewResolutionConfinement,
  registry: PreviewOwnedNamespaceRegistry,
  syntheticInputRegistry: PreviewSyntheticInputRegistry,
): Plugin {
  return {
    name: 'react-preview-resolution-confinement',
    setup(build) {
      build.onLoad({ filter: /.*/ }, (arguments_) => {
        if (arguments_.namespace === 'file') {
          assertPreviewResolutionPath(confinement, arguments_.path);
          return undefined;
        }
        const ownerPluginName = registry.ownerOf(arguments_.namespace);
        if (ownerPluginName !== undefined) {
          // Returning no content delegates to the registered owner later in the compiler plugin list.
          return undefined;
        }
        return {
          errors: [
            {
              text: `React Preview resolution confinement rejected unregistered namespace ${arguments_.namespace}.`,
            },
          ],
        };
      });
      build.onEnd((result) => {
        if (result.metafile !== undefined) {
          assertPreviewBuildInputIdentities(
            confinement,
            registry,
            syntheticInputRegistry,
            Object.keys(result.metafile.inputs),
            build.initialOptions.absWorkingDir ?? process.cwd(),
          );
        }
      });
    },
  };
}

/** Recovers one registered virtual namespace and its opaque payload. */
function findRegisteredVirtualInput(
  registry: PreviewOwnedNamespaceRegistry,
  inputIdentity: string,
): { readonly namespace: string; readonly payload: string } | undefined {
  for (const { namespace } of registry.registrations) {
    const prefix = `${namespace}:`;
    if (inputIdentity.startsWith(prefix)) {
      return { namespace, payload: inputIdentity.slice(prefix.length) };
    }
  }
  return undefined;
}

/** Returns the normalized identity persisted by campaign ledgers and reports. */
export function createPreviewResolutionConfinementIdentity(
  request: PreviewBuildRequest,
): PreviewResolutionConfinement | undefined {
  const confinement = normalizePreviewResolutionConfinement(request);
  return confinement === undefined
    ? undefined
    : Object.freeze({
        approvedDependencyRoots: confinement.approvedDependencyRoots,
        dependencyViewDigest: confinement.dependencyViewDigest,
        policyDigest: confinement.policyDigest,
        sourceManifestDigest: confinement.sourceManifestDigest,
        sourceRoot: confinement.sourceRoot,
      });
}

/** Resolves one configured directory or raises the stable confinement diagnostic. */
function canonicalizeRequiredDirectory(candidatePath: string, label: string): string {
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync.native(candidatePath);
  } catch {
    throw createConfinementError(`The configured ${label} does not exist.`);
  }
  return canonicalPath;
}

/** Removes import-only query and hash suffixes before physical path assertion. */
function stripImportSuffix(candidatePath: string): string {
  const suffixIndex = candidatePath.search(/[?#]/u);
  return path.resolve(suffixIndex < 0 ? candidatePath : candidatePath.slice(0, suffixIndex));
}

/** Reports whether one canonical candidate remains at or below a canonical root. */
function isPathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Creates the stable compiler diagnostic used by every confinement rejection. */
function createConfinementError(message: string): PreviewCompilationError {
  return new PreviewCompilationError(
    `React Preview resolution confinement rejected the build. ${message}`,
    [{ message, severity: 'error' }],
  );
}
