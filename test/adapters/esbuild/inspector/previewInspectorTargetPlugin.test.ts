/** Verifies selected-target facade generation and exact esbuild import interception. */
import vm from 'node:vm';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorTargetFacadeSource,
  createPreviewInspectorTargetModuleContract,
  createPreviewInspectorTargetPlugin,
} from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/application/Target.tsx';
const PARENT_PATH = '/workspace/application/Parent.tsx';
const RUNTIME_SPECIFIER = 'virtual:inspector-runtime';

describe('createPreviewInspectorTargetFacadeSource', () => {
  /** Preserves non-selected exports while wrapping named and default selected values explicitly. */
  it('creates explicit selected exports over the original wildcard surface', () => {
    const source = createPreviewInspectorTargetFacadeSource({
      inferredPropsByExport: {
        Target: {
          provenance: [{ kind: 'object', path: 'field', source: 'usage' }],
          shape: { kind: 'object', properties: { field: { kind: 'object', properties: {} } } },
        },
      },
      runtimeSpecifier: RUNTIME_SPECIFIER,
      targetModuleContract: createPreviewInspectorTargetModuleContract({
        preparedSourceText: [
          'export const Target = () => null;',
          'export default function DefaultTarget() { return null; }',
        ].join('\n'),
        selectedExportNames: ['Target', 'default'],
        sourcePath: TARGET_PATH,
      }),
    });

    expect(source).toContain('export * from "react-preview:inspector-original-target";');
    expect(source).toContain('export { __reactPreviewSelected0 as Target };');
    expect(source).toContain(
      'export default /* @__PURE__ */ __reactPreviewWrap(__reactPreviewOriginalDefault',
    );
    expect(source).toContain('"sourcePath":"/workspace/application/Target.tsx"');
    expect(source).toContain('"compilerExportEvidence":true');
    expect(source).toContain('"facadeResolutionEvidence":true');
    expect(source).toContain('"inferredPropShape":{"kind":"object"');
    expect(source).toContain('"inferredProps":[{"kind":"object","path":"field"');
  });

  /** Does not add a default binding when the authored module exposes named exports only. */
  it('preserves the absence of an original default export', () => {
    const source = createPreviewInspectorTargetFacadeSource({
      runtimeSpecifier: RUNTIME_SPECIFIER,
      targetModuleContract: createPreviewInspectorTargetModuleContract({
        preparedSourceText: 'export const Target = () => null;',
        selectedExportNames: ['Target'],
        sourcePath: TARGET_PATH,
      }),
    });

    expect(source).toContain('export { __reactPreviewSelected0 as Target };');
    expect(source).not.toContain('export default');
  });

  /** Passes through a known original default when only named components need instrumentation. */
  it('preserves a known unselected default export', () => {
    const source = createPreviewInspectorTargetFacadeSource({
      runtimeSpecifier: RUNTIME_SPECIFIER,
      targetModuleContract: createPreviewInspectorTargetModuleContract({
        preparedSourceText: [
          'export const Target = () => null;',
          'export default function DefaultTarget() { return null; }',
        ].join('\n'),
        selectedExportNames: ['Target'],
        sourcePath: TARGET_PATH,
      }),
    });

    expect(source).toContain('export { __reactPreviewOriginalDefault as default };');
    expect(source).toContain(
      'import { Target as __reactPreviewOriginalSelected0 } from "react-preview:inspector-original-target";',
    );
  });

  /** Proves public aliases and rejects a selected name absent from prepared source evidence. */
  it('derives aliased re-exports and fails closed for an unproven selected binding', () => {
    const contract = createPreviewInspectorTargetModuleContract({
      preparedSourceText: [
        "export { default as SelectedTarget } from './SelectedTarget';",
        "export { default } from './DefaultTarget';",
      ].join('\n'),
      selectedExportNames: ['SelectedTarget'],
      sourcePath: TARGET_PATH,
    });

    expect(contract).toMatchObject({
      explicitExportNames: ['SelectedTarget', 'default'],
      hasDefaultExport: true,
      selectedExportNames: ['SelectedTarget'],
    });
    expect(() =>
      createPreviewInspectorTargetModuleContract({
        preparedSourceText: 'export const PresentTarget = () => null;',
        selectedExportNames: ['MissingTarget'],
        sourcePath: TARGET_PATH,
      }),
    ).toThrow('could not prove the selected export "MissingTarget"');
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
          runtimeSpecifier: RUNTIME_SPECIFIER,
          targetModuleContract: createPreviewInspectorTargetModuleContract({
            preparedSourceText: sources.get(TARGET_PATH) ?? '',
            selectedExportNames: ['default'],
            sourcePath: TARGET_PATH,
          }),
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

  /** Keeps a named wrapper, authored default, and module side effects on one original ESM edge. */
  it('preserves named-plus-default semantics with one original module evaluation', async () => {
    const sources = new Map<string, string>([
      [
        PARENT_PATH,
        [
          "import DefaultTarget, { SelectedTarget, untouched } from '@design/Target';",
          'export const result = {',
          '  defaultWrapped: DefaultTarget.metadata !== undefined,',
          '  evaluationCount: globalThis.__targetEvaluationCount,',
          '  selectedExport: SelectedTarget.metadata.exportName,',
          '  untouched,',
          '};',
        ].join('\n'),
      ],
      [
        TARGET_PATH,
        [
          'globalThis.__targetEvaluationCount = (globalThis.__targetEvaluationCount ?? 0) + 1;',
          'export default function DefaultTarget() { return "default"; }',
          'export function SelectedTarget() { return "selected"; }',
          'export const untouched = "original";',
        ].join('\n'),
      ],
    ]);
    const virtualFilesPlugin: Plugin = {
      name: 'inspector-static-binding-test-files',
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
          contents:
            'export function wrapPreviewInspectorTarget(value, metadata) { value.metadata = metadata; return value; }',
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
          runtimeSpecifier: RUNTIME_SPECIFIER,
          targetModuleContract: createPreviewInspectorTargetModuleContract({
            preparedSourceText: sources.get(TARGET_PATH) ?? '',
            selectedExportNames: ['SelectedTarget'],
            sourcePath: TARGET_PATH,
          }),
        }),
        virtualFilesPlugin,
      ],
      write: false,
    });
    const output = result.outputFiles[0]?.text;
    if (output === undefined) throw new Error('Static facade proof bundle was not emitted.');
    const moduleRecord: { exports: unknown } = { exports: {} };
    vm.runInNewContext(output, { exports: moduleRecord.exports, module: moduleRecord });

    expect(moduleRecord.exports).toMatchObject({
      result: {
        defaultWrapped: false,
        evaluationCount: 1,
        selectedExport: 'SelectedTarget',
        untouched: 'original',
      },
    });
  });
});
