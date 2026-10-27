/** Shared deterministic fixtures for validateRtccPreviewCompleteRouteProfileV3 regression scenarios. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  AUTHORITY_PATH,
  AUTHORITY_POLICY,
  AUTHORITY_SHA256,
  canonicalDigest,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';
import {
  buildValidatorGate,
  persistOfficialArtifacts,
  preflightOfficialRun,
} from '../../scripts/validation/rtcc-v3-official-artifacts.mjs';
import { parseJsonl } from '../../scripts/validation/rtcc-v3-structural-telemetry.mjs';
import { deleteFixtureValue, fixtureObject } from '../support/rtccV3Mutation';
import { readReconstructedFile } from '../support/rtccReconstructedArchive';
import type { SchemaFixturePayload } from './rtccV3SchemaFixtureTypes';

/** In-memory gate interception retains the filesystem reader's encoded-text and raw-byte forms. */
type FixtureReader = (path: string, encoding?: BufferEncoding) => string | Buffer;

/** Five ordered CLI tokens; fixed length keeps deliberate reorder tests free of missing indices. */
type OfficialArguments = [
  mode: string,
  gateFlag: string,
  gatePath: string,
  hashFlag: string,
  gateSha256: string,
];

/** Concrete invocation is always supplied by this fixture, even though production can default it. */
export type FixturePreflightOptions = Parameters<typeof preflightOfficialRun>[0] & {
  /** Exact process identity constructed together with the fixture arguments. */
  invocation: ReturnType<typeof actualInvocation>;
};

/** Prepared gate and dependencies consumed by the official admission tests. */
interface PreparedPreflight {
  /** Canonical gate produced from the current bound files. */
  readonly gate: ReturnType<typeof memoryGate>;
  /** Ordered official argument vector. */
  readonly argv: OfficialArguments;
  /** Gate-aware reader; other inputs use reconstructed bytes or maintained sources. */
  readonly read: FixtureReader;
  /** Inputs passed through the production preflight validator. */
  readonly options: FixturePreflightOptions;
}

/** Simulated artifact run returned only after exact fixture preflight and persistence complete. */
interface PersistedArtifacts {
  /** Temporary output directory registered for cleanup. */
  readonly temp: string;
  /** Ordered absolute output paths. */
  readonly paths: string[];
  /** Gate and injected dependencies used by this run. */
  readonly prepared: PreparedPreflight;
  /** Verified fixture-byte and supplied process-identity facts. */
  readonly preflight: ReturnType<typeof preflightOfficialRun>;
  /** Caller payload before the production writer builds its official envelopes. */
  readonly body: Record<string, unknown>;
  /** Canonical output values and bytes returned by the production writer. */
  readonly artifacts: ReturnType<typeof persistOfficialArtifacts>;
}

/** Tests one named structural check while allowing the validator to retain its complete report. */
export const checkFailed = (
  result: { readonly checks: readonly { readonly name: string; readonly passed: boolean }[] },
  name: string,
): boolean => result.checks.some((check) => check.name === name && !check.passed);

export const policy = {
  structural: {
    executionCount: 22,
    checkpoints: [1],
    bundleCount: 1,
    phaseOrder: ['prepare', 'enumerate', 'replay', 'execution', 'finalize'],
  },
  inventory: {
    analysisCount: 2,
    replayCount: 3,
    total: 1,
    runnable: 1,
    duplicate: 0,
    unresolved: 0,
  },
};

export const projectRoot = '/Users/lky/project/reactpreview';

export const validatorPath = `${projectRoot}/scripts/validate-rtcc-preview-complete-route-profile-v3.mjs`;

export const nodePath = '/Users/lky/.nvm/versions/node/v22.22.2/bin/node';

export const outputNames = [
  'profile-validation.json',
  'semantic-report.json',
  'lineage.json',
  'evidence.json',
  'manifest.json',
  'SHA256SUMS',
];

export const temporaryDirectories = new Set<string>();

/** Creates a unique output directory and registers it for the suite's cleanup. */
export const isolatedTemp = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
};

/** Builds the ordered official arguments with the supplied raw gate hash in the final position. */
export const officialArgs = (gateSha256: string): OfficialArguments => [
  '--official-v5.5.31',
  '--gate',
  '.plan/launchers/rtcc-v5.5.31-validator-gate.json',
  '--gate-sha256',
  gateSha256,
];

/** Records the exact process identity expected by preflight without invoking a child process. */
export const actualInvocation = (
  args: string[],
): { readonly cwd: string; readonly execPath: string; readonly argv: string[] } => ({
  cwd: projectRoot,
  execPath: nodePath,
  argv: [nodePath, validatorPath, ...args],
});

/** Builds a gate from exact reconstructed input bytes and captures its exclusive write in memory. */
export function memoryGate(): ReturnType<typeof buildValidatorGate> {
  let bytes = '';
  const result = buildValidatorGate({
    cwd: projectRoot,
    readFile: readReconstructedFile,
    preOfficialSolReview: { status: 'PASS', recordedAt: '2026-08-01T00:00:00.000Z' },
    writeFile: (_path: string, next: string) => {
      bytes = next;
    },
  });
  return { ...result, bytes };
}

/** Intercepts only gate reads and exposes dependency overrides for individual admission failures. */
export function preparedPreflight(overrides: Record<string, unknown> = {}): PreparedPreflight {
  const gate = memoryGate();
  const argv = officialArgs(gate.sha256);
  const read: FixtureReader = (path: string, encoding?: BufferEncoding) =>
    path.endsWith('validator-gate.json')
      ? encoding
        ? gate.bytes
        : Buffer.from(gate.bytes)
      : readReconstructedFile(path, encoding);
  return {
    gate,
    argv,
    read,
    options: {
      cwd: projectRoot,
      argv,
      invocation: actualInvocation(argv),
      authorityPath: AUTHORITY_PATH,
      authorityHash: AUTHORITY_SHA256,
      readFile: read,
      lstat: () => ({ isFile: () => true, isSymbolicLink: () => false }),
      exists: () => false,
      ...overrides,
    },
  };
}

/** Cached reconstructed authority, loaded only by tests requiring the complete archive contract. */
let authorityFixture:
  | { readonly authorityBytes: string; readonly authorityReport: ReturnType<typeof validateTrace> }
  | undefined;

/** Reads the regenerated in-memory profile without creating an archive at its historical path. */
export function readAuthorityFixture(): NonNullable<typeof authorityFixture> {
  if (authorityFixture !== undefined) return authorityFixture;
  const authorityBytes = readReconstructedFile(AUTHORITY_PATH, 'utf8');
  const authorityReport = validateTrace(parseJsonl(authorityBytes), AUTHORITY_POLICY);
  authorityFixture = { authorityBytes, authorityReport };
  return authorityFixture;
}

/** Builds the unit-test payload from the regenerated profile and its actual byte identity. */
export const officialBody = (): Record<string, unknown> => ({
  schemaVersion: 3,
  validator: 'rtcc-preview-complete-route-profile-v3',
  authority: { path: AUTHORITY_PATH, sha256: AUTHORITY_SHA256, lineCount: 1530 },
  authorityBytes: readAuthorityFixture().authorityBytes,
  externalRunCount: 0,
  noRetry: true,
  productionChanged: false,
  ...readAuthorityFixture().authorityReport,
});

/** Tests artifact persistence only after validating the exact reconstructed authority and gate. */
export function persistedArtifacts(): PersistedArtifacts {
  const temp = isolatedTemp('rtcc-v3-artifacts-');
  const prepared = preparedPreflight();
  const preflight = preflightOfficialRun(prepared.options);
  const body = officialBody();
  const paths = outputNames.map((name) => join(temp, name));
  const artifacts = persistOfficialArtifacts({
    paths,
    body,
    expectedExitCode: 1,
    gate: prepared.gate.gate,
    gateSha256: prepared.gate.sha256,
    moduleHashes: prepared.gate.gate.bindings,
    predecessors: preflight.predecessors,
    invocation: preflight.invocation,
  });
  return { temp, paths, prepared, preflight, body, artifacts };
}

/** Checks that a forged body is rejected before the injected writer receives any calls. */
export function expectBodyRejectedBeforeWrite(mutate: (body: SchemaFixturePayload) => void): void {
  const prepared = preparedPreflight();
  const preflight = preflightOfficialRun(prepared.options);
  const body = structuredClone(officialBody()) as SchemaFixturePayload;
  const writes: unknown[][] = [];
  mutate(body);
  expect(() =>
    persistOfficialArtifacts({
      paths: outputNames,
      body,
      expectedExitCode: 1,
      gate: prepared.gate.gate,
      gateSha256: prepared.gate.sha256,
      moduleHashes: prepared.gate.gate.bindings,
      predecessors: preflight.predecessors,
      invocation: preflight.invocation,
      writeFile: (...args: unknown[]) => {
        writes.push(args);
      },
    }),
  ).toThrow('profile-validation-schema-drift');
  expect(writes).toHaveLength(0);
}

/** Reverses field insertion order without changing the values used by exact-schema negative tests. */
export const reorder = (value: unknown): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fixtureObject(value)).reverse());

/** Reorders one fixture object while retaining references held elsewhere in the same trace. */
export const reorderInPlace = (value: unknown): void => {
  const object = fixtureObject(value);
  const next = reorder(object);
  for (const key of Object.keys(object)) deleteFixtureValue(object, [key]);
  Object.assign(object, next);
};

/** Rebinds a deliberately mutated plan digest so validators must inspect its nested contracts. */
export const recomputePlanDigest = (plan: unknown): void => {
  const object = fixtureObject(plan);
  object.digest = canonicalDigest(
    Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'digest')),
  );
};
