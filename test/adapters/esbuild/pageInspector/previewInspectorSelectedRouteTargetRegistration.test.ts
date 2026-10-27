/** Keeps persisted Inspector selection aligned with an explicitly compiled route-leaf target. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRootSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorRootSource';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewPageInspectorRuntimeSource';
import { createPlan, PAGE_PATH } from '../inspector/previewInspectorRootPluginFixtures';

/** Mutable Inspector observations and retained state exposed by the isolated registration fixture. */
interface RegistrationHarness {
  /** Invokes production descriptor registration without React or a project module. */
  readonly register: (descriptors: readonly unknown[]) => void;
  /** Selection can change while manual condition choices and learned state retain identity. */
  readonly session: {
    selectedExportName: string;
    selectedTreeNodeId?: string;
    readonly conditionOverrides: Map<string, boolean>;
    readonly learnedState: { readonly verifiedUpdates: number };
  };
  /** Candidate identities observed by the production reconciliation call. */
  readonly appliedCandidateIds: readonly string[][];
  /** Number of reachability resets requested after changing the ownership target. */
  readonly resetCount: () => number;
  /** Original manual choices used to detect accidental state replacement. */
  readonly conditionOverrides: Map<string, boolean>;
  /** Original local learning record used to detect accidental state replacement. */
  readonly learnedState: { readonly verifiedUpdates: number };
}

/** Uses compiler-shaped inert metadata; no authored module or application action is executed. */
function createDescriptor(
  explicitRoute: boolean,
  exportName = 'SelectedPage',
): Record<string, unknown> {
  return {
    exportName,
    inspector: {
      ...(explicitRoute ? { targetMode: 'selected-route-leaf' } : {}),
      target: { exportName, sourcePath: '/workspace/' + exportName + '.tsx' },
      renderChainsByExport: { SharedProvider: {}, Sibling: {} },
      pageCandidates: [
        {
          id: 'active-leaf',
          root: { exportName: 'RootApp', sourcePath: '/workspace/RootApp.tsx' },
          target: { exportName },
        },
        {
          id: 'analysis-provider',
          root: { exportName: 'AreaApp', sourcePath: '/workspace/AreaApp.tsx' },
          target: { exportName: 'SharedProvider' },
        },
      ],
    },
  };
}

/** Executes the actual registration and candidate filtering functions with isolated storage hooks. */
function createRegistrationHarness(selectedExportName = 'SharedProvider'): RegistrationHarness {
  const source = createPreviewPageInspectorRuntimeSource();
  const candidates = createPreviewInspectorPageCandidateRuntimeSource();
  const registration = source.slice(
    source.indexOf('function setPreviewInspectorDescriptors('),
    source.indexOf('function formatPreviewInspectorEntryName('),
  );
  const readCandidates = candidates.slice(
    candidates.indexOf('function readPreviewInspectorPageCandidates('),
    candidates.indexOf('function readPreviewInspectorRouteBranches('),
  );
  const appliedCandidateIds: string[][] = [];
  let reachabilityResets = 0;
  const conditionOverrides = new Map([['manual-condition', true]]);
  const learnedState = { verifiedUpdates: 7 };
  const session = {
    descriptors: [] as unknown[],
    selectedExportName,
    selectedTreeNodeId: 'previous-node',
    descriptorNames: [] as string[],
    boundariesByExport: new Map(),
    renderabilityByExport: new Map(),
    basePropsByExport: new Map(),
    basePropsFingerprintByExport: new Map(),
    instanceEpochByExport: new Map(),
    propsRevisionByExport: new Map(),
    resolverPropsByExport: new Map(),
    conditionOverrides,
    learnedState,
  };
  const register = vm.runInNewContext(
    registration + readCandidates + '\nsetPreviewInspectorDescriptors;',
    {
      previewInspectorSession: session,
      normalizePreviewInspectorProps: (value: unknown) => value,
      stringifyPreviewInspectorProps: JSON.stringify,
      reconcilePreviewInspectorPageCandidateSelection: (ids: string[]) => {
        appliedCandidateIds.push(ids);
        return false;
      },
      resetPreviewInspectorTargetReachability: () => {
        reachabilityResets += 1;
        return true;
      },
      persistPreviewInspectorState: () => undefined,
      notifyPreviewInspector: () => undefined,
      schedulePreviewInspectorCommitRefresh: () => undefined,
    },
  ) as (descriptors: readonly unknown[]) => void;
  return {
    register,
    session,
    appliedCandidateIds,
    resetCount: () => reachabilityResets,
    conditionOverrides,
    learnedState,
  };
}

describe('explicit route target registration', () => {
  it('publishes explicit intent beside the compiler-owned runtime target', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
      runtimeOwnershipTarget: {
        exportName: 'SelectedPage',
        sourcePath: '/workspace/SelectedPage.tsx',
      },
      targetMode: 'selected-route-leaf',
    });
    const prefix = 'const __reactPreviewInspectorDescriptor = ';
    const start = source.indexOf(prefix);
    const descriptor = JSON.parse(
      source.slice(start + prefix.length, source.indexOf(';\n', start)),
    ) as { inspector: { targetMode?: string; target: { exportName: string } } };
    expect(descriptor.inspector).toMatchObject({
      targetMode: 'selected-route-leaf',
      target: { exportName: 'SelectedPage' },
    });
  });

  it('replaces a persisted Provider selection before filtering the selected route candidates', () => {
    const fixture = createRegistrationHarness();
    fixture.register([createDescriptor(true)]);
    expect(fixture.session.selectedExportName).toBe('SelectedPage');
    expect(fixture.appliedCandidateIds).toEqual([['active-leaf']]);
    expect(fixture.session.selectedTreeNodeId).toBeUndefined();
    expect(fixture.resetCount()).toBe(1);
  });

  it('preserves the manually selected named export in ordinary current-file mode', () => {
    const fixture = createRegistrationHarness('Sibling');
    fixture.register([createDescriptor(false, 'SharedProvider')]);
    expect(fixture.session.selectedExportName).toBe('Sibling');
    expect(fixture.session.selectedTreeNodeId).toBe('previous-node');
    expect(fixture.resetCount()).toBe(0);
  });

  it('reconciles a replaced route target while retaining condition choices and learning', () => {
    const fixture = createRegistrationHarness();
    fixture.register([createDescriptor(true)]);
    fixture.register([createDescriptor(true, 'OtherPage')]);
    expect(fixture.session.selectedExportName).toBe('OtherPage');
    expect(fixture.session.conditionOverrides).toBe(fixture.conditionOverrides);
    expect(fixture.session.conditionOverrides.get('manual-condition')).toBe(true);
    expect(fixture.session.learnedState).toBe(fixture.learnedState);
    expect(fixture.session.learnedState.verifiedUpdates).toBe(7);
  });
});
