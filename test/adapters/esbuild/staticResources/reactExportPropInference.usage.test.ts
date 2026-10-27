/** Covers usage behavior for reactExportPropInference. */
/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';

import {
  collectReactExportPropInference,
  type PreviewChildPropDemandCatalog,
} from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
  /**
   * Generated lists hold three items, so fixed week columns read past the end and rendered NaN
   * (SimSheet `finals[k]` with `k: 0 | 1 | 2 | 3`, `stocks[k]` in `[0, 1, 2, 3, 4].map`).
   */
  it('records how many items bounded index reads reach', () => {
    const source = [
      'type Row = { finals: number[]; stocks: number[]; name: string };',
      'type Props = { rows: Row[]; row: Row; k: 0 | 1 | 2 | 3 };',
      'export const Sheet = ({ rows, row, k }: Props) => (',
      '  <table>',
      '    <tr><td>{row.finals[k]}</td><td>{row.name[0]}</td></tr>',
      '    {rows.map((r) => <tr key={r.name}>{[0, 1, 2, 3, 4].map((i) => <td key={i}>{r.stocks[i]}</td>)}</tr>)}',
      '  </table>',
      ');',
    ].join('\n');

    const shape = collectReactExportPropInference('/workspace/Sheet.tsx', source).Sheet?.shape;

    expect(shape?.properties?.row?.properties?.finals).toMatchObject({
      kind: 'array',
      minItems: 4,
    });
    expect(shape?.properties?.rows?.items?.properties?.stocks).toMatchObject({
      kind: 'array',
      minItems: 5,
    });
    // A literal index may read a string; it never turns a text prop into an Array.
    expect(shape?.properties?.row?.properties?.name?.kind).toBe('string');
  });

  /**
   * A target-only Button rendered an empty placeholder for `children`; a slot the component only
   * renders as direct content gets the component's label, other uses keep the element.
   */
  it('labels a children slot only when it is rendered as direct content', () => {
    const source = [
      `import { Children, cloneElement, type ReactNode } from 'react';`,
      'type Props = { children: ReactNode };',
      'export function SectionTitle({ children }: Props) { return <h2>{children}</h2>; }',
      'export function Item(props: Props) { return <li>{props.children}</li>; }',
      'export function Tabs({ children }: Props) { return <ul>{Children.map(children, (c) => c)}</ul>; }',
      'export function Slot({ children }: Props) { return cloneElement(children as never, {}); }',
      'export function Hint({ children }: Props) { return <i title="x">{children}{String(children)}</i>; }',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/ui.tsx', source);

    expect(result.SectionTitle?.shape.properties?.children).toEqual({
      kind: 'element',
      value: 'Section title',
    });
    expect(result.Item?.shape.properties?.children?.value).toBe('Item');
    expect(result.Tabs?.shape.properties?.children?.value).toBeUndefined();
    expect(result.Slot?.shape.properties?.children?.value).toBeUndefined();
    expect(result.Hint?.shape.properties?.children?.value).toBeUndefined();
  });

  /**
   * SegmentedControl's `${active ? 'bg-brand' : it.dot}` rendered `class="… [object Object]"`:
   * a read used only as template text becomes a string unless other evidence names its kind.
   */
  it('infers template-only reads as text without overriding other evidence', () => {
    const source = [
      'export const Segments = ({ items, active, meta, count, unit }: any) => (',
      '  <div>',
      '    {items.map((it) => (',
      '      <span key={it.value} className={`dot ${active ? "on" : it.dot}`}>{`${it.count}개`}</span>',
      '    ))}',
      '    <b title={"Total " + unit}>{`${count}개`}</b>',
      '    <em>{meta.lead != null ? `${meta.lead}일` : "—"}</em>',
      '    <i>{`${meta.owner.name} ${meta.code ?? ""}`}</i>',
      '    <u>{gql`${meta.fragment}`}</u>',
      '  </div>',
      ');',
    ].join('\n');

    const shape = collectReactExportPropInference('/workspace/Segments.tsx', source).Segments
      ?.shape;

    expect(shape?.properties?.items?.items?.properties?.dot).toEqual({ kind: 'string' });
    // An absent leaf stays absent: its authored `!= null` guard must keep the dash.
    expect(shape?.properties?.unit).toBeUndefined();
    expect(shape?.properties?.meta?.properties?.lead).toBeUndefined();
    expect(shape?.properties?.items?.items?.properties?.count?.kind).toBe('number');
    expect(shape?.properties?.count).toBeUndefined();
    // The authored `?? ""` fallback already supplies this leaf's text.
    expect(shape?.properties?.meta?.properties?.code).toMatchObject({ kind: 'string' });
    expect(shape?.properties?.meta?.properties?.owner?.kind).toBe('object');
    expect(shape?.properties?.meta?.properties?.fragment?.kind).not.toBe('string');
  });

  /**
   * InboundTab's `status: InboundStatus` was dropped, so `STATUS_DOT[r.status]` rendered
   * "undefined": a declared closed literal union keeps its first member and every member as a row
   * candidate; open or mixed unions stay unresolved.
   */
  it('materializes declared literal unions with every member as a candidate', () => {
    const source = [
      "type Status = 'REQUESTED' | 'IN_TRANSIT' | 'DELIVERED';",
      "type Row = { status: Status; size: 1 | 2 | 3; tag: 'a' | string; mixed: 'a' | 1 };",
      "export const Table = ({ rows, mode }: { rows: Row[]; mode: 'list' | 'grid' }) => (",
      '  <ul>{rows.length}{mode}</ul>',
      ');',
    ].join('\n');

    const shape = collectReactExportPropInference('/workspace/Table.tsx', source).Table?.shape;
    const row = shape?.properties?.rows?.items?.properties;

    expect(row?.status).toEqual({
      candidateValues: ['REQUESTED', 'IN_TRANSIT', 'DELIVERED'],
      kind: 'string',
      value: 'REQUESTED',
    });
    expect(row?.size).toEqual({ candidateValues: [1, 2, 3], kind: 'number', value: 1 });
    expect(shape?.properties?.mode).toMatchObject({
      candidateValues: ['list', 'grid'],
      value: 'list',
    });
    expect(row?.tag).toBeUndefined();
    expect(row?.mixed).toBeUndefined();
  });

  /** Only text shown as-is may take a sample label; parsed or interpolated text keeps ''. */
  it('marks text props read directly as React child content', () => {
    const source = [
      'type Props = { title: string; end: string; unit: string };',
      'const display = (value: string) => value.split("-").join(".");',
      'export function Header({ title, end, unit }: Props) {',
      '  return <h1 data-unit={unit}>{title}<small>{display(end)}</small>{`${unit} only`}</h1>;',
      '}',
    ].join('\n');

    const properties = collectReactExportPropInference('/workspace/Header.tsx', source).Header
      ?.shape.properties;

    expect(properties?.title).toEqual({ kind: 'string', renderedText: true });
    expect(properties?.end).toEqual({ kind: 'string' });
    expect(properties?.unit).toEqual({ kind: 'string' });
  });

  /** Carries a reached child's item contract through a literal Array element access. */
  it('infers child props forwarded from the first generated collection item', () => {
    const source = [
      `import { ShareholdersMeetingTitle } from './ShareholdersMeetingTitle';`,
      'type Props = { meeting: { shareholdersMeetings: unknown[] } };',
      'export const MeetingTitle = ({ meeting }: Props) => {',
      '  if (meeting.shareholdersMeetings.length === 0) return null;',
      '  return <ShareholdersMeetingTitle shareholdersMeeting={meeting.shareholdersMeetings[0]} />;',
      '};',
    ].join('\n');
    const childPropDemands: PreviewChildPropDemandCatalog = new Map([
      [
        'ShareholdersMeetingTitle',
        new Map([
          [
            'shareholdersMeeting',
            {
              kind: 'object',
              properties: {
                meetingDate: { kind: 'string', value: '2026-08-12' },
                meetingType: { kind: 'string', value: 'regular' },
              },
            },
          ],
        ]),
      ],
    ]);

    const result = collectReactExportPropInference('/workspace/MeetingTitle.tsx', source, {
      childPropDemands,
    });

    expect(result.MeetingTitle?.shape.properties?.meeting).toMatchObject({
      kind: 'object',
      properties: {
        shareholdersMeetings: {
          kind: 'array',
          items: {
            kind: 'object',
            properties: {
              meetingDate: { kind: 'string', value: '2026-08-12' },
              meetingType: { kind: 'string', value: 'regular' },
            },
          },
        },
      },
    });
    expect(result.MeetingTitle?.provenance).toEqual(
      expect.arrayContaining([
        { kind: 'object', path: 'meeting.shareholdersMeetings.[]', source: 'usage' },
        { kind: 'string', path: 'meeting.shareholdersMeetings.[].meetingDate', source: 'usage' },
      ]),
    );
  });

  /** Reads required props when the component keeps a typed identifier instead of destructuring it. */
  it('infers required local members from identifier props and inherited intersections', () => {
    const source = [
      'interface CommonProps { title: string; }',
      'type CardProps = CommonProps & { count: number; enabled?: boolean };',
      'export function Card(props: CardProps) {',
      '  return <article>{props.title}{props.count}</article>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Card.tsx', source);

    expect(result.Card?.shape).toEqual({
      kind: 'object',
      properties: {
        count: { kind: 'number' },
        title: { kind: 'string', renderedText: true },
      },
    });
  });

  /** Uses a React component variable annotation when its arrow parameter omits an inline type. */
  it('infers props from React FC annotations', () => {
    const source = [
      "import type { FC } from 'react';",
      'interface BannerProps { message: string; visible: boolean; }',
      'export const Banner: FC<BannerProps> = (props) => (',
      '  props.visible ? <strong>{props.message}</strong> : null',
      ');',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Banner.tsx', source);

    expect(result.Banner?.shape.properties).toMatchObject({
      message: { kind: 'string' },
      visible: { kind: 'boolean' },
    });
  });

  /** Distinguishes a JSX component prop from callbacks so its placeholder can return `null`. */
  it('infers required React component constructors used as JSX tags', () => {
    const source = [
      'type HeaderProps = { icon: React.ComponentType<{ size: number }>; title: string };',
      'export const Header = ({ icon: Icon, title }: HeaderProps) => (',
      '  <header><Icon size={20} />{title}</header>',
      ');',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Header.tsx', source);

    expect(result.Header?.shape.properties).toMatchObject({
      icon: { kind: 'component' },
      title: { kind: 'string' },
    });
    expect(result.Header?.provenance).toContainEqual({
      kind: 'component',
      path: 'icon',
      source: 'type',
    });
  });

  /** Restores the implicit props contract used by legacy React and Next custom App classes. */
  it('infers JSX component props read through a class render method', () => {
    const source = [
      "import App from 'next/app';",
      'class MyApp extends App {',
      '  render() {',
      '    const { Component, pageProps } = this.props;',
      '    return <main><Component {...pageProps} /></main>;',
      '  }',
      '}',
      'export default MyApp;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/pages/_app.jsx', source);

    expect(result.default?.shape.properties).toMatchObject({
      Component: { kind: 'component' },
    });
    expect(result.default?.shape.properties).not.toHaveProperty('pageProps');
    expect(result.default?.provenance).toContainEqual({
      kind: 'component',
      path: 'Component',
      source: 'usage',
    });
  });
});
