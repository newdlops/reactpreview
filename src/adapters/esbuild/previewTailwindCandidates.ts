/**
 * Extracts Tailwind candidates from bounded editor and page-corridor source snapshots.
 * This module owns candidate byte/count budgets so the PostCSS adapter never needs to enumerate
 * the workspace merely to observe current React class names.
 */
import path from 'node:path';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

const MAX_SNAPSHOT_FILES = 128;
const MAX_PRIORITY_SNAPSHOT_FILES = 8;
const MAX_SNAPSHOT_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_CANDIDATES = 8_192;
const MAX_INLINE_CANDIDATE_BYTES = 256 * 1024;

/** Structural Tailwind Oxide scanner used without filesystem glob sources. */
export interface PreviewTailwindScanner {
  /** Extracts utility candidates from caller-owned source strings. */
  scanFiles(
    inputs: readonly { readonly content: string; readonly extension: string }[],
  ): readonly string[];
}

/** Constructor exported by Tailwind v4's Oxide package. */
export type PreviewTailwindScannerConstructor = new (options: {
  readonly sources: readonly never[];
}) => PreviewTailwindScanner;

/** One validated source passed to Oxide or the configuration-free legacy adapter. */
export interface PreviewTailwindSnapshotSource {
  /** Extension without the leading period. */
  readonly extension: string;
  /** Current editor-or-disk source text admitted by the compiler. */
  readonly sourceText: string;
}

/**
 * Selects bounded, workspace-owned source strings for candidate discovery.
 *
 * @param snapshots Dirty editor files plus statically proven page-corridor sources.
 * @param lexicalWorkspaceRoot User-authored workspace spelling before symlink canonicalization.
 * @param canonicalWorkspaceRoot Existing canonical security boundary.
 * @returns Valid candidate source strings within aggregate count and byte limits.
 */
export function collectPreviewTailwindSnapshotSources(
  snapshots: readonly PreviewSourceSnapshot[] | undefined,
  lexicalWorkspaceRoot: string,
  canonicalWorkspaceRoot: string,
): readonly PreviewTailwindSnapshotSource[] {
  if (snapshots === undefined) return [];
  const output: PreviewTailwindSnapshotSource[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  for (const snapshot of snapshots) {
    const lexicalSourcePath = path.resolve(snapshot.documentPath);
    const sourcePath = canonicalizeExistingPath(snapshot.documentPath);
    if (seenPaths.has(sourcePath)) continue;
    seenPaths.add(sourcePath);
    if (
      !isPathInside(canonicalWorkspaceRoot, sourcePath) &&
      !isPathInside(lexicalWorkspaceRoot, lexicalSourcePath)
    ) {
      continue;
    }
    const extension = path.extname(sourcePath).slice(1).toLowerCase();
    if (!/^(?:[cm]?[jt]sx?|html|mdx?|svelte|vue)$/u.test(extension)) continue;
    const sourceBytes = Buffer.byteLength(snapshot.sourceText, 'utf8');
    if (totalBytes + sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) break;
    totalBytes += sourceBytes;
    output.push({ extension, sourceText: snapshot.sourceText });
    if (output.length >= MAX_SNAPSHOT_FILES) break;
  }
  return output;
}

/** Uses Oxide once to create a deterministic bounded inline candidate list. */
export function scanPreviewTailwindInlineCandidates(
  Scanner: PreviewTailwindScannerConstructor,
  sources: readonly PreviewTailwindSnapshotSource[],
): readonly string[] {
  if (sources.length === 0) return [];
  try {
    const output: string[] = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    const scanSources = (
      selectedSources: readonly PreviewTailwindSnapshotSource[],
    ): readonly string[] => {
      const scanner = new Scanner({ sources: [] });
      return scanner.scanFiles(
        selectedSources.map((source) => ({
          content: source.sourceText,
          extension: source.extension,
        })),
      );
    };
    const candidateGroups = [
      ...sources.slice(0, MAX_PRIORITY_SNAPSHOT_FILES).map((source) => scanSources([source])),
      ...(sources.length <= MAX_PRIORITY_SNAPSHOT_FILES ? [] : [scanSources(sources)]),
    ];
    for (const candidates of candidateGroups) {
      for (const candidate of candidates) {
        if (
          seen.has(candidate) ||
          candidate.length === 0 ||
          /[\u0000-\u001f\u007f\s]/u.test(candidate)
        ) {
          continue;
        }
        const candidateBytes = Buffer.byteLength(candidate, 'utf8');
        if (
          output.length >= MAX_INLINE_CANDIDATES ||
          totalBytes + candidateBytes > MAX_INLINE_CANDIDATE_BYTES
        ) {
          return output;
        }
        seen.add(candidate);
        totalBytes += candidateBytes;
        output.push(candidate);
      }
    }
    return output;
  } catch {
    return [];
  }
}

/** Appends one inert inline source directive containing native-scanner candidate output. */
export function appendPreviewTailwindInlineCandidates(
  source: string,
  candidates: readonly string[],
): string {
  if (candidates.length === 0) return source;
  const value = candidates.join(' ').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `${source}\n@source inline("${value}");\n`;
}

/** Segment-aware containment shared by lexical and canonical workspace spellings. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
