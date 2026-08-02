import { createHash } from "node:crypto";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value) => typeof value === "string" && value.length > 0;
const safe = (value) => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).join("\0") === keys.join("\0");
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const add = (checks, name, passed, detail = "") => checks.push({ name, passed, ...(detail ? { detail } : {}) });

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const canonicalDigest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const withoutDigest = (plan) => Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "digest"));

const ownerKeys = ["exportName", "sourcePath"];
const rootedOwnerKeys = ["basePattern", "exportName", "sourcePath"];
const roleKeys = ["exportName", "sourcePath", "surfaceId"];
const roleContractKeys = ["exportName", "sourcePath", "surfaceId", "preparedSourceDigest"];
const selectionKeys = ["componentName", "pattern"];
const branchKeys = ["componentName", "exportName", "id", "pathname", "pattern", "sourcePath"];
const contextKeys = ["compilerPolicyDigest", "preparationPolicyDigest", "requestDigest", "resolutionConfinementDigest", "resolverDigest", "sourceSnapshotDigest"];
const mountKeySets = [
  ["basePath", "childSurfaceId", "hasWildcardFallback", "pattern"],
  ["basePath", "childSurfaceId", "contextPattern", "hasWildcardFallback", "pattern"],
  ["basePath", "childSurfaceId", "hasWildcardFallback", "parentSurfaceId", "pattern"],
  ["basePath", "childSurfaceId", "contextPattern", "hasWildcardFallback", "parentSurfaceId", "pattern"],
];
const recipeKeySets = [
  ["kind", "mounts", "params", "pathname", "pattern", "rootOwnsRouter", "searchParams"],
  ["kind", "mounts", "params", "pathname", "pattern", "rootOwnsRouter", "routerModuleSpecifier", "searchParams"],
];
const replayKeys = ["branchId", "componentName", "executionRoot", "exportName", "owner", "ownerChain", "parameters", "pathname", "pattern", "policyDigest", "routeSelectionResolution", "runtimeTarget", "selection", "sourcePath", "version"];
const runnableKeys = ["id", "componentName", "exportName", "owner", "parameters", "pathname", "pattern", "selection", "sourcePath", "disposition", "replay", "executionPlan"];
const duplicateKeys = ["id", "componentName", "exportName", "owner", "parameters", "pathname", "pattern", "selection", "sourcePath", "disposition", "duplicateOf", "reason", "replay"];
const unresolvedKeys = ["id", "componentName", "owner", "parameters", "pathname", "pattern", "selection", "disposition", "reason"];
const planKeys = ["browserCandidateId", "executionCandidateId", "executionIdentity", "executionRoot", "frontierIdentity", "ownerChain", "pageCandidateId", "planningContext", "planningContextDigest", "policyDigest", "recipe", "rootRoleContract", "routeId", "runtimeTarget", "selectedBranch", "selection", "targetRoleContract", "version", "digest"];

function record(value) { return isObject(value) && Object.values(value).every((item) => typeof item === "string"); }
function parameterRecord(value) { return record(value); }
function valueRecord(value) { return isObject(value) && Object.values(value).every((item) => typeof item === "string" || (Array.isArray(item) && item.every((part) => typeof part === "string"))); }
function validOwner(value, rooted = false) { return exactKeys(value, rooted ? rootedOwnerKeys : ownerKeys) && text(value.exportName) && text(value.sourcePath) && (!rooted || text(value.basePattern)); }
function validRole(value, contract = false) { return exactKeys(value, contract ? roleContractKeys : roleKeys) && text(value.exportName) && text(value.sourcePath) && text(value.surfaceId) && (!contract || digest(value.preparedSourceDigest)); }
function validSelection(value) { return Array.isArray(value) && value.length > 0 && value.every((step) => exactKeys(step, selectionKeys) && text(step.componentName) && text(step.pattern)); }
function validMount(value) { return isObject(value) && mountKeySets.some((keys) => exactKeys(value, keys)) && text(value.basePath) && text(value.childSurfaceId) && typeof value.hasWildcardFallback === "boolean" && text(value.pattern) && (!own(value, "contextPattern") || text(value.contextPattern)) && (!own(value, "parentSurfaceId") || text(value.parentSurfaceId)); }
function validRecipe(value) { return isObject(value) && recipeKeySets.some((keys) => exactKeys(value, keys)) && text(value.kind) && Array.isArray(value.mounts) && value.mounts.every(validMount) && valueRecord(value.params) && text(value.pathname) && text(value.pattern) && typeof value.rootOwnsRouter === "boolean" && valueRecord(value.searchParams) && (!own(value, "routerModuleSpecifier") || ["react-router", "react-router-dom"].includes(value.routerModuleSpecifier)); }
function validReplay(value) { return exactKeys(value, replayKeys) && text(value.branchId) && text(value.componentName) && validOwner(value.executionRoot, true) && text(value.exportName) && validOwner(value.owner) && Array.isArray(value.ownerChain) && value.ownerChain.length > 0 && value.ownerChain.every((owner) => validOwner(owner, true)) && parameterRecord(value.parameters) && text(value.pathname) && text(value.pattern) && digest(value.policyDigest) && value.routeSelectionResolution === "exact" && validOwner(value.runtimeTarget) && validSelection(value.selection) && text(value.sourcePath) && value.version === 1; }
function validPlan(value) { return exactKeys(value, planKeys) && ["browserCandidateId", "executionCandidateId", "executionIdentity", "frontierIdentity", "pageCandidateId", "routeId"].every((key) => text(value[key])) && digest(value.executionIdentity) && digest(value.frontierIdentity) && validRole(value.executionRoot) && Array.isArray(value.ownerChain) && value.ownerChain.length > 0 && value.ownerChain.every((owner) => validOwner(owner, true)) && exactKeys(value.planningContext, contextKeys) && Object.values(value.planningContext).every(digest) && digest(value.planningContextDigest) && canonicalDigest(value.planningContext) === value.planningContextDigest && digest(value.policyDigest) && validRecipe(value.recipe) && validRole(value.rootRoleContract, true) && validRole(value.runtimeTarget) && exactKeys(value.selectedBranch, branchKeys) && validSelection(value.selection) && validRole(value.targetRoleContract, true) && value.version === 2 && digest(value.digest) && canonicalDigest(withoutDigest(value)) === value.digest; }
function entryBase(value, requireExport = true) { return isObject(value) && text(value.id) && text(value.componentName) && (!requireExport || text(value.exportName)) && validOwner(value.owner) && parameterRecord(value.parameters) && text(value.pathname) && text(value.pattern) && validSelection(value.selection) && text(value.sourcePath); }
function replayBinding(entry, replay) { return validReplay(replay) && replay.branchId === entry.id && ["componentName", "exportName", "owner", "parameters", "pathname", "pattern", "selection", "sourcePath"].every((key) => same(entry[key], replay[key])) && same(replay.executionRoot, replay.ownerChain[0]) && same(replay.runtimeTarget, { exportName: entry.exportName, sourcePath: entry.sourcePath }); }
function finalSelectionBinding(entry, replay, plan) { const pattern = entry?.pattern; return entry?.selection?.at(-1)?.pattern === pattern && replay?.selection?.at(-1)?.pattern === pattern && plan?.selection?.at(-1)?.pattern === pattern && plan?.recipe?.pattern === pattern && plan?.selectedBranch?.pattern === pattern; }
function planBinding(entry, replay, plan) { const sameOwnerRole = (left, right) => left?.exportName === right?.exportName && left?.sourcePath === right?.sourcePath; const routeRoot = sameOwnerRole(replay.executionRoot, plan.executionRoot); const pageRoot = sameOwnerRole(replay.runtimeTarget, plan.executionRoot); return validReplay(replay) && validPlan(plan) && plan.routeId === entry.id && plan.selectedBranch.id === entry.id && ["componentName", "exportName", "pathname", "pattern", "sourcePath"].every((key) => same(entry[key], plan.selectedBranch[key])) && same(entry.selection, plan.selection) && finalSelectionBinding(entry, replay, plan) && (routeRoot || pageRoot) && (routeRoot ? same(replay.ownerChain, plan.ownerChain) : plan.ownerChain.length === 1 && sameOwnerRole(plan.ownerChain[0], replay.runtimeTarget)) && sameOwnerRole(plan.ownerChain[0], plan.executionRoot) && sameOwnerRole(replay.runtimeTarget, plan.runtimeTarget) && plan.browserCandidateId === plan.pageCandidateId && same(plan.executionRoot, { exportName: plan.rootRoleContract.exportName, sourcePath: plan.rootRoleContract.sourcePath, surfaceId: plan.rootRoleContract.surfaceId }) && same(plan.runtimeTarget, { exportName: plan.targetRoleContract.exportName, sourcePath: plan.targetRoleContract.sourcePath, surfaceId: plan.targetRoleContract.surfaceId }) && sameOwnerRole(replay.runtimeTarget, plan.targetRoleContract) && same(plan.recipe.params, entry.parameters) && plan.recipe.pathname === entry.pathname && plan.recipe.pattern === entry.pattern && same(plan.selectedBranch, { componentName: entry.componentName, exportName: entry.exportName, id: entry.id, pathname: entry.pathname, pattern: entry.pattern, sourcePath: entry.sourcePath }); }
function mountBinding(entry, replay, plan) {
  if (!validReplay(replay) || !validPlan(plan)) return false;
  const sameOwnerRole = (left, right) => left?.exportName === right?.exportName && left?.sourcePath === right?.sourcePath;
  const mounts = plan.recipe.mounts;
  if (mounts.length === 0) return sameOwnerRole(plan.executionRoot, replay.runtimeTarget) && plan.ownerChain.length === 1 && sameOwnerRole(plan.ownerChain[0], replay.runtimeTarget);
  if (!sameOwnerRole(plan.executionRoot, replay.executionRoot) || mounts.length !== replay.ownerChain.length || replay.selection.length !== mounts.length + 1) return false;
  const visited = new Set([plan.executionRoot.surfaceId]);
  for (const [index, mount] of mounts.entries()) {
    const expectedParent = index === 0 ? plan.executionRoot.surfaceId : mounts[index - 1].childSurfaceId;
    const expectedChild = index === mounts.length - 1 ? plan.runtimeTarget.surfaceId : mounts[index + 1].parentSurfaceId;
    if (!own(mount, "contextPattern") || !own(mount, "parentSurfaceId") || mount.basePath !== replay.ownerChain[index].basePattern || mount.contextPattern !== replay.selection[index].pattern || mount.pattern !== entry.pattern || mount.parentSurfaceId !== expectedParent || mount.childSurfaceId !== expectedChild || mount.childSurfaceId === mount.parentSurfaceId || visited.has(mount.childSurfaceId)) return false;
    visited.add(mount.childSurfaceId);
  }
  return true;
}

export function mountFallbackEvidenceDigest(entries) {
  const evidence = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.disposition !== "runnable") continue;
    for (const [index, mount] of (entry.executionPlan?.recipe?.mounts ?? []).entries()) {
      const owner = entry.replay?.ownerChain?.[index], selection = entry.replay?.selection?.[index];
      const key = canonicalJson({ owner, selection });
      if (!evidence.has(key)) evidence.set(key, { owner, selection, hasWildcardFallback: mount?.hasWildcardFallback });
    }
  }
  return canonicalDigest([...evidence.values()]);
}

export function validateInventoryExecutionPlan(inventory, policy = {}) {
  const checks = [];
  const inventoryKeys = ["analysisPasses", "complete", "counts", "dependencyPaths", "entries", "limits", "owner", "predecessorVersion", "replayPasses", "replayPolicy", "truncated", "version"];
  if (!exactKeys(inventory, inventoryKeys)) { add(checks, "inventory-schema", false); return { checks, inventory: null }; }
  const entries = inventory.entries;
  const counts = inventory.counts;
  add(checks, "inventory-schema", inventory.version === 4 && inventory.predecessorVersion === 3 && safe(inventory.analysisPasses) && safe(inventory.replayPasses) && inventory.complete === true && inventory.truncated === false && exactKeys(counts, ["duplicate", "runnable", "total", "unresolved"]) && Object.values(counts).every(safe) && exactKeys(inventory.limits, ["maximumAnalysisPasses", "maximumBranches", "maximumDepth"]) && Object.values(inventory.limits).every((value) => Number.isSafeInteger(value) && value > 0) && validOwner(inventory.owner) && exactKeys(inventory.replayPolicy, ["digest", "predecessorVersion", "version"]) && digest(inventory.replayPolicy.digest) && inventory.replayPolicy.predecessorVersion === 3 && inventory.replayPolicy.version === 4 && Array.isArray(entries));
  add(checks, "inventory-policy", (policy.analysisCount === undefined || inventory.analysisPasses === policy.analysisCount) && (policy.replayCount === undefined || inventory.replayPasses === policy.replayCount) && (policy.total === undefined || counts.total === policy.total) && (policy.runnable === undefined || counts.runnable === policy.runnable) && (policy.duplicate === undefined || counts.duplicate === policy.duplicate) && (policy.unresolved === undefined || counts.unresolved === policy.unresolved) && (policy.maximumAnalysisPasses === undefined || inventory.limits.maximumAnalysisPasses === policy.maximumAnalysisPasses) && (policy.maximumBranches === undefined || inventory.limits.maximumBranches === policy.maximumBranches) && (policy.maximumDepth === undefined || inventory.limits.maximumDepth === policy.maximumDepth) && (policy.replayPolicyDigest === undefined || inventory.replayPolicy.digest === policy.replayPolicyDigest) && (policy.mountFallbackEvidenceDigest === undefined || mountFallbackEvidenceDigest(entries) === policy.mountFallbackEvidenceDigest));
  const dependencies = inventory.dependencyPaths;
  add(checks, "dependencies", Array.isArray(dependencies) && dependencies.every(text) && dependencies.every((value, index) => index === 0 || dependencies[index - 1] < value));
  const ids = Array.isArray(entries) ? entries.map((entry) => entry?.id) : [];
  const byId = new Map(Array.isArray(entries) ? entries.map((entry) => [entry?.id, entry]) : []);
  add(checks, "inventory-unique-ids", ids.every(text) && new Set(ids).size === ids.length);
  const runnable = Array.isArray(entries) ? entries.filter((entry) => entry?.disposition === "runnable") : [];
  const duplicate = Array.isArray(entries) ? entries.filter((entry) => entry?.disposition === "duplicate") : [];
  const unresolved = Array.isArray(entries) ? entries.filter((entry) => entry?.disposition === "unresolved") : [];
  const mountFallbacks = new Map();
  add(checks, "inventory-counts", counts.total === entries.length && counts.runnable === runnable.length && counts.duplicate === duplicate.length && counts.unresolved === unresolved.length);
  const runnableIds = new Set(runnable.map((entry) => entry.id));
  for (const [index, entry] of entries.entries()) {
    const detail = String(index);
    if (entry?.disposition === "runnable") {
      add(checks, "runnable-schema", exactKeys(entry, runnableKeys) && entryBase(entry), detail);
      add(checks, "replay-schema", validReplay(entry.replay), detail);
      add(checks, "execution-plan-schema", validPlan(entry.executionPlan), detail);
      add(checks, "execution-plan-policy", policy.executionPlanPolicyDigest === undefined || entry.executionPlan?.policyDigest === policy.executionPlanPolicyDigest, detail);
      add(checks, "entry-replay-binding", replayBinding(entry, entry.replay) && entry.replay.policyDigest === inventory.replayPolicy.digest, detail);
      add(checks, "entry-execution-plan-binding", planBinding(entry, entry.replay, entry.executionPlan) && mountBinding(entry, entry.replay, entry.executionPlan), detail);
      add(checks, "execution-plan-digest", validPlan(entry.executionPlan), detail);
      for (const [mountIndex, mount] of (entry.executionPlan?.recipe?.mounts ?? []).entries()) {
        const key = canonicalJson({ owner: entry.replay?.ownerChain?.[mountIndex], selection: entry.replay?.selection?.[mountIndex] });
        if (!mountFallbacks.has(key)) mountFallbacks.set(key, mount?.hasWildcardFallback);
        else if (mountFallbacks.get(key) !== mount?.hasWildcardFallback) mountFallbacks.set(key, null);
      }
    } else if (entry?.disposition === "duplicate") {
      add(checks, "duplicate-schema", exactKeys(entry, duplicateKeys) && entryBase(entry) && ["exact-semantic-route", "expanded-owner"].includes(entry.reason), detail);
      add(checks, "duplicate-reference", typeof entry.duplicateOf === "string" && entry.duplicateOf !== entry.id && runnableIds.has(entry.duplicateOf), detail);
      const target = byId.get(entry.duplicateOf);
      add(checks, "duplicate-replay-binding", target?.disposition === "runnable" && entry.duplicateOf === entry.replay?.branchId && entry.replay.branchId === target.id && same(entry.replay, target.replay) && entry.replay.policyDigest === inventory.replayPolicy.digest, detail);
    } else if (entry?.disposition === "unresolved") {
      const unresolvedKeysActual = ["id", "componentName", "exportName", "owner", "parameters", "pathname", "pattern", "selection", "sourcePath", "disposition", "reason"];
      const variantA = exactKeys(entry, unresolvedKeys);
      const variantB = exactKeys(entry, unresolvedKeysActual) && text(entry.exportName) && text(entry.sourcePath);
      add(checks, "unresolved-schema", (variantA || variantB) && text(entry.id) && text(entry.componentName) && validOwner(entry.owner) && parameterRecord(entry.parameters) && typeof entry.pathname === "string" && typeof entry.pattern === "string" && Array.isArray(entry.selection) && entry.selection.every((step) => exactKeys(step, selectionKeys) && text(step.componentName) && text(step.pattern)) && !own(entry, "replay") && !own(entry, "executionPlan") && ["analysis-limit", "catalog-unresolved", "component-unresolved", "cyclic-owner", "factory-contract-unresolved", "nested-owner-unproven", "route-provenance-ambiguous", "submodule-base-unresolved", "exact-replay-identity-mismatch", "exact-replay-non-exact-selection", "exact-replay-target-unavailable", "execution-plan-unavailable"].includes(entry.reason), detail);
    } else add(checks, "entry-disposition", false, detail);
  }
  add(checks, "duplicate-reference-graph", duplicate.every((entry) => runnableIds.has(entry.duplicateOf)) && duplicate.every((entry) => byId.get(entry.duplicateOf)?.disposition === "runnable") && [...mountFallbacks.values()].every((value) => typeof value === "boolean"));
  return { checks, inventory };
}
