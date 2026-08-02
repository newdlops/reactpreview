import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHORITY_PATH, AUTHORITY_POLICY, AUTHORITY_SHA256, canonicalDigest, validateRoute, validateTrace } from "../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs";
import { assertEvidenceSchema, assertGateSchema, assertLineageSchema, assertManifestSchema, assertProfileValidationSchema, assertSemanticReportSchema, assertSumsSchema, buildValidatorGate, persistOfficialArtifacts, preflightOfficialRun } from "../../scripts/validation/rtcc-v3-official-artifacts.mjs";
import { createHash } from "node:crypto";
import { mountFallbackEvidenceDigest } from "../../scripts/validation/rtcc-v3-inventory-execution-plan.mjs";
import { evaluateRouteSemantics, parseRoutePattern, requireAuthoritySemanticFailure } from "../../scripts/validation/rtcc-v3-route-semantics.mjs";
import { parseJsonl } from "../../scripts/validation/rtcc-v3-structural-telemetry.mjs";
import { validFixture, validMultiMountFixture, validPageRootFixture, validRouteRootFixture } from "../support/rtccV3Fixture";

const checkFailed = (result: any, name: string) => result.checks.some((check: any) => check.name === name && !check.passed);
const policy = { structural: { executionCount: 22, checkpoints: [1], bundleCount: 1, phaseOrder: ["prepare", "enumerate", "replay", "execution", "finalize"] }, inventory: { analysisCount: 2, replayCount: 3, total: 1, runnable: 1, duplicate: 0, unresolved: 0 } };
const projectRoot = "/Users/lky/project/reactpreview";
const validatorPath = `${projectRoot}/scripts/validate-rtcc-preview-complete-route-profile-v3.mjs`;
const nodePath = "/Users/lky/.nvm/versions/node/v22.22.2/bin/node";
const outputNames = ["profile-validation.json", "semantic-report.json", "lineage.json", "evidence.json", "manifest.json", "SHA256SUMS"];
const temporaryDirectories = new Set<string>();
const isolatedTemp = (prefix: string) => { const directory = mkdtempSync(join(tmpdir(), prefix)); temporaryDirectories.add(directory); return directory; };
afterEach(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); temporaryDirectories.clear(); });
const officialArgs = (gateSha256: string) => ["--official-v5.5.31", "--gate", ".plan/launchers/rtcc-v5.5.31-validator-gate.json", "--gate-sha256", gateSha256];
const actualInvocation = (args: string[]) => ({ cwd: projectRoot, execPath: nodePath, argv: [nodePath, validatorPath, ...args] });
function memoryGate() { let bytes = ""; const result = buildValidatorGate({ cwd: projectRoot, preOfficialSolReview: { status: "PASS", recordedAt: "2026-08-01T00:00:00.000Z" }, writeFile: (_path: string, next: string) => { bytes = next; } }); return { ...result, bytes }; }
function preparedPreflight(overrides: any = {}) { const gate = memoryGate(); const argv = officialArgs(gate.sha256); const read: any = (path: string, encoding?: string) => path.endsWith("validator-gate.json") ? (encoding ? gate.bytes : Buffer.from(gate.bytes)) : readFileSync(path, encoding as any); return { gate, argv, read, options: { cwd: projectRoot, argv, invocation: actualInvocation(argv), authorityPath: AUTHORITY_PATH, authorityHash: AUTHORITY_SHA256, readFile: read, lstat: () => ({ isFile: () => true, isSymbolicLink: () => false }), exists: () => false, ...overrides } }; }
const authorityBytes = readFileSync(AUTHORITY_PATH, "utf8");
const authorityReport: any = validateTrace(
  authorityBytes.trimEnd().split("\n").map((line) => JSON.parse(line)),
  AUTHORITY_POLICY,
);
const officialBody = () => ({ schemaVersion: 3, validator: "rtcc-preview-complete-route-profile-v3", authority: { path: AUTHORITY_PATH, sha256: AUTHORITY_SHA256, lineCount: 1530 }, authorityBytes, externalRunCount: 0, noRetry: true, productionChanged: false, ...authorityReport });
function persistedArtifacts() { const temp = isolatedTemp("rtcc-v3-artifacts-"); const prepared = preparedPreflight(); const preflight = preflightOfficialRun(prepared.options); const body: any = officialBody(); const paths = outputNames.map((name) => join(temp, name)); const artifacts = persistOfficialArtifacts({ paths, body, expectedExitCode: 1, gate: prepared.gate.gate, gateSha256: prepared.gate.sha256, moduleHashes: prepared.gate.gate.bindings, predecessors: preflight.predecessors, invocation: preflight.invocation }); return { temp, paths, prepared, preflight, body, artifacts }; }
function expectBodyRejectedBeforeWrite(mutate: (body: any) => void) { const prepared = preparedPreflight(); const preflight = preflightOfficialRun(prepared.options); const body: any = structuredClone(officialBody()); const writes: any[] = []; mutate(body); expect(() => persistOfficialArtifacts({ paths: outputNames, body, expectedExitCode: 1, gate: prepared.gate.gate, gateSha256: prepared.gate.sha256, moduleHashes: prepared.gate.gate.bindings, predecessors: preflight.predecessors, invocation: preflight.invocation, writeFile: (...args: any[]) => { writes.push(args); } })).toThrow("profile-validation-schema-drift"); expect(writes).toHaveLength(0); }
const reorder = (value: any) => Object.fromEntries(Object.entries(value).reverse());
const reorderInPlace = (value: any) => { const next = reorder(value); Object.keys(value).forEach((key) => delete value[key]); Object.assign(value, next); };
const recomputePlanDigest = (plan: any) => { plan.digest = canonicalDigest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "digest"))); };

describe("complete-route profile v3", () => {
  it("exports the immutable authority policy used by pure validation", () => { expect(AUTHORITY_PATH).toMatch(/profile\.jsonl$/); expect(AUTHORITY_SHA256).toHaveLength(64); expect(AUTHORITY_POLICY.structural.executionCount).toBe(1496); expect(AUTHORITY_POLICY.inventory.runnable).toBe(681); expect(validateTrace(validFixture() as any, { structural: { ...policy.structural }, inventory: { ...policy.inventory } }).structuralResult).toBe("pass"); });
  it.each([
    ["route-root", validRouteRootFixture],
    ["page-root", validPageRootFixture],
    ["multi-mount", validMultiMountFixture],
  ])("accepts the production-derived %s mount topology", (_name, create) => { const result = validateTrace(create() as any, policy); expect(result.checks.filter((check: any) => !check.passed)).toEqual([]); expect(result.releaseResult).toBe("go"); });
  it("allows intermediate execution counters and independent raw/request bundle counts", () => { const corpus: any = validFixture(); const bundle = corpus.find((record: any) => record.event?.bundleDiagnostics).event; bundle.bundleDiagnostics.rawSourceReadCount = 1932; bundle.bundleDiagnostics.inventoryReadRequestCount = 1933; expect(checkFailed(validateTrace(corpus, policy), "bundle-schema")).toBe(false); const firstExecution = corpus.find((record: any) => record.event?.routeOrdinal === 1); firstExecution.event.executionPlanCompleted = 1; expect(checkFailed(validateTrace(corpus, policy), "execution-derived-contract")).toBe(true); });
  it("validates arbitrary supplied identities without an allowlist", () => { const result = validateTrace(validFixture() as any, policy); expect(result.checks.filter((check: any) => !check.passed)).toEqual([]); expect(result.releaseResult).toBe("go"); });
  it.each([
    ["sequence", (x: any) => { x[1].event.sequence = 9; }, "contiguous-progress"],
    ["terminal", (x: any) => { x.at(-1).cleanupConfirmed = false; }, "terminal-contract"],
    ["diagnostic", (x: any) => { x.find((record: any) => record.event?.bundleDiagnostics).event.bundleDiagnostics.sliceHitCount = 2; }, "bundle-schema"],
    ["digest", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.digest = "0".repeat(64); }, "execution-plan-digest"],
    ["replay", (x: any) => { x.at(-1).inventory.entries[0].replay.pathname = "/wrong"; }, "entry-replay-binding"],
    ["dependency", (x: any) => { x.at(-1).inventory.dependencyPaths.push("/a"); }, "dependencies"],
  ])("rejects one-field %s mutation", (_name, mutate, expected) => { const corpus: any = structuredClone(validFixture()); mutate(corpus); expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true); });
  it.each([
    ["inventory key order", (x: any) => { const inventory = x.at(-1).inventory; inventory.entries = []; delete inventory.entries; inventory.entries = []; }, "inventory-schema"],
    ["inventory version", (x: any) => { x.at(-1).inventory.version = 3; }, "inventory-schema"],
    ["inventory completion", (x: any) => { x.at(-1).inventory.complete = false; }, "inventory-schema"],
    ["inventory truncation", (x: any) => { x.at(-1).inventory.truncated = true; }, "inventory-schema"],
    ["inventory limit scalar", (x: any) => { x.at(-1).inventory.limits.maximumDepth = 0; }, "inventory-schema"],
    ["inventory owner", (x: any) => { x.at(-1).inventory.owner.extra = true; }, "inventory-schema"],
    ["replay policy", (x: any) => { x.at(-1).inventory.replayPolicy.version = 1; }, "inventory-schema"],
    ["count total", (x: any) => { x.at(-1).inventory.counts.total = 9; }, "inventory-counts"],
    ["dependency ordering", (x: any) => { x.at(-1).inventory.dependencyPaths.reverse(); }, "dependencies"],
    ["duplicate dependency", (x: any) => { x.at(-1).inventory.dependencyPaths.push("/b"); }, "dependencies"],
    ["runnable key set", (x: any) => { delete x.at(-1).inventory.entries[0].sourcePath; }, "runnable-schema"],
    ["runnable scalar", (x: any) => { x.at(-1).inventory.entries[0].parameters.groupId = 42; }, "runnable-schema"],
    ["replay key set", (x: any) => { delete x.at(-1).inventory.entries[0].replay.ownerChain; }, "replay-schema"],
    ["replay resolution", (x: any) => { x.at(-1).inventory.entries[0].replay.routeSelectionResolution = "fallback"; }, "replay-schema"],
    ["replay policy digest", (x: any) => { x.at(-1).inventory.entries[0].replay.policyDigest = "a".repeat(64); }, "entry-replay-binding"],
    ["plan key set", (x: any) => { delete x.at(-1).inventory.entries[0].executionPlan.recipe; }, "execution-plan-schema"],
    ["plan version", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.version = 1; }, "execution-plan-schema"],
    ["optional router value", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.recipe.routerModuleSpecifier = "router"; }, "execution-plan-schema"],
    ["mount schema", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.recipe.mounts[0].extra = true; }, "execution-plan-schema"],
    ["context digest", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.planningContextDigest = "0".repeat(64); }, "execution-plan-schema"],
    ["plan self digest", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.digest = "0".repeat(64); }, "execution-plan-digest"],
    ["entry replay component", (x: any) => { x.at(-1).inventory.entries[0].replay.componentName = "Other"; }, "entry-replay-binding"],
    ["entry replay owner", (x: any) => { x.at(-1).inventory.entries[0].replay.owner.sourcePath = "/other"; }, "entry-replay-binding"],
    ["entry replay selection", (x: any) => { x.at(-1).inventory.entries[0].replay.selection = [{ componentName: "Group", pattern: "/other" }]; }, "entry-replay-binding"],
    ["plan branch", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.selectedBranch.pathname = "/other"; }, "entry-execution-plan-binding"],
    ["candidate agreement", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.pageCandidateId = "page:other"; }, "entry-execution-plan-binding"],
    ["role contract", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.rootRoleContract.sourcePath = "/other"; }, "entry-execution-plan-binding"],
    ["recipe binding", (x: any) => { x.at(-1).inventory.entries[0].executionPlan.recipe.pathname = "/other"; }, "entry-execution-plan-binding"],
  ])("rejects AC-5 %s", (_name, mutate, expected) => { const corpus: any = structuredClone(validFixture()); mutate(corpus); expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true); });
  it.each([
    ["valid duplicate", (x: any) => { const entry = x.at(-1).inventory.entries[0]; const copy = structuredClone(entry); const duplicate = { id: "duplicate-route", componentName: copy.componentName, exportName: copy.exportName, owner: copy.owner, parameters: copy.parameters, pathname: copy.pathname, pattern: copy.pattern, selection: copy.selection, sourcePath: copy.sourcePath, disposition: "duplicate", duplicateOf: entry.id, reason: "exact-semantic-route", replay: copy.replay }; x.at(-1).inventory.entries.push(duplicate); x.at(-1).inventory.counts = { duplicate: 1, runnable: 1, total: 2, unresolved: 0 }; }, false],
    ["dangling duplicate", (x: any) => { const entry = x.at(-1).inventory.entries[0]; const copy = structuredClone(entry); copy.replay.branchId = "duplicate-route"; const duplicate = { id: "duplicate-route", componentName: copy.componentName, exportName: copy.exportName, owner: copy.owner, parameters: copy.parameters, pathname: copy.pathname, pattern: copy.pattern, selection: copy.selection, sourcePath: copy.sourcePath, disposition: "duplicate", duplicateOf: "missing", reason: "exact-semantic-route", replay: copy.replay }; x.at(-1).inventory.entries.push(duplicate); x.at(-1).inventory.counts = { duplicate: 1, runnable: 1, total: 2, unresolved: 0 }; }, true],
    ["self duplicate", (x: any) => { const entry = x.at(-1).inventory.entries[0]; const copy = structuredClone(entry); copy.replay.branchId = "duplicate-route"; const duplicate = { id: "duplicate-route", componentName: copy.componentName, exportName: copy.exportName, owner: copy.owner, parameters: copy.parameters, pathname: copy.pathname, pattern: copy.pattern, selection: copy.selection, sourcePath: copy.sourcePath, disposition: "duplicate", duplicateOf: "duplicate-route", reason: "exact-semantic-route", replay: copy.replay }; x.at(-1).inventory.entries.push(duplicate); x.at(-1).inventory.counts = { duplicate: 1, runnable: 1, total: 2, unresolved: 0 }; }, true],
    ["duplicate target cannot be duplicate", (x: any) => { const entry = x.at(-1).inventory.entries[0]; entry.id = "runnable-route"; entry.replay.branchId = entry.id; entry.executionPlan.routeId = entry.id; entry.executionPlan.selectedBranch.id = entry.id; entry.executionPlan.digest = canonicalDigest(Object.fromEntries(Object.entries(entry.executionPlan).filter(([key]) => key !== "digest"))); const duplicate = { ...structuredClone(entry), id: "duplicate-route", disposition: "duplicate", duplicateOf: entry.id, reason: "expanded-owner" }; delete duplicate.executionPlan; duplicate.replay.branchId = duplicate.id; entry.disposition = "duplicate"; entry.duplicateOf = duplicate.id; entry.reason = "expanded-owner"; delete entry.executionPlan; x.at(-1).inventory.entries.push(duplicate); x.at(-1).inventory.counts = { duplicate: 2, runnable: 0, total: 2, unresolved: 0 }; }, true],
    ["unresolved exact keys", (x: any) => { const unresolved = { id: "unresolved-route", componentName: "Missing", owner: { exportName: "default", sourcePath: "/missing.tsx" }, parameters: {}, pathname: "/missing", pattern: "/missing", selection: [{ componentName: "Missing", pattern: "/missing" }], disposition: "unresolved", reason: "component-unresolved", replay: {} }; x.at(-1).inventory.entries.push(unresolved); x.at(-1).inventory.counts = { duplicate: 0, runnable: 1, total: 2, unresolved: 1 }; }, true],
    ["unresolved blocker", (x: any) => { const unresolved = { id: "unresolved-route", componentName: "Missing", owner: { exportName: "default", sourcePath: "/missing.tsx" }, parameters: {}, pathname: "/missing", pattern: "/missing", selection: [{ componentName: "Missing", pattern: "/missing" }], disposition: "unresolved", reason: "unknown" }; x.at(-1).inventory.entries.push(unresolved); x.at(-1).inventory.counts = { duplicate: 0, runnable: 1, total: 2, unresolved: 1 }; }, true],
  ])("enforces duplicate targets and unresolved blockers: %s", (_name, mutate, invalid) => { const corpus: any = structuredClone(validFixture()); mutate(corpus); const failed = validateTrace(corpus).checks.some((check: any) => !check.passed); expect(failed).toBe(invalid); });
  it("binds a supplied execution-plan policy digest", () => { const corpus: any = validFixture(); const inventoryPolicy: any = { ...policy.inventory, executionPlanPolicyDigest: corpus.at(-1).inventory.entries[0].executionPlan.policyDigest }; expect(checkFailed(validateTrace(corpus, { ...policy, inventory: inventoryPolicy }), "execution-plan-policy")).toBe(false); corpus.at(-1).inventory.entries[0].executionPlan.policyDigest = "a".repeat(64); expect(checkFailed(validateTrace(corpus, { ...policy, inventory: inventoryPolicy }), "execution-plan-policy")).toBe(true); });
  it.each([
    ["missing final LF", "{\"ok\":true}"],
    ["empty", ""],
    ["blank line", "{\"ok\":true}\n\n"],
    ["bad JSON", "{\n"],
  ])("rejects raw JSONL %s", (_name, bytes) => expect(() => parseJsonl(bytes)).toThrow());
  it("parses canonical nonempty JSONL", () => expect(parseJsonl("{\"ok\":true}\n")).toEqual([{ ok: true }]));
  it.each([
    ["progress event schema", (x: any) => { x[1].event.version = 3; }, "progress-schema"],
    ["event key order", (x: any) => { const event = x.find((r: any) => r.event?.routeOrdinal === 1).event; const phase = event.phase; delete event.phase; event.phase = phase; }, "progress-schema"],
    ["event extra key", (x: any) => { x.find((r: any) => r.event?.routeOrdinal === 1).event.extra = 1; }, "progress-schema"],
    ["event missing key", (x: any) => { delete x.find((r: any) => r.event?.routeOrdinal === 1).event.executionPlanTotal; }, "progress-schema"],
    ["phase interleave", (x: any) => { x[3].event.phase = "prepare-source"; }, "phase-order"],
    ["enumeration checkpoint", (x: any) => { x[3].event.analysisPasses = 9; }, "enumeration-contract"],
    ["enumeration equation", (x: any) => { x[3].event.enumerationPrefixRequestCount = 1; }, "enumeration-contract"],
    ["replay total", (x: any) => { x[7].event.replayTotal = 4; }, "replay-contract"],
    ["replay checkpoint", (x: any) => { x[8].event.replayCompleted = 8; }, "replay-contract"],
    ["execution phase pair", (x: any) => { x.find((r: any) => r.event?.phase === "execution-route-usage" && r.event.transition === "complete").event.transition = "start"; }, "execution-derived-contract"],
    ["execution interleaving", (x: any) => { const left = x.findIndex((r: any) => r.event?.phase === "execution-frontier-style" && r.event.transition === "start"); [x[left], x[left + 1]] = [x[left + 1], x[left]]; }, "execution-derived-contract"],
    ["execution terminal", (x: any) => { const execution = x.filter((r: any) => r.event?.routeOrdinal === 1).at(-1); execution.event.executionPlanCompleted = 0; }, "execution-derived-contract"],
    ["bundle placement", (x: any) => { const execution = x.find((r: any) => r.event?.bundleDiagnostics); execution.event.phase = "execution-frontier-plan"; }, "bundle-schema"],
    ["terminal fallback", (x: any) => { x.at(-1).lastCounters.executionPlanCompleted = 1; }, "execution-derived-contract"],
  ])("rejects AC-1 through AC-4 %s", (_name, mutate, expected) => { const corpus: any = structuredClone(validFixture()); mutate(corpus); expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true); });
  it.each([
    ["numeric", "/groups/:id(\\d+)", "/groups/x", { id: "x" }, "pathname-pattern-mismatch"],
    ["missing", "/groups/:id", "/groups/1", {}, "parameter-capture-mismatch"],
    ["extra", "/groups/:id", "/groups/1", { id: "1", extra: "x" }, "unexpected-parameter"],
    ["trailing", "/groups/:id", "/groups/1/extra", { id: "1" }, "pathname-pattern-mismatch"],
    ["v4", "/users/:id([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/*", "/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rest", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, ""],
    ["bad-v4-prefix", "/users/:id([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/*", "/users/aaaaaaaa/rest", { id: "aaaaaaaa" }, "pathname-pattern-mismatch"],
  ])("independently matches %s routes", (_name, pattern, pathname, parameters, expected) => { const errors = validateRoute({ pattern, pathname, parameters }); if (expected) expect(errors).toContain(expected); else expect(errors).toEqual([]); });
  it.each([
    ["nested groups and escaped parentheses", "/x/:id((?:a\\)b|[c/d])+)", "/x/a)b", { id: "a)b" }, []],
    ["character class", "/x/:id([a-z/]+)", "/x/a", { id: "a" }, []],
    ["duplicate parameter", "/x/:id/:id", "/x/a/a", { id: "a" }, ["route-pattern"]],
    ["non-string parameter", "/x/:id", "/x/a", { id: 1 }, ["parameter-capture-mismatch"]],
    ["empty terminal splat", "/x/:id/*", "/x/a", { id: "a" }, []],
    ["slash terminal splat", "/x/:id/*", "/x/a/rest/of/path", { id: "a" }, []],
    ["invalid constrained splat prefix", "/x/:id(\\d+)/*", "/x/no/rest", { id: "no" }, ["pathname-pattern-mismatch"]],
  ])("handles parser edge case %s", (_name, pattern, pathname, parameters, expected) => expect(validateRoute({ pattern, pathname, parameters } as any)).toEqual(expected));
  it("records actual parameter offsets and evaluates runnable entries only", () => { const entries: any[] = [{ id: "ignored", disposition: "duplicate", pattern: "/x/:id", pathname: "/x/no", parameters: { id: "no" } }, { id: "second", disposition: "runnable", pattern: "/x/:first(\\d+)/:second(\\w+)", pathname: "/x/no/!", parameters: { first: "no", second: "!" } }]; const result = evaluateRouteSemantics(entries); expect(result.violations.map((v: any) => [v.id, v.tokenOffset])).toEqual([["second", 3], ["second", 15]]); });
  it("rejects malformed balanced route patterns", () => { expect(() => parseRoutePattern("/x/:id([a-z]+)")).not.toThrow(); expect(() => parseRoutePattern("/x/:id([a-z]+")) .toThrow(); });
  it("asserts the pure authority semantic expectation", () => { const entries = Array.from({ length: 31 }, () => ({ parameters: { id: "aaaaaaaa" } })); const report: any = { inventory: { entries }, violations: Array.from({ length: 31 }, (_, inventoryIndex) => ({ inventoryIndex, code: "pathname-pattern-mismatch", nonSplat: inventoryIndex < 30 })), blockers: Array.from({ length: 18 }, () => ({})) }; expect(requireAuthoritySemanticFailure(report)).toBe(true); report.violations.pop(); expect(() => requireAuthoritySemanticFailure(report)).toThrow(); });
  it("orders semantic violations and unresolved blockers deterministically", () => { const corpus: any = validFixture(); corpus.at(-1).inventory.entries.push({ id: "unresolved-z", disposition: "unresolved", pattern: "<unresolved>", pathname: "", parameters: {}, reason: "z" }, { ...corpus.at(-1).inventory.entries[0], id: "bad-a", pathname: "/groups/nope", parameters: { groupId: "nope" } }); corpus.at(-1).inventory.counts = { total: 3, runnable: 2, duplicate: 0, unresolved: 1 }; const result = validateTrace(corpus); expect(result.firstViolation.id).toBe("bad-a"); expect(result.firstBlocker.id).toBe("unresolved-z"); });
  it("requires verified official inputs before artifact persistence", () => { const paths = ["a.json", "b.json", "c.json", "d.json", "manifest.json", "sums"].map((file) => join(tmpdir(), `rtcc-v3-${file}`)); expect(() => persistOfficialArtifacts({ paths, body: {} as any, expectedExitCode: 1 })).toThrow("artifact-input-required"); });
  it("builds a canonical placeholder-free gate in memory only after recorded Sol PASS", () => { const writes: any[] = []; const result = buildValidatorGate({ cwd: projectRoot, preOfficialSolReview: { status: "PASS", recordedAt: "2026-08-01T00:00:00.000Z" }, writeFile: (...args: any[]) => { writes.push(args); } }); expect(result.bytes.endsWith("\n")).toBe(true); expect(result.bytes).not.toMatch(/<[^>]+>/); expect(result.gate.command.fixedArgumentPrefix).toEqual(officialArgs("x").slice(0, 4)); expect(result.gate.command.finalArgumentRelation).toBe("final argument equals SHA-256 of raw gate bytes"); expect(assertGateSchema(result.gate, { bindings: result.gate.bindings })).toBe(true); expect(writes).toHaveLength(1); expect(() => buildValidatorGate({ cwd: projectRoot, preOfficialSolReview: { status: "FAIL", recordedAt: "x" }, writeFile: () => {} })).toThrow(); });
  it("rejects injectable gate, argv, binding, symlink, and reserved-output mutations", () => { const prepared = preparedPreflight(); const options: any = prepared.options; expect(preflightOfficialRun(options).gateSha256).toBe(prepared.gate.sha256); expect(() => preflightOfficialRun({ ...options, argv: [...prepared.argv.slice(0, 4), "0".repeat(64)] })).toThrow(); expect(() => preflightOfficialRun({ ...options, argv: [prepared.argv[0], prepared.argv[2], prepared.argv[1], prepared.argv[3], prepared.argv[4]] })).toThrow(); expect(() => preflightOfficialRun({ ...options, lstat: () => ({ isFile: () => true, isSymbolicLink: () => true }) })).toThrow(); expect(() => preflightOfficialRun({ ...options, exists: () => true })).toThrow("reserved-output-exists"); expect(() => preflightOfficialRun({ ...options, readFile: (path: string, encoding?: string) => path.endsWith("rtccV3Fixture.ts") ? (encoding ? "altered" : Buffer.from("altered")) : prepared.read(path, encoding) })).toThrow(); });
  it.each(["gate", "runtime", "outputHashes", "officialRunCount", "prohibitedActions"]) ("rejects evidence omission %s", (key) => { const value: any = { schemaVersion: 1, kind: "validator-run-evidence", gate: null, runtime: "x", outputHashes: ["a", "b", "c"], officialRunCount: 1, retryCount: 0, externalRunCount: 0, prohibitedActions: {} }; delete value[key]; expect(() => assertEvidenceSchema(value)).toThrow(); });
  it.each(["authority", "predecessors", "engineTerminal", "prohibitedActions", "cannotConvertCompletionToReleaseGo"]) ("rejects lineage omission %s", (key) => { const value: any = { schemaVersion: 1, kind: "semantic-failure-lineage", authority: {}, predecessors: { planSha256: "x", attemptSha256: "x", terminalEvidenceSha256: "x", attempt: {}, terminal: {} }, engineTerminal: {}, prohibitedActions: {}, cannotConvertCompletionToReleaseGo: true }; delete value[key]; expect(() => assertLineageSchema(value)).toThrow(); });
  it.each([[{ path: "z", sha256: "x" }, { path: "a", sha256: "x" }], [{ path: "a", sha256: "x" }, { path: "a", sha256: "x" }], [{ path: "artifact-manifest.json", sha256: "x" }]])("rejects manifest drift", (...results: any[]) => expect(() => assertManifestSchema({ schemaVersion: 1, kind: "artifact-manifest", inputs: [], results })).toThrow());
  it.each(["a".repeat(64) + "  a\n" + "b".repeat(64) + "  a\n", "a".repeat(64) + "  SHA256SUMS\n"]) ("rejects SHA self/duplicate reference", (bytes) => expect(() => assertSumsSchema(bytes)).toThrow());
  it.each([0, 1, 2, 3, 4, 5])("stops sequential wx writes at injected failure %i", (failureIndex) => { const prepared = preparedPreflight(); const preflight = preflightOfficialRun(prepared.options); const body: any = officialBody(); const writes: string[] = []; const paths = outputNames.map((name) => join(isolatedTemp("rtcc-v3-injected-"), name)); expect(() => persistOfficialArtifacts({ paths, body, expectedExitCode: 1, gate: prepared.gate.gate, gateSha256: prepared.gate.sha256, moduleHashes: prepared.gate.gate.bindings, predecessors: preflight.predecessors, invocation: preflight.invocation, writeFile: (path: string) => { if (writes.length === failureIndex) throw new Error("injected"); writes.push(path); } })).toThrow("injected"); expect(writes).toHaveLength(failureIndex); });
  it("keeps canonical self digests stable", () => expect(canonicalDigest({ b: 1, a: [true] })).toBe(canonicalDigest({ a: [true], b: 1 })));
  it.each([
    ["variant A", (entry: any) => entry, false],
    ["variant B", (entry: any) => ({ id: entry.id, componentName: entry.componentName, exportName: "default", owner: entry.owner, parameters: entry.parameters, pathname: entry.pathname, pattern: entry.pattern, selection: entry.selection, sourcePath: "/missing.tsx", disposition: entry.disposition, reason: entry.reason }), false],
    ["export only", (entry: any) => ({ ...entry, exportName: "default" }), true],
    ["source only", (entry: any) => ({ ...entry, sourcePath: "/missing.tsx" }), true],
    ["empty export", (entry: any) => ({ id: entry.id, componentName: entry.componentName, exportName: "", owner: entry.owner, parameters: entry.parameters, pathname: entry.pathname, pattern: entry.pattern, selection: entry.selection, sourcePath: "/missing.tsx", disposition: entry.disposition, reason: entry.reason }), true],
    ["empty source", (entry: any) => ({ id: entry.id, componentName: entry.componentName, exportName: "default", owner: entry.owner, parameters: entry.parameters, pathname: entry.pathname, pattern: entry.pattern, selection: entry.selection, sourcePath: "", disposition: entry.disposition, reason: entry.reason }), true],
    ["reordered", (entry: any) => reorder(entry), true],
    ["extra", (entry: any) => ({ ...entry, extra: true }), true],
  ])("enforces unresolved exact union %s", (_name, create, invalid) => { const corpus: any = validFixture(); const entry = { id: "unresolved", componentName: "Missing", owner: { exportName: "default", sourcePath: "/missing.tsx" }, parameters: {}, pathname: "/missing", pattern: "/missing", selection: [{ componentName: "Missing", pattern: "/missing" }], disposition: "unresolved", reason: "component-unresolved" }; corpus.at(-1).inventory.entries.push(create(entry)); corpus.at(-1).inventory.counts = { duplicate: 0, runnable: 1, total: 2, unresolved: 1 }; expect(validateTrace(corpus, { ...policy, inventory: { ...policy.inventory, total: 2, unresolved: 1 } }).checks.some((check: any) => !check.passed)).toBe(invalid); });
  it.each([
    ["own fields differ", (duplicate: any) => { duplicate.componentName = "Different"; duplicate.exportName = "named"; duplicate.owner = { exportName: "owner", sourcePath: "/different.tsx" }; duplicate.parameters = { other: "1" }; duplicate.pathname = "/different"; duplicate.pattern = "/different"; duplicate.selection = [{ componentName: "Different", pattern: "/different" }]; duplicate.sourcePath = "/different.tsx"; }, false],
    ["target replay id mismatch", (duplicate: any) => { duplicate.replay.branchId = "other"; }, true],
    ["dangling target", (duplicate: any) => { duplicate.duplicateOf = "missing"; }, true],
    ["non-runnable target", (duplicate: any, corpus: any) => { corpus.at(-1).inventory.entries[0].disposition = "unresolved"; delete corpus.at(-1).inventory.entries[0].replay; delete corpus.at(-1).inventory.entries[0].executionPlan; corpus.at(-1).inventory.entries[0].reason = "component-unresolved"; }, true],
    ["self target", (duplicate: any) => { duplicate.duplicateOf = duplicate.id; }, true],
    ["unequal target replay", (duplicate: any) => { duplicate.replay.pathname = "/other"; }, true],
  ])("enforces duplicate replay binding %s", (_name, mutate, invalid) => { const corpus: any = validFixture(); const target = corpus.at(-1).inventory.entries[0]; const duplicate: any = { id: "duplicate", componentName: target.componentName, exportName: target.exportName, owner: target.owner, parameters: target.parameters, pathname: target.pathname, pattern: target.pattern, selection: target.selection, sourcePath: target.sourcePath, disposition: "duplicate", duplicateOf: target.id, reason: "exact-semantic-route", replay: structuredClone(target.replay) }; corpus.at(-1).inventory.entries.push(duplicate); corpus.at(-1).inventory.counts = { duplicate: 1, runnable: 1, total: 2, unresolved: 0 }; mutate(duplicate, corpus); expect(validateTrace(corpus, { ...policy, inventory: { ...policy.inventory, total: 2, duplicate: 1 } }).checks.some((check: any) => !check.passed)).toBe(invalid); });
  it("rejects reserved outputs before reading authority or writing results", () => { const prepared = preparedPreflight(); let authorityReads = 0; let writes = 0; expect(() => preflightOfficialRun({ ...prepared.options, exists: () => true, readFile: (path: string, encoding?: string) => { if (path === AUTHORITY_PATH) authorityReads += 1; return prepared.read(path, encoding); } })).toThrow("reserved-output-exists"); expect(authorityReads).toBe(0); expect(writes).toBe(0); });
  it.each([
    ["placeholder hash", (options: any) => ({ ...options, argv: officialArgs("<raw-gate-sha256>") })],
    ["wrong cwd", (options: any) => ({ ...options, invocation: { ...options.invocation, cwd: "/tmp" } })],
    ["wrong executable", (options: any) => ({ ...options, invocation: { ...options.invocation, execPath: "/usr/bin/node" } })],
    ["wrong script", (options: any) => ({ ...options, invocation: { ...options.invocation, argv: [nodePath, "/tmp/validator.mjs", ...options.argv] } })],
    ["wrong argv identity", (options: any) => ({ ...options, invocation: { ...options.invocation, argv: [...options.invocation.argv, "extra"] } })],
    ["wrong approved relation", (options: any) => ({ ...options, argv: [...options.argv.slice(0, 4), "0".repeat(64)] })],
  ])("requires the exact actual invocation %s", (_name, mutate) => { const prepared = preparedPreflight(); expect(preflightOfficialRun(prepared.options).invocation.argv).toEqual(actualInvocation(prepared.argv).argv); expect(() => preflightOfficialRun(mutate(prepared.options))).toThrow(); });
  it("rejects amendment-3 and gate binding identity mutations", () => { const prepared = preparedPreflight(); const changedPlan = structuredClone(prepared.gate.gate); changedPlan.bindings[3].sha256 = "0".repeat(64); const bytes = `${JSON.stringify(changedPlan, null, 2)}\n`; const sha = createHash("sha256").update(bytes).digest("hex"); expect(() => preflightOfficialRun({ ...prepared.options, argv: officialArgs(sha), invocation: actualInvocation(officialArgs(sha)), readFile: (path: string, encoding?: string) => path.endsWith("validator-gate.json") ? (encoding ? bytes : Buffer.from(bytes)) : readFileSync(path, encoding as any) })).toThrow("gate-schema-drift"); });
  it.each(["spawn", "retry", "external", "browser", "chromium", "server", "campaign", "timeout", "newRoot", "profileRetry"])("rejects lineage prohibited action %s", (key) => { const run = persistedArtifacts(); try { const value: any = structuredClone(run.artifacts.lineage); value.prohibitedActions[key] = true; expect(() => assertLineageSchema(value, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, predecessors: run.preflight.predecessors })).toThrow(); delete value.prohibitedActions[key]; expect(() => assertLineageSchema(value)).toThrow(); } finally { rmSync(run.temp, { recursive: true, force: true }); } });
  it.each(["spawn", "retry", "external", "browser", "chromium", "server", "campaign", "timeout", "newRoot", "profileRetry"])("rejects evidence prohibited action %s", (key) => { const run = persistedArtifacts(); try { const value: any = structuredClone(run.artifacts.evidence); value.prohibitedActions[key] = true; expect(() => assertEvidenceSchema(value, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings })).toThrow(); delete value.prohibitedActions[key]; expect(() => assertEvidenceSchema(value)).toThrow(); } finally { rmSync(run.temp, { recursive: true, force: true }); } });
  it.each(["missing", "extra", "reordered", "abbreviated", "placeholder", "inconsistent"])("rejects exact lineage facts %s", (kind) => { const run = persistedArtifacts(); try { const value: any = structuredClone(run.artifacts.lineage); if (kind === "missing") delete value.authority.bytes; if (kind === "extra") value.extra = true; if (kind === "reordered") { const next = reorder(value); Object.keys(value).forEach((key) => delete value[key]); Object.assign(value, next); } if (kind === "abbreviated") value.plans.pop(); if (kind === "placeholder") value.gate.sha256 = "0".repeat(64); if (kind === "inconsistent") value.engineTerminal.executionPlanCompleted = 680; expect(() => assertLineageSchema(value, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, predecessors: run.preflight.predecessors })).toThrow(); } finally { rmSync(run.temp, { recursive: true, force: true }); } });
  it.each(["missing", "extra", "reordered", "abbreviated", "placeholder", "inconsistent"])("rejects exact evidence facts %s", (kind) => { const run = persistedArtifacts(); try { const value: any = structuredClone(run.artifacts.evidence); if (kind === "missing") delete value.invocation.argv; if (kind === "extra") value.extra = true; if (kind === "reordered") { const next = reorder(value); Object.keys(value).forEach((key) => delete value[key]); Object.assign(value, next); } if (kind === "abbreviated") value.bindings.pop(); if (kind === "placeholder") value.invocation.argv[6] = "<raw-gate-sha256>"; if (kind === "inconsistent") value.officialRunCount = 2; expect(() => assertEvidenceSchema(value, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings })).toThrow(); } finally { rmSync(run.temp, { recursive: true, force: true }); } });
  it.each(["missing", "extra", "reordered", "duplicate", "self", "bad hash", "bad path"])("rejects exact manifest claims %s", (kind) => { const run = persistedArtifacts(); try { const value: any = structuredClone(run.artifacts.manifest); if (kind === "missing") delete value.inputs; if (kind === "extra") value.extra = true; if (kind === "reordered") value.results.reverse(); if (kind === "duplicate") value.results[1].path = value.results[0].path; if (kind === "self") value.results[3].path = ".plan/launchers/rtcc-v5.5.31-artifact-manifest.json"; if (kind === "bad hash") value.results[0].sha256 = "0".repeat(64); if (kind === "bad path") value.results[0].path = "wrong"; expect(() => assertManifestSchema(value, { gateSha256: run.prepared.gate.sha256, bytes: run.artifacts.bytes.slice(0, 4) })).toThrow(); } finally { rmSync(run.temp, { recursive: true, force: true }); } });
  it.each(["missing", "extra", "reordered", "duplicate", "self", "bad hash", "bad path"])("rejects exact SHA claims %s", (kind) => { const run = persistedArtifacts(); try { let lines = run.artifacts.bytes[5].trimEnd().split("\n"); if (kind === "missing") lines = lines.slice(1); if (kind === "extra") lines.push(`${"0".repeat(64)}  extra`); if (kind === "reordered") lines.reverse(); if (kind === "duplicate") lines[1] = lines[0]; if (kind === "self") lines[4] = `${"0".repeat(64)}  .plan/launchers/rtcc-v5.5.31-SHA256SUMS`; if (kind === "bad hash") lines[0] = `${"0".repeat(64)}  .plan/launchers/rtcc-v5.5.31-profile-validation.json`; if (kind === "bad path") lines[0] = `${lines[0].slice(0, 64)}  wrong`; expect(() => assertSumsSchema(`${lines.join("\n")}\n`, { bytes: run.artifacts.bytes.slice(0, 5) })).toThrow(); } finally { rmSync(run.temp, { recursive: true, force: true }); } });
  it.each([-1, 0, 1, 2, 3, 4, 5])("keeps exact bytes and terminal absence when persistence fails at %i", (failureIndex) => { const run = persistedArtifacts(); try { rmSync(run.temp, { recursive: true, force: true }); const temp = isolatedTemp("rtcc-v3-terminal-"); const paths = outputNames.map((name) => join(temp, name)); const writes: string[] = []; const authorityBytes = readFileSync(AUTHORITY_PATH, "utf8"); const body: any = { schemaVersion: 3, validator: "rtcc-preview-complete-route-profile-v3", authority: { path: AUTHORITY_PATH, sha256: AUTHORITY_SHA256, lineCount: 1530 }, authorityBytes, externalRunCount: 0, noRetry: true, productionChanged: false, ...validateTrace(authorityBytes.trimEnd().split("\n").map((line) => JSON.parse(line)), AUTHORITY_POLICY) }; expect(() => persistOfficialArtifacts({ paths, body, expectedExitCode: 1, gate: run.prepared.gate.gate, gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, predecessors: run.preflight.predecessors, invocation: run.preflight.invocation, writeFile: (path: string, bytes: string) => { const index = writes.length; if (index === failureIndex || failureIndex === -1) throw new Error("injected"); writes.push(path); writeFileSync(path, bytes, { encoding: "utf8", flag: "wx" }); } })).toThrow("injected"); expect(writes).toHaveLength(failureIndex < 0 ? 0 : failureIndex); for (let index = 0; index < paths.length; index += 1) { if (index < Math.max(0, failureIndex)) expect(readFileSync(paths[index]!, "utf8")).toBe(run.artifacts.bytes[index]); else expect(existsSync(paths[index]!)).toBe(false); } rmSync(temp, { recursive: true, force: true }); } finally { if (existsSync(run.temp)) rmSync(run.temp, { recursive: true, force: true }); } });
  it.each([
    ["top missing", (gate: any) => { delete gate.cwd; }],
    ["top extra", (gate: any) => { gate.extra = true; }],
    ["top reordered", (gate: any) => { reorderInPlace(gate); }],
    ["review", (gate: any) => { gate.preOfficialSolReview.status = "FAIL"; }],
    ["review order", (gate: any) => { reorderInPlace(gate.preOfficialSolReview); }],
    ["node", (gate: any) => { gate.node.version = "v0.0.0"; }],
    ["node extra", (gate: any) => { gate.node.extra = true; }],
    ["authority", (gate: any) => { gate.authority.sha256 = "0".repeat(64); }],
    ["bindings", (gate: any) => { gate.bindings[0].path = "wrong"; }],
    ["binding hash", (gate: any) => { gate.bindings[0].sha256 = "0".repeat(64); }],
    ["binding order", (gate: any) => { reorderInPlace(gate.bindings[0]); }],
    ["production", (gate: any) => { gate.productionManifest.entries = 34; }],
    ["production order", (gate: any) => { reorderInPlace(gate.productionManifest); }],
    ["command prefix", (gate: any) => { gate.command.fixedArgumentPrefix[0] = "--wrong"; }],
    ["command relation", (gate: any) => { gate.command.finalArgumentRelation = "wrong"; }],
    ["command order", (gate: any) => { reorderInPlace(gate.command); }],
    ["recursive placeholder", (gate: any) => { gate.command.finalArgumentRelation = "<gate-hash>"; }],
  ])("rejects recomputed-hash exact gate schema drift %s", (_name, mutate) => { const prepared = preparedPreflight(); const gate: any = structuredClone(prepared.gate.gate); mutate(gate); const bytes = `${JSON.stringify(gate, null, 2)}\n`; const hash = createHash("sha256").update(bytes).digest("hex"); expect(() => assertGateSchema(gate, { bindings: prepared.gate.gate.bindings })).toThrow(); expect(() => preflightOfficialRun({ ...prepared.options, argv: officialArgs(hash), invocation: actualInvocation(officialArgs(hash)), readFile: (path: string, encoding?: string) => path.endsWith("validator-gate.json") ? (encoding ? bytes : Buffer.from(bytes)) : readFileSync(path, encoding as any) })).toThrow(); });
  it.each([0, 1, 2, 3, 4, 5, 6])("rejects actual invocation token mismatch %i", (index) => { const run = persistedArtifacts(); const evidence: any = structuredClone(run.artifacts.evidence); evidence.invocation.argv[index] = `${evidence.invocation.argv[index]}-wrong`; expect(() => assertEvidenceSchema(evidence, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, bytes: run.artifacts.bytes.slice(0, 3) })).toThrow(); });
  it.each([0, 1, 2, 3, 4])("rejects approved invocation token mismatch %i", (index) => { const run = persistedArtifacts(); const evidence: any = structuredClone(run.artifacts.evidence); evidence.invocation.approvedTokens[index] = `${evidence.invocation.approvedTokens[index]}-wrong`; expect(() => assertEvidenceSchema(evidence, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, bytes: run.artifacts.bytes.slice(0, 3) })).toThrow(); });
  it("persists no placeholder recursively in gate or validator evidence", () => { const run = persistedArtifacts(); expect(JSON.stringify(run.prepared.gate.gate)).not.toMatch(/<[^>]+>/); expect(JSON.stringify(run.artifacts.evidence)).not.toMatch(/<[^>]+>/); expect(run.artifacts.evidence.invocation.approvedTokens).toEqual(run.prepared.argv); });
  it.each(["plan", "canonicalArgv", "executor", "executorTest", "attempt", "terminal", "gateProbe", "preflight", "lineage"])("rejects predecessor fixed identity mutation %s", (key) => { const run = persistedArtifacts(); const lineage: any = structuredClone(run.artifacts.lineage); lineage.predecessors[key].sha256 = "0".repeat(64); expect(() => assertLineageSchema(lineage, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings })).toThrow(); });
  it.each([
    ["canonical missing", "canonicalArgv", (value: any) => { delete value.argumentCount; }],
    ["canonical extra", "canonicalArgv", (value: any) => { value.extra = true; }],
    ["canonical reordered", "canonicalArgv", reorderInPlace],
    ["canonical value", "canonicalArgv", (value: any) => { value.argumentCount = 21; }],
    ["attempt missing", "attempt", (value: any) => { delete value.command; }],
    ["attempt extra", "attempt", (value: any) => { value.extra = true; }],
    ["attempt reordered", "attempt", reorderInPlace],
    ["attempt value", "attempt", (value: any) => { value.profileSpawnApiInvocationCount = 1; }],
    ["terminal missing", "terminal", (value: any) => { delete value.execution.events; }],
    ["terminal extra", "terminal", (value: any) => { value.streams.extra = true; }],
    ["terminal reordered", "terminal", (value: any) => { reorderInPlace(value.execution); }],
    ["terminal value", "terminal", (value: any) => { value.audit.strict681AuditPerformed = true; }],
    ["gate probe missing", "gateProbe", (value: any) => { delete value.result; }],
    ["gate probe extra", "gateProbe", (value: any) => { value.extra = true; }],
    ["gate probe reordered", "gateProbe", reorderInPlace],
    ["gate probe value", "gateProbe", (value: any) => { value.result = "fail"; }],
    ["preflight missing", "preflight", (value: any) => { delete value.decision; }],
    ["preflight extra", "preflight", (value: any) => { value.extra = true; }],
    ["preflight reordered", "preflight", reorderInPlace],
    ["preflight value", "preflight", (value: any) => { value.decision.preflightPassed = false; }],
    ["lineage missing", "lineage", (value: any) => { delete value.predecessor; }],
    ["lineage extra", "lineage", (value: any) => { value.extra = true; }],
    ["lineage reordered", "lineage", reorderInPlace],
    ["lineage value", "lineage", (value: any) => { value.decision.terminal = false; }],
  ])("rejects exact predecessor nested mutation %s", (_name, key, mutate) => { const run = persistedArtifacts(); const lineage: any = structuredClone(run.artifacts.lineage); mutate(lineage.predecessors[key].value); expect(() => assertLineageSchema(lineage, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings })).toThrow(); });
  it.each([
    ["profile authority missing", "profile", (value: any) => { delete value.authority.lineCount; }],
    ["profile authority reorder", "profile", (value: any) => { reorderInPlace(value.authority); }],
    ["profile nested extra", "profile", (value: any) => { value.inventory.extra = true; }],
    ["profile authority hash", "profile", (value: any) => { value.authority.sha256 = "0".repeat(64); }],
    ["profile inconsistent", "profile", (value: any) => { value.engineTerminal.executionPlanCompleted = 680; }],
    ["semantic authority missing", "semantic", (value: any) => { delete value.authority.lineCount; }],
    ["semantic authority reorder", "semantic", (value: any) => { reorderInPlace(value.authority); }],
    ["semantic nested extra", "semantic", (value: any) => { value.inventory.extra = true; }],
    ["semantic authority hash", "semantic", (value: any) => { value.authority.sha256 = "0".repeat(64); }],
    ["semantic inconsistent", "semantic", (value: any) => { value.violations.pop(); }],
  ])("rejects exact official payload mutation %s", (_name, kind, mutate) => { const run = persistedArtifacts(); const value: any = structuredClone(kind === "profile" ? run.artifacts.validation : run.artifacts.semantic); mutate(value); const assertion = kind === "profile" ? assertProfileValidationSchema : assertSemanticReportSchema; expect(() => assertion(value, { body: run.body })).toThrow(); });
  it.each([
    ["header production aggregate", (body: any) => { body.header.productionAggregate = "0".repeat(64); }],
    ["header digest", (body: any) => { body.header.sourceManifestDigest = "0".repeat(64); }],
    ["nested inventory mount", (body: any) => { body.inventory.entries.find((entry: any) => entry.disposition === "runnable" && entry.executionPlan.recipe.mounts.length > 0).executionPlan.recipe.mounts[0].basePath = "/forged"; }],
    ["inventory counts", (body: any) => { body.inventory.counts.runnable = 680; }],
    ["check name", (body: any) => { body.checks[0].name = "forged"; }],
    ["check passed", (body: any) => { body.checks[0].passed = false; }],
    ["check detail", (body: any) => { const check = body.checks.find((item: any) => item.detail !== undefined); check.detail = `${check.detail}-forged`; }],
    ["check order", (body: any) => { [body.checks[0], body.checks[1]] = [body.checks[1], body.checks[0]]; }],
    ["violation entry", (body: any) => { body.violations[0] = { ...body.violations[0], tokenOffset: body.violations[0].tokenOffset + 1 }; }],
    ["first violation", (body: any) => { body.firstViolation = { ...body.firstViolation, tokenOffset: body.firstViolation.tokenOffset + 1 }; }],
    ["blocker entry", (body: any) => { body.blockers[0] = { ...body.blockers[0], reason: "forged" }; }],
    ["first blocker", (body: any) => { body.firstBlocker = { ...body.firstBlocker, reason: "forged" }; }],
    ["structural result", (body: any) => { body.structuralResult = "fail"; }],
    ["semantic result", (body: any) => { body.semanticResult = "pass"; }],
    ["release result", (body: any) => { body.releaseResult = "go"; }],
  ])("rejects forged caller body %s before the first write", (_name, mutate) => expectBodyRejectedBeforeWrite(mutate));
  it("cross-checks evidence output hashes and rejects invalid payloads before any write", () => { const run = persistedArtifacts(); const evidence: any = structuredClone(run.artifacts.evidence); evidence.outputHashes.profileValidation = "0".repeat(64); expect(() => assertEvidenceSchema(evidence, { gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, bytes: run.artifacts.bytes.slice(0, 3) })).toThrow(); const writes: any[] = []; const body: any = officialBody(); body.authority.sha256 = "0".repeat(64); expect(() => persistOfficialArtifacts({ paths: outputNames, body, expectedExitCode: 1, gate: run.prepared.gate.gate, gateSha256: run.prepared.gate.sha256, moduleHashes: run.prepared.gate.gate.bindings, predecessors: run.preflight.predecessors, invocation: run.preflight.invocation, writeFile: (...args: any[]) => { writes.push(args); } })).toThrow("profile-validation-schema-drift"); expect(writes).toHaveLength(0); });
  it("binds exact authority inventory limits and policy digests", () => { expect(AUTHORITY_POLICY.inventory).toMatchObject({ maximumAnalysisPasses: 4096, maximumBranches: 8192, maximumDepth: 64, replayPolicyDigest: "274a9aecd52944871f1a88940416e3a2e485490d8d287f0e0235a635c7e89601", executionPlanPolicyDigest: "e0aa9adf1c3c766fb629e7048ef9ee949eeef49a7522e2ede0889d0ced58eb6e", mountFallbackEvidenceDigest: "d17d8781254638a9e879ece557268d55e155c634694ffbaf6fb03eaf9687f3e7" }); expect(checkFailed(authorityReport, "inventory-policy")).toBe(false); expect(checkFailed(authorityReport, "execution-plan-policy")).toBe(false); });
  it.each(["maximumAnalysisPasses", "maximumBranches", "maximumDepth"])("rejects positive limit drift %s", (key) => { const corpus: any = validFixture(); const expected = corpus.at(-1).inventory.limits[key]; corpus.at(-1).inventory.limits[key] = expected + 1; const result = validateTrace(corpus, { ...policy, inventory: { ...policy.inventory, [key]: expected } }); expect(checkFailed(result, "inventory-policy")).toBe(true); });
  it("rejects replay and execution-plan policy drift even when local bindings and digest are recomputed", () => { const replayCorpus: any = validFixture(); const replayDigest = "a".repeat(64); replayCorpus.at(-1).inventory.replayPolicy.digest = replayDigest; replayCorpus.at(-1).inventory.entries[0].replay.policyDigest = replayDigest; expect(checkFailed(validateTrace(replayCorpus, { ...policy, inventory: { ...policy.inventory, replayPolicyDigest: canonicalDigest("replay-policy") } }), "inventory-policy")).toBe(true); const planCorpus: any = validFixture(); const expected = planCorpus.at(-1).inventory.entries[0].executionPlan.policyDigest; planCorpus.at(-1).inventory.entries[0].executionPlan.policyDigest = "b".repeat(64); recomputePlanDigest(planCorpus.at(-1).inventory.entries[0].executionPlan); expect(checkFailed(validateTrace(planCorpus, { ...policy, inventory: { ...policy.inventory, executionPlanPolicyDigest: expected } }), "execution-plan-policy")).toBe(true); });
  it.each([
    ["mount order", (entry: any) => { reorderInPlace(entry.executionPlan.recipe.mounts[0]); }, "execution-plan-schema"],
    ["recipe order", (entry: any) => { reorderInPlace(entry.executionPlan.recipe); }, "execution-plan-schema"],
    ["execution root", (entry: any) => { for (const role of [entry.executionPlan.executionRoot, entry.executionPlan.rootRoleContract, entry.executionPlan.ownerChain[0]]) role.sourcePath = "/other-root.tsx"; }, "entry-execution-plan-binding"],
    ["owner chain", (entry: any) => { entry.executionPlan.ownerChain.push({ basePattern: "/other", exportName: "Other", sourcePath: "/other.tsx" }); }, "entry-execution-plan-binding"],
    ["runtime", (entry: any) => { for (const role of [entry.executionPlan.runtimeTarget, entry.executionPlan.targetRoleContract]) role.sourcePath = "/other-target.tsx"; }, "entry-execution-plan-binding"],
    ["role", (entry: any) => { entry.executionPlan.rootRoleContract.sourcePath = "/other-role.tsx"; }, "entry-execution-plan-binding"],
    ["recipe", (entry: any) => { entry.executionPlan.recipe.params = { groupId: "43" }; }, "entry-execution-plan-binding"],
  ])("rejects recomputed-digest deep plan drift %s", (_name, mutate, expected) => { const corpus: any = validFixture(); const entry = corpus.at(-1).inventory.entries[0]; mutate(entry); recomputePlanDigest(entry.executionPlan); expect(checkFailed(validateTrace(corpus, policy), expected)).toBe(true); });
  it.each([
    ["reversed array", (mounts: any[]) => { mounts.reverse(); }],
    ["removed mount", (mounts: any[]) => { mounts.splice(1, 1); }],
    ["duplicated mount", (mounts: any[]) => { mounts.splice(1, 0, structuredClone(mounts[0])); }],
    ["basePath value", (mounts: any[]) => { mounts[0].basePath = "/other"; }],
    ["childSurfaceId value", (mounts: any[]) => { mounts[0].childSurfaceId = "surface:other"; }],
    ["contextPattern value", (mounts: any[]) => { mounts[0].contextPattern = "/other/*"; }],
    ["contextPattern presence", (mounts: any[]) => { delete mounts[0].contextPattern; }],
    ["parentSurfaceId value", (mounts: any[]) => { mounts[0].parentSurfaceId = "surface:other"; }],
    ["parentSurfaceId presence", (mounts: any[]) => { delete mounts[0].parentSurfaceId; }],
    ["pattern value", (mounts: any[]) => { mounts[0].pattern = "/other/:id"; }],
  ])("rejects recomputed-digest mount %s drift", (_name, mutate) => { const corpus: any = validMultiMountFixture(); const entry = corpus.at(-1).inventory.entries[0]; mutate(entry.executionPlan.recipe.mounts); recomputePlanDigest(entry.executionPlan); expect(checkFailed(validateTrace(corpus, policy), "entry-execution-plan-binding")).toBe(true); });
  it("rejects recomputed-digest hasWildcardFallback drift against authority-bound evidence", () => { const corpus: any = validMultiMountFixture(); const entry = corpus.at(-1).inventory.entries[0]; const expected = mountFallbackEvidenceDigest(corpus.at(-1).inventory.entries); entry.executionPlan.recipe.mounts[0].hasWildcardFallback = !entry.executionPlan.recipe.mounts[0].hasWildcardFallback; recomputePlanDigest(entry.executionPlan); const result = validateTrace(corpus, { ...policy, inventory: { ...policy.inventory, mountFallbackEvidenceDigest: expected } }); expect(checkFailed(result, "inventory-policy")).toBe(true); });
  it("rejects conflicting fallback evidence for the same owner and selection across entries", () => { const corpus: any = validMultiMountFixture(); const copy = structuredClone(corpus.at(-1).inventory.entries[0]); copy.id = "synthetic-route-18"; copy.replay.branchId = copy.id; copy.executionPlan.routeId = copy.id; copy.executionPlan.selectedBranch.id = copy.id; copy.executionPlan.recipe.mounts[0].hasWildcardFallback = !copy.executionPlan.recipe.mounts[0].hasWildcardFallback; recomputePlanDigest(copy.executionPlan); corpus.at(-1).inventory.entries.push(copy); corpus.at(-1).inventory.counts = { duplicate: 0, runnable: 2, total: 2, unresolved: 0 }; const result = validateTrace(corpus, { ...policy, inventory: { ...policy.inventory, runnable: 2, total: 2 } }); expect(checkFailed(result, "duplicate-reference-graph")).toBe(true); });
  it.each([
    ["multi-mount route-root", validMultiMountFixture],
    ["page-root", validPageRootFixture],
  ])("rejects coordinated final selection drift for %s", (_name, create) => { const corpus: any = create(); const entry = corpus.at(-1).inventory.entries[0]; for (const selection of [entry.selection, entry.replay.selection, entry.executionPlan.selection]) selection.at(-1).pattern = "/coordinated/:id"; recomputePlanDigest(entry.executionPlan); const result = validateTrace(corpus, policy); expect(checkFailed(result, "entry-replay-binding")).toBe(false); expect(checkFailed(result, "entry-execution-plan-binding")).toBe(true); });
});
