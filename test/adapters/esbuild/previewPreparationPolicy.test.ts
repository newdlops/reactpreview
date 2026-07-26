import { describe, expect, it } from 'vitest';
import { createPreviewPreparationPolicy } from '../../../src/adapters/esbuild/previewPreparationPolicy';

describe('createPreviewPreparationPolicy', () => {
  it('keeps fast preparation graph-critical and bounded', () => {
    expect(createPreviewPreparationPolicy({ preparationMode: 'fast' })).toMatchObject({
      allowAutomaticStorybook: false,
      discoveryScope: 'selected-corridor',
      maximumSmallDynamicImports: 8,
      runtimeEvidence: 'critical',
      styleEvidence: 'critical',
    });
  });

  it('uses complete selected-corridor evidence without workspace expansion', () => {
    expect(createPreviewPreparationPolicy({ preparationMode: 'corridor' })).toMatchObject({
      collectRuntimeWatchInputs: true,
      discoveryScope: 'selected-corridor',
      styleEvidence: 'selected-complete',
      useFastSourceCompatibility: false,
    });
  });

  it('preserves workspace-complete defaults for omitted preparation mode', () => {
    const policy = createPreviewPreparationPolicy({});

    expect(policy).toMatchObject({
      allowAutomaticStorybook: true,
      discoveryScope: 'workspace',
      styleEvidence: 'workspace-complete',
    });
    expect(policy.frontierPolicy).toBeUndefined();
  });
});
