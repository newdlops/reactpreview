/** Verifies bounded cross-module reverse JSX climbing without importing or executing owners. */
import { describe, expect, it } from 'vitest';
import {
  analyzePreviewParentSlices,
  climbPreviewParentSliceProject,
  createPreviewParentSlicePlan,
} from '../../../../src/adapters/esbuild/parentSlice';

const TARGET_PATH = '/workspace/application/src/Target.tsx';
const CHILD_PATH = '/workspace/application/src/Child.tsx';
const PAGE_PATH = '/workspace/application/src/Page.tsx';

describe('climbPreviewParentSliceProject', () => {
  /** Appends only the target-bearing branch from an exported parent and records hot-reload inputs. */
  it('follows an exported owner into its importing page without retaining siblings', async () => {
    const childSource = [
      "import { Target } from './Target';",
      'export const Child = () => <section data-child><Target /></section>;',
    ].join('\n');
    const pageSource = [
      "import { Child } from './Child';",
      'export function Page() {',
      '  return <main><header>before</header><Child /><footer>after</footer></main>;',
      '}',
    ].join('\n');
    const directSlice = analyzePreviewParentSlices({
      consumerPath: CHILD_PATH,
      sourceText: childSource,
      targetExportNames: ['Target'],
      targetPath: TARGET_PATH,
    }).slices[0];
    if (directSlice === undefined) {
      throw new Error('The direct target slice fixture was not discovered.');
    }

    const plan = await climbPreviewParentSliceProject({
      initialPlan: createPreviewParentSlicePlan({ directSlice, sourceText: childSource }),
      readSource: (sourcePath) =>
        Promise.resolve(
          sourcePath === CHILD_PATH
            ? childSource
            : sourcePath === PAGE_PATH
              ? pageSource
              : undefined,
        ),
      sourcePaths: [CHILD_PATH, PAGE_PATH],
    });

    expect(plan).toMatchObject({
      complete: true,
      dependencyPaths: [CHILD_PATH, PAGE_PATH],
      localOwnerDepth: 0,
      ownerExportNames: ['Page'],
      projectOwnerDepth: 1,
      sourcePath: PAGE_PATH,
    });
    expect(plan.frames).toEqual([
      {
        childMode: 'children',
        kind: 'intrinsic',
        props: { 'data-child': true },
        tagName: 'section',
      },
      { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'main' },
    ]);
  });

  /** Preserves the proven direct branch when no importing owner exists in the package inventory. */
  it('returns a safe partial frontier when the exported owner has no project consumer', async () => {
    const childSource = [
      "import { Target } from './Target';",
      'export const Child = () => <div><Target /></div>;',
    ].join('\n');
    const directSlice = analyzePreviewParentSlices({
      consumerPath: CHILD_PATH,
      sourceText: childSource,
      targetExportNames: ['Target'],
      targetPath: TARGET_PATH,
    }).slices[0];
    if (directSlice === undefined) {
      throw new Error('The direct target slice fixture was not discovered.');
    }

    const plan = await climbPreviewParentSliceProject({
      initialPlan: createPreviewParentSlicePlan({ directSlice, sourceText: childSource }),
      readSource: () => Promise.resolve(undefined),
      sourcePaths: [CHILD_PATH],
    });

    expect(plan.projectOwnerDepth).toBe(0);
    expect(plan.frames).toEqual([
      { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'div' },
    ]);
  });
});
