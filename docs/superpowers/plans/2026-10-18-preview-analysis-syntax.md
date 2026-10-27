# Preview Analysis Syntax Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 분석·추론·렌더 결과를 유지하며 중복 파싱으로 인한 첫 준비 비용을 줄인다.

**Architecture:** 읽기 전용 분석만 사용하는 작은 WeakRef 파서 저장소를 도입한다. 정확한 경로,
소스와 문법으로 구분하고 보관 문자열을 제한한다. 타입 검사와 변환 트리는 기존 생성 경로를 유지한다.

**Tech Stack:** TypeScript, Node 20+, esbuild, Vitest, 기존 Chromium/CDP 검증 도구.

**Spec:** [읽기 전용 분석의 구문 트리 재사용](../specs/2026-10-18-preview-analysis-syntax.md).

**Execution:** 기존의 멈추지 않고 안전한 방법으로 계속 진행하라는 요청에 따라 현재 세션에서 직접 구현한다.

## Global Constraints

- 원본 `/Users/lky/project/rtcc-poc-page`는 읽기 전용이며 설정·스크립트·서버를 실행하지 않는다.
- 모든 새 로컬 리스너는 기존 PortManager 전용 주소 `127.1.0.1`을 사용한다.
- AST는 WeakRef로만 보관한다. 문자열 환산 보관량은 4MiB, 항목은 512개,
  개별 소스는 128Ki UTF-16 코드 단위 이하로 제한하고 오래된 항목부터 버린다.
- 시스템 서비스·자동 실행·관리자 권한·보안 및 VPN 정책 변경은 하지 않는다.
- 새 의존성, commit, tag, push, Marketplace 게시를 추가하지 않는다.
- 모든 유지보수 텍스트는 1,000줄 이하로 유지한다.

## Review Focus

- 미저장 편집과 원래 내용으로의 복원은 각각 정확한 현재 소스의 구문을 반환해야 한다.
- `.ts`, `.tsx`, JS 및 JSX와 경로 철자가 다르면 파서 진단과 파일 정체성을 공유하지 않아야 한다.
- GC로 트리가 회수되거나 보관 한도를 넘으면 원래 파서로 다시 만들며 필수 분석을 생략하지 않는다.
- 여러 분석이 같은 트리를 읽어도 부모 연결·소스 위치와 문맥별 라우트 판정이 변하지 않아야 한다.
- 타입 검사·변환용 노드와 공유하지 않고 종료 시 보관 문자열을 해제해야 한다.

---

### Task 1: Bounded read-only syntax reuse

**Files:**

- Create: `src/adapters/esbuild/previewAnalysisSourceFile.ts`.
- Modify: `src/adapters/esbuild/renderGraph/previewRenderSourceAnalysis.ts` and `previewRenderModuleFacts.ts`.
- Modify: `src/adapters/esbuild/inspector/previewInspectorStaticRouteProjection.ts`,
  `previewInspectorBundleSourceInventoryMemo.ts`, `previewInspectorRuntimeImportInventory.ts`,
  and `previewInspectorRouteFactoryCatalog.ts`.
- Modify: `src/adapters/esbuild/previewStyleInventory.ts` and
  `src/adapters/esbuild/staticResources/previewDynamicImportInventory.ts`.
- Modify: `src/adapters/esbuild/esbuildPreviewCompiler.ts` to register cache clearing in existing shutdown.
- Test: `test/adapters/esbuild/previewAnalysisSourceFile.test.ts` and
  `test/adapters/esbuild/previewAnalysisSourceFileConsumers.test.ts`.

**Interfaces:**

- Produces `readPreviewAnalysisSourceFile(sourcePath: string, sourceText: string, scriptKind: ts.ScriptKind): ts.SourceFile`.
- Produces `clearPreviewAnalysisSourceFileCache(): void` for existing compiler shutdown and test isolation.
- Consumes the existing immutable string inputs and exact ScriptKind from each of the eight callers.

- [x] **Step 1:** Add real-parser regressions for repeated inputs, source edits/restoration, exact path
      and grammar, syntax diagnostics/parents, 512-entry LRU, 4MiB payload, 128Ki source limit,
      simulated collected WeakRef, explicit clearing, and eight-consumer result/parent preservation.
- [x] **Step 2:** Add a pass-through implementation and wire callers without changing parser arguments.
      Run `npm test -- test/adapters/esbuild/previewAnalysisSourceFile.test.ts test/adapters/esbuild/previewAnalysisSourceFileConsumers.test.ts`;
      require failures on repeated parser work with real parser results otherwise intact.
- [x] **Step 3:** Implement the exact bounded WeakRef storage and register its clear operation in
      the existing compiler cache list. Keep AST creation and all diagnostic checks unchanged on misses.
- [x] **Step 4:** Repeat the tests; require all cases pass. Run `npm run typecheck`, changed-file ESLint
      and Prettier, plus affected render-graph, Inspector, style/dynamic-import and shutdown regressions.
- [x] **Step 5:** Request a read-only review of the fresh snapshot diff, especially mutable AST or
      context-dependent WeakMap interactions. Resolve concrete findings before release verification.

### Task 2: Actual-page performance and release

**Files:**

- Modify: `package.json`, `CHANGELOG.md`, `docs/preview-loading-performance.md`; archive old changelog
  text only when needed for the 1,000-line limit.
- Produce: task-owned measurements, compressed evidence and verified VSIX under `.tmp/`.

**Interfaces:**

- Consumes Task 1's verified code and current 0.1.1646 production worker as exact control.
- Produces a measured and installed patch version, with all timing rounds and remaining limits reported.

- [x] **Step 1:** Count parsing work in a disposable diagnostic worker; do not use its timings as release gains.
- [x] **Step 2:** Build a production candidate and run five fresh workers per version in alternating order.
      Assert identical requests, normal 4GiB heap, output summaries and activity, and closed workers.
- [x] **Step 3:** Compare emitted browser behavior bytes, allowing only the two exact generated identity
      declarations. Verify actual Chromium target output, nested mount, readiness and owned cleanup.
- [x] **Step 4:** Record all measurements and caveats; bump 0.1.1646 to 0.1.1647 once. Run `npm run check`.
- [x] **Step 5:** Use `scripts/package-vsix.mjs` with a unique `VSIX_OUTPUT_DIR`. Verify version, platform,
      native code, private-file exclusions and exact measured worker before authorized local reinstall.
- [x] **Step 6:** Verify installed runtime, settings/learning and original input hashes. Apply the model
      retention guard before removing exact disposable artifacts; retain rollback VSIX and source backup.
- [x] **Step 7:** Audit the full objective against fresh evidence; report first-bundle versus browser
      observations precisely and leave the goal active if the requested improvement remains unverified.
