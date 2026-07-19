/**
 * Plans a session-local, content-addressed filesystem layout for one compiled preview bundle.
 *
 * The browser entry remains at the session root because esbuild emits `./chunks/...` specifiers
 * relative to a root-level entry. Auxiliary chunk paths therefore stay unchanged, while entry and
 * aggregate stylesheet names use byte digests so unchanged files keep stable webview URIs.
 * This module performs no I/O; the storage adapter owns reference counts and atomic publication.
 */
import { createHash } from 'node:crypto';
import type {
  PreviewBundle,
  PreviewBundleArtifactMetadata,
  PreviewBundleChunk,
} from '../../domain/preview';

/** Allows large route graphs while aggregate compiler bytes still enforce the lightweight budget. */
export const MAX_PREVIEW_CHUNKS = 2_048;
const PORTABLE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const WINDOWS_RESERVED_PATH_STEM_PATTERN = /^(?:AUX|CLOCK\$|COM[1-9]|CON|LPT[1-9]|NUL|PRN)$/iu;

/** Browser artifact file that may be shared by several independently leased preview revisions. */
export interface PlannedPreviewArtifactFile {
  /** Exact bytes written when this relative path is first acquired by the session. */
  readonly contents: Uint8Array;
  /** Strong byte identity used to reject a path collision without reading global storage. */
  readonly contentDigest: string;
  /** Safe POSIX path below the session's private resource root. */
  readonly relativePath: string;
}

/** Complete immutable layout needed to publish and later describe one preview revision. */
export interface PreviewArtifactLayout {
  /** Bundle-wide identity retained by the application-level lease contract. */
  readonly contentHash: string;
  /** Root-level entry path whose directory matches esbuild's generated relative imports. */
  readonly entryPath: string;
  /** Every entry, chunk, and optional stylesheet file required by the revision. */
  readonly files: readonly PlannedPreviewArtifactFile[];
  /** Optional content-addressed stylesheet loaded explicitly by the webview document. */
  readonly stylesheetPath?: string;
}

/**
 * Validates compiler output and derives stable shared-file paths without changing JavaScript bytes.
 *
 * JavaScript paths are emitted by esbuild's `[hash]` policy and lazy CSS paths by the compiler's
 * full content digest. Rewriting either here would invalidate generated references. The store
 * separately
 * records the digest associated with each path for the complete session, so a malformed caller can
 * never overwrite a live or previously loaded chunk URL with different bytes.
 *
 * @param bundle In-memory compiler result crossing the artifact-store trust boundary.
 * @returns Sorted shared files plus stable entry, stylesheet, and bundle identities.
 * @throws TypeError for unsafe, duplicate, or colliding relative chunk paths.
 * @throws RangeError when the bounded chunk count is exceeded.
 */
export function planPreviewArtifactLayout(bundle: PreviewBundle): PreviewArtifactLayout {
  const chunks = validateAndSortChunks(bundle.chunks);
  const metadata = validateArtifactMetadata(bundle.artifactMetadata, bundle, chunks);
  const contentHash = metadata?.contentHash ?? createBundleHash(bundle, chunks);
  const entryDigest = metadata?.entryDigest ?? createByteDigest(bundle.javascript);
  const entryPath = `entry-${entryDigest}.js`;
  const entryFile = createPlannedFile(entryPath, bundle.javascript, entryDigest);
  const chunkDigestByPath = new Map(
    metadata?.chunkDigests.map((chunk) => [chunk.relativePath, chunk.contentDigest]),
  );
  const chunkFiles = chunks.map((chunk) =>
    createPlannedFileFromChunk(chunk, chunkDigestByPath.get(chunk.relativePath)),
  );
  const stylesheetFile = createStylesheetFile(bundle.stylesheet, metadata?.stylesheetDigest);
  const files =
    stylesheetFile === undefined
      ? [entryFile, ...chunkFiles]
      : [entryFile, ...chunkFiles, stylesheetFile];

  const baseLayout = { contentHash, entryPath, files };
  return stylesheetFile === undefined
    ? baseLayout
    : { ...baseLayout, stylesheetPath: stylesheetFile.relativePath };
}

/**
 * Adds publication identities while bytes still live in the background compiler worker.
 *
 * @param bundle Completed compiler output without or with replaceable metadata.
 * @returns Equivalent bundle carrying immutable byte identities for host-side publication.
 */
export function attachPreviewArtifactMetadata(bundle: PreviewBundle): PreviewBundle {
  const { artifactMetadata: ignoredMetadata, ...metadataFreeBundle } = bundle;
  void ignoredMetadata;
  const layout = planPreviewArtifactLayout(metadataFreeBundle);
  const digestByPath = new Map(layout.files.map((file) => [file.relativePath, file.contentDigest]));
  const stylesheetDigest =
    layout.stylesheetPath === undefined ? undefined : digestByPath.get(layout.stylesheetPath);
  const artifactMetadata: PreviewBundleArtifactMetadata = {
    chunkDigests: bundle.chunks.map((chunk) => ({
      contentDigest: requireArtifactDigest(digestByPath, chunk.relativePath),
      relativePath: chunk.relativePath,
    })),
    contentHash: layout.contentHash,
    entryDigest: requireArtifactDigest(digestByPath, layout.entryPath),
    ...(stylesheetDigest === undefined ? {} : { stylesheetDigest }),
  };
  return { ...bundle, artifactMetadata };
}

/** Creates a transient shared-file descriptor over the compiler-owned typed-array view. */
function createPlannedFile(
  relativePath: string,
  contents: Uint8Array,
  contentDigest = createByteDigest(contents),
): PlannedPreviewArtifactFile {
  assertPortableArtifactPath(relativePath);
  return { contents, contentDigest, relativePath };
}

/** Converts one validated lazy chunk into the common shared-file representation. */
function createPlannedFileFromChunk(
  chunk: PreviewBundleChunk,
  contentDigest?: string,
): PlannedPreviewArtifactFile {
  return createPlannedFile(chunk.relativePath, chunk.contents, contentDigest);
}

/** Creates a digest-named CSS file when the compiler emitted aggregate entry styles. */
function createStylesheetFile(
  stylesheet: Uint8Array | undefined,
  contentDigest?: string,
): PlannedPreviewArtifactFile | undefined {
  if (stylesheet === undefined) {
    return undefined;
  }
  const resolvedDigest = contentDigest ?? createByteDigest(stylesheet);
  return createPlannedFile(`styles/${resolvedDigest}.css`, stylesheet, resolvedDigest);
}

/** Validates worker metadata shape and exact output-path alignment before trusting its digests. */
function validateArtifactMetadata(
  metadata: PreviewBundleArtifactMetadata | undefined,
  bundle: PreviewBundle,
  chunks: readonly PreviewBundleChunk[],
): PreviewBundleArtifactMetadata | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const validContentHash = /^[a-f0-9]{16}$/u.test(metadata.contentHash);
  const validEntryDigest = /^[a-f0-9]{64}$/u.test(metadata.entryDigest);
  const validStylesheetDigest =
    bundle.stylesheet === undefined
      ? metadata.stylesheetDigest === undefined
      : metadata.stylesheetDigest !== undefined &&
        /^[a-f0-9]{64}$/u.test(metadata.stylesheetDigest);
  const sortedMetadataChunks = [...metadata.chunkDigests].sort(compareArtifactPaths);
  const validChunks =
    sortedMetadataChunks.length === chunks.length &&
    sortedMetadataChunks.every(
      (candidate, index) =>
        candidate.relativePath === chunks[index]?.relativePath &&
        /^[a-f0-9]{64}$/u.test(candidate.contentDigest),
    );
  if (!validContentHash || !validEntryDigest || !validStylesheetDigest || !validChunks) {
    throw new TypeError('Invalid background preview artifact metadata.');
  }
  return metadata;
}

/** Returns one planner-produced digest or raises an internal metadata construction error. */
function requireArtifactDigest(
  digestByPath: ReadonlyMap<string, string>,
  relativePath: string,
): string {
  const digest = digestByPath.get(relativePath);
  if (digest === undefined) {
    throw new Error(`Missing planned React preview artifact digest: ${relativePath}`);
  }
  return digest;
}

/**
 * Computes the existing application-level identity over all files in deterministic chunk order.
 * The short digest is an opaque lease key, not a shared-file collision boundary.
 */
function createBundleHash(bundle: PreviewBundle, chunks: readonly PreviewBundleChunk[]): string {
  const hash = createHash('sha256');
  hash.update(bundle.javascript);
  hash.update('\0react-preview-stylesheet\0');
  if (bundle.stylesheet === undefined) {
    hash.update('absent');
  } else {
    hash.update('present');
    updateLengthPrefixedHash(hash, bundle.stylesheet);
  }
  hash.update('\0react-preview-chunks\0');
  for (const chunk of chunks) {
    updateLengthPrefixedHash(hash, chunk.relativePath);
    updateLengthPrefixedHash(hash, chunk.contents);
  }
  return hash.digest('hex').slice(0, 16);
}

/** Computes a longer digest for shared-file paths and in-memory collision verification. */
function createByteDigest(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

/** Validates and lexically sorts untrusted auxiliary output descriptors. */
function validateAndSortChunks(
  chunks: readonly PreviewBundleChunk[],
): readonly PreviewBundleChunk[] {
  if (chunks.length > MAX_PREVIEW_CHUNKS) {
    throw new RangeError(
      `React preview bundles may contain at most ${MAX_PREVIEW_CHUNKS.toString()} auxiliary chunks.`,
    );
  }

  const pathByPortableIdentity = new Map<string, string>();
  for (const chunk of chunks) {
    assertSafeChunkPath(chunk.relativePath);
    const portableIdentity = createPreviewArtifactPathIdentity(chunk.relativePath);
    const previousPath = pathByPortableIdentity.get(portableIdentity);
    if (previousPath === chunk.relativePath) {
      throw new TypeError(`Duplicate React preview chunk path: ${chunk.relativePath}`);
    }
    if (previousPath !== undefined) {
      throw new TypeError(
        `React preview chunk paths collide on a portable filesystem: ${previousPath} and ${chunk.relativePath}`,
      );
    }
    pathByPortableIdentity.set(portableIdentity, chunk.relativePath);
  }
  return [...chunks].sort(compareChunks);
}

/** Enforces the private portable `chunks/…/*.{js,css}` namespace before URI composition. */
function assertSafeChunkPath(relativePath: string): void {
  const pathSegments = relativePath.split('/');
  if (
    !isPortableArtifactPath(relativePath) ||
    pathSegments[0] !== 'chunks' ||
    pathSegments.length < 2 ||
    (!relativePath.endsWith('.js') && !relativePath.endsWith('.css'))
  ) {
    throw new TypeError(`Invalid React preview chunk path: ${relativePath}`);
  }
}

/**
 * Creates the case-folded ASCII identity used to detect aliases on Windows and default macOS
 * filesystems. Callers must first validate the path with this module's portable path policy.
 *
 * @param relativePath Safe session-relative artifact path.
 * @returns Stable identity suitable for shared-file and duplicate-path maps.
 */
export function createPreviewArtifactPathIdentity(relativePath: string): string {
  return relativePath.toLowerCase();
}

/**
 * Verifies internally derived entry and stylesheet paths with the same cross-platform policy used
 * for compiler-provided chunks.
 *
 * @param relativePath Session-relative artifact path about to enter a shared-file descriptor.
 * @throws TypeError when the path cannot retain one filesystem and browser-URL identity.
 */
function assertPortableArtifactPath(relativePath: string): void {
  if (!isPortableArtifactPath(relativePath)) {
    throw new TypeError(`Invalid React preview artifact path: ${relativePath}`);
  }
}

/**
 * Reports whether a path is a URL-stable, ASCII-only relative path on supported filesystems.
 * Restricting segments prevents URI query/fragment reinterpretation, Unicode normalization aliases,
 * trailing-dot aliases, control characters, and Windows device-name collisions.
 *
 * @param relativePath Candidate path below the private artifact session root.
 * @returns `true` only for portable segments that remain literal browser URL path components.
 */
function isPortableArtifactPath(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.startsWith('/') || relativePath.includes('\\')) {
    return false;
  }
  const segments = relativePath.split('/');
  return segments.every((segment) => {
    const pathStem = segment.split('.', 1)[0] ?? '';
    return (
      PORTABLE_PATH_SEGMENT_PATTERN.test(segment) &&
      !WINDOWS_RESERVED_PATH_STEM_PATTERN.test(pathStem)
    );
  });
}

/** Orders chunk paths without locale-dependent collation. */
function compareChunks(left: PreviewBundleChunk, right: PreviewBundleChunk): number {
  return comparePortablePaths(left.relativePath, right.relativePath);
}

/**
 * Orders worker metadata with the exact locale-independent policy used for artifact chunks.
 * `localeCompare` is intentionally avoided: punctuation and ASCII case can sort differently by
 * host locale, which previously rejected valid large background builds before publication.
 */
function compareArtifactPaths(
  left: PreviewBundleArtifactMetadata['chunkDigests'][number],
  right: PreviewBundleArtifactMetadata['chunkDigests'][number],
): number {
  return comparePortablePaths(left.relativePath, right.relativePath);
}

/** Produces deterministic byte-like lexical ordering for validated portable ASCII paths. */
function comparePortablePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Prefixes one digest field with its byte length to make boundaries unambiguous. */
function updateLengthPrefixedHash(
  hash: ReturnType<typeof createHash>,
  value: string | Uint8Array,
): void {
  const byteLength =
    typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength;
  hash.update(`${byteLength.toString()}:`);
  hash.update(value);
}
