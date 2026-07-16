/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
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
              properties: { addressInput: { kind: 'object', properties: {} } },
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

  /** Preserves optional-chain absence instead of inventing data that changes the rendered branch. */
  it('materializes only containers before the first optional receiver', () => {
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
      properties: { field: { kind: 'object', properties: {} } },
    });
    expect(result.OptionalCard?.provenance).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'user' })]),
    );
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
