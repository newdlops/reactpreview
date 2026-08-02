export const V53_LEXICAL_ROOT: string;
export const V53_CANONICAL_ROOT: string;
export const DARWIN_MAIN_SOCKET: string;
export const PREVIEW_BLOCKER_SIGNATURE_FAMILIES: readonly string[];

export function censusPreviewBlockerSource(
  sourceText: string,
  fileName?: string,
): {
  readonly bucket: string;
  readonly exportable: boolean;
  readonly signatures: readonly string[];
};

export function selectPreviewBlockerCensusTargets(
  candidates: readonly any[],
  cap?: number,
): {
  readonly selected: readonly any[];
  readonly uncoveredSignatures: readonly string[];
};

export function derivePreviewBlockerBreadthStratum(
  sourcePath: string,
  root: string,
  rootStratum?: string,
): string;

export function validatePreviewBlockerManifestOutput(
  out: string,
  roots: readonly string[],
): Promise<void>;

export function recordPreviewBlockerCampaignPhase(
  ledger: unknown,
  phase: 'baseline' | 'after',
  manifestSha256: string,
  evidenceSha256: string,
): unknown;

export function comparePreviewBlockerCampaignEvidence(
  baseline: unknown,
  after: unknown,
  manifestSha256: string,
  ledger: unknown,
  evidenceDigests?: unknown,
): unknown;

export function persistPreviewBlockerCampaignPhase(
  ledgerPath: string,
  phase: 'baseline' | 'after',
  manifestSha256: string,
  evidenceSha256: string,
): Promise<void>;

export function validateInspectorPort(value: string): number;
export function createOpenArguments(
  authority: Record<string, unknown>,
  environment: string,
  applicationStdout: string,
  applicationStderr: string,
): string[];
export function classifyLaunchEvidence(evidence: Record<string, unknown>): string;
export function createDiagnosticIndex(
  artifacts: readonly { name: string; bytes: number; sha256: string }[],
  classification: string,
  manifestSha256: string,
): {
  readonly artifacts: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
};
export function validateProofAcknowledgement(
  proof: unknown,
  acknowledgement: unknown,
  authoritySha256: string,
): boolean;
export function validateInspectorEndpoint(value: string): { readonly host: string };
export function processMatches(record: unknown, authority: unknown): boolean;
export function exactPidMatches(record: unknown, expected: unknown, authority: unknown): boolean;
export function ipcSocketCandidates(root?: string): string[];
export function validateIpcSocketCandidates(candidates?: readonly string[]): string[];
