import { describe, expect, it } from 'vitest';
import { createPreviewGraphqlRenderPropUsageReplacements } from '../../../../src/adapters/esbuild/staticResources/previewGraphqlRenderPropUsageInstrumentation';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';

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

  it('maps a LegacyListTable object wrapper child demand onto the collection item', () => {
    const source = [
      'const QUERY = {};',
      '<Query query={QUERY}>{({ objectList }) => (',
      '  <LegacyListTable objectList={objectList} columns={[{',
      '    render({ object }) {',
      '      return <EmploymentStatus status={object.status} />;',
      '    },',
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
      '/workspace/portal-employment-document-request-list-table.tsx',
      source,
      catalog,
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain(
      '"@connection.objectList.[].status","value":"requested"',
    );
    expect(replacements[0]?.replacement).not.toContain('"@connection.objectList.[].object.status"');
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

  it('carries a target discriminator through a GraphQL fragment-unmasking child chain', () => {
    const pagePath = '/workspace/PaymentPage.tsx';
    const modalPath = '/workspace/DetailsModal.tsx';
    const tablePath = '/workspace/TaxAndFeeTables.tsx';
    const badgePath = '/workspace/TaxTypeBadge.tsx';
    const pageSource = [
      `import { DetailsModal } from './DetailsModal';`,
      'const QUERY = {};',
      '<QueryRenderer query={QUERY}>',
      '  {({ data: { registrationFee } }) => (',
      '    <DetailsModal meetingRegistrationFee={registrationFee} />',
      '  )}',
      '</QueryRenderer>;',
    ].join('\n');
    const modalSource = [
      `import { TaxAndFeeTables } from './TaxAndFeeTables';`,
      'export function DetailsModal({ meetingRegistrationFee }) {',
      '  return <TaxAndFeeTables meetingRegistrationFee={meetingRegistrationFee} />;',
      '}',
    ].join('\n');
    const tableSource = [
      `import { getFragmentData } from '../graphql-codegen/fragment-masking';`,
      `import { TaxTypeBadge } from './TaxTypeBadge';`,
      'const FRAGMENT = {};',
      'export function TaxAndFeeTables({ meetingRegistrationFee: fragment }) {',
      '  const registrationFee = getFragmentData(FRAGMENT, fragment);',
      '  return registrationFee.feesByAgenda.map((agenda) =>',
      '    agenda.feesByRegistry.map((fee) => <TaxTypeBadge taxType={fee.taxType} />)',
      '  );',
      '}',
    ].join('\n');
    const badgeSource = [
      'export function TaxTypeBadge({ taxType }) {',
      '  if (taxType === "heavy_tax") return <span>heavy</span>;',
      '  throw new Error("Unreachable");',
      '}',
    ].join('\n');
    const sources = new Map([
      [modalPath, modalSource],
      [tablePath, tableSource],
      [badgePath, badgeSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) => {
        if (consumerPath === pagePath && moduleSpecifier === './DetailsModal') return modalPath;
        if (consumerPath === modalPath && moduleSpecifier === './TaxAndFeeTables') return tablePath;
        if (consumerPath === tablePath && moduleSpecifier === './TaxTypeBadge') return badgePath;
        return undefined;
      },
      workspaceRoot: '/workspace',
    });

    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      pagePath,
      pageSource,
      builder.collect(pagePath, pageSource, { includeOptionalTypes: true }),
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('"data.registrationFee.feesByAgenda.[]"');
    expect(replacements[0]?.replacement).toContain(
      '"data.registrationFee.feesByAgenda.[].feesByRegistry.[]"',
    );
    expect(replacements[0]?.replacement).toContain(
      '"data.registrationFee.feesByAgenda.[].feesByRegistry.[].taxType","value":"heavy_tax"',
    );
  });

  it('carries a filtered table row discriminator from a styled child into GraphQL data', () => {
    const pagePath = '/workspace/DirectorPage.tsx';
    const panelPath = '/workspace/DirectorCompensationChangeLogPanel.tsx';
    const pageSource = [
      `import { DirectorCompensationChangeLogPanel } from './DirectorCompensationChangeLogPanel';`,
      'const QUERY = {};',
      '<QueryRenderer query={QUERY}>',
      '  {({ data: { director } }) => (',
      '    <div>',
      ...Array.from({ length: 32 }, (_, index) => `    <Irrelevant${index} />`),
      '    <DirectorCompensationChangeLogPanel events={director.userActivities as any} />',
      '    </div>',
      '  )}',
      '</QueryRenderer>;',
    ].join('\n');
    const panelSource = [
      'export const DirectorCompensationChangeLogPanel = styled(',
      '  ({ events }) => {',
      '    const [targetEvents, setTargetEvents] = useState([]);',
      '    useEffect(() => {',
      '      setTargetEvents(events.filter(',
      '        ({ eventType }) => eventType === "directorcompensationdecisionevent",',
      '      ));',
      '    }, [events]);',
      '    if (!targetEvents.length) return <></>;',
      '    return <AgDataTable dataList={targetEvents} />;',
      '  },',
      ')``;',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === panelPath ? panelSource : undefined),
      resolveModule: (moduleSpecifier, consumerPath) =>
        consumerPath === pagePath && moduleSpecifier === './DirectorCompensationChangeLogPanel'
          ? panelPath
          : undefined,
      workspaceRoot: '/workspace',
    });

    const catalog = builder.collect(pagePath, pageSource, { includeOptionalTypes: true });
    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      pagePath,
      pageSource,
      catalog,
    );

    expect(catalog.get('DirectorCompensationChangeLogPanel')?.get('events')).toMatchObject({
      items: {
        properties: {
          eventType: {
            exactValue: true,
            kind: 'string',
            value: 'directorcompensationdecisionevent',
          },
        },
      },
      kind: 'array',
    });
    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('"data.director.userActivities.[]"');
    expect(replacements[0]?.replacement).toContain(
      '"data.director.userActivities.[].eventType","value":"directorcompensationdecisionevent"',
    );
  });

  /** Preserves every positive row-renderer branch instead of collapsing the table to one case. */
  it('carries branch-diverse dataList column values into GraphQL row demand', () => {
    const pagePath = '/workspace/DirectorPage.tsx';
    const panelPath = '/workspace/DirectorChangeLogPanel.tsx';
    const pageSource = [
      `import { DirectorChangeLogPanel } from './DirectorChangeLogPanel';`,
      'const QUERY = {};',
      '<QueryRenderer query={QUERY}>',
      '  {({ data: { director } }) => (',
      '    <DirectorChangeLogPanel events={director.userActivities} />',
      '  )}',
      '</QueryRenderer>;',
    ].join('\n');
    const panelSource = [
      'type Props = { events: { eventType: string; date: string }[] };',
      'export const DirectorChangeLogPanel = styled(({ events }: Props) => (',
      '  <AgDataTable',
      '    dataList={events}',
      '    columns={[{',
      '      key: "date",',
      '      body: ({ data }) => <>',
      '        {data.eventType === "appointed" && <span>appointed</span>}',
      '        {data.eventType === "ended" && <span>ended</span>}',
      '        {data.eventType === "co-ceo" && <span>co-ceo</span>}',
      '      </>,',
      '    }]}',
      '  />',
      '))``;',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === panelPath ? panelSource : undefined),
      resolveModule: (moduleSpecifier, consumerPath) =>
        consumerPath === pagePath && moduleSpecifier === './DirectorChangeLogPanel'
          ? panelPath
          : undefined,
      workspaceRoot: '/workspace',
    });

    const catalog = builder.collect(pagePath, pageSource, { includeOptionalTypes: true });
    const replacements = createPreviewGraphqlRenderPropUsageReplacements(
      pagePath,
      pageSource,
      catalog,
    );

    expect(catalog.get('DirectorChangeLogPanel')?.get('events')).toMatchObject({
      items: {
        properties: {
          eventType: {
            candidateValues: ['appointed', 'ended', 'co-ceo'],
          },
        },
      },
      renderedCollection: true,
    });
    expect(replacements).toHaveLength(1);
    for (const value of ['appointed', 'ended', 'co-ceo']) {
      expect(replacements[0]?.replacement).toContain(
        `"data.director.userActivities.[].eventType","value":"${value}"`,
      );
    }
  });
});
