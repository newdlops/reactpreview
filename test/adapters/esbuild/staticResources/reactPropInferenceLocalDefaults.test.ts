/** Local destructuring defaults must not become missing fields on a hook-fed child prop carrier. */
import { describe, expect, it } from 'vitest';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

const CHILD = '/workspace/Dialog.tsx';

describe('authored local prop defaults', () => {
  it.each([
    'const { size = "medium", show } = props;',
    'const { size: actualSize = "medium", show } = props; const size = actualSize;',
  ])('keeps layout defaults out of automatic required props: %s', (binding) => {
    const source = [
      'type Props = { show: boolean; size?: number | "medium" };',
      `export function Dialog(props: Props) { ${binding}`,
      'return <div hidden={!show} style={{ maxWidth: typeof size === "number" ? size : 500 }} />; }',
    ].join('\n');
    const shape = collectReactExportPropInference(CHILD, source).Dialog?.shape;
    expect(shape?.properties?.show).toBeDefined();
    expect(shape?.properties).not.toHaveProperty('size');
  });

  it('keeps defaulted behavior flags and callbacks authored', () => {
    const source = [
      'export function Dialog(props: any) {',
      'const { disableBackdropClick = true, onClose = () => undefined, show } = props;',
      'return <div hidden={!show} onClick={disableBackdropClick ? undefined : onClose} />; }',
    ].join('\n');
    const properties = collectReactExportPropInference(CHILD, source).Dialog?.shape.properties;
    expect(properties?.show).toBeDefined();
    expect(properties).not.toHaveProperty('disableBackdropClick');
    expect(properties).not.toHaveProperty('onClose');
  });

  it('still carries required siblings and independent direct reads', () => {
    const source = [
      'export function Dialog(props: any) {',
      'const { size = "medium", title } = props;',
      'return <div data-id={props.id.trim()} data-size={props.size.toFixed()}>{title.trim()}{size}</div>; }',
    ].join('\n');
    const properties = collectReactExportPropInference(CHILD, source).Dialog?.shape.properties;
    expect(properties).toMatchObject({ id: { kind: 'string' }, title: { kind: 'string' } });
    expect(properties?.size).toBeDefined();
  });

  it('does not evaluate a fallback expression during source inference', () => {
    const source = [
      'export function Dialog(props: any) {',
      'const { size = globalThis.__mustNotRun(), show } = props;',
      'return <div hidden={!show} data-size={size.toFixed()} />; }',
    ].join('\n');
    expect(
      collectReactExportPropInference(CHILD, source).Dialog?.shape.properties,
    ).not.toHaveProperty('size');
  });

  it('does not ask a hook to fill optional child layout and event defaults', () => {
    const parent = '/workspace/Parent.tsx';
    const source = [
      "import { useDialog } from './useDialog';",
      "import { Dialog } from './Dialog';",
      'export function Parent() { const [dialogProps] = useDialog(); return <Dialog {...{ state: dialogProps }} />; }',
    ].join('\n');
    const childSource = [
      'type State = { show: boolean; title: string; size?: number | "medium"; disableBackdropClick?: boolean };',
      'type Props = { state?: State };',
      'export function Dialog({ state }: Props) {',
      'const { size = "medium", show, title, disableBackdropClick = true } = state;',
      'return <div hidden={!show} data-disabled={disableBackdropClick} style={{width: typeof size === "number" ? size : 500}}>{title.trim()}</div>; }',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      workspaceRoot: '/workspace',
      readSource: (file) => (file === CHILD ? childSource : undefined),
      resolveModule: (specifier) => (specifier === './Dialog' ? CHILD : undefined),
    });
    const replacements = createPreviewRuntimeHookReplacements(
      parent,
      source,
      builder.collect(parent, source, { includeOptionalTypes: true }),
    );
    const generated = replacements.map((replacement) => replacement.replacement).join('\n');
    expect(generated).toContain('0.title');
    expect(generated).toContain('0.show');
    expect(generated).not.toContain('0.size');
    expect(generated).not.toContain('0.disableBackdropClick');
  });
});
