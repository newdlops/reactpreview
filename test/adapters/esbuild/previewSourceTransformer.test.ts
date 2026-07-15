/**
 * Exercises source-rewrite semantics that are difficult to observe after esbuild minification.
 * Real temporary files keep context filtering and generated imports aligned with production paths.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PreviewSourceTransformer,
  PreviewSourceTransformError,
} from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('PreviewSourceTransformer', () => {
  /** Leaves human-readable JSX examples and a similarly named property chain byte-for-byte intact. */
  it('does not treat JSX text or another object property as a resource macro', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const sourceText = [
      "const object = { import: { meta: { glob: () => 'ordinary method' } } };",
      "const ordinary = object.import.meta.glob('./pages/*.tsx');",
      "const commented = object. /* keep */ import.meta.glob('./pages/*.tsx');",
      'const globExample = /import.meta.glob(.*)/;',
      'const contextExample = /require.context(.*)/;',
      "if (ordinary) /import.meta.glob(.*)/.test('example');",
      "const πimport = object.import; πimport.meta.glob('./pages/*.tsx');",
      "const templateExample = `${`import.meta.glob('./pages/*.tsx')`}`;",
      'export default function Preview() {',
      '  return <code title="a > b">import.meta.glob("./pages/*.tsx")</code>;',
      '}',
      'void ordinary;',
      'void commented;',
      'void globExample;',
      'void contextExample;',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toBe(sourceText);
    expect(transformed.watchDirectories).toEqual([]);
  });

  /** Skips identifiers already present in user source when allocating generated eager imports. */
  it('allocates collision-free generated bindings', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const sourceText = [
      '"use strict";',
      'const __reactPreview_glob_\\u0030 = 1;',
      "const pages = (import.meta.glob\\u0045ager)('./pages/*.tsx');",
      'export default pages;',
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(transformed.contents).toContain('import * as __reactPreview_glob_1');
    expect(transformed.contents.startsWith('"use strict";')).toBe(true);
    expect(transformed.contents).toContain('const __reactPreview_glob_\\u0030 = 1');
  });

  /** Rejects extra call arguments instead of deleting their runtime side effects during rewriting. */
  it('rejects macro overloads that cannot be preserved', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const transformer = createTransformer(workspaceRoot);

    await expect(
      transformer.transform(
        sourcePath,
        'const page = import(`./pages/${name}.tsx`, { with: sideEffect() });',
      ),
    ).rejects.toThrow('dynamic import requires exactly 1');
    await expect(
      transformer.transform(
        sourcePath,
        "const image = new URL('./image.png', import.meta.url, sideEffect());",
      ),
    ).rejects.toThrow('new URL static assets require exactly two arguments');
    await expect(
      transformer.transform(sourcePath, 'const page = import(getPath());'),
    ).rejects.toThrow('must begin with');
    await expect(
      transformer.transform(sourcePath, 'const page = require(getPath());'),
    ).rejects.toThrow('must begin with');
  });

  /** Expands a Vite-commented relative template but leaves an escaped interpolation literal alone. */
  it('classifies commented and escaped dynamic import templates safely', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;'),
      writeFile(path.join(pagesDirectory, '${literal}-Home.tsx'), 'export default 2;'),
    ]);
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const sourceText = [
      'const name = "Home";',
      'const page = import(/* @vite-ignore */ `./pages/${name}.tsx`);',
      'const spaced = import /* keep */ (`./pages/${name}.tsx`);',
      'const nested = `${import(`./pages/${name}.tsx`)}`;',
      "const concatenated = import('./pages/' + name + '.tsx');",
      "const required = require('./pages/' + name + '.tsx');",
      'const escaped = import(`./pages/\\${name}.tsx`);',
      'const mixed = import(`./pages/\\${literal}-${name}.tsx`);',
      "const rawNested = `${`import('../outside/' + name + '.tsx')`}`;",
    ].join('\n');

    const transformed = await createTransformer(workspaceRoot).transform(sourcePath, sourceText);

    expect(
      transformed.contents.match(/React Preview could not resolve dynamic import/gu),
    ).toHaveLength(5);
    expect(transformed.contents).toContain('React Preview could not resolve require');
    expect(transformed.contents).toContain('import(`./pages/\\${name}.tsx`)');
    expect(transformed.contents).toContain("import('../outside/' + name + '.tsx')");
  });

  /** Collapses adjacent runtime pieces so they cannot accidentally become a recursive globstar. */
  it('keeps adjacent dynamic path expressions at their fixed directory depth', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const deepDirectory = path.join(workspaceRoot, ...Array.from({ length: 22 }, () => 'deep'));
    await mkdir(deepDirectory, { recursive: true });
    await writeFile(path.join(workspaceRoot, 'AB.js'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      'const first = "A"; const second = "B.js"; const value = import(`./${first}${second}`);',
    );

    expect(transformed.contents).toContain('./AB.js');
  });

  /** Fails closed for native esbuild glob shapes that previously bypassed workspace scan limits. */
  it('classifies nested, escaped, regex-bearing, and module require expressions', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');
    const unsafeSources = [
      'const value = `${import(`../outside/${name}.js`)}`;',
      "const value = requ\\u0069re('../outside/' + name + '.js');",
      "const value = (module['re' + 'quire'])('../outside/' + name + '.js');",
      "const value = import('../outside/' + name.replace(/\\(/g, '') + '.js');",
      'const value = import /* keep */ (`../outside/${name}.js`);',
    ];

    for (const sourceText of unsafeSources) {
      await expect(
        createTransformer(workspaceRoot).transform(sourcePath, sourceText),
      ).rejects.toBeInstanceOf(Error);
    }
  });

  /** Rejects executable glob options and runtime query interpolation rather than guessing semantics. */
  it('rejects non-static macro options and suffix expressions', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = import.meta.glob('./pages/*.tsx', getOptions());",
      ),
    ).rejects.toBeInstanceOf(PreviewSourceTransformError);
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        'const asset = import(`./image.png?kind=${kind}`);',
      ),
    ).rejects.toThrow('query and fragment expressions');
  });

  /** Applies a require-context regular expression before enforcing the 256 returned-module cap. */
  it('limits require.context after its static regular-expression filter', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(pagesDirectory, 'Only.tsx'), 'export default 1;'),
      ...Array.from({ length: 256 }, (_, index) =>
        writeFile(path.join(pagesDirectory, `Noise-${index.toString()}.txt`), 'ignored'),
      ),
    ]);
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      "const pages = require.context('./pages', false, /Only\\.tsx$/); export default pages;",
    );

    expect(transformed.contents).toContain('./pages/Only.tsx');
    expect(transformed.contents).not.toContain('Noise-');
    expect(transformed.contents).toContain('() => require("./pages/Only.tsx")');
    expect(transformed.contents).not.toContain('import * as');
  });

  /** Preserves regex punctuation and lazy context semantics while rejecting pathological filters. */
  it('parses bounded require.context regex literals with AST argument boundaries', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'A,B).tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      String.raw`const pages = require.context('./pages', false, /A,B\)\.tsx$/);`,
    );

    expect(transformed.contents).toContain('./pages/A,B).tsx');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /(a+)+$/);",
      ),
    ).rejects.toThrow('nested quantified groups');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /((a+))+$/);",
      ),
    ).rejects.toThrow('nested quantified groups');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /^.*.*.*.*.*.*X$/);",
      ),
    ).rejects.toThrow('repeated unbounded quantifiers');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pages', true, /a{0,5000}X$/);",
      ),
    ).rejects.toThrow('large or repeated range quantifiers');
    await expect(
      createTransformer(workspaceRoot).transform(
        sourcePath,
        "const pages = require.context('./pa?es', true, /tsx$/);",
      ),
    ).rejects.toThrow('without glob metacharacters');
  });

  /** Accepts Vite-compatible comments and trailing commas in literal pattern arrays and options. */
  it('parses commented glob arrays with trailing commas', async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const pagesDirectory = path.join(workspaceRoot, 'pages');
    await mkdir(pagesDirectory, { recursive: true });
    await writeFile(path.join(pagesDirectory, 'Home.tsx'), 'export default 1;');
    const sourcePath = path.join(workspaceRoot, 'Preview.tsx');

    const transformed = await createTransformer(workspaceRoot).transform(
      sourcePath,
      "const pages = import.meta.glob(/* paths */ ['./pages/*.tsx',], { eager: true, });",
    );

    expect(transformed.contents).toContain('./pages/Home.tsx');
  });
});

/** Creates and records one empty workspace directory for cleanup after each test. */
async function createTemporaryWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-transformer-'));
  temporaryRoots.push(workspaceRoot);
  return workspaceRoot;
}

/** Creates a per-build transformer confined to one temporary workspace. */
function createTransformer(workspaceRoot: string): PreviewSourceTransformer {
  return new PreviewSourceTransformer({ projectRoot: workspaceRoot, workspaceRoot });
}
