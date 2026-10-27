/** Checks fidelity-group selection and real validation when a deferred recovery path is selected. */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import {
  preparePreviewInspectorPageExecutionSelection,
  type PreparePreviewInspectorPageExecutionSelectionOptions,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorPageFrontier';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

const ROOT = '/workspace';
const TARGET = `${ROOT}/Target.tsx`;
const PAGE = `${ROOT}/Page.tsx`;
const ALTERNATIVE = `${ROOT}/Alternative.tsx`;

/** Creates exact authored surfaces while keeping test identities independent from discovery order. */
function candidate(
  id: string,
  sourcePath: string,
  fidelity: PreviewInspectorPageExecutionCandidate['fidelity'],
): PreviewInspectorPageExecutionCandidate {
  return {
    browserCandidate: { id: 'selected' },
    compositionEdges: [],
    evidenceSourcePaths: [],
    criticalSurfaces: [sourcePath, TARGET].map((source, index) => ({
      bypassedWrapperNames: [],
      exportName: index === 0 ? 'Page' : 'Target',
      id: `${id}-${index.toString()}`,
      omittedTopLevelEffectCount: 0,
      sourcePath: source,
      strategy: 'authentic-module-export',
      watchSourcePaths: [source],
    })),
    fidelity,
    id,
    optionalSurfaces: [],
    watchSourcePaths: [sourcePath, TARGET],
  } as unknown as PreviewInspectorPageExecutionCandidate;
}

/** Supplies the real bounded frontier reader over a small immutable authored graph. */
function options(
  candidates: readonly PreviewInspectorPageExecutionCandidate[],
  sources: Map<string, string>,
): PreparePreviewInspectorPageExecutionSelectionOptions & {
  readonly readSource: Mock<(sourcePath: string) => Promise<string | undefined>>;
} {
  const policy = createPreviewCompilerFrontierPolicy('fast');
  if (policy === undefined) throw new Error('Expected fast frontier policy');
  return {
    candidates,
    plan: {
      edges: [],
      pageCandidates: [],
      root: { sourcePath: PAGE, exportName: 'Page' },
      target: { sourcePath: TARGET, exportName: 'Target' },
    } as never,
    policy,
    readSource: vi.fn((sourcePath: string) => Promise.resolve(sources.get(sourcePath))),
    resolveModule: (specifier: string) =>
      specifier === './Target' ? TARGET : specifier === './value' ? `${ROOT}/value.ts` : undefined,
    workspaceRoot: ROOT,
  };
}

describe('deferred Page Execution alternatives', () => {
  it('retains a lower-fidelity choice without reading it, then validates it on explicit selection', async () => {
    const primary = candidate('primary', PAGE, 'page-authentic');
    const alternative = candidate('alternative', ALTERNATIVE, 'page-sliced');
    const sources = new Map([
      [PAGE, "import { Target } from './Target'; export const Page = () => <Target />;"],
      [TARGET, 'export const Target = () => <main />;'],
    ]);
    const initialOptions = options([alternative, primary], sources);
    const initial = await preparePreviewInspectorPageExecutionSelection(initialOptions);
    expect(initial?.kind).toBe('selected');
    if (initial?.kind !== 'selected') throw new Error('Expected selected primary');
    expect(initial.executionPlan.candidate.id).toBe('primary');
    expect(initial.executionPlan.alternatives).toContainEqual({
      candidateId: 'alternative',
      fidelity: 'page-sliced',
      reason: 'deferred-until-selected',
    });
    expect(initialOptions.readSource.mock.calls.flat()).not.toContain(ALTERNATIVE);
    const missing = await preparePreviewInspectorPageExecutionSelection(
      options([alternative], sources),
    );
    expect(missing).toMatchObject({ kind: 'rejected', prepared: { rejected: true } });
    sources.set(
      ALTERNATIVE,
      "import { Target } from './Target'; export const Page = () => <section><Target /></section>;",
    );
    const selectedOptions = options([alternative], sources);
    const selected = await preparePreviewInspectorPageExecutionSelection(selectedOptions);
    expect(selected).toMatchObject({
      kind: 'selected',
      executionPlan: { candidate: { id: 'alternative' } },
    });
    expect(selectedOptions.readSource.mock.calls.flat()).toContain(ALTERNATIVE);
  });

  it('finishes every tied fidelity candidate before selecting the smaller authored graph', async () => {
    const large = candidate('a-large', PAGE, 'page-authentic');
    const small = candidate('z-small', ALTERNATIVE, 'page-authentic');
    const sources = new Map([
      [
        PAGE,
        "import { Target } from './Target'; import { value } from './value'; export const Page = () => <Target data-value={value} />;",
      ],
      [ALTERNATIVE, "import { Target } from './Target'; export const Page = () => <Target />;"],
      [TARGET, 'export const Target = () => <main />;'],
      [`${ROOT}/value.ts`, 'export const value = 42;'],
    ]);
    for (const candidates of [
      [large, small],
      [small, large],
    ]) {
      const inputs = options(candidates, sources);
      const selected = await preparePreviewInspectorPageExecutionSelection(inputs);
      expect(selected).toMatchObject({
        kind: 'selected',
        executionPlan: { candidate: { id: 'z-small' } },
      });
      expect(inputs.readSource.mock.calls.flat()).toContain(PAGE);
      expect(inputs.readSource.mock.calls.flat()).toContain(ALTERNATIVE);
    }
  });
});
