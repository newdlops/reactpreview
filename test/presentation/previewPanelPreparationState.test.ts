import { describe, expect, it } from 'vitest';
import { PreviewPanelPreparationState } from '../../src/presentation/previewPanelPreparationState';

describe('PreviewPanelPreparationState', () => {
  it('restores the prior committed mode when a pending selection rolls back', () => {
    const state = new PreviewPanelPreparationState('component');
    state.markCorridorCommitted();
    state.beginSelection();
    expect(state.current).toBe('fast');
    state.rollbackSelection();
    expect(state.current).toBe('corridor');
  });

  it('keeps component selections and retries on the fast baseline', () => {
    const state = new PreviewPanelPreparationState('component');
    state.beginSelection();
    state.commitSelection();
    expect(state.current).toBe('fast');
    state.resetForRetry();
    expect(state.current).toBe('fast');
    state.markCorridorCommitted();
    expect(state.current).toBe('corridor');
  });

  it('starts Page Inspector fast, then uses its corridor baseline for selection and retry', () => {
    const state = new PreviewPanelPreparationState('page-inspector');
    expect(state.current).toBe('fast');
    state.beginSelection();
    expect(state.current).toBe('corridor');
    state.rollbackSelection();
    expect(state.current).toBe('fast');
    state.beginSelection();
    state.commitSelection();
    expect(state.current).toBe('corridor');
    state.resetForRetry();
    expect(state.current).toBe('corridor');
  });

  it('ignores stale corridor completion while a newer selection is pending', () => {
    const state = new PreviewPanelPreparationState('component');
    state.beginSelection();
    expect(state.tryMarkCorridorCommitted()).toBe(false);
    expect(state.current).toBe('fast');
    state.rollbackSelection();
    expect(state.tryMarkCorridorCommitted()).toBe(true);
    expect(state.current).toBe('corridor');
  });
});
