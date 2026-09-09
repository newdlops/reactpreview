/** Checks that output compaction leaves pretrained choices, observed failures, and saved learning intact. */
import { transformSync } from 'esbuild';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PREVIEW_BROWSER_OUTPUT_OPTIONS } from '../../../src/adapters/esbuild/previewBrowserOutputOptions';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

interface RecoveryFixture {
  readonly run: () => {
    readonly chosen: string;
    readonly next: string;
    readonly priorScore: number;
    readonly before: unknown;
    readonly after: unknown;
  };
}

/** Evaluates only generated, repository-owned recovery code with fresh private model state. */
function createFixture(compact: boolean): RecoveryFixture {
  const source = `
    const previewEntryRevision = 1;
    const previewInspectorSession = {};
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    globalThis.fixture = { run() {
      const problem = {
        blockerKind: 'runtime-fallback', holeKind: 'rendered-collection-consumer-data',
        numbers: { callableCandidateCount: 2, requiredPathCount: 6 },
        tokens: ['compiler-call-result-candidate', 'role:collection-filter-predicate'],
      };
      const candidates = [
        { id: 'neutral', deterministicRank: 0, numbers: { retainsData: 0 },
          tokens: ['strategy:neutral-call-result', 'role:collection-filter-predicate'] },
        { id: 'retain', deterministicRank: 1, numbers: { retainsData: 1 },
          tokens: ['strategy:data-retaining-call-result', 'role:collection-filter-predicate'] },
      ];
      const selected = selectPreviewInspectorNeuralResidualCandidate(problem, candidates);
      const before = JSON.parse(JSON.stringify(serializePreviewInspectorNeuralResidualModel()));
      trainPreviewInspectorNeuralResidualDecision(selected.decision, 0);
      const next = selectPreviewInspectorNeuralResidualCandidate(problem, candidates);
      return { chosen: selected.candidateId, next: next.candidateId,
        priorScore: selected.decision.priorScore, before,
        after: serializePreviewInspectorNeuralResidualModel() };
    } };
  `;
  const context = vm.createContext({});
  vm.runInContext(
    compact
      ? transformSync(source, { ...PREVIEW_BROWSER_OUTPUT_OPTIONS, target: 'es2022' }).code
      : source,
    context,
  );
  return (context as { fixture: RecoveryFixture }).fixture;
}

describe('compacted recovery runtime', () => {
  it('preserves exact cold decisions and failure-driven updates without invented success evidence', () => {
    const baseline = createFixture(false).run();
    const compact = createFixture(true).run();
    expect(compact).toEqual(baseline);
    expect(compact.chosen).toBe('retain');
    expect(compact.next).toBe('neutral');
    expect(compact.priorScore).toBeGreaterThan(0.8);
    expect(compact.before).toMatchObject({ updates: 0 });
    expect(compact.after).toMatchObject({ updates: 1 });
  });
});
