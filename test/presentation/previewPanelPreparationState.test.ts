import { describe, expect, it } from 'vitest';
import { PreviewPanelPreparationState } from '../../src/presentation/previewPanelPreparationState';

describe('PreviewPanelPreparationState', () => {
  it('restores the prior committed mode when a pending selection rolls back', () => {
    const state = new PreviewPanelPreparationState();
    state.markCorridorCommitted();
    state.beginSelection();
    expect(state.current).toBe('fast');
    state.rollbackSelection();
    expect(state.current).toBe('corridor');
  });

  it('commits selection fast and allows its later corridor commit', () => {
    const state = new PreviewPanelPreparationState();
    state.beginSelection();
    state.commitSelection();
    expect(state.current).toBe('fast');
    state.markCorridorCommitted();
    expect(state.current).toBe('corridor');
  });
});
