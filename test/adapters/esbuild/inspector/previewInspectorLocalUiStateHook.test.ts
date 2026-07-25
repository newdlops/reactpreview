/**
 * Verifies syntax-only proof for React-local modal/drawer state controllers.
 */
import { describe, expect, it } from 'vitest';
import { hasPreviewInspectorLocalUiStateHook } from '../../../../src/adapters/esbuild/inspector/previewInspectorLocalUiStateHook';

describe('hasPreviewInspectorLocalUiStateHook', () => {
  /** Keeps one coherent visibility state/action pair while allowing erased project type imports. */
  it('recognizes a React-only modal actions hook', () => {
    const source = [
      `import { useCallback, useState } from 'react';`,
      `import type { ModalProps } from './modal';`,
      `export const useModalActions = (): readonly [Partial<ModalProps>, unknown] => {`,
      `  const [showState, setShowState] = useState(false);`,
      `  const show = useCallback(() => setShowState(true), [setShowState]);`,
      `  const hide = useCallback(() => setShowState(false), [setShowState]);`,
      `  return [{ show: showState, onClose: hide }, { show, hide }];`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorLocalUiStateHook('/workspace/use-modal-actions.tsx', source, [
        'useModalActions',
      ]),
    ).toBe(true);
  });

  /** Supports namespace React syntax without trusting a same-named project function. */
  it('recognizes callbacks reached through an imported React namespace', () => {
    const source = [
      `import * as React from 'react';`,
      `const useDrawerActions = () => {`,
      `  const [open, setOpen] = React.useState(false);`,
      `  const reveal = React.useCallback(() => setOpen(true), [setOpen]);`,
      `  return [{ open }, { reveal }];`,
      `};`,
      `export { useDrawerActions };`,
    ].join('\n');

    expect(
      hasPreviewInspectorLocalUiStateHook('/workspace/use-drawer-actions.ts', source, [
        'useDrawerActions',
      ]),
    ).toBe(true);
  });

  /** Network/store imports keep a hook behind the generated runtime-value boundary. */
  it('rejects a controller with a non-React runtime dependency', () => {
    const source = [
      `import { useState } from 'react';`,
      `import { saveVisibility } from './api';`,
      `export const useRemoteModal = () => {`,
      `  const [open, setOpen] = useState(false);`,
      `  const show = () => { saveVisibility(true); setOpen(true); };`,
      `  return [{ open }, { show }];`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorLocalUiStateHook('/workspace/use-remote-modal.ts', source, [
        'useRemoteModal',
      ]),
    ).toBe(false);
  });

  /** Effects are rejected even when they happen to coexist with a local Boolean state slot. */
  it('rejects effects and unknown runtime calls', () => {
    const source = [
      `import { useEffect, useState } from 'react';`,
      `export const useSessionOverlay = () => {`,
      `  const [open, setOpen] = useState(false);`,
      `  useEffect(() => setOpen(readSession()), []);`,
      `  const show = () => setOpen(true);`,
      `  return [{ open }, { show }];`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorLocalUiStateHook('/workspace/use-session-overlay.ts', source, [
        'useSessionOverlay',
      ]),
    ).toBe(false);
  });

  /** State without a returned state-changing UI action cannot repair an overlay click contract. */
  it('rejects a read-only state hook', () => {
    const source = [
      `import { useState } from 'react';`,
      `export const useOpenState = () => {`,
      `  const [open] = useState(false);`,
      `  return { open };`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorLocalUiStateHook('/workspace/use-open-state.ts', source, ['useOpenState']),
    ).toBe(false);
  });
});
