/** Verifies partial-path repair replays retain current, independently verified full-page coverage. */
import { describe, expect, it } from 'vitest';
import {
  candidates,
  createPageContextFixture,
  type PageCandidateFixture,
} from './previewInspectorNeuralPageContextFixture';

const verifiedPage = candidates[0];
const blockedPage = candidates[1];
if (verifiedPage === undefined || blockedPage === undefined)
  throw new Error('Missing page fixtures.');
const partial: PageCandidateFixture = {
  ...blockedPage,
  complete: false,
  id: 'component-recovery',
  renderPath: { id: 'partial', steps: [{ label: 'LocalOwner' }, { label: 'TaxTypeBadge' }] },
  stopReason: 'render-path-checkpoint',
};

describe('partial-path recovery coverage', () => {
  it.each([true, false, undefined])(
    'retains only verified complete output contracts (complete = %s)',
    (contextComplete) => {
      const fixture = createPageContextFixture([verifiedPage, blockedPage, partial]);
      expect(
        fixture.observe(verifiedPage, {
          neuralStableOutputVerified: true,
          pageExecutionContext: contextComplete === undefined ? undefined : { contextComplete },
          pageRootCommitted: true,
          status: 'reached',
          targetHasOutput: true,
          targetMounted: true,
        }),
      ).toBe(true);
      fixture.record().failedCandidateIds.add(blockedPage.id);
      fixture.record().evaluatedCandidateIds.add(blockedPage.id);
      fixture.session.pendingPageCandidateId = undefined;
      fixture.session.selectedPageCandidateId = partial.id;
      fixture.setExecutableCandidateId(partial.id);
      fixture.setAutoConditions([['open-authored-overlay', true]]);

      expect(fixture.retainRecoveryRecipe(partial, { targetExportName: 'TaxTypeBadge' })).toBe(
        true,
      );
      expect(fixture.record().evaluatedCandidateIds.has(verifiedPage.id)).toBe(
        contextComplete === true,
      );
      expect(fixture.record().failedCandidateIds.has(blockedPage.id)).toBe(false);
      expect(fixture.record().evaluatedCandidateIds.has(blockedPage.id)).toBe(false);

      expect(
        fixture.observe(partial, {
          exhausted: true,
          pageRootCommitted: true,
          status: 'page-blocked',
          targetHasOutput: false,
        }),
      ).toBe(true);
      expect(fixture.requests.at(-1)?.candidateId).toBe(
        contextComplete === true ? blockedPage.id : verifiedPage.id,
      );
    },
  );

  it('reopens a complete snapshot after its output is no longer verified', () => {
    const fixture = createPageContextFixture([verifiedPage, partial]);
    fixture.select();
    fixture.record().executionContractByCandidateId.set(verifiedPage.id, {
      snapshot: { conditionEntries: [], pageExecutionContext: { contextComplete: true } },
    });
    fixture.record().evaluatedCandidateIds.add(verifiedPage.id);
    fixture.record().failedCandidateIds.add(verifiedPage.id);
    fixture.session.selectedPageCandidateId = partial.id;
    fixture.setExecutableCandidateId(partial.id);

    expect(fixture.retainRecoveryRecipe(partial, {})).toBe(true);
    expect(fixture.record().evaluatedCandidateIds.has(verifiedPage.id)).toBe(false);
    expect(fixture.record().failedCandidateIds.has(verifiedPage.id)).toBe(false);
  });
});
