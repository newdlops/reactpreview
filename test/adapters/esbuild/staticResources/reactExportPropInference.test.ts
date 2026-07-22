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
              properties: {
                addressInput: {
                  kind: 'object',
                  properties: { daumPostcodeJson: { kind: 'boolean', value: false } },
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
        title: { kind: 'string' },
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

  /** Reads the inline component argument from the common styled-components tagged form. */
  it('infers typed props from styled component factories', () => {
    const source = [
      "import styled from 'styled-components';",
      'type FormProps = { variant: "create" | "edit"; name: string; optional?: number };',
      'export const Form = styled(({ variant, name }: FormProps) => (',
      '  <form data-variant={variant}>{name}</form>',
      '))`display: block;`;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Form.tsx', source);

    expect(result.Form?.shape.properties).toMatchObject({
      name: { kind: 'string' },
      variant: { kind: 'string', value: 'create' },
    });
    expect(result.Form?.shape.properties).not.toHaveProperty('optional');
  });

  /** Carries a local component contract through nested styled/memo/forwardRef wrappers. */
  it('infers nested object and sibling array props through local HOC chains', () => {
    const source = [
      "import styled from 'styled-components';",
      "import { forwardRef, memo } from 'react';",
      'type PanelProps = {',
      '  captableRequestNotification: { count: number; metadata: { label: string } };',
      '  notificationIds: string[];',
      '};',
      'const UnstyledCaptableRequestNotificationPanel = (',
      '  { captableRequestNotification, notificationIds }: PanelProps,',
      '  ref: React.ForwardedRef<HTMLDivElement>,',
      ') => <div ref={ref}>{captableRequestNotification.count}{notificationIds.length}</div>;',
      'const ForwardedPanel = forwardRef(UnstyledCaptableRequestNotificationPanel);',
      'const MemoPanel = memo(ForwardedPanel);',
      'export const CaptableRequestNotificationPanel = styled(MemoPanel)`display: block;`;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/CaptablePanel.tsx', source);

    expect(result.CaptableRequestNotificationPanel?.shape.properties).toEqual({
      captableRequestNotification: {
        kind: 'object',
        properties: {
          count: { kind: 'number' },
          metadata: {
            kind: 'object',
            properties: { label: { kind: 'string' } },
          },
        },
      },
      notificationIds: { kind: 'array' },
    });
  });

  /** Refuses imported HOC inputs and cyclic local aliases because neither proves a function body. */
  it('fails closed for external and cyclic HOC component references', () => {
    const source = [
      "import styled from 'styled-components';",
      "import { memo } from 'react';",
      "import { ExternalPanel } from './external';",
      'const FirstPanel = memo(SecondPanel);',
      'const SecondPanel = memo(FirstPanel);',
      'export const ImportedPanel = styled(ExternalPanel)`display: block;`;',
      'export const CyclicPanel = styled(FirstPanel)`display: block;`;',
    ].join('\n');

    expect(collectReactExportPropInference('/workspace/UnsafePanels.tsx', source)).toEqual({});
  });

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
