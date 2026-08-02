import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateStructuralTelemetry } from "./validation/rtcc-v3-structural-telemetry.mjs";
import { validateInventoryExecutionPlan } from "./validation/rtcc-v3-inventory-execution-plan.mjs";
import { evaluateRouteSemantics, requireAuthoritySemanticFailure } from "./validation/rtcc-v3-route-semantics.mjs";
import { persistOfficialArtifacts, preflightOfficialRun } from "./validation/rtcc-v3-official-artifacts.mjs";

export { canonicalDigest, canonicalJson } from "./validation/rtcc-v3-inventory-execution-plan.mjs";
export { validateRoute } from "./validation/rtcc-v3-route-semantics.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const AUTHORITY_PATH = "/private/tmp/rtcc-preview-v4-3.0ESvAAhF/profile-v5-5-30-a/profile.jsonl";
export const AUTHORITY_SHA256 = "a0688f1201c1d4d4eace2a9e6176f8e48d85daf32a8179e535e51caf1b720cbb";
export const AUTHORITY_POLICY = {
  structural: {
    lineCount: 1530, progressCount: 1528, executionCount: 1496, bundleCount: 68,
    checkpoints: [1, 64, 128, 256, 512, 681], requiredOrdinals: [...Array(64).keys()].map((n) => n + 1).concat([128, 256, 512, 681]),
    phaseOrder: ["prepare", "enumerate", "replay", "execution", "finalize"],
    header: { schemaVersion: 1, telemetryPolicyVersion: 4, isolationPolicyVersion: 3, maximumEvents: 1664, probeCapMs: 300000, productionAggregate: "ac1344e8c36f436a5d3e8f5e83dc9bb8dfd649a7255a38d5577c9ee2dd87b5a8", sourceManifestDigest: "6ff4218223f36aa0e79238320ea27063bb3ac60de00d6d8e92b1863c48bb803a", dependencyViewDigest: "e72d1ee18d1fbb4aa5d3870fdad38222dcb24d83646840f6ac22f61a7f6fab86", confinementPolicyDigest: "3d298017221f509418878fe98353c1137c86c5f0a53b35dc3f0cbe97f6de53a8", isolationPolicyDigest: "a88baf7521baffa65f4f7c6257ce53e3372422b623f05eef31ba506e1ca2c66d", telemetryPolicyDigest: "5d49da6914ca52b9dd41d0117cf1e2be1434636395a9db7e0afbeb0c50ee338f" },
    bundleKeys: ["diagnosticsVersion","bundleMeasuredMicros","frontierCount","rawSourceReadCount","rawSourceReadMicros","inventoryReadRequestCount","inventoryReadPathCacheHitCount","sliceRequestCount","sliceComputationCount","sliceHitCount","sliceLookupMicros","inventoryRequestCount","inventoryComputationCount","inventoryHitCount","inventoryLookupMicros","queueIterationCount","queuePeakLength","queueSortCount","queueSortMicros","edgeVisitCount","optionalClosureProbeCount","optionalClosureMicros","resolveModuleCount","resolveModuleMicros","authoredPathCheckCount","authoredPathCheckMicros","frontierFinalizeMicros","frontierIdentityMicros","candidateSelectionSortCount","candidateSelectionMicros"]
  },
  inventory: { analysisCount: 725, replayCount: 730, total: 746, runnable: 681, duplicate: 47, unresolved: 18, maximumAnalysisPasses: 4096, maximumBranches: 8192, maximumDepth: 64, replayPolicyDigest: "274a9aecd52944871f1a88940416e3a2e485490d8d287f0e0235a635c7e89601", executionPlanPolicyDigest: "e0aa9adf1c3c766fb629e7048ef9ee949eeef49a7522e2ede0889d0ced58eb6e", mountFallbackEvidenceDigest: "d17d8781254638a9e879ece557268d55e155c634694ffbaf6fb03eaf9687f3e7" }
};

export function validateTrace(records, policy = {}) {
  const structural = validateStructuralTelemetry(records, policy.structural ?? policy);
  const inventory = validateInventoryExecutionPlan(records.at(-1)?.inventory, policy.inventory ?? policy);
  const semantic = evaluateRouteSemantics(records.at(-1)?.inventory?.entries ?? []);
  const checks = [...structural.checks, ...inventory.checks];
  const structuralResult = checks.every((check) => check.passed) ? "pass" : "fail";
  const semanticResult = semantic.violations.length || semantic.blockers.length ? "fail" : "pass";
  return { ...structural, ...inventory, ...semantic, structuralResult, semanticResult, releaseResult: structuralResult === "pass" && semanticResult === "pass" ? "go" : "no-go", checks };
}

function official() {
  const preflight = preflightOfficialRun({ cwd: process.cwd(), argv: process.argv.slice(2), authorityPath: AUTHORITY_PATH, authorityHash: AUTHORITY_SHA256 });
  const records = preflight.authorityBytes.trimEnd().split("\n").map((line) => JSON.parse(line));
  const report = validateTrace(records, AUTHORITY_POLICY); if (report.structuralResult !== "pass" || report.engineTerminal?.status !== "completed" || report.engineTerminal.executionPlanCompleted !== 681 || report.engineTerminal.executionPlanTotal !== 681 || report.semanticResult !== "fail" || report.releaseResult !== "no-go") throw new Error("unexpected-official-structural-shape"); requireAuthoritySemanticFailure(report);
  const body = { schemaVersion: 3, validator: "rtcc-preview-complete-route-profile-v3", authority: { path: AUTHORITY_PATH, sha256: sha256(preflight.authorityBytes), lineCount: records.length }, authorityBytes: preflight.authorityBytes, externalRunCount: 0, noRetry: true, productionChanged: false, ...report };
  persistOfficialArtifacts({ ...preflight, body, expectedExitCode: 1, invocation: preflight.invocation });
  process.stdout.write(`rtcc-preview-profile-validator v3 ${report.releaseResult.toUpperCase()}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename) && process.argv[2] === "--official-v5.5.31") official();
