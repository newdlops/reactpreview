/** Verifies normal output and real native callback traffic for absent or unrelated recovery hints. */
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, context, type Plugin, type PluginBuild } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewDependencyResolutionHintPlugin } from '../../../src/adapters/esbuild/previewDependencyResolutionHintPlugin';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Actual JavaScript callback counts observed across esbuild's native plugin boundary. */
interface CallbackCounts {
  resolves: number;
  fileLoads: number;
}

describe('dependency hint native callback filtering', () => {
  /** An ordinary module graph requires no fallback-policy calls when every hint set is empty. */
  it('bundles an ordinary graph without recovery callbacks when no hints were admitted', async () => {
    const root = await ordinaryFixture();
    const counts = { resolves: 0, fileLoads: 0 };
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        observeCallbacks(
          createPreviewDependencyResolutionHintPlugin({
            facadeSourcePaths: [],
            workspaceRoot: root,
          }),
          counts,
        ),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.outputFiles[0]?.text).toContain('authored-marker');
    expect(counts).toEqual({ resolves: 0, fileLoads: 0 });
  });

  /** A hint for one missing package cannot add callback traffic to unrelated ordinary imports. */
  it('skips unrelated specifiers even when a package recovery hint exists', async () => {
    const root = await ordinaryFixture();
    const counts = { resolves: 0, fileLoads: 0 };
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        observeCallbacks(
          createPreviewDependencyResolutionHintPlugin({
            facadeSourcePaths: [],
            packageContractHints: [
              { moduleSpecifier: '@missing/runtime', sourcePath: path.join(root, 'entry.ts') },
            ],
            workspaceRoot: root,
          }),
          counts,
        ),
      ],
    });

    expect(result.outputFiles[0]?.text).toContain('authored-marker');
    expect(result.warnings).toEqual([]);
    expect(counts).toEqual({ resolves: 0, fileLoads: 0 });
  });

  /** Regex metacharacters remain literal module names rather than matching unrelated requests. */
  it('applies exact package hints containing regex punctuation', async () => {
    const root = await ordinaryFixture();
    const specifier = '@missing/runtime+[test](v1)';
    await writeFile(
      path.join(root, 'entry.ts'),
      `import { run } from ${JSON.stringify(specifier)}; export const value = run();`,
    );
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          workspaceRoot: root,
          packageContractHints: [
            { moduleSpecifier: specifier, sourcePath: path.join(root, 'entry.ts') },
          ],
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.text.includes(specifier))).toBe(true);
    expect(result.outputFiles[0]?.text).toContain('ReactPreviewServerContract');
  });

  /** Non-ASCII requests keep their existing fallback behavior even if the native filter is broad. */
  it('preserves a non-ASCII package request', async () => {
    const root = await ordinaryFixture();
    const specifier = '@missing/도구';
    await writeFile(
      path.join(root, 'entry.ts'),
      `import { run } from ${JSON.stringify(specifier)}; export const value = run();`,
    );
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          workspaceRoot: root,
          packageContractHints: [
            { moduleSpecifier: specifier, sourcePath: path.join(root, 'entry.ts') },
          ],
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.text.includes(specifier))).toBe(true);
  });

  /** Native filtering must use the same admitted primitive as the exact importer/specifier key. */
  it('keeps the admitted specifier when an accessor later changes', async () => {
    const root = await ordinaryFixture();
    const specifier = '@missing/first';
    let reads = 0;
    await writeFile(
      path.join(root, 'entry.ts'),
      `import { run } from ${JSON.stringify(specifier)}; export const value = run();`,
    );
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          workspaceRoot: root,
          packageContractHints: [
            {
              sourcePath: path.join(root, 'entry.ts'),
              get moduleSpecifier() {
                reads += 1;
                return reads === 1 ? specifier : '@missing/changed';
              },
            },
          ],
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.text.includes(specifier))).toBe(true);
  });

  /** Large hint inventories retain exact matching without requiring an unbounded native regexp. */
  it('preserves a matching request after the native pattern budget is exceeded', async () => {
    const root = await ordinaryFixture();
    const specifiers = Array.from(
      { length: 128 },
      (_, index) => `@missing/${'long'.repeat(36)}-${index.toString()}`,
    );
    const specifier = specifiers[127];
    await writeFile(
      path.join(root, 'entry.ts'),
      `import { run } from ${JSON.stringify(specifier)}; export const value = run();`,
    );
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          workspaceRoot: root,
          packageContractHints: specifiers.map((moduleSpecifier) => ({
            moduleSpecifier,
            sourcePath: path.join(root, 'entry.ts'),
          })),
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(
      result.warnings.some((warning) => warning.text.includes(specifier ?? 'unexpected')),
    ).toBe(true);
  });

  /** A valid lexical alias works, while retargeting it outside the workspace invalidates its hint. */
  it('rechecks canonical importer confinement after a symlink is retargeted', async () => {
    const root = await ordinaryFixture();
    const outside = await ordinaryFixture();
    const wrapper = path.join(root, 'wrapper.ts');
    const alias = path.join(root, 'different-name.ts');
    const externalWrapper = path.join(outside, 'wrapper.ts');
    const source = 'export { default as value } from "@missing/runtime";';
    await Promise.all([writeFile(wrapper, source), writeFile(externalWrapper, source)]);
    await symlink(wrapper, alias);
    await writeFile(
      path.join(root, 'entry.ts'),
      'import { value } from "./different-name"; export const result = String(value);',
    );
    const compiler = await context({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      preserveSymlinks: true,
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          workspaceRoot: root,
          packageContractHints: [{ moduleSpecifier: '@missing/runtime', sourcePath: wrapper }],
        }),
      ],
    });
    try {
      const first = await compiler.rebuild();
      expect(first.errors).toEqual([]);
      expect(first.outputFiles[0]?.text).toContain('ReactPreviewServerContract');
      await unlink(alias);
      await symlink(externalWrapper, alias);
      await expect(compiler.rebuild()).rejects.toThrow('Could not resolve "@missing/runtime"');
    } finally {
      await compiler.dispose();
    }
  });

  /** Exact style filters must escape punctuation while retaining the original authored stylesheet. */
  it('preserves authored CSS with a punctuated missing style hint', async () => {
    const root = await ordinaryFixture();
    const stylePath = path.join(root, 'styles.css');
    const specifier = '@missing/[theme](v1)+.css';
    await writeFile(path.join(root, 'entry.ts'), 'import "./styles.css";');
    await writeFile(
      stylePath,
      `@import ${JSON.stringify(specifier)}; .authored { color: rebeccapurple; }`,
    );
    const result = await build({
      entryPoints: [path.join(root, 'entry.ts')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      outdir: path.join(root, 'out'),
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          workspaceRoot: root,
          styleHints: [{ moduleSpecifier: specifier, sourcePath: stylePath }],
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.text.includes(specifier))).toBe(true);
    expect(result.outputFiles.map((file) => file.text).join('\n')).toContain(
      'color: rebeccapurple',
    );
  });
});

/** Builds a tiny authored graph in the test-owned temporary root. */
async function ordinaryFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-hint-filter-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await Promise.all([
    writeFile(
      path.join(root, 'entry.ts'),
      'import { value } from "./src/ordinary"; export { value };',
    ),
    writeFile(path.join(root, 'src/ordinary.ts'), 'export const value = "authored-marker";'),
  ]);
  return root;
}

/** Counts delivered callbacks while preserving esbuild options, results, and plugin ownership. */
function observeCallbacks(plugin: Plugin, counts: CallbackCounts): Plugin {
  return {
    name: plugin.name,
    setup(nativeBuild) {
      const observed: PluginBuild = {
        ...nativeBuild,
        onResolve(options, callback) {
          nativeBuild.onResolve(options, (args) => {
            counts.resolves += 1;
            return callback(args);
          });
        },
        onLoad(options, callback) {
          nativeBuild.onLoad(options, (args) => {
            if (args.namespace === 'file') counts.fileLoads += 1;
            return callback(args);
          });
        },
      };
      return plugin.setup(observed);
    },
  };
}
