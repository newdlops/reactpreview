/** Verifies project-agnostic ambiguity rules for target-path component names. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';

describe('Preview Inspector target path identity runtime source', () => {
  /** Treats generic styled overlays and repeated HOC owner sources as name-only ambiguity. */
  it('rejects shared and multi-source runtime owner identities', () => {
    const context: { __result?: Record<string, unknown> } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = { renderConditions: new Map([
          ['page-a', { id: 'page-a', ownerName: 'PageComponent', sourcePath: '/a.tsx' }],
        ]) };
        const normalizePreviewInspectorReachabilityPath = (value) =>
          typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
        ${createPreviewInspectorTargetPathIdentityRuntimeSource()}
        const names = new Set(['Drawer', 'PageComponent', 'Styled(Modal)']);
        const singleton = readPreviewInspectorAmbiguousTargetOwnerNames(names);
        previewInspectorSession.renderConditions.set('page-b', {
          id: 'page-b',
          ownerName: 'PageComponent',
          sourcePath: '/b.tsx',
        });
        const repeated = readPreviewInspectorAmbiguousTargetOwnerNames(names);
        globalThis.__result = {
          drawer: singleton.has('Drawer'),
          pageSingleton: singleton.has('PageComponent'),
          pageRepeated: repeated.has('PageComponent'),
          styledModal: singleton.has('Styled(Modal)'),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      drawer: true,
      pageRepeated: true,
      pageSingleton: false,
      styledModal: true,
    });
  });
});
