/** Separates render-time standalone health reads from post-commit learning observations. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCompositionHealthRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCompositionHealthRuntimeSource';
import { createPreviewInspectorTargetReachabilityStateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityStateRuntimeSource';

/** Bounded health data returned by the actual composed runtime helpers. */
interface HealthSnapshot {
  readonly detail: Record<string, unknown>;
  readonly digest: string;
}

/** Observes when the learning port is called, without replacing either state or health producer. */
interface Observation {
  readonly kind: 'success' | 'failure';
  readonly phase: 'idle' | 'render' | 'commit';
  readonly key: string;
  readonly targetHasOutput: boolean;
}

/** Controls only renderer-owned output and selection facts around the real helper composition. */
interface ObservationFixture {
  readonly read: () => HealthSnapshot;
  readonly commit: (snapshot: HealthSnapshot) => void;
  readonly observations: readonly Observation[];
  readonly setOutput: (value: boolean) => void;
  readonly select: (exportName: string) => void;
  readonly admit: (value: boolean) => void;
}

const KEY = 'standalone-target:/workspace/StandalonePage.tsx:StandalonePage';

/** Supplies an exact mounted target identity and captures the side-effectful learning boundary. */
function createFixture(): ObservationFixture {
  const context: {
    __runtime?: ObservationFixture;
    document: { readonly querySelectorAll: () => readonly unknown[] };
  } = { document: { querySelectorAll: () => [] } };
  vm.runInNewContext(
    `
      let phase = 'idle';
      let outputPresent = true;
      const observations = [];
      const descriptor = {
        exportName: 'StandalonePage',
        sourcePath: '/workspace/StandalonePage.tsx',
        standalonePageTarget: true,
      };
      const previewInspectorSession = {
        selectedExportName: 'StandalonePage',
        runtimeFallbacks: new Map(),
        boundariesByExport: new Map([
          ['StandalonePage', new Set([{ props: {
            exportName: 'StandalonePage', sourcePath: '/workspace/StandalonePage.tsx',
          } }])],
        ]),
      };
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readPreviewInspectorPageCandidates = () => [];
      const readSelectedPreviewInspectorPageCandidate = () => undefined;
      const readPreviewInspectorRenderScenario = () => 'authored-page';
      const hasPreviewInspectorTargetHostOutput = () => outputPresent;
      const isPreviewInspectorBlockingNode = () => false;
      const recordPreviewInspectorRuntimeHealth = () => {};
      const completePreviewCommit = () => {};
      function observe(kind, state) {
        observations.push({ kind, phase, key: state.key, targetHasOutput: state.targetHasOutput });
      }
      const recordPreviewInspectorNeuralSuccessfulPath = (state) => observe('success', state);
      const handlePreviewInspectorNeuralSuccessfulPathRestorationFailure = (state) =>
        observe('failure', state);
      ${createPreviewInspectorTargetReachabilityStateRuntimeSource()}
      ${createPreviewInspectorPageCompositionHealthRuntimeSource()}
      globalThis.__runtime = {
        observations,
        setOutput(value) { outputPresent = value; },
        select(exportName) { previewInspectorSession.selectedExportName = exportName; },
        admit(value) { descriptor.standalonePageTarget = value; },
        read() {
          phase = 'render';
          try {
            return createPreviewInspectorPageCompositionHealthSnapshot({
              hostNodesById: new Map([['target', [{ isConnected: outputPresent }]]]),
              roots: [{
                id: 'target', kind: 'target', name: 'StandalonePage', mounted: true,
                currentFileExport: true, children: [],
              }],
              status: 'Live page tree', truncated: false,
            });
          } finally { phase = 'idle'; }
        },
        commit(snapshot) {
          phase = 'commit';
          try { recordPreviewInspectorPageCompositionHealthSnapshot(snapshot); }
          finally { phase = 'idle'; }
        },
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Standalone observation fixture failed.');
  return context.__runtime;
}

describe('standalone target learning observation lifecycle', () => {
  it('reads stable health during repeated renders without publishing learning updates', () => {
    const fixture = createFixture();
    const first = fixture.read();
    expect(fixture.read().digest).toBe(first.digest);
    expect(first.detail).toMatchObject({ targetState: { reachabilityHasOutput: true } });
    expect(fixture.observations).toEqual([]);
  });

  it('records successful standalone output after the toolbar commit', () => {
    const fixture = createFixture();
    fixture.commit(fixture.read());
    expect(fixture.observations).toEqual([
      { kind: 'success', phase: 'commit', key: KEY, targetHasOutput: true },
    ]);
  });

  it('preserves restoration-failure observation after committing missing output', () => {
    const fixture = createFixture();
    fixture.setOutput(false);
    const snapshot = fixture.read();
    expect(fixture.observations).toEqual([]);
    fixture.commit(snapshot);
    expect(fixture.observations).toEqual([
      { kind: 'failure', phase: 'commit', key: KEY, targetHasOutput: false },
    ]);
  });

  it('rechecks live output instead of recording stale successful render evidence', () => {
    const fixture = createFixture();
    const snapshot = fixture.read();
    fixture.setOutput(false);
    fixture.commit(snapshot);
    expect(fixture.observations).toEqual([
      { kind: 'failure', phase: 'commit', key: KEY, targetHasOutput: false },
    ]);
  });

  it('ignores the old target when selection changes before commit', () => {
    const fixture = createFixture();
    const snapshot = fixture.read();
    fixture.select('OtherPage');
    fixture.commit(snapshot);
    expect(fixture.observations).toEqual([]);
  });

  it('does not create standalone learning evidence without compiler admission', () => {
    const fixture = createFixture();
    fixture.admit(false);
    fixture.commit(fixture.read());
    expect(fixture.observations).toEqual([]);
  });
});
