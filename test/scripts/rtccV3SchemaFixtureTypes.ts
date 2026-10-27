/**
 * Mutable projections used only after constructing the historical official test fixtures.
 * These views describe fields that negative schema tests edit; they do not validate transport
 * input or replace the production schema checks, original evidence, or identity checks.
 */

/** One mount whose path is deliberately corrupted by a negative schema case. */
export interface SchemaFixtureMount {
  /** Authored route base path before the test mutation. */
  basePath: string;
}

/** Fields inspected while selecting the historical runnable entry to mutate. */
export interface SchemaFixtureEntry {
  /** Inventory classification used to select an executable route. */
  disposition: string;
  /** Existing executable recipe; its mount list can be empty on other entry kinds. */
  executionPlan: { recipe: { mounts: SchemaFixtureMount[] } };
}

/** Projection justified by the runnable-entry predicate and its positive mount-length check. */
export interface MountedSchemaFixtureEntry extends SchemaFixtureEntry {
  /** The selection predicate accepts only runnable entries. */
  disposition: 'runnable';
  /** The positive mount-length predicate makes its first mount available to this mutation. */
  executionPlan: { recipe: { mounts: [SchemaFixtureMount, ...SchemaFixtureMount[]] } };
}

/** Structural or inventory check returned by the production validator. */
export interface SchemaFixtureCheck {
  /** Stable check identity. */
  name: string;
  /** Original validator outcome before the test forges it. */
  passed: boolean;
  /** Optional diagnostic text emitted by the validator's check accumulator. */
  detail?: string;
}

/** Semantic violation fields changed while testing canonical payload comparison. */
interface SchemaFixtureViolation extends Record<string, unknown> {
  /** Zero-based route-pattern token position. */
  tokenOffset: number;
}

/** Unresolved blocker fields changed while testing canonical payload comparison. */
interface SchemaFixtureBlocker extends Record<string, unknown> {
  /** Authored unresolved-route reason. */
  reason: string;
}

/**
 * Projection of the fixed historical body used by its malformed-payload tests.
 * The known authority has multiple checks, 31 violations, and 18 blockers; tuples retain only
 * the minimum lengths these tests access. Additional serialized fields remain unknown.
 */
export interface SchemaFixturePayload extends Record<string, unknown> {
  /** Original authority identity, with line count removable by an omission case. */
  authority: { sha256: string; lineCount?: number };
  /** Original production and source-manifest identities. */
  header: { productionAggregate: string; sourceManifestDigest: string };
  /** Existing inventory containers inspected and forged by these tests. */
  inventory: {
    entries: SchemaFixtureEntry[];
    counts: { runnable: number };
    extra?: unknown;
  };
  /** Original execution progress, in completed plans. */
  engineTerminal: { executionPlanCompleted: number };
  /** At least two original checks are available for the ordering mutation. */
  checks: [SchemaFixtureCheck, SchemaFixtureCheck, ...SchemaFixtureCheck[]];
  /** At least one semantic violation exists in the fixed failing authority. */
  violations: [SchemaFixtureViolation, ...SchemaFixtureViolation[]];
  /** First violation copied into the official summary. */
  firstViolation: SchemaFixtureViolation;
  /** At least one unresolved blocker exists in the fixed authority. */
  blockers: [SchemaFixtureBlocker, ...SchemaFixtureBlocker[]];
  /** First blocker copied into the official summary. */
  firstBlocker: SchemaFixtureBlocker;
  /** Structural decision that a mutation may forge. */
  structuralResult: string;
  /** Semantic decision that a mutation may forge. */
  semanticResult: string;
  /** Release decision that a mutation may forge. */
  releaseResult: string;
}

/** Only the output identity that the evidence-corruption test changes. */
export interface SchemaFixtureEvidence {
  /** SHA-256 identities of previously generated canonical outputs. */
  outputHashes: { profileValidation: string };
}
