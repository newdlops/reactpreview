/**
 * Generates the browser-owned identity attached to every generated preview diagnostic envelope.
 * The opaque session survives hot-entry imports inside one webview, while the artifact and
 * revision identify the exact generated runtime that emitted an event.
 */

/** Creates bounded browser source for stable, non-project diagnostic correlation fields. */
export function createPreviewRuntimeCorrelationSource(): string {
  return String.raw`
const PREVIEW_RUNTIME_SESSION_PATTERN = /^rp-[0-9a-f]{24}$/u;

/** Creates an opaque 96-bit session identity without including workspace or user information. */
function createPreviewRuntimeSessionId() {
  const bytes = new Uint8Array(12);
  try {
    globalThis.crypto?.getRandomValues?.(bytes);
  } catch {
    /* The bounded fallback below is sufficient for log correlation, not authentication. */
  }
  if (bytes.every((value) => value === 0)) {
    let fallback = BigInt(Date.now()) ^ BigInt(Math.floor(Math.random() * 0xffff_ffff));
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number(fallback & 0xffn);
      fallback = (fallback >> 8n) ^ BigInt((index + 1) * 131);
    }
  }
  return 'rp-' + [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** Reads only the extension-generated content hash from the current module URL. */
function readPreviewRuntimeArtifactId() {
  try {
    const entryUrl = new URL(import.meta.url);
    const queryValues = entryUrl.searchParams.getAll('reactPreviewArtifact');
    if (queryValues.length === 1 && /^[0-9a-f]{16}$/u.test(queryValues[0] ?? '')) {
      return queryValues[0];
    }
    const fileMatch = /\/entry-([0-9a-f]{64})\.js$/u.exec(entryUrl.pathname);
    return fileMatch?.[1]?.slice(0, 16);
  } catch {
    return undefined;
  }
}

/** Initializes one stable webview identity and combines it with the current entry revision. */
function createPreviewRuntimeCorrelation() {
  let runtimeSessionId = previewHotRuntime.runtimeSessionId;
  if (
    typeof runtimeSessionId !== 'string' ||
    !PREVIEW_RUNTIME_SESSION_PATTERN.test(runtimeSessionId)
  ) {
    runtimeSessionId = createPreviewRuntimeSessionId();
    previewHotRuntime.runtimeSessionId = runtimeSessionId;
  }
  const artifactId = readPreviewRuntimeArtifactId();
  return Object.freeze({
    ...(artifactId === undefined ? {} : { artifactId }),
    runtimeRevision:
      Number.isSafeInteger(previewRuntimeRevision) && previewRuntimeRevision >= 0
        ? previewRuntimeRevision
        : previewEntryRevision,
    runtimeSessionId,
  });
}

const previewRuntimeCorrelation = createPreviewRuntimeCorrelation();

/** Returns the immutable extension-owned fields copied into each diagnostic envelope. */
function readPreviewRuntimeCorrelation() {
  return previewRuntimeCorrelation;
}
`;
}
