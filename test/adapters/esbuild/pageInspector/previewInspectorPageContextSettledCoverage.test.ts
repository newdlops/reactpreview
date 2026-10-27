/** Retains already verified current output after complete coverage, while preserving fallback replay. */
import { describe, expect, it } from 'vitest';
import { candidates, createPageContextFixture } from './previewInspectorNeuralPageContextFixture';

describe('settled page-context coverage', () => {
  it.each([true, false])(
    'requires live current output before omitting a historical replay (%s)',
    (visible) => {
      const fixture = createPageContextFixture();
      const first = candidates[0],
        current = candidates[1];
      if (first === undefined || current === undefined) throw new Error('Missing page fixtures.');
      const output = {
        neuralStableOutputVerified: true,
        pageExecutionContext: { contextComplete: true },
        pageRootCommitted: true,
        status: 'reached',
        targetHasOutput: true,
        targetMounted: true,
        targetWasMounted: true,
      };
      fixture.observe(first, { ...output });
      fixture.session.selectedPageCandidateId = current.id;
      fixture.setExecutableCandidateId(current.id);
      fixture.setAutoConditions([['extra-current-condition', true]]);
      const state = { ...output, candidateId: current.id };
      fixture.observe(current, state);
      fixture.setCurrentReachability({ ...state, targetHasOutput: visible });
      expect(fixture.record().coverageComplete).toBe(true);
      expect(fixture.continueCoverage()).toBe(!visible);
      if (visible) expect(fixture.requests).toHaveLength(0);
      else expect(fixture.requests.at(-1)?.candidateId).toBe(first.id);
    },
  );
});
