/** Exact authored sites survive rewrites and direct the selected same-component branch. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  createPreviewJsxOccurrenceId,
  readPreviewJsxPathOccurrenceIds,
  readPreviewJsxPathOccurrences,
  supportsPreviewJsxPathOccurrenceProof,
} from '../../../../src/adapters/esbuild/previewJsxOccurrenceIdentity';
import { createPreviewSelectedJsxOccurrences } from '../../../../src/adapters/esbuild/staticResources/previewSelectedJsxOccurrences';
import {
  readPreviewEarlyReturnBranchRoles,
  registerPreviewSelectedTargetNames,
} from '../../../../src/adapters/esbuild/staticResources/previewSelectedTargetExit';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

const FILE = '/workspace/Recommend.tsx';
const SOURCE =
  'export function Flow({ first, second }) { if (first) return <Loading message="first"/>; if (second) return <Loading message="second"/>; return <main/>; }';

/** Measures one exact authored opening, accepting either graph tag or parent-slice offsets. */
function prepare(
  source = SOURCE,
  offset = source.lastIndexOf('<Loading'),
): ReturnType<typeof createPreviewSelectedJsxOccurrences> {
  return createPreviewSelectedJsxOccurrences(new Map([[FILE, [offset]]]), FILE, source);
}

describe('selected JSX occurrence annotations', () => {
  it('preserves the dedicated imported-return lane without new JSX overrides', () => {
    const renderPath = {
      steps: [
        {
          sourcePath: '/workspace/Loading.tsx',
          occurrenceStart: 41,
          invocation: { mode: 'imported-return', sourcePath: FILE },
        },
        { sourcePath: FILE, occurrenceStart: 99 },
      ],
    };
    expect(supportsPreviewJsxPathOccurrenceProof(renderPath)).toBe(false);
    expect(
      readPreviewJsxPathOccurrences({ edges: [{ occurrenceId: 'old-edge' }], renderPath }),
    ).toEqual({ ids: [], suspenseFallbackIds: [] });
    const plan = createPreviewSelectedJsxOccurrences(
      new Map([[FILE, [SOURCE.lastIndexOf('<Loading')]]]),
      FILE,
      SOURCE,
      false,
    );
    expect(plan.names).toEqual(new Set(['Loading']));
    expect(plan.apply(SOURCE)).toBe(SOURCE);
  });
  it('distinguishes two early returns of the same imported component', () => {
    const plan = prepare();
    const annotated = plan.apply(SOURCE);
    const file = ts.createSourceFile(
      FILE,
      annotated,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    registerPreviewSelectedTargetNames(file, plan.names);
    const guards: ts.IfStatement[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIfStatement(node)) guards.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(guards.map((guard) => readPreviewEarlyReturnBranchRoles(guard, 'truthy'))).toEqual([
      { continuesPastExit: true, fallbackBranch: 'truthy', targetBranch: 'falsy' },
      { continuesPastExit: false, fallbackBranch: 'falsy', targetBranch: 'truthy' },
    ]);
    expect(annotated.match(/__reactPreviewInspectorOccurrence=/gu)).toHaveLength(1);
    expect(SOURCE).not.toContain('__reactPreviewInspectorOccurrence');
    const instrumented = instrumentReactConditionalRendering(
      FILE,
      annotated,
      undefined,
      plan.names,
    );
    expect(instrumented.match(/"targetBranchEvidence":"selected-target"/gu)).toHaveLength(2);
  });

  it('keeps the original identity after non-JSX compatibility rewrites move offsets', () => {
    const plan = prepare();
    const rewritten =
      '// generated compatibility\n' + SOURCE.replace('first)', 'first !== undefined)');
    expect(plan.apply(rewritten)).toContain(
      createPreviewJsxOccurrenceId(FILE, SOURCE.lastIndexOf('<Loading')),
    );
    expect(prepare(SOURCE, SOURCE.lastIndexOf('<Loading') + 1).apply(SOURCE)).toBe(
      plan.apply(SOURCE),
    );
  });

  it('fails closed when compatibility changes the JSX sequence', () => {
    const rewritten = SOURCE.replace('<main/>', '<aside><main/></aside>');
    expect(prepare().apply(rewritten)).toBe(rewritten);
  });

  it('retains original identities when an annotated export slice moves source offsets', () => {
    const annotated = prepare().apply(SOURCE);
    const slice = 'import { Loading } from "./Loading";\n' + annotated;
    const plannedSlice = prepare(slice, 0);
    expect(plannedSlice.names).toEqual(new Set(['Loading']));
    expect(plannedSlice.apply(slice)).toBe(slice);
  });

  it('guides exact selected logical and ternary branches', () => {
    const source =
      'export function Page({ phase, busy }) { return <>{phase === "start" && <Loading message="start"/>}{phase === "finish" && (busy ? <Loading message="finish"/> : <p>Done</p>)}</>; }';
    const plan = prepare(source);
    const result = instrumentReactConditionalRendering(
      FILE,
      plan.apply(source),
      undefined,
      plan.names,
    );
    expect(result.match(/"targetBranchEvidence":"selected-target"/gu)).toHaveLength(2);
    expect(result).toContain('"scalarExpression"');
  });

  it('keeps path proof when fast planning omits reverse usage edges', () => {
    const ids = readPreviewJsxPathOccurrenceIds({
      edges: [],
      rootStepIndex: 1,
      renderPath: {
        steps: [
          {
            sourcePath: '/workspace/Loading.tsx',
            occurrenceStart: 41,
            invocation: { mode: 'jsx', sourcePath: FILE },
          },
          { sourcePath: FILE, occurrenceStart: 99 },
        ],
      },
    });
    expect(ids).toEqual([createPreviewJsxOccurrenceId(FILE, 40)]);
  });

  it('retains the exact JSX fallback slot separately from normal component children', () => {
    const sites = readPreviewJsxPathOccurrences({
      edges: [],
      rootStepIndex: 1,
      renderPath: {
        steps: [
          {
            sourcePath: '/workspace/Loading.tsx',
            occurrenceStart: 41,
            invocation: { mode: 'component-prop', slotName: 'fallback', sourcePath: FILE },
          },
          { sourcePath: FILE, occurrenceStart: 99 },
        ],
      },
    });
    expect(sites).toEqual({
      ids: [createPreviewJsxOccurrenceId(FILE, 40)],
      suspenseFallbackIds: [createPreviewJsxOccurrenceId(FILE, 40)],
    });
  });
});
