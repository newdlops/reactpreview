/** Verifies selected-target facade generation and exact esbuild import interception. */
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorTargetFacadeSource,
  createPreviewInspectorTargetPlugin,
} from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/application/Target.tsx';
const PARENT_PATH = '/workspace/application/Parent.tsx';
const RUNTIME_SPECIFIER = 'virtual:inspector-runtime';

describe('createPreviewInspectorTargetFacadeSource', () => {
  /** Preserves non-selected exports while wrapping named and default selected values explicitly. */
  it('creates explicit selected exports over the original wildcard surface', () => {
    const source = createPreviewInspectorTargetFacadeSource({
      exportNames: ['Target', 'default'],
      originalHasDefaultExport: true,
      runtimeSpecifier: RUNTIME_SPECIFIER,
      sourcePath: TARGET_PATH,
    });

    expect(source).toContain('export * from "react-preview:inspector-original-target";');
    expect(source).toContain('export { __reactPreviewSelected0 as Target };');
    expect(source).toContain(
      'export default /* @__PURE__ */ __reactPreviewWrap(__reactPreviewOriginal.default',
    );
    expect(source).toContain('"sourcePath":"/workspace/application/Target.tsx"');
  });

  /** Does not add a default binding when the authored module exposes named exports only. */
  it('preserves the absence of an original default export', () => {
    const source = createPreviewInspectorTargetFacadeSource({
      exportNames: ['Target'],
      originalHasDefaultExport: false,
      runtimeSpecifier: RUNTIME_SPECIFIER,
      sourcePath: TARGET_PATH,
    });

    expect(source).toContain('export { __reactPreviewSelected0 as Target };');
    expect(source).not.toContain('export default');
  });

  /** Passes through a known original default when only named components need instrumentation. */
  it('preserves a known unselected default export', () => {
    const source = createPreviewInspectorTargetFacadeSource({
      exportNames: ['Target'],
      originalHasDefaultExport: true,
      runtimeSpecifier: RUNTIME_SPECIFIER,
      sourcePath: TARGET_PATH,
    });

    expect(source).toContain('export default __reactPreviewOriginal.default;');
  });
});

describe('createPreviewInspectorTargetPlugin', () => {
  /** Resolves an alias through the build graph without recursively wrapping the original target. */
  it('wraps only selected exports and passes through the rest of the target module', async () => {
    const sources = new Map<string, string>([
      [
        PARENT_PATH,
        [
          "import Target, { untouched } from '@design/Target';",
          'export const result = { metadata: Target.metadata, untouched };',
        ].join('\n'),
      ],
      [
        TARGET_PATH,
        [
          'export default function Target() { return "target"; }',
          'export const untouched = "original";',
        ].join('\n'),
      ],
    ]);
    const virtualFilesPlugin: Plugin = {
      name: 'inspector-test-files',
      setup(context): void {
        context.onResolve({ filter: /^\/workspace\/application\/Parent\.tsx$/ }, () => ({
          path: PARENT_PATH,
        }));
        context.onResolve({ filter: /^@design\/Target$/ }, () => ({ path: TARGET_PATH }));
        context.onResolve({ filter: /^virtual:inspector-runtime$/ }, () => ({
          namespace: 'inspector-test-runtime',
          path: RUNTIME_SPECIFIER,
        }));
        context.onLoad({ filter: /.*/, namespace: 'inspector-test-runtime' }, () => ({
          contents: [
            'export function wrapPreviewInspectorTarget(value, metadata) {',
            '  value.metadata = metadata;',
            '  return value;',
            '}',
          ].join('\n'),
          loader: 'js',
        }));
        context.onLoad({ filter: /\/workspace\/application\/.+\.tsx$/ }, (arguments_) => ({
          contents: sources.get(arguments_.path) ?? '',
          loader: 'tsx',
          resolveDir: '/workspace/application',
        }));
      },
    };

    const result = await build({
      bundle: true,
      entryPoints: [PARENT_PATH],
      format: 'cjs',
      platform: 'node',
      plugins: [
        createPreviewInspectorTargetPlugin({
          documentPath: TARGET_PATH,
          exportNames: ['default'],
          originalHasDefaultExport: true,
          runtimeSpecifier: RUNTIME_SPECIFIER,
        }),
        virtualFilesPlugin,
      ],
      write: false,
    });
    const output = result.outputFiles[0]?.text;
    if (output === undefined) {
      throw new Error('Inspector facade test bundle was not emitted.');
    }
    expect(output).toContain('"sourcePath": "/workspace/application/Target.tsx"');
    expect(output).toContain('"exportName": "default"');
    expect(output).toContain('untouched = "original"');
  });
});
