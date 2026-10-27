/** Checks automatic path coverage without hiding untried mount options or distinct authored routes. */
import { describe, expect, it } from 'vitest';
import {
  candidates,
  createPageContextFixture,
  type PageCandidateFixture,
} from './previewInspectorNeuralPageContextFixture';

/** Creates distinct mount options sharing a compiler-proven caller-path identity. */
function page(id: string, pathId: string, pathname = '/items'): PageCandidateFixture {
  const base = candidates[0];
  if (base === undefined) throw new Error('Missing page fixture.');
  return {
    ...base,
    id,
    renderPath: { ...base.renderPath, id: pathId },
    routeLocation: { pathname },
  };
}

/** Sustained output observed by the production success verifier before caller-path learning. */
function output(candidate: PageCandidateFixture): Record<string, unknown> {
  return {
    candidateId: candidate.id,
    neuralStableOutputVerified: true,
    pageExecutionContext: { contextComplete: true },
    pageRootCommitted: true,
    status: 'reached',
    targetHasOutput: true,
    targetMounted: true,
    targetWasMounted: true,
  };
}

describe('verified caller-path coverage', () => {
  it('visits another caller before stopping, without compiling redundant mount options', () => {
    const first = page('first-full', 'first-path');
    const firstAlternative = page('first-checkpoint', 'first-path');
    const second = page('second-full', 'second-path');
    const secondAlternative = page('second-checkpoint', 'second-path');
    const fixture = createPageContextFixture([first, firstAlternative, second, secondAlternative]);
    expect(fixture.observe(first, output(first))).toBe(true);
    expect(fixture.continueCoverage()).toBe(true);
    expect(fixture.requests.map((request) => request.candidateId)).toEqual([second.id]);
    expect(fixture.record().evaluatedCandidateIds.has(firstAlternative.id)).toBe(false);

    fixture.session.pendingPageCandidateId = undefined;
    fixture.setExecutableCandidateId(second.id);
    fixture.setCurrentReachability(output(second));
    expect(fixture.observe(second, output(second))).toBe(true);
    expect(fixture.continueCoverage()).toBe(false);
    expect(fixture.record().coverageComplete).toBe(true);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.record().evaluatedCandidateIds.has(secondAlternative.id)).toBe(false);
    expect(fixture.record().successfulCandidateIds.has(secondAlternative.id)).toBe(false);
    expect(fixture.possibilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateIds: [second.id, secondAlternative.id],
          evaluatedVariantCount: 1,
          selectable: true,
          statusLabel: 'STABLE OUTPUT',
          variantCount: 2,
        }),
      ]),
    );
  });

  it('keeps untried mount options selectable after automatic coverage completes', () => {
    const first = page('full', 'one-path');
    const alternate = page('checkpoint', 'one-path');
    const fixture = createPageContextFixture([first, alternate]);
    fixture.setCurrentReachability(output(first));
    expect(fixture.observe(first, output(first))).toBe(true);
    expect(fixture.requests).toHaveLength(0);
    fixture.session.userSelectedPageCandidateId = alternate.id;
    expect(fixture.select()).toMatchObject({ candidate: alternate, origin: 'user' });
    expect(fixture.record().evaluatedCandidateIds.has(alternate.id)).toBe(false);
  });

  it('reopens the remaining mount option when the complete output regresses', () => {
    const first = page('full', 'one-path');
    const alternate = page('checkpoint', 'one-path');
    const fixture = createPageContextFixture([first, alternate]);
    fixture.setCurrentReachability(output(first));
    fixture.observe(first, output(first));
    const regression = {
      ...output(first),
      exhausted: true,
      neuralStableOutputRegressed: true,
      status: 'page-blocked',
      targetHasOutput: false,
    };
    fixture.setCurrentReachability(regression);
    expect(fixture.observe(first, regression)).toBe(true);
    expect(fixture.record().coverageComplete).toBe(false);
    expect(fixture.requests.at(-1)?.candidateId).toBe(alternate.id);
  });

  it.each([false, undefined])(
    'does not cover alternatives with an incomplete or absent page contract (%s)',
    (contextComplete) => {
      const first = page('full', 'one-path');
      const alternate = page('checkpoint', 'one-path');
      const fixture = createPageContextFixture([first, alternate]);
      const state = {
        ...output(first),
        pageExecutionContext: contextComplete === undefined ? undefined : { contextComplete },
      };
      fixture.setCurrentReachability(state);
      fixture.observe(first, state);
      expect(fixture.record().coverageComplete).toBe(false);
      expect(fixture.continueCoverage()).toBe(true);
      expect(fixture.requests.at(-1)?.candidateId).toBe(alternate.id);
    },
  );

  it('does not merge different authored routes sharing the same render-path identity', () => {
    const first = page('left-full', 'shared-path', '/left');
    const redundant = page('left-checkpoint', 'shared-path', '/left');
    const otherRoute = page('right-full', 'shared-path', '/right');
    const fixture = createPageContextFixture([first, redundant, otherRoute]);
    fixture.setCurrentReachability(output(first));
    fixture.observe(first, output(first));
    expect(fixture.continueCoverage()).toBe(true);
    expect(fixture.requests.at(-1)?.candidateId).toBe(otherRoute.id);
    expect(fixture.record().coverageComplete).toBe(false);
  });

  it('keeps pinned loading checkpoints open to alternative execution', () => {
    const first = page('loading', 'one-path');
    const alternate = page('checkpoint', 'one-path');
    const fixture = createPageContextFixture([first, alternate]);
    fixture.setCurrentReachability(output(first));
    fixture.observe(first, output(first));
    const retained = fixture.record().executionContractByCandidateId.get(first.id);
    if (retained === undefined) throw new Error('Missing verified contract.');
    fixture.record().executionContractByCandidateId.set(first.id, {
      snapshot: { ...retained.snapshot, temporalState: { kind: 'transient-checkpoint' } },
    });
    expect(fixture.record().coverageComplete).toBe(false);
    expect(fixture.select({ exploreUnevaluated: true })?.candidate.id).toBe(alternate.id);
  });

  it('requires current verification before a persisted preference can cover a path', () => {
    const first = page('historical', 'one-path');
    const alternate = page('checkpoint', 'one-path');
    const fixture = createPageContextFixture([first, alternate], first.id);
    expect(fixture.select({ exploreUnevaluated: true })).toMatchObject({
      candidate: first,
      origin: 'neural',
    });
    expect(fixture.record().coverageComplete).toBe(false);
    expect(fixture.record().successfulCandidateIds.size).toBe(0);
  });
});
