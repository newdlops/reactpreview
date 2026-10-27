/** Verifies that retained target history requires a committed boundary with the exact source/export. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createEmptyPageTargetRuntimePreambleSource,
  createPageTargetDescriptorCandidateFixtureSource,
  createTargetReachabilityFixtureSource,
} from './previewInspectorTargetReachabilityRuntimeSourceFixtures';

/** Registers controlled boundary identities through the production mount observer. */
function observeMountHistory(sourcePath: string, priorExactMount = false): unknown {
  return vm.runInNewContext(`
    ${createEmptyPageTargetRuntimePreambleSource()}
    ${createTargetReachabilityFixtureSource()}
    ${createPageTargetDescriptorCandidateFixtureSource()}
    const state = readPreviewInspectorTargetReachabilityState(descriptor, candidate);
    previewInspectorSession.activeTargetReachabilityKey = state.key;
    const boundaries = new Set();
    previewInspectorSession.boundariesByExport.set('Target', boundaries);
    if (${String(priorExactMount)}) {
      boundaries.add({ props: { exportName: 'Target', sourcePath: '/Target.tsx' } });
      markPreviewInspectorTargetReachabilityMount('Target');
      boundaries.clear();
    }
    boundaries.add({ props: { exportName: 'Target', sourcePath: ${JSON.stringify(sourcePath)} } });
    markPreviewInspectorTargetReachabilityMount('Target');
    const during = state.targetMounted;
    boundaries.clear();
    state.targetMounted = hasMountedPreviewInspectorTarget(state);
    ({ during, mounted: state.targetMounted, wasMounted: state.targetWasMounted,
      hasOutput: state.targetHasOutput, overrideCount: previewInspectorSession.renderConditionOverrides.size });
  `);
}

describe('exact target mount history', () => {
  it('retains a real mount after the exact target leaves the active tree', () => {
    expect(observeMountHistory('/Target.tsx')).toEqual({
      during: true,
      mounted: false,
      wasMounted: true,
      hasOutput: false,
      overrideCount: 0,
    });
  });

  it('does not invent a prior target mount from another source exporting the same name', () => {
    expect(observeMountHistory('/OtherTarget.tsx')).toEqual({
      during: false,
      mounted: false,
      wasMounted: false,
      hasOutput: false,
      overrideCount: 0,
    });
  });

  it('preserves real history when a later unrelated boundary has the same export name', () => {
    expect(observeMountHistory('/OtherTarget.tsx', true)).toEqual({
      during: false,
      mounted: false,
      wasMounted: true,
      hasOutput: false,
      overrideCount: 0,
    });
  });
});
