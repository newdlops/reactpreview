/** Covers collections behavior for reactExportPropInference. */
/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';

import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
  /** Keeps a reducer item contract and its enclosing object available to direct page fallbacks. */
  it('infers the current item parameter of a collection reducer', () => {
    const result = collectReactExportPropInference(
      '/workspace/company-ir-closing-feed.tsx',
      [
        'export function CompanyIrClosingFeed({ object }) {',
        '  const { totalCommittedInvestments } = object;',
        '  const total = totalCommittedInvestments.reduce((sum, investment) => {',
        '    return sum + Number(investment.investmentAmount);',
        '  }, 0);',
        '  return <span>{total}</span>;',
        '}',
      ].join('\n'),
    );

    expect(result.CompanyIrClosingFeed?.shape.properties?.object).toEqual({
      kind: 'object',
      properties: {
        totalCommittedInvestments: {
          items: {
            kind: 'object',
            properties: {
              investmentAmount: { kind: 'number', value: 0 },
            },
          },
          kind: 'array',
        },
      },
    });
  });

  /** Uses an authored primitive fallback to avoid generating an object as visible React text. */
  it('infers a scalar from a logical fallback rendered in JSX', () => {
    const result = collectReactExportPropInference(
      '/workspace/ai-recommend-notice.tsx',
      [
        'export function AiRecommendNotice({ reason }) {',
        '  if (!reason) return null;',
        '  return <span>{reason || "No reason available"}</span>;',
        '}',
      ].join('\n'),
    );

    expect(result.AiRecommendNotice?.shape.properties?.reason).toEqual({
      kind: 'string',
      value: 'No reason available',
    });
  });

  /** An empty-array nullish default is structural evidence, even before a deferred modal maps it. */
  it('keeps a nullish empty-array fallback array-shaped through a local row helper', () => {
    const result = collectReactExportPropInference(
      '/workspace/InfoMappingCard.tsx',
      [
        'type Investor = { stakeholderId: string; name: string };',
        'type File = { documentId: number; investors?: Investor[] | null };',
        'const getRowStatus = (file: File) => (file.investors ?? []).length === 0;',
        'export function InfoMappingCard({ files }: { files: File[] }) {',
        '  return files.map((file) => <button key={file.documentId}>{getRowStatus(file) ? "Edit" : "Done"}</button>);',
        '}',
      ].join('\n'),
    );

    expect(result.InfoMappingCard?.shape.properties?.files?.items?.properties?.investors).toEqual({
      kind: 'array',
    });
  });

  /** Retains the carrier identity so the later map callback can describe generated item fields. */
  it('infers item fields through a nullish empty-array alias', () => {
    const result = collectReactExportPropInference(
      '/workspace/DocumentInfoModal.tsx',
      [
        'export function DocumentInfoModal({ file }) {',
        '  const initialInvestors = file.investors ?? [];',
        '  return initialInvestors.map((investor) => (',
        '    <span key={investor.stakeholderId}>{investor.name}</span>',
        '  ));',
        '}',
      ].join('\n'),
    );

    expect(result.DocumentInfoModal?.shape.properties?.file).toEqual({
      kind: 'object',
      properties: {
        investors: {
          items: {
            kind: 'object',
            properties: {
              name: { kind: 'string', value: 'Name' },
              stakeholderId: { kind: 'string', value: 'preview-id' },
            },
          },
          kind: 'array',
        },
      },
    });
  });

  /** Keeps a semantically named scalar as the receiver of the ubiquitous toString method. */
  it('infers an id receiver through toString without inventing a callable object', () => {
    const result = collectReactExportPropInference(
      '/workspace/Issue.jsx',
      'export function Issue({ issue }) { return <a href={`/issues/${issue.id}`}>{issue.id.toString()}</a>; }',
    );

    expect(result.Issue?.shape.properties?.issue).toEqual({
      kind: 'object',
      properties: { id: { kind: 'string', value: 'preview-id' } },
    });
  });

  /** Preserves a semantic root scalar when a component forwards it unchanged to a JSX prop. */
  it('infers a numeric index forwarded directly to a drag-and-drop child', () => {
    const result = collectReactExportPropInference(
      '/workspace/Issue.jsx',
      'export function Issue({ index }) { return <Draggable index={index} />; }',
    );

    expect(result.Issue?.shape.properties?.index).toEqual({ kind: 'number', value: 0 });
  });

  /** Recovers the collection contract hidden behind Jira's same-file option/render helpers. */
  it('infers prop collection items forwarded unchanged into local helpers', () => {
    const source = [
      'const userOptions = project => project.users.map(user => ({ value: user.id, label: user.name }));',
      'const renderUser = project => userId => {',
      '  const user = project.users.find(({ id }) => id === userId);',
      '  return <div><img src={user.avatarUrl} />{user.name}</div>;',
      '};',
      'export default function IssueCreate({ project }) {',
      '  return <Select options={userOptions(project)} renderValue={renderUser(project)} />;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/IssueCreate/index.jsx', source);

    expect(result.default?.shape.properties?.project).toEqual({
      kind: 'object',
      properties: {
        users: {
          items: {
            kind: 'object',
            properties: {
              id: { kind: 'string', value: 'preview-id' },
              name: { kind: 'string', value: 'Name' },
            },
          },
          kind: 'array',
        },
      },
    });
  });

  it('infers a nested prop collection forwarded into a same-file helper', () => {
    const source = [
      'type Issue =',
      '  | { id: string; listPosition: number; status: "BACKLOG"; title: string }',
      '  | { id: string; listPosition: number; status: "OPEN"; title: string };',
      'const sortedIssues = (issues: Issue[]) => issues.filter(issue => issue.status === "OPEN")',
      '  .sort((left, right) => left.listPosition - right.listPosition);',
      'export function List({ project }: { project: { issues: Issue[] } }) {',
      '  return sortedIssues(project.issues).map(issue => <span key={issue.id}>{issue.title}</span>);',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/List.jsx', source);

    expect(result.List?.shape.properties?.project).toMatchObject({
      kind: 'object',
      properties: {
        issues: {
          kind: 'array',
          items: {
            kind: 'object',
            properties: {
              status: { exactValue: true, kind: 'string', value: 'OPEN' },
            },
          },
        },
      },
    });
  });

  /** Array binding is direct iterable evidence even when the local helper has no usable type. */
  it('infers an untyped prop collection destructured inside a local helper', () => {
    const source = [
      'const firstDocumentId = row => {',
      '  const [documentId] = row.documentIds;',
      '  return documentId;',
      '};',
      'export function DocumentModal({ modals }) {',
      '  return <span>{firstDocumentId(modals.documentInfoTarget)}</span>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/DocumentModal.jsx', source);

    expect(
      result.DocumentModal?.shape.properties?.modals?.properties?.documentInfoTarget?.properties
        ?.documentIds,
    ).toEqual({ kind: 'array' });
  });

  /** A required helper parameter contract supplies exact nested collection and item shapes. */
  it('carries typed local helper collection contracts back to the prop argument', () => {
    const source = [
      'import type { Row } from "./rows";',
      'const toDocumentInfoFile = (row: Row | null) => {',
      '  if (row == null) return null;',
      '  const [documentId] = row.documentIds;',
      '  return {',
      '    documentId,',
      '    fileName: row.files[0]?.name ?? "",',
      '    investors: row.investors,',
      '  };',
      '};',
      'export function DocumentModal({ modals }) {',
      '  const file = toDocumentInfoFile(modals.documentInfoTarget);',
      '  return file == null ? null : <span>{file.fileName}</span>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/DocumentModal.tsx', source, {
      resolveImport: () => ({
        sourcePath: '/workspace/rows.ts',
        sourceText: [
          'export type Row = {',
          '  documentIds: number[];',
          '  files: { name: string }[];',
          '  investors: { stakeholderId: string; name: string }[];',
          '};',
        ].join('\n'),
      }),
    });
    const target =
      result.DocumentModal?.shape.properties?.modals?.properties?.documentInfoTarget?.properties;

    expect(target?.documentIds).toEqual({ kind: 'array', items: { kind: 'number' } });
    expect(target?.files).toEqual({
      kind: 'array',
      items: { kind: 'object', properties: { name: { kind: 'string' } } },
    });
    expect(target?.investors).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        properties: {
          name: { kind: 'string' },
          stakeholderId: { kind: 'string' },
        },
      },
    });
  });

  it('uses a literal sort-helper key as an item requirement', () => {
    const source = [
      `import { sortByNewest } from './utils';`,
      'export function Search({ project }) {',
      '  return sortByNewest(project.issues, "createdAt").slice(0, 3).length;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Search.jsx', source);

    expect(result.Search?.shape.properties?.project).toMatchObject({
      properties: {
        issues: {
          items: {
            properties: {
              createdAt: {
                kind: 'string',
                value: '2026-01-15T09:00:00.000Z',
              },
            },
          },
          kind: 'array',
        },
      },
    });
  });

  /** Carries a type-proven list element contract so automatic props can exercise a pill branch. */
  it('infers a nullable typed collection with its one inert item structure', () => {
    const source = [
      'interface Pill { id: string; label: string; }',
      'type Props = { pills: Pill[] | undefined };',
      'export function PillList({ pills }: Props) {',
      '  return <div>{pills?.map((pill) => <span key={pill.id}>{pill.label}</span>)}</div>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/PillList.tsx', source);

    expect(result.PillList?.shape.properties?.pills).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        properties: {
          id: { kind: 'string' },
          label: { kind: 'string' },
        },
      },
    });
    expect(result.PillList?.provenance).toContainEqual({
      kind: 'object',
      path: 'pills.[]',
      source: 'type',
    });
  });

  /** Resolves a local imported/re-exported item interface without executing a module. */
  it('resolves a re-exported typed collection item through the bounded parse-only reader', () => {
    const sources = new Map([
      ['/workspace/types.ts', 'export interface Item { id: string; label: string; }'],
      ['/workspace/barrel.ts', "export { Item } from './types';"],
    ]);
    const result = collectReactExportPropInference(
      '/workspace/List.tsx',
      "import type { Item } from './barrel'; export function List({ items }: { items: Item[] | undefined }) { return <>{items?.map((item) => item.label)}</>; }",
      {
        resolveImport: (specifier) => {
          const sourcePath =
            specifier === './barrel'
              ? '/workspace/barrel.ts'
              : specifier === './types'
                ? '/workspace/types.ts'
                : undefined;
          const sourceText = sourcePath === undefined ? undefined : sources.get(sourcePath);
          return sourcePath === undefined || sourceText === undefined
            ? undefined
            : { sourcePath, sourceText };
        },
      },
    );
    expect(result.List?.shape.properties?.items?.items).toEqual({
      kind: 'object',
      properties: { id: { kind: 'string' }, label: { kind: 'string' } },
    });
  });
});
