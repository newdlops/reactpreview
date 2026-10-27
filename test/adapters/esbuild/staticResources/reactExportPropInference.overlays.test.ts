/** Covers overlays behavior for reactExportPropInference. */
/** Exercises bounded target-prop inference without resolving or executing project modules. */
import { describe, expect, it } from 'vitest';

import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

describe('collectReactExportPropInference', () => {
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
      // A required closed union takes its first member and keeps every member as a candidate.
      variant: { candidateValues: ['create', 'edit'], kind: 'string', value: 'create' },
    });
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
      selectedUrl: { kind: 'string', value: 'https://example.invalid/' },
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

    expect(result.default?.shape.properties).toEqual({
      className: { kind: 'string', value: 'Class name' },
    });
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

  /** A semantic active flag stays false; a menu name alone cannot reveal a dormant overlay. */
  it('keeps an untyped active menu value neutral', () => {
    const source =
      'export function MainMenu({ active }: any) { return <nav data-active={active} />; }';

    expect(
      collectReactExportPropInference('/workspace/MainMenu.tsx', source).MainMenu?.shape.properties,
    ).toEqual({
      active: { kind: 'boolean', value: false },
    });
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
          bulkUploadOpen: { exactValue: true, kind: 'boolean', value: false },
          deleteTarget: { exactValue: true, kind: 'null' },
          editTarget: { exactValue: true, kind: 'null' },
          uploadTarget: { exactValue: true, kind: 'null' },
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
});
