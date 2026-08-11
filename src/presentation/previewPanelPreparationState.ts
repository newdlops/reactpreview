/** Owns the automatic fast/corridor state independently of panel rendering state. */
import type { PreviewRenderMode } from '../domain/preview';

/** Automatic preparation policies available to a preview panel. */
export type PreviewPanelAutomaticPreparationMode = 'fast' | 'corridor';

/** Tracks automatic preparation mode across selection, commit, and rollback. */
export class PreviewPanelPreparationState {
  private mode: PreviewPanelAutomaticPreparationMode;
  private readonly baseline: PreviewPanelAutomaticPreparationMode;
  private rollbackMode: PreviewPanelAutomaticPreparationMode | undefined;

  /** Sets the baseline preparation mode for the panel's immutable render surface. */
  public constructor(renderMode: PreviewRenderMode = 'component') {
    this.baseline = renderMode === 'page-inspector' ? 'corridor' : 'fast';
    this.mode = 'fast';
  }

  /** Returns the currently committed automatic preparation mode. */
  public get current(): PreviewPanelAutomaticPreparationMode {
    return this.mode;
  }

  /** Starts a selection transaction and records the prior mode for rollback. */
  public beginSelection(): void {
    if (this.rollbackMode !== undefined) throw new Error('A preview selection is already pending.');
    this.rollbackMode = this.mode;
    this.mode = this.baseline;
  }

  /** Commits a pending selection transaction using the render-mode baseline. */
  public commitSelection(): void {
    if (this.rollbackMode === undefined) return;
    this.rollbackMode = undefined;
    this.mode = this.baseline;
  }

  /** Restores the prior mode when a pending selection transaction is cancelled. */
  public rollbackSelection(): void {
    if (this.rollbackMode !== undefined) this.mode = this.rollbackMode;
    this.rollbackMode = undefined;
  }

  /** Records a completed selected-corridor preparation. */
  public markCorridorCommitted(): void {
    if (this.rollbackMode !== undefined)
      throw new Error('Cannot commit corridor while selection is pending.');
    this.mode = 'corridor';
  }

  /** Clears selection state before retrying automatic preparation. */
  public resetForRetry(): void {
    this.mode = this.baseline;
    this.rollbackMode = undefined;
  }
}
