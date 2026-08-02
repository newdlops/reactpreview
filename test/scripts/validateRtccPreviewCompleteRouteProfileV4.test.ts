import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalDigest } from "../../scripts/validation/rtcc-v3-inventory-execution-plan.mjs";
import { parseJsonl } from "../../scripts/validation/rtcc-v3-structural-telemetry.mjs";
import {
  AUTHORITY_POLICY,
  V4_PATHS,
  assertCompactValidationSchema,
  buildCompactValidation,
  expectedExecutorHashBindings,
  parseOfficialArguments,
  persistCompactArtifacts,
  readReferenceBlockers,
  sha256,
  validateAttemptStart,
  validateCompactTrace,
  validatePreflightEvidence,
  validateTerminalEvidence,
  writeExclusiveBytes,
} from "../../scripts/validate-rtcc-preview-complete-route-profile-v4.mjs";
import { BINDINGS as EXECUTOR_BINDINGS, EXPECTED_ARGUMENT_VECTOR, PATHS as EXECUTOR_PATHS, buildProspectivePreflightFacts } from "../../.plan/launchers/rtcc-v5.5.33-exact-once-executor.mjs";

const oldAuthorityPath = "/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-30-a/profile.jsonl";
const deterministicUuid = "00000000-0000-4000-8000-000000000000";
const temporaryDirectories = new Set<string>();
afterEach(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); temporaryDirectories.clear(); });
const isolatedTemp = () => { const directory = mkdtempSync(join(tmpdir(), "rtcc-v4-validator-test-")); temporaryDirectories.add(directory); return directory; };

function replaceInvalidUuid(value: string): string { return value.replaceAll("aaaaaaaa", deterministicUuid); }
function repairAuthorityRecords() {
  const records: any[] = parseJsonl(readFileSync(oldAuthorityPath, "utf8"));
  records[0].productionAggregate = AUTHORITY_POLICY.structural.header.productionAggregate;
  const inventory = records.at(-1).inventory;
  const runnableById = new Map<string, any>();
  for (const entry of inventory.entries) {
    if (entry.disposition !== "runnable") continue;
    entry.parameters = Object.fromEntries(Object.entries(entry.parameters).map(([key, value]) => [key, replaceInvalidUuid(String(value))]));
    entry.pathname = replaceInvalidUuid(entry.pathname);
    entry.replay.parameters = structuredClone(entry.parameters);
    entry.replay.pathname = entry.pathname;
    entry.executionPlan.recipe.params = structuredClone(entry.parameters);
    entry.executionPlan.recipe.pathname = entry.pathname;
    entry.executionPlan.selectedBranch.pathname = entry.pathname;
    entry.executionPlan.digest = canonicalDigest(Object.fromEntries(Object.entries(entry.executionPlan).filter(([key]) => key !== "digest")));
    runnableById.set(entry.id, entry);
  }
  for (const entry of inventory.entries) {
    if (entry.disposition !== "duplicate") continue;
    const target = runnableById.get(entry.duplicateOf);
    entry.parameters = structuredClone(target.parameters);
    entry.pathname = target.pathname;
    entry.replay = structuredClone(target.replay);
  }
  return records;
}

const referenceBlockers: any[] = readReferenceBlockers();
const repairedRecords: any[] = repairAuthorityRecords();
const repairedAuthorityBytes = `${repairedRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
const repairedReport: any = validateCompactTrace(repairedRecords, referenceBlockers);
const compactValidation: any = buildCompactValidation(repairedAuthorityBytes, repairedReport);
const canonicalBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const zeroProcess = () => ({ method: "/bin/ps -Ao pid=,ppid=,command=", shell: false, processInspectionApiInvocationCount: 1, candidateCount: 0, excludedSelfCount: 0, exactMatchingCount: 0, matchedPids: [] });
const preflightCommon = {
  state: { profileRoot: { exists: false }, trace: { exists: false }, processInspection: zeroProcess() },
  frozenLineage: { authority: {
    root: { path: EXECUTOR_PATHS.frozenAuthorityRoot, realpath: EXECUTOR_PATHS.frozenAuthorityRoot, type: "directory", symlink: false, entries: ["profile.jsonl"] },
    trace: { path: EXECUTOR_PATHS.frozenAuthorityTrace, realpath: EXECUTOR_PATHS.frozenAuthorityTrace, type: "regular-file", symlink: false, sha256: EXECUTOR_BINDINGS.frozenAuthoritySha256, byteCount: 6037478, lineCount: 1530, finalLf: true },
  } },
};
const currentExecutorSha = sha256(readFileSync(EXECUTOR_PATHS.executor));
const reviewedPreflight: any = { schemaVersion: 1, kind: "rtcc-preview-reviewed-profile-preflight", release: "v5.5.33", solReview: { status: "PASS", recordedAt: "2026-08-01T00:00:00.000Z" }, ...buildProspectivePreflightFacts(preflightCommon, currentExecutorSha) };
const reviewedPreflightBytes = canonicalBytes(reviewedPreflight);
const reviewedPreflightContext = validatePreflightEvidence(reviewedPreflightBytes, sha256(reviewedPreflightBytes));
const attemptStart: any = {
  schemaVersion: 1, kind: "rtcc-preview-execution-attempt-start", release: "v5.5.33", complete: true, timestamp: "2026-08-01T00:01:00.000Z", processId: 5533,
  command: { workingDirectory: EXECUTOR_PATHS.workingDirectory, argumentVector: [EXPECTED_ARGUMENT_VECTOR[0], EXECUTOR_PATHS.executor, "--execute"] },
  hashBindings: expectedExecutorHashBindings(),
  directRootContract: { existingParent: EXECUTOR_PATHS.existingParent, profileRoot: EXECUTOR_PATHS.profileRoot, trace: EXECUTOR_PATHS.trace, launcherCreatesRootNonrecursively: true, executorCreatesRoot: false },
  authorizationConsumed: true, profileSpawnApiInvocationCount: 0, launcherExecuted: false,
};
const attemptBytes = canonicalBytes(attemptStart);
const attemptContext = validateAttemptStart(attemptBytes);
const emptyHash = sha256(Buffer.alloc(0));
const stdoutBytes = Buffer.from("out"); const stderrBytes = Buffer.from("err");
const authorityHash = sha256(repairedAuthorityBytes);
const prohibitedActions = { retryPerformed: false, externalTimeoutUsed: false, killTimerUsed: false, shellWrapperUsed: false, secondRootUsed: false, rootDeletedOrReused: false, recursiveWorkaroundUsed: false, executorCreatedRoot: false, browserExecuted: false, chromiumExecuted: false, serverExecuted: false, campaignExecuted: false };
function terminalFixture(): any {
  return {
    schemaVersion: 1, kind: "rtcc-preview-execution-terminal-evidence", release: "v5.5.33", complete: true, result: "audit-required",
    hashBindings: expectedExecutorHashBindings(), reviewedPreflightIdentity: { ...reviewedPreflightContext.identity }, attemptStartIdentity: { ...attemptContext.identity },
    directRootContract: { existingParent: EXECUTOR_PATHS.existingParent, profileRoot: EXECUTOR_PATHS.profileRoot, trace: EXECUTOR_PATHS.trace, executorCreatedRoot: false },
    materialization: { file: EXPECTED_ARGUMENT_VECTOR[0], args: EXPECTED_ARGUMENT_VECTOR.slice(1), argumentVector: [...EXPECTED_ARGUMENT_VECTOR], authorizedChildMaterialized: true },
    execution: { validationFailure: null, profileSpawnApiInvocationCount: 1, launcherExecuted: true, profileExecuted: true, telemetryProduced: true, authorityRunCandidate: true, authorityPass: false, retryCount: 0, shell: false, externalTimeout: null, exitCode: 0, signal: null, closeObserved: true, synchronousSpawnThrow: false, durationNanoseconds: "25", events: [{ sequence: 1, type: "spawn" }, { sequence: 4, type: "exit", exitCode: 0, signal: null }, { sequence: 5, type: "close", exitCode: 0, signal: null }] },
    streams: { separated: true, stdout: { byteCount: stdoutBytes.length, base64: stdoutBytes.toString("base64"), sha256: sha256(stdoutBytes) }, stderr: { byteCount: stderrBytes.length, base64: stderrBytes.toString("base64"), sha256: sha256(stderrBytes) }, taggedCallbackOrder: [{ sequence: 2, stream: "stdout", byteCount: stdoutBytes.length, base64: stdoutBytes.toString("base64"), sha256: sha256(stdoutBytes) }, { sequence: 3, stream: "stderr", byteCount: stderrBytes.length, base64: stderrBytes.toString("base64"), sha256: sha256(stderrBytes) }] },
    preState: { existingParent: { path: EXECUTOR_PATHS.existingParent, realpath: EXECUTOR_PATHS.existingParent, type: "directory", exists: true, symlink: false }, profileRoot: { path: EXECUTOR_PATHS.profileRoot, exists: false, lstatErrorCode: "ENOENT" }, trace: { path: EXECUTOR_PATHS.trace, exists: false, lstatErrorCode: "ENOENT" }, processInspection: zeroProcess() },
    postStateResult: { status: "fulfilled", value: { existingParent: { path: EXECUTOR_PATHS.existingParent, realpath: EXECUTOR_PATHS.existingParent, type: "directory", exists: true, symlink: false }, profileRoot: { path: EXECUTOR_PATHS.profileRoot, exists: true, type: "directory" }, trace: { path: EXECUTOR_PATHS.trace, exists: true, type: "regular-file" }, processInspection: zeroProcess() } },
    traceResult: { status: "fulfilled", value: { path: EXECUTOR_PATHS.trace, present: true, headerPresent: true, byteCount: Buffer.byteLength(repairedAuthorityBytes), lineCount: 1530, sha256: authorityHash } },
    postChildInspectionFailure: false, prohibitedActions: { ...prohibitedActions }, audit: { completeMarkerPresent: true, strict681AuditPerformed: false },
  };
}
function validateTerminalFixture(value: any) { const bytes = canonicalBytes(value); return validateTerminalEvidence(bytes, sha256(bytes), authorityHash, { preflightIdentity: reviewedPreflightContext.identity, attemptIdentity: attemptContext.identity }); }
const terminalForContextBytes = canonicalBytes(terminalFixture());
const evidenceContext = {
  invocation: { cwd: EXECUTOR_PATHS.workingDirectory, execPath: EXPECTED_ARGUMENT_VECTOR[0], argv: [EXPECTED_ARGUMENT_VECTOR[0], EXECUTOR_PATHS.validator, "--official-v5.5.33", "--preflight-sha256", sha256(reviewedPreflightBytes), "--terminal-evidence-sha256", sha256(terminalForContextBytes), "--authority-sha256", authorityHash] },
  bindings: [
    { path: ".plan/rtcc-preview-v5.5.33.md", sha256: EXECUTOR_BINDINGS.planSha256 },
    { path: ".plan/launchers/rtcc-v5.5.33-production-SHA256SUMS", sha256: EXECUTOR_BINDINGS.productionManifestSha256 },
    { path: "scripts/validation/rtcc-v3-structural-telemetry.mjs", sha256: "ab5405405dd04ab3ee909029097a7319f1c43ec78a3e11ed790b97835ab0442c" },
    { path: "scripts/validation/rtcc-v3-inventory-execution-plan.mjs", sha256: "076141d2723a24f14d49898a442c4cbc410f0690948060c463be5a826d4d3fb9" },
    { path: "scripts/validation/rtcc-v3-route-semantics.mjs", sha256: "2f930258a9f3ffa0f0ee2efc4746e9ec4f766103d0e1a8c8f822f40bd2676b0d" },
    { path: ".plan/launchers/rtcc-v5.5.33-profile-preflight.json", sha256: sha256(reviewedPreflightBytes) },
    { path: ".plan/launchers/rtcc-v5.5.33-execution-attempt-start.json", sha256: sha256(attemptBytes) },
    { path: ".plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json", sha256: sha256(terminalForContextBytes) },
  ],
};

describe("complete-route profile v4", () => {
  it("validates the repaired authority as semantic pass with the same 18 blocker no-go", () => {
    expect(repairedReport).toMatchObject({ validatorResult: "pass", structuralResult: "pass", engineResult: "pass", routeSemanticResult: "pass", unresolvedBlockerResult: "no-go", releaseResult: "no-go", routeSemanticViolationCount: 0 });
    expect(repairedReport.checkSummary).toEqual({ structural: { passed: 24, failed: 0, total: 24 }, inventory: { passed: 4932, failed: 0, total: 4932 } });
    expect(repairedReport.inventoryCounts).toEqual({ duplicate: 47, runnable: 681, total: 746, unresolved: 18 });
    expect(repairedReport.unresolvedBlockers).toEqual(referenceBlockers);
  });

  it("builds a compact report without authority bytes, inventory, checks, or violations", () => {
    expect(assertCompactValidationSchema(compactValidation)).toBe(true);
    expect(compactValidation.authority).toMatchObject({ lineCount: 1530 });
    expect(compactValidation).not.toHaveProperty("authorityBytes");
    expect(compactValidation).not.toHaveProperty("inventory");
    expect(compactValidation).not.toHaveProperty("checks");
    expect(compactValidation).not.toHaveProperty("violations");
    expect(Buffer.byteLength(`${JSON.stringify(compactValidation, null, 2)}\n`)).toBeLessThan(10_000);
  });

  it("accepts exact canonical reviewed-preflight, attempt, and terminal evidence schemas", () => {
    expect(reviewedPreflightContext.identity).toEqual({ path: V4_PATHS.preflight, sha256: sha256(reviewedPreflightBytes), byteCount: reviewedPreflightBytes.length });
    expect(attemptContext.identity).toEqual({ path: V4_PATHS.attempt, sha256: sha256(attemptBytes), byteCount: attemptBytes.length });
    expect(validateTerminalFixture(terminalFixture()).result).toBe("audit-required");
  });

  it.each([
    ["sol review", (value: any) => { value.solReview.status = "PENDING"; }],
    ["current identity", (value: any) => { value.identities.routePatternTest.sha256 = "0".repeat(64); }],
    ["snapshot", (value: any) => { value.snapshot.dependencyView.linkCount = 1847; }],
    ["frozen lineage", (value: any) => { value.frozenLineage.authorityTrace.finalLf = false; }],
    ["invocation", (value: any) => { value.invocation.argumentVector[3] = `${EXECUTOR_PATHS.profileRoot}/nested`; }],
    ["zero state", (value: any) => { value.observedZeroState.matchingProcessCount = 1; }],
    ["extra field", (value: any) => { value.extra = true; }],
  ])("rejects reviewed-preflight %s drift", (_name, mutate) => {
    const value = structuredClone(reviewedPreflight); mutate(value); const bytes = canonicalBytes(value);
    expect(() => validatePreflightEvidence(bytes, sha256(bytes))).toThrow();
  });

  it.each([
    ["header", (value: any) => { value.complete = false; }],
    ["command", (value: any) => { value.command.argumentVector[2] = "--dry-run"; }],
    ["hash bindings", (value: any) => { value.hashBindings.routePatternTestSha256 = "0".repeat(64); }],
    ["root policy", (value: any) => { value.directRootContract.executorCreatesRoot = true; }],
    ["zero state", (value: any) => { value.profileSpawnApiInvocationCount = 1; }],
    ["extra field", (value: any) => { value.extra = true; }],
  ])("rejects attempt-marker %s drift", (_name, mutate) => { const value = structuredClone(attemptStart); mutate(value); expect(() => validateAttemptStart(canonicalBytes(value))).toThrow(); });

  it.each([
    ["hash bindings", (value: any) => { value.hashBindings.executorSha256 = "0".repeat(64); }],
    ["preflight identity", (value: any) => { value.reviewedPreflightIdentity.byteCount += 1; }],
    ["attempt identity", (value: any) => { value.attemptStartIdentity.sha256 = "0".repeat(64); }],
    ["materialization", (value: any) => { value.materialization.authorizedChildMaterialized = false; }],
    ["spawn count", (value: any) => { value.execution.profileSpawnApiInvocationCount = 2; }],
    ["exit", (value: any) => { value.execution.exitCode = 1; }],
    ["signal", (value: any) => { value.execution.signal = "SIGTERM"; }],
    ["close", (value: any) => { value.execution.closeObserved = false; }],
    ["events", (value: any) => { value.execution.events[1].sequence = 3; }],
    ["duration", (value: any) => { value.execution.durationNanoseconds = "0"; }],
    ["stream bytes", (value: any) => { value.streams.stdout.byteCount = 1; }],
    ["stream base64", (value: any) => { value.streams.stderr.base64 = "!"; }],
    ["stream hash", (value: any) => { value.streams.stdout.sha256 = "0".repeat(64); }],
    ["callback order", (value: any) => { value.streams.taggedCallbackOrder.push({ sequence: 2, stream: "stdout", byteCount: 0, base64: "", sha256: emptyHash }); }],
    ["pre state", (value: any) => { value.preState.profileRoot.exists = true; }],
    ["post state", (value: any) => { value.postStateResult.value.profileRoot.type = "regular-file"; }],
    ["post process", (value: any) => { value.postStateResult.value.processInspection.exactMatchingCount = 1; value.postStateResult.value.processInspection.matchedPids = [42]; }],
    ["trace identity", (value: any) => { value.traceResult.value.sha256 = "0".repeat(64); }],
    ["post inspection", (value: any) => { value.postChildInspectionFailure = true; }],
    ["prohibited actions", (value: any) => { value.prohibitedActions.browserExecuted = true; }],
    ["audit", (value: any) => { value.audit.strict681AuditPerformed = true; }],
    ["extra field", (value: any) => { value.extra = true; }],
  ])("rejects terminal-evidence %s drift", (_name, mutate) => { const value = terminalFixture(); mutate(value); expect(() => validateTerminalFixture(value)).toThrow(); });

  it("rejects the frozen predecessor authority because its 31 UUID violations remain", () => {
    const oldRecords = parseJsonl(readFileSync(oldAuthorityPath, "utf8"));
    expect(() => validateCompactTrace(oldRecords, referenceBlockers, { ...AUTHORITY_POLICY, structural: { ...AUTHORITY_POLICY.structural, header: { ...AUTHORITY_POLICY.structural.header, productionAggregate: "ac1344e8c36f436a5d3e8f5e83dc9bb8dfd649a7255a38d5577c9ee2dd87b5a8" } } })).toThrow("route-semantic-violations-present");
  });

  it("rejects any ordered blocker drift even when all validator checks pass", () => {
    const drifted = structuredClone(referenceBlockers);
    [drifted[0], drifted[1]] = [drifted[1], drifted[0]];
    expect(() => validateCompactTrace(repairedRecords, drifted)).toThrow("unresolved-blocker-drift");
  });

  it.each([
    ["result", (value: any) => { value.releaseResult = "go"; }],
    ["blocker", (value: any) => { value.unresolvedBlockers[0].reason = "forged"; }],
    ["extra", (value: any) => { value.inventory = {}; }],
    ["count", (value: any) => { value.inventoryCounts.runnable = 680; }],
  ])("rejects compact schema %s drift", (_name, mutate) => { const value = structuredClone(compactValidation); mutate(value); expect(() => assertCompactValidationSchema(value)).toThrow("compact-validation-schema-drift"); });

  it("persists exactly two canonical exclusive artifacts in order", () => {
    const directory = isolatedTemp();
    const paths = [join(directory, "validation.json"), join(directory, "evidence.json")];
    const result = persistCompactArtifacts({ paths, validation: compactValidation, context: evidenceContext });
    expect(result.bytes).toHaveLength(2);
    expect(readFileSync(paths[0]!)).toEqual(result.bytes[0]);
    expect(readFileSync(paths[1]!)).toEqual(result.bytes[1]);
    expect(() => persistCompactArtifacts({ paths, validation: compactValidation, context: evidenceContext })).toThrow(/EEXIST/);
  });

  it("rejects validator invocation or consumed-attempt run-binding drift before writing", () => {
    for (const mutate of [(context: any) => { context.invocation.argv[2] = "--other"; }, (context: any) => { context.bindings[6].path = "attempt-wrong"; }]) {
      const context = structuredClone(evidenceContext); mutate(context); let writes = 0;
      expect(() => persistCompactArtifacts({ paths: ["validation", "evidence"], validation: compactValidation, context, write: () => { writes += 1; } })).toThrow("compact-run-evidence-schema-drift");
      expect(writes).toBe(0);
    }
  });

  it("treats a real second-output wx failure as terminal and keeps the first compact bytes immutable", () => {
    const directory = isolatedTemp(); const validationPath = join(directory, "validation.json"); const evidencePath = join(directory, "evidence.json");
    writeFileSync(evidencePath, "sentinel\n");
    expect(() => persistCompactArtifacts({ paths: [validationPath, evidencePath], validation: compactValidation, context: evidenceContext })).toThrow(/EEXIST/);
    const firstBytes = readFileSync(validationPath); expect(readFileSync(evidencePath, "utf8")).toBe("sentinel\n");
    expect(() => persistCompactArtifacts({ paths: [validationPath, evidencePath], validation: compactValidation, context: evidenceContext })).toThrow(/EEXIST/);
    expect(readFileSync(validationPath)).toEqual(firstBytes); expect(readFileSync(evidencePath, "utf8")).toBe("sentinel\n");
  });

  it.each([0, 1])("stops wx persistence terminally at write %i", (failureIndex) => {
    const writes: string[] = [];
    expect(() => persistCompactArtifacts({ paths: ["validation", "evidence"], validation: compactValidation, context: evidenceContext, write: (path: string) => { if (writes.length === failureIndex) throw new Error("injected-write"); writes.push(path); } })).toThrow("injected-write");
    expect(writes).toHaveLength(failureIndex);
  });

  it("requires the exact future official argument relation", () => {
    const hashes = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    expect(parseOfficialArguments(["--official-v5.5.33", "--preflight-sha256", hashes[0], "--terminal-evidence-sha256", hashes[1], "--authority-sha256", hashes[2]])).toEqual({ preflightSha256: hashes[0], terminalSha256: hashes[1], authoritySha256: hashes[2] });
    for (const args of [[], ["--official-v5.5.33"], ["--official-v5.5.33", "--preflight-sha256", "x", "--terminal-evidence-sha256", hashes[1], "--authority-sha256", hashes[2]]]) expect(() => parseOfficialArguments(args)).toThrow();
  });

  it("never creates reserved official paths while exercising temporary persistence", () => {
    expect(existsSync(".plan/launchers/rtcc-v5.5.33-profile-preflight.json")).toBe(false);
    expect(existsSync(".plan/launchers/rtcc-v5.5.33-execution-attempt-start.json")).toBe(false);
    expect(existsSync(".plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json")).toBe(false);
    expect(existsSync(".plan/launchers/rtcc-v5.5.33-profile-validation.json")).toBe(false);
    expect(existsSync(".plan/launchers/rtcc-v5.5.33-validator-run-evidence.json")).toBe(false);
  });

  it("uses real wx writes for standalone byte persistence", () => {
    const path = join(isolatedTemp(), "exclusive.json");
    writeExclusiveBytes(path, Buffer.from("{}\n"));
    expect(readFileSync(path, "utf8")).toBe("{}\n");
    expect(() => writeExclusiveBytes(path, Buffer.from("changed\n"))).toThrow(/EEXIST/);
  });
});
