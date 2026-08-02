import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStructuralTelemetry, parseJsonl } from "./validation/rtcc-v3-structural-telemetry.mjs";
import { validateInventoryExecutionPlan } from "./validation/rtcc-v3-inventory-execution-plan.mjs";
import { evaluateRouteSemantics } from "./validation/rtcc-v3-route-semantics.mjs";
import { BINDINGS as EXECUTOR_BINDINGS, EXPECTED_ARGUMENT_VECTOR, PATHS as EXECUTOR_PATHS, assertReviewedPreflightSchema } from "../.plan/launchers/rtcc-v5.5.33-exact-once-executor.mjs";

const ROOT = "/Users/lky/project/reactpreview";
const NODE_PATH = "/Users/lky/.nvm/versions/node/v22.22.2/bin/node";
const VALIDATOR_PATH = `${ROOT}/scripts/validate-rtcc-preview-complete-route-profile-v4.mjs`;
const AUTHORITY_PATH = "/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-33-a/profile.jsonl";
const PREFLIGHT_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-profile-preflight.json`;
const ATTEMPT_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-execution-attempt-start.json`;
const TERMINAL_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json`;
const PROFILE_VALIDATION_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-profile-validation.json`;
const RUN_EVIDENCE_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-validator-run-evidence.json`;
const REFERENCE_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.31-semantic-report.json`;
const PRODUCTION_MANIFEST_PATH = `${ROOT}/.plan/launchers/rtcc-v5.5.33-production-SHA256SUMS`;
const PLAN_SHA256 = "b3e35302ccd9af62959ab405f4229042ba29378d7d8af1a9fb94c5c3114a27cb";
const PRODUCTION_SHA256 = "40f68936746ed9ff7818cbf52fa1eb3f5e981084a4641964a470058c35eeac97";
const REFERENCE_SHA256 = "b5a7796195eaa60d0c7cee142d84b2eec9475424d34cec1bfe48570749aef322";
const REFERENCE_BLOCKERS_SHA256 = "15a087c139953a277c8f36bbc016b1baaa226006d05d80cfd87fa0e9d220c4c8";
const MODULE_BINDINGS = Object.freeze([
  { path: "scripts/validation/rtcc-v3-structural-telemetry.mjs", sha256: "ab5405405dd04ab3ee909029097a7319f1c43ec78a3e11ed790b97835ab0442c" },
  { path: "scripts/validation/rtcc-v3-inventory-execution-plan.mjs", sha256: "076141d2723a24f14d49898a442c4cbc410f0690948060c463be5a826d4d3fb9" },
  { path: "scripts/validation/rtcc-v3-route-semantics.mjs", sha256: "2f930258a9f3ffa0f0ee2efc4746e9ec4f766103d0e1a8c8f822f40bd2676b0d" },
]);

export const AUTHORITY_POLICY = Object.freeze({
  structural: {
    lineCount: 1530, progressCount: 1528, executionCount: 1496, bundleCount: 68,
    checkpoints: [1, 64, 128, 256, 512, 681], requiredOrdinals: [...Array(64).keys()].map((number) => number + 1).concat([128, 256, 512, 681]),
    phaseOrder: ["prepare", "enumerate", "replay", "execution", "finalize"],
    header: { schemaVersion: 1, telemetryPolicyVersion: 4, isolationPolicyVersion: 3, maximumEvents: 1664, probeCapMs: 300000, productionAggregate: PRODUCTION_SHA256, sourceManifestDigest: "6ff4218223f36aa0e79238320ea27063bb3ac60de00d6d8e92b1863c48bb803a", dependencyViewDigest: "e72d1ee18d1fbb4aa5d3870fdad38222dcb24d83646840f6ac22f61a7f6fab86", confinementPolicyDigest: "3d298017221f509418878fe98353c1137c86c5f0a53b35dc3f0cbe97f6de53a8", isolationPolicyDigest: "a88baf7521baffa65f4f7c6257ce53e3372422b623f05eef31ba506e1ca2c66d", telemetryPolicyDigest: "5d49da6914ca52b9dd41d0117cf1e2be1434636395a9db7e0afbeb0c50ee338f" },
    bundleKeys: ["diagnosticsVersion","bundleMeasuredMicros","frontierCount","rawSourceReadCount","rawSourceReadMicros","inventoryReadRequestCount","inventoryReadPathCacheHitCount","sliceRequestCount","sliceComputationCount","sliceHitCount","sliceLookupMicros","inventoryRequestCount","inventoryComputationCount","inventoryHitCount","inventoryLookupMicros","queueIterationCount","queuePeakLength","queueSortCount","queueSortMicros","edgeVisitCount","optionalClosureProbeCount","optionalClosureMicros","resolveModuleCount","resolveModuleMicros","authoredPathCheckCount","authoredPathCheckMicros","frontierFinalizeMicros","frontierIdentityMicros","candidateSelectionSortCount","candidateSelectionMicros"],
  },
  inventory: { analysisCount: 725, replayCount: 730, total: 746, runnable: 681, duplicate: 47, unresolved: 18, maximumAnalysisPasses: 4096, maximumBranches: 8192, maximumDepth: 64, replayPolicyDigest: "274a9aecd52944871f1a88940416e3a2e485490d8d287f0e0235a635c7e89601", executionPlanPolicyDigest: "e0aa9adf1c3c766fb629e7048ef9ee949eeef49a7522e2ede0889d0ced58eb6e", mountFallbackEvidenceDigest: "d17d8781254638a9e879ece557268d55e155c634694ffbaf6fb03eaf9687f3e7" },
});

export const V4_PATHS = Object.freeze({ authority: AUTHORITY_PATH, preflight: PREFLIGHT_PATH, attempt: ATTEMPT_PATH, terminal: TERMINAL_PATH, profileValidation: PROFILE_VALIDATION_PATH, runEvidence: RUN_EVIDENCE_PATH, reference: REFERENCE_PATH });
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function assertCondition(condition, code) { if (!condition) throw new Error(code); }
const canonicalIso = (value) => { if (typeof value !== "string") return false; try { return new Date(value).toISOString() === value; } catch { return false; } };
const regularIdentity = (path, raw) => ({ path, sha256: sha256(raw), byteCount: raw.length });
export const expectedExecutorHashBindings = (read = readFileSync) => ({ ...EXECUTOR_BINDINGS, executorSha256: sha256(read(EXECUTOR_PATHS.executor)) });

export function readReferenceBlockers(read = readFileSync) {
  const raw = read(REFERENCE_PATH);
  assertCondition(sha256(raw) === REFERENCE_SHA256, "reference-semantic-report-sha256-mismatch");
  const value = JSON.parse(raw.toString("utf8"));
  assertCondition(value.kind === "semantic-report" && value.semanticResult === "fail" && value.releaseResult === "no-go" && Array.isArray(value.blockers) && value.blockers.length === 18, "reference-semantic-report-contract-mismatch");
  assertCondition(sha256(JSON.stringify(value.blockers)) === REFERENCE_BLOCKERS_SHA256, "reference-blockers-sha256-mismatch");
  return value.blockers;
}

export function validateCompactTrace(records, expectedBlockers, policy = AUTHORITY_POLICY) {
  const structural = validateStructuralTelemetry(records, policy.structural);
  const inventory = validateInventoryExecutionPlan(records.at(-1)?.inventory, policy.inventory);
  const semantic = evaluateRouteSemantics(records.at(-1)?.inventory?.entries ?? []);
  const structuralFailed = structural.checks.filter((check) => !check.passed);
  const inventoryFailed = inventory.checks.filter((check) => !check.passed);
  assertCondition(structural.checks.length === 24 && structuralFailed.length === 0, "structural-validation-failed");
  assertCondition(inventory.checks.length === 4932 && inventoryFailed.length === 0, "inventory-validation-failed");
  assertCondition(structural.engineTerminal?.status === "completed" && structural.engineTerminal.executionPlanCompleted === 681 && structural.engineTerminal.executionPlanTotal === 681, "engine-terminal-failed");
  assertCondition(semantic.violations.length === 0, "route-semantic-violations-present");
  assertCondition(Array.isArray(expectedBlockers) && expectedBlockers.length === 18 && JSON.stringify(semantic.blockers) === JSON.stringify(expectedBlockers), "unresolved-blocker-drift");
  return {
    validatorResult: "pass",
    structuralResult: "pass",
    engineResult: "pass",
    routeSemanticResult: "pass",
    unresolvedBlockerResult: "no-go",
    releaseResult: "no-go",
    checkSummary: { structural: { passed: 24, failed: 0, total: 24 }, inventory: { passed: 4932, failed: 0, total: 4932 } },
    telemetry: { progressCount: structural.progressCount, bundleCount: structural.bundleCount },
    engineTerminal: structural.engineTerminal,
    inventoryCounts: inventory.inventory.counts,
    routeSemanticViolationCount: 0,
    unresolvedBlockers: semantic.blockers,
  };
}

const VALIDATION_KEYS = ["schemaVersion", "kind", "release", "validator", "authority", "production", "reference", "validatorResult", "structuralResult", "engineResult", "routeSemanticResult", "unresolvedBlockerResult", "releaseResult", "checkSummary", "telemetry", "engineTerminal", "inventoryCounts", "routeSemanticViolationCount", "unresolvedBlockers"];
export function buildCompactValidation(authorityBytes, report) {
  const records = parseJsonl(authorityBytes);
  const value = {
    schemaVersion: 4,
    kind: "rtcc-preview-compact-profile-validation",
    release: "v5.5.33",
    validator: "rtcc-preview-complete-route-profile-v4",
    authority: { path: AUTHORITY_PATH, sha256: sha256(authorityBytes), byteCount: Buffer.byteLength(authorityBytes), lineCount: records.length },
    production: { manifestPath: ".plan/launchers/rtcc-v5.5.33-production-SHA256SUMS", sha256: PRODUCTION_SHA256, entries: 36 },
    reference: { path: ".plan/launchers/rtcc-v5.5.31-semantic-report.json", sha256: REFERENCE_SHA256, blockerSha256: REFERENCE_BLOCKERS_SHA256 },
    ...report,
  };
  assertCompactValidationSchema(value);
  return value;
}

export function assertCompactValidationSchema(value) {
  const valid = exact(value, VALIDATION_KEYS) && value.schemaVersion === 4 && value.kind === "rtcc-preview-compact-profile-validation" && value.release === "v5.5.33" && value.validator === "rtcc-preview-complete-route-profile-v4"
    && exact(value.authority, ["path", "sha256", "byteCount", "lineCount"]) && value.authority.path === AUTHORITY_PATH && hex(value.authority.sha256) && Number.isSafeInteger(value.authority.byteCount) && value.authority.byteCount > 0 && value.authority.lineCount === 1530
    && exact(value.production, ["manifestPath", "sha256", "entries"]) && value.production.sha256 === PRODUCTION_SHA256 && value.production.entries === 36
    && exact(value.reference, ["path", "sha256", "blockerSha256"]) && value.reference.sha256 === REFERENCE_SHA256 && value.reference.blockerSha256 === REFERENCE_BLOCKERS_SHA256
    && value.validatorResult === "pass" && value.structuralResult === "pass" && value.engineResult === "pass" && value.routeSemanticResult === "pass" && value.unresolvedBlockerResult === "no-go" && value.releaseResult === "no-go"
    && JSON.stringify(value.checkSummary) === JSON.stringify({ structural: { passed: 24, failed: 0, total: 24 }, inventory: { passed: 4932, failed: 0, total: 4932 } })
    && value.telemetry?.progressCount === 1528 && value.telemetry?.bundleCount === 68
    && JSON.stringify(value.engineTerminal) === JSON.stringify({ status: "completed", executionPlanCompleted: 681, executionPlanTotal: 681 })
    && JSON.stringify(value.inventoryCounts) === JSON.stringify({ duplicate: 47, runnable: 681, total: 746, unresolved: 18 })
    && value.routeSemanticViolationCount === 0 && Array.isArray(value.unresolvedBlockers) && value.unresolvedBlockers.length === 18 && sha256(JSON.stringify(value.unresolvedBlockers)) === REFERENCE_BLOCKERS_SHA256
    && !("authorityBytes" in value) && !("inventory" in value) && !("checks" in value) && !("violations" in value);
  if (!valid) throw new Error("compact-validation-schema-drift");
  return true;
}

export function parseOfficialArguments(args) {
  assertCondition(Array.isArray(args) && args.length === 7, "official-argument-count-mismatch");
  assertCondition(args[0] === "--official-v5.5.33" && args[1] === "--preflight-sha256" && hex(args[2]) && args[3] === "--terminal-evidence-sha256" && hex(args[4]) && args[5] === "--authority-sha256" && hex(args[6]), "official-arguments-invalid");
  return { preflightSha256: args[2], terminalSha256: args[4], authoritySha256: args[6] };
}

function verifyProductionManifest(read) {
  const raw = read(PRODUCTION_MANIFEST_PATH);
  assertCondition(sha256(raw) === PRODUCTION_SHA256, "production-manifest-sha256-mismatch");
  const lines = raw.toString("utf8").split("\n");
  assertCondition(lines.at(-1) === "" && lines.length === 37, "production-manifest-contract-mismatch");
  for (const line of lines.slice(0, -1)) { const match = /^([a-f0-9]{64})  (.+)$/u.exec(line); assertCondition(match !== null && sha256(read(resolve(ROOT, match[2]))) === match[1], `production-binding-drift:${match?.[2] ?? "invalid"}`); }
}

const EXPECTED_ZERO_STATE = Object.freeze({ matchingProcessCount: 0, profileRootAbsent: true, traceAbsent: true, attemptStartAbsent: true, terminalEvidenceAbsent: true, profileValidationAbsent: true, validatorEvidenceAbsent: true, dryRunProfileSpawnApiInvocationCount: 0, dryRunFilesystemWriteCount: 0 });
const EXPECTED_PROHIBITED = Object.freeze({ retryPerformed: false, externalTimeoutUsed: false, killTimerUsed: false, shellWrapperUsed: false, secondRootUsed: false, rootDeletedOrReused: false, recursiveWorkaroundUsed: false, executorCreatedRoot: false, browserExecuted: false, chromiumExecuted: false, serverExecuted: false, campaignExecuted: false });
const PROCESS_KEYS = ["method", "shell", "processInspectionApiInvocationCount", "candidateCount", "excludedSelfCount", "exactMatchingCount", "matchedPids"];
const ABSENT_PATH_KEYS = ["path", "exists", "lstatErrorCode"];
const EXISTING_PARENT_KEYS = ["path", "realpath", "type", "exists", "symlink"];

export function validatePreflightEvidence(raw, expectedSha256, read = readFileSync) {
  assertCondition(sha256(raw) === expectedSha256, "profile-preflight-sha256-mismatch");
  const value = JSON.parse(raw.toString("utf8"));
  assertCondition(raw.at(-1) === 0x0a && raw.equals(canonicalBytes(value)), "profile-preflight-canonical-bytes-mismatch");
  assertReviewedPreflightSchema(value);
  const paths = {
    plan: EXECUTOR_PATHS.plan, v5532Plan: EXECUTOR_PATHS.v5532Plan, routePatternSource: EXECUTOR_PATHS.routePatternSource, routePatternTest: EXECUTOR_PATHS.routePatternTest,
    productionManifest: EXECUTOR_PATHS.productionManifest, canonical: EXECUTOR_PATHS.canonical, executor: EXECUTOR_PATHS.executor, executorTest: EXECUTOR_PATHS.executorTest,
    validator: EXECUTOR_PATHS.validator, validatorTest: EXECUTOR_PATHS.validatorTest, node: EXPECTED_ARGUMENT_VECTOR[0], launcher: EXPECTED_ARGUMENT_VECTOR[1], cliSource: EXECUTOR_PATHS.cliSource,
  };
  for (const [name, path] of Object.entries(paths)) assertCondition(value.identities[name].path === path && value.identities[name].sha256 === sha256(read(path)), `profile-preflight-identity-drift:${name}`);
  const expectedSnapshot = {
    sourceManifest: { path: EXECUTOR_PATHS.sourceManifest, rawSha256: EXECUTOR_BINDINGS.sourceManifestRawSha256, digest: EXPECTED_ARGUMENT_VECTOR[13], fileCount: 11724 },
    dependencyView: { path: EXECUTOR_PATHS.dependencyView, rawSha256: EXECUTOR_BINDINGS.dependencyViewRawSha256, digest: EXPECTED_ARGUMENT_VECTOR[15], confinementPolicyDigest: EXPECTED_ARGUMENT_VECTOR[17], approvedDependencyRoots: [EXPECTED_ARGUMENT_VECTOR[19]], linkCount: 1848 },
    archive: { path: EXECUTOR_PATHS.snapshotArchive, sha256: EXECUTOR_BINDINGS.snapshotArchiveSha256 },
  };
  assertCondition(JSON.stringify(value.snapshot) === JSON.stringify(expectedSnapshot), "profile-preflight-snapshot-drift");
  const oldTrace = read(EXECUTOR_PATHS.frozenAuthorityTrace);
  const expectedFrozen = {
    gate: { path: EXECUTOR_PATHS.v5531Gate, sha256: EXECUTOR_BINDINGS.v5531GateSha256, bindingCount: 21 },
    sums: { path: EXECUTOR_PATHS.v5531Sums, sha256: EXECUTOR_BINDINGS.v5531SumsSha256, resultCount: 5 },
    authorityRoot: { path: EXECUTOR_PATHS.frozenAuthorityRoot, realpath: EXECUTOR_PATHS.frozenAuthorityRoot, type: "directory", symlink: false, entries: ["profile.jsonl"] },
    authorityTrace: { path: EXECUTOR_PATHS.frozenAuthorityTrace, realpath: EXECUTOR_PATHS.frozenAuthorityTrace, type: "regular-file", symlink: false, sha256: EXECUTOR_BINDINGS.frozenAuthoritySha256, byteCount: 6037478, lineCount: 1530, finalLf: true },
  };
  assertCondition(sha256(read(EXECUTOR_PATHS.v5531Gate)) === EXECUTOR_BINDINGS.v5531GateSha256 && sha256(read(EXECUTOR_PATHS.v5531Sums)) === EXECUTOR_BINDINGS.v5531SumsSha256, "profile-preflight-frozen-lineage-file-drift");
  assertCondition(sha256(oldTrace) === EXECUTOR_BINDINGS.frozenAuthoritySha256 && oldTrace.length === 6037478 && oldTrace.at(-1) === 0x0a && oldTrace.toString("utf8").split("\n").length - 1 === 1530, "profile-preflight-frozen-authority-drift");
  assertCondition(JSON.stringify(value.frozenLineage) === JSON.stringify(expectedFrozen), "profile-preflight-frozen-lineage-drift");
  const expectedInvocation = { workingDirectory: ROOT, argumentCount: 22, argumentVector: [...EXPECTED_ARGUMENT_VECTOR], profileRoot: EXECUTOR_PATHS.profileRoot, executionPolicy: { exactOnce: true, shell: false, externalTimeout: false, retry: false }, directRootPolicy: { existingParent: EXECUTOR_PATHS.existingParent, launcherCreatesRootNonrecursively: true, executorCreatesRoot: false, secondRootUsed: false } };
  assertCondition(JSON.stringify(value.invocation) === JSON.stringify(expectedInvocation), "profile-preflight-invocation-drift");
  assertCondition(JSON.stringify(value.observedZeroState) === JSON.stringify(EXPECTED_ZERO_STATE), "profile-preflight-zero-state-drift");
  return { value, identity: regularIdentity(PREFLIGHT_PATH, raw) };
}

export function validateAttemptStart(raw, read = readFileSync) {
  const value = JSON.parse(raw.toString("utf8"));
  const keys = ["schemaVersion", "kind", "release", "complete", "timestamp", "processId", "command", "hashBindings", "directRootContract", "authorizationConsumed", "profileSpawnApiInvocationCount", "launcherExecuted"];
  assertCondition(raw.at(-1) === 0x0a && raw.equals(canonicalBytes(value)) && exact(value, keys), "attempt-start-canonical-schema-mismatch");
  assertCondition(value.schemaVersion === 1 && value.kind === "rtcc-preview-execution-attempt-start" && value.release === "v5.5.33" && value.complete === true && canonicalIso(value.timestamp) && Number.isSafeInteger(value.processId) && value.processId > 0, "attempt-start-header-mismatch");
  assertCondition(exact(value.command, ["workingDirectory", "argumentVector"]) && JSON.stringify(value.command) === JSON.stringify({ workingDirectory: ROOT, argumentVector: [NODE_PATH, EXECUTOR_PATHS.executor, "--execute"] }), "attempt-start-command-mismatch");
  assertCondition(JSON.stringify(value.hashBindings) === JSON.stringify(expectedExecutorHashBindings(read)), "attempt-start-hash-bindings-mismatch");
  assertCondition(exact(value.directRootContract, ["existingParent", "profileRoot", "trace", "launcherCreatesRootNonrecursively", "executorCreatesRoot"]) && JSON.stringify(value.directRootContract) === JSON.stringify({ existingParent: EXECUTOR_PATHS.existingParent, profileRoot: EXECUTOR_PATHS.profileRoot, trace: EXECUTOR_PATHS.trace, launcherCreatesRootNonrecursively: true, executorCreatesRoot: false }), "attempt-start-root-contract-mismatch");
  assertCondition(value.authorizationConsumed === true && value.profileSpawnApiInvocationCount === 0 && value.launcherExecuted === false, "attempt-start-zero-state-mismatch");
  return { value, identity: regularIdentity(ATTEMPT_PATH, raw) };
}

function validateStreamRecord(value, code) {
  assertCondition(exact(value, ["byteCount", "base64", "sha256"]) && Number.isSafeInteger(value.byteCount) && value.byteCount >= 0 && typeof value.base64 === "string" && hex(value.sha256), code);
  const bytes = Buffer.from(value.base64, "base64");
  assertCondition(bytes.toString("base64") === value.base64 && bytes.length === value.byteCount && sha256(bytes) === value.sha256, code);
  return bytes;
}
function validateProcessZero(value, code) { assertCondition(exact(value, PROCESS_KEYS) && JSON.stringify(value) === JSON.stringify({ method: "/bin/ps -Ao pid=,ppid=,command=", shell: false, processInspectionApiInvocationCount: 1, candidateCount: 0, excludedSelfCount: 0, exactMatchingCount: 0, matchedPids: [] }), code); }

export function validateTerminalEvidence(raw, terminalSha256, authoritySha256, { preflightIdentity, attemptIdentity, read = readFileSync } = {}) {
  assertCondition(sha256(raw) === terminalSha256, "terminal-evidence-sha256-mismatch");
  const terminal = JSON.parse(raw.toString("utf8"));
  const topKeys = ["schemaVersion", "kind", "release", "complete", "result", "hashBindings", "reviewedPreflightIdentity", "attemptStartIdentity", "directRootContract", "materialization", "execution", "streams", "preState", "postStateResult", "traceResult", "postChildInspectionFailure", "prohibitedActions", "audit"];
  assertCondition(raw.at(-1) === 0x0a && raw.equals(canonicalBytes(terminal)) && exact(terminal, topKeys) && terminal.schemaVersion === 1 && terminal.kind === "rtcc-preview-execution-terminal-evidence" && terminal.release === "v5.5.33" && terminal.complete === true && terminal.result === "audit-required", "terminal-evidence-contract-mismatch");
  assertCondition(JSON.stringify(terminal.hashBindings) === JSON.stringify(expectedExecutorHashBindings(read)), "terminal-hash-bindings-mismatch");
  assertCondition(exact(terminal.reviewedPreflightIdentity, ["path", "sha256", "byteCount"]) && JSON.stringify(terminal.reviewedPreflightIdentity) === JSON.stringify(preflightIdentity), "terminal-preflight-identity-mismatch");
  assertCondition(exact(terminal.attemptStartIdentity, ["path", "sha256", "byteCount"]) && JSON.stringify(terminal.attemptStartIdentity) === JSON.stringify(attemptIdentity), "terminal-attempt-identity-mismatch");
  assertCondition(exact(terminal.directRootContract, ["existingParent", "profileRoot", "trace", "executorCreatedRoot"]) && JSON.stringify(terminal.directRootContract) === JSON.stringify({ existingParent: EXECUTOR_PATHS.existingParent, profileRoot: EXECUTOR_PATHS.profileRoot, trace: EXECUTOR_PATHS.trace, executorCreatedRoot: false }), "terminal-root-contract-mismatch");
  assertCondition(exact(terminal.materialization, ["file", "args", "argumentVector", "authorizedChildMaterialized"]) && terminal.materialization.file === EXPECTED_ARGUMENT_VECTOR[0] && JSON.stringify(terminal.materialization.args) === JSON.stringify(EXPECTED_ARGUMENT_VECTOR.slice(1)) && JSON.stringify(terminal.materialization.argumentVector) === JSON.stringify(EXPECTED_ARGUMENT_VECTOR) && terminal.materialization.authorizedChildMaterialized === true, "terminal-materialization-mismatch");
  const executionKeys = ["validationFailure", "profileSpawnApiInvocationCount", "launcherExecuted", "profileExecuted", "telemetryProduced", "authorityRunCandidate", "authorityPass", "retryCount", "shell", "externalTimeout", "exitCode", "signal", "closeObserved", "synchronousSpawnThrow", "durationNanoseconds", "events"];
  const execution = terminal.execution;
  assertCondition(exact(execution, executionKeys) && execution.validationFailure === null && execution.profileSpawnApiInvocationCount === 1 && execution.launcherExecuted === true && execution.profileExecuted === true && execution.telemetryProduced === true && execution.authorityRunCandidate === true && execution.authorityPass === false && execution.retryCount === 0 && execution.shell === false && execution.externalTimeout === null && execution.exitCode === 0 && execution.signal === null && execution.closeObserved === true && execution.synchronousSpawnThrow === false && /^[1-9][0-9]*$/u.test(execution.durationNanoseconds), "terminal-execution-contract-mismatch");
  assertCondition(Array.isArray(execution.events) && execution.events.length === 3, "terminal-execution-events-mismatch");
  const [spawnEvent, exitEvent, closeEvent] = execution.events;
  assertCondition(exact(spawnEvent, ["sequence", "type"]) && spawnEvent.type === "spawn" && spawnEvent.sequence === 1 && exact(exitEvent, ["sequence", "type", "exitCode", "signal"]) && exitEvent.type === "exit" && exitEvent.exitCode === 0 && exitEvent.signal === null && exact(closeEvent, ["sequence", "type", "exitCode", "signal"]) && closeEvent.type === "close" && closeEvent.exitCode === 0 && closeEvent.signal === null && spawnEvent.sequence < exitEvent.sequence && exitEvent.sequence < closeEvent.sequence, "terminal-execution-events-mismatch");
  assertCondition(exact(terminal.streams, ["separated", "stdout", "stderr", "taggedCallbackOrder"]) && terminal.streams.separated === true && Array.isArray(terminal.streams.taggedCallbackOrder), "terminal-stream-contract-mismatch");
  const stdout = validateStreamRecord(terminal.streams.stdout, "terminal-stdout-integrity-mismatch"); const stderr = validateStreamRecord(terminal.streams.stderr, "terminal-stderr-integrity-mismatch");
  const pieces = { stdout: [], stderr: [] }; const sequenceValues = execution.events.map(({ sequence }) => sequence); let previousChunkSequence = 0;
  for (const chunk of terminal.streams.taggedCallbackOrder) { assertCondition(exact(chunk, ["sequence", "stream", "byteCount", "base64", "sha256"]) && (chunk.stream === "stdout" || chunk.stream === "stderr") && Number.isSafeInteger(chunk.sequence) && chunk.sequence > previousChunkSequence, "terminal-tagged-stream-schema-mismatch"); previousChunkSequence = chunk.sequence; const bytes = validateStreamRecord({ byteCount: chunk.byteCount, base64: chunk.base64, sha256: chunk.sha256 }, "terminal-tagged-stream-integrity-mismatch"); pieces[chunk.stream].push(bytes); sequenceValues.push(chunk.sequence); }
  assertCondition(Buffer.concat(pieces.stdout).equals(stdout) && Buffer.concat(pieces.stderr).equals(stderr), "terminal-stream-reconstruction-mismatch");
  const sortedSequences = [...sequenceValues].sort((left, right) => left - right); assertCondition(closeEvent.sequence === sequenceValues.length && JSON.stringify(sortedSequences) === JSON.stringify([...Array(sequenceValues.length).keys()].map((number) => number + 1)), "terminal-callback-order-mismatch");
  assertCondition(exact(terminal.preState, ["existingParent", "profileRoot", "trace", "processInspection"]) && exact(terminal.preState.existingParent, EXISTING_PARENT_KEYS) && JSON.stringify(terminal.preState.existingParent) === JSON.stringify({ path: EXECUTOR_PATHS.existingParent, realpath: EXECUTOR_PATHS.existingParent, type: "directory", exists: true, symlink: false }) && exact(terminal.preState.profileRoot, ABSENT_PATH_KEYS) && exact(terminal.preState.trace, ABSENT_PATH_KEYS) && JSON.stringify(terminal.preState.profileRoot) === JSON.stringify({ path: EXECUTOR_PATHS.profileRoot, exists: false, lstatErrorCode: "ENOENT" }) && JSON.stringify(terminal.preState.trace) === JSON.stringify({ path: EXECUTOR_PATHS.trace, exists: false, lstatErrorCode: "ENOENT" }), "terminal-pre-state-mismatch");
  validateProcessZero(terminal.preState.processInspection, "terminal-pre-process-mismatch");
  assertCondition(exact(terminal.postStateResult, ["status", "value"]) && terminal.postStateResult.status === "fulfilled" && exact(terminal.postStateResult.value, ["existingParent", "profileRoot", "trace", "processInspection"]), "terminal-post-state-mismatch");
  const post = terminal.postStateResult.value;
  assertCondition(JSON.stringify(post.existingParent) === JSON.stringify(terminal.preState.existingParent) && exact(post.profileRoot, ["path", "exists", "type"]) && JSON.stringify(post.profileRoot) === JSON.stringify({ path: EXECUTOR_PATHS.profileRoot, exists: true, type: "directory" }) && exact(post.trace, ["path", "exists", "type"]) && JSON.stringify(post.trace) === JSON.stringify({ path: AUTHORITY_PATH, exists: true, type: "regular-file" }), "terminal-post-state-mismatch");
  validateProcessZero(post.processInspection, "terminal-post-process-mismatch");
  assertCondition(exact(terminal.traceResult, ["status", "value"]) && terminal.traceResult.status === "fulfilled" && exact(terminal.traceResult.value, ["path", "present", "headerPresent", "byteCount", "lineCount", "sha256"]), "terminal-trace-identity-mismatch");
  const trace = terminal.traceResult.value; assertCondition(trace.path === AUTHORITY_PATH && trace.present === true && trace.headerPresent === true && Number.isSafeInteger(trace.byteCount) && trace.byteCount > 0 && trace.lineCount === 1530 && trace.sha256 === authoritySha256, "terminal-trace-identity-mismatch");
  assertCondition(terminal.postChildInspectionFailure === false, "terminal-post-child-inspection-failure");
  assertCondition(exact(terminal.prohibitedActions, Object.keys(EXPECTED_PROHIBITED)) && JSON.stringify(terminal.prohibitedActions) === JSON.stringify(EXPECTED_PROHIBITED), "terminal-prohibited-actions-mismatch");
  assertCondition(exact(terminal.audit, ["completeMarkerPresent", "strict681AuditPerformed"]) && terminal.audit.completeMarkerPresent === true && terminal.audit.strict681AuditPerformed === false, "terminal-audit-mismatch");
  return terminal;
}

export function preflightOfficialRun({ args, invocation, read = readFileSync, exists = existsSync }) {
  const parsed = parseOfficialArguments(args);
  assertCondition(process.cwd() === ROOT && process.execPath === NODE_PATH && process.version === "v22.22.2", "validator-runtime-identity-mismatch");
  assertCondition(JSON.stringify(invocation) === JSON.stringify({ cwd: ROOT, execPath: NODE_PATH, argv: [NODE_PATH, VALIDATOR_PATH, ...args] }), "validator-invocation-mismatch");
  assertCondition(!exists(PROFILE_VALIDATION_PATH) && !exists(RUN_EVIDENCE_PATH), "validator-output-exists");
  assertCondition(sha256(read(`${ROOT}/.plan/rtcc-preview-v5.5.33.md`)) === PLAN_SHA256, "plan-sha256-mismatch");
  verifyProductionManifest(read);
  for (const binding of MODULE_BINDINGS) assertCondition(sha256(read(resolve(ROOT, binding.path))) === binding.sha256, `validator-module-drift:${binding.path}`);
  const preflight = validatePreflightEvidence(read(PREFLIGHT_PATH), parsed.preflightSha256, read);
  const attempt = validateAttemptStart(read(ATTEMPT_PATH), read);
  const terminalRaw = read(TERMINAL_PATH);
  const terminal = validateTerminalEvidence(terminalRaw, parsed.terminalSha256, parsed.authoritySha256, { preflightIdentity: preflight.identity, attemptIdentity: attempt.identity, read });
  const authorityBytes = read(AUTHORITY_PATH); assertCondition(sha256(authorityBytes) === parsed.authoritySha256 && authorityBytes.at(-1) === 0x0a && authorityBytes.length === terminal.traceResult.value.byteCount, "authority-identity-mismatch");
  const blockers = readReferenceBlockers(read);
  return { authorityBytes, blockers, parsed, invocation, bindings: [{ path: ".plan/rtcc-preview-v5.5.33.md", sha256: PLAN_SHA256 }, { path: ".plan/launchers/rtcc-v5.5.33-production-SHA256SUMS", sha256: PRODUCTION_SHA256 }, ...MODULE_BINDINGS, { path: ".plan/launchers/rtcc-v5.5.33-profile-preflight.json", sha256: parsed.preflightSha256 }, { path: ".plan/launchers/rtcc-v5.5.33-execution-attempt-start.json", sha256: attempt.identity.sha256 }, { path: ".plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json", sha256: parsed.terminalSha256 }] };
}

function buildRunEvidence(validation, context) {
  return {
    schemaVersion: 1,
    kind: "rtcc-preview-compact-validator-run-evidence",
    release: "v5.5.33",
    invocation: context.invocation,
    authority: validation.authority,
    bindings: context.bindings,
    output: { path: ".plan/launchers/rtcc-v5.5.33-profile-validation.json", sha256: sha256(canonicalBytes(validation)) },
    results: { validator: "pass", engine: "pass", routeSemantic: "pass", unresolvedBlockers: "no-go", release: "no-go" },
    runCounts: { validator: 1, profile: 1, external: 0, retry: 0 },
    persistence: { exclusive: true, order: [".plan/launchers/rtcc-v5.5.33-profile-validation.json", ".plan/launchers/rtcc-v5.5.33-validator-run-evidence.json"] },
    prohibitedActions: { profileRerun: false, external: false, browser: false, chromium: false, server: false, campaign: false },
  };
}

const RUN_BINDING_PATHS = [".plan/rtcc-preview-v5.5.33.md", ".plan/launchers/rtcc-v5.5.33-production-SHA256SUMS", ...MODULE_BINDINGS.map(({ path }) => path), ".plan/launchers/rtcc-v5.5.33-profile-preflight.json", ".plan/launchers/rtcc-v5.5.33-execution-attempt-start.json", ".plan/launchers/rtcc-v5.5.33-execution-terminal-evidence.json"];
function validRunInvocation(value) { try { return exact(value, ["cwd", "execPath", "argv"]) && value.cwd === ROOT && value.execPath === NODE_PATH && Array.isArray(value.argv) && value.argv[0] === NODE_PATH && value.argv[1] === VALIDATOR_PATH && parseOfficialArguments(value.argv.slice(2)) !== null; } catch { return false; } }
export function assertRunEvidenceSchema(value, validationBytes) {
  const keys = ["schemaVersion", "kind", "release", "invocation", "authority", "bindings", "output", "results", "runCounts", "persistence", "prohibitedActions"];
  const valid = exact(value, keys) && value.schemaVersion === 1 && value.kind === "rtcc-preview-compact-validator-run-evidence" && value.release === "v5.5.33"
    && validRunInvocation(value.invocation)
    && exact(value.authority, ["path", "sha256", "byteCount", "lineCount"]) && value.authority.path === AUTHORITY_PATH && hex(value.authority.sha256) && value.authority.lineCount === 1530
    && Array.isArray(value.bindings) && JSON.stringify(value.bindings.map(({ path }) => path)) === JSON.stringify(RUN_BINDING_PATHS) && value.bindings.every((binding) => exact(binding, ["path", "sha256"]) && hex(binding.sha256))
    && value.bindings[0].sha256 === PLAN_SHA256 && value.bindings[1].sha256 === PRODUCTION_SHA256 && MODULE_BINDINGS.every((binding, index) => value.bindings[index + 2].sha256 === binding.sha256)
    && exact(value.output, ["path", "sha256"]) && value.output.path === ".plan/launchers/rtcc-v5.5.33-profile-validation.json" && value.output.sha256 === sha256(validationBytes)
    && JSON.stringify(value.results) === JSON.stringify({ validator: "pass", engine: "pass", routeSemantic: "pass", unresolvedBlockers: "no-go", release: "no-go" })
    && JSON.stringify(value.runCounts) === JSON.stringify({ validator: 1, profile: 1, external: 0, retry: 0 })
    && JSON.stringify(value.persistence) === JSON.stringify({ exclusive: true, order: [".plan/launchers/rtcc-v5.5.33-profile-validation.json", ".plan/launchers/rtcc-v5.5.33-validator-run-evidence.json"] })
    && exact(value.prohibitedActions, ["profileRerun", "external", "browser", "chromium", "server", "campaign"]) && JSON.stringify(value.prohibitedActions) === JSON.stringify({ profileRerun: false, external: false, browser: false, chromium: false, server: false, campaign: false });
  if (!valid) throw new Error("compact-run-evidence-schema-drift");
  return true;
}

export function writeExclusiveBytes(path, bytes) {
  let descriptor; try { descriptor = openSync(path, "wx", 0o600); writeFileSync(descriptor, bytes); } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function persistCompactArtifacts({ paths = [PROFILE_VALIDATION_PATH, RUN_EVIDENCE_PATH], validation, context, write = writeExclusiveBytes }) {
  assertCondition(Array.isArray(paths) && paths.length === 2, "compact-output-paths-invalid");
  assertCompactValidationSchema(validation);
  const validationBytes = canonicalBytes(validation);
  const evidence = buildRunEvidence(validation, context);
  const evidenceBytes = canonicalBytes(evidence);
  assertRunEvidenceSchema(evidence, validationBytes);
  write(paths[0], validationBytes);
  write(paths[1], evidenceBytes);
  return { validation, evidence, bytes: [validationBytes, evidenceBytes] };
}

async function official() {
  const args = process.argv.slice(2);
  const invocation = { cwd: process.cwd(), execPath: process.execPath, argv: [...process.argv] };
  const preflight = preflightOfficialRun({ args, invocation });
  const records = parseJsonl(preflight.authorityBytes);
  const report = validateCompactTrace(records, preflight.blockers);
  const validation = buildCompactValidation(preflight.authorityBytes, report);
  persistCompactArtifacts({ validation, context: preflight });
  process.stdout.write("rtcc-preview-profile-validator v4 NO-GO\n");
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "--official-v5.5.33") await official();
