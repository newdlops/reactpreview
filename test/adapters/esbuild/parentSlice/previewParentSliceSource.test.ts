/**
 * Verifies the parent-slice source generator as an isolated static-code boundary.
 * Source assertions cover import minimization and validation, while an in-memory esbuild runtime
 * proves ordinary and render-function children preserve their selected nesting semantics.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewParentSliceSource,
  type PreviewParentSliceSourceOptions,
  type PreviewParentSliceStaticProps,
} from '../../../../src/adapters/esbuild/parentSlice/previewParentSliceSource';

/** Minimal element record returned by the fake React implementation used in execution tests. */
interface FakeReactElement {
  readonly props: Readonly<Record<string, unknown>>;
  readonly type: string;
}

/**
 * Creates an esbuild plugin that models `React.createElement` without loading a DOM or React root.
 * The model deliberately does not invoke component types, allowing tests to inspect render-prop
 * callbacks at the same moment a real wrapper would invoke them.
 *
 * @returns Private virtual React module suitable for one in-memory test build.
 */
function createFakeReactPlugin(): Plugin {
  return {
    name: 'parent-slice-fake-react',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^react$/ }, () => ({
        namespace: 'parent-slice-fake-react',
        path: 'react',
      }));
      buildContext.onLoad({ filter: /.*/, namespace: 'parent-slice-fake-react' }, () => ({
        contents: [
          'export function createElement(type, props, ...children) {',
          '  const nextProps = { ...(props ?? {}) };',
          '  if (children.length === 1) nextProps.children = children[0];',
          '  else if (children.length > 1) nextProps.children = children;',
          '  return { type, props: nextProps };',
          '}',
        ].join('\n'),
        loader: 'js',
      }));
    },
  };
}

describe('createPreviewParentSliceSource', () => {
  /** Resolves consumer-relative imports and emits each selected module only once. */
  it('imports only deduplicated target-path wrappers and never invents siblings', () => {
    const consumerSourcePath = path.join('/workspace', 'src', 'consumer', 'Owner.tsx');
    const source = createPreviewParentSliceSource({
      target: {
        consumerSourcePath,
        exportName: 'default',
        moduleSpecifier: '../target/Target',
      },
      wrappers: [
        {
          childMode: 'children',
          importReference: {
            consumerSourcePath,
            exportName: 'SelectedWrapper',
            moduleSpecifier: './wrappers',
          },
          kind: 'imported',
        },
        {
          childMode: 'children',
          importReference: {
            consumerSourcePath,
            exportName: 'SelectedWrapper',
            moduleSpecifier: './wrappers',
          },
          kind: 'imported',
        },
        {
          childMode: 'children',
          importReference: {
            consumerSourcePath,
            exportName: 'Layout',
            moduleSpecifier: './wrappers',
          },
          kind: 'imported',
        },
      ],
    });
    const normalizedWrapperPath = path
      .join('/workspace', 'src', 'consumer', 'wrappers')
      .replaceAll('\\', '/');
    const normalizedTargetPath = path
      .join('/workspace', 'src', 'target', 'Target')
      .replaceAll('\\', '/');

    expect(source).toContain(`from ${JSON.stringify(normalizedTargetPath)}`);
    expect(source).toContain(`from ${JSON.stringify(normalizedWrapperPath)}`);
    expect(source.split(JSON.stringify(normalizedWrapperPath))).toHaveLength(2);
    expect(source.match(/SelectedWrapper as __reactPreviewImport\d+/gu)).toHaveLength(1);
    expect(source).toContain('Layout as __reactPreviewImport');
    expect(source).not.toContain('Sibling');
  });

  /** Composes direct and render-function children without closing over a reassigned node. */
  it('executes the selected inner-to-outer slice with stable render-prop children', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-parent-slice-'));
    const targetPath = path.join(temporaryDirectory, 'Target.js');
    const wrappersPath = path.join(temporaryDirectory, 'Wrappers.js');
    const consumerSourcePath = path.join(temporaryDirectory, 'Owner.tsx');

    try {
      await Promise.all([
        writeFile(targetPath, 'export default "TARGET";', 'utf8'),
        writeFile(
          wrappersPath,
          [
            'export const Form = "FORM";',
            'export const Panel = "PANEL";',
            'export const Sibling = "SIBLING_MUST_NOT_BE_BUNDLED";',
          ].join('\n'),
          'utf8',
        ),
      ]);
      const source = createPreviewParentSliceSource({
        target: {
          consumerSourcePath,
          exportName: 'default',
          moduleSpecifier: './Target.js',
        },
        wrappers: [
          {
            childMode: 'children',
            kind: 'intrinsic',
            props: { 'aria-label': 'selected branch', count: 2 },
            tagName: 'section',
          },
          {
            childMode: 'render-function',
            importReference: {
              consumerSourcePath,
              exportName: 'Form',
              moduleSpecifier: './Wrappers.js',
            },
            kind: 'imported',
            props: { mode: 'static' },
          },
          {
            childMode: 'children',
            importReference: {
              consumerSourcePath,
              exportName: 'Panel',
              moduleSpecifier: './Wrappers.js',
            },
            kind: 'imported',
            props: { ready: true },
          },
        ],
      });
      const result = await build({
        bundle: true,
        format: 'iife',
        globalName: '__parentSliceTest',
        logLevel: 'silent',
        plugins: [createFakeReactPlugin()],
        stdin: { contents: source, loader: 'js', resolveDir: temporaryDirectory },
        treeShaking: true,
        write: false,
      });
      const javascript = result.outputFiles[0]?.text ?? '';
      const sandbox: {
        __parentSliceTest?: { default?: (props: Record<string, unknown>) => FakeReactElement };
      } = {};
      runInNewContext(javascript, sandbox);

      const outer = sandbox.__parentSliceTest?.default?.({ targetLabel: 'forwarded' });
      expect(outer?.type).toBe('PANEL');
      expect(outer?.props.ready).toBe(true);
      const form = outer?.props.children as FakeReactElement | undefined;
      expect(form?.type).toBe('FORM');
      expect(form?.props.mode).toBe('static');
      const renderSelectedBranch = form?.props.children as (() => FakeReactElement) | undefined;
      const section = renderSelectedBranch?.();
      expect(section?.type).toBe('section');
      expect(section?.props).toMatchObject({ 'aria-label': 'selected branch', count: 2 });
      const target = section?.props.children as FakeReactElement | undefined;
      expect(target?.type).toBe('TARGET');
      expect(target?.props.targetLabel).toBe('forwarded');
      expect(javascript).not.toContain('SIBLING_MUST_NOT_BE_BUNDLED');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Keeps package imports unchanged so the project's normal resolver can handle aliases. */
  it('preserves safe bare module specifiers', () => {
    const source = createPreviewParentSliceSource({
      target: {
        consumerSourcePath: '/workspace/src/Target.tsx',
        exportName: 'Target',
        moduleSpecifier: '@workspace/components',
      },
      wrappers: [],
    });

    expect(source).toContain('from "@workspace/components"');
  });

  /** Rejects executable values, injection-shaped names, and React-reserved prop fields. */
  it('rejects values and identifiers outside the inert static subset', () => {
    const baseOptions: PreviewParentSliceSourceOptions = {
      target: {
        consumerSourcePath: '/workspace/src/Target.tsx',
        exportName: 'Target',
        moduleSpecifier: './Target',
      },
      wrappers: [],
    };
    const unsafePrototypeProps = Object.create(null) as Record<string, string>;
    Object.defineProperty(unsafePrototypeProps, '__proto__', {
      enumerable: true,
      value: 'blocked',
    });

    expect(() =>
      createPreviewParentSliceSource({
        ...baseOptions,
        wrappers: [
          {
            childMode: 'children',
            kind: 'intrinsic',
            props: unsafePrototypeProps,
            tagName: 'div',
          },
        ],
      }),
    ).toThrow(/Unsafe.*__proto__/u);
    expect(() =>
      createPreviewParentSliceSource({
        ...baseOptions,
        wrappers: [
          {
            childMode: 'children',
            kind: 'intrinsic',
            props: { payload: { executable: true } } as unknown as PreviewParentSliceStaticProps,
            tagName: 'div',
          },
        ],
      }),
    ).toThrow(/Non-static/u);
    expect(() =>
      createPreviewParentSliceSource({
        ...baseOptions,
        target: { ...baseOptions.target, exportName: 'Target;globalThis.pwned=true' },
      }),
    ).toThrow(/Invalid.*export name/u);
    expect(() =>
      createPreviewParentSliceSource({
        ...baseOptions,
        wrappers: [{ childMode: 'children', kind: 'intrinsic', tagName: 'div);attack(' }],
      }),
    ).toThrow(/Invalid.*intrinsic/u);
  });
});
