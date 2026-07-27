## PLAN

### PLAN_VERSION
v1 / provider-route-owner-reachability-20260727

### RISK_LEVEL
NORMAL

### GOAL
Keep the statically proven authored route owner around a selected descendant page so wrapper callbacks—such as context providers surrounding routed content—actually mount. The preview must no longer report “The page loaded, but this path did not use FiStaDocumentAppContextProvider” for a route whose authored owner renders that provider.

### CURRENT_BEHAVIOR
- `src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityDetailRuntimeSource.ts` emits the reported message after page commit while the selected target facade remains unmounted.
- `src/adapters/esbuild/inspector/previewInspectorRouteChoiceCandidates.ts` says expansion must preserve component ancestry, but `createRouteChoiceCandidate` can replace an authored root with a resolved descendant not independently discovered by reverse target ancestry.
- A provider rendered by a route owner factory callback is an ancestor of route content; replacing the owner with the leaf removes the only authored path that mounts it.
- `src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.ts` already preserves a matching route owner, because mounting a leaf directly loses parent route params and providers.
- The worktree is heavily dirty. The relevant existing changes are confined to the promotion hunk in `previewInspectorRouteChoiceCandidates.ts` and its regression test; all other user changes must be preserved.

### ACCEPTANCE_CRITERIA
- A route resolving a descendant without independently proven reverse ancestry retains original root, edges, router ownership, props, completeness, and stop reason, while gaining route metadata and merged dependencies.
- A matching `routeMounts` owner remains selectable by `selectPreviewInspectorRouteOwnerCandidate`; the VirtualPage executes the authored owner rather than an invented detached leaf.
- The authored owner’s selected provider import continues through the target facade so runtime reachability observes it mounting.
- Component name, pathname, pattern, dependency paths, candidate IDs, and route-selection persistence remain unchanged.
- Proven page checkpoints, legitimate detached candidates, inline wrappers, route-state setup, and target-only fallback remain unchanged.
- A genuinely authored path that does not mount the target keeps the truthful diagnostic; do not suppress it.
- No code or tests use `FiSta`, the external project path, or corpus-specific identifiers.
- Only the two scoped files receive new edits; unrelated dirty hunks are untouched.

### SCOPE
- `src/adapters/esbuild/inspector/previewInspectorRouteChoiceCandidates.ts`: `expandPreviewInspectorRouteChoiceCandidates`; remove unproven descendant-root promotion and its private identity helpers.
- `test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts`: replace the descendant-promotion regression with the inverse target-reachability-safe contract.

### NON_GOALS
- Do not alter reachability UI copy, route discovery/manifests, inline wrappers, route-state preludes, router runtime, bundle policy, direct bundling, or fallbacks.
- Do not add provider/route-name heuristics, project exceptions, files, dependencies, public contracts, or abstractions.
- Do not restore, discard, rebase, reformat, or modify unrelated worktree changes or external reproduction artifacts.

### INVARIANTS
- Expansion enriches an authored caller path with route metadata and never fabricates target-to-page ancestry.
- Only reverse-render evidence or a dedicated existing planner establishes an executable root.
- Existing route-owner preservation remains authoritative for `routeMounts`.
- Candidate IDs retain the original ID plus selected component name, pattern, and stable index; dependency paths stay sorted/deduplicated.
- Target imports from an authentic owner remain intercepted by `createPreviewInspectorTargetPlugin`.
- Existing proven candidates and detached candidates are unchanged; generic tests only; preserve outside-scope user changes.

### IMPLEMENTATION_STEPS
1. **PREFLIGHT** — verify scoped diff and named symbols before editing.
   - Confirm `resolvedChoiceRoots`, `existingRoots`, `createRouteChoiceCandidate`, `createComponentReferenceKey`, and the current descendant-promotion test exist as described. If not, request a Sol decision.
   - Validate: `git status --short -- src/adapters/esbuild/inspector/previewInspectorRouteChoiceCandidates.ts test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts` and matching scoped `git diff` show expected hunks.
2. **OWNER_PRESERVATION** — `previewInspectorRouteChoiceCandidates.ts` / `expandPreviewInspectorRouteChoiceCandidates`.
   - Remove unused `node:path` import, `resolvedChoiceRoots`, `existingRoots`, `createRouteChoiceCandidate`, and `createComponentReferenceKey`.
   - For each `(candidate, routeLocation)`, create a frozen clone spreading all original candidate fields and replacing only `dependencyPaths` with the sorted/deduplicated union, `id` through `createPreviewInspectorRouteChoiceCandidateId`, and `routeLocation`.
   - Do not modify the candidate-ID helper. A resolved descendant is executable only if independently discovered elsewhere.
   - Validate: targeted test after Step 3 passes.
3. **REGRESSION_TEST** — final route-choice case in `previewInspectorVirtualPagePlan.test.ts`.
   - Replace unsafe promotion assertion with generic case `keeps a route-factory owner when a resolved descendant lacks reverse-path proof`.
   - Use one complete authored owner and a resolved descendant absent from candidate list; a `routeMounts` entry must identify the owner.
   - Assert expanded candidate keeps root and ancestry fields, includes route dependency and exact route location, and no descendant-root candidate is fabricated.
   - Feed expansion into `createPreviewInspectorVirtualPageCandidates`; assert content/browser roots remain owner while browser preserves selected route location/path.
   - Validate: `npm test -- test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts` passes.
4. **VALIDATION_AND_DIFF_REVIEW** — no semantic edits outside scope.
   - Validate targeted Inspector tests, typecheck, scoped ESLint/Prettier, full tests/build, diff check, and scoped diff. If failures cannot be uniquely attributed to pre-existing unrelated changes, request Sol decision.

### ALLOWED_EXECUTOR_DISCRETION
Only local generic fixture names, test wording, imports, assertion order, formatting, and immediate obvious syntax/type/import repair using adjacent patterns. No promotion heuristic, heuristic detection, other file, weaker test, or runtime change.

### MANDATORY_ESCALATION
- Scoped hunk differs at preflight; owner preservation needs another layer; selected metadata stops applying; proven candidate regresses; nested router/provider duplication appears; safe leaf distinction has multiple approaches; tests need weakening or diagnostic suppression; same step fails twice; or full validation failure cannot be uniquely attributed to unrelated changes.

### VALIDATION_PLAN
- Compile/type check: `npm run typecheck` exits zero.
- Unit: `npm test -- test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts test/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates.test.ts test/adapters/esbuild/inspector/previewInspectorPageExecutionSource.test.ts test/adapters/esbuild/inspector/previewInspectorAncestorPlan.test.ts` passes.
- Integration: `npm test` passes.
- Static: scoped ESLint, Prettier check, and `git diff --check` pass.
- Build: `npm run build` succeeds.
- Manual: if reproduction environment exists, select a factory-owned document route and confirm selected provider mounts / blocker disappears; unrelated route retains blocker. Otherwise report not run.
- Confirm no new scan/dependency/execution schema/auth behavior or corpus-specific heuristic.

### ROLLBACK_OR_RECOVERY
N/A. Revert only executor’s exact scoped hunks while preserving pre-existing user changes.

### OPEN_ASSUMPTIONS
- Verified: report text is a post-commit target-reachability result, not a provider exception.
- Verified: provider is authored by route-owner callback; virtual page owner selection already protects providers and params.
- Verified: current promotion conflicts with that policy and the no-ancestry-change contract; target facade restores reachability when owner is retained.
- No user decision is needed unless preflight or validation reveals mismatch.
