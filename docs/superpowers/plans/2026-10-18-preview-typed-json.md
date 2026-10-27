# Typed document analysis implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox syntax.

**Goal:** Reduce generated-document cold analysis cost without losing preview behavior.

**Architecture:** A private analysis parser discovers strict JSON double-cast candidates, parses
the projection, and verifies every exact top-level span before accepting it. Original text stays
the admission/source-search input; a weak node-cost table preserves bounded record-key traversal.

**Tech Stack:** Existing TypeScript compiler, Vitest, esbuild; no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-preview-typed-json.md`

## Global constraints

- Runtime source, providers, routers, readiness, admission limits and inference limits unchanged.
- Original project read-only; TCP listeners only 127.1.0.1; no services or system changes.
- Preserve settings/learning; no commits/tags/push. Keep audit artifacts in the owned `.tmp` root.

## Review focus

- Lookalikes in comments/templates or nested scopes must fall back for the entire file.
- Missing terminators, malformed casts and non-JSON expressions must keep original syntax.
- Duplicate/escaped keys, negative/exponent numbers must retain exact traversal budget cost.
- Dirty changes/restoration must preserve typed results and original offsets/text.
- Emitted browser bytes and original admission/refusal outcomes must remain equivalent.

### Task 1: Private parser and bounded inference

**Files:** Create `src/adapters/esbuild/typeOracle/previewTypedJsonAnalysis.ts`; modify
`previewTypeProgram.ts` and `previewRecordKeyInference.ts` in that directory; add
`test/adapters/esbuild/typeOracle/previewTypedJsonAnalysis.test.ts`.

**Interfaces:** `createPreviewTypeAnalysisSourceFile(fileName, text, languageVersion): ts.SourceFile`
and `readPreviewTypeAnalysisNodeCost(node): number` are private adapter helpers.

- [x] Write tests through the real source cache/program: fewer nodes, same typed results and offsets,
      fallback grammar, dirty edits, unchanged admission, exact record-key cutoff behavior.
- [x] Run focused tests; observe the missing optimization fail before product implementation.
- [x] Implement projection with exact-span verification and source-token cost; use the parser only
      in the private type-program cache, and charge original costs in both record-reader visitors.
- [x] Run focused regressions/typecheck and request an independent read-only review.

### Task 2: Validate and release the retained optimization

- [x] Build the normal production worker and compare alternating fresh-worker timings and outputs.
- [x] Verify all generated browser artifacts and actual rendered readiness; report timing limits.
- [x] Increment 1649 to 1650 once, update changelog, run `npm run check`, package and verify VSIX,
      reinstall that exact file and verify installed runtime/settings/original source preservation.
- [x] Apply guarded cleanup only to owned disposable outputs; report installed version and checks.
