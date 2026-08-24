/** Locks the automatic page-generation corridor beside the executable choice-graph tests. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralAssistanceAvailabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceAvailabilityRuntimeSource';
import { createPreviewInspectorNeuralAssistanceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceRuntimeSource';

describe('Preview Inspector neural page generation integration', () => {
  it('keeps verified output open only while model-owned page work remains', () => {
    const source = createPreviewInspectorNeuralAssistanceRuntimeSource();

    expect(source).toContain(
      'if (reachability.targetHasOutput === true && !pageGenerationWork) return undefined;',
    );
    expect(source).toContain('successfulPathSettled && reachability.targetHasOutput === true');
    expect(source).toContain('recordPreviewInspectorNeuralSuccessfulPath(currentReachability)');
    expect(source).toContain('createPreviewInspectorNeuralPageGenerationPlan(record)');
    expect(source).toContain('applyPreviewInspectorNeuralPageGenerationPlan(exploration)');
  });

  it('presents remaining automatic page generation as refinement rather than completion', () => {
    const source = createPreviewInspectorNeuralAssistanceAvailabilityRuntimeSource();

    expect(source).toContain(
      'const pageGenerationAvailable = !temporalLocked && !successfulPathSettled &&',
    );
    expect(source).toContain('refining: renderedCorridor && pageGenerationAvailable');
    expect(source).toContain('automaticWorkAvailable || pageGenerationAvailable');
    expect(source).toContain('Visible output is checkpointed.');
  });
});
