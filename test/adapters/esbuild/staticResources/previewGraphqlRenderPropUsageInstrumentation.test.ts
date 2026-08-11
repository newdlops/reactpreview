import { describe, expect, it } from 'vitest';
import { createPreviewGraphqlRenderPropUsageReplacements } from '../../../../src/adapters/esbuild/staticResources/previewGraphqlRenderPropUsageInstrumentation';

describe('preview GraphQL render-prop usage instrumentation', () => {
  it('associates a fixed query renderer factory with its exact document', () => {
    const source = [
      'import { createContextFixedQueryRendererAndHook as createFixed } from "common/ui/graphql/query-renderer/context/query-renderer-context";',
      'import { QUERY } from "./queries";',
      'export const [FixedQueryRenderer, useFixedQuery] = createFixed(QUERY);',
    ].join('\n');

    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/context.ts',
      source,
      new Map(),
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('registerGraphqlFixedRenderer');
    expect(replacements[0]?.replacement).toContain('createFixed(previewDocument)');
    expect(replacements[0]?.replacement).toContain('})(QUERY)');
  });

  it('forwards a fixed query renderer collection callback to its registered document', () => {
    const source = [
      'import { EditPersonalDataHandlersModalFormQueryRenderer } from "./context";',
      '<EditPersonalDataHandlersModalFormQueryRenderer>',
      '  {({ data: { vcUserRelations } }) => (',
      '    <Form ids={vcUserRelations.filter(({ isPersonalDataHandler }) => isPersonalDataHandler).map(({ id }) => id)} />',
      '  )}',
      '</EditPersonalDataHandlersModalFormQueryRenderer>;',
    ].join('\n');

    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/edit-personal-data-handlers-modal-form.tsx',
      source,
      new Map(),
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('registerGraphqlFixedRendererUsage');
    expect(replacements[0]?.replacement).toContain(
      'EditPersonalDataHandlersModalFormQueryRenderer',
    );
    expect(replacements[0]?.replacement).toContain('"data.vcUserRelations.[]"');
  });

  it('does not treat an unrelated same-named local helper as a fixed query factory', () => {
    const source = [
      'const createContextFixedQueryRendererAndHook = (value) => value;',
      'const result = createContextFixedQueryRendererAndHook(QUERY);',
    ].join('\n');

    expect(
      createPreviewGraphqlRenderPropUsageReplacements('/workspace/context.ts', source, new Map()),
    ).toEqual([]);
  });

  it('tags objectList column method renderers and retains an exact child status demand', () => {
    const source = [
      'const QUERY = {};',
      '<Query query={QUERY}>{({ data: { employmentDocumentList: { objectList } } }) => (',
      '  <LegacyListTable objectList={objectList} columns={[{',
      '    render({ status }) { return <EmploymentStatus status={status} />; },',
      '  }]} />',
      ')}</Query>;',
    ].join('\n');
    const catalog = new Map([
      [
        'EmploymentStatus',
        new Map([
          [
            'status',
            {
              exactValue: true as const,
              kind: 'string' as const,
              value: 'requested',
            },
          ],
        ]),
      ],
    ]);

    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/Page.tsx',
      source,
      catalog,
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('"@connection.objectList.[]"');
    expect(replacements[0]?.replacement).toContain('"@connection.objectList.[].status"');
    expect(replacements[0]?.replacement).toContain('"requested"');
  });

  it('tags a LegacyListTable object wrapper renderer without an imported child contract', () => {
    const source = [
      'const QUERY = {};',
      '<Query query={QUERY}>{({ objectList }) => (',
      '  <LegacyListTable objectList={objectList} columns={[{',
      '    render({ object: { title } }) { return <>{title}</>; },',
      '  }]} />',
      ')}</Query>;',
    ].join('\n');

    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      '/workspace/employee-stock-guide-list-table.tsx',
      source,
      new Map(),
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('"@connection.objectList.[]"');
  });

  it('does not infer a collection demand from unrelated config methods', () => {
    const source = [
      'const QUERY = {};',
      '<Query query={QUERY}>{({ data: { employmentDocumentList: { objectList } } }) => (',
      '  <LegacyListTable objectList={objectList} columns={[{ format(value) { return value; } }]} />',
      ')}</Query>;',
    ].join('\n');

    expect(
      createPreviewGraphqlRenderPropUsageReplacements('/workspace/Page.tsx', source, new Map()),
    ).toEqual([]);
  });
});
