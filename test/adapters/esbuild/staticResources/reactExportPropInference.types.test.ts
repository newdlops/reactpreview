/** Covers types behavior for reactExportPropInference. */
/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';

import {
  collectReactExportPropInference,
  type PreviewChildPropDemandCatalog,
} from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
  /** Retains the shared Array container without selecting either incompatible item contract. */
  it('retains only the common container for an ambiguous non-null collection union', () => {
    const result = collectReactExportPropInference(
      '/workspace/Ambiguous.tsx',
      'export function Ambiguous({ items }: { items: { id: string }[] | { name: string }[] | undefined }) { return <>{items?.length}</>; }',
    );
    expect(result.Ambiguous?.shape.properties?.items).toEqual({ kind: 'array' });
  });

  /** Does not admit same-name module locals unless the imported declaration is genuinely exported. */
  it('fails closed for a non-exported imported item declaration', () => {
    const result = collectReactExportPropInference(
      '/workspace/List.tsx',
      "import type { Item } from './types'; export function List({ items }: { items: Item[] }) { return <>{items.length}</>; }",
      {
        resolveImport: () => ({
          sourcePath: '/workspace/types.ts',
          sourceText: 'interface Item { id: string; }',
        }),
      },
    );
    expect(result.List?.shape.properties?.items).toEqual({ kind: 'array' });
  });

  /** Recursive item aliases cannot re-enter after their declaration becomes active. */
  it('fails closed for recursive collection items', () => {
    const result = collectReactExportPropInference(
      '/workspace/Recursive.tsx',
      'interface Item { id: string; children: Item[]; } export function Tree({ items }: { items: Item[] }) { return <>{items.length}</>; }',
    );
    expect(result.Tree?.shape.properties?.items?.items?.properties?.children).toEqual({
      kind: 'array',
    });
  });

  /** Mutual aliases share the same active declaration stack across detached item traversal. */
  it('fails closed for mutually recursive collection items', () => {
    const result = collectReactExportPropInference(
      '/workspace/Mutual.tsx',
      'interface A { items: B[]; } interface B { items: A[]; } export function Mutual({ items }: { items: A[] }) { return <>{items.length}</>; }',
    );
    const nested =
      result.Mutual?.shape.properties?.items?.items?.properties?.items?.items?.properties?.items;
    expect(nested).toEqual({ kind: 'array' });
  });

  /** Deep array nesting consumes the bounded inference corridor instead of restarting per item. */
  it('fails closed beyond the aggregate nested-array depth budget', () => {
    const nested = '[]'.repeat(16);
    const result = collectReactExportPropInference(
      '/workspace/Deep.tsx',
      `export function Deep({ items }: { items: { id: string }${nested} }) { return <>{items.length}</>; }`,
    );
    expect(result.Deep?.shape.properties?.items).toEqual({ kind: 'array' });
  });

  /** Many sibling collection contracts share the aggregate node budget instead of restarting. */
  it('does not restart the item budget for many sibling arrays', () => {
    const fields = Array.from(
      { length: 220 },
      (_, index) => `items${index.toString()}: { id: string }[]`,
    ).join(';');
    const result = collectReactExportPropInference(
      '/workspace/Many.tsx',
      `type Props = { ${fields} }; export function Many(props: Props) { return <>{props.items0.length}</>; }`,
    );
    expect(Object.keys(result.Many?.shape.properties ?? {}).length).toBeLessThan(192);
  });

  it('resolves the same non-recursive alias independently for sibling props', () => {
    const result = collectReactExportPropInference(
      '/workspace/Siblings.tsx',
      'interface Item { id: string; } export function Siblings({ left, right }: { left: Item[]; right: Item[] }) { return <>{left.length}{right.length}</>; }',
    );
    expect(result.Siblings?.shape.properties?.left?.items).toBeDefined();
    expect(result.Siblings?.shape.properties?.right?.items).toBeDefined();
  });

  /** Distinct aliases consume one shared object/array corridor rather than relying on recursion filtering. */
  it('cuts off a distinct alternating object-array alias chain at the aggregate depth limit', () => {
    const aliases =
      Array.from(
        { length: 14 },
        (_, index) => `interface A${index.toString()} { next: A${(index + 1).toString()}[]; }`,
      ).join('\n') + 'interface A14 { id: string; }';
    const result = collectReactExportPropInference(
      '/workspace/Alternating.tsx',
      `${aliases}\nexport function Alternating({ items }: { items: A0[] }) { return <>{items.length}</>; }`,
    );
    let current = result.Alternating?.shape.properties?.items;
    for (let index = 0; index < 5; index += 1) {
      expect(current?.kind).toBe('array');
      current = current?.items?.properties?.next;
    }
    expect(current).toBeUndefined();
  });

  it('fails closed for mutually cyclic type aliases', () => {
    expect(
      collectReactExportPropInference(
        '/workspace/Cycle.tsx',
        'type A = B; type B = A; export function Cycle({ value }: { value: A }) { return <>{value}</>; }',
      ),
    ).toEqual({});
  });

  it('fails closed for cyclic interface heritage', () => {
    expect(
      collectReactExportPropInference(
        '/workspace/Heritage.tsx',
        'interface A extends B {} interface B extends A {} export function Heritage({ value }: { value: A }) { return <>{value}</>; }',
      ).Heritage?.shape.properties?.value,
    ).toEqual({ kind: 'object', properties: {} });
  });

  /**
   * Retains the non-null object branch needed when Inspector reveals an authored dormant target.
   */
  it('infers a guarded nullable object prop for exact-target materialization', () => {
    const source = [
      'interface PreviewFile { documentId: string; fileName: string; }',
      'export function DocumentModal({ file }: { file: PreviewFile | null }) {',
      '  if (file == null) return null;',
      '  return <form key={file.documentId}>{file.fileName}</form>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/DocumentModal.tsx', source);

    expect(result.DocumentModal?.shape).toEqual({
      kind: 'object',
      properties: {
        file: {
          kind: 'object',
          properties: {
            documentId: { kind: 'string', value: 'preview-id' },
            fileName: { kind: 'string', renderedText: true },
          },
        },
      },
    });
  });

  /**
   * Keeps locally observable prop requirements when a component intersects them with an imported
   * overlay contract. The unresolved Pick branch must not discard the guarded object receiver, and
   * an exact visibility key named by Pick remains a safe direct-preview choice.
   */
  it('infers guarded data and visibility through an imported overlay prop intersection', () => {
    const source = [
      "import { Modal } from './modal';",
      "import type { ModalProps } from './modal';",
      "import type { PreviewFile } from './file';",
      'type DocumentModalProps = Pick<ModalProps, "onClose" | "show"> & {',
      '  companyId: string;',
      '  file: PreviewFile | null;',
      '  onSaved: () => void;',
      '};',
      'export const DocumentModal = ({',
      '  companyId, file, onSaved, ...modalProps',
      '}: DocumentModalProps) => {',
      '  if (file == null) return null;',
      '  return (',
      '    <Modal {...modalProps}>',
      '      <form key={file.documentId} data-company={companyId}>',
      '        <span>{file.fileName}</span>',
      '        <button onClick={onSaved}>Save</button>',
      '      </form>',
      '    </Modal>',
      '  );',
      '};',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/DocumentModal.tsx', source);

    expect(result.DocumentModal?.shape.properties).toMatchObject({
      companyId: { kind: 'string' },
      file: {
        kind: 'object',
        properties: {
          documentId: { kind: 'string', value: 'preview-id' },
          fileName: { kind: 'string', value: 'File name' },
        },
      },
      onSaved: { kind: 'function' },
      show: { kind: 'boolean', value: true },
    });
  });

  /** Builds the minimum Formik-like containers needed by the reported `.value` failure. */
  it('infers nested receiver objects and callback no-op functions from direct usage', () => {
    const source = [
      "import type { FieldHelperProps, FieldInputProps } from 'formik';",
      'export const CheckField = ({ field, helpers }: {',
      '  field: FieldInputProps<any>;',
      '  helpers: FieldHelperProps<any>;',
      '}) => {',
      '  const addressInput = field.value.addressInput;',
      '  if (!addressInput.daumPostcodeJson) return <span>empty address</span>;',
      '  const complete = () => helpers.setValue({ ...field.value, ready: true });',
      '  return <button onClick={complete}>complete</button>;',
      '};',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/CheckField.tsx', source);

    expect(result.CheckField?.shape).toEqual({
      kind: 'object',
      properties: {
        field: {
          kind: 'object',
          properties: {
            value: {
              kind: 'object',
              properties: {
                addressInput: {
                  kind: 'object',
                  properties: { daumPostcodeJson: { kind: 'object', properties: {} } },
                },
              },
            },
          },
        },
        helpers: {
          kind: 'object',
          properties: { setValue: { kind: 'function' } },
        },
      },
    });
    expect(result.CheckField?.provenance).toEqual(
      expect.arrayContaining([
        { kind: 'object', path: 'field.value.addressInput', source: 'usage' },
        { kind: 'function', path: 'helpers.setValue', source: 'usage' },
      ]),
    );
  });

  /** Keeps renamed, repeatedly destructured prop containers non-null before opaque forwarding. */
  it('infers a prop-derived object receiver through renamed local destructuring', () => {
    const source = [
      'export const CompanyIrClosingFeed = ({ object }: any) => {',
      '  const { ir: irInfo, totalCommittedInvestments } = object;',
      '  const { desiredInvestmentAmountCategory, desiredInvestmentAmount } = irInfo;',
      '  totalCommittedInvestments.reduce((sum: number) => sum, 0);',
      '  return <Child dataProps={{',
      '    desiredInvestmentAmountCategory,',
      '    desiredInvestmentAmount,',
      '    committedInvestmentAmounts: totalCommittedInvestments,',
      '  }} />;',
      '};',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/CompanyIrClosingFeed.tsx', source);

    expect(result.CompanyIrClosingFeed?.shape.properties?.object).toMatchObject({
      kind: 'object',
      properties: {
        ir: { kind: 'object', properties: {} },
        totalCommittedInvestments: { kind: 'array' },
      },
    });
    expect(result.CompanyIrClosingFeed?.provenance).toContainEqual({
      kind: 'object',
      path: 'object.ir',
      source: 'usage',
    });
  });

  /** Carries a reached imported child's exact prop contract through renamed local aliases. */
  it('infers identity-forwarded props from a child component demand catalog', () => {
    const source = [
      `import { CompanyFeedBase } from './CompanyFeedBase';`,
      'export const CompanyIrClosingFeed = ({ object }: any) => {',
      '  const { company, ir: irInfo } = object;',
      '  return <CompanyFeedBase company={company} irInfo={irInfo} />;',
      '};',
    ].join('\n');
    const childPropDemands: PreviewChildPropDemandCatalog = new Map([
      [
        'CompanyFeedBase',
        new Map([
          [
            'company',
            {
              kind: 'object',
              properties: {
                id: { kind: 'string' },
                name: { kind: 'string' },
                profileLogo: { kind: 'null', value: null },
              },
            },
          ],
          [
            'irInfo',
            {
              kind: 'object',
              properties: { uuid: { kind: 'string' } },
            },
          ],
        ]),
      ],
    ]);

    const result = collectReactExportPropInference('/workspace/CompanyIrClosingFeed.tsx', source, {
      childPropDemands,
    });

    expect(result.CompanyIrClosingFeed?.shape.properties?.object).toMatchObject({
      kind: 'object',
      properties: {
        company: {
          kind: 'object',
          properties: {
            id: { kind: 'string' },
            name: { kind: 'string' },
            profileLogo: { kind: 'null', value: null },
          },
        },
        ir: {
          kind: 'object',
          properties: { uuid: { kind: 'string' } },
        },
      },
    });
    expect(result.CompanyIrClosingFeed?.provenance).toEqual(
      expect.arrayContaining([
        { kind: 'string', path: 'object.company.name', source: 'usage' },
        { kind: 'string', path: 'object.ir.uuid', source: 'usage' },
      ]),
    );
  });

  /**
   * A receiver read only by `length` and an index is the Array a child's declared item contract
   * proves (SimSheet `r.past[r.past.length - 1]` rendered NaN from an empty sample list).
   */
  it.each(['r.past[r.past.length - 1]', 'r.past[0]'])(
    'accepts a child Array item contract for a receiver read as %s',
    (read) => {
      const source = [
        `import { Cell } from './Cell';`,
        'export const Sheet = ({ rows }: any) => (',
        '  <table><tbody>{rows.map((r) => (',
        `    <tr key={r.id}><td>{String(${read})}</td><Cell row={r} /></tr>`,
        '  ))}</tbody></table>',
        ');',
      ].join('\n');
      const childPropDemands: PreviewChildPropDemandCatalog = new Map([
        [
          'Cell',
          new Map([
            [
              'row',
              {
                kind: 'object',
                properties: { past: { kind: 'array', items: { kind: 'number' } } },
              },
            ],
          ]),
        ],
      ]);

      const result = collectReactExportPropInference('/workspace/Sheet.tsx', source, {
        childPropDemands,
      });

      expect(result.Sheet?.shape.properties?.rows?.items?.properties?.past).toEqual({
        kind: 'array',
        items: { kind: 'number' },
      });
    },
  );
});
