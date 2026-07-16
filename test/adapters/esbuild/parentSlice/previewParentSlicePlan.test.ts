/** Verifies bounded same-file owner climbing without importing or executing a parent component. */
import { describe, expect, it } from 'vitest';
import {
  analyzePreviewParentSlices,
  createPreviewParentSlicePlan,
} from '../../../../src/adapters/esbuild/parentSlice';

const CONSUMER_PATH = '/workspace/application/src/Owner.tsx';
const TARGET_PATH = '/workspace/application/src/TargetRow.tsx';

describe('createPreviewParentSlicePlan', () => {
  /** Appends a private body's structural wrapper and stops before a dynamic project Form. */
  it('climbs a local body while preserving the imported-wrapper safety barrier', () => {
    const sourceText = [
      "import { TargetRow } from './TargetRow';",
      "import { Table } from './Table';",
      "import { Form } from './Form';",
      'const Body = () => <Table variant="grid"><tbody><TargetRow /></tbody></Table>;',
      'export const Owner = ({ values }) => (',
      '  <Form initialValues={values}>',
      '    {() => <main data-owner="true"><Body /></main>}',
      '  </Form>',
      ');',
    ].join('\n');
    const directSlice = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText,
      targetExportNames: ['TargetRow'],
      targetPath: TARGET_PATH,
    }).slices[0];
    if (directSlice === undefined) {
      throw new Error('The direct target slice fixture was not discovered.');
    }

    const plan = createPreviewParentSlicePlan({ directSlice, sourceText });

    expect(plan.complete).toBe(false);
    expect(plan.localOwnerDepth).toBe(1);
    expect(plan.ownerExportNames).toEqual(['Owner']);
    expect(plan.frames).toEqual([
      { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'tbody' },
      {
        childMode: 'children',
        importReference: {
          consumerSourcePath: CONSUMER_PATH,
          exportName: 'Table',
          moduleSpecifier: './Table',
        },
        kind: 'imported',
        props: { variant: 'grid' },
      },
      {
        childMode: 'children',
        kind: 'intrinsic',
        props: { 'data-owner': 'true' },
        tagName: 'main',
      },
    ]);
  });

  /** Terminates self-referential local JSX without duplicating frames indefinitely. */
  it('stops a recursive owner cycle at the fixed visited-name boundary', () => {
    const sourceText = [
      "import TargetRow from './TargetRow';",
      'const RecursiveBody = () => (',
      '  <section><TargetRow /><RecursiveBody /></section>',
      ');',
    ].join('\n');
    const directSlice = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText,
      targetExportNames: ['default'],
      targetPath: TARGET_PATH,
    }).slices[0];
    if (directSlice === undefined) {
      throw new Error('The recursive target slice fixture was not discovered.');
    }

    const plan = createPreviewParentSlicePlan({ directSlice, sourceText });

    expect(plan.localOwnerDepth).toBe(1);
    expect(plan.frames).toHaveLength(2);
  });
});
