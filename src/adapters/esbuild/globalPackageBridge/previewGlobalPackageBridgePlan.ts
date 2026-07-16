/**
 * Resolves competing implicit-global evidence without importing or evaluating project modules.
 * Centralizing precedence keeps runtime-assignment, ambient-declaration, and dependency discovery
 * collectors independent while giving diagnostics one deterministic inventory.
 */
import path from 'node:path';
import { isSafePreviewRuntimeGlobalName } from '../previewRuntimeEnvironment';
import type {
  PreviewGlobalPackageBridge,
  PreviewGlobalPackageBridgeCandidate,
  PreviewGlobalPackageBridgeInventoryItem,
  PreviewGlobalPackageBridgePlan,
  PreviewGlobalPackageEvidence,
  PreviewGlobalPackageExportKind,
} from './previewGlobalPackageBridge';

/** Project behavior outranks declarations, which outrank exact package-name compatibility. */
const EVIDENCE_PRIORITY: Readonly<Record<PreviewGlobalPackageEvidence, number>> = Object.freeze({
  'ambient-declaration': 300,
  'dependency-name': 100,
  'explicit-hint': 500,
  'free-identifier': 200,
  'runtime-assignment': 400,
});

/** Candidates and cache metadata aggregated before one esbuild invocation. */
export interface PreviewGlobalPackageBridgePlanOptions {
  /** Evidence produced by one or more inert source/package analyzers. */
  readonly candidates: readonly PreviewGlobalPackageBridgeCandidate[];
  /** Additional analyzer inputs whose edits should invalidate the plan. */
  readonly dependencyPaths?: readonly string[];
  /** Exact dependency names available to a reached free-identifier discovery pass. */
  readonly fallbackCandidateNames?: readonly string[];
  /** Propagates a bounded discovery truncation signal into the diagnostic inventory. */
  readonly truncated?: boolean;
}

/** Valid candidate paired with stable source ordering for tie-breaking equivalent identities. */
interface ValidatedCandidate {
  readonly bridge: PreviewGlobalPackageBridge;
  readonly index: number;
}

/**
 * Selects one exact module identity per free global using evidence precedence.
 *
 * At equal highest priority, equivalent module/export identities collapse safely. Conflicting
 * identities are all marked ambiguous and no bridge is emitted, because one inject binding cannot
 * represent two versions or two monorepo consumer modules without changing application semantics.
 *
 * @param options Static evidence candidates, dependencies, and upstream budget state.
 * @returns Frozen active bridges plus a complete selection inventory.
 */
export function createPreviewGlobalPackageBridgePlan(
  options: PreviewGlobalPackageBridgePlanOptions,
): PreviewGlobalPackageBridgePlan {
  const inventory: PreviewGlobalPackageBridgeInventoryItem[] = [];
  const candidatesByName = new Map<string, ValidatedCandidate[]>();
  const dependencyPaths = new Set(options.dependencyPaths ?? []);

  for (const [index, candidate] of options.candidates.entries()) {
    const bridge = validateCandidate(candidate);
    if (bridge === undefined) {
      inventory.push(createInventoryItem(candidate, 'invalid'));
      continue;
    }
    const candidates = candidatesByName.get(bridge.globalName) ?? [];
    candidates.push({ bridge, index });
    candidatesByName.set(bridge.globalName, candidates);
    dependencyPaths.add(bridge.watchPath);
  }

  const bridges: PreviewGlobalPackageBridge[] = [];
  for (const [, candidates] of [...candidatesByName.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const highestPriority = Math.max(
      ...candidates.map((candidate) => EVIDENCE_PRIORITY[candidate.bridge.evidence]),
    );
    const leadingCandidates = candidates.filter(
      (candidate) => EVIDENCE_PRIORITY[candidate.bridge.evidence] === highestPriority,
    );
    const leadingIdentities = new Set(
      leadingCandidates.map((candidate) => createBridgeIdentity(candidate.bridge)),
    );
    if (leadingIdentities.size !== 1) {
      for (const candidate of candidates) {
        inventory.push(
          createInventoryItem(
            candidate.bridge,
            leadingCandidates.includes(candidate) ? 'ambiguous' : 'shadowed',
          ),
        );
      }
      continue;
    }

    const selected = [...leadingCandidates].sort((left, right) => left.index - right.index)[0];
    if (selected === undefined) {
      continue;
    }
    bridges.push(selected.bridge);
    for (const candidate of candidates) {
      inventory.push(
        createInventoryItem(candidate.bridge, candidate === selected ? 'active' : 'shadowed'),
      );
    }
  }

  return Object.freeze({
    bridges: Object.freeze(bridges),
    dependencyPaths: Object.freeze(
      [...dependencyPaths].map((dependencyPath) => path.normalize(dependencyPath)).sort(),
    ),
    fallbackCandidateNames: Object.freeze(
      [...new Set(options.fallbackCandidateNames ?? [])].sort(),
    ),
    inventory: Object.freeze(
      inventory.sort(
        (left, right) =>
          left.globalName.localeCompare(right.globalName) ||
          left.status.localeCompare(right.status) ||
          left.moduleSpecifier.localeCompare(right.moduleSpecifier),
      ),
    ),
    truncated: options.truncated ?? false,
  });
}

/** Normalizes one candidate while rejecting every generated-source or export-shape ambiguity. */
function validateCandidate(
  candidate: PreviewGlobalPackageBridgeCandidate,
): PreviewGlobalPackageBridge | undefined {
  const exportKind = candidate.exportKind ?? 'auto';
  if (
    !isSafePreviewRuntimeGlobalName(candidate.globalName) ||
    candidate.moduleSpecifier.length === 0 ||
    candidate.moduleSpecifier.includes('\0') ||
    !path.isAbsolute(candidate.resolveDir) ||
    !path.isAbsolute(candidate.watchPath) ||
    !isValidExportSelection(exportKind, candidate.exportName)
  ) {
    return undefined;
  }
  return Object.freeze({
    evidence: candidate.evidence,
    exportKind,
    ...(candidate.exportName === undefined ? {} : { exportName: candidate.exportName }),
    globalName: candidate.globalName,
    moduleSpecifier: candidate.moduleSpecifier,
    resolveDir: path.normalize(candidate.resolveDir),
    watchPath: path.normalize(candidate.watchPath),
  });
}

/** Validates named exports and rejects stray export names on other selection modes. */
function isValidExportSelection(
  exportKind: PreviewGlobalPackageExportKind,
  exportName: string | undefined,
): boolean {
  return exportKind === 'named'
    ? exportName !== undefined && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(exportName)
    : exportName === undefined;
}

/** Includes resolver origin and export shape so cross-package versions cannot collapse accidentally. */
function createBridgeIdentity(bridge: PreviewGlobalPackageBridge): string {
  return JSON.stringify([
    bridge.moduleSpecifier,
    bridge.resolveDir,
    bridge.exportKind,
    bridge.exportName ?? '',
    bridge.watchPath,
  ]);
}

/** Converts either a raw or validated candidate into stable user-facing decision metadata. */
function createInventoryItem(
  candidate: Pick<
    PreviewGlobalPackageBridgeCandidate,
    'evidence' | 'globalName' | 'moduleSpecifier'
  >,
  status: PreviewGlobalPackageBridgeInventoryItem['status'],
): PreviewGlobalPackageBridgeInventoryItem {
  return Object.freeze({
    evidence: candidate.evidence,
    globalName: candidate.globalName,
    moduleSpecifier: candidate.moduleSpecifier,
    status,
  });
}
