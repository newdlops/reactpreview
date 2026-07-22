/**
 * Reads only browser-public environment variables from bounded project convention files.
 *
 * The extension must never serialize server credentials into a webview bundle. This module keeps
 * that boundary explicit: it scans fixed project-root filenames, accepts only well-known public
 * prefixes, never expands references to other variables, and returns no raw source text.
 */
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PreviewCompilationError } from '../../domain/preview';
import { normalizeLexicalPath } from '../../shared/pathIdentity';

/** Maximum bytes inspected from one optional dotenv file. */
export const MAX_PREVIEW_PUBLIC_ENVIRONMENT_FILE_BYTES = 1024 * 1024;

/** Maximum public keys serialized into one generated browser entry. */
export const MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS = 256;

/** Maximum UTF-16 code units retained for one browser-public value. */
export const MAX_PREVIEW_PUBLIC_ENVIRONMENT_VALUE_LENGTH = 64 * 1024;

/**
 * Fixed discovery order keeps `.env.example` as a preview-only fallback. Resolution later applies
 * Vite and Next/CRA precedence independently because those toolchains order local overrides
 * differently during development.
 */
const PREVIEW_PUBLIC_ENVIRONMENT_FILENAMES = [
  '.env.example',
  '.env',
  '.env.development',
  '.env.local',
  '.env.development.local',
] as const;

/** Browser-visible prefixes recognized by the dominant React build toolchains. */
const PUBLIC_ENVIRONMENT_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'PUBLIC_'] as const;

/** Safe environment map embedded into the isolated preview entry. */
export type PreviewPublicEnvironment = Readonly<Record<string, string>>;

/**
 * Creates every existing-or-future dotenv convention path in deterministic precedence order.
 * Callers retain these identities as rebuild dependencies even when the files do not exist yet.
 *
 * @param projectRoot Canonical package root selected for the preview target.
 * @returns Absolute lexical dotenv paths in one stable discovery order.
 */
export function createPreviewPublicEnvironmentCandidatePaths(
  projectRoot: string,
): readonly string[] {
  return PREVIEW_PUBLIC_ENVIRONMENT_FILENAMES.map((fileName) =>
    normalizeLexicalPath(path.join(projectRoot, fileName)),
  );
}

/**
 * Resolves and parses public dotenv values without following a file symlink outside the workspace.
 * Missing files are ordinary misses. Permission and I/O failures remain visible build errors so an
 * unreadable real configuration cannot silently masquerade as an absent value.
 *
 * @param projectRoot Canonical package root containing optional dotenv conventions.
 * @param workspaceRoot Canonical security boundary for all file reads.
 * @returns Frozen public values after deterministic development precedence has been applied.
 */
export async function resolvePreviewPublicEnvironment(
  projectRoot: string,
  workspaceRoot: string,
): Promise<PreviewPublicEnvironment> {
  const publicValues: Record<string, string> = {};
  const publicKeys = new Set<string>();
  const publicLayers: (readonly (readonly [string, string])[])[] = [];
  for (const candidatePath of createPreviewPublicEnvironmentCandidatePaths(projectRoot)) {
    const sourceText = await readOptionalPublicEnvironmentSource(candidatePath, workspaceRoot);
    if (sourceText === undefined) {
      publicLayers.push([]);
      continue;
    }
    const publicLayer = parsePublicEnvironmentSource(sourceText);
    publicLayers.push(publicLayer);
    for (const [key] of publicLayer) {
      if (!publicKeys.has(key) && publicKeys.size >= MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS) {
        throw createPublicEnvironmentError(
          `Preview public environment exceeds the ${MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS.toString()} merged key safety limit.`,
        );
      }
      publicKeys.add(key);
    }
  }

  /** Next, CRA, and generic public variables let `.env.local` override `.env.development`. */
  for (const publicLayer of publicLayers) {
    for (const [key, value] of publicLayer) {
      if (!key.startsWith('VITE_')) publicValues[key] = value;
    }
  }
  /** Vite gives the mode-specific file precedence over its generic local counterpart. */
  for (const layerIndex of [0, 1, 3, 2, 4]) {
    for (const [key, value] of publicLayers[layerIndex] ?? []) {
      if (key.startsWith('VITE_')) publicValues[key] = value;
    }
  }
  return Object.freeze({ ...publicValues });
}

/**
 * Creates the compile-time `import.meta.env` object expected by Vite-authored React modules.
 * Only `VITE_` declarations cross this API; neutral development flags are written last so neither
 * malformed input nor a direct unit-test caller can replace the preview's execution mode.
 *
 * @param publicEnvironment Already-filtered browser-public dotenv values.
 * @returns Frozen values serialized into esbuild's `import.meta.env` define.
 */
export function createPreviewImportMetaEnvironment(
  publicEnvironment: PreviewPublicEnvironment | undefined = {},
): Readonly<Record<string, boolean | string>> {
  const viteValues = Object.fromEntries(
    Object.entries(publicEnvironment).filter(([key]) => key.startsWith('VITE_')),
  );
  return Object.freeze({
    ...viteValues,
    BASE_URL: '/',
    DEV: true,
    MODE: 'development',
    PROD: false,
    SSR: false,
  });
}

/**
 * Parses dotenv assignments while discarding every non-public key before values leave this module.
 * Variable interpolation deliberately remains literal: expanding `$SECRET` through a public value
 * would cross the bundle's confidentiality boundary. Multiline quoted syntax is not interpreted.
 *
 * @param sourceText Bounded UTF-8 dotenv source.
 * @returns Public key/value pairs in source order so later declarations win within one file.
 */
export function parsePublicEnvironmentSource(
  sourceText: string,
): readonly (readonly [string, string])[] {
  const values = new Map<string, string>();
  for (const sourceLine of sourceText.split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(sourceLine);
    const key = match?.[1];
    const encodedValue = match?.[2];
    if (key === undefined || encodedValue === undefined || !isPublicEnvironmentKey(key)) {
      continue;
    }
    const value = decodeDotenvValue(encodedValue);
    if (value.length > MAX_PREVIEW_PUBLIC_ENVIRONMENT_VALUE_LENGTH) {
      throw createPublicEnvironmentError(
        `Preview public environment value ${key} exceeds the ${MAX_PREVIEW_PUBLIC_ENVIRONMENT_VALUE_LENGTH.toString()} character safety limit.`,
      );
    }
    if (!values.has(key) && values.size >= MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS) {
      throw createPublicEnvironmentError(
        `Preview public environment exceeds the ${MAX_PREVIEW_PUBLIC_ENVIRONMENT_KEYS.toString()} key safety limit.`,
      );
    }
    values.set(key, value);
  }
  return [...values.entries()];
}

/** Reports whether one dotenv name is explicitly browser-visible for a common React toolchain. */
function isPublicEnvironmentKey(key: string): boolean {
  return PUBLIC_ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Decodes one single-line dotenv value without interpolation or executable escape processing.
 * Double quotes recognize the small escape set supported by common dotenv parsers; single quotes
 * remain literal, while unquoted comments begin only after whitespace to preserve URL fragments.
 */
function decodeDotenvValue(encodedValue: string): string {
  const trimmedValue = encodedValue.trim();
  const singleQuotedValue = /^'([^']*)'(?:\s+#.*)?$/u.exec(trimmedValue)?.[1];
  if (singleQuotedValue !== undefined) {
    return singleQuotedValue;
  }
  const doubleQuotedValue = /^"((?:\\.|[^"\\])*)"(?:\s+#.*)?$/u.exec(trimmedValue)?.[1];
  if (doubleQuotedValue !== undefined) {
    return doubleQuotedValue.replace(/\\([nrt"\\])/gu, (_match, escapedCharacter: string) => {
      if (escapedCharacter === 'n') return '\n';
      if (escapedCharacter === 'r') return '\r';
      if (escapedCharacter === 't') return '\t';
      return escapedCharacter;
    });
  }
  return trimmedValue.replace(/\s+#.*$/u, '').trimEnd();
}

/** Reads one trusted regular dotenv file through the same bounded policy as runtime metadata. */
async function readOptionalPublicEnvironmentSource(
  sourcePath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  let canonicalSourcePath: string;
  try {
    canonicalSourcePath = normalizeLexicalPath(await realpath(sourcePath));
    if (!(await stat(canonicalSourcePath)).isFile()) {
      return undefined;
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw createPublicEnvironmentError(
      `Preview public environment file could not be inspected: ${sourcePath}`,
      error,
    );
  }
  if (!isPathInside(workspaceRoot, canonicalSourcePath)) {
    return undefined;
  }

  let fileHandle;
  try {
    fileHandle = await open(canonicalSourcePath, 'r');
    const fileSize = (await fileHandle.stat()).size;
    const sourceBuffer = Buffer.alloc(
      Math.min(Math.max(fileSize, 0), MAX_PREVIEW_PUBLIC_ENVIRONMENT_FILE_BYTES),
    );
    let totalBytesRead = 0;
    while (totalBytesRead < sourceBuffer.byteLength) {
      const { bytesRead } = await fileHandle.read(
        sourceBuffer,
        totalBytesRead,
        sourceBuffer.byteLength - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    return sourceBuffer.subarray(0, totalBytesRead).toString('utf8');
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw createPublicEnvironmentError(
      `Preview public environment file could not be read: ${sourcePath}`,
      error,
    );
  } finally {
    await fileHandle?.close();
  }
}

/** Reports whether a canonical candidate equals or descends from the trusted workspace root. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Identifies normal optional-path misses without hiding permissions or unexpected I/O failures. */
function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Converts public environment discovery failures to the compiler's stable domain error. */
function createPublicEnvironmentError(message: string, cause?: unknown): PreviewCompilationError {
  return new PreviewCompilationError(message, [], cause);
}
