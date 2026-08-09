/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
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
        resolveImport: (specifier, importer) => {
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
  /** Fails closed for ambiguous non-null collection alternatives instead of selecting one branch. */
  it('does not materialize an ambiguous non-null collection union', () => {
    const result = collectReactExportPropInference(
      '/workspace/Ambiguous.tsx',
      'export function Ambiguous({ items }: { items: { id: string }[] | { name: string }[] | undefined }) { return <>{items?.length}</>; }',
    );
    expect(result.Ambiguous).toBeUndefined();
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
      (_, index) => `items${index}: { id: string }[]`,
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
        (_, index) => `interface A${index} { next: A${index + 1}[]; }`,
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
            documentId: { kind: 'string' },
            fileName: { kind: 'string' },
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
          fileName: { kind: 'string', value: 'fileName' },
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
    });
    expect(result.Form?.shape.properties).not.toHaveProperty('variant');
    expect(result.Form?.shape.properties).not.toHaveProperty('optional');
  });

  /**
   * Treats JavaScript truthiness as a value-family constraint rather than always inventing Boolean.
   *
   * The imported prop decorator intentionally remains unresolved. The selected URL's own name and
   * `if (!selectedUrl) return null` usage are sufficient to create the non-empty string needed by
   * exact-target null repair, matching styled viewers that fetch and render an iframe document.
   */
  it('infers a non-empty semantic URL through a styled target truthiness guard', () => {
    const source = [
      "import styled from 'styled-components';",
      "import type { PropsWithClassName } from './typing';",
      'type ViewerProps = { selectedUrl: string | null; height: number };',
      'export const DocumentVersionViewer = styled((',
      '  { className, selectedUrl, height }: PropsWithClassName<ViewerProps>,',
      ') => {',
      '  useEffect(() => { if (!selectedUrl) return; fetch(selectedUrl); }, [selectedUrl]);',
      '  if (!selectedUrl) return null;',
      '  return <iframe className={className} data-height={height} src={selectedUrl} />;',
      '})`height: ${(props) => props.height}px;`;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/DocumentVersionViewer.tsx', source);

    expect(result.DocumentVersionViewer?.shape.properties).toMatchObject({
      selectedUrl: { kind: 'string', value: 'selectedUrl' },
    });
    expect(result.DocumentVersionViewer?.provenance).toContainEqual({
      kind: 'string',
      path: 'selectedUrl',
      source: 'usage',
    });
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

  /** A bare rest spread cannot prove whether a project's Modal API uses `show` or `open`. */
  it('does not guess a visibility prop for an ambiguous rest-forwarding overlay export', () => {
    const source = [
      "import styled from 'styled-components';",
      "import { Modal } from './modal';",
      "import type { ModalProps } from './modal';",
      'const UnstyledEditModal = ({ className, ...props }: ModalProps & { className?: string }) => (',
      '  <Modal className={className} {...props}><strong>Edit</strong></Modal>',
      ');',
      'export default styled(UnstyledEditModal)``;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/EditModal.tsx', source);

    expect(result.default).toBeUndefined();
  });

  /** An exact rest-property forwarding expression proves the wrapper's public visibility key. */
  it('infers a rest-forwarded visibility prop only from same-named JSX evidence', () => {
    const source = [
      "import styled from 'styled-components';",
      "import { Modal } from './modal';",
      'const UnstyledEditModal = ({ className, ...props }: any) => (',
      '  <Modal className={className} show={props.show} {...props}>Edit</Modal>',
      ');',
      'export default styled(UnstyledEditModal)``;',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/EditModal.tsx', source);

    expect(result.default?.shape.properties).toMatchObject({
      show: { kind: 'boolean', value: true },
    });
    expect(result.default?.provenance).toContainEqual({
      kind: 'boolean',
      path: 'show',
      source: 'usage',
    });
  });

  /** `active` is commonly an item key, so an untyped menu name alone cannot make it boolean. */
  it('does not treat an untyped active menu value as overlay visibility', () => {
    const source =
      'export function MainMenu({ active }: any) { return <nav data-active={active} />; }';

    expect(collectReactExportPropInference('/workspace/MainMenu.tsx', source)).toEqual({});
  });

  /** Uses an explicit overlay visibility binding instead of guessing another control spelling. */
  it('makes one explicit overlay visibility prop true for direct preview', () => {
    const source = [
      'type DrawerProps = { open: boolean; title: string };',
      'export function Drawer({ open = false, title }: DrawerProps) {',
      '  return open ? <aside>{title}</aside> : null;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/Drawer.tsx', source);

    expect(result.Drawer?.shape.properties).toMatchObject({
      open: { kind: 'boolean', value: true },
      title: { kind: 'string' },
    });
  });

  /**
   * Keeps nested overlays dormant when their visibility is derived from a hook-fed prop object.
   *
   * A missing nullable key must become `null`, not `undefined`: `undefined !== null` would reveal
   * every modal even though the authored hook initializes each target to `null`.
   */
  it('infers comparison-safe values for nested overlay visibility expressions', () => {
    const source = [
      'export function ManagementModals({ modals }: { modals: unknown }) {',
      '  return <>',
      '    <UploadModal show={modals.uploadTarget !== null} />',
      '    <BulkModal show={modals.bulkUploadOpen} />',
      '    <EditModal show={modals.editTarget !== null} />',
      '    <DeleteModal show={modals.deleteTarget !== null} />',
      '  </>;',
      '}',
    ].join('\n');

    const result = collectReactExportPropInference('/workspace/ManagementModals.tsx', source);

    expect(result.ManagementModals?.shape.properties).toEqual({
      modals: {
        kind: 'object',
        properties: {
          bulkUploadOpen: { kind: 'boolean', value: false },
          deleteTarget: { kind: 'null' },
          editTarget: { kind: 'null' },
          uploadTarget: { kind: 'null' },
        },
      },
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
