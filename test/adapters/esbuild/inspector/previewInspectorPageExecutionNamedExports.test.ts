/** Keeps named-export ownership identical across executable narrowing and Page Execution source. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorExecutablePlan,
  createPreviewInspectorExecutionRootModuleContract,
  createPreviewInspectorPageExecutionCandidates,
  createPreviewInspectorPageExecutionSource,
  createPreviewInspectorTargetModuleContract,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorComponentReference,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';

const SOURCE_PATH = '/workspace/components/Cards.tsx';
const PAGE_PATH = '/workspace/pages/Dashboard.tsx';
const PRIMARY = { exportName: 'PrimaryCard', sourcePath: SOURCE_PATH };
const SECONDARY = { exportName: 'SecondaryCard', sourcePath: SOURCE_PATH };
const TARGET_SOURCE =
  'export function PrimaryCard() { return null; } export function SecondaryCard() { return null; }';
const PAGE_SOURCE = 'export function Dashboard() { return null; }';

/** Supplies two independent exports from one prepared module and their authored page paths. */
function createPlan(
  selectedTarget: PreviewInspectorComponentReference = SECONDARY,
  analyzedSelectedExport = true,
): PreviewInspectorAncestorPlan {
  const root = { exportName: 'Dashboard', sourcePath: PAGE_PATH };
  const chain = (
    target: PreviewInspectorComponentReference,
  ): PreviewInspectorAncestorPlan['renderChain'] => ({
    dependencyPaths: [SOURCE_PATH, PAGE_PATH],
    paths: [],
    reachability: 'entry-connected',
    target,
    truncated: false,
  });
  const candidate = (
    id: string,
    target: PreviewInspectorComponentReference,
  ): PreviewInspectorPageCandidate => ({
    complete: true,
    dependencyPaths: [SOURCE_PATH, PAGE_PATH],
    edges: [],
    id,
    root,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    stopReason: 'root-reached',
    target,
    targetAutomaticProps: {},
  });
  const first = candidate('primary', PRIMARY);
  return {
    ...first,
    pageCandidates: [first, candidate('secondary', selectedTarget)],
    renderChain: chain(PRIMARY),
    renderChainsByExport: {
      [PRIMARY.exportName]: chain(PRIMARY),
      ...(analyzedSelectedExport ? { [selectedTarget.exportName]: chain(selectedTarget) } : {}),
    },
    target: PRIMARY,
  };
}

describe('Page Execution named-export target identity', () => {
  it('loads the selected same-file export through its exact facade and prepared contract', () => {
    const plan = createPlan();
    const executable = createPreviewInspectorExecutablePlan(plan, 'secondary');
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'secondary',
    });
    const candidate = candidates.find((value) => value.fidelity === 'page-authentic');
    if (candidate === undefined) throw new Error('Expected an authored page candidate.');
    const emit = (): string =>
      createPreviewInspectorPageExecutionSource({
        candidate,
        executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
          ...candidate.executionRootContract,
          preparedSourceText:
            candidate.executionRootContract.sourcePath === SOURCE_PATH
              ? TARGET_SOURCE
              : PAGE_SOURCE,
        }),
        target: executable.target,
        targetModuleContract: createPreviewInspectorTargetModuleContract({
          preparedSourceText: TARGET_SOURCE,
          selectedExportNames: [PRIMARY.exportName, SECONDARY.exportName],
          sourcePath: SOURCE_PATH,
        }),
      });
    expect(emit).not.toThrow();
    expect(emit()).toContain('from "react-preview:inspector-target-facade"');
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.every((value) => value.runtimeTargetContract.exportName === SECONDARY.exportName),
    ).toBe(true);
    expect(
      candidates.every(
        (value) => value.browserCandidate.target?.exportName === executable.target.exportName,
      ),
    ).toBe(true);
    expect(plan.target).toEqual(PRIMARY);
  });

  it('keeps the active document when an alternate names another source module', () => {
    const plan = createPlan({ exportName: 'OtherCard', sourcePath: '/workspace/Other.tsx' });
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'secondary',
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.every(
        (value) =>
          value.runtimeTargetContract.sourcePath === SOURCE_PATH &&
          value.runtimeTargetContract.exportName === PRIMARY.exportName,
      ),
    ).toBe(true);
  });

  it('keeps the primary export when the alternate has no analyzed render chain', () => {
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan: createPlan(SECONDARY, false),
      selectedPageCandidateId: 'secondary',
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.every((value) => value.runtimeTargetContract.exportName === PRIMARY.exportName),
    ).toBe(true);
  });

  it('uses the primary current-file target when a persisted path no longer exists', () => {
    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan: createPlan(),
      selectedPageCandidateId: 'removed',
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.every((value) => value.runtimeTargetContract.exportName === PRIMARY.exportName),
    ).toBe(true);
  });
});
