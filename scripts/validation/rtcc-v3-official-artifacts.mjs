import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateInventoryExecutionPlan } from "./rtcc-v3-inventory-execution-plan.mjs";
import { evaluateRouteSemantics, requireAuthoritySemanticFailure } from "./rtcc-v3-route-semantics.mjs";
import { parseJsonl, validateStructuralTelemetry } from "./rtcc-v3-structural-telemetry.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).join("\0") === keys.join("\0");
const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const noPlaceholder = (value) => typeof value === "string" ? !/<[^>]+>/.test(value) : Array.isArray(value) ? value.every(noPlaceholder) : value && typeof value === "object" ? Object.values(value).every(noPlaceholder) : true;
const root = "/Users/lky/project/reactpreview";
const nodePath = "/Users/lky/.nvm/versions/node/v22.22.2/bin/node";
const validatorRelative = "scripts/validate-rtcc-preview-complete-route-profile-v3.mjs";
const authorityPathFixed = "/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-30-a/profile.jsonl";
const authoritySha256Fixed = "a0688f1201c1d4d4eace2a9e6176f8e48d85daf32a8179e535e51caf1b720cbb";
const authorityBytesFixed = 6037478;
const gateRelative = ".plan/launchers/rtcc-v5.5.31-validator-gate.json";
const productionManifestPath = ".plan/launchers/rtcc-v5.5.25-production-SHA256SUMS";
const productionManifestSha256 = "ac1344e8c36f436a5d3e8f5e83dc9bb8dfd649a7255a38d5577c9ee2dd87b5a8";
const authorityPolicy = {
  structural: {
    lineCount: 1530, progressCount: 1528, executionCount: 1496, bundleCount: 68,
    checkpoints: [1, 64, 128, 256, 512, 681], requiredOrdinals: [...Array(64).keys()].map((number) => number + 1).concat([128, 256, 512, 681]),
    phaseOrder: ["prepare", "enumerate", "replay", "execution", "finalize"],
    header: { schemaVersion: 1, telemetryPolicyVersion: 4, isolationPolicyVersion: 3, maximumEvents: 1664, probeCapMs: 300000, productionAggregate: productionManifestSha256, sourceManifestDigest: "6ff4218223f36aa0e79238320ea27063bb3ac60de00d6d8e92b1863c48bb803a", dependencyViewDigest: "e72d1ee18d1fbb4aa5d3870fdad38222dcb24d83646840f6ac22f61a7f6fab86", confinementPolicyDigest: "3d298017221f509418878fe98353c1137c86c5f0a53b35dc3f0cbe97f6de53a8", isolationPolicyDigest: "a88baf7521baffa65f4f7c6257ce53e3372422b623f05eef31ba506e1ca2c66d", telemetryPolicyDigest: "5d49da6914ca52b9dd41d0117cf1e2be1434636395a9db7e0afbeb0c50ee338f" },
    bundleKeys: ["diagnosticsVersion","bundleMeasuredMicros","frontierCount","rawSourceReadCount","rawSourceReadMicros","inventoryReadRequestCount","inventoryReadPathCacheHitCount","sliceRequestCount","sliceComputationCount","sliceHitCount","sliceLookupMicros","inventoryRequestCount","inventoryComputationCount","inventoryHitCount","inventoryLookupMicros","queueIterationCount","queuePeakLength","queueSortCount","queueSortMicros","edgeVisitCount","optionalClosureProbeCount","optionalClosureMicros","resolveModuleCount","resolveModuleMicros","authoredPathCheckCount","authoredPathCheckMicros","frontierFinalizeMicros","frontierIdentityMicros","candidateSelectionSortCount","candidateSelectionMicros"],
  },
  inventory: { analysisCount: 725, replayCount: 730, total: 746, runnable: 681, duplicate: 47, unresolved: 18, maximumAnalysisPasses: 4096, maximumBranches: 8192, maximumDepth: 64, replayPolicyDigest: "274a9aecd52944871f1a88940416e3a2e485490d8d287f0e0235a635c7e89601", executionPlanPolicyDigest: "e0aa9adf1c3c766fb629e7048ef9ee949eeef49a7522e2ede0889d0ced58eb6e", mountFallbackEvidenceDigest: "d17d8781254638a9e879ece557268d55e155c634694ffbaf6fb03eaf9687f3e7" },
};
const outputRelative = [".plan/launchers/rtcc-v5.5.31-profile-validation.json", ".plan/launchers/rtcc-v5.5.31-semantic-report.json", ".plan/launchers/rtcc-v5.5.31-v5.5.30-semantic-failure-lineage.json", ".plan/launchers/rtcc-v5.5.31-validator-run-evidence.json", ".plan/launchers/rtcc-v5.5.31-artifact-manifest.json", ".plan/launchers/rtcc-v5.5.31-SHA256SUMS"];
const planFiles = [".plan/rtcc-preview-v5.5.31.md", ".plan/rtcc-preview-v5.5.31-amendment-1.md", ".plan/rtcc-preview-v5.5.31-amendment-2.md", ".plan/rtcc-preview-v5.5.31-amendment-3.md"];
const predecessorSpecs = [
  ["plan", ".plan/rtcc-preview-v5.5.30.md", "42d80cb4ea462dace3e36fef68b32f9f08800e6cc41e1eb7fc0ceba265022186", false],
  ["canonicalArgv", ".plan/launchers/rtcc-v5.5.30-canonical-argv.json", "d95409756a9f2dcf6f679e698f4a6a02e29441c5326a69b789214ad55a1167f6", true],
  ["executor", ".plan/launchers/rtcc-v5.5.30-exact-once-executor.mjs", "604c180b698e6c7cd1a2ca97a59904e902bf67596e3595406bf1a542f2b3d88b", false],
  ["executorTest", ".plan/launchers/rtcc-v5.5.30-exact-once-executor.test.mjs", "8323e84601a0be5ba0e5e66b01d54d1fb57f1cef2824cdfca6fc09db6c778411", false],
  ["attempt", ".plan/launchers/rtcc-v5.5.30-execution-attempt-start.json", "a5c4795329456df958e6e5a3f14800bfff71b3e02f05ea5b4a130841b2b2e24a", true],
  ["terminal", ".plan/launchers/rtcc-v5.5.30-execution-terminal-evidence.json", "7dec93dd874baf220334a07fe9875241f27e78a0201ff7bce6817df5211d4268", true],
  ["gateProbe", ".plan/launchers/rtcc-v5.5.30-executor-gate-probe.json", "f35d26e5d4fbce8ded1b082333285dbc083d246be606f38724c10a049db01938", true],
  ["preflight", ".plan/launchers/rtcc-v5.5.30-profile-preflight.json", "dc3caf80dac93383c04babb32d6cb74d47e250b88a52734046840acdc3f7ae7b", true],
  ["lineage", ".plan/launchers/rtcc-v5.5.30-v5.5.29-external-failure-lineage.json", "2adefb03906944166c10d93c520831c8cf76f50dbc1d4eed859e8599134b40d4", true],
];
const predecessorKeys = ["complete", ...predecessorSpecs.map(([key]) => key)];
const boundFiles = [...planFiles, validatorRelative, "scripts/validation/rtcc-v3-structural-telemetry.mjs", "scripts/validation/rtcc-v3-inventory-execution-plan.mjs", "scripts/validation/rtcc-v3-route-semantics.mjs", "scripts/validation/rtcc-v3-official-artifacts.mjs", "test/support/rtccV3Fixture.ts", "test/scripts/validateRtccPreviewCompleteRouteProfileV3.test.ts", ...predecessorSpecs.map(([, path]) => path), productionManifestPath];
const commandPrefix = ["--official-v5.5.31", "--gate", gateRelative, "--gate-sha256"];
const finalArgumentRelation = "final argument equals SHA-256 of raw gate bytes";
const prohibitedKeys = ["spawn", "retry", "external", "browser", "chromium", "server", "campaign", "timeout", "newRoot", "profileRetry"];
const predecessorProhibitedKeys = ["retryPerformed", "externalTimeoutUsed", "killTimerUsed", "shellWrapperUsed", "secondRootUsed", "rootDeletedOrReused", "recursiveWorkaroundUsed", "executorCreatedRoot", "browserExecuted", "chromiumExecuted", "serverExecuted", "campaignExecuted"];
const hashFile = (cwd, file, read = readFileSync) => sha256(read(resolve(cwd, file)));
const confined = (cwd, file) => !file.startsWith("/") && !file.split("/").includes("..") && resolve(cwd, file).startsWith(`${resolve(cwd)}/`);
const falseActions = () => Object.fromEntries(prohibitedKeys.map((key) => [key, false]));
const validActions = (value) => exact(value, prohibitedKeys) && prohibitedKeys.every((key) => value[key] === false);
const binding = (value) => exact(value, ["path", "sha256"]) && typeof value.path === "string" && hex(value.sha256);
const orderedViolations = (value) => Array.isArray(value) && value.length === 31 && value.every((item, index) => exact(item, ["inventoryIndex", "tokenOffset", "code", "id", "nonSplat"]) && Number.isSafeInteger(item.inventoryIndex) && Number.isSafeInteger(item.tokenOffset) && item.code === "pathname-pattern-mismatch" && typeof item.id === "string" && typeof item.nonSplat === "boolean" && (index === 0 || value[index - 1].inventoryIndex < item.inventoryIndex || value[index - 1].inventoryIndex === item.inventoryIndex && (value[index - 1].tokenOffset < item.tokenOffset || value[index - 1].tokenOffset === item.tokenOffset && value[index - 1].code <= item.code))) && value.filter((item) => item.nonSplat).length === 30;
const orderedBlockers = (value) => Array.isArray(value) && value.length === 18 && value.every((item, index) => exact(item, ["inventoryIndex", "id", "reason"]) && Number.isSafeInteger(item.inventoryIndex) && typeof item.id === "string" && typeof item.reason === "string" && (index === 0 || value[index - 1].inventoryIndex <= item.inventoryIndex));

export const rtccV3BoundFiles = [...boundFiles];
export const rtccV3OutputFiles = [...outputRelative];

function exactPredecessorIdentity(value, spec) {
  const [, path, expectedHash, json] = spec;
  return exact(value, json ? ["path", "sha256", "value"] : ["path", "sha256"]) && value.path === path && value.sha256 === expectedHash && (!json || noPlaceholder(value.value) && sha256(canonical(value.value)) === expectedHash);
}

function completePredecessors(value) {
  if (!exact(value, predecessorKeys) || value.complete !== true || predecessorSpecs.some((spec) => !exactPredecessorIdentity(value[spec[0]], spec))) return false;
  const canonicalArgv = value.canonicalArgv.value, attempt = value.attempt.value, terminal = value.terminal.value;
  return exact(canonicalArgv, ["schemaVersion", "kind", "release", "workingDirectory", "argumentCount", "argumentVector", "profileRoot", "productionAggregate", "executionPolicy"])
    && canonicalArgv.argumentCount === 22 && canonicalArgv.argumentVector.length === 22 && canonicalArgv.executionPolicy?.exactOnce === true
    && exact(attempt, ["schemaVersion", "kind", "release", "complete", "timestamp", "processId", "command", "hashBindings", "directRootContract", "authorizationConsumed", "profileSpawnApiInvocationCount", "launcherExecuted"])
    && attempt.complete === true && attempt.authorizationConsumed === true && attempt.profileSpawnApiInvocationCount === 0 && attempt.launcherExecuted === false && attempt.command.argumentVector.length === 3
    && exact(terminal, ["schemaVersion", "kind", "release", "complete", "result", "hashBindings", "attemptStartIdentity", "directRootContract", "materialization", "execution", "streams", "preState", "postStateResult", "traceResult", "postChildInspectionFailure", "prohibitedActions", "audit"])
    && terminal.complete === true && terminal.result === "audit-required" && terminal.attemptStartIdentity.sha256 === predecessorSpecs[4][2]
    && terminal.materialization.authorizedChildMaterialized === true && terminal.materialization.argumentVector.length === 22
    && exact(terminal.execution, ["validationFailure", "profileSpawnApiInvocationCount", "launcherExecuted", "profileExecuted", "telemetryProduced", "authorityRunCandidate", "authorityPass", "retryCount", "shell", "externalTimeout", "exitCode", "signal", "closeObserved", "synchronousSpawnThrow", "durationNanoseconds", "events"])
    && terminal.execution.profileSpawnApiInvocationCount === 1 && terminal.execution.launcherExecuted === true && terminal.execution.profileExecuted === true && terminal.execution.telemetryProduced === true && terminal.execution.authorityRunCandidate === true && terminal.execution.authorityPass === false && terminal.execution.retryCount === 0 && terminal.execution.shell === false && terminal.execution.externalTimeout === null && terminal.execution.exitCode === 0 && terminal.execution.signal === null && terminal.execution.closeObserved === true && terminal.execution.synchronousSpawnThrow === false && /^\d+$/.test(terminal.execution.durationNanoseconds) && terminal.execution.events.map((event) => event.type).join(",") === "spawn,exit,close"
    && exact(terminal.streams, ["separated", "stdout", "stderr", "taggedCallbackOrder"]) && terminal.streams.separated === true && terminal.streams.stdout.byteCount === 0 && terminal.streams.stdout.sha256 === sha256("") && terminal.streams.stdout.base64 === "" && terminal.streams.stderr.byteCount === 0 && terminal.streams.stderr.sha256 === sha256("") && terminal.streams.stderr.base64 === "" && Array.isArray(terminal.streams.taggedCallbackOrder) && terminal.streams.taggedCallbackOrder.length === 0
    && terminal.directRootContract.executorCreatedRoot === false && terminal.preState.profileRoot.exists === false && terminal.preState.trace.exists === false && terminal.postStateResult.status === "fulfilled" && terminal.postStateResult.value.profileRoot.exists === true && terminal.postStateResult.value.trace.exists === true
    && terminal.traceResult.status === "fulfilled" && terminal.traceResult.value.present === true && terminal.traceResult.value.headerPresent === true && terminal.traceResult.value.byteCount === authorityBytesFixed && terminal.traceResult.value.lineCount === 1530 && terminal.traceResult.value.sha256 === authoritySha256Fixed && terminal.postChildInspectionFailure === false
    && terminal.audit.completeMarkerPresent === true && terminal.audit.strict681AuditPerformed === false && exact(terminal.prohibitedActions, predecessorProhibitedKeys) && predecessorProhibitedKeys.every((key) => terminal.prohibitedActions[key] === false);
}

export function assertGateSchema(value, expected = {}) {
  const keys = ["schemaVersion", "kind", "preOfficialSolReview", "cwd", "node", "authority", "bindings", "productionManifest", "command"];
  const valid = exact(value, keys) && value.schemaVersion === 1 && value.kind === "rtcc-v5.5.31-validator-gate"
    && exact(value.preOfficialSolReview, ["status", "recordedAt"]) && value.preOfficialSolReview.status === "PASS" && typeof value.preOfficialSolReview.recordedAt === "string" && !Number.isNaN(Date.parse(value.preOfficialSolReview.recordedAt))
    && value.cwd === root && exact(value.node, ["path", "version"]) && value.node.path === nodePath && value.node.version === "v22.22.2"
    && exact(value.authority, ["path", "sha256"]) && value.authority.path === authorityPathFixed && value.authority.sha256 === authoritySha256Fixed
    && Array.isArray(value.bindings) && value.bindings.length === boundFiles.length && value.bindings.every((item, index) => binding(item) && item.path === boundFiles[index])
    && exact(value.productionManifest, ["path", "sha256", "entries"]) && value.productionManifest.path === productionManifestPath && value.productionManifest.sha256 === productionManifestSha256 && value.productionManifest.entries === 35
    && exact(value.command, ["fixedArgumentPrefix", "finalArgumentRelation"]) && JSON.stringify(value.command.fixedArgumentPrefix) === JSON.stringify(commandPrefix) && value.command.finalArgumentRelation === finalArgumentRelation
    && (!expected.bindings || JSON.stringify(value.bindings) === JSON.stringify(expected.bindings)) && noPlaceholder(value);
  if (!valid) throw new Error("gate-schema-drift");
  return true;
}

export function assertLineageSchema(value, expected = {}) {
  const keys = ["schemaVersion", "kind", "releaseResult", "validatorResult", "plans", "gate", "authority", "productionManifest", "predecessors", "structuralResult", "engineTerminal", "semantic", "currentRun", "prohibitedActions", "cannotConvertEngineCompletionToReleaseGo"];
  const plans = expected.moduleHashes?.filter((item) => planFiles.includes(item.path));
  const valid = exact(value, keys) && value.schemaVersion === 1 && value.kind === "semantic-failure-lineage" && value.releaseResult === "no-go" && value.validatorResult === "fail"
    && Array.isArray(value.plans) && value.plans.length === 4 && value.plans.every((item, index) => binding(item) && item.path === planFiles[index]) && (!plans || JSON.stringify(value.plans) === JSON.stringify(plans))
    && exact(value.gate, ["path", "sha256"]) && value.gate.path === gateRelative && hex(value.gate.sha256) && (!expected.gateSha256 || value.gate.sha256 === expected.gateSha256)
    && exact(value.authority, ["path", "sha256", "bytes", "lines"]) && value.authority.path === authorityPathFixed && value.authority.sha256 === authoritySha256Fixed && value.authority.bytes === authorityBytesFixed && value.authority.lines === 1530
    && exact(value.productionManifest, ["path", "sha256", "entries", "productionChanged"]) && value.productionManifest.path === productionManifestPath && value.productionManifest.sha256 === productionManifestSha256 && value.productionManifest.entries === 35 && value.productionManifest.productionChanged === false
    && completePredecessors(value.predecessors) && value.structuralResult === "pass" && exact(value.engineTerminal, ["status", "executionPlanCompleted", "executionPlanTotal"]) && value.engineTerminal.status === "completed" && value.engineTerminal.executionPlanCompleted === 681 && value.engineTerminal.executionPlanTotal === 681
    && exact(value.semantic, ["result", "violations", "blockers"]) && value.semantic.result === "fail" && orderedViolations(value.semantic.violations) && orderedBlockers(value.semantic.blockers)
    && exact(value.currentRun, ["officialRunCount", "externalRunCount", "retryCount"]) && value.currentRun.officialRunCount === 1 && value.currentRun.externalRunCount === 0 && value.currentRun.retryCount === 0 && validActions(value.prohibitedActions) && value.cannotConvertEngineCompletionToReleaseGo === true && noPlaceholder(value);
  if (!valid) throw new Error("lineage-schema-drift");
  return true;
}

export function assertEvidenceSchema(value, expected = {}) {
  const keys = ["schemaVersion", "kind", "invocation", "gate", "gateContentVerified", "bindings", "authority", "preflight", "officialRunCount", "expectedExitCode", "retryCount", "externalRunCount", "prohibitedActions", "persistenceOrder", "outputHashes"];
  const approved = [...commandPrefix, value?.gate?.sha256];
  const actualArgv = [nodePath, resolve(root, validatorRelative), ...approved];
  const valid = exact(value, keys) && value.schemaVersion === 1 && value.kind === "validator-run-evidence"
    && exact(value.invocation, ["cwd", "execPath", "argv", "approvedTokens", "finalArgumentRelation"]) && value.invocation.cwd === root && value.invocation.execPath === nodePath && JSON.stringify(value.invocation.argv) === JSON.stringify(actualArgv) && JSON.stringify(value.invocation.approvedTokens) === JSON.stringify(approved) && value.invocation.finalArgumentRelation === finalArgumentRelation
    && exact(value.gate, ["path", "sha256"]) && value.gate.path === gateRelative && hex(value.gate.sha256) && (!expected.gateSha256 || value.gate.sha256 === expected.gateSha256) && value.gateContentVerified === true
    && Array.isArray(value.bindings) && value.bindings.length === boundFiles.length && value.bindings.every((item, index) => binding(item) && item.path === boundFiles[index]) && (!expected.moduleHashes || JSON.stringify(value.bindings) === JSON.stringify(expected.moduleHashes))
    && exact(value.authority, ["path", "sha256", "bytes", "lines"]) && value.authority.path === authorityPathFixed && value.authority.sha256 === authoritySha256Fixed && value.authority.bytes === authorityBytesFixed && value.authority.lines === 1530
    && exact(value.preflight, ["reservedOutputsAbsent"]) && value.preflight.reservedOutputsAbsent === true && value.officialRunCount === 1 && value.expectedExitCode === 1 && value.retryCount === 0 && value.externalRunCount === 0 && validActions(value.prohibitedActions)
    && JSON.stringify(value.persistenceOrder) === JSON.stringify(outputRelative) && exact(value.outputHashes, ["profileValidation", "semanticReport", "lineage"]) && Object.values(value.outputHashes).every(hex)
    && (!expected.bytes || value.outputHashes.profileValidation === sha256(expected.bytes[0]) && value.outputHashes.semanticReport === sha256(expected.bytes[1]) && value.outputHashes.lineage === sha256(expected.bytes[2])) && noPlaceholder(value);
  if (!valid) throw new Error("evidence-schema-drift");
  return true;
}

const payloadKeys = ["schemaVersion", "validator", "authority", "authorityBytes", "externalRunCount", "noRetry", "productionChanged", "checks", "header", "engineTerminal", "progressCount", "bundleCount", "inventory", "violations", "blockers", "firstViolation", "firstBlocker", "structuralResult", "semanticResult", "releaseResult", "kind"];
let authorityReconstructionCache;
function reconstructAuthorityReport(authorityBytes) {
  if (authorityReconstructionCache?.bytes === authorityBytes) return authorityReconstructionCache.report;
  const records = parseJsonl(authorityBytes);
  const structural = validateStructuralTelemetry(records, authorityPolicy.structural);
  const inventory = validateInventoryExecutionPlan(records.at(-1)?.inventory, authorityPolicy.inventory);
  const semantic = evaluateRouteSemantics(records.at(-1)?.inventory?.entries ?? []);
  const checks = [...structural.checks, ...inventory.checks];
  if (structural.checks.length !== 24 || inventory.checks.length !== 4932 || checks.length !== 4956 || checks.some((check) => !exact(check, check.detail === undefined ? ["name", "passed"] : ["name", "passed", "detail"]) || typeof check.name !== "string" || check.passed !== true || check.detail !== undefined && typeof check.detail !== "string")) throw new Error("authority-check-schema-drift");
  const report = { ...structural, ...inventory, ...semantic, structuralResult: "pass", semanticResult: "fail", releaseResult: "no-go", checks };
  if (records.length !== 1530 || report.engineTerminal?.status !== "completed" || report.engineTerminal.executionPlanCompleted !== 681 || report.engineTerminal.executionPlanTotal !== 681 || report.progressCount !== 1528 || report.bundleCount !== 68 || report.firstViolation !== report.violations[0] || report.firstBlocker !== report.blockers[0]) throw new Error("authority-report-drift");
  requireAuthoritySemanticFailure(report);
  authorityReconstructionCache = { bytes: authorityBytes, report };
  return report;
}
function assertOfficialPayload(value, kind) {
  const identityValid = exact(value, payloadKeys) && value.schemaVersion === 3 && value.validator === "rtcc-preview-complete-route-profile-v3" && value.kind === kind
    && exact(value.authority, ["path", "sha256", "lineCount"]) && value.authority.path === authorityPathFixed && value.authority.sha256 === authoritySha256Fixed && value.authority.lineCount === 1530 && typeof value.authorityBytes === "string" && Buffer.byteLength(value.authorityBytes) === authorityBytesFixed && sha256(value.authorityBytes) === authoritySha256Fixed
    && value.externalRunCount === 0 && value.noRetry === true && value.productionChanged === false;
  let report;
  try { report = identityValid ? reconstructAuthorityReport(value.authorityBytes) : undefined; } catch { report = undefined; }
  const expected = report && { schemaVersion: 3, validator: "rtcc-preview-complete-route-profile-v3", authority: { path: authorityPathFixed, sha256: authoritySha256Fixed, lineCount: 1530 }, authorityBytes: value.authorityBytes, externalRunCount: 0, noRetry: true, productionChanged: false, ...report, kind };
  const valid = identityValid && report && orderedViolations(value.violations) && orderedBlockers(value.blockers) && canonical(value) === canonical(expected);
  if (!valid) throw new Error(`${kind}-schema-drift`);
  return true;
}
export const assertProfileValidationSchema = (value) => assertOfficialPayload(value, "profile-validation");
export const assertSemanticReportSchema = (value) => assertOfficialPayload(value, "semantic-report");

export function assertManifestSchema(value, expected = {}) {
  if (!exact(value, ["schemaVersion", "kind", "inputs", "results"]) || value.schemaVersion !== 1 || value.kind !== "artifact-manifest" || !Array.isArray(value.inputs) || value.inputs.length !== 1 || value.inputs[0].path !== gateRelative || !binding(value.inputs[0]) || !Array.isArray(value.results) || value.results.length !== 4 || value.results.some((entry, index) => !binding(entry) || entry.path !== outputRelative[index]) || new Set(value.results.map((entry) => entry.path).concat(value.inputs.map((entry) => entry.path))).size !== 5 || expected.gateSha256 && value.inputs[0].sha256 !== expected.gateSha256 || expected.bytes && value.results.some((entry, index) => entry.sha256 !== sha256(expected.bytes[index])) || !noPlaceholder(value)) throw new Error("manifest-schema-drift");
  return true;
}

export function assertSumsSchema(bytes, expected = {}) {
  const lines = String(bytes).split("\n");
  if (lines.at(-1) !== "" || lines.length !== 6) throw new Error("sums-schema-drift");
  const parsed = lines.slice(0, -1).map((line) => /^([a-f0-9]{64})  (.+)$/.exec(line));
  if (parsed.some((match) => !match) || parsed.map((match) => match[2]).join("\0") !== outputRelative.slice(0, 5).join("\0") || new Set(parsed.map((match) => match[2])).size !== 5 || expected.bytes && parsed.some((match, index) => match[1] !== sha256(expected.bytes[index])) || !noPlaceholder(bytes)) throw new Error("sums-schema-drift");
  return true;
}

export function buildValidatorGate({ cwd = root, gatePath = resolve(cwd, gateRelative), preOfficialSolReview, writeFile = writeFileSync, readFile = readFileSync }) {
  if (!preOfficialSolReview || preOfficialSolReview.status !== "PASS" || typeof preOfficialSolReview.recordedAt !== "string") throw new Error("pre-official-sol-pass-required");
  if (resolve(cwd) !== root || resolve(gatePath) !== resolve(cwd, gateRelative)) throw new Error("gate-location-required");
  const bindings = boundFiles.map((file) => ({ path: file, sha256: hashFile(cwd, file, readFile) }));
  const gate = { schemaVersion: 1, kind: "rtcc-v5.5.31-validator-gate", preOfficialSolReview: { status: "PASS", recordedAt: preOfficialSolReview.recordedAt }, cwd: root, node: { path: nodePath, version: "v22.22.2" }, authority: { path: authorityPathFixed, sha256: authoritySha256Fixed }, bindings, productionManifest: { path: productionManifestPath, sha256: productionManifestSha256, entries: 35 }, command: { fixedArgumentPrefix: [...commandPrefix], finalArgumentRelation } };
  assertGateSchema(gate, { bindings });
  const bytes = canonical(gate); writeFile(gatePath, bytes, { encoding: "utf8", flag: "wx" }); return { gate, bytes, sha256: sha256(bytes) };
}

function verifyProductionManifest(cwd, readFile) {
  const bytes = readFile(resolve(cwd, productionManifestPath)); const lines = bytes.toString("utf8").trimEnd().split("\n");
  if (sha256(bytes) !== productionManifestSha256 || lines.length !== 35 || lines.some((line) => { const hit = /^([a-f0-9]{64})  (.+)$/.exec(line); return !hit || !confined(cwd, hit[2]) || sha256(readFile(resolve(cwd, hit[2]))) !== hit[1]; })) throw new Error("production-manifest-drift");
}

function predecessorFacts(cwd, readFile) {
  const facts = { complete: true };
  for (const [key, path, expectedHash, json] of predecessorSpecs) {
    const bytes = readFile(resolve(cwd, path));
    if (sha256(bytes) !== expectedHash) throw new Error(`predecessor-identity-drift:${key}`);
    if (json) { let value; try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`predecessor-json-drift:${key}`); } if (canonical(value) !== bytes.toString("utf8")) throw new Error(`predecessor-canonical-drift:${key}`); facts[key] = { path, sha256: expectedHash, value }; }
    else facts[key] = { path, sha256: expectedHash };
  }
  if (!completePredecessors(facts)) throw new Error("predecessor-evidence-incomplete");
  return facts;
}

export function preflightOfficialRun({ cwd, argv, authorityPath, authorityHash, invocation = { cwd: process.cwd(), execPath: process.execPath, argv: [...process.argv] }, readFile = readFileSync, lstat = lstatSync, exists = existsSync }) {
  if (resolve(cwd) !== root || invocation.cwd !== cwd || invocation.execPath !== nodePath || process.execPath !== nodePath || process.version !== "v22.22.2" || JSON.stringify(invocation.argv) !== JSON.stringify([nodePath, resolve(cwd, validatorRelative), ...argv])) throw new Error("runtime-or-cwd-identity-drift");
  if (!Array.isArray(argv) || argv.length !== 5 || JSON.stringify(argv.slice(0, 4)) !== JSON.stringify(commandPrefix) || !hex(argv[4]) || !noPlaceholder(argv)) throw new Error("official-argv-required");
  const gatePath = resolve(cwd, gateRelative); let stat; try { stat = lstat(gatePath); } catch { throw new Error("gate-required"); } if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("gate-type-required");
  const gateBytes = readFile(gatePath); if (sha256(gateBytes) !== argv[4]) throw new Error("gate-raw-hash-drift"); let gate; try { gate = JSON.parse(gateBytes.toString("utf8")); } catch { throw new Error("gate-canonical-drift"); }
  if (canonical(gate) !== gateBytes.toString("utf8")) throw new Error("gate-canonical-drift");
  const actualBindings = boundFiles.map((path) => ({ path, sha256: hashFile(cwd, path, readFile) }));
  assertGateSchema(gate, { bindings: actualBindings });
  if (gate.authority.path !== authorityPath || gate.authority.sha256 !== authorityHash) throw new Error("gate-binding-drift");
  verifyProductionManifest(cwd, readFile); const predecessors = predecessorFacts(cwd, readFile); const paths = outputRelative.map((file) => resolve(cwd, file)); if (paths.some(exists)) throw new Error("reserved-output-exists");
  const authorityBytes = readFile(authorityPath, "utf8"); if (sha256(authorityBytes) !== authorityHash || Buffer.byteLength(authorityBytes) !== authorityBytesFixed) throw new Error("authority-identity-drift");
  return { cwd, paths, authorityBytes, gate, gateSha256: argv[4], moduleHashes: gate.bindings, predecessors, invocation: { cwd: invocation.cwd, execPath: invocation.execPath, argv: [...invocation.argv], approvedTokens: [...argv], finalArgumentRelation: gate.command.finalArgumentRelation } };
}

export function persistOfficialArtifacts({ paths, body, expectedExitCode, moduleHashes, gate, gateSha256, predecessors, invocation, writeFile = writeFileSync }) {
  if (!Array.isArray(paths) || paths.length !== 6 || paths.some((path) => typeof path !== "string") || !gate || !hex(gateSha256) || !invocation || expectedExitCode !== 1) throw new Error("artifact-input-required");
  assertGateSchema(gate, { bindings: moduleHashes });
  const authority = { path: body.authority.path, sha256: body.authority.sha256, bytes: Buffer.byteLength(body.authorityBytes), lines: body.authority.lineCount };
  const plans = moduleHashes.filter((item) => planFiles.includes(item.path));
  const lineage = { schemaVersion: 1, kind: "semantic-failure-lineage", releaseResult: body.releaseResult, validatorResult: body.semanticResult, plans, gate: { path: gateRelative, sha256: gateSha256 }, authority, productionManifest: { path: productionManifestPath, sha256: productionManifestSha256, entries: 35, productionChanged: false }, predecessors, structuralResult: body.structuralResult, engineTerminal: body.engineTerminal, semantic: { result: body.semanticResult, violations: body.violations, blockers: body.blockers }, currentRun: { officialRunCount: 1, externalRunCount: 0, retryCount: 0 }, prohibitedActions: falseActions(), cannotConvertEngineCompletionToReleaseGo: true };
  const validation = { ...body, kind: "profile-validation" }, semantic = { ...body, kind: "semantic-report" };
  assertProfileValidationSchema(validation); assertSemanticReportSchema(semantic); if (canonical({ ...validation, kind: "semantic-report" }) !== canonical(semantic)) throw new Error("official-payload-pair-drift"); assertLineageSchema(lineage, { gateSha256, moduleHashes });
  const first = [validation, semantic, lineage], firstBytes = first.map(canonical);
  const evidence = { schemaVersion: 1, kind: "validator-run-evidence", invocation, gate: { path: gateRelative, sha256: gateSha256 }, gateContentVerified: true, bindings: moduleHashes, authority, preflight: { reservedOutputsAbsent: true }, officialRunCount: 1, expectedExitCode, retryCount: 0, externalRunCount: 0, prohibitedActions: falseActions(), persistenceOrder: [...outputRelative], outputHashes: { profileValidation: sha256(firstBytes[0]), semanticReport: sha256(firstBytes[1]), lineage: sha256(firstBytes[2]) } };
  assertEvidenceSchema(evidence, { gateSha256, moduleHashes, bytes: firstBytes });
  const evidenceBytes = canonical(evidence); const manifest = { schemaVersion: 1, kind: "artifact-manifest", inputs: [{ path: gateRelative, sha256: gateSha256 }], results: outputRelative.slice(0, 4).map((path, index) => ({ path, sha256: sha256([...firstBytes, evidenceBytes][index]) })) }; assertManifestSchema(manifest, { gateSha256, bytes: [...firstBytes, evidenceBytes] });
  const manifestBytes = canonical(manifest); const sums = outputRelative.slice(0, 5).map((path, index) => `${sha256([...firstBytes, evidenceBytes, manifestBytes][index])}  ${path}`).join("\n") + "\n"; assertSumsSchema(sums, { bytes: [...firstBytes, evidenceBytes, manifestBytes] });
  const bytes = [...firstBytes, evidenceBytes, manifestBytes, sums];
  for (const [index, value] of bytes.entries()) writeFile(paths[index], value, { encoding: "utf8", flag: "wx" });
  return { bytes, validation, semantic, manifest, evidence, lineage };
}
