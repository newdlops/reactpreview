/** Verifies bounded, syntax-only JSX branch extraction for pinpoint parent preview wrappers. */
import { describe, expect, it } from 'vitest';
import {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
} from '../../../../src/adapters/esbuild/parentSlice';

const CONSUMER_PATH = '/workspace/application/src/OwnerPage.tsx';
const TARGET_PATH = '/workspace/application/src/TargetRow.tsx';

describe('analyzePreviewParentSlices', () => {
  /** Retains an attribute-free target and only its exact inner-to-outer JSX ancestor branch. */
  it('extracts no-prop target usages, primitive wrapper props, and render children', () => {
    const analysis = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText: [
        "import { TargetRow as Row } from './TargetRow';",
        "import { Form as ProjectForm } from './Form';",
        "import { ModalBody } from '@ui/modal';",
        'export const OwnerPage = () => (',
        '  <ProjectForm mode="edit">',
        '    {() => (',
        '      <ModalBody compact>',
        '        <table data-count={2} ignored={{ runtime: true }}>',
        '          <tbody><Row /></tbody>',
        '        </table>',
        '      </ModalBody>',
        '    )}',
        '  </ProjectForm>',
        ');',
      ].join('\n'),
      targetExportNames: ['TargetRow'],
      targetPath: TARGET_PATH,
    });

    expect(analysis.status).toBe('ok');
    expect(analysis.limitReached).toBe(false);
    expect(analysis.slices).toHaveLength(1);
    expect(analysis.slices[0]).toMatchObject({
      complete: true,
      owner: { exportNames: ['OwnerPage'], localName: 'OwnerPage' },
      targetExportName: 'TargetRow',
      targetLocalName: 'Row',
      targetProps: {},
    });
    expect(analysis.slices[0]?.frames).toEqual([
      { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'tbody' },
      {
        childMode: 'children',
        kind: 'intrinsic',
        props: { 'data-count': 2 },
        tagName: 'table',
      },
      {
        childMode: 'children',
        importReference: {
          consumerSourcePath: CONSUMER_PATH,
          exportName: 'ModalBody',
          moduleSpecifier: '@ui/modal',
        },
        kind: 'imported',
        props: { compact: true },
      },
      {
        childMode: 'render-function',
        importReference: {
          consumerSourcePath: CONSUMER_PATH,
          exportName: 'Form',
          moduleSpecifier: './Form',
        },
        kind: 'imported',
        props: { mode: 'edit' },
      },
    ]);
  });

  /** Stops before an imported component whose dynamic props cannot be reproduced faithfully. */
  it('treats dynamic imported-wrapper attributes as an incomplete hard barrier', () => {
    const analysis = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText: [
        "import TargetRow from './TargetRow';",
        "import Form from './Form';",
        'export function OwnerPage({ values }) {',
        '  return (',
        '    <Form initialValues={values}>',
        '      <section onClick={() => undefined}><TargetRow label="static" /></section>',
        '    </Form>',
        '  );',
        '}',
      ].join('\n'),
      targetExportNames: ['default'],
      targetPath: TARGET_PATH,
    });

    expect(analysis.slices).toHaveLength(1);
    expect(analysis.slices[0]).toMatchObject({
      complete: false,
      targetExportName: 'default',
      targetProps: { label: 'static' },
    });
    expect(analysis.slices[0]?.frames).toEqual([
      { childMode: 'children', kind: 'intrinsic', props: {}, tagName: 'section' },
    ]);
  });

  /** Ignores similarly named imports and namespace members outside the selected export allowlist. */
  it('matches only the exact target import and selected namespace export', () => {
    const analysis = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText: [
        "import * as TargetModule from './TargetRow';",
        "import { TargetRow } from './Other';",
        'export const OwnerPage = () => (',
        '  <><TargetRow /><TargetModule.Other /><TargetModule.TargetRow count={-3} /></>',
        ');',
      ].join('\n'),
      targetExportNames: ['TargetRow'],
      targetPath: TARGET_PATH,
    });

    expect(analysis.slices).toHaveLength(1);
    expect(analysis.slices[0]).toMatchObject({
      targetExportName: 'TargetRow',
      targetLocalName: 'TargetModule',
      targetProps: { count: -3 },
    });
  });
});

describe('analyzePreviewLocalParentSlices', () => {
  /** Continues through a same-file body use until it reaches the enclosing dynamic Form barrier. */
  it('finds the local owner usage above a direct imported leaf slice', () => {
    const sourceText = [
      "import { TargetRow } from './TargetRow';",
      "import { Form } from './Form';",
      'const Body = () => <table><tbody><TargetRow /></tbody></table>;',
      'export const OwnerPage = ({ values }) => (',
      '  <Form initialValues={values}>',
      '    {() => <main data-page="owner"><Body /></main>}',
      '  </Form>',
      ');',
    ].join('\n');
    const directAnalysis = analyzePreviewParentSlices({
      consumerPath: CONSUMER_PATH,
      sourceText,
      targetExportNames: ['TargetRow'],
      targetPath: TARGET_PATH,
    });
    expect(directAnalysis.slices[0]?.owner).toEqual({ exportNames: [], localName: 'Body' });

    const localAnalysis = analyzePreviewLocalParentSlices({
      consumerPath: CONSUMER_PATH,
      localComponentName: 'Body',
      sourceText,
    });

    expect(localAnalysis.slices).toHaveLength(1);
    expect(localAnalysis.slices[0]).toMatchObject({
      complete: false,
      owner: { exportNames: ['OwnerPage'], localName: 'OwnerPage' },
      targetLocalName: 'Body',
      targetProps: {},
    });
    expect(localAnalysis.slices[0]?.frames).toEqual([
      {
        childMode: 'children',
        kind: 'intrinsic',
        props: { 'data-page': 'owner' },
        tagName: 'main',
      },
    ]);
  });
});
