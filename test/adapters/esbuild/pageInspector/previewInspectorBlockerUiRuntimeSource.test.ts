/** Verifies render blockers are placed at their closest source-backed React owner. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerUiRuntimeSource';
import { createPreviewInspectorConditionUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionUiRuntimeSource';

/** Data-only node contract needed for blocker ownership assertions. */
interface BlockerTreeNode {
  readonly blockerKind?: string;
  readonly children: readonly BlockerTreeNode[];
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

/** Generated helper surface exposed only inside the VM fixture. */
interface BlockerRuntime {
  readonly attach: (snapshot: Record<string, unknown>) => { readonly roots: BlockerTreeNode[] };
}

describe('Preview Inspector blocker UI runtime source', () => {
  /** Joins hook and backend dependencies into the same tree that owns their source expression. */
  it('attaches editable blockers below the nearest mounted component', () => {
    const runtime = evaluateBlockerRuntime();
    const snapshot = runtime.attach({
      roots: [
        {
          children: [
            {
              children: [],
              id: 'form',
              kind: 'function',
              name: 'FormSection',
              source: { line: 10, path: '/workspace/Page.tsx' },
            },
          ],
          id: 'page',
          kind: 'function',
          name: 'Page',
          source: { line: 2, path: '/workspace/Page.tsx' },
        },
      ],
    });

    const form = findNode(snapshot.roots, 'FormSection');
    const page = findNode(snapshot.roots, 'Page');
    expect(form?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockerKind: 'runtime-fallback',
          name: 'Blocker · useFormContext',
        }),
      ]),
    );
    expect(page?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockerKind: 'data-request', name: 'Data · Get dashboard' }),
      ]),
    );
  });

  /** Keeps both manual JSON and bounded inference actions explicit in generated UI source. */
  it('emits manual pass-value and Auto pass controls', () => {
    const source = createPreviewInspectorBlockerUiRuntimeSource();

    expect(source).toContain("'Apply pass value'");
    expect(source).toContain("'Auto pass'");
    expect(source).toContain('setPreviewInspectorRuntimeFallbackOverride');
    expect(source).toContain('autoPassPreviewInspectorRuntimeFallback');
    expect(source).toContain("blockerKind: 'target-error'");
  });
});

/** Evaluates attachment functions with fixed hook/data registries and no React project runtime. */
function evaluateBlockerRuntime(): BlockerRuntime {
  const context: { __blockers?: BlockerRuntime } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        boundariesByExport: new Map(),
        descriptors: [],
      };
      const readPreviewInspectorRenderConditions = () => [];
      const readPreviewInspectorRuntimeFallbacks = () => [{
        evidence: 'required form value access',
        error: 'provider missing',
        fallbackPreview: '{"formikProps":{}}',
        generatedPaths: ['formikProps'],
        hookName: 'useFormContext',
        id: 'hook-form',
        line: 12,
        mode: 'auto',
        reason: 'threw',
        sourcePath: '/workspace/Page.tsx',
      }];
      const readPreviewInspectorDataRequests = () => [{
        evidence: 'GraphQL selection',
        id: 'request-dashboard',
        label: 'Get dashboard',
        line: 3,
        mode: 'auto',
        payload: {},
        sourcePath: '/workspace/Page.tsx',
      }];
      const normalizePreviewInspectorUiSource = (source) => ({
        line: source?.line,
        path: source?.path,
      });
      ${createPreviewInspectorConditionUiRuntimeSource()}
      ${createPreviewInspectorBlockerUiRuntimeSource()}
      globalThis.__blockers = { attach: attachPreviewInspectorBlockersToSnapshot };
    `,
    context,
  );
  if (context.__blockers === undefined) throw new Error('Blocker UI fixture did not initialize.');
  return context.__blockers;
}

/** Finds one named node recursively without retaining any runtime owner object. */
function findNode(nodes: readonly BlockerTreeNode[], name: string): BlockerTreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const child = findNode(node.children, name);
    if (child !== undefined) return child;
  }
  return undefined;
}
