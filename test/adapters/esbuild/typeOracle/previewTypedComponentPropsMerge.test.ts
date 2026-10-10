/** Verifies where declared-type prop values may fill in for usage-inferred prop shapes. */
import { describe, expect, it } from 'vitest';
import type { PreviewInferredPropShape } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';
import {
  completePreviewAutomaticProps,
  completePreviewTypedListShape,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';

/** SimSheet's usage shape: `weeks.past` read only for its length, rows with item evidence. */
const SHAPE: PreviewInferredPropShape = {
  kind: 'object',
  properties: {
    rows: {
      items: {
        kind: 'object',
        properties: { status: { exactValue: true, kind: 'string', value: 'mismatch' } },
      },
      kind: 'array',
    },
    status: { kind: 'string', value: 'ok' },
    weeks: {
      kind: 'object',
      properties: {
        future: { kind: 'array' },
        past: {
          kind: 'object',
          properties: { length: { exactValue: true, kind: 'number', value: 0 } },
        },
        title: { kind: 'string', value: 'Title' },
      },
    },
  },
};

describe('declared-type prop completion', () => {
  /** Typed values fill only what usage inference left absent or as a placeholder. */
  it('fills absent and placeholder nodes and keeps usage evidence', () => {
    const typed = {
      label: 'Label',
      rows: [{ status: 'ok' }],
      status: 'crit',
      weeks: { current: '2026-01-15', future: ['2026-01-22'], past: ['2026-01-08'], title: 'X' },
    };

    expect(completePreviewAutomaticProps({ status: 'warn' }, typed, SHAPE)).toEqual({
      label: 'Label',
      status: 'warn',
      weeks: { current: '2026-01-15', future: ['2026-01-22'], past: ['2026-01-08'] },
    });
  });

  /**
   * A text leaf known only from its declared type takes a typed date, and the key label only when
   * the component shows it as-is (PageHeader's empty heading); DateRangePicker parsed a labelled
   * `end` into "End.undefined.undefined", so other text stays ''. A usage value still wins.
   */
  it('fills declared-only text leaves with dates, and labels only shown text', () => {
    const shape: PreviewInferredPropShape = {
      kind: 'object',
      properties: {
        weeks: {
          kind: 'object',
          properties: {
            current: { kind: 'string' },
            heading: { kind: 'string', renderedText: true },
            name: { kind: 'string' },
            stamp: { kind: 'string' },
            title: { kind: 'string', value: 'Title' },
          },
        },
      },
    };
    const typed = {
      weeks: {
        current: '2026-01-15',
        heading: 'Heading',
        name: 'Name',
        stamp: '2026-01-15T09:00:00.000Z',
        title: '2026-01-15',
      },
    };

    expect(completePreviewAutomaticProps({}, typed, shape)).toEqual({
      weeks: { current: '2026-01-15', heading: 'Heading', stamp: '2026-01-15T09:00:00.000Z' },
    });
  });

  /** Without a usage shape every missing typed prop is added, as before for scalars. */
  it('adds every missing typed prop when no usage shape is known', () => {
    expect(completePreviewAutomaticProps({}, { count: 1, tags: ['A'] })).toEqual({
      count: 1,
      tags: ['A'],
    });
    const automatic = { count: 2 };
    expect(completePreviewAutomaticProps(automatic, { count: 1 })).toBe(automatic);
  });

  /**
   * InboundTab's typed `rows` rendered "미정 # # — 0개": neutral row text takes the typed rows' values
   * as per-row candidates, while evidence (the `status` rotation) stays and generated lists keep
   * numbering ids and names themselves.
   */
  it('gives neutral typed list row fields the typed values as row candidates', () => {
    const shape: PreviewInferredPropShape = {
      kind: 'object',
      properties: {
        rows: {
          kind: 'array',
          items: {
            kind: 'object',
            properties: {
              expected_arrival_date: { kind: 'string' },
              quantity: { kind: 'number' },
              sku_code: { kind: 'string' },
              status: {
                candidateValues: ['REQUESTED', 'DELIVERED'],
                kind: 'string',
                value: 'REQUESTED',
              },
              warehouse_id: { kind: 'string' },
            },
          },
        },
        title: { kind: 'string' },
      },
    };
    const typed = {
      rows: [
        {
          expected_arrival_date: '2026-01-15',
          quantity: 0,
          sku_code: 'Sku code',
          status: 'REQUESTED',
          warehouse_id: 'preview-id',
        },
        {
          expected_arrival_date: '2026-01-14',
          quantity: 0,
          sku_code: 'Sku code',
          status: 'REQUESTED',
          warehouse_id: 'preview-id-2',
        },
      ],
      title: 'Title',
    };

    const completed = completePreviewTypedListShape(shape, typed);
    const row = completed?.properties?.rows?.items?.properties;

    expect(row?.expected_arrival_date).toEqual({
      candidateValues: ['2026-01-15', '2026-01-14'],
      kind: 'string',
    });
    expect(row?.sku_code).toEqual({ candidateValues: ['Sku code', 'Sku code'], kind: 'string' });
    expect(row?.warehouse_id).toEqual({ candidateValues: ['preview-id'], kind: 'string' });
    expect(row?.status).toBe(shape.properties?.rows?.items?.properties?.status);
    expect(row?.quantity).toEqual({ kind: 'number' });
    expect(completed?.properties?.title).toEqual({ kind: 'string' });
    expect(completePreviewTypedListShape(shape, { title: 'Title' })).toBe(shape);
  });
});
