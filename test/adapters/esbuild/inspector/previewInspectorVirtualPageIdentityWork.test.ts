/** Protects pure identity reuse, live role updates, stable ranking, and legacy non-finite inputs. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isFallbackVisualSibling,
  isVisualPageFrame,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageRecipe';
import {
  scoreVirtualPageContent,
  tokenizeComponentIdentity,
  readVirtualPageIdentityTokens,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPageScoring';
import { selectPreviewInspectorVirtualPageContentCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import type { PreviewInspectorOneHopVisualPath } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualTypes';
import { createCandidate, RENDER_PATH } from './previewInspectorVirtualPagePlanFixtures';

afterEach(() => vi.restoreAllMocks());

/** Creates ordinary JSON-shaped visual evidence without any application-specific policy. */
function visual(): PreviewInspectorOneHopVisualPath {
  return {
    exportName: 'default',
    importerPath: '/workspace/Owner.tsx',
    importKind: 'static',
    localEdges: [],
    moduleSpecifier: './View',
    occurrenceStart: 1,
    relation: 'sibling',
    renderedLocalName: 'View',
    renderBoundaryStart: 0,
    selectedChildPath: '/workspace/Child.tsx',
    sourcePath: '/workspace/Layout.tsx',
  };
}

describe('virtual-page identity work', () => {
  it('keeps oversized names fully analyzable without retaining their token set', () => {
    const owner = {};
    const identity = `${'Large'.repeat(1200)}Page`;
    const first = readVirtualPageIdentityTokens(owner, identity);
    const second = readVirtualPageIdentityTokens(owner, identity);
    expect(first.has('page')).toBe(true);
    expect([...second]).toEqual([...first]);
    expect(second).not.toBe(first);
  });
  it('splits one unchanged candidate identity once across repeated scoring', () => {
    const candidate = createCandidate({
      root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
    });
    const replace = vi.spyOn(String.prototype, 'replace');
    const first = scoreVirtualPageContent(candidate, candidate);
    for (let index = 0; index < 39; index++)
      expect(scoreVirtualPageContent(candidate, candidate)).toBe(first);
    const pattern = /([\p{Ll}\d])(\p{Lu})/gu;
    expect(
      replace.mock.calls.filter(
        ([expression]) => expression instanceof RegExp && expression.source === pattern.source,
      ),
    ).toHaveLength(1);
  });

  it('observes changing getter-backed visual identities even when the object is frozen', () => {
    let sourcePath = '/workspace/Layout.tsx';
    const item = Object.freeze({
      ...visual(),
      get sourcePath() {
        return sourcePath;
      },
    });
    expect(isVisualPageFrame(item)).toBe(true);
    expect(isFallbackVisualSibling(item)).toBe(false);
    sourcePath = '/workspace/ErrorView.tsx';
    expect(isVisualPageFrame(item)).toBe(false);
    expect(isFallbackVisualSibling(item)).toBe(true);
    sourcePath = '/workspace/Layout.tsx';
    expect(isVisualPageFrame(item)).toBe(true);
    expect(isFallbackVisualSibling(item)).toBe(false);
  });

  it('keeps checkpoint state, depth, and authored-root preference live after token reuse', () => {
    const root = { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' };
    const candidate = { ...createCandidate({ root }), rootStepIndex: 0 };
    const first = scoreVirtualPageContent(candidate, candidate);
    candidate.rootStepIndex = 1;
    const changed = scoreVirtualPageContent(candidate, candidate);
    expect(changed).toBe(first - 20);
    const elsewhere = createCandidate({
      root: { exportName: 'Other', sourcePath: '/workspace/Elsewhere.tsx' },
    });
    expect(scoreVirtualPageContent(candidate, elsewhere)).toBe(changed - 250);
    root.exportName = 'ErrorPage';
    expect(scoreVirtualPageContent(candidate, candidate)).toBe(changed);
    candidate.stopReason = 'root-reached';
    expect(scoreVirtualPageContent(candidate, candidate)).toBe(changed - 2000);
  });

  it('returns independent token sets from the existing standalone tokenizer', () => {
    const first = tokenizeComponentIdentity('HTTPSettingsPage');
    (first as Set<string>).clear();
    expect([...tokenizeComponentIdentity('HTTPSettingsPage')]).toEqual([
      'http',
      'settings',
      'page',
    ]);
  });

  it('selects the first highest finite score without sorting the same-path candidates', () => {
    const form = createCandidate({
      id: 'form',
      root: { exportName: 'Form', sourcePath: '/workspace/Form.tsx' },
    });
    const page = createCandidate({
      id: 'first-page',
      root: { exportName: 'Page', sourcePath: '/workspace/Page.tsx' },
    });
    const tied = createCandidate({ ...page, id: 'second-page' });
    const sort = vi.spyOn(Array.prototype, 'sort');
    expect(selectPreviewInspectorVirtualPageContentCandidate([form, page, tied], form)).toBe(page);
    expect(sort).not.toHaveBeenCalled();
  });

  it('preserves the previous stable-sort behavior when a score is NaN', () => {
    const form = createCandidate({
      id: 'form',
      root: { exportName: 'Form', sourcePath: '/workspace/Form.tsx' },
    });
    const invalid = createCandidate({
      id: 'invalid',
      rootStepIndex: Number.NaN,
      renderPath: RENDER_PATH,
    });
    const page = createCandidate({
      id: 'page',
      root: { exportName: 'Page', sourcePath: '/workspace/Page.tsx' },
    });
    expect(selectPreviewInspectorVirtualPageContentCandidate([form, invalid, page], form)).toBe(
      form,
    );
  });
});
