/** Owns the automatic fast/corridor state independently of panel rendering state. */
/** Automatic preparation policies available to a preview panel. */
export type PreviewPanelAutomaticPreparationMode = 'fast' | 'corridor';

/** Tracks automatic preparation mode across selection, commit, and rollback. */
export class PreviewPanelPreparationState {
  private mode: PreviewPanelAutomaticPreparationMode = 'fast';
  private rollbackMode: PreviewPanelAutomaticPreparationMode | undefined;

  /** Returns the currently committed automatic preparation mode. */
  public get current(): PreviewPanelAutomaticPreparationMode {
    return this.mode;
  }

  /** Starts a selection transaction and records the prior mode for rollback. */
  public beginSelection(): void {
    if (this.rollbackMode !== undefined) throw new Error('A preview selection is already pending.');
    this.rollbackMode = this.mode;
    this.mode = 'fast';
  }

  /** Commits a pending selection transaction using the fast preparation mode. */
  public commitSelection(): void {
    if (this.rollbackMode === undefined) return;
    this.rollbackMode = undefined;
    this.mode = 'fast';
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
    this.mode = 'fast';
    this.rollbackMode = undefined;
  }
}
