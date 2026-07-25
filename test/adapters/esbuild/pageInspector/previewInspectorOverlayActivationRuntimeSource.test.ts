/**
 * Verifies that a manually revealed overlay mount receives a coherent preview-only visual contract.
 */
import { describe, expect, it } from 'vitest';
import { createContext, runInContext } from 'node:vm';
import * as React from 'react';
import { createPreviewInspectorOverlayActivationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorOverlayActivationRuntimeSource';

/** Browser functions exposed by the isolated generated-runtime fixture. */
interface OverlayActivationFixture {
  readonly resolve: (
    ids: readonly string[],
    element: React.ReactElement,
    metadata?: unknown,
  ) => React.ReactElement;
  readonly setCondition: (id: string, authored: boolean, effective: boolean) => void;
  readonly setManualOverride: (id: string, enabled: boolean) => void;
}

/** Minimal browser fixture exposing the generated resolver without loading application components. */
function createOverlayActivationFixture(): OverlayActivationFixture {
  const runtimeSource = createPreviewInspectorOverlayActivationRuntimeSource();
  const context = createContext({ React });
  runInContext(
    `
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
const previewInspectorSession = {
  renderConditionOverrides: new Map(),
  renderConditions: new Map(),
};
function initializePreviewInspectorConditionState() {}
function createPreviewInspectorRequiredPathKeyText(name) { return String(name); }
function createPreviewInspectorRequiredPathLeaf(name) {
  const normalized = String(name).toLowerCase();
  if (normalized === 'id' || normalized.endsWith('id')) return 'preview-1';
  return String(name);
}
function materializePreviewInspectorRuntimeFallbackOverride(value) { return value; }
${runtimeSource}
globalThis.__overlayActivationApi = {
  resolve: resolvePreviewInspectorOverlayActivationRenderValue,
  setCondition(id, authoredEnabled, effectiveEnabled) {
    previewInspectorSession.renderConditions.set(id, { authoredEnabled, effectiveEnabled });
  },
  setManualOverride(id, enabled) {
    previewInspectorSession.renderConditionOverrides.set(id, enabled);
  },
};`,
    context,
  );
  return context.__overlayActivationApi as OverlayActivationFixture;
}

describe('Preview Inspector overlay activation runtime source', () => {
  /** Repairs only the dormant visibility and entity props after a false gate is forced true. */
  it('opens the gated overlay and supplies a lazy semantic entity without mutating authored props', () => {
    const fixture = createOverlayActivationFixture();
    fixture.setCondition('modal-gate', false, true);
    const Overlay = (): null => null;
    const authored = React.createElement(Overlay, {
      anchorEl: null,
      companyId: 'company-1',
      file: null,
      hidden: true,
      onClose: undefined,
      show: false,
    });

    const activated = fixture.resolve(['modal-gate'], authored);
    const activatedProps = activated.props as Record<string, unknown>;
    const generatedFile = activatedProps.file as Record<string, unknown>;

    expect(activated).not.toBe(authored);
    expect(activatedProps.show).toBe(true);
    expect(activatedProps.hidden).toBe(false);
    expect(generatedFile.documentId).toBe('preview-1');
    expect(generatedFile.fileName).toBe('fileName');
    expect(activatedProps.anchorEl).toBeNull();
    expect(activatedProps.onClose).toBeUndefined();
    expect(authored.props).toMatchObject({ file: null, hidden: true, show: false });
  });

  /** Leaves the exact React element untouched when authored state already owns the branch decision. */
  it('preserves an authored overlay until an override reveals a previously false gate', () => {
    const fixture = createOverlayActivationFixture();
    fixture.setCondition('authored-gate', true, true);
    const authored = React.createElement(() => null, { file: null, show: false });

    expect(fixture.resolve(['authored-gate'], authored)).toBe(authored);

    fixture.setCondition('hidden-gate', false, false);
    expect(fixture.resolve(['hidden-gate'], authored)).toBe(authored);
  });

  /** Treats a manual ON as visual intent even when generated props already mounted the branch. */
  it('opens an already-mounted dormant overlay after an explicit manual ON', () => {
    const fixture = createOverlayActivationFixture();
    fixture.setCondition('mounted-gate', true, true);
    const authored = React.createElement(() => null, { file: null, show: false });

    expect(fixture.resolve(['mounted-gate'], authored)).toBe(authored);

    fixture.setManualOverride('mounted-gate', true);
    const activated = fixture.resolve(['mounted-gate'], authored);
    const activatedProps = activated.props as {
      readonly file?: { readonly id?: unknown };
      readonly show?: unknown;
    };

    expect(activated).not.toBe(authored);
    expect(activatedProps.file).toMatchObject({ id: 'preview-1' });
    expect(activatedProps.show).toBe(true);
  });
});
