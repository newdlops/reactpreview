/** Covers boundaries behavior for reactExportPropInference. */
/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';

import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
  /** Leaves defaulted destructured props absent so the component's authored fixture wins. */
  it('does not replace authored parameter defaults with generated values', () => {
    const source = [
      'const DEFAULT_ITEMS = ["authored"];',
      'type PanelProps = { title: string; items: string[] };',
      'export function Panel({ title, items = DEFAULT_ITEMS }: PanelProps) {',
      '  return <section>{title}{items.map(String)}</section>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Panel.tsx', source);

    expect(result.Panel?.shape.properties).toMatchObject({ title: { kind: 'string' } });
    expect(result.Panel?.shape.properties).not.toHaveProperty('items');
  });

  /** Uses required local types for primitives while leaving optional and imported values absent. */
  it('infers neutral local type values and operation-proven arrays', () => {
    const source = [
      'interface CardProps {',
      '  title: string; count: number; ready: boolean; items: unknown[]; optional?: string;',
      '}',
      'export function Card({ title, count, ready, optional, items }: CardProps) {',
      '  return <div>{title}{count}{ready}{optional}{items.map(String)}</div>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Card.tsx', source);

    expect(result.Card?.shape.properties).toMatchObject({
      count: { kind: 'number' },
      items: { kind: 'array' },
      ready: { kind: 'boolean' },
      title: { kind: 'string' },
    });
    expect(result.Card?.shape.properties).not.toHaveProperty('optional');
  });

  /** Shares the conservative String-method classifier used by runtime blocker value repair. */
  it('infers text receivers from String-only prototype methods', () => {
    const source = [
      'export function TemplateLabel({ template, label }: any) {',
      "  const normalized = template.replaceAll('-monorepo', '');",
      '  return <span>{normalized}{label.trimStart()}</span>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/TemplateLabel.tsx', source);

    expect(result.TemplateLabel?.shape.properties).toMatchObject({
      label: { kind: 'string' },
      template: { kind: 'string' },
    });
  });

  /** Preserves optional-chain absence instead of inventing data that changes the rendered branch. */
  it('retains required receivers and syntax-proven optional rendered collection items', () => {
    const source = [
      'export const OptionalCard = ({ field, user }: any) => {',
      '  const label = field.value?.label.trim();',
      '  const names = user?.members.map((member) => member.name);',
      '  return <span>{label}{names}</span>;',
      '};',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/OptionalCard.tsx', source);

    expect(result.OptionalCard?.shape).toEqual({
      kind: 'object',
      properties: {
        field: { kind: 'object', properties: {} },
        user: {
          kind: 'object',
          properties: {
            members: {
              kind: 'array',
              items: {
                kind: 'object',
                properties: { name: { kind: 'string', value: 'Name' } },
              },
            },
          },
        },
      },
    });
    expect(result.OptionalCard?.provenance).toEqual(
      expect.arrayContaining([
        { kind: 'array', path: 'user.members', source: 'usage' },
        { kind: 'string', path: 'user.members.[].name', source: 'usage' },
      ]),
    );
  });

  /** Correlates a direct prop Array with inline table columns and their visible row branches. */
  it('infers branch-diverse rendered collection rows from dataList and columns', () => {
    const source = [
      'type Props = { events: { eventType: string; date: string }[] };',
      'const Panel = styled(({ events }: Props) => (',
      '  <AgDataTable',
      '    dataList={events.filter((event) => event.eventType !== "hidden").map((event, index) => ({ ...event, id: index }))}',
      '    columns={[',
      '      {',
      '        key: "kind",',
      '        body: ({ data }) => <>',
      '          {data.eventType === "appointed" && <span>appointed</span>}',
      '          {data.eventType === "ended" && <span>ended</span>}',
      '          {data.eventType === "co-ceo" && <span>co-ceo</span>}',
      '        </>,',
      '      },',
      '      { key: "date" },',
      '    ]}',
      '  />',
      '))``;',
      'export default Panel;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Panel.tsx', source);

    expect(result.default?.shape.properties?.events).toMatchObject({
      items: {
        properties: {
          date: { kind: 'string', value: '2026-01-15T09:00:00.000Z' },
          eventType: {
            candidateValues: ['appointed', 'ended', 'co-ceo'],
            exactValue: true,
            kind: 'string',
            value: 'appointed',
          },
          kind: { kind: 'string', value: 'Kind' },
        },
      },
      kind: 'array',
      renderedCollection: true,
    });
  });

  /** Retains scalar branch options so an exhaustive runtime guard never receives a field-name placeholder. */
  it('keeps every source-proven scalar equality choice with the first visible branch as default', () => {
    const source = [
      "import styled from 'styled-components';",
      'type Props = { taxType: string };',
      'export const TaxTypeBadge = styled(({ taxType }: Props) => {',
      '  if (taxType === "heavy_tax") return <span>heavy</span>;',
      '  if (taxType === "fixed_tax" || taxType === "normal_tax") return <span>normal</span>;',
      '  if (taxType === "reduced_tax") return <span>reduced</span>;',
      '  if (taxType === "exempted") return <span>exempted</span>;',
      '  if (taxType === "none") return null;',
      '  throw new Error("Unreachable");',
      '})``;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/TaxTypeBadge.tsx', source);

    expect(result.TaxTypeBadge?.shape.properties?.taxType).toEqual({
      candidateValues: ['heavy_tax', 'fixed_tax', 'normal_tax', 'reduced_tax', 'exempted', 'none'],
      exactValue: true,
      kind: 'string',
      value: 'heavy_tax',
    });
  });

  /** Gives exhaustive switch guards the same finite-domain recovery contract as equality branches. */
  it('keeps scalar switch choices even when a broad string type supplied a placeholder', () => {
    const source = [
      'export function StatusBadge({ status }: { status: string }) {',
      '  switch (status) {',
      '    case "ready": return <span>ready</span>;',
      '    case "pending": return <span>pending</span>;',
      '    case "failed": return <span>failed</span>;',
      '    default: throw new Error("Unreachable");',
      '  }',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/StatusBadge.tsx', source);

    expect(result.StatusBadge?.shape.properties?.status).toMatchObject({
      candidateValues: ['ready', 'pending', 'failed'],
      kind: 'string',
    });
  });

  /** Fails closed for parser recovery, prototype paths, and lowercase helper exports. */
  it('rejects unsafe or non-component inference roots', () => {
    const source = [
      'export const helper = ({ constructor }) => constructor.value;',
      'export const Visible = ({ safe }) => safe;',
    ].join('\n');

    expect(collectReactExportPropInference('/workspace/Values.jsx', source)).toEqual({});
    expect(collectReactExportPropInference('/workspace/Broken.tsx', 'export const X = (')).toEqual(
      {},
    );
  });
});
