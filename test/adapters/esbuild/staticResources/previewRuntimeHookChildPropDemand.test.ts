/** Verifies bounded child-prop demand propagation without importing or executing project modules. */
import { describe, expect, it } from 'vitest';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('PreviewRuntimeHookChildPropDemandCatalogBuilder', () => {
  /** Carries a styled imported feed contract back into an ordinary directly previewed export. */
  it('completes identity-forwarded props used by an imported styled component', () => {
    const parentPath = '/workspace/CompanyIrClosingFeed.tsx';
    const childPath = '/workspace/CompanyFeedBase.tsx';
    const parentSource = [
      `import { CompanyFeedBase } from './CompanyFeedBase';`,
      'export const CompanyIrClosingFeed = ({ object }: any) => {',
      '  const { company, ir: irInfo } = object;',
      '  return <CompanyFeedBase company={company} irInfo={irInfo} />;',
      '};',
    ].join('\n');
    const childSource = [
      `import styled from 'styled-components';`,
      'type Props = {',
      '  company: { id: string; name: string; profileLogo: { url: string } | null };',
      '  irInfo: { uuid: string } | null;',
      '};',
      'export const CompanyFeedBase = styled(({ company, irInfo }: Props) => {',
      '  const { id, name, profileLogo } = company;',
      '  return <main data-id={id} data-logo={profileLogo?.url}>{name}{irInfo?.uuid}</main>;',
      '})``;',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './CompanyFeedBase' ? childPath : undefined,
      workspaceRoot: '/workspace',
    });

    const result = collectReactExportPropInference(parentPath, parentSource, {
      childPropDemands: builder.collect(parentPath, parentSource),
    });

    expect(result.CompanyIrClosingFeed?.shape.properties?.object).toMatchObject({
      properties: {
        company: {
          properties: {
            id: { kind: 'string' },
            name: { kind: 'string' },
          },
        },
        ir: {
          properties: { uuid: { kind: 'string' } },
        },
      },
    });
  });

  /** Expands an imported Pick contract before forwarding a literal collection item. */
  it('materializes a typed meeting title item selected by zero index', () => {
    const parentPath = '/workspace/MeetingTitle.tsx';
    const childPath = '/workspace/ShareholdersMeetingTitle.tsx';
    const typePath = '/workspace/meeting-types.ts';
    const parentSource = [
      `import { ShareholdersMeetingTitle } from './ShareholdersMeetingTitle';`,
      'type Props = { meeting: { shareholdersMeetings: unknown[] } };',
      'export function MeetingTitle({ meeting }: Props) {',
      '  return meeting.shareholdersMeetings.length > 0',
      '    ? <ShareholdersMeetingTitle shareholdersMeeting={meeting.shareholdersMeetings[0]} />',
      '    : null;',
      '}',
    ].join('\n');
    const childSource = [
      `import type { ShareholdersMeeting } from './meeting-types';`,
      'type Props = {',
      '  shareholdersMeeting: Pick<ShareholdersMeeting, "meetingDate" | "meetingType">;',
      '};',
      'export function ShareholdersMeetingTitle({ shareholdersMeeting }: Props) {',
      '  return <span>{shareholdersMeeting.meetingDate}{shareholdersMeeting.meetingType}</span>;',
      '}',
    ].join('\n');
    const typeSource = [
      'export type ShareholdersMeeting = {',
      '  id: string;',
      '  meetingDate: string;',
      '  meetingType: "regular_meeting" | "special_meeting";',
      '};',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) =>
        sourcePath === childPath ? childSource : sourcePath === typePath ? typeSource : undefined,
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './ShareholdersMeetingTitle'
          ? childPath
          : moduleSpecifier === './meeting-types'
            ? typePath
            : undefined,
      workspaceRoot: '/workspace',
    });

    const result = collectReactExportPropInference(parentPath, parentSource, {
      childPropDemands: builder.collect(parentPath, parentSource),
    });

    expect(result.MeetingTitle?.shape.properties?.meeting).toMatchObject({
      properties: {
        shareholdersMeetings: {
          kind: 'array',
          items: {
            properties: {
              meetingDate: { kind: 'string', value: '2024-01-01T00:00:00.000Z' },
              meetingType: { kind: 'string', value: 'regular_meeting', exactValue: true },
            },
          },
        },
      },
    });
  });

  /** Carries an operation-proven child Array back through a hook-fed JSX carrier property. */
  it('completes a nested query response used by an imported child component', () => {
    const parentPath = '/workspace/HistoryPage.tsx';
    const childPath = '/workspace/HistoryTable.tsx';
    const parentSource = [
      `import { useQuery } from '@tanstack/react-query';`,
      `import { HistoryTable } from './HistoryTable';`,
      'export function HistoryPage() {',
      '  const { data } = useQuery({ queryKey: ["rides"] });',
      '  return data && <HistoryTable data={data.data} />;',
      '}',
    ].join('\n');
    const childSource = [
      'interface HistoryTableProps { data: ImportedResponse }',
      'export function HistoryTable(props: HistoryTableProps) {',
      '  const { data } = props;',
      '  return <main>{data.rides.map((ride) => <span key={ride.id}>{ride.name}</span>)}</main>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './HistoryTable' ? childPath : undefined,
      workspaceRoot: '/workspace',
    });
    const replacements = createPreviewRuntimeHookReplacements(
      parentPath,
      parentSource,
      builder.collect(parentPath, parentSource),
    );
    const transformed = applyReplacements(parentSource, replacements);

    expect(transformed).toContain('"rides": ((__createPreviewItem)');
    expect(transformed).toContain('react-file-preview.generated-list-runtime');
    expect(transformed).toContain('Object.freeze({ "id": "preview-id", "name": "name" })');
    expect(transformed).toContain(
      '"requiredPaths":["data.data","data.data.rides.map()","data.data.rides[].id","data.data.rides[].name"]',
    );
  });

  /**
   * An optional prop becomes required for preview shape inference when authored JSX supplies it.
   * This models an edit page forwarding a restored form state into a child with a default value.
   */
  it('completes an explicitly supplied optional child prop from a hook result', () => {
    const parentPath = '/workspace/MeetingEditPage.tsx';
    const childPath = '/workspace/MeetingForm.tsx';
    const parentSource = [
      `import { useMeetingRestore } from './use-meeting-restore';`,
      `import { MeetingForm } from './MeetingForm';`,
      'type MeetingEditFormState = { formikValues: { step: number; agendaSelection: string[] } };',
      'export function MeetingEditPage() {',
      '  const { state } = useMeetingRestore();',
      '  return <MeetingForm initialState={state as MeetingEditFormState} />;',
      '}',
    ].join('\n');
    const childSource = [
      'type MeetingEditFormState = { formikValues: { step: number; agendaSelection: string[] } };',
      'type Props = { initialState?: MeetingEditFormState };',
      'export function MeetingForm({ initialState }: Props) {',
      '  return <main>{initialState.formikValues.step > initialState.formikValues.agendaSelection.length}</main>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './MeetingForm' ? childPath : undefined,
      workspaceRoot: '/workspace',
    });

    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource, { includeOptionalTypes: true }),
      ),
    );

    expect(transformed).toContain('"state": Object.freeze({ "formikValues": Object.freeze({');
    expect(transformed).toContain('"step": 1');
    expect(transformed).toContain('state.formikValues.step');
    expect(transformed).toContain('state.formikValues.agendaSelection');
  });

  /** Preserves shallow form containers even when an earlier nested contract exceeds the cap. */
  it('retains later shallow containers ahead of a wide optional branch', () => {
    const parentPath = '/workspace/MeetingEditPage.tsx';
    const childPath = '/workspace/MeetingForm.tsx';
    const wideAgendaFields = Array.from(
      { length: 40 },
      (_, index) => `field${index.toString()}: string;`,
    ).join(' ');
    const parentSource = [
      `import { useMeetingRestore } from './use-meeting-restore';`,
      `import { MeetingForm } from './MeetingForm';`,
      'export function MeetingEditPage() {',
      '  const { state } = useMeetingRestore();',
      '  return <MeetingForm initialState={state} />;',
      '}',
    ].join('\n');
    const childSource = [
      `type Props = { initialState?: { formikValues: { agenda: { ${wideAgendaFields} }; meetingSchedules: string[] } } };`,
      'export function MeetingForm({ initialState }: Props) {',
      '  return <main>{Object.entries(initialState.formikValues.agenda).length + Object.entries(initialState.formikValues.meetingSchedules).length}</main>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './MeetingForm' ? childPath : undefined,
      workspaceRoot: '/workspace',
    });

    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource, { includeOptionalTypes: true }),
      ),
    );

    expect(transformed).toContain('"agenda": Object.freeze({');
    expect(transformed).toContain('"meetingSchedules": ((__createPreviewItem)');
    expect(transformed).toContain('state.formikValues.meetingSchedules.map()');
  });

  /** Carries a leaf collection contract through a routed page and an intermediate child. */
  it('propagates imported child demands transitively through a render-prop boundary', () => {
    const parentPath = '/workspace/Project.tsx';
    const boardPath = '/workspace/Board.tsx';
    const listPath = '/workspace/List.tsx';
    const parentSource = [
      `import useApi from './api';`,
      `import Board from './Board';`,
      'export default function Project() {',
      "  const [{ data }] = useApi.get('/project');",
      '  const { project } = data;',
      '  return <Route render={() => <Board project={project} />} />;',
      '}',
    ].join('\n');
    const boardSource = [
      `import List from './List';`,
      'export default function Board({ project }) {',
      '  return <List project={project} />;',
      '}',
    ].join('\n');
    const listSource = [
      'export default function List({ project }) {',
      '  return project.issues.map((issue) => <span key={issue.id}>{issue.title}</span>);',
      '}',
    ].join('\n');
    const sources = new Map([
      [boardPath, boardSource],
      [listPath, listSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) => {
        if (consumerPath === parentPath && moduleSpecifier === './Board') return boardPath;
        if (consumerPath === boardPath && moduleSpecifier === './List') return listPath;
        return undefined;
      },
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    );

    expect(transformed).toContain('"issues": ((__createPreviewItem)');
    expect(transformed).toContain('react-file-preview.generated-list-runtime');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"title": "title"');
    expect(transformed).toContain('data.project.issues[].title');
  });

  /** Merges complementary row contracts when sibling children consume the same hook collection. */
  it('retains exact discriminators from a later child collection consumer', () => {
    const parentPath = '/workspace/Project.tsx';
    const recentPath = '/workspace/RecentIssues.tsx';
    const boardPath = '/workspace/Board.tsx';
    const parentSource = [
      `import useApi from './api';`,
      `import RecentIssues from './RecentIssues';`,
      `import Board from './Board';`,
      'export default function Project() {',
      "  const [{ data }] = useApi.get('/project');",
      '  return <><RecentIssues project={data.project} /><Board project={data.project} /></>;',
      '}',
    ].join('\n');
    const recentSource = [
      'export default function RecentIssues({ project }) {',
      '  return project.issues.map((issue) => <time>{issue.createdAt}</time>);',
      '}',
    ].join('\n');
    const boardSource = [
      'const StatusCopy = { backlog: "Backlog", done: "Done" };',
      'export default function Board({ project }) {',
      '  return project.issues.map((issue) => (',
      '    <article key={issue.id}>{StatusCopy[issue.status]} {issue.title}</article>',
      '  ));',
      '}',
    ].join('\n');
    const sources = new Map([
      [recentPath, recentSource],
      [boardPath, boardSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './RecentIssues'
          ? recentPath
          : moduleSpecifier === './Board'
            ? boardPath
            : undefined,
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    );

    expect(transformed).toContain('Object.freeze(Object.assign({}, Object.freeze({ "createdAt":');
    expect(transformed).toContain('Object.freeze({ "id": "preview-id", "status": "backlog"');
    expect(transformed).toContain('data.project.issues[].createdAt');
    expect(transformed).toContain('data.project.issues[].status');
  });

  /** Leaves authored optional carrier chains untouched because they intentionally short-circuit. */
  it('does not turn an optional JSX carrier into a hard hook requirement', () => {
    const parentPath = '/workspace/HistoryPage.tsx';
    const childPath = '/workspace/HistoryTable.tsx';
    const parentSource = [
      `import { useQuery } from './use-query';`,
      `import { HistoryTable } from './HistoryTable';`,
      'export function HistoryPage() {',
      '  const query = useQuery();',
      '  return <HistoryTable data={query.data?.data} />;',
      '}',
    ].join('\n');
    const childSource = [
      'export function HistoryTable({ data }: { data: unknown }) {',
      '  return <main>{data.rides.map((ride) => ride.id)}</main>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: () => childSource,
      resolveModule: () => childPath,
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    );

    expect(transformed).not.toContain('data.data.rides.map()');
  });

  /**
   * Resolves an imported nested collection type and carries it through a filtering JSX carrier.
   *
   * This models an application shell whose navigation hook is generated in the parent while the
   * reached child is the first module that proves which page fields are required to render.
   */
  it('propagates transitive imported item fields through identity-preserving collection transforms', () => {
    const parentPath = '/workspace/Navigation.tsx';
    const childPath = '/workspace/NavigationCategories.tsx';
    const typesPath = '/workspace/navigation-types.ts';
    const parentSource = [
      `import { useNavigationData } from './use-navigation-data';`,
      `import { NavigationCategories } from './NavigationCategories';`,
      'export function Navigation() {',
      '  const categories = useNavigationData();',
      '  return <NavigationCategories categories={categories.filter(Boolean)} />;',
      '}',
    ].join('\n');
    const childSource = [
      `import type { Category } from './navigation-types';`,
      'type Props = { categories: readonly Category[] };',
      'export const NavigationCategories = ({ categories }: Props) => (',
      '  <nav>{categories.map((category) => <span key={category.name}>{category.name}</span>)}</nav>',
      ');',
    ].join('\n');
    const typesSource = [
      'export type Page = { label: string; pageNameOrUrl: string; activeRoutes?: readonly (RegExp | string)[] };',
      'export type PageGroup = { label?: string; pages: readonly Page[] };',
      'export type Category = { name: string; icon: string; pageGroups: readonly PageGroup[] };',
    ].join('\n');
    const sources = new Map([
      [childPath, childSource],
      [typesPath, typesSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) => {
        if (consumerPath === parentPath && moduleSpecifier === './NavigationCategories')
          return childPath;
        if (consumerPath === childPath && moduleSpecifier === './navigation-types')
          return typesPath;
        return undefined;
      },
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    );

    expect(transformed).toContain('"pageNameOrUrl": "https://example.invalid/"');
    expect(transformed).toContain('"pageGroups": ((__createPreviewItem)');
    expect(transformed).toContain('"pages": ((__createPreviewItem)');
    expect(transformed).toContain('[].pageGroups[].pages[].pageNameOrUrl');
  });

  /**
   * Expands an imported array item annotation when the selected query value first reaches a pure
   * helper rather than a JSX child.
   */
  it('propagates an imported typed collection contract into a hook fallback', () => {
    const parentPath = '/workspace/Panel.tsx';
    const typesPath = '/workspace/types.ts';
    const parentSource = [
      `import { useQuery } from './use-query';`,
      `import { buildRows } from './build-rows';`,
      `import type { Item } from './types';`,
      'export function Panel() {',
      '  const { data } = useQuery();',
      '  const items = (data?.items ?? []) as Item[];',
      '  const rows = buildRows(items);',
      '  return <main>{rows.length}</main>;',
      '}',
    ].join('\n');
    const typesSource = [
      'export type Child = { id: string; label: string };',
      'export type Item = { id: string; name: string; children: Child[] };',
    ].join('\n');
    const sources = new Map([
      [parentPath, parentSource],
      [typesPath, typesSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) =>
        consumerPath === parentPath && moduleSpecifier === './types' ? typesPath : undefined,
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
        (typeNode) => builder.inferLocalTypeFallback(parentPath, parentSource, typeNode),
      ),
    );

    expect(transformed).toContain('"items": ((__createPreviewItem)');
    expect(transformed).toContain('"children": ((__createPreviewItem)');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"label": "label"');
    expect(transformed).toContain('"failurePaths":["data.items[]"');
    expect(transformed).toContain('data.items[].children[].label');
  });

  /** Preserves an imported helper Array contract for a direct nested query-field argument. */
  it('propagates a directly forwarded query collection through an imported helper', () => {
    const parentPath = '/workspace/FeedList.tsx';
    const helperPath = '/workspace/filter-feeds.ts';
    const typesPath = '/workspace/feed-types.ts';
    const parentSource = [
      `import { useQuery } from './use-query';`,
      `import { filterFeeds } from './filter-feeds';`,
      'export function FeedList() {',
      '  const { data, loading } = useQuery();',
      '  if (loading || !data) return null;',
      '  const feeds = filterFeeds(data.companyFeeds, []);',
      '  return <main>{feeds.length}</main>;',
      '}',
    ].join('\n');
    const helperSource = [
      `import type { Feed } from './feed-types';`,
      'export function filterFeeds<T extends Feed>(feeds: readonly T[], selected: string[]): T[] {',
      '  if (selected.length === 0) return [...feeds];',
      '  return feeds.filter((feed) => feed.ir.round === selected[0]);',
      '}',
    ].join('\n');
    const typesSource = [
      `// ${'generated '.repeat(64 * 1024)}`,
      'type FeedBase = {',
      '  __typename: "ClosingFeed";',
      '  id: string;',
      '  company: { id: string; name: string };',
      '  desiredInvestmentAmountCategory: string;',
      '  desiredInvestmentAmount: string;',
      '  totalCommittedInvestments: Array<{ investmentAmount: string }>;',
      '};',
      'export type Feed = FeedBase & {',
      '  ir: { round: string };',
      '};',
    ].join('\n');
    const sources = new Map([
      [parentPath, parentSource],
      [helperPath, helperSource],
      [typesPath, typesSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) => {
        if (consumerPath === parentPath && moduleSpecifier === './filter-feeds') return helperPath;
        if (consumerPath === helperPath && moduleSpecifier === './feed-types') return typesPath;
        return undefined;
      },
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
        (typeNode) => builder.inferLocalTypeFallback(parentPath, parentSource, typeNode),
        builder.inferImportedHelperArrayItemFallback.bind(builder, parentPath, parentSource),
      ),
    );

    expect(transformed).toContain('"companyFeeds": ((__createPreviewItem)');
    expect(transformed).toContain('"__typename": "ClosingFeed"');
    expect(transformed).toContain(
      '"company": Object.freeze({ "id": "preview-id", "name": "name" })',
    );
    expect(transformed).toContain('"desiredInvestmentAmountCategory": "min"');
    expect(transformed).toContain('"desiredInvestmentAmount": "100000000"');
    expect(transformed).toContain('"investmentAmount": "100000000"');
    expect(transformed).toContain('data.companyFeeds[].ir.round');
  });

  /** Infers nested collection demand from an untyped imported helper's whole object parameter. */
  it('resolves an imported helper parameter consumed below a Context form value', () => {
    const parentPath = '/workspace/IaEmailPreviewSection.tsx';
    const helperPath = '/workspace/email-utils.ts';
    const parentSource = [
      `import { getSelectedPartners } from './email-utils';`,
      'export const PreviewSection = ({ formikProps }) => {',
      '  const selectedPartners = getSelectedPartners(formikProps.values);',
      '  return <main>{selectedPartners.length}</main>;',
      '};',
    ].join('\n');
    const helperSource = [
      'export const getSelectedPartners = (values) =>',
      '  values.recipients.filter(({ selected }) => selected);',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === helperPath ? helperSource : undefined),
      resolveModule: (moduleSpecifier, consumerPath) =>
        consumerPath === parentPath && moduleSpecifier === './email-utils' ? helperPath : undefined,
      workspaceRoot: '/workspace',
    });

    const fallback = builder.inferImportedHelperParameterFallback(
      parentPath,
      parentSource,
      'getSelectedPartners',
      0,
    );

    expect(fallback).toMatchObject({
      kind: 'object',
      requiredPaths: ['recipients.map()'],
    });
    expect(fallback?.nestedUsages).toEqual([
      {
        called: false,
        collectionProperty: 'map',
        names: ['recipients'],
      },
    ]);
  });

  /** Keeps an untyped helper's directly rendered collection item scalar across the import edge. */
  it('propagates a rendered scalar collection through an imported helper', () => {
    const parentPath = '/workspace/MeetingFormSteps.tsx';
    const helperPath = '/workspace/create-agenda-steps.tsx';
    const parentSource = [
      `import { useMeetingFormContext } from './meeting-form-context';`,
      `import { createAgendaSteps } from './create-agenda-steps';`,
      'export function MeetingFormSteps() {',
      '  const { formikProps } = useMeetingFormContext();',
      '  return <>{createAgendaSteps({ formikProps })}</>;',
      '}',
    ].join('\n');
    const helperSource = [
      'export const createAgendaSteps = ({ formikProps }) => {',
      '  return formikProps.values.agendaSelection.map((agenda) => (',
      '    <section key={agenda}><strong>{agenda}</strong></section>',
      '  ));',
      '};',
    ].join('\n');
    const sources = new Map([
      [parentPath, parentSource],
      [helperPath, helperSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) =>
        consumerPath === parentPath && moduleSpecifier === './create-agenda-steps'
          ? helperPath
          : undefined,
      workspaceRoot: '/workspace',
    });

    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
        (typeNode) => builder.inferLocalTypeFallback(parentPath, parentSource, typeNode),
        builder.inferImportedHelperArrayItemFallback.bind(builder, parentPath, parentSource),
        builder.inferImportedHelperParameterPropertyFallback.bind(
          builder,
          parentPath,
          parentSource,
        ),
      ),
    );

    expect(transformed).toContain('"agendaSelection": ((__createPreviewItem)');
    expect(transformed).toContain('() => ("agenda")');
    expect(transformed).toContain('formikProps.values.agendaSelection[]');
    expect(transformed).not.toContain('Object.freeze({ id: "preview-id", name: "name" })');
  });

  /**
   * Propagates a reached child's dormant overlay contract into its parent hook fallback.
   *
   * Without these scalar leaves the generated object contains `undefined`; inequality checks such
   * as `undefined !== null` then open every sibling modal and obscure the actual page.
   */
  it('keeps non-target child overlays dormant with null and false scalar values', () => {
    const parentPath = '/workspace/ManagementPanel.tsx';
    const childPath = '/workspace/ManagementModals.tsx';
    const parentSource = [
      `import { useAgreementModals } from './useAgreementModals';`,
      `import { ManagementModals } from './ManagementModals';`,
      'export function ManagementPanel() {',
      '  const modals = useAgreementModals();',
      '  const open = modals.requestUpload;',
      '  return <ManagementModals modals={modals} />;',
      '}',
    ].join('\n');
    const childSource = [
      'export function ManagementModals({ modals }: { modals: unknown }) {',
      '  return <>',
      '    <UploadModal show={modals.uploadTarget !== null} />',
      '    <BulkModal show={modals.bulkUploadOpen} />',
      '    <EditModal show={modals.editTarget !== null} />',
      '    <DeleteModal show={modals.deleteTarget !== null} />',
      '  </>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './ManagementModals' ? childPath : undefined,
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    );

    expect(transformed).toContain('"bulkUploadOpen": false');
    expect(transformed).toContain('"deleteTarget": null');
    expect(transformed).toContain('"editTarget": null');
    expect(transformed).toContain('"uploadTarget": null');
    expect(transformed).toContain(
      '"requiredPaths":["requestUpload","bulkUploadOpen","deleteTarget","editTarget","uploadTarget"]',
    );
  });

  /** Keeps a query collection an Array after its loading/error discriminator changes later. */
  it('infers table rows through a conditional collection fallback', () => {
    const source = [
      `import { useRecords } from './use-records';`,
      'export function SummaryTable() {',
      '  const { data, status } = useRecords();',
      '  return <Table',
      '    data={data && status !== "loading" ? (data as Record[]) : []}',
      '    getID={(row) => row.id}',
      '    columns={[{ key: "name" }, { key: "createdAt" }]}',
      '  />;',
      '}',
    ].join('\n');

    const transformed = applyReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/SummaryTable.tsx', source),
    );

    expect(transformed).toContain('"data": ((__createPreviewItem)');
    expect(transformed).toContain('data.[].id');
    expect(transformed).toContain('data.[].name');
    expect(transformed).toContain('data.[].createdAt');
  });
});

/** Applies source-ordered zero-width/range replacements like the shared transformer. */
function applyReplacements(
  source: string,
  replacements: readonly {
    readonly end: number;
    readonly replacement: string;
    readonly start: number;
  }[],
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.replacement +
      transformed.slice(replacement.end);
  }
  return transformed;
}
