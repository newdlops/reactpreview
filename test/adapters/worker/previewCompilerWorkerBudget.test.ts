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
  /** Analysis depth must not reintroduce a 45-second cutoff for an authored page. */
  it.each(['fast', 'corridor', 'full'] as const)(
    'keeps %s Page Inspector stages finite without a 45-second cutoff',
    (preparationMode) => {
      const request = { ...BASE_REQUEST, preparationMode };
      const budget = createPreviewCompilerWorkerBudget(request, undefined);

      expect(budget).toEqual({
        fixed: false,
        initialStageTimeoutMs: 120_000,
      });
      expect(selectPreviewCompilerStageTimeoutMs(request, budget, 'preparing-runtime')).toBe(
        120_000,
      );
      expect(selectPreviewCompilerStageTimeoutMs(request, budget, 'discovering-components')).toBe(
        120_000,
      );
      expect(selectPreviewCompilerStageTimeoutMs(request, budget, 'bundling-modules')).toBe(
        120_000,
      );
    },
  );

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
