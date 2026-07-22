/**
 * Verifies that browser shell preparation sees the complete authored-page corridor.
 * Target-only dependencies are intentionally kept separate from Inspector ancestor dependencies,
 * so this test protects portal hosts contributed by an application shell above the selected file.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { preparePreviewStyleContext } from '../../../src/adapters/esbuild/preparePreviewStyleContext';
import type { PreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const WORKSPACE_ROOT = path.resolve('/workspace');
const TARGET_PATH = path.join(WORKSPACE_ROOT, 'src', 'features', 'Target.tsx');
const PORTAL_PATH = path.join(WORKSPACE_ROOT, 'src', 'app', 'Portal.tsx');

/** Minimal resolver boundary needed when this fixture has no aliases, themes, or global styles. */
function createEmptyStaticModuleResolver(): PreviewStaticModuleResolver {
  return {
    getMatchedSpecifiers: () => [],
    matchesTarget: () => false,
    resolve: () => undefined,
    resolveMissingPathAliasCandidate: () => undefined,
    usesAlternativeJsxRuntime: () => false,
  };
}

describe('preparePreviewStyleContext', () => {
  /** Includes page ancestors when the selected target itself does not declare shared portal roots. */
  it('discovers portal hosts from Inspector ancestor dependencies', async () => {
    const targetSource = 'export const Target = () => <main>Target</main>;';
    const portalSource = `
      import ReactDOM from 'react-dom';
      export const Portal = ({ id, children }) => {
        const host = document.getElementById(id);
        if (host === null) throw new Error(id + ' portal does not exist!');
        return ReactDOM.createPortal(children, host);
      };
      export enum PortalId {
        DIM = 'dim-root',
        POP_UP = 'pop-up-root',
        SPINNER = 'spinner-root',
        TOAST = 'toast-root',
      }
      const portalOrder = [PortalId.DIM, PortalId.POP_UP, PortalId.SPINNER, PortalId.TOAST];
      export const PortalGroup = () => <>{portalOrder.map((id) => <div key={id} id={id} />)}</>;
    `;
    const sourceByPath = new Map([
      [path.normalize(TARGET_PATH), targetSource],
      [path.normalize(PORTAL_PATH), portalSource],
    ]);
    const request: PreviewBuildRequest = {
      dependencySnapshots: [],
      documentPath: TARGET_PATH,
      language: 'tsx',
      renderMode: 'page-inspector',
      sourceText: targetSource,
      workspaceRoot: WORKSPACE_ROOT,
    };

    const context = await preparePreviewStyleContext({
      inspectorDependencyPaths: [PORTAL_PATH],
      portalHostDependencyPaths: [],
      projectRoot: WORKSPACE_ROOT,
      readSource: ({ sourcePath }) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      request,
      staticModuleResolver: createEmptyStaticModuleResolver(),
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(context.portalHostIds).toEqual([
      'dim-root',
      'pop-up-root',
      'spinner-root',
      'toast-root',
    ]);
  });
});
