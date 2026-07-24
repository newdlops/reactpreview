/** Verifies mode, render-scope, and host-override boundaries for compiler watchdog budgets. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewCompilerWorkerBudget,
  selectPreviewCompilerStageTimeoutMs,
} from '../../../src/adapters/worker/previewCompilerWorkerBudget';
import type { PreviewBuildRequest } from '../../../src/domain/preview';

const BASE_REQUEST: PreviewBuildRequest = {
  dependencySnapshots: [],
  documentPath: '/workspace/Target.tsx',
  language: 'tsx',
  preparationMode: 'fast',
  renderMode: 'page-inspector',
  sourceText: 'export default function Target() { return null; }',
  workspaceRoot: '/workspace',
};

describe('previewCompilerWorkerBudget', () => {
  /** Fast authored-page bundling gets more time while retaining a finite active-request ceiling. */
  it('grants a bounded Page Inspector bundling allowance', () => {
    const budget = createPreviewCompilerWorkerBudget(BASE_REQUEST, undefined);

    expect(budget).toEqual({
      fixed: false,
      initialStageTimeoutMs: 45_000,
      totalTimeoutMs: 180_000,
    });
    expect(selectPreviewCompilerStageTimeoutMs(BASE_REQUEST, budget, 'preparing-runtime')).toBe(
      45_000,
    );
    expect(selectPreviewCompilerStageTimeoutMs(BASE_REQUEST, budget, 'bundling-modules')).toBe(
      120_000,
    );
  });

  /** Full page enrichment remains finite even though it is intentionally more comprehensive. */
  it('uses the larger full-page enrichment ceiling', () => {
    const request: PreviewBuildRequest = { ...BASE_REQUEST, preparationMode: 'full' };
    const budget = createPreviewCompilerWorkerBudget(request, undefined);

    expect(budget).toEqual({
      fixed: false,
      initialStageTimeoutMs: 120_000,
      totalTimeoutMs: 360_000,
    });
    expect(selectPreviewCompilerStageTimeoutMs(request, budget, 'bundling-modules')).toBe(240_000);
  });

  /** Ordinary component previews do not inherit the more expensive authored-page allowance. */
  it('keeps component-only fast previews on the compact budget', () => {
    const request: PreviewBuildRequest = { ...BASE_REQUEST, renderMode: 'component' };
    const budget = createPreviewCompilerWorkerBudget(request, undefined);

    expect(budget).toEqual({
      fixed: false,
      initialStageTimeoutMs: 45_000,
      totalTimeoutMs: 45_000,
    });
    expect(selectPreviewCompilerStageTimeoutMs(request, budget, 'bundling-modules')).toBe(45_000);
  });

  /** Test and embedding hosts retain one exact deterministic deadline across all stages. */
  it('preserves an explicit fixed timeout override', () => {
    const budget = createPreviewCompilerWorkerBudget(BASE_REQUEST, 25.9);

    expect(budget).toEqual({
      fixed: true,
      initialStageTimeoutMs: 25,
      totalTimeoutMs: 25,
    });
    expect(selectPreviewCompilerStageTimeoutMs(BASE_REQUEST, budget, 'bundling-modules')).toBe(25);
  });
});
