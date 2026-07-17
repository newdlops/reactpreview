/** Verifies the browser formatter that gives an inspected file its authored page identity. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorChainRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorChainRuntimeSource';

/** Page-context record returned by the generated runtime helper. */
interface PreviewInspectorPageContextFixture {
  readonly badge: string;
  readonly breadcrumb: string;
  readonly detail: string;
  readonly kind: string;
}

describe('Preview Inspector page-context runtime source', () => {
  /** Identifies a nested target as one component inside its mounted authored page root. */
  it('formats the application entry-to-target component path', () => {
    const context = evaluatePageContext({
      inspector: {
        ancestry: [{}],
        renderChain: {
          paths: [
            {
              steps: [
                { label: 'Target', wrapperNames: [] },
                { label: 'DashboardPage', wrapperNames: [] },
                { label: 'App', wrapperNames: [] },
              ],
            },
          ],
          reachability: 'entry-connected',
          target: { exportName: 'Target' },
        },
        root: { exportName: 'App', sourcePath: '/workspace/App.tsx' },
        target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
      },
    });

    expect(context).toEqual({
      badge: 'PAGE COMPONENT',
      breadcrumb: 'App  ›  DashboardPage  ›  Target',
      detail: 'Mounted inside authored page root App · application entry connected',
      kind: 'page-component',
    });
  });

  /** Distinguishes a selected page root from a component nested below another page owner. */
  it('labels an entry-connected selected root as the page root', () => {
    const context = evaluatePageContext({
      inspector: {
        ancestry: [],
        renderChain: {
          paths: [{ steps: [{ label: 'App', wrapperNames: [] }] }],
          reachability: 'entry-connected',
          target: { exportName: 'App' },
        },
        root: { exportName: 'App', sourcePath: '/workspace/App.tsx' },
        target: { exportName: 'App', sourcePath: '/workspace/App.tsx' },
      },
    });

    expect(context).toMatchObject({
      badge: 'PAGE ROOT',
      breadcrumb: 'App',
      kind: 'page-root',
    });
  });

  /** Never claims page ownership when the compiler supplied only a direct-export fallback. */
  it('labels missing ancestry as a standalone fallback', () => {
    expect(evaluatePageContext({})).toEqual({
      badge: 'STANDALONE',
      breadcrumb: 'No authored page context was proven',
      detail: 'Rendering the selected export as an isolated fallback.',
      kind: 'standalone',
    });
  });
});

/** Evaluates generated source with one descriptor and returns its serializable context record. */
function evaluatePageContext(
  descriptor: Record<string, unknown>,
): PreviewInspectorPageContextFixture {
  const sandbox: {
    __pageContext?: PreviewInspectorPageContextFixture;
    previewInspectorSession: {
      descriptors: readonly Record<string, unknown>[];
      selectedExportName: string;
    };
  } = {
    previewInspectorSession: {
      descriptors: [descriptor],
      selectedExportName: 'Target',
    },
  };
  vm.runInNewContext(
    `${createPreviewInspectorChainRuntimeSource()}
function findSelectedPreviewInspectorDescriptor() {
  return previewInspectorSession.descriptors[0];
}
globalThis.__pageContext = readPreviewInspectorPageContext();`,
    sandbox,
  );
  if (sandbox.__pageContext === undefined) {
    throw new Error('Generated Page Inspector context helper did not return a value.');
  }
  return structuredClone(sandbox.__pageContext);
}
