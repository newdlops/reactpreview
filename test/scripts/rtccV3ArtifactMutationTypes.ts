/** Mutable test views of artifacts already produced and checked by the official writer. */
import type { buildValidatorGate } from '../../scripts/validation/rtcc-v3-official-artifacts.mjs';

/** An existing artifact identity whose fields may be corrupted by a negative case. */
interface FixtureBinding {
  /** Bound artifact path. */
  path: string;
  /** SHA-256 of its canonical bytes. */
  sha256: string;
}

/** The fixed predecessor names exercised by the historical lineage cases. */
type FixturePredecessorKey =
  | 'plan'
  | 'canonicalArgv'
  | 'executor'
  | 'executorTest'
  | 'attempt'
  | 'terminal'
  | 'gateProbe'
  | 'preflight'
  | 'lineage';

/** Projection of lineage fields used by its exact-schema negative cases. */
export interface LineageMutationFixture extends Record<string, unknown> {
  /** Original authority identity, with byte count removable by an omission case. */
  authority: { bytes?: number };
  /** Complete action map before individual flags are changed or removed. */
  prohibitedActions: Record<string, boolean>;
  /** Bound plans whose count can be shortened. */
  plans: unknown[];
  /** Raw gate identity. */
  gate: { sha256: string };
  /** Completed execution plans before an inconsistency is injected. */
  engineTerminal: { executionPlanCompleted: number };
  /** Fixed predecessor identities; nested payloads remain unknown until a case selects its view. */
  predecessors: Record<FixturePredecessorKey, { sha256: string; value: unknown }>;
}

/** Projection of evidence fields used by invocation and exact-schema negative cases. */
export interface EvidenceMutationFixture extends Record<string, unknown> {
  /** Complete action map before individual flags are changed or removed. */
  prohibitedActions: Record<string, boolean>;
  /** Two process tokens plus five approved CLI tokens in the original official invocation. */
  invocation: {
    argv: [string, string, string, string, string, string, string];
    approvedTokens: [string, string, string, string, string];
  };
  /** Bound source and artifact identities whose count may be shortened. */
  bindings: unknown[];
  /** Original official-run count before a case forges it. */
  officialRunCount: number;
}

/** Projection of the canonical manifest produced before a negative mutation. */
export interface ManifestMutationFixture extends Record<string, unknown> {
  /** Gate input identities, removable by the omission case. */
  inputs?: unknown[];
  /** Exactly four official payload identities before ordering and identity mutations. */
  results: [FixtureBinding, FixtureBinding, FixtureBinding, FixtureBinding];
}

/** Gate builder output with only the omission, extra-field, and first-binding mutations widened. */
export type GateMutationFixture = Omit<
  ReturnType<typeof buildValidatorGate>['gate'],
  'bindings' | 'cwd' | 'node'
> &
  Record<string, unknown> & {
    /** Approved root, removable by the omission case. */
    cwd?: string;
    /** The builder always binds at least the four required plan files. */
    bindings: [FixtureBinding, ...FixtureBinding[]];
    /** Runtime identity container, widened to permit an intentional extra field. */
    node: ReturnType<typeof buildValidatorGate>['gate']['node'] & Record<string, unknown>;
  };
