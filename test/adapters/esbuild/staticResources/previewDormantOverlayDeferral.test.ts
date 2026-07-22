/** Verifies bounded first-paint deferral for statically dormant project overlay imports. */
import { describe, expect, it } from 'vitest';
import { transform as transformWithEsbuild } from 'esbuild';
import { deferPreviewDormantOverlayImports } from '../../../../src/adapters/esbuild/staticResources/previewDormantOverlayDeferral';

const WORKSPACE_ROOT = '/workspace';
const SOURCE_PATH = '/workspace/src/Page.tsx';

describe('deferPreviewDormantOverlayImports', () => {
  /** Removes only the false-state overlay while preserving ordinary bindings from one import. */
  it('substitutes a workspace modal used only with a false state visibility prop', () => {
    const source = [
      "import { useState } from 'react';",
      "import { EditorModal, EditorButton } from './editor';",
      'export function Page() {',
      '  const [showEditorModal, setShowEditorModal] = useState(false);',
      '  return <>',
      '    <EditorButton onClick={() => setShowEditorModal(true)} />',
      '    <EditorModal show={showEditorModal} onClose={() => setShowEditorModal(false)} />',
      '  </>;',
      '}',
    ].join('\n');

    const transformed = transform(source);

    expect(transformed).toContain("import { EditorButton } from './editor';");
    expect(transformed).toContain('const EditorModal = __reactPreviewForwardRef');
    expect(transformed).toContain('lazy as __reactPreviewLazy');
    expect(transformed).toContain('import("./editor")');
    expect(transformed).toContain('data-react-preview-deferred-overlay');
    expect(transformed).toContain('<EditorModal show={showEditorModal}');
  });

  /** Supports a default project modal with a literal false authored visibility value. */
  it('substitutes a dormant default overlay import', () => {
    const transformed = transform(
      "import AccountDialog from './AccountDialog';\nexport default () => <AccountDialog open={false} />;",
    );

    expect(transformed).not.toContain("import AccountDialog from './AccountDialog'");
    expect(transformed).toContain('const AccountDialog = __reactPreviewForwardRef');
    expect(transformed).toContain('module["default"]');
  });

  /** A non-JSX reference can carry styled or imperative semantics, so it must fail closed. */
  it('retains an overlay binding that has another runtime use', () => {
    const source = [
      "import { ConfirmModal } from './ConfirmModal';",
      'const modalType = ConfirmModal;',
      'export default () => <ConfirmModal show={false} />;',
    ].join('\n');

    expect(transform(source)).toBe(source);
  });

  /** Installed packages are never substituted even when their component shape looks dormant. */
  it('retains external dependency overlays', () => {
    const source =
      "import { Modal } from '@ui/library';\nexport default () => <Modal open={false} />;";
    const transformed = deferPreviewDormantOverlayImports({
      resolver: { resolve: () => '/workspace/node_modules/@ui/library/index.js' },
      sourcePath: SOURCE_PATH,
      sourceText: source,
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(transformed).toBe(source);
  });

  /** An authored true/open expression must keep the complete implementation in the bundle. */
  it('retains overlays whose visibility is not proven false', () => {
    const source = [
      "import { NoticeDrawer } from './NoticeDrawer';",
      'export const Page = ({ open }) => <NoticeDrawer open={open} />;',
    ].join('\n');

    expect(transform(source)).toBe(source);
  });

  /** Same-spelled state in another function must not make an unrelated prop binding dormant. */
  it('resolves false state by lexical declaration identity', () => {
    const source = [
      "import { useState } from 'react';",
      "import AccountModal from './AccountModal';",
      'function StateOwner() { const [open] = useState(false); return null; }',
      'export const Page = ({ open }) => <AccountModal open={open} />;',
    ].join('\n');

    expect(transform(source)).toBe(source);
  });

  /** A spread or a later visible assignment can override a preceding dormant-looking prop. */
  it('rejects spread and last-write visibility ambiguity', () => {
    const spread =
      "import AccountModal from './AccountModal';\nexport const Page = (props) => <AccountModal open={false} {...props} />;";
    const laterVisible =
      "import AccountModal from './AccountModal';\nexport const Page = () => <AccountModal open={false} open={true} />;";

    expect(transform(spread)).toBe(spread);
    expect(transform(laterVisible)).toBe(laterVisible);
  });

  /** Negative and less-common positive visibility controls load the real module after activation. */
  it('supports every visibility family used by conditional instrumentation', () => {
    const hidden =
      "import NoticeDrawer from './NoticeDrawer';\nexport const Page = () => <NoticeDrawer hidden />;";
    const present =
      "import NoticeModal from './NoticeModal';\nexport const Page = () => <NoticeModal present={false} />;";

    const hiddenResult = transform(hidden);
    const presentResult = transform(present);
    expect(hiddenResult).toContain('__reactPreviewOverlayProps?.hidden === false');
    expect(presentResult).toContain('__reactPreviewOverlayProps?.present');
    expect(presentResult).toContain('import("./NoticeModal")');
  });

  /** Missing declarative side-effect evidence keeps normal eager import evaluation exact. */
  it('retains a workspace overlay when its package does not prove side-effect freedom', () => {
    const source =
      "import AccountDialog from './AccountDialog';\nexport default () => <AccountDialog open={false} />;";
    const transformed = deferPreviewDormantOverlayImports({
      resolver: { resolve: () => '/workspace/src/AccountDialog.tsx' },
      sourcePath: SOURCE_PATH,
      sourceText: source,
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(transformed).toBe(source);
  });

  /** Generated wrappers consume no additional physical lines before later authored statements. */
  it('preserves source line positions after a deferred import', () => {
    const source = [
      "import AccountDialog from './AccountDialog';",
      'export const marker = 1;',
      'export default () => <AccountDialog open={false} />;',
    ].join('\n');

    const transformed = transform(source);
    expect(lineOf(transformed, 'export const marker')).toBe(lineOf(source, 'export const marker'));
  });

  /** The generated lazy/ref/Suspense wrapper remains valid TSX before the native bundle starts. */
  it('emits JavaScript that esbuild can parse', async () => {
    const transformed = transform(
      "import AccountDialog from './AccountDialog';\nexport default () => <AccountDialog open={false} />;",
    );

    await expect(transformWithEsbuild(transformed, { loader: 'tsx' })).resolves.toMatchObject({
      warnings: [],
    });
  });
});

/** Applies a deterministic project resolver without touching the test filesystem. */
function transform(sourceText: string): string {
  return deferPreviewDormantOverlayImports({
    resolver: {
      isSideEffectFree: () => true,
      resolve: (specifier) => `/workspace/src/${specifier.replace(/^\.\//u, '')}.tsx`,
    },
    sourcePath: SOURCE_PATH,
    sourceText,
    workspaceRoot: WORKSPACE_ROOT,
  });
}

/** Returns the one-based physical line containing an exact fixture token. */
function lineOf(sourceText: string, token: string): number {
  return sourceText.slice(0, sourceText.indexOf(token)).split(/\r?\n/u).length;
}
