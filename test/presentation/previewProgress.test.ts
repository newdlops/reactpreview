/** Verifies stable progress ordering and the revision-aware webview message contract. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewProgressMessage,
  createPreviewProgressSnapshot,
  PREVIEW_PROGRESS_STEPS,
} from '../../src/presentation/previewProgress';

describe('preview progress presentation', () => {
  /** Maps a real preparation milestone to human-readable text and a one-based step position. */
  it('describes discrete preparation stages without a fabricated percentage', () => {
    const progress = createPreviewProgressSnapshot('bundling-modules');

    expect(progress).toEqual({
      complete: false,
      detail: 'Building only the reachable browser modules without starting a server.',
      label: 'Bundling reachable modules',
      stage: 'bundling-modules',
      step: 5,
      total: 8,
    });
    expect(PREVIEW_PROGRESS_STEPS.map((step) => step.stage)).toEqual([
      'resolving-target',
      'analyzing-project',
      'discovering-components',
      'preparing-runtime',
      'bundling-modules',
      'acquiring-dependencies',
      'publishing-artifacts',
      'loading-preview',
    ]);
  });

  /** Marks completion explicitly so a retained hot preview can hide its isolated overlay. */
  it('creates a structured-clone-safe completion message for one session revision', () => {
    expect(createPreviewProgressMessage('ready', 42)).toEqual({
      complete: true,
      detail: 'The latest preview revision is ready.',
      label: 'Preview ready',
      revision: 42,
      stage: 'ready',
      step: 8,
      total: 8,
      type: 'react-preview-progress',
    });
  });
});
