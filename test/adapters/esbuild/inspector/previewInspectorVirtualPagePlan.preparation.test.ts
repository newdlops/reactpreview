/** Candidate limits must bound expensive shell preparation while preserving complete identities. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector';
import * as recipes from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageRecipe';
import { createPreviewInspectorVirtualPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import {
  APP_PATH,
  PAGE_PATH,
  RENDER_PATH,
  createCandidate,
} from './previewInspectorVirtualPagePlanFixtures';

afterEach(() => vi.restoreAllMocks());

/** Creates two checkpoints whose exact shared path collapses to one selectable page emission. */
function createCheckpoints(
  pathId: string,
  authoredId = 'application',
): readonly PreviewInspectorPageCandidate[] {
  const renderPath = { ...RENDER_PATH, id: pathId };
  return Object.freeze([
    createCandidate({
      complete: true,
      id: authoredId,
      renderPath,
      root: { exportName: 'App', sourcePath: APP_PATH },
      rootStepIndex: 2,
      stopReason: 'root-reached',
    }),
    createCandidate({
      id: 'page-' + pathId,
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    }),
  ]);
}

describe('bounded VirtualPage recipe preparation', () => {
  it('prepares the retained emission once instead of preparing each duplicate checkpoint', () => {
    const prepare = vi.spyOn(recipes, 'createVirtualPageRecipe');
    const candidates = createCheckpoints('one-path');
    const pages = createPreviewInspectorVirtualPageCandidates(candidates);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.contentCandidate).toBe(candidates[1]);
    expect(pages[0]?.recipe).toMatchObject({
      authoredRoot: candidates[0]?.root,
      contentRoot: candidates[1]?.root,
      mode: 'static-page-checkpoint',
      renderPathId: 'one-path',
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('prepares only capped output without truncating discovery before page selection', () => {
    const prepare = vi.spyOn(recipes, 'createVirtualPageRecipe');
    const candidates = Object.freeze([
      ...createCheckpoints('first-path', 'first-application'),
      ...createCheckpoints('second-path', 'second-application'),
      ...createCheckpoints('third-path', 'third-application'),
    ]);
    const before = JSON.stringify(candidates);
    const capped = createPreviewInspectorVirtualPageCandidates(candidates, 1);
    expect(capped).toHaveLength(1);
    expect(capped[0]?.browserCandidate.id).toBe('first-application');
    expect(capped[0]?.contentCandidate.root.sourcePath).toBe(PAGE_PATH);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(candidates)).toBe(before);
    prepare.mockClear();
    const expanded = createPreviewInspectorVirtualPageCandidates(candidates, 2);
    expect(expanded.map((page) => page.browserCandidate.id)).toEqual([
      'first-application',
      'second-application',
    ]);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('still resolves identity collisions outside the cap before preparing retained recipes', () => {
    const prepare = vi.spyOn(recipes, 'createVirtualPageRecipe');
    const candidates = Object.freeze([
      ...createCheckpoints('first-path', 'shared-application'),
      ...createCheckpoints('second-path', 'shared-application'),
    ]);
    const all = createPreviewInspectorVirtualPageCandidates(candidates);
    expect(all).toHaveLength(2);
    expect(all[0]?.browserCandidate.id).not.toBe('shared-application');
    expect(all[0]?.browserCandidate.id).not.toBe(all[1]?.browserCandidate.id);
    prepare.mockClear();
    const capped = createPreviewInspectorVirtualPageCandidates(candidates, 1);
    expect(capped[0]?.browserCandidate.id).toBe(all[0]?.browserCandidate.id);
    expect(capped[0]?.recipe).toEqual(all[0]?.recipe);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
